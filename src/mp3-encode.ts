import { Mp3Encoder } from '@breezystack/lamejs';

function uint8ToInt16(u8: Uint8Array): Int16Array {
  const samples = u8.byteLength >> 1;
  if (u8.byteOffset % 2 === 0) {
    return new Int16Array(u8.buffer, u8.byteOffset, samples);
  }
  const copy = u8.slice();
  return new Int16Array(copy.buffer, 0, samples);
}

/** Async chunked MP3 encoding aligned strictly to 1152-sample MPEG frames so inter-part joins have zero clicks. */
export async function encodeMp3Blob(
  parts: Uint8Array[],
  rate: number,
  silMs: number,
  kbps: number,
  onProgress?: (pct: number) => void
): Promise<Blob> {
  const encoder = new Mp3Encoder(1, rate, kbps);
  const mp3Data: BlobPart[] = [];
  const frameSize = 1152;
  const batchSamples = frameSize * 16;
  const silSamples = Math.floor((rate * silMs) / 1000);
  const sil = silSamples > 0 ? new Int16Array(silSamples) : null;

  let totalSamples = 0;
  for (let i = 0; i < parts.length; i++) {
    totalSamples += (parts[i].byteLength >> 1) + (i && sil ? sil.length : 0);
  }

  let processedSamples = 0;
  let lastYield = performance.now();
  const ring = new Int16Array(batchSamples);
  let ringLen = 0;

  const flushRing = async (padFinalFrame: boolean) => {
    if (ringLen === 0) return;
    if (padFinalFrame && ringLen % frameSize !== 0) {
      const padded = Math.ceil(ringLen / frameSize) * frameSize;
      ring.fill(0, ringLen, padded);
      ringLen = padded;
    }
    const aligned = padFinalFrame ? ringLen : Math.floor(ringLen / frameSize) * frameSize;
    if (aligned > 0) {
      const encoded = encoder.encodeBuffer(ring.subarray(0, aligned));
      if (encoded.length > 0) {
        mp3Data.push(new Uint8Array(encoded) as unknown as BlobPart);
      }
      const rem = ringLen - aligned;
      if (rem > 0) {
        ring.copyWithin(0, aligned, ringLen);
      }
      ringLen = rem;
    }
    if (performance.now() - lastYield > 40) {
      if (onProgress && totalSamples > 0) {
        onProgress(Math.min(99, Math.floor((processedSamples * 100) / totalSamples)));
      }
      await new Promise((r) => setTimeout(r, 0));
      lastYield = performance.now();
    }
  };

  const pushPcm16 = async (pcm16: Int16Array) => {
    let pos = 0;
    while (pos < pcm16.length) {
      const space = batchSamples - ringLen;
      const take = Math.min(space, pcm16.length - pos);
      ring.set(pcm16.subarray(pos, pos + take), ringLen);
      ringLen += take;
      pos += take;
      processedSamples += take;
      if (ringLen >= batchSamples) {
        await flushRing(false);
      }
    }
  };

  for (let i = 0; i < parts.length; i++) {
    if (i && sil) {
      await pushPcm16(sil);
    }
    await pushPcm16(uint8ToInt16(parts[i]));
  }

  await flushRing(true);

  const tail = encoder.flush();
  if (tail.length > 0) {
    mp3Data.push(new Uint8Array(tail) as unknown as BlobPart);
  }
  onProgress?.(100);
  return new Blob(mp3Data, { type: 'audio/mpeg' });
}
