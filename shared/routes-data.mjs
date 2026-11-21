export const SITE_ORIGIN = 'https://voice-studio-three.vercel.app';

/**
 * Shared route registry used both by Vite dev/build prerendering and client-side navigation.
 * Rules enforced:
 * - Exactly ONE <h1> per route.
 * - Zero private screens (#authVerifyBox, #converterWorkspace, #account, #admin) in public HTML.
 * - Zero badge pills above headlines.
 * - Zero ad slots on /app, /account, /admin, /contact, /404, or tool screens.
 * - Empty, labelled .ad-slot placeholders appear ONLY between paragraphs on /guides/* articles.
 */

export const SAMPLE_CLIPS = {
  urdu: {
    id: 'urdu',
    label: 'Urdu Lecture',
    voiceLang: 'ur-PK',
    dir: 'rtl',
    lang: 'ur',
    script:
      'آج کے سبق میں ہم یہ دیکھیں گے کہ کس طرح طویل نصابی کتابوں اور نوٹس کو صاف اور واضح اردو آڈیو میں تبدیل کیا جا سکتا ہے۔',
    translationNote: 'Sample Urdu classroom introduction ready for mobile listening.',
  },
  english: {
    id: 'english',
    label: 'English Chapter',
    voiceLang: 'en-US',
    dir: 'ltr',
    lang: 'en',
    script:
      'Chapter Four: Renewable Energy Systems. Photovoltaic panels convert sunlight directly into electrical current without moving parts, making rooftop solar reliable for rural schools and clinics.',
    translationNote: 'Clean textbook prose with page numbers and footnotes already removed.',
  },
  mixed: {
    id: 'mixed',
    label: 'Mixed Urdu & English Notes',
    voiceLang: 'ur-PK',
    dir: 'ltr',
    lang: 'en',
    script:
      'Assalam-o-Alaikum students! Aaj ke lecture mein hum Photosynthesis aur Cellular Respiration ka difference samjhenge. Dono processes living cells ke energy cycle ka hissa hain.',
    translationNote: 'Natural switching between Urdu sentences and English science terms.',
  },
};

export const BILINGUAL_SYNC_TOKENS = [
  { text: 'آج', speech: 'Aaj', lang: 'ur' },
  { text: 'کے', speech: 'ke', lang: 'ur' },
  { text: 'سبق', speech: 'sabaq', lang: 'ur' },
  { text: 'میں', speech: 'mein', lang: 'ur' },
  { text: 'ہم', speech: 'hum', lang: 'ur' },
  { text: 'Photosynthesis', speech: 'Photosynthesis', lang: 'en' },
  { text: 'اور', speech: 'aur', lang: 'ur' },
  { text: 'Cellular Respiration', speech: 'Cellular Respiration', lang: 'en' },
  { text: 'کا', speech: 'ka', lang: 'ur' },
  { text: 'فرق', speech: 'farq', lang: 'ur' },
  { text: 'اور', speech: 'aur', lang: 'ur' },
  { text: 'ATP', speech: 'A T P', lang: 'en' },
  { text: 'بننے', speech: 'banne', lang: 'ur' },
  { text: 'کا', speech: 'ka', lang: 'ur' },
  { text: 'طریقہ', speech: 'tareeqa', lang: 'ur' },
  { text: 'سمجھیں', speech: 'samjhein', lang: 'ur' },
  { text: 'گے۔', speech: 'ge.', lang: 'ur' },
];

function renderBreadcrumbs(label, path) {
  if (!label || path === '/') return '';
  return `<nav class="breadcrumbs" aria-label="Breadcrumb"><a href="/" data-page="tool">Home</a><span aria-hidden="true">›</span><span aria-current="page">${label}</span></nav>`;
}

function renderSamplePlayerCard(clipKey, title, subtitle) {
  const c = SAMPLE_CLIPS[clipKey];
  return `<article class="sample-card">
    <div class="sample-head">
      <div>
        <h3>${title}</h3>
        <p class="hint">${subtitle}</p>
      </div>
      <button type="button" class="sec sample-play-btn" data-sample-id="${c.id}" aria-pressed="false" aria-label="Play ${title} sample">Play sample</button>
    </div>
    <p class="sample-transcript" dir="${c.dir}" lang="${c.lang}">${c.script}</p>
    <p class="sample-meta hint">${c.translationNote}</p>
  </article>`;
}

function renderBilingualSyncDemo() {
  const spans = BILINGUAL_SYNC_TOKENS.map((tok, idx) => {
    const inner =
      tok.lang === 'en' ? `<bdi dir="ltr" lang="en">${tok.text}</bdi>` : tok.text;
    return `<span class="sync-tok" data-tok-idx="${idx}">${inner}</span>`;
  }).join(' ');

  return `<div id="bilingualSyncDemo" class="bilingual-sync-box">
    <div class="bilingual-sync-head">
      <div>
        <h3>Mixed Urdu and English on one line</h3>
        <p class="hint">Right-to-left Urdu prose with left-to-right English science terms, highlighted word by word as it speaks.</p>
      </div>
      <button id="syncDemoPlayBtn" type="button" class="sec" aria-pressed="false">Play &amp; follow highlight</button>
    </div>
    <p id="bilingualSyncLine" class="urdu-rtl-sample bilingual-sync-line" dir="rtl" lang="ur">${spans}</p>
    <p id="syncDemoStatus" class="hint" role="status" aria-live="polite">Press Play &amp; follow highlight to watch Urdu and English words highlight together.</p>
  </div>`;
}

function renderAuthorBox(publishedDate = '20 November 2026') {
  return `<aside class="author-box" aria-label="About the author">
    <div>
      <p class="author-meta">Published: <time datetime="2026-11-20">${publishedDate}</time> · Last updated: <time datetime="2026-11-20">${publishedDate}</time></p>
      <p class="author-name">Written by <a href="/about" data-page="about">Moutter Rasool</a></p>
      <p class="hint">Blind software developer in Faisalabad, Pakistan. I build and test Voice Studio with NVDA and TalkBack every day while listening to technical docs and textbooks.</p>
    </div>
  </aside>`;
}

function renderAdSlot(slotName = 'in-article') {
  return `<aside class="ad-slot" aria-label="Advertisement" data-ad-slot="${slotName}"></aside>`;
}

