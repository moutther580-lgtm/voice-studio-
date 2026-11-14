export type AudioFormat = 'mp3' | 'wav';

export type GenerationMode = 'single' | 'dialogue';

export interface VoiceConfig {
  model: string;
  voice: string;
  voiceB: string;
  mode: GenerationMode;
  style: string;
  chunk: number;
  pause: number;
  sil: number;
  format: AudioFormat;
  mp3Kbps: number;
  cleanDocs: boolean;
  speed: number;
}

export interface PronunciationRule {
  id: string;
  find: string;
  replace: string;
  wholeWord: boolean;
  enabled: boolean;
}

export interface KeyState {
  key: string;
  cool: number;
  dead: boolean;
}

export interface SpeechItem {
  text: string;
  voice: string;
}

export interface GenerationJob {
  items: SpeechItem[];
  done: number;
  parts: Uint8Array[];
  rate: number;
  model: string;
  style: string;
  pause: number;
  sil: number;
  format: AudioFormat;
  mp3Kbps: number;
}

export interface ApiClassification {
  kind: 'day' | 'minute' | 'badkey' | 'model' | 'bad' | 'server' | 'other' | 'abort' | 'network' | 'noaudio';
  wait?: number;
  msg?: string;
}

export interface InlineAudioData {
  data: string;
  mimeType?: string;
}

export interface DocExtractResult {
  text: string;
  pages?: number;
  chapters?: number;
  removedLines?: number;
  formatLabel: string;
}

export interface QuotaState {
  uid: string;
  email: string;
  dailyLimit: number;
  dailyUsedChars: number;
  remainingDaily: number;
  paidCredits: number;
  totalCharsUsed: number;
  plan: 'free' | 'pro';
  globalRemaining?: number;
  backendConfigured?: boolean;
}
