import { Mp3Encoder } from '@breezystack/lamejs';
import type {
  ApiClassification,
  InlineAudioData,
  KeyState,
  PronunciationRule,
  SpeechItem,
} from './types';

export const MODELS = [
  { id: 'gemini-3.8-flash-tts', label: 'Gemini 3.8 Flash TTS (best quality)', ratePer1MAudioTokens: 9.0 },
  { id: 'gemini-3.8-flash-lite-tts', label: 'Gemini 3.8 Flash-Lite TTS (faster, lower cost)', ratePer1MAudioTokens: 6.0 },
  { id: 'gemini-3.1-flash-tts-preview', label: 'Gemini 3.1 Flash TTS (preview)', ratePer1MAudioTokens: 10.0 },
] as const;

export const VOICES =
  'Zephyr Puck Charon Kore Fenrir Leda Orus Aoede Callirrhoe Autonoe Enceladus Iapetus Umbriel Algieba Despina Erinome Algenib Rasalgethi Laomedeia Achernar Alnilam Schedar Gacrux Pulcherrima Achird Zubenelgenubi Vindemiatrix Sadachbia Sadaltager Sulafat'.split(
    ' '
  );

const SENT = /[\s\S]*?[.!?۔؟]+["'”)]*(?=\s|$)\s*|[\s\S]+$/g;

export function chunks(text: string, max: number): string[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const out: string[] = [];
  let cur = '';

  const flush = () => {
    const c = cur.trim();
    if (/[\p{L}\p{N}]/u.test(c)) out.push(c);
    cur = '';
  };

  const words = (s: string): string[] => {
    const r: string[] = [];
    let c = '';
    for (const w of s.split(/\s+/)) {
      if (!w) continue;
      if (w.length > max) {
        if (c) {
          r.push(c);
          c = '';
        }
        for (let i = 0; i < w.length; i += max) {
          r.push(w.slice(i, i + max));
        }
        continue;
      }
      if (c && c.length + 1 + w.length > max) {
        r.push(c);
        c = w;
      } else {
        c = c ? `${c} ${w}` : w;
      }
    }
    if (c) r.push(c);
    return r;
  };

  for (const para of normalized.split('\n')) {
    const p = para.trim();
    if (!p) continue;
    if (p.length > max) {
      flush();
      const pcs: string[] = [];
      let c = '';
      for (let s of p.match(SENT) || [p]) {
        s = s.trim();
        if (!s) continue;
        if (s.length > max) {
          if (c) {
            pcs.push(c);
            c = '';
          }
          pcs.push(...words(s));
          continue;
        }
        if (c && c.length + 1 + s.length > max) {
          pcs.push(c);
          c = s;
        } else {
          c = c ? `${c} ${s}` : s;
        }
      }
      if (c) pcs.push(c);
      out.push(...pcs.slice(0, -1));
      cur = pcs[pcs.length - 1] || '';
    } else if (cur && cur.length + 1 + p.length <= max) {
      cur += `\n${p}`;
    } else {
      flush();
      cur = p;
    }
  }
  flush();
  return out;
}

const SPEAKER_A_RE = /^(?:a|speaker\s*1|speaker\s*a|host|teacher|narrator)\s*:\s*(.+)$/i;
const SPEAKER_B_RE = /^(?:b|speaker\s*2|speaker\s*b|guest|student|co-?host)\s*:\s*(.+)$/i;

export function buildDialogueItems(
  text: string,
  max: number,
  voiceA: string,
  voiceB: string
): SpeechItem[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const turns: { voice: string; lines: string[] }[] = [];
  let activeVoice = voiceA;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    let spoken = line;
    const matchA = line.match(SPEAKER_A_RE);
    const matchB = line.match(SPEAKER_B_RE);
    if (matchA) {
      activeVoice = voiceA;
      spoken = matchA[1].trim();
    } else if (matchB) {
      activeVoice = voiceB;
      spoken = matchB[1].trim();
    }

    if (!/[\p{L}\p{N}]/u.test(spoken)) continue;

    const last = turns[turns.length - 1];
    if (last && last.voice === activeVoice) {
      last.lines.push(spoken);
    } else {
      turns.push({ voice: activeVoice, lines: [spoken] });
    }
  }

  const items: SpeechItem[] = [];
  for (const turn of turns) {
    const subChunks = chunks(turn.lines.join('\n'), max);
    for (const c of subChunks) {
      items.push({ text: c, voice: turn.voice });
    }
  }
  return items;
}

export function applyDictionary(text: string, rules: PronunciationRule[]): string {
  let out = text;
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const find = rule.find.trim();
    if (!find) continue;
    const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startsAsciiWord = /^[A-Za-z0-9_]/.test(find);
    const endsAsciiWord = /[A-Za-z0-9_]$/.test(find);
    const pattern =
      rule.wholeWord && startsAsciiWord && endsAsciiWord
        ? `\\b${escaped}\\b`
        : rule.wholeWord
          ? `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`
          : escaped;
    try {
      const re = new RegExp(pattern, 'giu');
      out = out.replace(re, () => rule.replace);
    } catch {
      // Skip malformed regex if browser lacks lookbehind support
      out = out.split(find).join(rule.replace);
    }
  }
  return out;
}