const HOME_HTML = `<section id="tool" data-page-section="tool">
  <div id="homeSignedInBanner" class="signed-in-banner" hidden>
    <p>You are signed in. Open your ad-free workspace for 3,000 daily characters, chapter books, and video export.</p>
    <a class="btn" href="/app" data-page="app">Open Speech Studio (/app)</a>
  </div>

  <nav class="audio-timeline" aria-label="Page audio timeline">
    <ol class="timeline-track">
      <li><a href="#tryItSection"><span class="mono-num time-code">00:00</span><span>Try it free</span></a></li>
      <li><a href="#bilingualSection"><span class="mono-num time-code">00:25</span><span>Urdu + English</span></a></li>
      <li><a href="#cleanupSection"><span class="mono-num time-code">00:50</span><span>Cleanup &amp; size</span></a></li>
      <li><a href="#founderSection"><span class="mono-num time-code">01:15</span><span>Founder story</span></a></li>
      <li><a href="#toolsSection"><span class="mono-num time-code">01:40</span><span>Three tools</span></a></li>
      <li><a href="#privacySection"><span class="mono-num time-code">02:10</span><span>Your privacy</span></a></li>
      <li><a href="#faqSection"><span class="mono-num time-code">02:35</span><span>Quick FAQ</span></a></li>
    </ol>
  </nav>

  <section id="tryItSection" class="hero-studio-split" aria-labelledby="heroHeading">
    <div class="hero-intro-col">
      <div class="section-head-row">
        <h1 id="heroHeading" tabindex="-1">Your textbooks, read aloud in Urdu and English</h1>
      </div>
      <p class="lead">Upload a PDF or book, pick a voice, download a small MP3. Your file stays on your device.</p>

      <div class="btn-group">
        <a class="btn" href="/app" data-page="app">Open full Speech Studio</a>
        <button type="button" class="sec listen-section-btn" data-listen-target="#tryItSection" aria-pressed="false">Listen to this section</button>
      </div>

      <ul class="hero-plain-facts" aria-label="Key benefits">
        <li>Try up to 300 characters right here with no sign-in required</li>
        <li>Removes repeating PDF page numbers and running headers</li>
        <li>~28 MB per hour MP3 — small enough to share on WhatsApp</li>
      </ul>
    </div>

    <div id="publicTryItBox" class="try-it-box" role="region" aria-labelledby="tryItHeading">
      <div class="try-it-head">
        <h2 id="tryItHeading">Try it now without signing in</h2>
        <span id="tryItCharCount" class="mono-num hint" aria-live="off">138 / 300 chars</span>
      </div>

      <label for="tryItVoice">Voice</label>
      <select id="tryItVoice">
        <option value="Kore">Kore — Clear Urdu &amp; English</option>
        <option value="Puck">Puck — Conversational &amp; warm</option>
        <option value="Charon">Charon — Calm textbook narrator</option>
        <option value="Zephyr">Zephyr — Bright study voice</option>
        <option value="Aoede">Aoede — Expressive storytelling</option>
      </select>

      <label for="tryItText">Paste up to 300 characters or drop a file below</label>
      <textarea id="tryItText" dir="auto" maxlength="1200" rows="4">Assalam-o-Alaikum students! Today we are reviewing Chapter 3: Cell Structure aur energy cycle ko aasaan alfaaz mein samjhenge.</textarea>

      <div id="tryItDropZone" class="try-it-drop">
        <span id="tryItDropLabel">Drop a PDF, EPUB, DOCX, or TXT file here to load a quick excerpt locally.</span>
        <button id="tryItPickFileBtn" type="button" class="sec">Choose file</button>
        <input id="tryItFileInput" type="file" accept=".pdf,.docx,.epub,.txt,.md,text/plain,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden aria-label="Choose a textbook or notes file to preview locally">
      </div>

      <details class="panel try-it-byok-fold" id="tryItByokDetails">
        <summary>Have your own Google AI Studio key? Hear the neural Studio voice right here</summary>
        <label class="inline-check">
          <input id="tryItByokToggle" type="checkbox">
          <span>Use my own Gemini API key for this preview (saved only in browser)</span>
        </label>
        <label for="tryItByokKey">Gemini API key (optional)</label>
        <input id="tryItByokKey" type="password" autocomplete="off" spellcheck="false" placeholder="AIza...">
      </details>

      <div class="btn-group">
        <button id="tryItPlayBtn" type="button">Play preview</button>
        <button id="tryItStopBtn" type="button" class="sec" hidden>Stop</button>
        <a class="btn sec" href="/app" data-page="app">Full MP3 &amp; 3,000 free chars/day →</a>
      </div>

      <audio id="tryItAudioPlayer" controls hidden aria-label="Try-it Gemini audio preview"></audio>
      <p id="tryItStatus" class="hint" role="status" aria-live="polite">Instant browser preview works with no account. Sign in inside Speech Studio for downloadable MP3s, chapters, and video export.</p>
    </div>
  </section>

  <section id="bilingualSection" class="seo-band" aria-labelledby="bilingualHeading">
    <div class="section-head-row">
      <h2 id="bilingualHeading">Urdu and English together, plus three live samples</h2>
      <button type="button" class="sec listen-section-btn" data-listen-target="#bilingualSection" aria-pressed="false">Listen to this section</button>
    </div>
    <p class="lead">Pakistani study notes mix Urdu grammar with English science and IT words on the same line. Hear how Voice Studio handles pure Urdu, clean English chapters, and mixed notes.</p>

    ${renderBilingualSyncDemo()}

    <div id="samplesSection" class="sample-players-grid">
      ${renderSamplePlayerCard('urdu', '1. Urdu Lecture', 'Clear right-to-left Nastaliq reading')}
      ${renderSamplePlayerCard('english', '2. English Chapter', 'Steady pace with headers removed')}
      ${renderSamplePlayerCard('mixed', '3. Mixed Urdu-English Notes', 'Smooth switching on one line')}
    </div>
    <p id="samplePlaybackStatus" class="hint" role="status" aria-live="polite"></p>
  </section>

  <section id="cleanupSection" class="seo-band" aria-labelledby="cleanupHeading">
    <div class="section-head-row">
      <h2 id="cleanupHeading">Real PDF cleanup &amp; WhatsApp file size ruler</h2>
      <button type="button" class="sec listen-section-btn" data-listen-target="#cleanupSection" aria-pressed="false">Listen to this section</button>
    </div>
    <p class="lead">Ordinary readers read every page number, running title, and footnote bracket out loud. Voice Studio sweeps them away before building a lightweight MP3.</p>

    <div class="before-after-grid">
      <div class="card">
        <div class="before-after-head">
          <h3 id="beforeAfterStateTitle">Clean Voice Studio script (page clutter swept away)</h3>
          <div class="btn-group compact-actions">
            <button id="beforeAfterToggleBtn" type="button" class="sec" aria-pressed="true">Show raw noisy PDF text</button>
            <button id="beforeAfterListenBtn" type="button" class="sec">Hear this version</button>
          </div>
        </div>
        <p id="beforeAfterDisplay" class="before-after-sample">Chapter 3: Cell Structure. Every living organism relies on tiny compartments called cells to produce energy and carry genetic instructions.</p>
      </div>
      <figure class="editorial-media">
        <img src="/images/pdf-cleanup-comparison.webp" alt="Side-by-side comparison showing cluttered PDF page numbers crossed out on the left and clean flowing study audio on the right" width="800" height="400" loading="lazy" decoding="async">
      </figure>
    </div>

    <div class="file-size-ruler" aria-label="One hour audio file size comparison">
      <h3>File size ruler: 1 hour of spoken audio</h3>
      <p class="hint">Measured against a typical mobile data connection and WhatsApp study group limit:</p>
      <div class="ruler-rows">
        <div class="ruler-row">
          <div class="ruler-label">
            <strong>64 kbps Speech MP3 (Default)</strong>
            <span class="mono-num">~28 MB / hour — Share directly on WhatsApp</span>
          </div>
          <div class="ruler-track" aria-hidden="true"><div class="ruler-bar ruler-bar-mp3-64"></div></div>
        </div>
        <div class="ruler-row">
          <div class="ruler-label">
            <strong>128 kbps High-Clarity MP3</strong>
            <span class="mono-num">~56 MB / hour — Great for headphones</span>
          </div>
          <div class="ruler-track" aria-hidden="true"><div class="ruler-bar ruler-bar-mp3-128"></div></div>
        </div>
        <div class="ruler-row">
          <div class="ruler-label">
            <strong>24 kHz Uncompressed WAV</strong>
            <span class="mono-num">~170 MB / hour — Desktop video &amp; podcast editing</span>
          </div>
          <div class="ruler-track" aria-hidden="true"><div class="ruler-bar ruler-bar-wav"></div></div>
        </div>
      </div>
    </div>
  </section>

  <section id="founderSection" class="seo-band" aria-labelledby="founderHeading">
    <div class="founder-note-panel">
      <div class="section-head-row">
        <h2 id="founderHeading">Built by someone who listens to every book</h2>
        <button type="button" class="sec listen-section-btn" data-listen-target="#founderSection" aria-pressed="false">Listen to this section</button>
      </div>
      <p class="lead">Voice Studio was created by <strong>Moutter Rasool</strong>, a blind software developer in Faisalabad, Pakistan, who listens to technical books and study material every day.</p>
      <p>When existing readers choked on Urdu script mixed with English headings, read footer numbers aloud fifty times per chapter, or produced giant files too heavy for WhatsApp, I built the keyboard-first, screen-reader tested tool I needed for my own daily work.</p>
      <p><a href="/about" data-page="about">Read the full founder story and accessibility commitment</a></p>
    </div>
  </section>

  <section id="toolsSection" class="seo-band" aria-labelledby="toolsHeading">
    <div class="section-head-row">
      <h2 id="toolsHeading">Three focused tools inside one studio</h2>
      <button type="button" class="sec listen-section-btn" data-listen-target="#toolsSection" aria-pressed="false">Listen to this section</button>
    </div>
    <p class="lead">Start from a textbook chapter, turn study outlines into two speakers, or export subtitled study videos.</p>

    <div class="capability-ledger">
      <article class="capability-card capability-lead">
        <div>
          <h3><a href="/pdf-to-audio" data-page="pdfStudio">Books to Audio (PDF, EPUB &amp; Word)</a></h3>
          <p>Pick only the chapter or page span you need—even from scanned PDFs—and sweep away repeating headers so your MP3 sounds like a real audiobook.</p>
          <div class="btn-group">
            <a class="btn sec" href="/pdf-to-audio" data-page="pdfStudio">Open PDF &amp; Book Studio</a>
            <a class="btn sec" href="/guides/pdf-textbook-to-mp3-audio" data-page="guidePdfAudio">Read textbook guide</a>
          </div>
        </div>
        <ul class="capability-facts" aria-label="Books to Audio highlights">
          <li><span>Files supported</span><strong>PDF, EPUB, DOCX, MD, TXT</strong></li>
          <li><span>Page cleanup</span><strong>Removes headers &amp; page numbers</strong></li>
          <li><span>WhatsApp-ready MP3</span><strong class="mono-num">~28 MB / hour</strong></li>
          <li><span>Chapter books</span><strong>Numbered MP3 + caption ZIP</strong></li>
        </ul>
      </article>

      <article class="capability-card">
        <h3><a href="/podcast-studio" data-page="podcastStudio">Podcast and Translate</a></h3>
        <p>Turn class notes into a natural two-voice Host and Guest conversation, or translate scripts across Urdu, English, Arabic, and more with your custom Pronunciation Dictionary.</p>
        <p class="hint"><a href="/urdu-tts" data-page="urduTts">Explore Urdu &amp; English voice tools</a></p>
      </article>

      <article class="capability-card">
        <h3><a href="/video-subtitles" data-page="videoSubtitles">Subtitle Videos</a></h3>
        <p>Save captions that stay in sync even for hour-long chapters, or export 16:9, 9:16 Reels, and 1:1 square videos with right-to-left Urdu subtitles.</p>
        <figure class="inline-thumb">
          <img src="/images/urdu-rtl-subtitles.webp" alt="Preview of right-to-left Urdu and left-to-right English subtitle video layouts for Reels and YouTube" width="800" height="400" loading="lazy" decoding="async">
        </figure>
      </article>
    </div>
  </section>

  <section id="privacySection" class="seo-band" aria-labelledby="privacyPromiseHeading">
    <div class="section-head-row">
      <h2 id="privacyPromiseHeading">How it works &amp; what stays private</h2>
      <button type="button" class="sec listen-section-btn" data-listen-target="#privacySection" aria-pressed="false">Listen to this section</button>
    </div>
    <ol class="editorial-steps">
      <li>
        <strong>1. Open a file or paste notes</strong>
        <p>PDFs, EPUBs, and Word files are read inside your browser. Original book files never upload to our servers.</p>
      </li>
      <li>
        <strong>2. Pick your voice &amp; output</strong>
        <p>Choose a single narrator or two speakers, fix tricky acronyms in your Pronunciation Dictionary, and select compact MP3 or WAV.</p>
      </li>
      <li>
        <strong>3. Download and listen offline</strong>
        <p>Keep ~28 MB/hour MP3s, full chapter audiobook ZIPs, aligned .SRT/.VTT captions, or burned-in study videos. Text sent for voicing goes to Google's Gemini API under Google's terms (<a href="/privacy" data-page="privacy">Privacy Policy</a>).</p>
      </li>
    </ol>
  </section>

  <section id="audienceSection" class="seo-band" aria-labelledby="whoForHeading">
    <div class="section-head-row">
      <h2 id="whoForHeading">Who uses Voice Studio</h2>
      <button type="button" class="sec listen-section-btn" data-listen-target="#audienceSection" aria-pressed="false">Listen to this section</button>
    </div>
    <div class="audience-two-col">
      <div class="audience-item">
        <h3>Students revising on mobile</h3>
        <p>Turn bulky Matric, FSc, and university PDFs into ~28 MB/hour MP3 chapters you can listen to while commuting and share in class WhatsApp groups.</p>
      </div>
      <div class="audience-item">
        <h3>Blind, low-vision &amp; screen-reader users</h3>
        <p>Tested with NVDA and TalkBack, with ordered headings, accessible contrast themes, keyboard focus control, and text scaling up to 200%.</p>
      </div>
      <div class="audience-item">
        <h3>Teachers &amp; study creators</h3>
        <p>Turn lecture points into two-speaker podcasts and export 9:16 vertical Shorts or 16:9 YouTube clips with right-to-left Urdu captions.</p>
      </div>
      <div class="audience-item">
        <h3>Need long book runs?</h3>
        <p>Verified accounts receive 3,000 free characters every day, or paste your own free Google AI Studio key inside your browser for unlimited chapters.</p>
      </div>
    </div>
  </section>

  <section id="faqSection" class="seo-band" aria-labelledby="homeFaqHeading">
    <div class="section-head-row">
      <h2 id="homeFaqHeading">Quick answers</h2>
      <button type="button" class="sec listen-section-btn" data-listen-target="#faqSection" aria-pressed="false">Listen to this section</button>
    </div>
    <div class="faq-list">
      <details class="faq-item" open>
        <summary>Can I try Voice Studio before signing in?</summary>
        <p>Yes. Use the Try-It box at the top of this page to hear up to 300 characters or load a file excerpt immediately. Sign in at <a href="/app" data-page="app">/app</a> only when you want the 3,000-character daily allowance, downloadable MP3/WAV files, chapter ZIPs, or video export.</p>
      </details>
      <details class="faq-item">
        <summary>How does Voice Studio skip page numbers and headers?</summary>
        <p>Smart document cleanup checks your PDF or EPUB locally, drops repeated top and bottom lines plus standalone page numbers, and rejoins broken hyphenated words before voicing.</p>
      </details>
      <details class="faq-item">
        <summary>How small is a one-hour MP3 file for WhatsApp?</summary>
        <p>At the default 64 kbps speech MP3 setting, one hour of clear voice audio is around 28 MB—small enough for mobile data and WhatsApp study groups.</p>
      </details>
      <details class="faq-item">
        <summary>Does it read Urdu and English mixed in one sentence?</summary>
        <p>Yes. You can keep Urdu sentences and English technical words together, and teach custom pronunciations in the dictionary without editing your notes.</p>
      </details>
      <details class="faq-item">
        <summary>What if a PDF is a scanned image?</summary>
        <p>Voice Studio warns you right away and lets you open <a href="/pdf-to-audio" data-page="pdfStudio">PDF &amp; Book Studio</a> to read just the scanned pages you need.</p>
      </details>
    </div>
    <p class="hint"><a href="/faq" data-page="faq">Read all frequently asked questions</a> or browse <a href="/guides" data-page="guides">step-by-step study guides</a>.</p>
  </section>

  <section class="seo-band cta-band" aria-labelledby="finalCtaHeading">
    <h2 id="finalCtaHeading">Ready for full chapters, MP3 downloads, or live voice tutoring?</h2>
    <p class="lead">Open your ad-free Speech Studio for 3,000 free characters daily—or talk with the Urdu &amp; English Live AI Teacher (10 minutes free daily, unlimited with your own Gemini API key).</p>
    <div class="btn-group">
      <a class="btn" href="/app" data-page="app">Open Speech Studio (/app)</a>
      <a class="btn sec" href="/live-teacher" data-page="liveTeacher">Open Live AI Teacher</a>
      <a class="btn sec" href="/guides/blind-low-vision-students-audio-textbooks" data-page="guideBlindStudents">Guide for blind &amp; low-vision learners</a>
    </div>
  </section>
</section>`;

const APP_WORKSPACE_SHELL_HTML = `<section id="app" data-page-section="app" class="app-shell">
  <div id="appAuthMount">
    <h1 tabindex="-1">Speech Studio</h1>
    <p class="lead">Sign in to activate your 3,000-character daily free allowance, download MP3 and WAV audio, split chapters into Audiobook ZIPs, and access the <a href="/live-teacher" data-page="liveTeacher">Live AI Teacher</a> (10 minutes free daily). This workspace is always ad-free.</p>
    <div id="appAuthCardSlot"></div>
  </div>
</section>`;

const PDF_STUDIO_HTML = `<section id="pdfStudio" data-page-section="pdfStudio" class="legal">
  ${renderBreadcrumbs('PDF & Book to Audio', '/pdf-to-audio')}
  <div class="section-head-row">
    <h1 tabindex="-1">Turn any PDF chapter into clean audio</h1>
    <button type="button" class="sec listen-section-btn" data-listen-target="#pdfStudio" aria-pressed="false">Listen to this section</button>
  </div>
  <p class="lead">Pick a chapter or page range from any textbook, EPUB book, or scanned PDF and convert just the section you need—with page numbers and headers removed automatically.</p>

  <div class="card" id="pdfAgentPanel">
    <h2>Extract and convert selected chapters or pages</h2>
    <p class="hint" id="pdfStudioFileInfo">No file loaded yet. Choose a PDF, EPUB, DOCX, or TXT file below (everything stays on your device).</p>

    <div class="btn-group">
      <button id="pdfAgentPickFileBtn" type="button" class="sec">Choose PDF, EPUB or DOCX file</button>
      <a href="/app" data-page="app" class="btn sec">Open Speech Studio (/app)</a>
    </div>

    <label for="pdfAgentPrompt">Which chapter, topic, or pages do you want?</label>
    <input id="pdfAgentPrompt" type="text" maxlength="500" placeholder="For example: Chapter 3, pages 12-18, or summarize Thermodynamics">

    <div class="row">
      <div>
        <label for="pdfAgentOutputStyle">Output script style</label>
        <select id="pdfAgentOutputStyle">
          <option value="narrated" selected>Clean narrated audio (spoken prose)</option>
          <option value="verbatim">Exact text verbatim (headers &amp; citations stripped)</option>
          <option value="summary">Concise study summary</option>
          <option value="podcast">2-speaker podcast discussion (Host &amp; Guest)</option>
        </select>
      </div>
    </div>

    <label class="inline-check">
      <input id="pdfAgentAutoRecord" type="checkbox" checked>
      <span>Open Speech Studio and start generating audio right after extraction</span>
    </label>

    <div class="btn-group">
      <button id="pdfAgentRunBtn" type="button">Extract &amp; record selection</button>
      <button id="pdfAgentLoadOnlyBtn" type="button" class="sec">Extract to Speech Studio editor</button>
    </div>

    <p id="pdfAgentStatus" class="hint" role="status" aria-live="polite"></p>
    <p id="pdfAgentErr" class="hint err-msg" role="alert" aria-live="assertive"></p>
  </div>

  <div class="before-after-grid">
    <figure class="editorial-media">
      <img src="/images/pdf-cleanup-comparison.webp" alt="Comparison showing noisy academic PDF text on the left and clean flowing study audio script on the right" width="800" height="400" loading="lazy" decoding="async">
    </figure>
    <div class="answer-box">
      <strong>Why pick specific chapters first?</strong>
      <p>Instead of spending daily allowance on table-of-contents pages, bibliographies, and repeating running titles, target the exact pages you are revising tonight.</p>
    </div>
  </div>

  <h2>How PDF &amp; book extraction works</h2>
  <ol class="editorial-steps">
    <li>
      <strong>1. Bookmark and heading lookup</strong>
      <p>Reads chapters and page titles right on your device so only matching pages are prepared.</p>
    </li>
    <li>
      <strong>2. Clean speech formatting</strong>
      <p>Sweeps away standalone page numbers, footnote brackets like [12], web links, and hyphenated line breaks.</p>
    </li>
    <li>
      <strong>3. Scanned PDF reading</strong>
      <p>Detects image-only pages without selectable text and extracts just those pages for clear narration.</p>
    </li>
    <li>
      <strong>4. Chapter Audiobook ZIP</strong>
      <p>Need an entire EPUB or book? Split it into chapters and export numbered MP3 tracks paired with synced caption files.</p>
    </li>
  </ol>

  <p class="hint">Step-by-step tutorials: <a href="/guides/pdf-textbook-to-mp3-audio" data-page="guidePdfAudio">Turn a PDF textbook into MP3 audio</a> · <a href="/guides/epub-chapter-by-chapter-audiobook" data-page="guideEpubChapters">Make an EPUB chapter-by-chapter audiobook</a> · <a href="/faq" data-page="faq">Read FAQ</a></p>
</section>`;

