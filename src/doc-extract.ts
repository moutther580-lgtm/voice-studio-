import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import type { ChapterItem, DocExtractResult, OutlineEntry } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(pdfWorkerUrl, window.location.href).href;

const PAGE_NUM_RE =
  /^(?:page\s*\d+(?:\s*(?:of|\/)\s*\d+)?|\[\s*\d+\s*\]|-\s*\d+\s*-|—\s*\d+\s*—|p\.\s*\d+|\d{1,4})$/i;

export function cleanExtractedPages(
  pagesText: string[],
  applyClean: boolean
): { text: string; removedLines: number; perPage: string[] } {
  if (!applyClean) {
    const perPage = pagesText.map((p) => p.trim());
    return {
      text: perPage.filter(Boolean).join('\n\n'),
      removedLines: 0,
      perPage,
    };
  }

  let removedLines = 0;
  const lineFreq = new Map<string, number>();

  if (pagesText.length >= 4) {
    for (const page of pagesText) {
      const seenOnPage = new Set<string>();
      for (const rawLine of page.split('\n')) {
        const norm = rawLine.trim().replace(/\d+/g, '#');
        if (norm.length >= 4 && norm.length <= 90 && !seenOnPage.has(norm)) {
          seenOnPage.add(norm);
          lineFreq.set(norm, (lineFreq.get(norm) || 0) + 1);
        }
      }
    }
  }

  const repeatedThreshold = Math.max(3, Math.ceil(pagesText.length * 0.4));
  const perPage: string[] = [];
  const nonEmptyPages: string[] = [];

  for (const page of pagesText) {
    const outLines: string[] = [];
    for (const rawLine of page.split('\n')) {
      const line = rawLine.replace(/\s+/g, ' ').trim();
      if (!line) {
        if (outLines.length && outLines[outLines.length - 1] !== '') outLines.push('');
        continue;
      }
      if (PAGE_NUM_RE.test(line)) {
        removedLines++;
        continue;
      }
      const norm = line.replace(/\d+/g, '#');
      if (pagesText.length >= 4 && (lineFreq.get(norm) || 0) >= repeatedThreshold) {
        removedLines++;
        continue;
      }
      outLines.push(line);
    }

    let joined = outLines.join('\n');
    // Un-hyphenate words split across PDF line breaks
    joined = joined.replace(/([A-Za-z]{2,})-\n([a-z]{2,})/g, '$1$2');
    // Collapse excess blank lines
    joined = joined.replace(/\n{3,}/g, '\n\n').trim();
    perPage.push(joined);
    if (joined) nonEmptyPages.push(joined);
  }

  return { text: nonEmptyPages.join('\n\n'), removedLines, perPage };
}

async function extractPdfOutline(pdf: pdfjsLib.PDFDocumentProxy): Promise<OutlineEntry[]> {
  const collected: OutlineEntry[] = [];
  try {
    const outline = await pdf.getOutline();
    if (!outline || !outline.length) return [];

    const resolveItem = async (item: { title?: string; dest?: string | unknown[] | null; items?: unknown[] }) => {
      if (collected.length >= 80) return;
      const title = (item.title || '').replace(/\s+/g, ' ').trim();
      if (title && item.dest) {
        try {
          const destArray = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
          if (Array.isArray(destArray) && destArray[0]) {
            const pageIndex = await pdf.getPageIndex(destArray[0] as Parameters<typeof pdf.getPageIndex>[0]);
            if (Number.isInteger(pageIndex) && pageIndex >= 0) {
              collected.push({ title: title.slice(0, 90), pageNumber: pageIndex + 1 });
            }
          }
        } catch {
          // Skip unresolvable bookmark destination
        }
      }
      if (Array.isArray(item.items)) {
        for (const child of item.items.slice(0, 15)) {
          await resolveItem(child as typeof item);
        }
      }
    };

    for (const rootItem of outline.slice(0, 40)) {
      await resolveItem(rootItem);
    }
  } catch {
    // Document may not contain bookmarks
  }
  return collected;
}