export function newer(model: string): boolean {
  const m = String(model).match(/gemini-(\d+)\.(\d+)/);
  return !!m && (+m[1] > 3 || (+m[1] === 3 && +m[2] >= 8));
}

export function buildBody(model: string, voice: string, style: string, text: string) {
  const cleanStyle = (style || '').trim();
  const generationConfig: Record<string, unknown> = { responseModalities: ['AUDIO'] };
  let parts: Record<string, unknown>[];

  if (newer(model)) {
    const p: Record<string, unknown> = { text };
    if (cleanStyle) p.speech_metadata = { style: cleanStyle };
    parts = [p];
    generationConfig.speechConfig = { voiceConfig: { voice } };
  } else {
    parts = [{ text: cleanStyle ? `Say ${cleanStyle}:\n${text}` : text }];
    generationConfig.speechConfig = { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } };
  }
  return { contents: [{ role: 'user', parts }], generationConfig };
}

export function classify(status: number, bodyText: string): ApiClassification {
  if (status === 429) {
    const m = bodyText.match(/"retryDelay"\s*:\s*"(\d+)/);
    return {
      kind: /per ?day/i.test(bodyText) ? 'day' : 'minute',
      wait: m ? +m[1] + 2 : 40,
    };
  }
  if (
    status === 401 ||
    status === 403 ||
    (status === 400 && /API_KEY_INVALID|API key not valid|API key expired/i.test(bodyText))
  ) {
    return { kind: 'badkey' };
  }
  if (status === 404) return { kind: 'model' };
  if (status === 400) return { kind: 'bad' };
  if (status >= 500) return { kind: 'server' };
  return { kind: 'other' };
}

export function pickKey(ks: KeyState[], start: number, now: number): { i: number; wait?: number | null } {
  let min: number | null = null;
  for (let i = 0; i < ks.length; i++) {
    const j = (start + i) % ks.length;
    const k = ks[j];
    if (k.dead) continue;
    if (k.cool <= now) return { i: j };
    if (min === null || k.cool < min) min = k.cool;
  }
  return { i: -1, wait: min === null ? null : min - now };
}

export function parseAudio(u8: Uint8Array, mime?: string): { pcm: Uint8Array; rate: number } {
  let rate = 0;
  let ch = 1;
  let pcm = u8;
  const id4 = (o: number) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);

  if (u8.length > 44 && id4(0) === 'RIFF') {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let o = 12;
    let found = false;
    while (o + 8 <= u8.length) {
      const id = id4(o);
      const sz = dv.getUint32(o + 4, true);
      if (id === 'fmt ' && o + 24 <= u8.length) {
        ch = dv.getUint16(o + 10, true) || 1;
        rate = dv.getUint32(o + 12, true);
      }
      if (id === 'data') {
        const st = o + 8;
        const end = sz === 0 || sz === 0xffffffff || st + sz > u8.length ? u8.length : st + sz;
        pcm = u8.subarray(st, end);
        found = true;
        break;
      }
      o += 8 + sz + (sz & 1);
    }
    if (!found) pcm = u8.subarray(44);
  }

  if (rate < 8000 || rate > 48000) {
    const m = /rate=(\d+)/.exec(mime || '');
    rate = m ? +m[1] : 24000;
  }

  pcm = pcm.subarray(0, pcm.length - (pcm.length % (ch * 2)));
  if (ch === 2) {
    const n = pcm.length >> 2;
    const out = new Uint8Array(n * 2);
    const a = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const b = new DataView(out.buffer);
    for (let i = 0; i < n; i++) {
      b.setInt16(i * 2, (a.getInt16(i * 4, true) + a.getInt16(i * 4 + 2, true)) >> 1, true);
    }
    pcm = out;
  }
  return { pcm, rate };
}

export function fade(p: Uint8Array, rate: number): Uint8Array {
  const out = p.slice();
  const dv = new DataView(out.buffer);
  const n = out.length >> 1;
  const f = Math.min(Math.floor(rate * 0.008), n >> 1);
  for (let i = 0; i < f; i++) {
    const g = i / f;
    const j = n - 1 - i;
    dv.setInt16(i * 2, Math.round(dv.getInt16(i * 2, true) * g), true);
    dv.setInt16(j * 2, Math.round(dv.getInt16(j * 2, true) * g), true);
  }
  return out;
}

export function toPcm(d: InlineAudioData): { pcm: Uint8Array; rate: number } {
  const bin = atob(d.data);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const o = parseAudio(u, d.mimeType);
  return { pcm: fade(o.pcm, o.rate), rate: o.rate };
}