const URDU_TTS_HTML = `<section id="urduTts" data-page-section="urduTts" class="legal">
  ${renderBreadcrumbs('Urdu & English TTS', '/urdu-tts')}
  <div class="section-head-row">
    <h1 tabindex="-1">Urdu text to speech that understands English words too</h1>
    <button type="button" class="sec listen-section-btn" data-listen-target="#urduTts" aria-pressed="false">Listen to this section</button>
  </div>
  <p class="lead">Built for Pakistani students, teachers, and creators whose notes move freely between Urdu sentences and English technical or scientific terms.</p>

  <div class="answer-box">
    <strong>Recommended Setup for Bilingual Notes:</strong>
    <p>Pair a clear bilingual voice such as <strong>Kore</strong> or <strong>Charon</strong> with 64 kbps speech MP3 (~28 MB per hour) so full lectures download quickly on mobile data and share smoothly in WhatsApp groups. Check active speech model options inside Speech Studio.</p>
  </div>

  ${renderBilingualSyncDemo()}

  <h2>Try Urdu &amp; bilingual samples right here</h2>
  <div class="sample-players-grid">
    ${renderSamplePlayerCard('urdu', 'Urdu Classroom Note', 'Pure right-to-left Urdu reading')}
    ${renderSamplePlayerCard('mixed', 'Mixed Urdu-English Handout', 'Natural code-switching on one line')}
  </div>
  <p id="samplePlaybackStatus" class="hint" role="status" aria-live="polite"></p>

  <h2>Urdu right-to-left examples ready to paste</h2>
  <div class="card">
    <p class="urdu-rtl-sample" dir="rtl" lang="ur">سوال: توانائی کے قابلِ تجدید ذرائع کیوں اہم ہیں؟ جواب: شمسی اور ہوائی توانائی ماحول دوست ہیں اور بجلی کی لاگت کم کرتی ہیں۔</p>
    <p class="hint">Tip: When English acronyms like <code>HTML</code>, <code>DNA</code>, or teacher titles like <code>Dr.</code> appear inside Urdu notes, map them once in your <strong>Pronunciation Dictionary</strong> without changing a word in your original notes.</p>
  </div>

  <h2>Synced subtitles in right-to-left Urdu</h2>
  <p>Every finished recording generates downloadable <code>.srt</code> and <code>.vtt</code> caption files automatically. When you export a study clip in <a href="/video-subtitles" data-page="videoSubtitles">Subtitled Videos</a>, Urdu sentences stay right-to-left while English lines stay left-to-right.</p>

  <div class="btn-group">
    <a href="/app" data-page="app" class="btn">Convert Urdu notes in Speech Studio</a>
    <a href="/guides/urdu-text-to-speech-mixed-english-terms" data-page="guideUrduMixed" class="btn sec">Read the Urdu pronunciation guide</a>
  </div>
</section>`;

const PODCAST_STUDIO_HTML = `<section id="podcastStudio" data-page-section="podcastStudio" class="legal">
  ${renderBreadcrumbs('Podcast & Translator', '/podcast-studio')}
  <div class="section-head-row">
    <h1 tabindex="-1">Turn your notes into a two-voice podcast</h1>
    <button type="button" class="sec listen-section-btn" data-listen-target="#podcastStudio" aria-pressed="false">Listen to this section</button>
  </div>
  <p class="lead">Load lecture notes into a natural Host and Guest conversation, pick a ready script template, or translate study material into Urdu, English, Arabic, and more.</p>

  <div class="card" id="creatorStudioPanel">
    <h2>Templates, Podcast Writer &amp; Translator</h2>

    <div class="row">
      <div>
        <label for="templateSelect">Creator script template</label>
        <select id="templateSelect">
          <option value="youtube">YouTube Explainer</option>
          <option value="lecture">Urdu + English Lecture</option>
          <option value="podcast">2-Speaker Podcast</option>
          <option value="story">Audiobook Story</option>
        </select>
      </div>
    </div>
    <div class="btn-group compact-actions">
      <button id="applyTemplateBtn" type="button" class="sec">Load selected template</button>
    </div>

    <hr class="divider">

    <div class="row">
      <div>
        <label for="podcastTopic">Topic or notes to turn into a 2-speaker podcast</label>
        <input id="podcastTopic" type="text" maxlength="2000" placeholder="For example: How solar panels work, or paste key points">
      </div>
      <div>
        <label for="podcastLen">Episode length</label>
        <select id="podcastLen">
          <option value="short">Short discussion (~1 min)</option>
          <option value="medium">Deep dive (~2 to 3 min)</option>
        </select>
      </div>
    </div>
    <div class="btn-group">
      <button id="genPodcastBtn" type="button" class="sec">Generate 2-speaker podcast script</button>
    </div>

    <hr class="divider">

    <div class="row">
      <div>
        <label for="translateLang">Translate &amp; adapt Speech Studio text into</label>
        <select id="translateLang">
          <option value="Urdu" lang="ur">Urdu (اردو)</option>
          <option value="English">English</option>
          <option value="Arabic" lang="ar">Arabic (العربية)</option>
          <option value="Hindi" lang="hi">Hindi (हिन्दी)</option>
          <option value="Spanish" lang="es">Spanish (Español)</option>
          <option value="French" lang="fr">French (Français)</option>
          <option value="German" lang="de">German (Deutsch)</option>
        </select>
      </div>
    </div>
    <div class="btn-group">
      <button id="translateBtn" type="button" class="sec">Translate text for speech</button>
      <button id="sendStudioToSpeechBtn" type="button">Open script in Speech Studio</button>
      <button id="recordFromStudioBtn" type="button" class="sec">Generate audio now</button>
    </div>

    <p id="studioStatus" class="hint" role="status" aria-live="polite"></p>
    <p id="studioErr" class="hint err-msg" role="alert" aria-live="assertive"></p>
  </div>

  <h2>How two-voice revision helps retention</h2>
  <p>Listening to a conversation where one speaker asks questions and the other explains key definitions breaks up dry textbook paragraphs and helps you revise difficult topics faster before exams.</p>

  <p class="hint">Need to extract a PDF chapter first? <a href="/pdf-to-audio" data-page="pdfStudio">Open PDF &amp; Book Studio</a> or check <a href="/faq" data-page="faq">FAQ</a>.</p>
</section>`;

const VIDEO_SUBTITLES_HTML = `<section id="videoSubtitles" data-page-section="videoSubtitles" class="legal">
  ${renderBreadcrumbs('Video & Subtitles', '/video-subtitles')}
  <div class="section-head-row">
    <h1 tabindex="-1">Make subtitled videos from your audio</h1>
    <button type="button" class="sec listen-section-btn" data-listen-target="#videoSubtitles" aria-pressed="false">Listen to this section</button>
  </div>
  <p class="lead">Export 16:9 widescreen, 9:16 vertical Reels, or 1:1 square videos with right-to-left Urdu or English subtitles that match your spoken audio—plus separate .SRT and .VTT subtitle files.</p>

  <figure class="editorial-media">
    <img src="/images/urdu-rtl-subtitles.webp" alt="16:9, 9:16 Reels, and 1:1 square study video previews showing synchronized Urdu and English captions" width="800" height="400" decoding="async">
  </figure>

  <div class="format-table-wrap">
    <table class="format-table">
      <thead>
        <tr>
          <th scope="col">Export Option</th>
          <th scope="col">Layout &amp; Captions</th>
          <th scope="col">Best Used For</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>16:9 Landscape Video</strong></td>
          <td>1280x720 high-contrast frame with multi-line captions and progress bar</td>
          <td>YouTube tutorials, full lectures, recorded courses</td>
        </tr>
        <tr>
          <td><strong>9:16 Vertical Video</strong></td>
          <td>720x1280 portrait layout sized for tall social captions</td>
          <td>YouTube Shorts, Instagram Reels, TikTok study notes</td>
        </tr>
        <tr>
          <td><strong>1:1 Square Video</strong></td>
          <td>720x720 balanced feed video with automatic RTL Urdu &amp; LTR English text direction</td>
          <td>Facebook, LinkedIn, WhatsApp Status, Telegram channels</td>
        </tr>
        <tr>
          <td><strong>.SRT &amp; .VTT Captions</strong></td>
          <td>Subtitle files synced directly to each spoken segment and pause</td>
          <td>Premiere, CapCut, DaVinci Resolve, YouTube closed captions</td>
        </tr>
      </tbody>
    </table>
  </div>

  <h2>Subtitles that stay in sync on long recordings</h2>
  <p>Captions are timed from the actual duration of each generated audio part rather than a rough word-per-minute guess—so even hour-long books stay accurately aligned from start to finish.</p>

  <div class="btn-group">
    <a href="/app" data-page="app" class="btn">Generate audio and video in Speech Studio</a>
    <a href="/formats" data-page="formats" class="btn sec">Compare audio formats</a>
  </div>
</section>`;

const LIVE_TEACHER_HTML = `<section id="liveTeacher" data-page-section="liveTeacher" class="legal">
  ${renderBreadcrumbs('Live AI Teacher', '/live-teacher')}
  <div class="section-head-row">
    <h1 tabindex="-1">Live AI Teacher in Urdu and English (Primary to PhD)</h1>
    <button type="button" class="sec listen-section-btn" data-listen-target="#liveTeacher" aria-pressed="false">Listen to this section</button>
  </div>
  <p class="lead">Real-time bilingual voice tutoring designed for Pakistani blind, low-vision, and sighted learners—from Class 1 stories to PhD viva defense. Explains equations, diagrams, and code purely by ear with NVDA and TalkBack collision-safe mic controls.</p>

  <div id="liveAuthPromptCard" class="card">
    <h2 id="liveAuthTitle">Sign in to start your Live Class</h2>
    <p id="liveAuthLead" class="hint">Verified accounts get <strong>10 minutes free every day</strong>, and users with their own Gemini API key saved in <a href="/app" data-page="app">Speech Studio (/app)</a> get unlimited free live sessions.</p>
    <div id="liveAuthActionRow" class="btn-group">
      <a href="/app" data-page="app" class="btn">Sign in via Speech Studio (/app)</a>
      <a href="/guides/blind-low-vision-students-audio-textbooks" data-page="guideBlindStudents" class="btn sec">Screen-reader study guide</a>
    </div>
    <div id="liveInlineAuthSlot"></div>
  </div>

  <div id="liveTeacherWorkspace" class="live-teacher-shell" hidden>
    <div class="card compact-bar" id="liveQuotaCard">
      <div class="live-quota-row">
        <div>
          <strong id="liveQuotaHeading">Daily Free Tutoring Allowance</strong>
          <p id="liveQuotaText" class="account-meta" role="status" aria-live="polite">Checking daily live tutoring balance…</p>
        </div>
        <span id="liveTimerClock" class="mono-num live-clock" aria-live="off">10:00</span>
      </div>
      <div class="live-meter-track" aria-hidden="true">
        <div id="liveQuotaMeterFill" class="live-meter-fill" style="width:100%"></div>
      </div>
    </div>

    <div class="card" id="liveSetupCard">
      <h2>1. Class profile, language &amp; screen-reader audio safety</h2>
      <div class="row">
        <div>
          <label for="liveGrade">Education level</label>
          <select id="liveGrade">
            <option value="primary">Primary (Classes 1–5)</option>
            <option value="middle">Middle School (Classes 6–8)</option>
            <option value="matric" selected>Matric / O-Level (Classes 9–10)</option>
            <option value="fsc_alevel">FSc / ICS / FA / A-Level &amp; MDCAT / ECAT</option>
            <option value="bs_honours">University BS / MBBS / Engineering / Law</option>
            <option value="ms_mphil">MS / MPhil Graduate Research</option>
            <option value="phd_research">PhD / Doctoral Research &amp; Viva</option>
          </select>
        </div>
        <div>
          <label for="liveSubject">Subject</label>
          <select id="liveSubject">
            <option value="All Subjects">All Subjects / General Study</option>
            <option value="Mathematics and Statistics">Mathematics &amp; Statistics</option>
            <option value="Physics">Physics</option>
            <option value="Chemistry">Chemistry</option>
            <option value="Biology and Medical Sciences">Biology / Medical (MDCAT / MBBS)</option>
            <option value="Computer Science and Programming">Computer Science &amp; Coding</option>
            <option value="Urdu and Literature">Urdu &amp; Literature</option>
            <option value="English and Essay Writing">English &amp; Essay Writing</option>
            <option value="Islamiat and Pakistan Studies">Islamiat &amp; Pakistan Studies</option>
            <option value="Economics, Accounting and Commerce">Economics / Accounting / Commerce</option>
            <option value="Research Methodology and Thesis Defense">Research Methodology &amp; Thesis</option>
          </select>
        </div>
        <div>
          <label for="liveLanguage">Language mix</label>
          <select id="liveLanguage">
            <option value="urdu_english_mix" selected>Pakistani Classroom (Urdu + English mix)</option>
            <option value="urdu_pure">Pure Urdu (خالص اردو)</option>
            <option value="english_clear">Clear Academic English</option>
            <option value="roman_urdu">Roman Urdu Friendly</option>
            <option value="regional_friendly">Urdu + English (Punjabi / Pashto / Sindhi / Balochi / Saraiki friendly)</option>
          </select>
        </div>
      </div>

      <div class="row">
        <div>
          <label for="liveMode">Teaching mode</label>
          <select id="liveMode">
            <option value="tutor" selected>Step-by-Step Tutor (Samjhaye)</option>
            <option value="viva">Oral Viva &amp; Exam Quiz Coach</option>
            <option value="loaded_book">Loaded Textbook / PDF Helper</option>
            <option value="phd_defense">PhD Defense &amp; Literature Critique</option>
          </select>
        </div>
        <div>
          <label for="liveVoice">Teacher voice</label>
          <select id="liveVoice">
            <option value="Kore" selected>Kore — Clear Urdu &amp; English</option>
            <option value="Charon">Charon — Calm Professor</option>
            <option value="Puck">Puck — Warm Encouraging Tutor</option>
            <option value="Zephyr">Zephyr — Bright &amp; Steady</option>
            <option value="Fenrir">Fenrir — Deep Formal Scholar</option>
          </select>
        </div>
        <div>
          <label for="liveMicMode">Microphone control (Screen-reader safety)</label>
          <select id="liveMicMode">
            <option value="tap" selected>Tap Mic On / Off (Ctrl+M — safest for NVDA &amp; TalkBack)</option>
            <option value="ptt">Push-to-Talk (Press &amp; Hold Button or Space)</option>
            <option value="continuous">Hands-Free Continuous (Headphones recommended)</option>
          </select>
        </div>
      </div>

      <label class="inline-check">
        <input id="liveDeepThinking" type="checkbox">
        <span>Use Deep STEM &amp; Research reasoning (auto-enabled for BS, MS &amp; PhD)</span>
      </label>

      <label class="inline-check">
        <input id="liveQuietScreenReader" type="checkbox" checked>
        <span>Pause live transcript alerts while teacher speaks (stops NVDA / TalkBack double-talking)</span>
      </label>

      <label class="inline-check">
        <input id="liveUseLoadedBook" type="checkbox">
        <span id="liveLoadedBookLabel">Include loaded Speech Studio book/chapter text as lesson context</span>
      </label>

      <div class="btn-group">
        <button id="liveStartBtn" type="button">Start Live Class</button>
        <button id="liveEndBtn" type="button" class="dng" hidden>End Class</button>
      </div>
      <p id="liveConnStatus" class="hint" role="status" aria-live="polite">Choose your level and subject above, then press Start Live Class.</p>
      <p id="liveErr" class="hint err-msg" role="alert" aria-live="assertive"></p>
    </div>

    <div class="card" id="liveStageCard">
      <h2>2. Live voice, interrupt &amp; optional book page camera</h2>
      <div class="live-stage-controls">
        <button id="liveMicBtn" type="button" class="live-ptt-btn" disabled aria-pressed="false" aria-keyshortcuts="Control+m">Start Speaking (Mic Off)</button>
        <button id="liveInterruptBtn" type="button" class="sec" disabled aria-keyshortcuts="Escape">Stop / Interrupt Teacher (Esc)</button>
      </div>
      <p class="hint" id="liveStageHint">Tip for blind learners: In Tap or Push-to-Talk mode, wait a second after NVDA or TalkBack finishes reading before opening the mic, or wear earphones.</p>

      <hr class="divider">

      <label for="liveTextPrompt">Or type / paste a question, math problem, or code snippet (Braille &amp; quiet room friendly)</label>
      <textarea id="liveTextPrompt" dir="auto" rows="3" maxlength="4000" placeholder="Example: Sir, FSc Physics ka Gauss's Law asaan Urdu mein step by step samjha dein, ya ye Python error check karein..."></textarea>
      <div class="btn-group">
        <button id="liveSendTextBtn" type="button" class="sec" disabled>Send typed question to teacher</button>
        <button id="liveRequestNotesBtn" type="button" class="sec" disabled>Ask teacher to prepare MP3 revision notes</button>
      </div>

      <hr class="divider">

      <div class="live-camera-box">
        <div class="btn-group">
          <button id="liveCamToggleBtn" type="button" class="sec" disabled aria-pressed="false">Turn Camera On (Scan Printed Book Page)</button>
          <button id="liveCamCaptureBtn" type="button" class="sec" hidden disabled>Read &amp; Explain This Page Now</button>
        </div>
        <label class="inline-check" id="liveAutoCamWrap" hidden>
          <input id="liveAutoCam" type="checkbox">
          <span>Auto-share 1 frame per second while camera is on (uses extra data)</span>
        </label>
        <video id="liveCameraPreview" class="live-camera-video" autoplay playsinline muted hidden aria-label="Camera preview for scanning a printed textbook page"></video>
        <canvas id="liveCameraCanvas" width="960" height="720" hidden></canvas>
      </div>
    </div>

    <div class="card" id="liveTranscriptCard">
      <div class="sample-head">
        <h2>3. Spoken transcript &amp; revision notes</h2>
        <button id="liveClearLogBtn" type="button" class="sec">Clear transcript</button>
      </div>
      <div id="liveTranscriptLog" class="live-transcript-log" role="log" aria-live="off" aria-label="Live AI Teacher conversation transcript">
        <p class="hint">Your live Urdu and English conversation transcript will appear here once class starts.</p>
      </div>

      <div id="liveNotesBox" class="note-box" hidden>
        <h3 id="liveNotesTitle">Lesson Revision Notes</h3>
        <pre id="liveNotesBody" class="live-notes-pre"></pre>
        <div class="btn-group">
          <button id="liveSendToStudioBtn" type="button">Send Notes to Speech Studio (/app) for MP3</button>
        </div>
      </div>
    </div>
  </div>

  <h2>Built for real Pakistani classrooms &amp; blind scholars</h2>
  <div class="audience-two-col">
    <div class="audience-item">
      <h3>Zero visual-only teaching</h3>
      <p>The teacher never tells you to "look at the chart below." Fractions, chemistry bonds, circuits, and research tables are explained step by step by ear using spatial mental models.</p>
    </div>
    <div class="audience-item">
      <h3>Primary to PhD coverage</h3>
      <p>Aligned with Pakistani PTB, FBISE, O/A Levels, MDCAT/ECAT, engineering, MBBS, and HEC graduate thesis defense preparation across Urdu, English, and Roman Urdu.</p>
    </div>
    <div class="audience-item">
      <h3>10 minutes free daily + BYOK unlimited</h3>
      <p>Signed-in accounts receive 10 minutes of free live voice tutoring every day. Save your own Gemini API key inside <a href="/app" data-page="app">Speech Studio</a> for unlimited sessions.</p>
    </div>
    <div class="audience-item">
      <h3>Turn lessons into offline MP3s</h3>
      <p>Ask your teacher to summarize any lesson into plain revision notes, send them to <a href="/app" data-page="app">Speech Studio</a> in one click, and download a compact ~28 MB/hr MP3 for offline review.</p>
    </div>
  </div>
</section>`;

