export interface RouteDef {
  pageId: string;
  path: string;
  title: string;
  description: string;
  breadcrumbLabel: string;
  robots: string;
  html: string;
}

export interface SampleClip {
  id: string;
  label: string;
  voiceLang: string;
  dir: 'ltr' | 'rtl';
  lang: string;
  script: string;
  translationNote: string;
}

export interface BilingualSyncToken {
  text: string;
  speech: string;
  lang: 'ur' | 'en';
}

export const SITE_ORIGIN: string;
export const SAMPLE_CLIPS: Record<'urdu' | 'english' | 'mixed', SampleClip>;
export const BILINGUAL_SYNC_TOKENS: BilingualSyncToken[];
export const ROUTES: RouteDef[];
export const ROUTE_BY_PATH: Map<string, RouteDef>;
export const ROUTE_BY_PAGE_ID: Map<string, RouteDef>;

export function normalizePathname(rawPathname: string): string;
export function buildJsonLdForRoute(route: RouteDef, origin?: string): string;
export function escapeHtmlAttr(val: string): string;
export function renderRouteHtml(templateHtml: string, route: RouteDef, origin?: string): string;