/** Memory-safe WAV assembly: avoids duplicating the entire PCM payload in a single ArrayBuffer. */
export function wavBlob(parts: Uint8Array[], rate: number, silMs: number): Blob {
  const silBytes = Math.floor((rate * silMs) / 1000) * 2;
  const sil = silBytes > 0 ? new Uint8Array(silBytes) : null;
  let totalBytes = 0;
  for (let i = 0; i < parts.length; i++) {
    totalBytes += parts[i].byteLength + (i && sil ? sil.byteLength : 0);
  }

  const header = new ArrayBuffer(44);
  const dv = new DataView(header);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) dv.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  dv.setUint32(4, 36 + totalBytes, true);
  writeStr(8, 'WAVEfmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  writeStr(36, 'data');
  dv.setUint32(40, totalBytes, true);

  const blobParts: BlobPart[] = [header];
  for (let i = 0; i < parts.length; i++) {
    if (i && sil) blobParts.push(sil as unknown as BlobPart);
    blobParts.push(parts[i] as unknown as BlobPart);
  }
  return new Blob(blobParts, { type: 'audio/wav' });
}

export function totalPcmDurationSeconds(parts: Uint8Array[], rate: number, silMs: number): number {
  const silBytes = Math.floor((rate * silMs) / 1000) * 2;
  let totalBytes = 0;
  for (let i = 0; i < parts.length; i++) {
    totalBytes += parts[i].byteLength + (i ? silBytes : 0);
  }
  return totalBytes / (rate * 2);
}

function uint8ToInt16(u8: Uint8Array): Int16Array {
  const samples = u8.byteLength >> 1;
  if (u8.byteOffset % 2 === 0) {
    return new Int16Array(u8.buffer, u8.byteOffset, samples);
  }
  const copy = u8.slice();
  return new Int16Array(copy.buffer, 0, samples);
}

/** Async chunked MP3 encoding so the UI and screen readers stay responsive even for 1+ hour audio. */
export async function encodeMp3Blob(
  parts: Uint8Array[],
  rate: number,
  silMs: number,
  kbps: number,
  onProgress?: (pct: number) => void
): Promise<Blob> {
  const encoder = new Mp3Encoder(1, rate, kbps);
  const mp3Data: BlobPart[] = [];
  const blockSize = 1152 * 16;
  const silSamples = Math.floor((rate * silMs) / 1000);
  const sil = silSamples > 0 ? new Int16Array(silSamples) : null;

  let totalSamples = 0;
  for (let i = 0; i < parts.length; i++) {
    totalSamples += (parts[i].byteLength >> 1) + (i && sil ? sil.length : 0);
  }

  let processedSamples = 0;
  let lastYield = performance.now();

  const encodeSlice = async (pcm16: Int16Array) => {
    for (let pos = 0; pos < pcm16.length; pos += blockSize) {
      const slice = pcm16.subarray(pos, Math.min(pos + blockSize, pcm16.length));
      const encoded = encoder.encodeBuffer(slice);
      if (encoded.length > 0) {
        mp3Data.push(new Uint8Array(encoded) as unknown as BlobPart);
      }
      processedSamples += slice.length;
      if (performance.now() - lastYield > 40) {
        if (onProgress && totalSamples > 0) {
          onProgress(Math.min(99, Math.floor((processedSamples * 100) / totalSamples)));
        }
        await new Promise((r) => setTimeout(r, 0));
        lastYield = performance.now();
      }
    }
  };

  for (let i = 0; i < parts.length; i++) {
    if (i && sil) {
      await encodeSlice(sil);
    }
    await encodeSlice(uint8ToInt16(parts[i]));
  }

  const tail = encoder.flush();
  if (tail.length > 0) {
    mp3Data.push(new Uint8Array(tail) as unknown as BlobPart);
  }
  onProgress?.(100);
  return new Blob(mp3Data, { type: 'audio/mpeg' });
}

export function safePreviewSlice(text: string, maxChars = 200): string {
  const trimmed = text.trim();
  const cps = [...trimmed];
  if (cps.length <= maxChars) return trimmed;
  const cut = cps.slice(0, maxChars).join('');
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > 120 ? cut.slice(0, lastSpace) : cut;
}

export function estimateStats(text: string, chunkSize: number, modelId: string) {
  const chars = [...text].length;
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  const estParts = chars ? Math.ceil(chars / chunkSize) : 0;
  const estMinutes = words / 150;
  const estSeconds = estMinutes * 60;
  const modelInfo = MODELS.find((m) => m.id === modelId) || MODELS[0];
  // ~28 audio tokens per second + ~1.3 tokens per word input
  const audioTokens = estSeconds * 28;
  const estCostUsd = (audioTokens / 1_000_000) * modelInfo.ratePer1MAudioTokens;
  return { chars, words, estParts, estMinutes, estCostUsd };
}