const GUIDES_HTML = `<section id="guides" data-page-section="guides" class="legal">
  ${renderBreadcrumbs('Guides & Workflows', '/guides')}
  <div class="section-head-row">
    <h1 tabindex="-1">Guides and study workflows</h1>
    <button type="button" class="sec listen-section-btn" data-listen-target="#guides" aria-pressed="false">Listen to this section</button>
  </div>
  <p class="lead">Hand-written guides for turning textbooks, mixed Urdu-English handouts, and EPUB books into clean MP3 audio and accessible study materials.</p>

  <div class="guide-cards-grid">
    <article class="card">
      <h2><a href="/guides/pdf-textbook-to-mp3-audio" data-page="guidePdfAudio">1. How to turn a PDF textbook into MP3 audio (step by step)</a></h2>
      <p>Clean out repeating headers and page numbers automatically, pick only the chapter or pages you need, and save compact ~28 MB/hour MP3s.</p>
      <p class="hint">Published 20 November 2026 · By Moutter Rasool</p>
    </article>

    <article class="card">
      <h2><a href="/guides/urdu-text-to-speech-mixed-english-terms" data-page="guideUrduMixed">2. Urdu text to speech: getting English terms pronounced correctly</a></h2>
      <p>Keep Urdu sentences and English technical terms on one line, teach custom rules in your browser dictionary, and export RTL captions.</p>
      <p class="hint">Published 20 November 2026 · By Moutter Rasool</p>
    </article>

    <article class="card">
      <h2><a href="/guides/blind-low-vision-students-audio-textbooks" data-page="guideBlindStudents">3. How blind and low-vision students can listen to their textbooks</a></h2>
      <p>Keyboard paths, NVDA and TalkBack navigation tips, high-contrast modes, and turning noisy PDFs into clean chapter MP3s.</p>
      <p class="hint">Published 20 November 2026 · By Moutter Rasool</p>
    </article>

    <article class="card">
      <h2><a href="/guides/epub-chapter-by-chapter-audiobook" data-page="guideEpubChapters">4. How to make an audiobook from an EPUB, chapter by chapter</a></h2>
      <p>Split DRM-free ebooks by table of contents, check pronunciation before full runs, and package numbered MP3 + SRT Audiobook ZIPs.</p>
      <p class="hint">Published 20 November 2026 · By Moutter Rasool</p>
    </article>
  </div>

  <h2>Upcoming guides in our editorial roadmap</h2>
  <p>We are testing and writing new real-world guides gradually rather than publishing rushed or unverified articles. Titles currently being drafted and tested include:</p>
  <ul>
    <li>How to turn class notes into a two-voice study podcast</li>
    <li>How to make Urdu subtitle videos for Shorts and Reels</li>
    <li>How to use your own free Gemini API key for long books</li>
    <li>What to do when a scanned PDF has no selectable text</li>
    <li>Best audio size settings for sharing lectures on WhatsApp</li>
    <li>Privacy: what stays on your device and what goes to Google</li>
    <li>Accessibility tips for using Voice Studio with NVDA and TalkBack</li>
    <li>How to disclose AI-generated audio on YouTube and in class</li>
  </ul>

  <p class="hint">Need quick answers right away? Check <a href="/formats" data-page="formats">Supported Formats</a> or <a href="/faq" data-page="faq">FAQ</a>.</p>
</section>`;

const GUIDE_PDF_AUDIO_HTML = `<article id="guidePdfAudio" data-page-section="guidePdfAudio" class="legal guide-article">
  ${renderBreadcrumbs('PDF Textbook to MP3 Guide', '/guides/pdf-textbook-to-mp3-audio')}
  <div class="section-head-row">
    <h1 tabindex="-1">How to turn a PDF textbook into MP3 audio (step by step)</h1>
    <button type="button" class="sec listen-section-btn" data-listen-target="#guidePdfAudio" aria-pressed="false">Listen to this article</button>
  </div>
  <p class="lead">Academic PDFs are rarely built for ears. Page numbers, running book titles, footnote markers, and words hyphenated at the end of lines make normal text-to-speech distracting. Here is how to prepare clean, compact ~28 MB/hour MP3 study audio using Voice Studio.</p>

  ${renderAuthorBox('20 November 2026')}

  <h2>Why ordinary PDF readers interrupt every paragraph</h2>
  <p>Open almost any Matric, FSc, or university textbook PDF and look at the top and bottom margins. Every single page repeats the book name, chapter heading, journal volume, or a standalone page number such as <code>14</code> or <code>Page 14 of 220</code>. When you copy text straight into a basic reader or let an uncleaned TTS app read it aloud, those visual navigation markers become spoken words right in the middle of an explanation.</p>
  <p>A second headache is line wrapping. Printed columns split words like <em>photo-synthesis</em> or <em>thermo-dynamics</em> across a line break with a hyphen. A literal reader reads two nonsense syllables instead of one smooth word. Over a 40-page handout, that constant noise makes listening exhausting rather than relaxing.</p>

  ${renderAdSlot('in-article-1')}

  <h2>How Voice Studio prepares your PDF privately on your device</h2>
  <p>When you drop a PDF into Voice Studio, your original file is never uploaded to a file storage server. Browser-side extraction inspects each page in memory first. When <strong>Smart document cleanup</strong> stays checked, Voice Studio compares top and bottom lines across pages to spot repeating headers and footers, removes standalone page numbers and bracketed reference tags, rejoins hyphenated words across line breaks, and extracts only clean readable paragraphs.</p>

  <figure class="editorial-media">
    <img src="/images/pdf-cleanup-comparison.webp" alt="Before and after PDF cleanup showing crossed-out page headers on the left and clean flowing spoken prose on the right" width="800" height="400" loading="lazy" decoding="async">
    <figcaption class="hint">Voice Studio removes repeating page headers, footers, and standalone page numbers locally before creating speech.</figcaption>
  </figure>

  <h2>Step 1: Decide whether you need the whole book or just tonight's chapter</h2>
  <p>Before pressing Generate, decide how much of the document you actually need to revise right now. Converting a preface, table of contents, and bibliography eats up your daily 3,000 free characters on material you do not plan to memorize.</p>
  <p>Instead, open <a href="/pdf-to-audio" data-page="pdfStudio">PDF &amp; Book Studio</a>, choose your PDF file (up to 30 MB), and type the exact chapter or page numbers you want—for example <code>Chapter 4</code> or <code>pages 18-26</code>. You can pick between clean narrated prose (which turns bullet lists and tables into smooth sentences), exact verbatim text with page clutter stripped, a concise study summary, or a two-voice Host and Guest discussion.</p>

  <h2>Step 2: Choose 64 kbps MP3 for phones and WhatsApp</h2>
  <p>Inside <a href="/app" data-page="app">Speech Studio</a>, open <strong>Audio format &amp; advanced settings</strong>. By default, Voice Studio exports 64 kbps speech MP3 rather than heavy uncompressed WAV. Why does that matter? One full hour of spoken audio at 64 kbps takes roughly <strong>28 MB</strong> of storage—easy to download over mobile data in Pakistan and small enough to drop directly into a class WhatsApp group or Telegram channel. Only switch to 128 kbps (~56 MB/hour) or WAV (~170 MB/hour) when you intend to master podcasts or edit video tracks on a desktop computer.</p>

  ${renderAdSlot('in-article-2')}

  <h2>Step 3: Fix tricky names and test 200 characters before the full run</h2>
  <p>Long textbooks often include short abbreviations (like <code>Eq.</code>, <code>Fig.</code>, or <code>Prof.</code>) or local terms that speech engines pronounce inconsistently. Open the <strong>Pronunciation dictionary</strong> inside Step 1 of Speech Studio and add your rules once. They stay saved in your browser without altering a single letter of your extracted text.</p>
  <p>Next, press <strong>Preview first 200 characters</strong> before converting a long section. Listening to the opening ten seconds lets you verify voice tone, Urdu-English pronunciation, and speaking speed before using your daily allowance or your own Gemini API key.</p>

  <h2>Step 4: Handling scanned PDFs without selectable text</h2>
  <p>Photocopied notes and older Pakistani exam guides are often saved as flat images inside a PDF container. Ordinary text extractors return zero characters on those files. When you load a scanned PDF into Voice Studio, it alerts you automatically instead of failing silently. Open <a href="/pdf-to-audio" data-page="pdfStudio">PDF &amp; Book Studio</a>, type a focused page span such as <code>pages 1-5</code>, and let it inspect those scanned pages into clean spoken prose ready for Speech Studio.</p>

  <h2>Step 5: Export MP3, synced subtitles, or a full Audiobook ZIP</h2>
  <p>Once audio generation finishes, listen inside the built-in player at 1.0x, 1.25x, 1.5x, or 2.0x speed. Select <strong>Export Audio, Subtitles &amp; Video…</strong> to save your MP3, download synchronized <code>.srt</code> or <code>.vtt</code> subtitle files, or package multi-chapter books into a numbered Audiobook ZIP archive where every chapter audio track comes paired with its own subtitle file.</p>

  <h2>Next step</h2>
  <p>Ready to try with your own notes? Drop a short passage in the <a href="/" data-page="tool">home page Try-It box</a> or open <a href="/pdf-to-audio" data-page="pdfStudio">PDF &amp; Book Studio</a> to extract a specific chapter now. You may also want to read our <a href="/guides/urdu-text-to-speech-mixed-english-terms" data-page="guideUrduMixed">guide to mixed Urdu and English pronunciation</a>.</p>
</article>`;

