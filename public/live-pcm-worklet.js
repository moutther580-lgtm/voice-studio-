class LivePcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._targetRate = 16000;
    this._buffer = new Int16Array(2048);
    this._writeIdx = 0;
  }

  process(inputs) {
    const input = inputs && inputs[0] && inputs[0][0];
    if (!input || input.length === 0) return true;

    const srcRate = sampleRate || 16000;
    const ratio = srcRate / this._targetRate;

    if (Math.abs(ratio - 1) < 0.02) {
      for (let i = 0; i < input.length; i++) {
        this._pushSample(input[i]);
      }
    } else {
      const outLen = Math.max(1, Math.floor(input.length / ratio));
      for (let i = 0; i < outLen; i++) {
        const pos = i * ratio;
        const idx0 = Math.floor(pos);
        const idx1 = Math.min(input.length - 1, idx0 + 1);
        const frac = pos - idx0;
        const sample = input[idx0] * (1 - frac) + input[idx1] * frac;
        this._pushSample(sample);
      }
    }

    return true;
  }

  _pushSample(floatVal) {
    const clamped = Math.max(-1, Math.min(1, floatVal));
    this._buffer[this._writeIdx++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    if (this._writeIdx >= this._buffer.length) {
      const chunk = this._buffer.slice(0, this._writeIdx);
      this.port.postMessage(chunk.buffer, [chunk.buffer]);
      this._writeIdx = 0;
    }
  }
}

registerProcessor('live-pcm-capture', LivePcmCaptureProcessor);
