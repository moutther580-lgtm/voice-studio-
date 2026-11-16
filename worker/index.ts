import { handleApiRequest, type WorkerEnv } from './tts-handler.js';

interface CloudflareEnv extends WorkerEnv {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

interface PageMeta {
  title: string;
  description: string;
}

const PAGE_META: Record<string, PageMeta> = {
  '/': {
    title: 'Voice Studio – Free PDF, EPUB & DOCX to Audio TTS Converter',
    description:
      'Convert PDF, EPUB, Word DOCX, and Urdu or English text into natural MP3 & WAV audio. Built for blind readers, students, and creators—3,000 free chars daily.',
  },
  '/account': {
    title: 'My Account | Voice Studio',
    description: 'Manage your Voice Studio account balance, daily character quota, server status, and recent usage history.',
  },
  '/admin': {
    title: 'Admin Panel | Voice Studio',
    description: 'Restricted Voice Studio Admin Panel for managing user accounts, credits, daily limits, activity history, and visitor messages.',
  },
  '/guides': {
    title: 'Guides & Workflows | Voice Studio',
    description:
      'Step-by-step guides for converting PDF, EPUB, DOCX, Urdu & English study notes, two-speaker podcasts, and accessible books into MP3 or WAV audio.',
  },
  '/formats': {
    title: 'Supported Formats & Audio Export | Voice Studio',
    description:
      'Compare PDF, EPUB, Word DOCX, Markdown, and TXT input extraction plus MP3 (64/128 kbps) and 24 kHz WAV export options in Voice Studio.',
  },
  '/faq': {
    title: 'Frequently Asked Questions | Voice Studio',
    description:
      'Answers about converting PDF, EPUB, and DOCX to MP3 audio, Urdu and English voices, screen-reader accessibility, privacy, and Unlimited Mode.',
  },
  '/about': {
    title: 'About | Voice Studio',
    description:
      'Learn about Voice Studio, created by Moutter Rasool in Faisalabad, Pakistan to make PDF, EPUB, and Word study materials accessible to blind readers.',
  },
  '/contact': {
    title: 'Contact | Voice Studio',
    description:
      'Contact Voice Studio developer Moutter Rasool for accessibility feedback, bug reports, or collaboration.',
  },
  '/privacy': {
    title: 'Privacy Policy | Voice Studio',
    description:
      'Voice Studio privacy policy: client-side PDF/EPUB/DOCX parsing, zero uploaded file retention, and transparent authentication details.',
  },
  '/terms': {
    title: 'Terms and Conditions | Voice Studio',
    description: 'Terms and conditions for using Voice Studio text-to-speech and document conversion tools.',
  },
};

function escapeHtmlAttr(val: string): string {
  return val.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env);
    }

    const res = await env.ASSETS.fetch(request);
    const cleanPath = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '').toLowerCase();
    const meta = PAGE_META[cleanPath];
    const contentType = res.headers.get('Content-Type') || '';

    if (meta && contentType.includes('text/html')) {
      const canonical = `${url.origin}${cleanPath}`;
      const routeId = cleanPath === '/' ? 'tool' : cleanPath.slice(1);
      let html = await res.text();
      html = html
        .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtmlAttr(meta.title)}</title>`)
        .replace(
          /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
          `<meta name="description" content="${escapeHtmlAttr(meta.description)}">`
        )
        .replace(
          /<link\s+id="canonicalLink"\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
          `<link id="canonicalLink" rel="canonical" href="${escapeHtmlAttr(canonical)}">`
        )
        .replace(
          /<meta\s+id="ogUrl"\s+property="og:url"\s+content="[^"]*"\s*\/?>/i,
          `<meta id="ogUrl" property="og:url" content="${escapeHtmlAttr(canonical)}">`
        )
        .replace(
          /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
          `<meta property="og:title" content="${escapeHtmlAttr(meta.title)}">`
        )
        .replace(
          /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
          `<meta property="og:description" content="${escapeHtmlAttr(meta.description)}">`
        )
        .replace(
          /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i,
          `<meta name="twitter:title" content="${escapeHtmlAttr(meta.title)}">`
        )
        .replace(
          /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i,
          `<meta name="twitter:description" content="${escapeHtmlAttr(meta.description)}">`
        );

      if (routeId !== 'tool') {
        html = html
          .replace(/<section\s+id="tool"([^>]*)>/i, '<section id="tool"$1 hidden>')
          .replace(new RegExp(`(<section\\s+id="${routeId}"[^>]*)\\s+hidden(?=\\s|>)`, 'i'), '$1');
      }
      if (routeId === 'account' || routeId === 'admin') {
        html = html.replace(
          /<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/i,
          '<meta name="robots" content="noindex, nofollow">'
        );
      }

      const headers = new Headers(res.headers);
      headers.delete('Content-Length');
      return new Response(html, { status: res.status, headers });
    }

    return res;
  },
};