const GUIDE_URDU_MIXED_HTML = `<article id="guideUrduMixed" data-page-section="guideUrduMixed" class="legal guide-article">
  ${renderBreadcrumbs('Urdu & English Pronunciation Guide', '/guides/urdu-text-to-speech-mixed-english-terms')}
  <div class="section-head-row">
    <h1 tabindex="-1">Urdu text to speech: getting English terms pronounced correctly</h1>
    <button type="button" class="sec listen-section-btn" data-listen-target="#guideUrduMixed" aria-pressed="false">Listen to this article</button>
  </div>
  <p class="lead">Students and teachers in Pakistan rarely study in pure Urdu or pure English alone. Lecture slides, Biology handouts, and Computer Science notes switch scripts mid-sentence. Here is how to make mixed Urdu-English audio sound steady and accurate without rewriting your notes.</p>

  ${renderAuthorBox('20 November 2026')}

  <h2>Why mixed Urdu-English text trips up generic readers</h2>
  <p>Most global text-to-speech apps assume a whole paragraph belongs to one language. When an Urdu sentence written right-to-left contains an English term such as <code>Photosynthesis</code>, <code>HTML</code>, or <code>Microprocessor</code>, a single-language reader either skips the English acronym, spells every letter painfully slowly, or twists Urdu vowels around English syllables.</p>
  <p>Even more common in classrooms is Roman Urdu mixed with English vocabulary—for example: <em>"Aaj ke lecture mein hum Cellular Respiration aur ATP ka cycle samjhenge."</em> Treating Roman Urdu cleanly while keeping English science words clear takes careful punctuation, balanced voice selection, and targeted pronunciation rules.</p>

  ${renderAdSlot('in-article-1')}

  <h2>Listen to the difference between pure Urdu and mixed notes</h2>
  <p>Before adjusting any setting, compare how a calm right-to-left Urdu reading transitions into an English technical concept inside the same paragraph.</p>
  <div class="sample-players-grid">
    ${renderSamplePlayerCard('urdu', 'Pure Urdu Passage', 'Calm right-to-left Urdu reading')}
    ${renderSamplePlayerCard('mixed', 'Mixed Urdu & English Notes', 'Smooth bilingual switching')}
  </div>
  <p id="samplePlaybackStatus" class="hint" role="status" aria-live="polite"></p>

  <h2>1. Handle Nastaliq Urdu, Roman Urdu, and embedded English cleanly</h2>
  <p>When Urdu Nastaliq script mixes with left-to-right English terminology, browser text boxes sometimes visually jumble punctuation around parentheses or colons. Inside Voice Studio's <a href="/urdu-tts" data-page="urduTts">Urdu &amp; English TTS</a> showcase and the home-page synchronized highlight demo, English segments are wrapped cleanly in directional markers so letters never flip backward while listening or reading along.</p>
  <p>If your study group shares lecture summaries in Roman Urdu (Urdu typed with English letters), check that words with double vowels—such as <code>kaam</code>, <code>zyada</code>, or <code>samjhein</code>—sit cleanly separated from English nouns. Splitting cramped WhatsApp blocks into normal two-line or three-line paragraphs stops the narrator from rushing through a whole syllabus list in one breath.</p>

  <h2>2. Punctuate Urdu and English sentences for natural pauses</h2>
  <p>Speech engines rely on sentence endings to breathe and reset tone. When copying from WhatsApp forwards, PDFs, or slide decks, add an Urdu full stop (<code>۔</code>) or an English period cleanly at the end of each complete thought. Avoid dumping five bullet points onto a single unbroken line; putting each point on its own line gives the narrator a clear pause between ideas.</p>
  <p>You can also tune spacing directly inside Step 1 of <a href="/app" data-page="app">Speech Studio (/app)</a>. Adjust the chunk size and silence pause slider if an Urdu revision guide jumps too quickly from one definition to the next, and keep long enumerations readable by placing a comma or colon after numbered headings.</p>

  <h2>3. Pick voices and delivery styles that balance both scripts</h2>
  <p>Inside <a href="/app" data-page="app">Speech Studio</a>, voices such as <strong>Kore</strong>, <strong>Charon</strong>, and <strong>Puck</strong> handle transitions between Nastaliq Urdu phrasing and English technical nouns steadily. Notice how female voices like <strong>Kore</strong> and <strong>Zephyr</strong> sound warm on explanatory essays, while deeper male voices like <strong>Charon</strong> or <strong>Fenrir</strong> work well for formal lecture outlines.</p>
  <p>If a technical lecture feels slightly rushed on dense definitions, choose the quick speaking style preset <em>Slow, clear &amp; calm narrator</em> in Step 1. You can also write brief delivery instructions (for example, <em>calm classroom teacher</em>) in the speaking style field—style directions guide tone and pace silently and are never spoken out loud in your finished MP3.</p>

  ${renderAdSlot('in-article-2')}

  <h2>4. Use the Pronunciation Dictionary instead of editing your notes</h2>
  <p>Never spend time manually hunting through a 30-page PDF to replace <code>Dr.</code>, <code>Fig.</code>, or a professor's surname. Open the <strong>Pronunciation dictionary</strong> drawer inside Step 1 of Speech Studio and add exact replacement rules once:</p>
  <ul>
    <li>Map <code>Dr.</code> to <code>Doctor</code>, <code>Eq.</code> to <code>Equation</code>, and <code>Ch.</code> to <code>Chapter</code> so printed textbook shorthand sounds natural.</li>
    <li>Keep <strong>Match whole word only</strong> ticked for short uppercase acronyms like <code>AI</code>, <code>OS</code>, or <code>CPU</code> so ordinary English or Roman Urdu words containing those letters are never changed accidentally.</li>
    <li>Spell unfamiliar proper names, historical cities, or regional course titles phonetically in the <em>Spoken as</em> column.</li>
    <li>Add spaced hyphens or full words when an acronym should be read letter by letter rather than pronounced as one syllable.</li>
  </ul>
  <p>Your dictionary rules save locally inside your browser storage, apply automatically right before synthesis starts, and leave your pasted study text completely untouched for visual study notes or clean subtitle export.</p>

  <h2>5. Try two-speaker Urdu and English podcast dialogues</h2>
  <p>Sometimes listening to a dry list of questions and answers in a single monotone voice makes evening revision harder. In Voice Studio's Two-Speaker Mode inside Step 1—or using the <a href="/podcast-studio" data-page="podcastStudio">Podcast &amp; Translator Studio</a>—format lines with clear speaker prefixes such as <code>Host:</code> and <code>Guest:</code>. Assign one voice for Urdu conceptual questions and a contrasting voice for English definitions or worked examples so two parts stand apart effortlessly by ear.</p>

  <h2>6. Keep Urdu subtitles right-to-left in exported videos</h2>
  <p>When you generate MP3 or WAV audio in Voice Studio, synchronized <code>.srt</code> and <code>.vtt</code> caption files are prepared from the exact spoken duration of every segment—never guessed at a generic constant words-per-minute rate. Open the Export popup (<code>Export Audio, Subtitles &amp; Video…</code>) to render a 16:9 YouTube lesson, 9:16 Reels vertical clip, or 1:1 square post. Right-to-left Urdu captions preserve natural reading direction while embedded English scientific words stay readable left-to-right on screen.</p>

  <h2>7. Preview 200 characters before committing a whole lecture</h2>
  <p>Before using your daily character allowance—or running a large chapter with your own optional Gemini API key—click <strong>Preview first 200 characters</strong>. Ten seconds of listening immediately catches an awkward surname, a missing period, or a mismatched Roman Urdu spelling before the rest of your document renders.</p>

  <h2>Next step</h2>
  <p>Test your own bilingual sentence on the <a href="/urdu-tts" data-page="urduTts">Urdu &amp; English TTS page</a>, drop a paragraph into the <a href="/" data-page="tool">home page Try-It box</a>, or read <a href="/guides/blind-low-vision-students-audio-textbooks" data-page="guideBlindStudents">how blind and low-vision students listen to textbooks</a>.</p>
</article>`;

const GUIDE_BLIND_STUDENTS_HTML = `<article id="guideBlindStudents" data-page-section="guideBlindStudents" class="legal guide-article">
  ${renderBreadcrumbs('Guide for Blind & Low-Vision Students', '/guides/blind-low-vision-students-audio-textbooks')}
  <div class="section-head-row">
    <h1 tabindex="-1">How blind and low-vision students can listen to their textbooks</h1>
    <button type="button" class="sec listen-section-btn" data-listen-target="#guideBlindStudents" aria-pressed="false">Listen to this article</button>
  </div>
  <p class="lead">Voice Studio was created by a blind software developer who studies and codes with a screen reader every day. This guide walks through the accessibility features, keyboard workflow, and chapter MP3 exports built specifically for NVDA, TalkBack, and low-vision learners.</p>

  ${renderAuthorBox('20 November 2026')}

  <h2>Why pre-cleaned chapter MP3s help during exam season</h2>
  <p>Even when a screen reader like NVDA on Windows or TalkBack on Android is tuned well, reading raw university PDFs directly for hours is tiring. Multi-column layouts scramble reading order, repeating headers and copyright footers interrupt sentences on every page turn, and continuous live screen-reader speech drains phone batteries during commutes or power load-shedding.</p>
  <p>Converting a cleaned textbook chapter into a compact MP3 lets you listen offline inside any simple music or audiobook player, jump cleanly between numbered chapter tracks in an Audiobook ZIP, and listen at 1.25x, 1.5x, or 2.0x speed while saving battery life.</p>

  ${renderAdSlot('in-article-1')}

  <h2>1. Set your display &amp; focus preferences right from the header</h2>
  <p>At the very top of every Voice Studio page—immediately after the keyboard-first <strong>Skip to main content</strong> link—you will find a visible <strong>Dark mode</strong> switch and an <strong>Accessibility</strong> drawer button. Opening the Accessibility drawer gives you instant browser-saved controls organized across clear tabs:</p>
  <ul>
    <li><strong>Contrast modes:</strong> Switch cleanly between Warm Paper, Evening Study (Dark), High Contrast Black &amp; Yellow (popular with low-vision learners who prefer bright yellow ink on pure black), or High Contrast White &amp; Black.</li>
    <li><strong>Text scaling &amp; accessible fonts:</strong> Enlarge UI and reading text smoothly up to 200%, turn on Atkinson Hyperlegible (designed specifically for distinct letterforms like <code>I</code>, <code>l</code>, and <code>1</code>), Verdana/Tahoma, Georgia, or monospace, and increase line height, letter spacing, and word spacing.</li>
    <li><strong>Operable navigation &amp; reduced motion:</strong> Force thick high-visibility focus borders around every active control, keep all hyperlinks underlined and clearly highlighted, enlarge clickable targets across mobile and desktop screens, and turn animations off completely.</li>
    <li><strong>Direct keyboard shortcut &amp; persistence:</strong> Preferences save in local browser storage automatically so your custom font scale, contrast theme, and underline rules stay active every time you revisit Voice Studio.</li>
  </ul>

  <h2>2. Navigate predictably with screen readers and keyboard only</h2>
  <p>Every public page and workspace screen follows a strict landmark and heading hierarchy: one clear <code>h1</code> heading at the start of main content (receives focus when switching routes so screen readers announce the new view right away), ordered <code>h2</code> sections, visible labels explicitly tied to every input, and zero unlabeled icon-only buttons.</p>
  <p>On almost every guide, homepage section, and tool page, a <strong>Listen to this section</strong> or <strong>Listen to this article</strong> button sits right next to the main heading. Activating it speaks the section text cleanly in your browser using clear pause/stop toggle announcements via <code>aria-pressed</code> without needing to highlight lines by hand.</p>
  <p>Modals and slide-over panels—including the Navigation drawer, Accessibility Settings drawer, and the Export Audio/Subtitles/Video popup—follow predictable ARIA dialog behavior: while open, <code>Tab</code> and <code>Shift + Tab</code> stay inside the modal, background content stays inert so screen-reader virtual cursors do not drift behind the overlay, pressing <code>Escape</code> closes the popup, and focus returns directly to the button you pressed originally.</p>

  ${renderAdSlot('in-article-2')}

  <h2>3. Keep the tool workspace calm and ad-free</h2>
  <p>Public guide articles carry clearly labelled ad placeholders between paragraphs, outside the interactive tool path. The <a href="/app" data-page="app">Speech Studio workspace (/app)</a> itself—along with sign-in, email verification, daily quota details, and the Contact page—remains permanently ad-free. No banner pops up between Step 1, Step 2, and the Generate button, so screen-reader focus and keyboard rhythm stay calm while you convert study material.</p>

  <h2>4. Skip front-matter clutter using PDF &amp; Book Studio</h2>
  <p>University PDFs often start with 15 pages of acknowledgements, table of contents grids, and syllabus matrices before Chapter 1 even begins. Instead of listening through irrelevant tables, open <a href="/pdf-to-audio" data-page="pdfStudio">PDF &amp; Book Studio</a> first. Pick a targeted span such as <code>pages 16-28</code>, inspect and clean scanned pages into flowing paragraphs, and pass only the clean chapter text into Speech Studio.</p>
  <p>When working inside Step 2 of <a href="/app" data-page="app">Speech Studio</a>, leave <strong>Auto-clean PDF / web text</strong> turned on so broken mid-line wraps, redundant page counters, and copied web breadcrumbs disappear automatically before synthesis starts.</p>

  <h2>5. Track progress politely and manage exports from one popup</h2>
  <p>During multi-chunk generation, progress steps and percentage counts update through polite <code>aria-live</code> regions—letting NVDA or TalkBack report progress naturally without stealing focus from your pause or stop controls. Once finished, press <strong>Export Audio, Subtitles &amp; Video…</strong> to open one keyboard-accessible dialog containing your MP3/WAV download buttons, <code>.srt</code> and <code>.vtt</code> subtitle exports, and 16:9 / 9:16 / 1:1 video rendering.</p>
  <p>If your textbook or EPUB contains multiple chapters, press <strong>Export all chapters as Audiobook ZIP</strong> to bundle numbered MP3 tracks alongside matching <code>.srt</code> caption files and an orderly index text file inside one clean folder.</p>

  <h2>Send accessibility feedback directly</h2>
  <p>If any label, contrast pair, focus return, live announcement, or keyboard shortcut feels awkward in NVDA, JAWS, VoiceOver, or TalkBack, write directly via the <a href="/contact" data-page="contact">Contact page</a> or email <a href="mailto:moutther580@gmail.com">moutther580@gmail.com</a>. You can also explore <a href="/guides/epub-chapter-by-chapter-audiobook" data-page="guideEpubChapters">our EPUB chapter audiobook guide</a> or <a href="/guides/pdf-textbook-to-mp3-audio" data-page="guidePdfAudio">PDF to MP3 guide</a>.</p>
</article>`;