async function extractPdf(file: File, applyClean: boolean): Promise<DocExtractResult> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pagesText: string[] = [];

  const maxPages = Math.min(pdf.numPages, 1500);
  for (let p = 1; p <= maxPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines: string[] = [];
    let currentLine = '';
    let lastY: number | null = null;

    for (const item of content.items) {
      if (!('str' in item)) continue;
      const str = item.str;
      const y = Array.isArray(item.transform) ? item.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 4) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = str;
      } else {
        currentLine += (currentLine && str && !currentLine.endsWith(' ') && !str.startsWith(' ') ? ' ' : '') + str;
      }
      if (item.hasEOL) {
        if (currentLine.trim()) lines.push(currentLine.trim());
        currentLine = '';
      }
      if (y !== null) lastY = y;
    }
    if (currentLine.trim()) lines.push(currentLine.trim());
    pagesText.push(lines.join('\n'));
  }

  const outlineItems = await extractPdfOutline(pdf);
  const { text, removedLines, perPage } = cleanExtractedPages(pagesText, applyClean);
  const chaptersList = splitTextIntoChapters(text, 'Page Section');
  return {
    text,
    pages: pdf.numPages,
    pagesText: perPage,
    outlineItems: outlineItems.length ? outlineItems : undefined,
    chapters: chaptersList.length > 1 ? chaptersList.length : undefined,
    chaptersList: chaptersList.length > 1 ? chaptersList : undefined,
    removedLines,
    formatLabel: 'PDF',
  };
}

async function extractDocx(file: File, applyClean: boolean): Promise<DocExtractResult> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const raw = result.value.replace(/\r\n?/g, '\n');
  const { text, removedLines } = cleanExtractedPages([raw], applyClean);
  const chaptersList = splitTextIntoChapters(text, 'Section');
  return {
    text,
    chapters: chaptersList.length > 1 ? chaptersList.length : undefined,
    chaptersList: chaptersList.length > 1 ? chaptersList : undefined,
    removedLines,
    formatLabel: 'DOCX',
  };
}

function htmlToReadableWithHeading(html: string, fallbackIndex: number): { title: string; text: string } {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript, [epub\\:type="pagebreak"], .pagebreak').forEach((el) => el.remove());
  const firstHeading = doc.querySelector('h1, h2, h3, title')?.textContent?.replace(/\s+/g, ' ').trim() || '';
  const blocks = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre');
  let text = '';
  if (!blocks.length) {
    text = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
  } else {
    const lines: string[] = [];
    blocks.forEach((el) => {
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) lines.push(t);
    });
    text = lines.join('\n\n');
  }
  const title =
    firstHeading && firstHeading.length <= 70 ? firstHeading : `Chapter ${fallbackIndex}`;
  return { title, text };
}

const MAX_EPUB_ENTRIES = 250;
const MAX_EPUB_HTML_CHARS = 2_000_000;
const MAX_EPUB_TOTAL_CHARS = 15_000_000;

