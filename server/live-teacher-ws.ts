import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  Behavior,
  FunctionResponseScheduling,
  GoogleGenAI,
  InteractionStatus,
  Modality,
  ThinkingLevel,
  Type,
  type FunctionDeclaration,
  type LiveServerMessage,
  type Session,
} from '@google/genai';
import { WebSocket, WebSocketServer } from 'ws';
import {
  buildLiveTeacherSystemInstruction,
  LIVE_ALLOWED_VOICES,
  resolveLiveModel,
  type LiveSessionPromptConfig,
} from '../shared/live-teacher-prompt.mjs';
import {
  cleanApiKeyCandidate,
  getLiveQuotaSnapshot,
  incrementLiveUsedSeconds,
  resolveLiveBackendState,
  verifyFirebaseTokenString,
  type LiveWorkerEnv,
} from '../worker/tts-handler.js';

interface ClientInitMsg {
  type: 'init';
  idToken?: string;
  byokKey?: string;
  voice?: string;
  gradeLevel?: string;
  subject?: string;
  languageMix?: string;
  teachingMode?: string;
  deepThinking?: boolean;
  bookContext?: string;
}

type ClientInboundMsg =
  | ClientInitMsg
  | { type: 'audio'; data: string }
  | { type: 'video'; data: string }
  | { type: 'text'; text: string }
  | { type: 'end' };

const MAX_WS_PAYLOAD_BYTES = 1_500_000;
const QUOTA_TICK_INTERVAL_MS = 10_000;

