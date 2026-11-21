import {
  buildLiveTeacherSystemInstruction,
  LIVE_ALLOWED_VOICES,
  resolveLiveModel,
  type LiveSessionPromptConfig,
} from '../shared/live-teacher-prompt.mjs';
import {
  cleanApiKeyCandidate,
  getLiveQuotaSnapshot,
  handleApiRequest,
  incrementLiveUsedSeconds,
  resolveLiveBackendState,
  verifyFirebaseTokenString,
  type LiveWorkerEnv,
} from './tts-handler.js';

interface CloudflareWebSocket {
  accept(): void;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', listener: (ev: { data: string | ArrayBuffer }) => void): void;
  addEventListener(type: 'close', listener: (ev: { code?: number; reason?: string }) => void): void;
  addEventListener(type: 'error', listener: (ev: unknown) => void): void;
}

declare const WebSocketPair:
  | {
      new (): { 0: CloudflareWebSocket; 1: CloudflareWebSocket };
    }
  | undefined;

interface CloudflareEnv extends LiveWorkerEnv {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

const KNOWN_PUBLIC_OR_APP_PATHS = new Set([
  '/',
  '/app',
  '/live-teacher',
  '/pdf-to-audio',
  '/urdu-tts',
  '/podcast-studio',
  '/video-subtitles',
  '/guides',
  '/guides/pdf-textbook-to-mp3-audio',
  '/guides/urdu-text-to-speech-mixed-english-terms',
  '/guides/blind-low-vision-students-audio-textbooks',
  '/guides/epub-chapter-by-chapter-audiobook',
  '/formats',
  '/faq',
  '/about',
  '/contact',
  '/privacy',
  '/terms',
  '/account',
  '/admin',
]);

function cfSafeSend(ws: CloudflareWebSocket, payload: Record<string, unknown>): void {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // Ignore send on closed socket
  }
}

