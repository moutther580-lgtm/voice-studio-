import type { User } from 'firebase/auth';

export interface LiveTeacherHostHooks {
  getCurrentUser: () => User | null;
  isByokActive: () => boolean;
  getByokKey: () => string;
  getLoadedTextExcerpt: () => string;
  sendLessonNotesToSpeechStudio: (title: string, text: string) => void;
  navigateToPage: (pageId: string, moveFocus?: boolean) => void;
  getWsUrlOverride?: () => string;
}

interface QuotaStateView {
  usedSeconds: number;
  limitSeconds: number;
  remainingSeconds: number;
  unlimited: boolean;
}

let activeController: { destroy: () => void } | null = null;

function formatMmSs(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(bin);
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function pcm24kBytesToFloat32(bytes: Uint8Array): Float32Array {
  const samples = Math.floor(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

export function unmountLiveTeacher(): void {
  if (activeController) {
    activeController.destroy();
    activeController = null;
  }
}

export async function mountLiveTeacher(hooks: LiveTeacherHostHooks): Promise<void> {
  unmountLiveTeacher();

  const authPromptCard = document.getElementById('liveAuthPromptCard');
  const authTitle = document.getElementById('liveAuthTitle');
  const authLead = document.getElementById('liveAuthLead');
  const workspaceEl = document.getElementById('liveTeacherWorkspace');
  if (!authPromptCard || !workspaceEl) return;

  const user = hooks.getCurrentUser();
  if (!user || !user.emailVerified) {
    authPromptCard.hidden = false;
    workspaceEl.hidden = true;
    if (authTitle && authLead) {
      if (user && !user.emailVerified) {
        authTitle.textContent = 'Verify your email to start Live AI Teacher';
        authLead.textContent =
          'Your account is signed in, but email verification is required before using the 10-minute daily free Live AI Teacher allowance.';
      } else {
        authTitle.textContent = 'Sign in to start your Live Class';
        authLead.innerHTML =
          'Verified accounts get <strong>10 minutes free every day</strong>, and users with their own Gemini API key saved in <a href="/app" data-page="app">Speech Studio (/app)</a> get unlimited free live sessions.';
      }
    }
    return;
  }

  authPromptCard.hidden = true;
  workspaceEl.hidden = false;

  const quotaTextEl = document.getElementById('liveQuotaText');
  const timerClockEl = document.getElementById('liveTimerClock');
  const meterFillEl = document.getElementById('liveQuotaMeterFill') as HTMLElement | null;

  const gradeSel = document.getElementById('liveGrade') as HTMLSelectElement | null;
  const subjectSel = document.getElementById('liveSubject') as HTMLSelectElement | null;
  const langSel = document.getElementById('liveLanguage') as HTMLSelectElement | null;
  const modeSel = document.getElementById('liveMode') as HTMLSelectElement | null;
  const voiceSel = document.getElementById('liveVoice') as HTMLSelectElement | null;
  const micModeSel = document.getElementById('liveMicMode') as HTMLSelectElement | null;
  const deepChk = document.getElementById('liveDeepThinking') as HTMLInputElement | null;
  const quietSrChk = document.getElementById('liveQuietScreenReader') as HTMLInputElement | null;
  const useBookChk = document.getElementById('liveUseLoadedBook') as HTMLInputElement | null;
  const loadedBookLabel = document.getElementById('liveLoadedBookLabel');

  const startBtn = document.getElementById('liveStartBtn') as HTMLButtonElement | null;
  const endBtn = document.getElementById('liveEndBtn') as HTMLButtonElement | null;
  const connStatusEl = document.getElementById('liveConnStatus');
  const errEl = document.getElementById('liveErr');

  const micBtn = document.getElementById('liveMicBtn') as HTMLButtonElement | null;
  const interruptBtn = document.getElementById('liveInterruptBtn') as HTMLButtonElement | null;
  const textPromptEl = document.getElementById('liveTextPrompt') as HTMLTextAreaElement | null;
  const sendTextBtn = document.getElementById('liveSendTextBtn') as HTMLButtonElement | null;
  const reqNotesBtn = document.getElementById('liveRequestNotesBtn') as HTMLButtonElement | null;

  const camToggleBtn = document.getElementById('liveCamToggleBtn') as HTMLButtonElement | null;
  const camCaptureBtn = document.getElementById('liveCamCaptureBtn') as HTMLButtonElement | null;
  const autoCamWrap = document.getElementById('liveAutoCamWrap');
  const autoCamChk = document.getElementById('liveAutoCam') as HTMLInputElement | null;
  const camVideo = document.getElementById('liveCameraPreview') as HTMLVideoElement | null;
  const camCanvas = document.getElementById('liveCameraCanvas') as HTMLCanvasElement | null;

  const clearLogBtn = document.getElementById('liveClearLogBtn') as HTMLButtonElement | null;
  const transcriptLogEl = document.getElementById('liveTranscriptLog');
  const notesBoxEl = document.getElementById('liveNotesBox');
  const notesTitleEl = document.getElementById('liveNotesTitle');
  const notesBodyEl = document.getElementById('liveNotesBody');
  const sendToStudioBtn = document.getElementById('liveSendToStudioBtn') as HTMLButtonElement | null;

  let destroyed = false;
  let ws: WebSocket | null = null;
  let sessionReady = false;
  let connecting = false;
  let micTransmitting = false;

  let inputCtx: AudioContext | null = null;
  let outputCtx: AudioContext | null = null;
  let micStream: MediaStream | null = null;
  let workletNode: AudioWorkletNode | null = null;
  let fallbackProc: ScriptProcessorNode | null = null;
  let micSource: MediaStreamAudioSourceNode | null = null;
  let nextPlayTime = 0;
  const activeBuffers = new Set<AudioBufferSourceNode>();

  let camStream: MediaStream | null = null;
  let camInterval: ReturnType<typeof setInterval> | null = null;

  let currentTurnRole: 'student' | 'teacher' | null = null;
  let currentTurnEl: HTMLElement | null = null;
  let latestNotesTitle = 'Live Teacher Lesson Notes';
  let latestNotesText = '';
  let quotaState: QuotaStateView = {
    usedSeconds: 0,
    limitSeconds: 600,
    remainingSeconds: 600,
    unlimited: hooks.isByokActive(),
  };

  const setErr = (msg: string) => {
    if (errEl) errEl.textContent = msg;
  };
  const setStatus = (msg: string) => {
    if (connStatusEl) connStatusEl.textContent = msg;
  };

  const renderQuota = () => {
    const unlimited = hooks.isByokActive() || quotaState.unlimited;
    if (unlimited) {
      if (quotaTextEl) {
        quotaTextEl.textContent =
          'Unlimited Mode active — using your own Gemini API key saved in Speech Studio.';
      }
      if (timerClockEl) timerClockEl.textContent = 'UNLIMITED';
      if (meterFillEl) meterFillEl.style.width = '100%';
      return;
    }
    const rem = Math.max(0, quotaState.remainingSeconds);
    const lim = Math.max(1, quotaState.limitSeconds || 600);
    const pct = Math.max(0, Math.min(100, Math.round((rem / lim) * 100)));
    if (quotaTextEl) {
      quotaTextEl.textContent = `Free daily live tutoring: ${formatMmSs(rem)} remaining today (out of ${formatMmSs(lim)}). Save your own Gemini key in Speech Studio for unlimited access.`;
    }
    if (timerClockEl) timerClockEl.textContent = formatMmSs(rem);
    if (meterFillEl) meterFillEl.style.width = `${pct}%`;
  };

  const loadedExcerpt = hooks.getLoadedTextExcerpt();
  if (loadedBookLabel) {
    loadedBookLabel.textContent = loadedExcerpt
      ? `Include loaded Speech Studio book/chapter text (${loadedExcerpt.length.toLocaleString()} chars ready)`
      : 'Include loaded Speech Studio book/chapter text (no file loaded in Speech Studio yet)';
  }
  if (useBookChk) {
    useBookChk.disabled = !loadedExcerpt;
    if (loadedExcerpt) useBookChk.checked = true;
  }

  const syncAriaLiveSafety = () => {
    if (!transcriptLogEl) return;
    transcriptLogEl.setAttribute('aria-live', quietSrChk?.checked ? 'off' : 'polite');
  };
  syncAriaLiveSafety();
  quietSrChk?.addEventListener('change', syncAriaLiveSafety);

  const syncGradeThinkingDefault = () => {
    if (!gradeSel || !deepChk) return;
    const g = gradeSel.value;
    if (g === 'bs_honours' || g === 'ms_mphil' || g === 'phd_research') {
      deepChk.checked = true;
    }
  };
  gradeSel?.addEventListener('change', syncGradeThinkingDefault);

  const appendTranscript = (role: 'student' | 'teacher' | 'system', chunk: string, appendToTurn = false) => {
    if (!transcriptLogEl || !chunk) return;
    if (transcriptLogEl.querySelector('p.hint')) {
      transcriptLogEl.innerHTML = '';
    }
    if (appendToTurn && role !== 'system' && currentTurnRole === role && currentTurnEl) {
      const textSpan = currentTurnEl.querySelector('.live-turn-text');
      if (textSpan) {
        textSpan.textContent = `${textSpan.textContent || ''}${chunk}`;
        transcriptLogEl.scrollTop = transcriptLogEl.scrollHeight;
        return;
      }
    }
    const row = document.createElement('div');
    row.className = `live-turn live-turn-${role}`;
    const label = document.createElement('strong');
    label.textContent = role === 'student' ? 'You: ' : role === 'teacher' ? 'Ustad AI: ' : 'Session: ';
    const span = document.createElement('span');
    span.className = 'live-turn-text';
    span.setAttribute('dir', 'auto');
    span.textContent = chunk;
    row.appendChild(label);
    row.appendChild(span);
    transcriptLogEl.appendChild(row);
    transcriptLogEl.scrollTop = transcriptLogEl.scrollHeight;
    if (role !== 'system') {
      currentTurnRole = role;
      currentTurnEl = row;
    }
  };

  const stopPlaybackQueue = () => {
    for (const src of activeBuffers) {
      try {
        src.stop();
        src.disconnect();
      } catch {
        // Ignore stopped buffer
      }
    }
    activeBuffers.clear();
    if (outputCtx) {
      nextPlayTime = outputCtx.currentTime;
    }
  };

  const play24kPcmChunk = async (b64: string) => {
    if (!outputCtx) {
      outputCtx = new AudioContext({ sampleRate: 24000 });
      nextPlayTime = outputCtx.currentTime;
    }
    if (outputCtx.state === 'suspended') {
      await outputCtx.resume().catch(() => {});
    }
    const floatSamples = pcm24kBytesToFloat32(base64ToUint8(b64));
    if (!floatSamples.length) return;
    const buffer = outputCtx.createBuffer(1, floatSamples.length, 24000);
    buffer.getChannelData(0).set(floatSamples);

    const src = outputCtx.createBufferSource();
    src.buffer = buffer;
    src.connect(outputCtx.destination);
    const startAt = Math.max(outputCtx.currentTime + 0.015, nextPlayTime);
    nextPlayTime = startAt + buffer.duration;
    activeBuffers.add(src);
    src.onended = () => {
      activeBuffers.delete(src);
    };
    src.start(startAt);
  };

  const updateMicUi = () => {
    if (!micBtn) return;
    const mode = micModeSel?.value || 'tap';
    micBtn.disabled = !sessionReady;
    micBtn.setAttribute('aria-pressed', micTransmitting ? 'true' : 'false');
    if (!sessionReady) {
      micBtn.textContent = 'Start Live Class First';
      micBtn.classList.remove('is-listening');
      return;
    }
    micBtn.classList.toggle('is-listening', micTransmitting);
    if (mode === 'ptt') {
      micBtn.textContent = micTransmitting
        ? 'Listening… Release to Send (Space)'
        : 'Hold to Speak (Space or Press & Hold)';
    } else if (mode === 'continuous') {
      micBtn.textContent = micTransmitting
        ? 'Hands-Free Mic Active — Mute (Ctrl+M)'
        : 'Hands-Free Muted — Unmute (Ctrl+M)';
    } else {
      micBtn.textContent = micTransmitting
        ? 'Listening… Tap to Pause Mic (Ctrl+M)'
        : 'Start Speaking (Tap Mic / Ctrl+M)';
    }
  };

  const syncStageButtons = () => {
    const setupDisabled = connecting || sessionReady;
    [gradeSel, subjectSel, langSel, modeSel, voiceSel, deepChk, useBookChk].forEach((el) => {
      if (el) el.disabled = setupDisabled;
    });
    if (startBtn) startBtn.hidden = sessionReady;
    if (startBtn) startBtn.disabled = connecting;
    if (endBtn) endBtn.hidden = !sessionReady && !connecting;
    if (interruptBtn) interruptBtn.disabled = !sessionReady;
    if (sendTextBtn) sendTextBtn.disabled = !sessionReady;
    if (reqNotesBtn) reqNotesBtn.disabled = !sessionReady;
    if (camToggleBtn) camToggleBtn.disabled = !sessionReady;
    if (camCaptureBtn) camCaptureBtn.disabled = !sessionReady || !camStream;
    updateMicUi();
  };

  const stopMicCapture = () => {
    micTransmitting = false;
    try {
      workletNode?.disconnect();
      fallbackProc?.disconnect();
      micSource?.disconnect();
    } catch {
      // Ignore
    }
    workletNode = null;
    fallbackProc = null;
    micSource = null;
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }
    if (inputCtx) {
      void inputCtx.close().catch(() => {});
      inputCtx = null;
    }
    updateMicUi();
  };

  const stopCamera = () => {
    if (camInterval) {
      clearInterval(camInterval);
      camInterval = null;
    }
    if (camStream) {
      camStream.getTracks().forEach((t) => t.stop());
      camStream = null;
    }
    if (camVideo) {
      camVideo.srcObject = null;
      camVideo.hidden = true;
    }
    if (camCaptureBtn) camCaptureBtn.hidden = true;
    if (autoCamWrap) autoCamWrap.hidden = true;
    if (autoCamChk) autoCamChk.checked = false;
    if (camToggleBtn) {
      camToggleBtn.setAttribute('aria-pressed', 'false');
      camToggleBtn.textContent = 'Turn Camera On (Scan Printed Book Page)';
    }
    syncStageButtons();
  };

  const captureAndSendCameraFrame = (askTeacherToRead: boolean) => {
    if (!sessionReady || !ws || ws.readyState !== WebSocket.OPEN || !camVideo || !camCanvas) return;
    const w = camVideo.videoWidth || 640;
    const h = camVideo.videoHeight || 480;
    if (!w || !h) return;
    const maxW = 960;
    const scale = Math.min(1, maxW / w);
    camCanvas.width = Math.round(w * scale);
    camCanvas.height = Math.round(h * scale);
    const ctx = camCanvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(camVideo, 0, 0, camCanvas.width, camCanvas.height);
    const dataUrl = camCanvas.toDataURL('image/jpeg', 0.72);
    const b64 = dataUrl.split(',')[1] || '';
    if (!b64) return;
    ws.send(JSON.stringify({ type: 'video', data: b64 }));
    if (askTeacherToRead) {
      ws.send(
        JSON.stringify({
          type: 'text',
          text: 'Please examine the book page or paper image I just captured. Read the visible Urdu or English content aloud accurately and explain it clearly step by step.',
        })
      );
      appendTranscript('system', 'Sent camera page snapshot to Live AI Teacher.');
    }
  };

  const ensureMicPipeline = async (): Promise<boolean> => {
    if (micStream && inputCtx) return true;
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      inputCtx = new AudioContext({ sampleRate: 16000 });
      if (inputCtx.state === 'suspended') {
        await inputCtx.resume().catch(() => {});
      }
      micSource = inputCtx.createMediaStreamSource(micStream);

      const sendInt16Buffer = (buf: ArrayBuffer) => {
        if (!micTransmitting || !sessionReady || !ws || ws.readyState !== WebSocket.OPEN) return;
        const b64 = uint8ToBase64(new Uint8Array(buf));
        ws.send(JSON.stringify({ type: 'audio', data: b64 }));
      };

      if (inputCtx.audioWorklet) {
        try {
          await inputCtx.audioWorklet.addModule('/live-pcm-worklet.js');
          workletNode = new AudioWorkletNode(inputCtx, 'live-pcm-capture');
          workletNode.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
            if (ev.data) sendInt16Buffer(ev.data);
          };
          micSource.connect(workletNode);
          workletNode.connect(inputCtx.destination);
          return true;
        } catch {
          workletNode = null;
        }
      }

      const proc = inputCtx.createScriptProcessor(4096, 1, 1);
      const srcRate = inputCtx.sampleRate || 16000;
      const ratio = srcRate / 16000;
      proc.onaudioprocess = (ev) => {
        if (!micTransmitting) return;
        const ch = ev.inputBuffer.getChannelData(0);
        const outLen = Math.max(1, Math.floor(ch.length / ratio));
        const pcm = new Int16Array(outLen);
        for (let i = 0; i < outLen; i++) {
          const idx = Math.min(ch.length - 1, Math.floor(i * ratio));
          const s = Math.max(-1, Math.min(1, ch[idx]));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        sendInt16Buffer(pcm.buffer);
      };
      micSource.connect(proc);
      proc.connect(inputCtx.destination);
      fallbackProc = proc;
      return true;
    } catch (err) {
      setErr(
        err instanceof Error
          ? `Microphone permission error: ${err.message}`
          : 'Could not access microphone. Allow microphone access in browser settings or type your question below.'
      );
      stopMicCapture();
      return false;
    }
  };

  const setMicOpen = async (open: boolean) => {
    if (!sessionReady) return;
    if (open) {
      stopPlaybackQueue();
      const ready = await ensureMicPipeline();
      if (!ready) return;
      micTransmitting = true;
    } else {
      micTransmitting = false;
    }
    updateMicUi();
  };

  const endSession = (statusMsg = 'Class ended.') => {
    connecting = false;
    sessionReady = false;
    stopMicCapture();
    stopCamera();
    stopPlaybackQueue();
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'end' }));
        }
        ws.close(1000, 'Session ended');
      } catch {
        // Ignore
      }
      ws = null;
    }
    setStatus(statusMsg);
    syncStageButtons();
  };

  const refreshLiveQuota = async () => {
    if (hooks.isByokActive()) {
      quotaState.unlimited = true;
      renderQuota();
      return;
    }
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/live-quota', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        usedSeconds?: number;
        limitSeconds?: number;
        remainingSeconds?: number;
      };
      quotaState = {
        usedSeconds: Number(data.usedSeconds || 0),
        limitSeconds: Number(data.limitSeconds || 600),
        remainingSeconds: Number(data.remainingSeconds ?? 600),
        unlimited: false,
      };
      renderQuota();
    } catch {
      renderQuota();
    }
  };

  renderQuota();
  void refreshLiveQuota();

  const onStartClick = async () => {
    if (connecting || sessionReady) return;
    setErr('');
    if (!hooks.isByokActive() && quotaState.remainingSeconds <= 0) {
      setErr(
        'Your 10-minute daily free Live AI Teacher allowance is used up for today. Add your own Gemini API key in Speech Studio for unlimited access.'
      );
      return;
    }

    connecting = true;
    syncStageButtons();
    setStatus('Connecting securely to Live AI Teacher…');

    try {
      if (!outputCtx) {
        outputCtx = new AudioContext({ sampleRate: 24000 });
      }
      if (outputCtx.state === 'suspended') {
        await outputCtx.resume().catch(() => {});
      }

      const token = await user.getIdToken();
      const customWsUrl = hooks.getWsUrlOverride?.();
      const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = customWsUrl || `${wsProto}//${location.host}/api/live-teacher`;

      const socket = new WebSocket(wsUrl);
      ws = socket;

      socket.onopen = () => {
        if (destroyed) {
          socket.close();
          return;
        }
        const includeBook = Boolean(useBookChk?.checked && loadedExcerpt);
        socket.send(
          JSON.stringify({
            type: 'init',
            idToken: token,
            byokKey: hooks.isByokActive() ? hooks.getByokKey() : undefined,
            gradeLevel: gradeSel?.value || 'matric',
            subject: subjectSel?.value || 'All Subjects',
            languageMix: langSel?.value || 'urdu_english_mix',
            teachingMode: modeSel?.value || 'tutor',
            voice: voiceSel?.value || 'Kore',
            deepThinking: Boolean(deepChk?.checked),
            bookContext: includeBook ? loadedExcerpt.slice(0, 8000) : '',
          })
        );
      };

      socket.onmessage = (ev) => {
        if (destroyed) return;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(String(ev.data)) as Record<string, unknown>;
        } catch {
          return;
        }

        if (msg.type === 'ready') {
          connecting = false;
          sessionReady = true;
          setStatus(
            `Live Class connected (${String(msg.voice || 'Kore')}). Tap Mic or hold Space to speak, or type below.`
          );
          appendTranscript('system', 'Live AI Teacher connected. Assalam-o-Alaikum!');
          syncStageButtons();
          if (micModeSel?.value === 'continuous') {
            void setMicOpen(true);
          }
          return;
        }

        if (msg.type === 'audio' && typeof msg.data === 'string') {
          void play24kPcmChunk(msg.data);
          return;
        }

        if (msg.type === 'input_transcript' && typeof msg.text === 'string') {
          appendTranscript('student', msg.text, true);
          return;
        }

        if (msg.type === 'output_transcript' && typeof msg.text === 'string') {
          appendTranscript('teacher', msg.text, true);
          return;
        }

        if (msg.type === 'interrupted') {
          stopPlaybackQueue();
          currentTurnRole = null;
          currentTurnEl = null;
          return;
        }

        if (msg.type === 'turn_complete') {
          currentTurnRole = null;
          currentTurnEl = null;
          return;
        }

        if (msg.type === 'status') {
          if (msg.busy) setStatus('Ustad AI is thinking and organizing steps…');
          else if (sessionReady) setStatus('Live Class active. Speak or type whenever ready.');
          return;
        }

        if (msg.type === 'quota') {
          quotaState = {
            usedSeconds: Number(msg.usedSeconds || 0),
            limitSeconds: Number(msg.limitSeconds || 600),
            remainingSeconds: Number(msg.remainingSeconds ?? 600),
            unlimited: Boolean(msg.unlimited),
          };
          renderQuota();
          return;
        }

        if (msg.type === 'lesson_notes' && typeof msg.notesText === 'string') {
          latestNotesTitle = String(msg.title || 'Live Teacher Notes');
          latestNotesText = msg.notesText;
          if (notesBoxEl && notesTitleEl && notesBodyEl) {
            notesTitleEl.textContent = latestNotesTitle;
            notesBodyEl.textContent = latestNotesText;
            notesBoxEl.hidden = false;
          }
          appendTranscript('system', `Prepared revision notes: "${latestNotesTitle}".`);
          return;
        }

        if (msg.type === 'quiz_feedback') {
          const ok = msg.correct ? 'Correct' : 'Needs review';
          appendTranscript('system', `Viva check (${String(msg.topic || 'Question')} — ${ok}): ${String(msg.summary || '')}`);
          return;
        }

        if (msg.type === 'error') {
          const errText = String(msg.message || 'Live teacher error.');
          setErr(errText);
          if (msg.code === 'LIVE_QUOTA_EXCEEDED' || msg.code === 'AUTH_REQUIRED' || msg.code === 'NO_API_KEY') {
            endSession('Class stopped.');
          }
          return;
        }

        if (msg.type === 'session_closed') {
          if (sessionReady || connecting) {
            endSession(String(msg.reason || 'Live class ended.'));
          }
        }
      };

      socket.onerror = () => {
        if (destroyed) return;
        setErr('WebSocket connection error while talking to Live AI Teacher.');
        endSession('Connection lost.');
      };

      socket.onclose = () => {
        if (destroyed) return;
        if (sessionReady || connecting) {
          endSession('Live class disconnected.');
        }
      };
    } catch (err) {
      setErr(err instanceof Error ? err.message : 'Could not initialize Live AI Teacher.');
      endSession('Connection failed.');
    }
  };

  startBtn?.addEventListener('click', onStartClick);
  endBtn?.addEventListener('click', () => endSession('Class ended by student.'));

  micModeSel?.addEventListener('change', () => {
    if (!sessionReady) {
      updateMicUi();
      return;
    }
    if (micModeSel.value === 'continuous') {
      void setMicOpen(true);
    } else {
      void setMicOpen(false);
    }
  });

  if (micBtn) {
    micBtn.addEventListener('click', () => {
      if (!sessionReady) return;
      const mode = micModeSel?.value || 'tap';
      if (mode === 'ptt') return;
      void setMicOpen(!micTransmitting);
    });

    micBtn.addEventListener('pointerdown', () => {
      if (!sessionReady || micModeSel?.value !== 'ptt') return;
      void setMicOpen(true);
    });
    const releasePtt = () => {
      if (micModeSel?.value === 'ptt' && micTransmitting) {
        void setMicOpen(false);
      }
    };
    micBtn.addEventListener('pointerup', releasePtt);
    micBtn.addEventListener('pointercancel', releasePtt);
    micBtn.addEventListener('keydown', (e) => {
      if (!sessionReady || micModeSel?.value !== 'ptt') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!micTransmitting) void setMicOpen(true);
      }
    });
    micBtn.addEventListener('keyup', (e) => {
      if (micModeSel?.value === 'ptt' && e.code === 'Space') {
        e.preventDefault();
        void setMicOpen(false);
      }
    });
  }

  interruptBtn?.addEventListener('click', () => {
    stopPlaybackQueue();
    setStatus('Teacher speech interrupted. Speak or type your follow-up.');
  });

  sendTextBtn?.addEventListener('click', () => {
    if (!sessionReady || !ws || ws.readyState !== WebSocket.OPEN || !textPromptEl) return;
    const text = textPromptEl.value.trim();
    if (!text) return;
    stopPlaybackQueue();
    ws.send(JSON.stringify({ type: 'text', text }));
    appendTranscript('student', text);
    textPromptEl.value = '';
  });

  reqNotesBtn?.addEventListener('click', () => {
    if (!sessionReady || !ws || ws.readyState !== WebSocket.OPEN) return;
    stopPlaybackQueue();
    ws.send(
      JSON.stringify({
        type: 'text',
        text: 'Please call the send_notes_to_speech_studio tool now with clean plain-text revision notes, key definitions, and 3 practice questions for what we just studied.',
      })
    );
    setStatus('Asking teacher to prepare downloadable MP3 notes…');
  });

  camToggleBtn?.addEventListener('click', async () => {
    if (!sessionReady) return;
    if (camStream) {
      stopCamera();
      return;
    }
    try {
      camStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (camVideo) {
        camVideo.srcObject = camStream;
        camVideo.hidden = false;
      }
      if (camCaptureBtn) camCaptureBtn.hidden = false;
      if (autoCamWrap) autoCamWrap.hidden = false;
      if (camToggleBtn) {
        camToggleBtn.setAttribute('aria-pressed', 'true');
        camToggleBtn.textContent = 'Turn Camera Off';
      }
      syncStageButtons();
    } catch (err) {
      setErr(err instanceof Error ? `Camera unavailable: ${err.message}` : 'Could not open camera.');
    }
  });

  camCaptureBtn?.addEventListener('click', () => captureAndSendCameraFrame(true));

  autoCamChk?.addEventListener('change', () => {
    if (camInterval) {
      clearInterval(camInterval);
      camInterval = null;
    }
    if (autoCamChk.checked && camStream && sessionReady) {
      camInterval = setInterval(() => captureAndSendCameraFrame(false), 1000);
    }
  });

  clearLogBtn?.addEventListener('click', () => {
    if (transcriptLogEl) {
      transcriptLogEl.innerHTML = '<p class="hint">Transcript cleared.</p>';
    }
    currentTurnRole = null;
    currentTurnEl = null;
  });

  sendToStudioBtn?.addEventListener('click', () => {
    if (!latestNotesText.trim()) return;
    hooks.sendLessonNotesToSpeechStudio(latestNotesTitle, latestNotesText);
  });

  const onKeyDown = (e: KeyboardEvent) => {
    if (!sessionReady) return;
    if (e.ctrlKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      if (micModeSel?.value === 'tap' || micModeSel?.value === 'continuous') {
        void setMicOpen(!micTransmitting);
      }
    } else if (e.key === 'Escape') {
      const drawersClosed =
        document.getElementById('navDrawer')?.hidden !== false &&
        document.getElementById('a11yDrawer')?.hidden !== false &&
        document.getElementById('exportModal')?.hidden !== false;
      if (drawersClosed) {
        stopPlaybackQueue();
        if (micTransmitting && micModeSel?.value !== 'continuous') {
          void setMicOpen(false);
        }
      }
    }
  };
  document.addEventListener('keydown', onKeyDown);

  activeController = {
    destroy: () => {
      destroyed = true;
      document.removeEventListener('keydown', onKeyDown);
      endSession('Left Live Teacher page.');
    },
  };
}
