export type LiveGradeLevel =
  | 'primary'
  | 'middle'
  | 'matric'
  | 'fsc_alevel'
  | 'bs_honours'
  | 'ms_mphil'
  | 'phd_research';

export type LiveLanguageMix =
  | 'urdu_english_mix'
  | 'urdu_pure'
  | 'english_clear'
  | 'roman_urdu'
  | 'regional_friendly';

export type LiveTeachingMode = 'tutor' | 'viva' | 'loaded_book' | 'phd_defense';

export interface LiveSessionPromptConfig {
  gradeLevel?: LiveGradeLevel;
  subject?: string;
  languageMix?: LiveLanguageMix;
  teachingMode?: LiveTeachingMode;
  bookContext?: string;
}

export const LIVE_ALLOWED_VOICES: string[];

export function resolveLiveModel(
  gradeLevel?: LiveGradeLevel | string,
  deepThinking?: boolean
): 'gemini-3.8-live' | 'gemini-3.8-live-extended-thinking';

export function buildLiveTeacherSystemInstruction(opts?: LiveSessionPromptConfig): string;