function safeSend(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

export function attachLiveTeacherWebSocket(
  httpServer: { on(event: 'upgrade', listener: (req: IncomingMessage, socket: Duplex, head: Buffer) => void): void } | null | undefined,
  getEnv: () => LiveWorkerEnv
): void {
  if (!httpServer) return;

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WS_PAYLOAD_BYTES,
  });

  httpServer.on('upgrade', (req, socket, head) => {
    const rawUrl = req.url || '/';
    const pathname = rawUrl.split('?')[0];
    if (pathname !== '/api/live-teacher') {
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (clientWs) => {
    let geminiSession: Session | null = null;
    let quotaTimer: ReturnType<typeof setInterval> | null = null;
    let initTimeout: ReturnType<typeof setTimeout> | null = null;
    let initialized = false;
    let closed = false;
    let activeUid = '';
    let usingByok = false;
    let envSnapshot = getEnv();
    let lastTickAt = Date.now();
    let billedSeconds = 0;

    const cleanup = async (closeReason?: string) => {
      if (closed) return;
      closed = true;

      if (initTimeout) {
        clearTimeout(initTimeout);
        initTimeout = null;
      }
      if (quotaTimer) {
        clearInterval(quotaTimer);
        quotaTimer = null;
      }

      if (initialized && !usingByok && activeUid) {
        const remainingDelta = Math.floor((Date.now() - lastTickAt) / 1000);
        if (remainingDelta > 0) {
          await incrementLiveUsedSeconds(activeUid, envSnapshot, remainingDelta).catch(() => {});
        }
      }

      if (geminiSession) {
        try {
          geminiSession.close();
        } catch {
          // Ignore close errors
        }
        geminiSession = null;
      }

      if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
        try {
          clientWs.close(1000, closeReason || 'Session ended');
        } catch {
          // Ignore
        }
      }
    };

    initTimeout = setTimeout(() => {
      if (!initialized && !closed) {
        safeSend(clientWs, { type: 'error', message: 'Live session initialization timed out.' });
        void cleanup('Init timeout');
      }
    }, 15_000);

    clientWs.on('close', () => {
      void cleanup('Client closed');
    });

    clientWs.on('error', () => {
      void cleanup('Socket error');
    });

    clientWs.on('message', async (rawData) => {
      if (closed) return;

      let msg: ClientInboundMsg;
      try {
        msg = JSON.parse(rawData.toString()) as ClientInboundMsg;
      } catch {
        safeSend(clientWs, { type: 'error', message: 'Invalid message format.' });
        return;
      }

      if (!initialized) {
        if (msg.type !== 'init') {
          safeSend(clientWs, { type: 'error', message: 'Session must initialize before streaming.' });
          return;
        }
        initialized = true;
        if (initTimeout) {
          clearTimeout(initTimeout);
          initTimeout = null;
        }

        try {
          envSnapshot = getEnv();
          const verified = await verifyFirebaseTokenString(msg.idToken || '');
          if (!verified.ok) {
            safeSend(clientWs, { type: 'error', code: 'AUTH_REQUIRED', message: verified.error });
            await cleanup('Unauthorized');
            return;
          }
          activeUid = verified.user.uid;

          const runtimeState = await resolveLiveBackendState(envSnapshot);
          if (runtimeState.maintenanceMode) {
            safeSend(clientWs, {
              type: 'error',
              code: 'MAINTENANCE',
              message: 'Voice Studio is temporarily under maintenance. Please try again shortly.',
            });
            await cleanup('Maintenance');
            return;
          }

          const suppliedByok = cleanApiKeyCandidate(msg.byokKey);
          usingByok = Boolean(suppliedByok);
          const apiKey = suppliedByok || runtimeState.effectiveApiKey;

          if (!apiKey) {
            safeSend(clientWs, {
              type: 'error',
              code: 'NO_API_KEY',
              message: 'Live AI Teacher server key is not configured yet, and no personal Gemini API key is enabled.',
            });
            await cleanup('No API key');
            return;
          }

          if (!usingByok) {
            const quota = await getLiveQuotaSnapshot(activeUid, envSnapshot);
            safeSend(clientWs, {
              type: 'quota',
              usedSeconds: quota.usedSeconds,
              limitSeconds: quota.limitSeconds,
              remainingSeconds: quota.remainingSeconds,
              unlimited: false,
            });
            if (quota.remainingSeconds <= 0) {
              safeSend(clientWs, {
                type: 'error',
                code: 'LIVE_QUOTA_EXCEEDED',
                message:
                  'Your 10-minute daily free Live AI Teacher allowance is finished for today. Enable your own Gemini API key in Speech Studio for unlimited sessions, or try again tomorrow.',
              });
              await cleanup('Daily quota reached');
              return;
            }
          } else {
            safeSend(clientWs, {
              type: 'quota',
              usedSeconds: 0,
              limitSeconds: runtimeState.limitSeconds,
              remainingSeconds: runtimeState.limitSeconds,
              unlimited: true,
            });
          }

          const model = resolveLiveModel(msg.gradeLevel, Boolean(msg.deepThinking));
          const isExtendedThinking = model === 'gemini-3.8-live-extended-thinking';
          const voiceName = LIVE_ALLOWED_VOICES.includes(String(msg.voice || '')) ? String(msg.voice) : 'Kore';

          const promptConfig: LiveSessionPromptConfig = {
            gradeLevel: msg.gradeLevel as LiveSessionPromptConfig['gradeLevel'],
            subject: msg.subject,
            languageMix: msg.languageMix as LiveSessionPromptConfig['languageMix'],
            teachingMode: msg.teachingMode as LiveSessionPromptConfig['teachingMode'],
            bookContext: msg.bookContext,
          };
          const systemInstruction = buildLiveTeacherSystemInstruction(promptConfig);

          const sendNotesDecl: FunctionDeclaration = {
            name: 'send_notes_to_speech_studio',
            description:
              'Saves structured plain-text lesson notes or practice questions for the student so they can export an offline MP3.',
            ...(isExtendedThinking ? { behavior: Behavior.NON_BLOCKING } : {}),
            parameters: {
              type: Type.OBJECT,
              properties: {
                title: {
                  type: Type.STRING,
                  description: 'Short clear title of the lesson or chapter topic.',
                },
                notesText: {
                  type: Type.STRING,
                  description:
                    'Plain spoken-friendly study notes, key definitions, and practice questions with zero markdown symbols.',
                },
              },
              required: ['title', 'notesText'],
            },
          };

          const quizFeedbackDecl: FunctionDeclaration = {
            name: 'record_quiz_feedback',
            description: 'Records one oral viva or quiz question outcome so the student can review missed concepts.',
            ...(isExtendedThinking ? { behavior: Behavior.NON_BLOCKING } : {}),
            parameters: {
              type: Type.OBJECT,
              properties: {
                topic: { type: Type.STRING },
                correct: { type: Type.BOOLEAN },
                summary: { type: Type.STRING },
              },
              required: ['topic', 'correct', 'summary'],
            },
          };

          const ai = new GoogleGenAI({
            apiKey,
            httpOptions: {
              headers: {
                'User-Agent': 'aistudio-build',
              },
            },
          });

          const sessionConfig: Record<string, unknown> = {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName,
                },
              },
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            tools: [{ functionDeclarations: [sendNotesDecl, quizFeedbackDecl] }],
            systemInstruction,
          };

          if (isExtendedThinking) {
            sessionConfig.thinkingConfig = {
              thinkingLevel: ThinkingLevel.MEDIUM,
            };
          }

          geminiSession = await ai.live.connect({
            model,
            config: sessionConfig as never,
            callbacks: {
              onmessage: (message: LiveServerMessage) => {
                if (closed) return;

                const content = message.serverContent;
                if (content?.inputTranscription?.text) {
                  safeSend(clientWs, {
                    type: 'input_transcript',
                    text: content.inputTranscription.text,
                  });
                }
                if (content?.outputTranscription?.text) {
                  safeSend(clientWs, {
                    type: 'output_transcript',
                    text: content.outputTranscription.text,
                  });
                }

                for (const part of content?.modelTurn?.parts ?? []) {
                  if (part.inlineData?.data) {
                    safeSend(clientWs, {
                      type: 'audio',
                      data: part.inlineData.data,
                    });
                  }
                }

                if (content?.interrupted) {
                  safeSend(clientWs, { type: 'interrupted' });
                }

                if (content?.turnComplete) {
                  safeSend(clientWs, { type: 'turn_complete' });
                }

                if (content?.interactionStatus) {
                  safeSend(clientWs, {
                    type: 'status',
                    interactionStatus: content.interactionStatus,
                    busy: content.interactionStatus === InteractionStatus.IN_PROGRESS,
                  });
                }

                for (const call of message.toolCall?.functionCalls ?? []) {
                  const args = (call.args || {}) as Record<string, unknown>;
                  if (call.name === 'send_notes_to_speech_studio') {
                    safeSend(clientWs, {
                      type: 'lesson_notes',
                      title: String(args.title || 'Live Teacher Notes').slice(0, 120),
                      notesText: String(args.notesText || '').slice(0, 12_000),
                    });
                    try {
                      geminiSession?.sendToolResponse({
                        functionResponses: [
                          {
                            id: call.id,
                            name: call.name,
                            response: { ok: true, saved: true },
                            ...(isExtendedThinking ? { scheduling: FunctionResponseScheduling.WHEN_IDLE } : {}),
                          },
                        ],
                      });
                    } catch {
                      // Ignore
                    }
                  } else if (call.name === 'record_quiz_feedback') {
                    safeSend(clientWs, {
                      type: 'quiz_feedback',
                      topic: String(args.topic || ''),
                      correct: Boolean(args.correct),
                      summary: String(args.summary || ''),
                    });
                    try {
                      geminiSession?.sendToolResponse({
                        functionResponses: [
                          {
                            id: call.id,
                            name: call.name,
                            response: { ok: true, recorded: true },
                            ...(isExtendedThinking ? { scheduling: FunctionResponseScheduling.SILENT } : {}),
                          },
                        ],
                      });
                    } catch {
                      // Ignore
                    }
                  }
                }
              },
              onerror: (errEvent) => {
                if (closed) return;
                const messageText =
                  (errEvent as { message?: string } | undefined)?.message ||
                  'Live AI Teacher upstream connection failed.';
                safeSend(clientWs, { type: 'error', message: messageText });
              },
              onclose: (closeEvt) => {
                if (closed) return;
                const reason = (closeEvt as { reason?: string } | undefined)?.reason || 'Live teacher session closed.';
                safeSend(clientWs, { type: 'session_closed', reason });
                void cleanup(reason);
              },
            },
          });

          if (closed) {
            geminiSession.close();
            geminiSession = null;
            return;
          }

          lastTickAt = Date.now();
          safeSend(clientWs, {
            type: 'ready',
            model,
            voice: voiceName,
            unlimited: usingByok,
          });

          if (!usingByok) {
            quotaTimer = setInterval(async () => {
              if (closed || !activeUid) return;
              const elapsed = Math.max(1, Math.round((Date.now() - lastTickAt) / 1000));
              lastTickAt = Date.now();
              billedSeconds += elapsed;
              try {
                const updated = await incrementLiveUsedSeconds(activeUid, envSnapshot, elapsed);
                safeSend(clientWs, {
                  type: 'quota',
                  usedSeconds: updated.usedSeconds,
                  limitSeconds: updated.limitSeconds,
                  remainingSeconds: updated.remainingSeconds,
                  unlimited: false,
                  billedSeconds,
                });
                if (updated.remainingSeconds <= 0) {
                  safeSend(clientWs, {
                    type: 'error',
                    code: 'LIVE_QUOTA_EXCEEDED',
                    message:
                      'Your 10-minute daily free Live AI Teacher allowance has ended for today. Bring your own Gemini API key in Speech Studio for unlimited sessions.',
                  });
                  await cleanup('Daily quota reached');
                }
              } catch {
                // Ignore transient quota sync failures
              }
            }, QUOTA_TICK_INTERVAL_MS);
          }
        } catch (err) {
          const msgText = err instanceof Error ? err.message : 'Failed to start Live AI Teacher session.';
          safeSend(clientWs, { type: 'error', message: msgText });
          await cleanup('Init error');
        }
        return;
      }

      if (!geminiSession) return;

      if (msg.type === 'audio' && typeof msg.data === 'string' && msg.data.length > 0) {
        geminiSession.sendRealtimeInput({
          audio: {
            data: msg.data,
            mimeType: 'audio/pcm;rate=16000',
          },
        });
      } else if (msg.type === 'video' && typeof msg.data === 'string' && msg.data.length > 0) {
        geminiSession.sendRealtimeInput({
          video: {
            data: msg.data,
            mimeType: 'image/jpeg',
          },
        });
      } else if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim().length > 0) {
        geminiSession.sendRealtimeInput({
          text: msg.text.trim().slice(0, 4000),
        });
      } else if (msg.type === 'end') {
        await cleanup('Ended by user');
      }
    });
  });
}