function safeDecodeZipSegment(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function resolveZipPath(baseDir: string, relPath: string): string {
  const cleanRel = relPath.split('#')[0].replace(/^\//, '');
  if (!baseDir) return safeDecodeZipSegment(cleanRel);
  const stack = baseDir.split('/').filter(Boolean);
  for (const part of cleanRel.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return safeDecodeZipSegment(stack.join('/'));
}

async function extractEpub(file: File, applyClean: boolean): Promise<DocExtractResult> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const allNames = Object.keys(zip.files);
  if (allNames.length > 2000) {
    throw new Error('EPUB archive contains too many entries.');
  }
  const containerFile = zip.file('META-INF/container.xml');
  let opfPath = '';

  if (containerFile) {
    const containerXml = (await containerFile.async('text')).slice(0, MAX_EPUB_HTML_CHARS);
    const cDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
    opfPath = cDoc.querySelector('rootfile')?.getAttribute('full-path') || '';
  }

  const rawChapters: Array<{ title: string; text: string }> = [];
  let totalExtractedChars = 0;

  if (opfPath && zip.file(opfPath)) {
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
    const opfXml = (await zip.file(opfPath)!.async('text')).slice(0, MAX_EPUB_HTML_CHARS);
    const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

    const manifest = new Map<string, { href: string; mediaType: string }>();
    opfDoc.querySelectorAll('manifest > item').forEach((item) => {
      const id = item.getAttribute('id');
      const href = item.getAttribute('href');
      const mediaType = item.getAttribute('media-type') || '';
      if (id && href) manifest.set(id, { href, mediaType });
    });

    const spineRefs = Array.from(opfDoc.querySelectorAll('spine > itemref'))
      .slice(0, MAX_EPUB_ENTRIES)
      .map((r) => r.getAttribute('idref') || '');
    for (const idref of spineRefs) {
      if (rawChapters.length >= MAX_EPUB_ENTRIES || totalExtractedChars >= MAX_EPUB_TOTAL_CHARS) break;
      const entry = manifest.get(idref);
      if (!entry) continue;
      if (entry.mediaType && !entry.mediaType.includes('html') && !entry.mediaType.includes('xml')) continue;
      const fullPath = resolveZipPath(opfDir, entry.href);
      const zipEntry = zip.file(fullPath);
      if (!zipEntry) continue;
      const html = (await zipEntry.async('text')).slice(0, MAX_EPUB_HTML_CHARS);
      const readable = htmlToReadableWithHeading(html, rawChapters.length + 1);
      if (readable.text.length >= 40) {
        totalExtractedChars += readable.text.length;
        rawChapters.push(readable);
      }
    }
  }

  // Fallback if OPF spine was missing or empty
  if (!rawChapters.length) {
    const htmlNames = Object.keys(zip.files)
      .filter((n) => /\.(x?html?|htm)$/i.test(n) && !/nav\./i.test(n))
      .sort()
      .slice(0, MAX_EPUB_ENTRIES);
    for (const name of htmlNames) {
      if (rawChapters.length >= MAX_EPUB_ENTRIES || totalExtractedChars >= MAX_EPUB_TOTAL_CHARS) break;
      const html = (await zip.file(name)!.async('text')).slice(0, MAX_EPUB_HTML_CHARS);
      const readable = htmlToReadableWithHeading(html, rawChapters.length + 1);
      if (readable.text.length >= 40) {
        totalExtractedChars += readable.text.length;
        rawChapters.push(readable);
      }
    }
  }

  const cleanedChapters = rawChapters
    .map((ch) => {
      const { text } = cleanExtractedPages([ch.text], applyClean);
      return { title: ch.title, text };
    })
    .filter((ch) => ch.text.trim().length > 0);

  const { text, removedLines } = cleanExtractedPages(
    rawChapters.map((c) => c.text),
    applyClean
  );

  return {
    text,
    chapters: cleanedChapters.length,
    chaptersList: cleanedChapters.length > 1 ? cleanedChapters : undefined,
    removedLines,
    formatLabel: 'EPUB',
  };
}

export function splitTextIntoChapters(
  rawText: string,
  fallbackPrefix = 'Part'
): Array<{ title: string; text: string }> {
  const normalized = rawText.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];

  const headingRe = /^(?:#{1,3}\s+.+|(?:chapter|unit|lesson|part|section|باب|فصل)\s+[\dIVXLCDM]+(?:[:.\-–\s].*)?)$/i;
  const lines = normalized.split('\n');
  const sections: Array<{ title: string; lines: string[] }> = [];
  let current: { title: string; lines: string[] } | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (headingRe.test(trimmed) && trimmed.length <= 90) {
      if (current && current.lines.join('\n').trim()) {
        sections.push(current);
      }
      current = { title: trimmed.replace(/^#{1,3}\s+/, '').slice(0, 70), lines: [trimmed] };
    } else {
      if (!current) {
        current = { title: `${fallbackPrefix} 1`, lines: [] };
      }
      current.lines.push(rawLine);
    }
  }
  if (current && current.lines.join('\n').trim()) {
    sections.push(current);
  }

  if (sections.length >= 2) {
    return sections.map((s) => ({ title: s.title, text: s.lines.join('\n').trim() }));
  }

  // Fallback for long plain documents without explicit headings (~3500 char chapters at paragraph boundaries)
  if ([...normalized].length >= 4500) {
    const paras = normalized.split(/\n{2,}/);
    const grouped: Array<{ title: string; text: string }> = [];
    let buf: string[] = [];
    let bufLen = 0;
    for (const p of paras) {
      const len = [...p].length;
      if (buf.length && bufLen + len > 3500) {
        grouped.push({
          title: `${fallbackPrefix} ${grouped.length + 1}`,
          text: buf.join('\n\n'),
        });
        buf = [p];
        bufLen = len;
      } else {
        buf.push(p);
        bufLen += len + 2;
      }
    }
    if (buf.length) {
      grouped.push({
        title: `${fallbackPrefix} ${grouped.length + 1}`,
        text: buf.join('\n\n'),
      });
    }
    if (grouped.length >= 2) return grouped;
  }

  return [{ title: `${fallbackPrefix} 1`, text: normalized }];
}

export async function extractDocument(file: File, applyClean: boolean): Promise<DocExtractResult> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
    return extractPdf(file, applyClean);
  }
  if (
    lower.endsWith('.docx') ||
    file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return extractDocx(file, applyClean);
  }
  if (lower.endsWith('.epub') || file.type === 'application/epub+zip') {
    return extractEpub(file, applyClean);
  }
  const raw = (await file.text()).replace(/\r\n?/g, '\n');
  const chaptersList = splitTextIntoChapters(raw, 'Section');
  return {
    text: raw,
    chapters: chaptersList.length > 1 ? chaptersList.length : undefined,
    chaptersList: chaptersList.length > 1 ? chaptersList : undefined,
    formatLabel: lower.endsWith('.md') ? 'Markdown' : 'Text',
  };
}

export function cleanScriptForSpeech(raw: string): string {
  return raw
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\[(?:\d+(?:[-–,]\s*\d+)*)\]/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`~|>]+/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function buildPdfAgentIndex(
  pagesText: string[],
  chapters: ChapterItem[],
  outlineItems: OutlineEntry[] = []
): string {
  const lines: string[] = [`Total pages: ${pagesText.length}`];

  if (outlineItems.length) {
    lines.push('PDF Bookmarks:');
    for (const o of outlineItems.slice(0, 60)) {
      lines.push(`- p.${o.pageNumber}: ${o.title}`);
    }
  } else if (chapters.length > 1) {
    lines.push('Detected Chapters:');
    chapters.slice(0, 40).forEach((ch, idx) => {
      lines.push(`- #${idx + 1}: ${ch.title} (${[...ch.text].length} chars)`);
    });
  }

  lines.push('Page Previews:');
  const step = pagesText.length > 80 ? Math.ceil(pagesText.length / 80) : 1;
  let totalBudget = 0;
  for (let i = 0; i < pagesText.length; i += step) {
    const snippet = pagesText[i].replace(/\s+/g, ' ').trim().slice(0, 140);
    if (!snippet) continue;
    const entry = `p.${i + 1}: ${snippet}`;
    totalBudget += entry.length;
    if (totalBudget > 9000) break;
    lines.push(entry);
  }
  return lines.join('\n');
}