const GUIDE_EPUB_CHAPTERS_HTML = `<article id="guideEpubChapters" data-page-section="guideEpubChapters" class="legal guide-article">
  ${renderBreadcrumbs('EPUB Chapter Audiobook Guide', '/guides/epub-chapter-by-chapter-audiobook')}
  <div class="section-head-row">
    <h1 tabindex="-1">How to make an audiobook from an EPUB, chapter by chapter</h1>
    <button type="button" class="sec listen-section-btn" data-listen-target="#guideEpubChapters" aria-pressed="false">Listen to this article</button>
  </div>
  <p class="lead">DRM-free EPUB ebooks are the cleanest starting point for spoken audiobooks because chapters already have real headings instead of noisy printed page footers. Here is how to split an EPUB inside your browser, keep voices consistent across every part, and export a complete numbered Audiobook ZIP.</p>

  ${renderAuthorBox('20 November 2026')}

  <h2>Why EPUB books convert more cleanly than scanned PDFs</h2>
  <p>Unlike scanned PDFs or rigid two-column journals, an EPUB file stores structured XHTML sections internally rather than fixed ink coordinates on paper. There are no page numbers trapped between paragraphs, no header banners repeating the book title every 300 words, and no hyphenated words chopped across column margins.</p>
  <p>When you open a DRM-free <code>.epub</code> file inside Voice Studio, your browser unpacks and reads its chapters directly on your device—your full ebook file is never uploaded to a remote storage server just to read its table of contents.</p>

  ${renderAdSlot('in-article-1')}

  <h2>Step 1: Drop your DRM-free EPUB into Speech Studio</h2>
  <p>Sign in at <a href="/app" data-page="app">Speech Studio (/app)</a> and drop your <code>.epub</code> file directly onto Step 2 (or click <strong>Load PDF, DOCX, EPUB or TXT</strong>). Voice Studio inspects the book’s internal structure locally on your computer or phone. If multiple chapters are present, a dedicated chapter selector panel opens automatically right above the editor text area.</p>
  <p>Note that commercial store-locked ebooks protected by DRM cannot be unpacked by browser readers. Any DRM-free EPUB from university repositories, Project Gutenberg, open courseware, or your own exports works immediately. If you ever paste plain text or load a long <code>.docx</code> or <code>.txt</code> manuscript without an embedded EPUB table of contents, simply press <strong>Split into chapters</strong> so Voice Studio detects headings like <em>Chapter 1</em>, <em>Unit 2</em>, or <em>Part I</em> automatically.</p>

  <h2>Step 2: Preview one chapter and lock pronunciation rules first</h2>
  <p>Before running an entire multi-hour book, select a representative chapter in the chapter dropdown and click <strong>Load selected chapter</strong>. Take one minute to scan the first paragraph for recurring character names, Latin terminology, author citations, or technical symbols.</p>
  <p>Open the <strong>Pronunciation dictionary</strong> in Step 1 and save replacements once—for instance expanding <code>v.</code> to <code>versus</code>, spelling out an unfamiliar historical name, or ticking <strong>Match whole word only</strong> for acronyms. Next, press <strong>Preview first 200 characters</strong> to confirm the narrator's tone and pacing before converting full chapters.</p>

  ${renderAdSlot('in-article-2')}

  <h2>Step 3: Tune chunk pacing, pauses, and compact MP3 bitrate</h2>
  <p>Inside Step 1, you control how your audiobook breathes between paragraphs and chapters:</p>
  <ul>
    <li><strong>Voice &amp; delivery style:</strong> For fiction, biographies, or literature essays, try the <em>Warm audiobook storyteller</em> preset; for engineering, medicine, or law textbooks, switch to <em>Slow, clear &amp; calm narrator</em>.</li>
    <li><strong>Chunk size &amp; inter-part silence:</strong> Adjusting segment size and silence padding gives listeners a comfortable pause between major sections without sounding robotic or rushed.</li>
    <li><strong>MP3 quality selection:</strong> Choosing <strong>64 kbps MP3</strong> keeps audio remarkably light—around ~28 MB per hour—so a full eight-hour book stays close to ~220 MB, easy to store on an older smartphone or share chapter-by-chapter over WhatsApp. Switch to <strong>128 kbps MP3</strong> (~56 MB/hr) for podcast publishing or <strong>WAV</strong> (~170 MB/hr) when editing tracks further in Audacity or Premiere.</li>
  </ul>

  <h2>Step 4: Export all chapters into one organized Audiobook ZIP</h2>
  <p>When your preview sounds natural, check the chapter list quickly for short boilerplate sections such as cover pages, copyright notices, or publisher catalogues. If you only want core study chapters, select or preview individual chapters one by one; if every chapter in the EPUB is part of the reading assignment, press <strong>Export all chapters as Audiobook ZIP</strong>.</p>
  <p>Voice Studio works sequentially through the book's chapter list without losing track of order. Each long chapter is synthesized chunk-by-chunk and stitched smoothly with subtle cross-fades so there are zero clicks or static pops between parts. At the same time, Voice Studio generates a matching time-synced <code>.srt</code> subtitle file for every individual chapter track plus a clear <code>00-chapters-index.txt</code> manifest listing every track title and character length. Once the final chapter finishes, your browser bundles the MP3 tracks, paired <code>.srt</code> files, and index file into one clean ZIP download ready for any player.</p>

  <h2>Organizing large books cleanly</h2>
  <p>Using your free daily 3,000-character allowance is ideal for testing individual sections, proofreading pronunciations, or summarizing a single lecture handout. For full multi-chapter EPUB textbooks where total length runs into tens of thousands of characters, toggle <strong>Bring Your Own Gemini Key</strong> (optional) inside Speech Studio so your browser speaks straight through multi-chapter queues using your personal API quota without daily character caps. Every exported track remains stored locally on your device so you can listen offline on Windows, Android, or iOS whenever convenient.</p>

  <h2>Related guides</h2>
  <p>Working with a PDF textbook instead of an EPUB? Read <a href="/guides/pdf-textbook-to-mp3-audio" data-page="guidePdfAudio">how to turn a PDF textbook into MP3 audio</a>, check <a href="/guides/blind-low-vision-students-audio-textbooks" data-page="guideBlindStudents">screen-reader &amp; accessibility workflows</a>, or review <a href="/formats" data-page="formats">all supported formats and sizes</a>.</p>
</article>`;

const FORMATS_HTML = `<section id="formats" data-page-section="formats" class="legal">
  ${renderBreadcrumbs('Supported Formats', '/formats')}
  <div class="section-head-row">
    <h1 tabindex="-1">Supported formats and outputs</h1>
    <button type="button" class="sec listen-section-btn" data-listen-target="#formats" aria-pressed="false">Listen to this section</button>
  </div>
  <p class="lead">Open documents directly on your device, and download compact MP3s for WhatsApp, studio WAV audio, synced captions, or subtitled video.</p>

  <div class="answer-box">
    <strong>File sizes at a glance:</strong>
    <p><strong>64 kbps MP3</strong> (~28 MB per hour, best for mobile data and WhatsApp) · <strong>128 kbps MP3</strong> (~56 MB per hour) · <strong>WAV Audio</strong> (~170 MB per hour) · <strong>.SRT &amp; .VTT subtitles</strong> · <strong>16:9, 9:16 &amp; 1:1 videos</strong>.</p>
  </div>

  <div class="format-table-wrap">
    <table class="format-table">
      <thead>
        <tr>
          <th scope="col">Format / Output</th>
          <th scope="col">How It Helps You</th>
          <th scope="col">Best Used For</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>PDF (.pdf)</strong></td>
          <td>Reads text inside your browser and strips repeating page headers and numbers</td>
          <td>Textbooks, handouts, exam papers</td>
        </tr>
        <tr>
          <td><strong>EPUB (.epub)</strong></td>
          <td>Detects book chapters right on your device for easy section listening</td>
          <td>Chapter audiobooks and reading apps</td>
        </tr>
        <tr>
          <td><strong>Word (.docx)</strong></td>
          <td>Pulls out clean paragraphs without broken layout formatting</td>
          <td>Lecture notes, essays, scripts</td>
        </tr>
        <tr>
          <td><strong>Text &amp; Markdown (.txt, .md)</strong></td>
          <td>Paste or drop notes straight into the editor</td>
          <td>Short explanations, voiceovers, summaries</td>
        </tr>
        <tr>
          <td><strong>MP3 (64 kbps / 128 kbps)</strong></td>
          <td>About 28 MB per hour at 64 kbps, or 56 MB per hour at 128 kbps</td>
          <td>WhatsApp study groups and low-data phones</td>
        </tr>
        <tr>
          <td><strong>WAV Audio</strong></td>
          <td>Full uncompressed audio (~170 MB per hour)</td>
          <td>Podcast mastering and desktop editing</td>
        </tr>
        <tr>
          <td><strong>Subtitles &amp; Video (.SRT, .VTT, Video)</strong></td>
          <td>Aligned captions and burned-in 16:9, 9:16, or 1:1 video exports</td>
          <td>YouTube lectures, Shorts, Instagram Reels</td>
        </tr>
      </tbody>
    </table>
  </div>

  <details class="panel" id="techDetailsFold">
    <summary>Technical details: audio processing, captions &amp; models</summary>
    <p class="hint">Audio joins and caption timing run cleanly inside browser audio processing without clipping or drift:</p>
    <ul>
      <li><strong>Audio specifications:</strong> 24 kHz 16-bit mono PCM WAV, plus 64 kbps and 128 kbps CBR MPEG-1 Audio Layer III (MP3).</li>
      <li><strong>Smooth seam joins:</strong> Inter-chunk boundaries apply 24 ms raised-cosine seam fades, DC-bias removal, and 1,152-sample MPEG frame alignment so hour-long MP3s have zero audible clicks.</li>
      <li><strong>Caption timing:</strong> Every <code>.srt</code> and <code>.vtt</code> cue timestamp is computed directly from exact decoded PCM frame durations and your chosen silence gap rather than estimated reading speed.</li>
      <li><strong>Speech engine options:</strong> Selectable Gemini TTS models inside <a href="/app" data-page="app">Speech Studio</a>. Confirm general availability before high-volume commercial deployment.</li>
    </ul>
  </details>

  <p class="hint">See answers in <a href="/faq" data-page="faq">FAQ</a> or try a sample in <a href="/" data-page="tool">Home Try-It</a>.</p>
</section>`;

const FAQ_HTML = `<section id="faq" data-page-section="faq" class="legal">
  ${renderBreadcrumbs('FAQ', '/faq')}
  <div class="section-head-row">
    <h1 tabindex="-1">Frequently asked questions</h1>
    <button type="button" class="sec listen-section-btn" data-listen-target="#faq" aria-pressed="false">Listen to this section</button>
  </div>
  <p class="lead">Plain answers on document privacy, Urdu and English voices, WhatsApp-ready MP3 file sizes, subtitles, and free limits.</p>

  <div class="faq-list">
    <details class="faq-item" open>
      <summary>Can I test Voice Studio before signing in?</summary>
      <p>Yes. The Try-It box on the <a href="/" data-page="tool">home page</a> lets you listen to up to 300 characters or load a file excerpt with zero account required. Sign in at <a href="/app" data-page="app">/app</a> only when you want the 3,000-character daily allowance, downloadable MP3/WAV files, chapter ZIPs, or subtitled video.</p>
    </details>
    <details class="faq-item">
      <summary>How does Voice Studio skip page numbers and headers?</summary>
      <p>When Smart Document Cleanup is checked, Voice Studio inspects your PDF or EPUB on your device, removes repeated header and footer lines plus standalone page numbers, and rejoins broken hyphenated words before speaking.</p>
    </details>
    <details class="faq-item">
      <summary>How large is one hour of MP3 audio for WhatsApp?</summary>
      <p>At the default 64 kbps MP3 option, one full hour of clear speech audio is roughly 28 MB—small enough for quick downloads over mobile data and WhatsApp study groups.</p>
    </details>
    <details class="faq-item">
      <summary>Can Voice Studio handle Urdu and English mixed in one paragraph?</summary>
      <p>Yes. Urdu sentences and English technical terms are read smoothly in one pass. You can also save custom pronunciations for local names and acronyms inside the Pronunciation Dictionary without changing your original notes.</p>
    </details>
    <details class="faq-item">
      <summary>How do the 3,000 daily free characters, 10-minute Live AI Teacher, and Unlimited Mode work?</summary>
      <p>Every verified account gets 3,000 free Speech Studio characters plus 10 minutes of Live AI Teacher voice tutoring every day with zero setup. If you want unlimited audio exports or unlimited live tutoring, enable your own Google AI Studio Gemini API key inside Step 1 of <a href="/app" data-page="app">Speech Studio</a> (stored strictly in your browser).</p>
    </details>
    <details class="faq-item">
      <summary>Are my PDFs, MP3 files, or live voice chats stored on your server?</summary>
      <p>No. Documents stay inside browser memory and finished MP3/WAV exports stay on your device. Live microphone audio, optional page-camera snapshots, and text requests are streamed in real time to Google's Gemini API and are not permanently archived on Voice Studio servers (see <a href="/privacy" data-page="privacy">Privacy Policy</a>).</p>
    </details>
    <details class="faq-item">
      <summary>How does the Live AI Teacher avoid colliding with NVDA or TalkBack?</summary>
      <p>On <a href="/live-teacher" data-page="liveTeacher">Live AI Teacher</a>, you can use Tap Mic On/Off (<code>Ctrl+M</code>) or Push-to-Talk (<code>Space</code>) so screen-reader speech never leaks into the mic, press <code>Escape</code> to stop the teacher immediately, and keep live transcript announcements paused while the teacher speaks.</p>
    </details>
    <details class="faq-item">
      <summary>How do two-speaker podcasts and .SRT subtitles work?</summary>
      <p>Switch Narration Mode to Dialogue / 2 speakers, choose voices for Speaker A and Speaker B, and prefix lines with <code>Host:</code> and <code>Guest:</code>. Every finished recording automatically creates synced <code>.srt</code> and <code>.vtt</code> subtitle files.</p>
    </details>
    <details class="faq-item">
      <summary>What happens when a PDF is a scanned image?</summary>
      <p>Voice Studio warns you that no selectable text was found and lets you open <a href="/pdf-to-audio" data-page="pdfStudio">PDF &amp; Book Studio</a> to convert just the scanned pages you need, or show the printed page to the <a href="/live-teacher" data-page="liveTeacher">Live AI Teacher</a> camera scanner.</p>
    </details>
  </div>

  <p class="hint">Still stuck or spotted an accessibility issue? <a href="/contact" data-page="contact">Message the developer directly</a> or email <a href="mailto:moutther580@gmail.com">moutther580@gmail.com</a>.</p>
</section>`;

