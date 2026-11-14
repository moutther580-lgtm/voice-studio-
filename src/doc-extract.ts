import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import type { DocExtractResult } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(pdfWorkerUrl, window.location.href).href;

const PAGE_NUM_RE =
  /^(?:page\s*\d+(?:\s*(?:of|\/)\s*\d+)?|\[\s*\d+\s*\]|-\s*\d+\s*-|—\s*\d+\s*—|p\.\s*\d+|\d{1,4})$/i;

export function cleanExtractedPages(pagesText: string[], applyClean: boolean): { text: string; removedLines: number } {
  if (!applyClean) {
    return {
      text: pagesText.map((p) => p.trim()).filter(Boolean).join('\n\n'),
      removedLines: 0,
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
  const cleanedPages: string[] = [];

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
    if (joined) cleanedPages.push(joined);
  }

  return { text: cleanedPages.join('\n\n'), removedLines };
}

async function extractPdf(file: File, applyClean: boolean): Promise<DocExtractResult> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pagesText: string[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
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

  const { text, removedLines } = cleanExtractedPages(pagesText, applyClean);
  return { text, pages: pdf.numPages, removedLines, formatLabel: 'PDF' };
}

async function extractDocx(file: File, applyClean: boolean): Promise<DocExtractResult> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const raw = result.value.replace(/\r\n?/g, '\n');
  const { text, removedLines } = cleanExtractedPages([raw], applyClean);
  return { text, removedLines, formatLabel: 'DOCX' };
}

function htmlToReadableText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript, [epub\\:type="pagebreak"], .pagebreak').forEach((el) => el.remove());
  const blocks = doc.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote, pre');
  if (!blocks.length) {
    return (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
  }
  const lines: string[] = [];
  blocks.forEach((el) => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (t) lines.push(t);
  });
  return lines.join('\n\n');
}

function resolveZipPath(baseDir: string, relPath: string): string {
  const cleanRel = relPath.split('#')[0].replace(/^\//, '');
  if (!baseDir) return decodeURIComponent(cleanRel);
  const stack = baseDir.split('/').filter(Boolean);
  for (const part of cleanRel.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return decodeURIComponent(stack.join('/'));
}

async function extractEpub(file: File, applyClean: boolean): Promise<DocExtractResult> {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const containerFile = zip.file('META-INF/container.xml');
  let opfPath = '';

  if (containerFile) {
    const containerXml = await containerFile.async('text');
    const cDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
    opfPath = cDoc.querySelector('rootfile')?.getAttribute('full-path') || '';
  }

  const chapterTexts: string[] = [];

  if (opfPath && zip.file(opfPath)) {
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
    const opfXml = await zip.file(opfPath)!.async('text');
    const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

    const manifest = new Map<string, { href: string; mediaType: string }>();
    opfDoc.querySelectorAll('manifest > item').forEach((item) => {
      const id = item.getAttribute('id');
      const href = item.getAttribute('href');
      const mediaType = item.getAttribute('media-type') || '';
      if (id && href) manifest.set(id, { href, mediaType });
    });

    const spineRefs = Array.from(opfDoc.querySelectorAll('spine > itemref')).map((r) => r.getAttribute('idref') || '');
    for (const idref of spineRefs) {
      const entry = manifest.get(idref);
      if (!entry) continue;
      if (entry.mediaType && !entry.mediaType.includes('html') && !entry.mediaType.includes('xml')) continue;
      const fullPath = resolveZipPath(opfDir, entry.href);
      const zipEntry = zip.file(fullPath);
      if (!zipEntry) continue;
      const html = await zipEntry.async('text');
      const readable = htmlToReadableText(html);
      if (readable) chapterTexts.push(readable);
    }
  }

  // Fallback if OPF spine was missing or empty
  if (!chapterTexts.length) {
    const htmlNames = Object.keys(zip.files)
      .filter((n) => /\.(x?html?|htm)$/i.test(n) && !/nav\./i.test(n))
      .sort();
    for (const name of htmlNames) {
      const html = await zip.file(name)!.async('text');
      const readable = htmlToReadableText(html);
      if (readable) chapterTexts.push(readable);
    }
  }

  const { text, removedLines } = cleanExtractedPages(chapterTexts, applyClean);
  return { text, chapters: chapterTexts.length, removedLines, formatLabel: 'EPUB' };
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
  const raw = await file.text();
  return {
    text: raw.replace(/\r\n?/g, '\n'),
    formatLabel: lower.endsWith('.md') ? 'Markdown' : 'Text',
  };
}