async function handleCloudflareLiveWebSocket(env: CloudflareEnv): Promise<Response> {
  if (typeof WebSocketPair === 'undefined') {
    return new Response(JSON.stringify({ error: 'WebSocketPair unavailable in this runtime.' }), {
      status: 501,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const pair = new WebSocketPair();
  const clientWs = pair[0];
  const serverWs = pair[1];
  serverWs.accept();

  let upstreamWs: CloudflareWebSocket | null = null;
  let initialized = false;
  let closed = false;
  let activeUid = '';
  let usingByok = false;
  let lastTickAt = Date.now();
  let quotaTimer: ReturnType<typeof setInterval> | null = null;
  let billedSeconds = 0;

  const cleanup = async (reason?: string) => {
    if (closed) return;
    closed = true;
    if (quotaTimer) {
      clearInterval(quotaTimer);
      quotaTimer = null;
    }
    if (initialized && !usingByok && activeUid) {
      const delta = Math.floor((Date.now() - lastTickAt) / 1000);
      if (delta > 0) {
        await incrementLiveUsedSeconds(activeUid, env, delta).catch(() => {});
      }
    }
    try {
      upstreamWs?.close(1000, reason || 'Closed');
    } catch {
      // Ignore
    }
    try {
      serverWs.close(1000, reason || 'Closed');
    } catch {
      // Ignore
    }
  };

  serverWs.addEventListener('close', () => {
    void cleanup('Client disconnected');
  });

  serverWs.addEventListener('error', () => {
    void cleanup('Client socket error');
  });

  serverWs.addEventListener('message', async (ev) => {
    if (closed) return;
    let msg: Record<string, unknown>;
    try {
      const raw = typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data);
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      cfSafeSend(serverWs, { type: 'error', message: 'Invalid JSON frame.' });
      return;
    }

    if (!initialized) {
      if (msg.type !== 'init') {
        cfSafeSend(serverWs, { type: 'error', message: 'Session must send init frame first.' });
        return;
      }
      initialized = true;

      try {
        const verified = await verifyFirebaseTokenString(String(msg.idToken || ''));
        if (!verified.ok) {
          cfSafeSend(serverWs, { type: 'error', code: 'AUTH_REQUIRED', message: verified.error });
          await cleanup('Unauthorized');
          return;
        }
        activeUid = verified.user.uid;

        const runtimeState = await resolveLiveBackendState(env);
        if (runtimeState.maintenanceMode) {
          cfSafeSend(serverWs, {
            type: 'error',
            code: 'MAINTENANCE',
            message: 'Voice Studio is temporarily under maintenance.',
          });
          await cleanup('Maintenance');
          return;
        }

        const suppliedByok = cleanApiKeyCandidate(typeof msg.byokKey === 'string' ? msg.byokKey : '');
        usingByok = Boolean(suppliedByok);
        const apiKey = suppliedByok || runtimeState.effectiveApiKey;
        if (!apiKey) {
          cfSafeSend(serverWs, {
            type: 'error',
            code: 'NO_API_KEY',
            message: 'Live AI Teacher server key is not configured yet, and no personal Gemini key is enabled.',
          });
          await cleanup('No API key');
          return;
        }

        if (!usingByok) {
          const quota = await getLiveQuotaSnapshot(activeUid, env);
          cfSafeSend(serverWs, {
            type: 'quota',
            usedSeconds: quota.usedSeconds,
            limitSeconds: quota.limitSeconds,
            remainingSeconds: quota.remainingSeconds,
            unlimited: false,
          });
          if (quota.remainingSeconds <= 0) {
            cfSafeSend(serverWs, {
              type: 'error',
              code: 'LIVE_QUOTA_EXCEEDED',
              message:
                'Your 10-minute daily free Live AI Teacher allowance is finished for today. Enable your own Gemini key in Speech Studio for unlimited access.',
            });
            await cleanup('Daily quota reached');
            return;
          }
        } else {
          cfSafeSend(serverWs, {
            type: 'quota',
            usedSeconds: 0,
            limitSeconds: runtimeState.limitSeconds,
            remainingSeconds: runtimeState.limitSeconds,
            unlimited: true,
          });
        }

        const model = resolveLiveModel(
          typeof msg.gradeLevel === 'string' ? msg.gradeLevel : 'matric',
          Boolean(msg.deepThinking)
        );
        const isExtendedThinking = model === 'gemini-3.8-live-extended-thinking';
        const voiceName = LIVE_ALLOWED_VOICES.includes(String(msg.voice || '')) ? String(msg.voice) : 'Kore';

        const promptConfig: LiveSessionPromptConfig = {
          gradeLevel: msg.gradeLevel as LiveSessionPromptConfig['gradeLevel'],
          subject: typeof msg.subject === 'string' ? msg.subject : 'All Subjects',
          languageMix: msg.languageMix as LiveSessionPromptConfig['languageMix'],
          teachingMode: msg.teachingMode as LiveSessionPromptConfig['teachingMode'],
          bookContext: typeof msg.bookContext === 'string' ? msg.bookContext : '',
        };
        const systemInstruction = buildLiveTeacherSystemInstruction(promptConfig);

        const upstreamUrl = `https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${encodeURIComponent(apiKey)}`;
        const upstreamRes = await fetch(upstreamUrl, {
          headers: { Upgrade: 'websocket' },
        });
        const ws = (upstreamRes as unknown as { webSocket?: CloudflareWebSocket }).webSocket;
        if (!ws) {
          cfSafeSend(serverWs, { type: 'error', message: 'Could not connect to Gemini Live upstream.' });
          await cleanup('Upstream WS failed');
          return;
        }
        upstreamWs = ws;
        upstreamWs.accept();

        const fnDecls = [
          {
            name: 'send_notes_to_speech_studio',
            description:
              'Saves structured plain-text lesson notes or practice questions for the student so they can export an offline MP3.',
            ...(isExtendedThinking ? { behavior: 'NON_BLOCKING' } : {}),
            parameters: {
              type: 'OBJECT',
              properties: {
                title: { type: 'STRING' },
                notesText: { type: 'STRING' },
              },
              required: ['title', 'notesText'],
            },
          },
          {
            name: 'record_quiz_feedback',
            description: 'Records one oral quiz evaluation item.',
            ...(isExtendedThinking ? { behavior: 'NON_BLOCKING' } : {}),
            parameters: {
              type: 'OBJECT',
              properties: {
                topic: { type: 'STRING' },
                correct: { type: 'BOOLEAN' },
                summary: { type: 'STRING' },
              },
              required: ['topic', 'correct', 'summary'],
            },
          },
        ];

        const setupMsg = {
          setup: {
            model: `models/${model}`,
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
              ...(isExtendedThinking ? { thinkingConfig: { thinkingLevel: 'MEDIUM' } } : {}),
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction: {
              parts: [{ text: systemInstruction }],
            },
            tools: [{ functionDeclarations: fnDecls }],
          },
        };

        upstreamWs.addEventListener('message', (upEv) => {
          if (closed) return;
          try {
            const upRaw = typeof upEv.data === 'string' ? upEv.data : new TextDecoder().decode(upEv.data);
            const data = JSON.parse(upRaw) as Record<string, unknown>;
            if (data.setupComplete) {
              cfSafeSend(serverWs, { type: 'ready', model, voice: voiceName, unlimited: usingByok });
              return;
            }
            const sc = data.serverContent as
              | {
                  inputTranscription?: { text?: string };
                  outputTranscription?: { text?: string };
                  interrupted?: boolean;
                  turnComplete?: boolean;
                  interactionStatus?: string;
                  modelTurn?: { parts?: Array<{ inlineData?: { data?: string } }> };
                }
              | undefined;
            if (sc?.inputTranscription?.text) {
              cfSafeSend(serverWs, { type: 'input_transcript', text: sc.inputTranscription.text });
            }
            if (sc?.outputTranscription?.text) {
              cfSafeSend(serverWs, { type: 'output_transcript', text: sc.outputTranscription.text });
            }
            for (const part of sc?.modelTurn?.parts ?? []) {
              if (part.inlineData?.data) {
                cfSafeSend(serverWs, { type: 'audio', data: part.inlineData.data });
              }
            }
            if (sc?.interrupted) cfSafeSend(serverWs, { type: 'interrupted' });
            if (sc?.turnComplete) cfSafeSend(serverWs, { type: 'turn_complete' });
            if (sc?.interactionStatus) {
              cfSafeSend(serverWs, {
                type: 'status',
                interactionStatus: sc.interactionStatus,
                busy: sc.interactionStatus === 'IN_PROGRESS',
              });
            }

            const toolCall = data.toolCall as
              | { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> }
              | undefined;
            for (const call of toolCall?.functionCalls ?? []) {
              const args = call.args || {};
              if (call.name === 'send_notes_to_speech_studio') {
                cfSafeSend(serverWs, {
                  type: 'lesson_notes',
                  title: String(args.title || 'Live Teacher Notes').slice(0, 120),
                  notesText: String(args.notesText || '').slice(0, 12_000),
                });
                upstreamWs?.send(
                  JSON.stringify({
                    toolResponse: {
                      functionResponses: [
                        {
                          id: call.id,
                          name: call.name,
                          response: { ok: true, saved: true },
                          ...(isExtendedThinking ? { scheduling: 'WHEN_IDLE' } : {}),
                        },
                      ],
                    },
                  })
                );
              } else if (call.name === 'record_quiz_feedback') {
                cfSafeSend(serverWs, {
                  type: 'quiz_feedback',
                  topic: String(args.topic || ''),
                  correct: Boolean(args.correct),
                  summary: String(args.summary || ''),
                });
                upstreamWs?.send(
                  JSON.stringify({
                    toolResponse: {
                      functionResponses: [
                        {
                          id: call.id,
                          name: call.name,
                          response: { ok: true, recorded: true },
                          ...(isExtendedThinking ? { scheduling: 'SILENT' } : {}),
                        },
                      ],
                    },
                  })
                );
              }
            }
          } catch {
            // Ignore malformed upstream chunks
          }
        });

        upstreamWs.addEventListener('close', (upClose) => {
          if (closed) return;
          const r = upClose?.reason || 'Live teacher session closed.';
          cfSafeSend(serverWs, { type: 'session_closed', reason: r });
          void cleanup(r);
        });

        upstreamWs.addEventListener('error', () => {
          if (closed) return;
          cfSafeSend(serverWs, { type: 'error', message: 'Gemini Live upstream WebSocket error.' });
          void cleanup('Upstream error');
        });

        upstreamWs.send(JSON.stringify(setupMsg));
        lastTickAt = Date.now();

        if (!usingByok) {
          quotaTimer = setInterval(async () => {
            if (closed || !activeUid) return;
            const elapsed = Math.max(1, Math.round((Date.now() - lastTickAt) / 1000));
            lastTickAt = Date.now();
            billedSeconds += elapsed;
            const updated = await incrementLiveUsedSeconds(activeUid, env, elapsed).catch(() => null);
            if (updated) {
              cfSafeSend(serverWs, {
                type: 'quota',
                usedSeconds: updated.usedSeconds,
                limitSeconds: updated.limitSeconds,
                remainingSeconds: updated.remainingSeconds,
                unlimited: false,
                billedSeconds,
              });
              if (updated.remainingSeconds <= 0) {
                cfSafeSend(serverWs, {
                  type: 'error',
                  code: 'LIVE_QUOTA_EXCEEDED',
                  message:
                    'Your 10-minute daily free Live AI Teacher allowance has ended for today. Bring your own Gemini key for unlimited sessions.',
                });
                await cleanup('Daily quota reached');
              }
            }
          }, 10_000);
        }
      } catch (err) {
        cfSafeSend(serverWs, {
          type: 'error',
          message: err instanceof Error ? err.message : 'Live session initialization failed.',
        });
        await cleanup('Init failure');
      }
      return;
    }

    if (!upstreamWs) return;
    if (msg.type === 'audio' && typeof msg.data === 'string' && msg.data.length > 0) {
      upstreamWs.send(
        JSON.stringify({
          realtimeInput: { audio: { mimeType: 'audio/pcm;rate=16000', data: msg.data } },
        })
      );
    } else if (msg.type === 'video' && typeof msg.data === 'string' && msg.data.length > 0) {
      upstreamWs.send(
        JSON.stringify({
          realtimeInput: { video: { mimeType: 'image/jpeg', data: msg.data } },
        })
      );
    } else if (msg.type === 'text' && typeof msg.text === 'string' && msg.text.trim().length > 0) {
      upstreamWs.send(
        JSON.stringify({
          realtimeInput: { text: msg.text.trim().slice(0, 4000) },
        })
      );
    } else if (msg.type === 'end') {
      await cleanup('Ended by user');
    }
  });

  return new Response(null, { status: 101, webSocket: clientWs } as never);
}

export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/live-teacher' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      return handleCloudflareLiveWebSocket(env);
    }

    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env);
    }

    const res = await env.ASSETS.fetch(request);
    if (res.status !== 404) {
      return res;
    }

    const cleanPath = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '').toLowerCase();
    const lastSeg = cleanPath.split('/').pop() || '';
    if (!lastSeg.includes('.') && !KNOWN_PUBLIC_OR_APP_PATHS.has(cleanPath)) {
      const notFoundReq = new Request(`${url.origin}/404.html`, { method: request.method, headers: request.headers });
      const nfRes = await env.ASSETS.fetch(notFoundReq);
      if (nfRes.ok) {
        const headers = new Headers(nfRes.headers);
        headers.set('Content-Type', 'text/html; charset=utf-8');
        return new Response(nfRes.body, { status: 404, headers });
      }
    }

    return res;
  },
};