const ABOUT_HTML = `<section id="about" data-page-section="about" class="legal">
  ${renderBreadcrumbs('About Voice Studio', '/about')}
  <div class="section-head-row">
    <h1 tabindex="-1">About Voice Studio</h1>
    <button type="button" class="sec listen-section-btn" data-listen-target="#about" aria-pressed="false">Listen to this section</button>
  </div>
  <p class="lead">Built and operated by <strong>Moutter Rasool</strong>, a blind software developer in Faisalabad, Pakistan, so students and blind or low-vision readers can turn textbooks and notes into clean, accessible audio.</p>

  <h2>Why Voice Studio was created</h2>
  <p>Studying from PDFs and digital handouts often feels harder than it should: ordinary readers call out page numbers and repeating headers mid-sentence, trip over English terms inside Urdu notes, or export bulky files that burn through mobile data.</p>
  <p>Voice Studio removes that friction in an ad-free workspace where your documents stay on your device and export into compact MP3 chapters (~28 MB per hour), synchronized captions, and study videos.</p>

  <h2>Built for real accessibility (WCAG 2.1 AA)</h2>
  <ul>
    <li><strong>Screen-reader first:</strong> Built and tested with NVDA and TalkBack, with ordered headings, skip links, accessible dialogs, high-contrast themes, text scaling up to 200%, and a "Listen to this section" control on content pages.</li>
    <li><strong>Urdu &amp; English everyday study:</strong> Mixed Urdu-English notes read cleanly, backed by a custom Pronunciation Dictionary saved right in your browser.</li>
    <li><strong>Free daily start:</strong> Try a 300-character preview on the home page with no sign-in, use 3,000 free characters every day with a verified account, or bring your own Gemini API key anytime.</li>
  </ul>

  <h2>Developer &amp; direct contact</h2>
  <p>Operator: <strong>Moutter Rasool</strong>, Faisalabad, Pakistan.<br>Email: <a href="mailto:moutther580@gmail.com">moutther580@gmail.com</a> · Web form: <a href="/contact" data-page="contact">Contact page</a>.</p>
  <p class="hint">Voice Studio is an independent project and is not affiliated with Google LLC. Gemini is a trademark of Google LLC.</p>
</section>`;

const CONTACT_HTML = `<section id="contact" data-page-section="contact" class="legal">
  ${renderBreadcrumbs('Contact Us', '/contact')}
  <div class="section-head-row">
    <h1 tabindex="-1">Contact us</h1>
    <button type="button" class="sec listen-section-btn" data-listen-target="#contact" aria-pressed="false">Listen to this section</button>
  </div>
  <p class="lead">Send bug reports, screen-reader feedback, quota questions, or account deletion requests directly to developer <strong>Moutter Rasool</strong>.</p>

  <div class="answer-box">
    <strong>Direct Email</strong>
    <p>You can email <a href="mailto:moutther580@gmail.com">moutther580@gmail.com</a> directly from any mail app, or use the message form below. Messages are usually answered within 1–3 working days.</p>
  </div>

  <div class="card">
    <h2>Direct developer message</h2>
    <p class="hint">Messages save securely to the operator inbox without needing an external mail app.</p>

    <form id="contactForm" novalidate>
      <div class="row">
        <div>
          <label for="contactName">Full name</label>
          <input id="contactName" type="text" required minlength="2" maxlength="120" autocomplete="name" placeholder="Your full name">
        </div>
        <div>
          <label for="contactEmail">Reply email address</label>
          <input id="contactEmail" type="email" required maxlength="254" autocomplete="email" placeholder="yourname@example.com">
        </div>
      </div>

      <label for="contactSubject">Topic</label>
      <select id="contactSubject" required>
        <option value="Bug Report / Audio Issue">Bug Report / Audio Issue</option>
        <option value="Navigation, Keyboard & Layout Issue">Navigation, Keyboard &amp; Layout Issue</option>
        <option value="Account & Daily Quota Help">Account &amp; Daily Quota Help</option>
        <option value="Privacy / Account Deletion Request">Privacy / Account Deletion Request</option>
        <option value="Collaboration & Partnership">Collaboration &amp; Partnership</option>
        <option value="General Question">General Question</option>
      </select>

      <label for="contactMessage">Message (minimum 10 characters)</label>
      <textarea id="contactMessage" required minlength="10" maxlength="2000" placeholder="Describe the document format, browser, or step where an issue occurred…"></textarea>

      <div class="btn-group">
        <button id="contactSubmit" type="submit">Send message</button>
      </div>
      <p id="contactStatus" class="hint" tabindex="-1" role="status" aria-live="polite"></p>
      <p id="contactErr" class="hint err-msg" role="alert" aria-live="assertive"></p>
    </form>
  </div>

  <p class="hint">Operator: <strong>Moutter Rasool</strong> · Voice Studio, Faisalabad, Pakistan · <a href="mailto:moutther580@gmail.com">moutther580@gmail.com</a></p>
</section>`;

const PRIVACY_HTML = `<section id="privacy" data-page-section="privacy" class="legal">
  ${renderBreadcrumbs('Privacy Policy', '/privacy')}
  <div class="section-head-row">
    <h1 tabindex="-1">Privacy Policy</h1>
    <button type="button" class="sec listen-section-btn" data-listen-target="#privacy" aria-pressed="false">Listen to this section</button>
  </div>
  <p class="hint">Last updated: 20 November 2026 · Operator: Moutter Rasool (Faisalabad, Pakistan) · Contact: <a href="mailto:moutther580@gmail.com">moutther580@gmail.com</a></p>

  <h2>1. Documents and Exported Audio Stay on Your Device</h2>
  <p>Uploaded PDF, EPUB, Word (DOCX), Markdown, and TXT files are opened and cleaned locally inside your browser. Voice Studio does not upload your full books to file servers and does not store finished MP3, WAV, ZIP, subtitle, or video exports.</p>

  <h2>2. Speech, Live Microphone &amp; Optional Page-Camera Requests Sent to Google's Gemini API</h2>
  <p>When you generate neural speech audio, podcast scripts, scanned-page extractions, or start a live session on <a href="/live-teacher" data-page="liveTeacher">Live AI Teacher</a>, only the text excerpt, optional book-page camera image, or real-time microphone audio needed for that session is transmitted over encrypted HTTPS/WSS to Google's Gemini API under Google's Gemini API Terms of Service and Privacy Policy. Voice Studio does not archive raw microphone recordings or camera frames on its own servers. Do not submit highly confidential personal secrets you do not wish processed by Google's API.</p>

  <h2>3. Browser Preferences and Personal Keys (localStorage)</h2>
  <p>Display preferences—such as color theme, contrast mode, font scale, selected voice, Pronunciation Dictionary rules, and any personal Gemini API key you enter—are saved strictly in your browser's <code>localStorage</code>. Clearing browser site data or clicking <strong>Clear saved key</strong> deletes them immediately.</p>

  <h2>4. Account and Daily Allowance Records</h2>
  <p>When you create an account to use the 3,000-character daily allowance inside <a href="/app" data-page="app">Speech Studio (/app)</a> or the 10-minute daily free Live AI Teacher allowance on <a href="/live-teacher" data-page="liveTeacher">/live-teacher</a>, Firebase Authentication and Firestore store only your user ID, email address, verification state, daily character and live-minute usage counts, credit balance, referral status, and activity timestamps.</p>

  <h2>5. Advertising, Cookies, and Consent (Google AdSense)</h2>
  <p>Content pages and study guides are designed to display advertising served by Google AdSense and its third-party advertising partners. The <a href="/app" data-page="app">Speech Studio workspace (/app)</a>, <a href="/live-teacher" data-page="liveTeacher">Live AI Teacher (/live-teacher)</a>, sign-in screens, account pages, and contact pages never show ads.</p>
  <p>When advertising is active, Google and its partners use cookies or similar identifiers to serve ads based on your prior visits to this website or other websites on the Internet. You can opt out of personalized advertising anytime by visiting <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">Google Ads Settings</a> or <a href="https://myadcenter.google.com" target="_blank" rel="noopener noreferrer">My Ad Center</a>. Visitors in the EEA, the UK, and Switzerland will be presented with a Google-certified consent banner before personalized advertising cookies are set, and can review cookie choices via the footer <strong>Cookie &amp; Ad Preferences</strong> button.</p>

  <h2>6. Contact Messages</h2>
  <p>Messages sent through the <a href="/contact" data-page="contact">Contact page</a> or to <a href="mailto:moutther580@gmail.com">moutther580@gmail.com</a> store your name, reply email, topic, and message solely so the operator can respond and resolve support or accessibility issues. Messages are never sold or shared with marketers.</p>

  <h2>7. Data Retention</h2>
  <p>Account usage records and contact messages are kept only as long as your account remains active or as needed to enforce daily allowance fairness, prevent abuse, and maintain support records. Browser <code>localStorage</code> items stay on your device until cleared by you.</p>

  <h2>8. Children and Age Requirement (18 and Over)</h2>
  <p>Voice Studio uses Google's Gemini API and requires users creating accounts, generating speech, or starting Live AI Teacher sessions to be <strong>18 years of age or older</strong> (or have verifiable adult/guardian supervision where permitted by law). We do not knowingly collect personal account data from children under 18.</p>

  <h2>9. Your Rights and Data Deletion Requests</h2>
  <p>You may request access to or deletion of your account record and contact messages anytime by emailing <a href="mailto:moutther580@gmail.com">moutther580@gmail.com</a> or submitting a request via the <a href="/contact" data-page="contact">Contact page</a> under <em>Privacy / Account Deletion Request</em>.</p>
</section>`;

const TERMS_HTML = `<section id="terms" data-page-section="terms" class="legal">
  ${renderBreadcrumbs('Terms and Conditions', '/terms')}
  <div class="section-head-row">
    <h1 tabindex="-1">Terms and Conditions</h1>
    <button type="button" class="sec listen-section-btn" data-listen-target="#terms" aria-pressed="false">Listen to this section</button>
  </div>
  <p class="hint">Last updated: 20 November 2026 · Operator: Moutter Rasool (Faisalabad, Pakistan) · Governed by the laws of Pakistan</p>

  <h2>1. Acceptance of Terms and Minimum Age (18+)</h2>
  <p>By accessing or using Voice Studio (<code>https://voice-studio-three.vercel.app</code>), you agree to these Terms and Conditions and confirm that you are <strong>18 years of age or older</strong>. If you do not accept these terms, please discontinue use of the website.</p>

  <h2>2. Service Tiers, Advertising on Content Pages, and Availability</h2>
  <p>Voice Studio provides browser-based document preparation, a short public home-page preview, an ad-free Speech Studio workspace at <a href="/app" data-page="app">/app</a>, and an ad-free <a href="/live-teacher" data-page="liveTeacher">Live AI Teacher (/live-teacher)</a> for verified accounts (subject to 3,000 chars/day and 10 live minutes/day capacity limits) or visitors using their own Google AI Studio Gemini API key. Study guides and editorial pages may display advertising from Google AdSense to support hosting costs; tool workspaces stay ad-free.</p>

  <h2>3. No Guarantee of Pronunciation, Tutoring, or Transcription Accuracy</h2>
  <p>Automated text extraction, translations, live AI tutoring explanations, and AI voices can misread numbers, equations, symbols, scanned handwriting, or unfamiliar names. Voice Studio does not guarantee 100% accuracy. Always verify important academic, medical, legal, financial, or exam information directly against your original textbook or qualified human instructor.</p>

  <h2>4. Fair Use, Quota Integrity, and Account Termination</h2>
  <p>You agree not to register multiple accounts to bypass daily allowances, run automated bots against shared endpoints, scrape or probe restricted routes, or disrupt service for other learners. Voice Studio may suspend or terminate abusive accounts or restrict shared server access without prior notice.</p>

  <h2>5. Content Ownership, AI Copyrightability, and Synthetic Voice Notice</h2>
  <p>You retain ownership of the notes and source documents you already own or hold permission to convert, and you confirm you hold rights to process those materials. Note that under current copyright rules in the United States and several other jurisdictions, audio or text generated purely by AI may not qualify for exclusive copyright protection, and similar voices or phrasings may be generated for other users. Audio produced by Gemini models carries an inaudible SynthID watermark; follow the synthetic-media disclosure rules of any platform (such as YouTube, TikTok, or your school) where you publish generated clips.</p>

  <h2>6. Prohibited Conduct</h2>
  <p>Do not use Voice Studio to impersonate any person without consent, spread fraud, harassment, hate, malware, or copyright infringement, or violate applicable laws or Google's Gemini API Acceptable Use policies.</p>

  <h2>7. Warranty Disclaimer and Limitation of Liability</h2>
  <p>Voice Studio is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis without warranties of uptime or fitness for a particular purpose. To the fullest extent permitted by law, Voice Studio and Moutter Rasool are not liable for indirect, incidental, or consequential damages arising from use of the site.</p>

  <h2>8. Contact</h2>
  <p>Questions about these terms are handled via <a href="mailto:moutther580@gmail.com">moutther580@gmail.com</a> or the <a href="/contact" data-page="contact">Contact page</a> (Operator: Moutter Rasool, Faisalabad, Pakistan).</p>
</section>`;

const ACCOUNT_SHELL_HTML = `<section id="account" data-page-section="account" class="legal">
  <h1 tabindex="-1">Account workspace</h1>
  <p class="lead">Sign in with your verified account to view your daily allowance, credits, and usage history.</p>
  <div id="accountMount"></div>
  <div class="btn-group">
    <a href="/app" data-page="app" class="btn">Back to Speech Studio (/app)</a>
  </div>
</section>`;

const ADMIN_SHELL_HTML = `<section id="admin" data-page-section="admin" class="legal">
  <h1 tabindex="-1">Restricted workspace</h1>
  <p class="lead">Sign in with an authorized account to continue.</p>
  <div id="adminMount"></div>
</section>`;

const NOT_FOUND_HTML = `<section id="notFound" data-page-section="notFound" class="legal">
  ${renderBreadcrumbs('Page Not Found', '/404')}
  <h1 tabindex="-1">Page not found</h1>
  <p class="lead">We could not find that page. Choose one of the tools or guides below to continue.</p>
  <div class="btn-group">
    <a href="/" data-page="tool" class="btn">Go to Home (Try It Free)</a>
    <a href="/app" data-page="app" class="btn sec">Open Speech Studio (/app)</a>
    <a href="/pdf-to-audio" data-page="pdfStudio" class="btn sec">PDF &amp; Book Studio</a>
    <a href="/urdu-tts" data-page="urduTts" class="btn sec">Urdu &amp; English TTS</a>
    <a href="/guides" data-page="guides" class="btn sec">Guides &amp; Workflows</a>
  </div>
</section>`;