export function slicePdfPages(
  pagesText: string[],
  startPage: number,
  endPage: number,
  extraPages: number[] = []
): { text: string; pagesUsed: number[] } {
  const total = pagesText.length;
  if (!total) return { text: '', pagesUsed: [] };
  const s = Math.max(1, Math.min(total, Math.round(startPage || 1)));
  const e = Math.max(s, Math.min(total, Math.round(endPage || s)));
  const picked = new Set<number>();
  for (let p = s; p <= e; p++) picked.add(p);
  for (const ex of extraPages) {
    if (Number.isInteger(ex) && ex >= 1 && ex <= total) picked.add(ex);
  }
  const sorted = Array.from(picked).sort((a, b) => a - b).slice(0, 35);
  const parts = sorted.map((p) => pagesText[p - 1] || '').filter((t) => t.trim().length > 0);
  return { text: parts.join('\n\n'), pagesUsed: sorted };
}

export function parsePageRangeFromPrompt(prompt: string, maxPages: number): { start: number; end: number } | null {
  const rangeMatch = prompt.match(/(?:pages?|pgs?|p\.?|صفحہ|صفحات)\s*(\d{1,4})\s*(?:-|–|to|se|سے)\s*(\d{1,4})/i);
  if (rangeMatch) {
    const a = Math.max(1, Math.min(maxPages, parseInt(rangeMatch[1], 10)));
    const b = Math.max(a, Math.min(maxPages, parseInt(rangeMatch[2], 10)));
    return { start: a, end: b };
  }
  const singleMatch = prompt.match(/(?:page|pg|p\.?|صفحہ)\s*(\d{1,4})/i);
  if (singleMatch) {
    const p = Math.max(1, Math.min(maxPages, parseInt(singleMatch[1], 10)));
    return { start: p, end: p };
  }
  return null;
}

