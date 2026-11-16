import type { SubtitleSegment } from './types';

export type VideoAspect = '16:9' | '9:16' | '1:1';

function getCanvasSize(aspect: VideoAspect): { width: number; height: number } {
  if (aspect === '9:16') return { width: 720, height: 1280 };
  if (aspect === '1:1') return { width: 720, height: 720 };
  return { width: 1280, height: 720 };
}

function pickSupportedRecorderMime(): { mimeType: string; ext: 'mp4' | 'webm' } {
  const candidates: Array<{ mime: string; ext: 'mp4' | 'webm' }> = [
    { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c.mime)) {
      return { mimeType: c.mime, ext: c.ext };
    }
  }
  return { mimeType: '', ext: 'webm' };
}

function findActiveCaption(segments: SubtitleSegment[], sec: number): string {
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (sec >= seg.startSec && sec <= seg.endSec + 0.08) {
      return seg.text;
    }
  }
  return '';
}

function wrapCaptionLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number
): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(candidate).width <= maxWidth) {
      cur = candidate;
    } else {
      if (cur) lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  return lines;
}

function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

export async function renderSubtitleVideoBlob(opts: {
  audioBlob: Blob;
  title: string;
  segments: SubtitleSegment[];
  aspect: VideoAspect;
  signal?: AbortSignal;
  onProgress?: (pct: number) => void;
}): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('This browser does not support client-side video recording.');
  }

  const { width, height } = getCanvasSize(opts.aspect);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not initialize 2D video canvas.');

  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) throw new Error('Web Audio API is unavailable in this browser.');

  const audioCtx = new AudioCtx();
  let audioStreamDest: MediaStreamAudioDestinationNode | null = null;
  let source: AudioBufferSourceNode | null = null;
  let canvasStream: MediaStream | null = null;
  let timerId = 0;

  try {
    const rawBuf = await opts.audioBlob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(rawBuf);
    const durationSec = Math.max(0.5, audioBuffer.duration);

    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }

    audioStreamDest = audioCtx.createMediaStreamDestination();
    source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioStreamDest);

    canvasStream = canvas.captureStream(24);
    const combinedTracks: MediaStreamTrack[] = [
      ...canvasStream.getVideoTracks(),
      ...audioStreamDest.stream.getAudioTracks(),
    ];
    const combinedStream = new MediaStream(combinedTracks);

    const format = pickSupportedRecorderMime();
    const recorderOpts: MediaRecorderOptions = {
      videoBitsPerSecond: 1_800_000,
      audioBitsPerSecond: 96_000,
    };
    if (format.mimeType) recorderOpts.mimeType = format.mimeType;

    const recorder = new MediaRecorder(combinedStream, recorderOpts);
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };

    const cleanTitle = (opts.title || 'Voice Studio Narration').trim().slice(0, 72);
    const fontSize = opts.aspect === '16:9' ? 36 : 32;
    const lineHeight = Math.round(fontSize * 1.42);
    const padX = Math.round(width * 0.08);
    const maxCaptionWidth = width - padX * 2;
    const maxLines = opts.aspect === '9:16' ? 5 : 4;

    const drawFrame = (elapsedSec: number) => {
      const clamped = Math.min(durationSec, Math.max(0, elapsedSec));
      const pct = Math.min(1, clamped / durationSec);

      // Rich high-contrast studio background
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, '#0b1220');
      grad.addColorStop(0.55, '#13223b');
      grad.addColorStop(1, '#09101d');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // Top brand & title bar
      ctx.textBaseline = 'top';
      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#8ab4f8';
      ctx.font = `700 ${opts.aspect === '9:16' ? 22 : 20}px system-ui, -apple-system, sans-serif`;
      ctx.fillText('VOICE STUDIO', padX, 42);

      const isRtlTitle = /[\u0600-\u06FF\u0750-\u077F]/.test(cleanTitle);
      ctx.direction = isRtlTitle ? 'rtl' : 'ltr';
      ctx.textAlign = isRtlTitle ? 'right' : 'left';
      ctx.fillStyle = '#f8fafc';
      ctx.font = `700 ${opts.aspect === '9:16' ? 30 : 28}px system-ui, -apple-system, sans-serif`;
      ctx.fillText(cleanTitle, isRtlTitle ? width - padX : padX, 76, maxCaptionWidth);

      // Center caption card
      const activeText = findActiveCaption(opts.segments, clamped);
      if (activeText) {
        const isRtl = /[\u0600-\u06FF\u0750-\u077F]/.test(activeText);
        ctx.font = `600 ${fontSize}px system-ui, -apple-system, 'Noto Nastaliq Urdu', sans-serif`;
        const lines = wrapCaptionLines(ctx, activeText, maxCaptionWidth - 48, maxLines);
        const boxHeight = lines.length * lineHeight + 44;
        const boxY =
          opts.aspect === '9:16'
            ? Math.round(height * 0.44 - boxHeight / 2)
            : Math.round(height * 0.56 - boxHeight / 2);

        ctx.fillStyle = 'rgba(10, 16, 30, 0.86)';
        ctx.strokeStyle = 'rgba(138, 180, 248, 0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(padX, boxY, maxCaptionWidth, boxHeight, 16);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.direction = isRtl ? 'rtl' : 'ltr';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        lines.forEach((line, idx) => {
          const y = boxY + 24 + lineHeight * idx + lineHeight / 2;
          ctx.fillText(line, width / 2, y, maxCaptionWidth - 40);
        });
      }

      // Bottom timecode & steady progress bar (no rapid flashing)
      const barY = height - 68;
      const barW = maxCaptionWidth;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.beginPath();
      ctx.roundRect(padX, barY, barW, 8, 4);
      ctx.fill();

      ctx.fillStyle = '#8ab4f8';
      ctx.beginPath();
      ctx.roundRect(padX, barY, Math.max(8, barW * pct), 8, 4);
      ctx.fill();

      ctx.direction = 'ltr';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#cbd5e1';
      ctx.font = '600 18px system-ui, -apple-system, sans-serif';
      ctx.fillText(`${formatClock(clamped)} / ${formatClock(durationSec)}`, padX, barY + 18);
    };

    const donePromise = new Promise<Blob>((resolve, reject) => {
      let settled = false;
      const finish = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (timerId) window.clearInterval(timerId);
        if (err) reject(err);
        else resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
      };

      recorder.onerror = () => finish(new Error('Video recording failed in this browser.'));
      recorder.onstop = () => {
        if (opts.signal?.aborted) finish(new Error('Video render cancelled.'));
        else finish();
      };

      const onAbort = () => {
        try {
          source?.stop();
        } catch {
          // Ignore
        }
        try {
          if (recorder.state !== 'inactive') recorder.stop();
        } catch {
          // Ignore
        }
      };

      if (opts.signal) {
        if (opts.signal.aborted) {
          onAbort();
          return;
        }
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }

      drawFrame(0);
      recorder.start(250);
      const startCtxTime = audioCtx.currentTime;
      source!.start(startCtxTime);

      source!.onended = () => {
        drawFrame(durationSec);
        opts.onProgress?.(100);
        window.setTimeout(() => {
          try {
            if (recorder.state !== 'inactive') recorder.stop();
          } catch {
            finish();
          }
        }, 120);
      };

      timerId = window.setInterval(() => {
        const elapsed = audioCtx.currentTime - startCtxTime;
        drawFrame(elapsed);
        opts.onProgress?.(Math.min(99, Math.floor((elapsed / durationSec) * 100)));
      }, 42);
    });

    const blob = await donePromise;
    return { blob, ext: format.ext };
  } finally {
    if (timerId) window.clearInterval(timerId);
    try {
      source?.disconnect();
    } catch {
      // Ignore
    }
    canvasStream?.getTracks().forEach((t) => t.stop());
    audioStreamDest?.stream.getTracks().forEach((t) => t.stop());
    await audioCtx.close().catch(() => {});
  }
}