export const ROUTES = [
  {
    pageId: 'tool',
    path: '/',
    title: 'Voice Studio: Turn PDFs and Books into Urdu and English Audio',
    description:
      'Upload a PDF, EPUB, or Word file and get clean MP3 audio in Urdu or English. Free preview without sign-in, private in your browser.',
    breadcrumbLabel: 'Home',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: HOME_HTML,
  },
  {
    pageId: 'app',
    path: '/app',
    title: 'Speech Studio Workspace | Voice Studio',
    description:
      'Ad-free Voice Studio workspace for converting PDFs, EPUBs, and Urdu-English notes into MP3, WAV, Audiobook ZIPs, captions, and subtitled video.',
    breadcrumbLabel: 'Speech Studio',
    robots: 'noindex, nofollow',
    html: APP_WORKSPACE_SHELL_HTML,
  },
  {
    pageId: 'pdfStudio',
    path: '/pdf-to-audio',
    title: 'PDF to Audio Converter: Listen to Any Chapter as MP3',
    description:
      'Pick a chapter or page range from any PDF or book and turn it into clean MP3 audio. Page numbers and headers are removed automatically.',
    breadcrumbLabel: 'PDF & Book to Audio',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: PDF_STUDIO_HTML,
  },
  {
    pageId: 'urduTts',
    path: '/urdu-tts',
    title: 'Urdu Text to Speech Free: Natural Urdu and English Voices',
    description:
      'Convert Urdu, English, or mixed Urdu-English notes into natural speech. Fix pronunciation of names and terms. Free daily allowance.',
    breadcrumbLabel: 'Urdu Text to Speech',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: URDU_TTS_HTML,
  },
  {
    pageId: 'podcastStudio',
    path: '/podcast-studio',
    title: 'AI Podcast Maker: Turn Notes into a Two-Voice Podcast',
    description:
      'Turn lecture notes into a Host and Guest podcast with two AI voices, or translate a script into Urdu, English, Arabic, and more.',
    breadcrumbLabel: 'Podcast & Translator',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: PODCAST_STUDIO_HTML,
  },
  {
    pageId: 'videoSubtitles',
    path: '/video-subtitles',
    title: 'Audio to Subtitled Video: Urdu Captions for Reels and Shorts',
    description:
      'Make 16:9, 9:16, or 1:1 videos with synced Urdu or English subtitles from your audio. Download SRT and VTT files too.',
    breadcrumbLabel: 'Subtitled Videos',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: VIDEO_SUBTITLES_HTML,
  },
  {
    pageId: 'liveTeacher',
    path: '/live-teacher',
    title: 'Live AI Teacher in Urdu & English (Primary to PhD) | Voice Studio',
    description:
      'Real-time voice AI teacher for Pakistani blind, low-vision, and sighted students from Primary to PhD. Urdu and English explanations, 10 minutes free daily or unlimited with your own Gemini API key.',
    breadcrumbLabel: 'Live AI Teacher',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: LIVE_TEACHER_HTML,
  },
  {
    pageId: 'guides',
    path: '/guides',
    title: 'Guides: Make Clean Study Audio and Audiobooks',
    description:
      'Step-by-step guides for turning PDFs, books, and notes into clean audio, chapter audiobooks, and subtitled videos.',
    breadcrumbLabel: 'Guides',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: GUIDES_HTML,
  },
  {
    pageId: 'guidePdfAudio',
    path: '/guides/pdf-textbook-to-mp3-audio',
    title: 'How to Turn a PDF Textbook into MP3 Audio | Voice Studio',
    description:
      'Step-by-step guide to converting PDF textbooks into clean MP3 study audio with page numbers removed and chapters selected cleanly.',
    breadcrumbLabel: 'PDF Textbook to MP3',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: GUIDE_PDF_AUDIO_HTML,
  },
  {
    pageId: 'guideUrduMixed',
    path: '/guides/urdu-text-to-speech-mixed-english-terms',
    title: 'Urdu Text to Speech with Mixed English Terms | Voice Studio',
    description:
      'How to pronounce Urdu notes and English scientific terms accurately together using Pronunciation Dictionary rules and RTL Urdu subtitles.',
    breadcrumbLabel: 'Urdu & English Pronunciation',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: GUIDE_URDU_MIXED_HTML,
  },
  {
    pageId: 'guideBlindStudents',
    path: '/guides/blind-low-vision-students-audio-textbooks',
    title: 'Audio Textbooks for Blind & Low-Vision Students | Voice Studio',
    description:
      'Accessibility guide for listening to PDF and EPUB textbooks using NVDA, TalkBack, high contrast themes, and clean MP3 chapters.',
    breadcrumbLabel: 'Accessible Audio Textbooks',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: GUIDE_BLIND_STUDENTS_HTML,
  },
  {
    pageId: 'guideEpubChapters',
    path: '/guides/epub-chapter-by-chapter-audiobook',
    title: 'Make an Audiobook from an EPUB Chapter by Chapter | Voice Studio',
    description:
      'Split DRM-free EPUB books into numbered chapter MP3 tracks paired with synchronized caption files in one download.',
    breadcrumbLabel: 'EPUB Chapter Audiobook',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: GUIDE_EPUB_CHAPTERS_HTML,
  },
  {
    pageId: 'formats',
    path: '/formats',
    title: 'Supported Formats: PDF, EPUB, DOCX to MP3, WAV, SRT',
    description:
      'See which files Voice Studio reads and which audio, subtitle, and video formats it exports, with file sizes per hour.',
    breadcrumbLabel: 'Supported Formats',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: FORMATS_HTML,
  },
  {
    pageId: 'faq',
    path: '/faq',
    title: 'Voice Studio FAQ: Privacy, Urdu Voices, Limits, Subtitles',
    description:
      'Answers about privacy, Urdu and English voices, the free daily limit, your own Gemini key, subtitles, and scanned PDFs.',
    breadcrumbLabel: 'FAQ',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: FAQ_HTML,
  },
  {
    pageId: 'about',
    path: '/about',
    title: 'About Voice Studio: Built by a Blind Developer in Pakistan',
    description:
      'Voice Studio was built by Moutter Rasool, a blind developer from Faisalabad, to turn books and notes into clean, accessible audio.',
    breadcrumbLabel: 'About',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: ABOUT_HTML,
  },
  {
    pageId: 'contact',
    path: '/contact',
    title: 'Contact Voice Studio',
    description:
      'Send bug reports, feedback, quota questions, or account deletion requests directly to the developer.',
    breadcrumbLabel: 'Contact',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: CONTACT_HTML,
  },
  {
    pageId: 'privacy',
    path: '/privacy',
    title: 'Privacy Policy - Voice Studio',
    description:
      'How Voice Studio handles your files, Gemini API speech requests, browser storage, advertising cookies, and account records.',
    breadcrumbLabel: 'Privacy Policy',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: PRIVACY_HTML,
  },
  {
    pageId: 'terms',
    path: '/terms',
    title: 'Terms and Conditions - Voice Studio',
    description:
      'The terms for using Voice Studio, including age requirements, content-page ads, accuracy disclaimers, ownership, and fair use.',
    breadcrumbLabel: 'Terms and Conditions',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: TERMS_HTML,
  },
  {
    pageId: 'account',
    path: '/account',
    title: 'Account | Voice Studio',
    description: 'Sign in to manage your Voice Studio balance and usage.',
    breadcrumbLabel: 'Account',
    robots: 'noindex, nofollow',
    html: ACCOUNT_SHELL_HTML,
  },
  {
    pageId: 'admin',
    path: '/admin',
    title: 'Workspace | Voice Studio',
    description: 'Restricted Voice Studio workspace.',
    breadcrumbLabel: 'Workspace',
    robots: 'noindex, nofollow',
    html: ADMIN_SHELL_HTML,
  },
  {
    pageId: 'notFound',
    path: '/404',
    title: 'Page Not Found | Voice Studio',
    description: 'The requested page could not be found on Voice Studio.',
    breadcrumbLabel: '404',
    robots: 'noindex, nofollow',
    html: NOT_FOUND_HTML,
  },
];

export const ROUTE_BY_PATH = new Map(ROUTES.map((r) => [r.path, r]));
export const ROUTE_BY_PAGE_ID = new Map(ROUTES.map((r) => [r.pageId, r]));

export function normalizePathname(rawPathname) {
  if (!rawPathname || rawPathname === '/') return '/';
  const clean = '/' + rawPathname.replace(/^\/+|\/+$/g, '').toLowerCase();
  if (clean === '/index.html') return '/';
  return clean;
}

export function buildJsonLdForRoute(route, origin = SITE_ORIGIN) {
  const cleanOrigin = origin.replace(/\/+$/, '');
  const founderNode = {
    '@type': 'Person',
    '@id': `${cleanOrigin}/about#founder`,
    name: 'Moutter Rasool',
    url: `${cleanOrigin}/about`,
    email: 'mailto:moutther580@gmail.com',
    jobTitle: 'Software Developer',
    address: {
      '@type': 'PostalAddress',
      addressLocality: 'Faisalabad',
      addressCountry: 'PK',
    },
  };

  const webAppNode = {
    '@type': 'WebApplication',
    '@id': `${cleanOrigin}/#webapp`,
    name: 'Voice Studio',
    alternateName: 'The Page That Speaks — Voice Studio',
    url: `${cleanOrigin}/`,
    image: `${cleanOrigin}/og-card.jpg`,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'All',
    browserRequirements: 'Requires a modern web browser with JavaScript enabled',
    inLanguage: ['en', 'ur', 'ar', 'hi', 'de', 'es', 'fr'],
    description:
      'Turn PDF textbooks, EPUB books, Word files, and Urdu or English study notes into clean MP3 audio, synced subtitles, and study videos privately in your browser.',
    creator: founderNode,
    author: { '@id': `${cleanOrigin}/about#founder` },
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
  };

  const graph = [webAppNode];

  if (route.path !== '/' && route.pageId !== 'notFound') {
    const items = [{ '@type': 'ListItem', position: 1, name: 'Home', item: `${cleanOrigin}/` }];
    if (route.path.startsWith('/guides/')) {
      items.push({ '@type': 'ListItem', position: 2, name: 'Guides', item: `${cleanOrigin}/guides` });
      items.push({
        '@type': 'ListItem',
        position: 3,
        name: route.breadcrumbLabel,
        item: `${cleanOrigin}${route.path}`,
      });
    } else {
      items.push({
        '@type': 'ListItem',
        position: 2,
        name: route.breadcrumbLabel,
        item: `${cleanOrigin}${route.path}`,
      });
    }
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: items,
    });
  }

  if (route.path.startsWith('/guides/')) {
    graph.push({
      '@type': 'Article',
      headline: route.title.replace(/\s*\|\s*Voice Studio$/i, ''),
      description: route.description,
      datePublished: '2026-11-20',
      dateModified: '2026-11-20',
      author: { '@id': `${cleanOrigin}/about#founder` },
      publisher: { '@id': `${cleanOrigin}/about#founder` },
      mainEntityOfPage: `${cleanOrigin}${route.path}`,
      image: `${cleanOrigin}/og-card.jpg`,
    });
  }

  if (route.pageId === 'faq') {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Can I test Voice Studio before signing in?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. The Try-It box on the home page lets you listen to up to 300 characters or load a file excerpt without signing in. Sign in at /app only for the 3,000-character daily allowance, downloadable MP3/WAV files, chapter ZIPs, or video export.',
          },
        },
        {
          '@type': 'Question',
          name: 'How does Voice Studio skip page numbers and headers?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'When Smart Document Cleanup is checked, Voice Studio inspects your PDF or EPUB on your device, removes repeated header and footer lines plus standalone page numbers, and rejoins broken hyphenated words before speaking.',
          },
        },
        {
          '@type': 'Question',
          name: 'How large is one hour of MP3 audio for WhatsApp?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'At the default 64 kbps MP3 option, one full hour of clear speech audio is roughly 28 MB, small enough for quick downloads over mobile data and WhatsApp study groups.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can Voice Studio handle Urdu and English mixed in one paragraph?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes. Urdu sentences and English technical terms are read smoothly in one pass, and you can save custom pronunciations inside the Pronunciation Dictionary.',
          },
        },
        {
          '@type': 'Question',
          name: 'Are my PDFs or MP3 files stored on your server?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. Documents are opened inside browser memory and finished MP3, WAV, ZIP, subtitle, and video downloads stay strictly on your own device.',
          },
        },
      ],
    });
  }

  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph });
}

export function escapeHtmlAttr(val) {
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Transforms a built Vite index.html shell into the exact static HTML for any route.
 */
export function renderRouteHtml(templateHtml, route, origin = SITE_ORIGIN) {
  const cleanOrigin = origin.replace(/\/+$/, '');
  const canonicalUrl = `${cleanOrigin}${route.path === '/404' ? '' : route.path}`;
  const ogImageUrl = `${cleanOrigin}/og-card.jpg`;
  const jsonLd = buildJsonLdForRoute(route, cleanOrigin);

  const html = templateHtml
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtmlAttr(route.title)}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="description" content="${escapeHtmlAttr(route.description)}">`
    )
    .replace(
      /<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="robots" content="${escapeHtmlAttr(route.robots)}">`
    )
    .replace(
      /<link\s+id="canonicalLink"\s+rel="canonical"\s+href="[^"]*"\s*\/?>/i,
      `<link id="canonicalLink" rel="canonical" href="${escapeHtmlAttr(canonicalUrl)}">`
    )
    .replace(
      /<meta\s+id="ogUrl"\s+property="og:url"\s+content="[^"]*"\s*\/?>/i,
      `<meta id="ogUrl" property="og:url" content="${escapeHtmlAttr(canonicalUrl)}">`
    )
    .replace(
      /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:title" content="${escapeHtmlAttr(route.title)}">`
    )
    .replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:description" content="${escapeHtmlAttr(route.description)}">`
    )
    .replace(
      /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/i,
      `<meta property="og:image" content="${escapeHtmlAttr(ogImageUrl)}">`
    )
    .replace(
      /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:title" content="${escapeHtmlAttr(route.title)}">`
    )
    .replace(
      /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:description" content="${escapeHtmlAttr(route.description)}">`
    )
    .replace(
      /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="twitter:image" content="${escapeHtmlAttr(ogImageUrl)}">`
    )
    .replace(
      /<script\s+id="ldJsonScript"\s+type="application\/ld\+json">[\s\S]*?<\/script>/i,
      `<script id="ldJsonScript" type="application/ld+json">\n${jsonLd}\n</script>`
    )
    .replace(
      /<div\s+id="pageOutlet">[\s\S]*?<!--\/pageOutlet-->/i,
      `<div id="pageOutlet" data-rendered-page="${escapeHtmlAttr(route.pageId)}">${route.html}<!--/pageOutlet-->`
    );

  return html;
}