export function localPdfAgentFallback(
  prompt: string,
  pagesText: string[],
  chapters: ChapterItem[],
  outlineItems: OutlineEntry[] = []
): { text: string; title: string; strategyNote: string } {
  const trimmedPrompt = prompt.trim();

  if (pagesText.length > 0) {
    const explicitRange = parsePageRangeFromPrompt(trimmedPrompt, pagesText.length);
    if (explicitRange) {
      const sliced = slicePdfPages(pagesText, explicitRange.start, explicitRange.end);
      return {
        text: cleanScriptForSpeech(sliced.text),
        title: `Pages ${explicitRange.start}-${explicitRange.end}`,
        strategyNote: `Local fallback extracted pages ${explicitRange.start}–${explicitRange.end}.`,
      };
    }

    // Check outline match by chapter number or keywords
    const chapNumMatch = trimmedPrompt.match(/(?:chapter|unit|lesson|part|section|باب|فصل)\s*(\d+)/i);
    if (outlineItems.length > 0) {
      let bestIdx = -1;
      let bestScore = 0;
      const keywords = trimmedPrompt.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
      outlineItems.forEach((o, idx) => {
        const lowerTitle = o.title.toLowerCase();
        let score = 0;
        if (chapNumMatch && new RegExp(`\\b0?${chapNumMatch[1]}\\b`).test(lowerTitle)) score += 6;
        for (const k of keywords) {
          if (lowerTitle.includes(k)) score += 2;
        }
        if (score > bestScore) {
          bestScore = score;
          bestIdx = idx;
        }
      });
      if (bestIdx >= 0) {
        const startPage = outlineItems[bestIdx].pageNumber;
        const nextOutline = outlineItems[bestIdx + 1]?.pageNumber;
        const endPage = nextOutline && nextOutline > startPage ? Math.min(startPage + 25, nextOutline - 1) : Math.min(pagesText.length, startPage + 12);
        const sliced = slicePdfPages(pagesText, startPage, endPage);
        return {
          text: cleanScriptForSpeech(sliced.text),
          title: outlineItems[bestIdx].title,
          strategyNote: `Local bookmark match "${outlineItems[bestIdx].title}" (pages ${startPage}–${endPage}).`,
        };
      }
    }
  }

  // Match against split chapters (works for EPUB, DOCX, TXT, or PDF)
  if (chapters.length > 0) {
    const chapNumMatch = trimmedPrompt.match(/(?:chapter|unit|lesson|part|section|باب|فصل)\s*(\d+)/i);
    const keywords = trimmedPrompt.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
    let bestIdx = 0;
    let bestScore = -1;

    chapters.forEach((ch, idx) => {
      const hay = `${ch.title}\n${ch.text.slice(0, 600)}`.toLowerCase();
      let score = 0;
      if (chapNumMatch) {
        const n = parseInt(chapNumMatch[1], 10);
        if (idx + 1 === n) score += 5;
        if (new RegExp(`(?:chapter|unit|lesson|part|section)\\s*0?${n}\\b`, 'i').test(ch.title)) score += 8;
      }
      for (const k of keywords) {
        if (ch.title.toLowerCase().includes(k)) score += 4;
        else if (hay.includes(k)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = idx;
      }
    });

    if (bestScore > 0 || chapters.length > 0) {
      const ch = chapters[bestIdx];
      return {
        text: cleanScriptForSpeech(ch.text),
        title: ch.title,
        strategyNote: `Local section match "${ch.title}".`,
      };
    }
  }

  // Last-resort page keyword scoring
  if (pagesText.length > 0) {
    const keywords = trimmedPrompt.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
    let bestPage = 1;
    let bestHits = -1;
    pagesText.forEach((pt, idx) => {
      const low = pt.toLowerCase();
      let hits = 0;
      for (const k of keywords) {
        if (low.includes(k)) hits++;
      }
      if (hits > bestHits && pt.trim().length > 30) {
        bestHits = hits;
        bestPage = idx + 1;
      }
    });
    const endPage = Math.min(pagesText.length, bestPage + 4);
    const sliced = slicePdfPages(pagesText, bestPage, endPage);
    return {
      text: cleanScriptForSpeech(sliced.text),
      title: `Pages ${bestPage}-${endPage}`,
      strategyNote: `Local keyword fallback extracted pages ${bestPage}–${endPage}.`,
    };
  }

  return {
    text: '',
    title: 'Selected Section',
    strategyNote: 'No readable pages or chapters matched.',
  };
}

export async function renderPdfPagesToJpegs(
  file: File,
  pageNumbers: number[]
): Promise<Array<{ mimeType: string; data: string }>> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const targets = pageNumbers.filter((p) => p >= 1 && p <= pdf.numPages).slice(0, 6);
  const out: Array<{ mimeType: string; data: string }> = [];

  for (const pNum of targets) {
    const page = await pdf.getPage(pNum);
    const viewport = page.getViewport({ scale: 1.2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    const dataUrl = canvas.toDataURL('image/jpeg', 0.72);
    const b64 = dataUrl.split(',')[1] || '';
    if (b64) out.push({ mimeType: 'image/jpeg', data: b64 });
  }
  return out;
}
