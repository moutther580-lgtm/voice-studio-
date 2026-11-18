export const SITE_ORIGIN = 'https://voice-studio-three.vercel.app';

/**
 * Shared route registry used both by Vite dev/build prerendering and client-side navigation.
 * Rules enforced:
 * - Exactly ONE <h1> per route.
 * - Zero private screens (#authVerifyBox, #converterWorkspace, #account, #admin) in public HTML.
 * - Zero badge pills above headlines.
 * - Zero engineering/stack blueprints exposed in marketing copy.
 */

export const SAMPLE_CLIPS = {
  urdu: {
    id: 'urdu',
    label: 'Urdu Lecture',
    voiceLang: 'ur-PK',
    dir: 'rtl',
    lang: 'ur',
    script: 'آج کے سبق میں ہم یہ دیکھیں گے کہ کس طرح طویل نصابی کتابوں اور نوٹس کو صاف اور واضح اردو آڈیو میں تبدیل کیا جا سکتا ہے۔',
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

const HOME_HTML = `<section id="tool" data-page-section="tool">
  <div id="authGate">
    <div class="auth-hero-split">
      <div class="hero-copy-col">
        <div class="hero-heading-block">
          <h1 tabindex="-1">Your textbooks, read aloud in Urdu and English</h1>
          <p class="lead">Upload a PDF or book, pick a voice, download a small MP3. Your file never leaves your device.</p>
          <div class="btn-group">
            <button id="startConvertingFreeBtn" type="button">Try it free</button>
            <button id="hearSampleBtn" type="button" class="sec">Hear a sample</button>
          </div>
        </div>

        <figure class="hero-artwork">
          <img src="/images/kitaab-se-awaaz-hero.webp" alt="Open textbook turning into golden audio waves in ink blue and cream tones" width="840" height="520" decoding="async" fetchpriority="high">
          <figcaption class="hint">Kitaab se Awaaz — open any chapter and listen anywhere on mobile data.</figcaption>
        </figure>

        <div id="landingDropZone" class="drop-zone-hero" tabindex="0" role="region" aria-labelledby="dropZoneHeading">
          <h2 id="dropZoneHeading">Drop a PDF, EPUB, or Word file right here</h2>
          <p class="hint" id="landingDropStatus">No file yet. Drop a chapter here and inspect clean text in seconds—nothing leaves your device.</p>
          <div class="btn-group">
            <button id="landingPickFileBtn" type="button" class="sec">Choose PDF, EPUB, DOCX or TXT</button>
            <button id="landingPlayExcerptBtn" type="button" class="sec" hidden>Listen to extracted preview</button>
          </div>
          <input id="landingFileInput" type="file" accept=".pdf,.docx,.epub,.txt,.md,text/plain,application/pdf,application/epub+zip,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden aria-label="Choose a PDF, Word DOCX, EPUB, or text file to test locally">
          <p id="landingSampleTextPreview" class="drop-preview-excerpt" hidden></p>
        </div>
      </div>

      <div class="card auth-book-card" id="authCard" tabindex="-1">
        <div class="book-spine-rule" aria-hidden="true"></div>
        <h2>Open your Speech Studio</h2>
        <p class="hint">Sign in to activate <strong>3,000 free characters daily</strong>, full MP3/WAV downloads, chapter books, and subtitle video export—or use your own free Google AI Studio key anytime.</p>

        <div class="btn-group">
          <button id="googleSignIn" type="button" class="full">Continue with Google</button>
        </div>

        <div class="auth-tabs" role="group" aria-label="Email authentication mode">
          <button id="tabSignIn" type="button" aria-pressed="true">Sign in with Email</button>
          <button id="tabSignUp" type="button" aria-pressed="false">Create Account</button>
        </div>

        <form id="authForm" novalidate>
          <div id="authNameWrap" hidden>
            <label for="authName">Full name</label>
            <input id="authName" type="text" autocomplete="name" maxlength="120" placeholder="Your name">
          </div>
          <label for="authEmail">Email address</label>
          <input id="authEmail" type="email" autocomplete="email" required placeholder="you@example.com">
          <label for="authPass">Password (minimum 6 characters)</label>
          <input id="authPass" type="password" autocomplete="current-password" minlength="6" required placeholder="Enter password">
          <div class="btn-group">
            <button id="authSubmit" type="submit">Sign in</button>
            <button id="authReset" type="button" class="sec">Reset password</button>
          </div>
        </form>

        <p id="authMsg" class="hint" role="status" aria-live="polite"></p>
        <p class="trust-note"><strong>Your files stay with you:</strong> Books and handouts stay inside your browser and are never stored on our servers.</p>
      </div>
    </div>

    <section id="samplesSection" class="seo-band" aria-labelledby="samplesHeading">
      <h2 id="samplesHeading">Listen before you sign in</h2>
      <p class="lead">Hear how Voice Studio reads pure Urdu, clean English textbook prose, and mixed Urdu-English classroom notes.</p>
      <div class="sample-players-grid">
        ${renderSamplePlayerCard('urdu', '1. Urdu Lecture', 'Clear right-to-left Nastaliq reading')}
        ${renderSamplePlayerCard('english', '2. English Chapter', 'Steady pace with headers removed')}
        ${renderSamplePlayerCard('mixed', '3. Mixed Urdu-English Notes', 'Smooth switching on one line')}
      </div>
      <p id="samplePlaybackStatus" class="hint" role="status" aria-live="polite"></p>
    </section>

    <section class="seo-band" aria-labelledby="cleanupDiffHeading">
      <h2 id="cleanupDiffHeading">Hear the difference: raw PDF vs. clean audio</h2>
      <p class="lead">Ordinary readers read every page number, running book title, and bracket citation out loud. Voice Studio sweeps them away before creating your MP3.</p>
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
    </section>

    <section class="seo-band founder-story-band" aria-labelledby="founderHeading">
      <div class="margin-note-card">
        <h2 id="founderHeading">Built by someone who listens to every book</h2>
        <p class="lead">Voice Studio was created by <strong>Moutter Rasool</strong>, a blind software developer in Faisalabad, Pakistan, who depends on spoken textbooks and technical notes every day.</p>
        <p>When existing readers choked on Urdu script mixed with English headings, read footer numbers aloud fifty times per chapter, or created giant audio files that took forever to share on WhatsApp, he built the tool he wished students in Pakistan already had—keyboard-first, screen-reader tested, and free to start daily.</p>
        <p><a href="/about" data-page="about">Read the founder story and accessibility mission</a></p>
      </div>
    </section>

    <section class="seo-band" aria-labelledby="toolsHeading">
      <h2 id="toolsHeading">Three tools inside one studio</h2>
      <p class="lead">Start from a long book, turn lecture outlines into two speakers, or export subtitled study clips.</p>

      <div class="capability-ledger">
        <article class="capability-card capability-lead">
          <div>
            <h3><a href="/pdf-to-audio" data-page="pdfStudio">Books to Audio (PDF, EPUB &amp; Word)</a></h3>
            <p>Pick only the chapter or page span you need—even from scanned PDFs—and skip repeating headers so your MP3 sounds like a real audiobook.</p>
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
          <p>Turn class notes into a natural two-voice Host and Guest conversation, or adapt scripts across Urdu, English, Arabic, and more with custom pronunciation rules.</p>
          <p class="hint"><a href="/urdu-tts" data-page="urduTts">Explore Urdu &amp; English voice tips</a></p>
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

    <section class="seo-band" aria-labelledby="howItWorksHeading">
      <h2 id="howItWorksHeading">How it works in three steps</h2>
      <ol class="editorial-steps">
        <li>
          <strong>1. Upload or paste</strong>
          <p>Drop a PDF textbook, EPUB book, Word document, or paste Urdu and English study notes directly in your browser.</p>
        </li>
        <li>
          <strong>2. Choose your voice</strong>
          <p>Pick a single narrator or two speakers, fix tricky names in the Pronunciation Dictionary, and choose small MP3 or full WAV quality.</p>
        </li>
        <li>
          <strong>3. Download and listen</strong>
          <p>Preview first, then save your MP3 (~28 MB per hour for WhatsApp sharing), chapter ZIP, caption files, or subtitled video.</p>
        </li>
      </ol>
    </section>

    <section class="seo-band" aria-labelledby="privacyPromiseHeading">
      <div class="answer-box">
        <h2 id="privacyPromiseHeading">Your PDF never leaves your device</h2>
        <p>Voice Studio reads PDF, EPUB, and Word files right inside your browser. Original documents and finished MP3 downloads are never saved on external file servers. <a href="/privacy" data-page="privacy">Read the full Privacy Policy</a>.</p>
      </div>
    </section>

    <section class="seo-band" aria-labelledby="whoForHeading">
      <h2 id="whoForHeading">Who Voice Studio is built for</h2>
      <div class="audience-grid">
        <div class="audience-item">
          <h3>Matric, FA/FSc &amp; university students</h3>
          <p>Revise long handouts while commuting and share lightweight 28 MB/hour MP3 chapters inside WhatsApp study groups.</p>
        </div>
        <div class="audience-item">
          <h3>Blind &amp; low-vision learners</h3>
          <p>Navigate every button cleanly with NVDA, TalkBack, VoiceOver, or keyboard-only focus controls and customizable text scaling.</p>
        </div>
        <div class="audience-item">
          <h3>Teachers &amp; YouTube creators</h3>
          <p>Turn lesson plans into two-voice explainers and export vertical 9:16 or widescreen 16:9 study videos with synced Urdu captions.</p>
        </div>
      </div>
    </section>

    <section class="seo-band" aria-labelledby="homeFaqHeading">
      <h2 id="homeFaqHeading">Quick answers</h2>
      <div class="faq-list">
        <details class="faq-item" open>
          <summary>How does Voice Studio skip page numbers and headers?</summary>
          <p>Smart document cleanup checks your PDF or EPUB locally, drops repeated top and bottom lines plus standalone page numbers, and rejoins broken words before voicing.</p>
        </details>
        <details class="faq-item">
          <summary>How small is a one-hour MP3 file for WhatsApp?</summary>
          <p>At the default speech MP3 setting, one hour of clear voice audio is around 28 MB—small enough for mobile data and WhatsApp or Telegram study groups.</p>
        </details>
        <details class="faq-item">
          <summary>Does it read Urdu and English mixed in one sentence?</summary>
          <p>Yes. You can keep Urdu prose and English scientific or IT words together, and teach custom pronunciations in the dictionary without changing your source text.</p>
        </details>
        <details class="faq-item">
          <summary>What if a PDF is a scanned image?</summary>
          <p>Voice Studio tells you right away and lets you open <a href="/pdf-to-audio" data-page="pdfStudio">PDF &amp; Book Studio</a> to read just the scanned pages you need.</p>
        </details>
        <details class="faq-item">
          <summary>How much can I convert for free?</summary>
          <p>Verified accounts receive 3,000 free characters every day. For whole textbooks, you can also paste your own free Gemini API key directly in your browser.</p>
        </details>
      </div>
      <p class="hint"><a href="/faq" data-page="faq">Read all frequently asked questions</a> or browse <a href="/guides" data-page="guides">step-by-step study guides</a>.</p>
    </section>

    <section class="seo-band cta-band" aria-labelledby="finalCtaHeading">
      <h2 id="finalCtaHeading">Start listening to your books today</h2>
      <p class="lead">Sign in for 3,000 free characters daily—no credit card required.</p>
      <div class="btn-group">
        <button id="finalCtaSignInBtn" type="button">Start free in Speech Studio</button>
        <a class="btn sec" href="/guides/blind-low-vision-students-audio-textbooks" data-page="guideBlindStudents">Guide for blind &amp; low-vision learners</a>
      </div>
    </section>
  </div>
</section>`;

const PDF_STUDIO_HTML = `<section id="pdfStudio" data-page-section="pdfStudio" class="legal">
  ${renderBreadcrumbs('PDF & Book to Audio', '/pdf-to-audio')}
  <h1 tabindex="-1">Turn any PDF chapter into clean audio</h1>
  <p class="lead">Pick a chapter or page range from any textbook, EPUB book, or scanned PDF and convert just the section you need—with page numbers and headers removed automatically.</p>

  <div class="card" id="pdfAgentPanel">
    <h2>Extract and convert selected chapters or pages</h2>
    <p class="hint" id="pdfStudioFileInfo">No file loaded yet. Choose a PDF, EPUB, DOCX, or TXT file below (everything stays on your device).</p>

    <div class="btn-group">
      <button id="pdfAgentPickFileBtn" type="button" class="sec">Choose PDF, EPUB or DOCX file</button>
      <a href="/" data-page="tool" class="btn sec">Go to Speech Studio</a>
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
      <span>Switch to Speech Studio and start generating audio right after extraction</span>
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
      <p>Instead of spending daily quota on table-of-contents pages, bibliographies, and repeating running titles, target the exact pages you are revising tonight.</p>
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
  <h1 tabindex="-1">Urdu text to speech that understands English words too</h1>
  <p class="lead">Built for Pakistani students, teachers, and creators whose notes move freely between Urdu sentences and English technical or scientific terms.</p>

  <div class="answer-box">
    <strong>Recommended Setup for Bilingual Notes:</strong>
    <p>Choose the default speech voice model (<code>Gemini 3.1 Flash TTS Preview</code>) with compact speech MP3 (~28 MB per hour) so full lectures download cleanly on mobile data and share smoothly in WhatsApp groups.</p>
  </div>

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
    <a href="/" data-page="tool" class="btn">Convert Urdu notes in Speech Studio</a>
    <a href="/guides/urdu-text-to-speech-mixed-english-terms" data-page="guideUrduMixed" class="btn sec">Read the Urdu pronunciation guide</a>
  </div>
</section>`;

const PODCAST_STUDIO_HTML = `<section id="podcastStudio" data-page-section="podcastStudio" class="legal">
  ${renderBreadcrumbs('Podcast & Translator', '/podcast-studio')}
  <h1 tabindex="-1">Turn your notes into a two-voice podcast</h1>
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
  <h1 tabindex="-1">Make subtitled videos from your audio</h1>
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

  <h2>Subtitles that never drift out of sync</h2>
  <p>Captions are timed using the real finished duration of every spoken part rather than an estimated word-per-minute guess—so even hour-long books stay accurately aligned from start to finish.</p>

  <div class="btn-group">
    <a href="/" data-page="tool" class="btn">Generate audio and video in Speech Studio</a>
    <a href="/formats" data-page="formats" class="btn sec">Compare audio formats</a>
  </div>
</section>`;

const GUIDES_HTML = `<section id="guides" data-page-section="guides" class="legal">
  ${renderBreadcrumbs('Guides & Workflows', '/guides')}
  <h1 tabindex="-1">Guides and workflows</h1>
  <p class="lead">Clear, step-by-step instructions for turning textbooks, mixed Urdu-English handouts, and EPUB books into clean MP3 audio and study videos.</p>

  <div class="guide-cards-grid">
    <article class="card">
      <h2><a href="/guides/pdf-textbook-to-mp3-audio" data-page="guidePdfAudio">1. How to turn a PDF textbook into MP3 audio (step by step)</a></h2>
      <p>Clean out repeating headers and page numbers automatically, pick the right chapter or page span, and save compact MP3s ready for mobile phones.</p>
    </article>

    <article class="card">
      <h2><a href="/guides/urdu-text-to-speech-mixed-english-terms" data-page="guideUrduMixed">2. Urdu text to speech: how to get correct pronunciation of English terms</a></h2>
      <p>Set up natural mixed Urdu-English reading, fix technical acronyms and teacher names in your dictionary, and keep source notes untouched.</p>
    </article>

    <article class="card">
      <h2><a href="/guides/blind-low-vision-students-audio-textbooks" data-page="guideBlindStudents">3. How blind and low-vision students can listen to their textbooks</a></h2>
      <p>Keyboard shortcuts, NVDA &amp; TalkBack tips, high-contrast themes, and turning noisy study PDFs into jumpable chapter audiobooks.</p>
    </article>

    <article class="card">
      <h2><a href="/guides/epub-chapter-by-chapter-audiobook" data-page="guideEpubChapters">4. How to make an audiobook from an EPUB, chapter by chapter</a></h2>
      <p>Split DRM-free ebooks cleanly, verify voice flow with a short preview, and export numbered chapter MP3 files paired with synced captions.</p>
    </article>
  </div>

  <p class="hint">Need quick answers on file sizes or accounts? Check <a href="/formats" data-page="formats">Supported Formats</a> or <a href="/faq" data-page="faq">FAQ</a>.</p>
</section>`;

const GUIDE_PDF_AUDIO_HTML = `<section id="guidePdfAudio" data-page-section="guidePdfAudio" class="legal">
  ${renderBreadcrumbs('PDF Textbook to MP3 Guide', '/guides/pdf-textbook-to-mp3-audio')}
  <h1 tabindex="-1">How to turn a PDF textbook into MP3 audio (step by step)</h1>
  <p class="lead">Turn dense university PDFs, exam handouts, and scanned notes into clean, lightweight MP3 audio you can listen to offline—without page numbers interrupting every paragraph.</p>

  <div class="answer-box">
    <strong>Quick summary:</strong>
    <p>Upload your PDF in your browser (nothing is stored on a server), keep <strong>Smart document cleanup</strong> checked, pick your target chapter or page span, preview 200 characters, and download a compact ~28 MB/hour MP3.</p>
  </div>

  <h2>Why normal PDF readers sound distracting</h2>
  <p>Academic books repeat journal titles, author names, chapter footers, and page numbers at the top or bottom of every single page. When a regular screen reader or voice app reads a 60-page PDF aloud, those lines repeat 60 times mid-sentence. Even worse, words broken across line endings with hyphens often get split into two awkward halves.</p>
  <p>Voice Studio inspects each page on your device before creating speech: repeating headers and footers disappear, standalone page numbers are skipped, and hyphenated words rejoin cleanly so sentences flow naturally.</p>

  <h2>Step-by-step: Turn any PDF into clean MP3 audio</h2>
  <ol class="editorial-steps">
    <li>
      <strong>1. Sign in or open your Speech Studio</strong>
      <p>Sign in with Google or verified email to activate <strong>3,000 free characters daily</strong>, or enable your own free Gemini API key in Step 1 for longer books.</p>
    </li>
    <li>
      <strong>2. Drop your PDF (staying private on your device)</strong>
      <p>In Speech Studio or <a href="/pdf-to-audio" data-page="pdfStudio">PDF &amp; Book Studio</a>, pick any PDF up to 30 MB. Keep <em>Smart document cleanup</em> ticked so page numbers and footers are filtered automatically.</p>
    </li>
    <li>
      <strong>3. Choose only the pages or chapter you need</strong>
      <p>Need pages 14 to 22 or just Chapter 4? Open <a href="/pdf-to-audio" data-page="pdfStudio">PDF &amp; Book Studio</a> and type <code>Chapter 4</code> or <code>pages 14-22</code> so you never spend allowance on bibliographies or index pages.</p>
    </li>
    <li>
      <strong>4. Pick compact 64 kbps MP3 for phones &amp; WhatsApp</strong>
      <p>Leave MP3 quality at 64 kbps for lecture listening (~28 MB per full hour), or switch to 128 kbps / WAV if you plan to edit the recording in video software.</p>
    </li>
    <li>
      <strong>5. Preview 200 characters, then export</strong>
      <p>Press <strong>Preview first 200 characters</strong> to confirm pronunciation, then press <strong>Generate audio</strong>. Open the Export popup to download MP3, <code>.srt</code> subtitles, or a video clip.</p>
    </li>
  </ol>

  <h2>What if your PDF is a scanned image?</h2>
  <p>Old textbooks and photographed notes are sometimes saved as flat pictures with no selectable text. When you drop a scanned PDF, Voice Studio spots it right away and lets you convert specific scanned pages through <a href="/pdf-to-audio" data-page="pdfStudio">PDF &amp; Book Studio</a> without converting the whole file blindly.</p>

  <h2>Frequently asked questions about PDF to audio</h2>
  <div class="faq-list">
    <details class="faq-item" open>
      <summary>Can I convert a 200-page textbook without exceeding my daily limit?</summary>
      <p>Yes. Convert one chapter at a time using your daily 3,000 free characters, or connect your own free Google AI Studio Gemini API key inside your browser for longer sessions.</p>
    </details>
    <details class="faq-item">
      <summary>Will anyone else see my uploaded textbook PDF?</summary>
      <p>No. The PDF is parsed directly in browser memory; only the clean text chunk currently being spoken is sent over HTTPS to create audio and is never archived.</p>
    </details>
  </div>

  <div class="btn-group">
    <a href="/pdf-to-audio" data-page="pdfStudio" class="btn">Convert a PDF to audio now</a>
    <a href="/guides" data-page="guides" class="btn sec">All study guides</a>
  </div>
</section>`;

const GUIDE_URDU_MIXED_HTML = `<section id="guideUrduMixed" data-page-section="guideUrduMixed" class="legal">
  ${renderBreadcrumbs('Urdu & Mixed English Pronunciation Guide', '/guides/urdu-text-to-speech-mixed-english-terms')}
  <h1 tabindex="-1">Urdu text to speech: how to get correct pronunciation of English terms</h1>
  <p class="lead">Make mixed Urdu and English lecture notes sound clear and natural, teach the narrator names and technical acronyms once, and keep your written text clean.</p>

  <div class="answer-box">
    <strong>Why mixed text needs care:</strong>
    <p>Pakistani class notes combine Nastaliq Urdu sentences with English science, IT, and medical vocabulary. Voice Studio reads both scripts in one pass and lets you fix tricky terms in a saved browser dictionary.</p>
  </div>

  <h2>Listen to mixed Urdu &amp; English in action</h2>
  <div class="sample-players-grid">
    ${renderSamplePlayerCard('urdu', 'Pure Urdu Passage', 'Calm narrator for Urdu prose')}
    ${renderSamplePlayerCard('mixed', 'Mixed Urdu & English Handout', 'Smooth bilingual code-switching')}
  </div>
  <p id="samplePlaybackStatus" class="hint" role="status" aria-live="polite"></p>

  <h2>Steps to get clean bilingual pronunciation</h2>
  <ol class="editorial-steps">
    <li>
      <strong>1. Keep Urdu and English naturally punctuated</strong>
      <p>Use Urdu full stops (<code>۔</code>) and English periods cleanly. Clear sentence endings tell the speech engine where to pause naturally.</p>
    </li>
    <li>
      <strong>2. Map acronyms &amp; names in your Pronunciation Dictionary</strong>
      <p>In Step 1 of Speech Studio, open <strong>Pronunciation dictionary</strong>. Add rules like mapping <code>Dr.</code> to <code>Doctor</code>, <code>Eq.</code> to <code>Equation</code>, or unusual proper nouns to how they actually sound.</p>
    </li>
    <li>
      <strong>3. Match whole words carefully</strong>
      <p>Leave <em>Match whole word only</em> checked for short abbreviations like <code>AI</code> or <code>OS</code> so ordinary English or Roman Urdu words are never altered by accident.</p>
    </li>
    <li>
      <strong>4. Choose a balanced bilingual voice</strong>
      <p>Voices such as <strong>Kore</strong>, <strong>Charon</strong>, and <strong>Puck</strong> handle code-switching between Urdu phrasing and English nouns cleanly. Test one short line with <em>Test selected voice</em> before converting long chapters.</p>
    </li>
    <li>
      <strong>5. Export with synced RTL Urdu captions</strong>
      <p>When creating Reels or study videos, Urdu lines automatically display right-to-left so students reading along see natural typography rather than reversed characters.</p>
    </li>
  </ol>

  <h2>Frequently asked questions</h2>
  <div class="faq-list">
    <details class="faq-item" open>
      <summary>Does the Pronunciation Dictionary change my original notes?</summary>
      <p>No. Replacements happen only when speech is generated, leaving your pasted notes and extracted PDF text completely unchanged.</p>
    </details>
    <details class="faq-item">
      <summary>Are my custom rules saved for next time?</summary>
      <p>Yes. Rules stay stored locally in your browser so your course acronyms and teachers’ names stay ready whenever you open Speech Studio.</p>
    </details>
  </div>

  <div class="btn-group">
    <a href="/urdu-tts" data-page="urduTts" class="btn">Try Urdu Text to Speech</a>
    <a href="/guides" data-page="guides" class="btn sec">Browse all guides</a>
  </div>
</section>`;

const GUIDE_BLIND_STUDENTS_HTML = `<section id="guideBlindStudents" data-page-section="guideBlindStudents" class="legal">
  ${renderBreadcrumbs('Guide for Blind & Low-Vision Students', '/guides/blind-low-vision-students-audio-textbooks')}
  <h1 tabindex="-1">How blind and low-vision students can listen to their textbooks</h1>
  <p class="lead">Practical tips for using Voice Studio with NVDA on Windows, TalkBack on Android, high-contrast display modes, and distraction-free chapter MP3 exports.</p>

  <div class="answer-box">
    <strong>Designed by a blind developer:</strong>
    <p>Every button, drawer, dialog, and progress indicator in Voice Studio is built for keyboard navigation and screen readers first—not patched on afterward.</p>
  </div>

  <h2>Why a dedicated audiobook MP3 beats reading PDFs raw</h2>
  <p>Even with an excellent screen reader, studying from multi-column academic PDFs or Urdu handouts can feel exhausting. Page numbers interrupt paragraphs, headers read repeatedly, and switching between apps drains phone batteries during exam week. Converting your textbook into clean chapter MP3s lets you listen offline at 1.25x or 1.5x speed with zero interruptions.</p>

  <h2>Accessibility workflow step by step</h2>
  <ol class="editorial-steps">
    <li>
      <strong>1. Customize contrast, text scale, and spacing immediately</strong>
      <p>Select the <strong>Accessibility</strong> button at the top of any page (or press <code>Tab</code> from Skip to main content). Choose Black &amp; Yellow or White &amp; Black high contrast, increase text size up to 200%, turn on thicker focus outlines, and reduce motion.</p>
    </li>
    <li>
      <strong>2. Navigate cleanly by headings and regions</strong>
      <p>Every public page uses one clear <code>h1</code> heading followed by ordered <code>h2</code> sections and labeled controls. Modal drawers and the Export popup trap focus cleanly until closed with <code>Escape</code>.</p>
    </li>
    <li>
      <strong>3. Let Smart Cleanup remove visual page clutter</strong>
      <p>Keep <em>Smart document cleanup</em> enabled in Speech Studio so repeated running titles and standalone page numbers are stripped out automatically before narration.</p>
    </li>
    <li>
      <strong>4. Track spoken progress with live announcements</strong>
      <p>During audio generation, progress updates announce clearly through polite live regions without stealing keyboard focus away from your controls.</p>
    </li>
    <li>
      <strong>5. Download compact chapter MP3s for phone listening</strong>
      <p>Export chapter-by-chapter ZIP archives or compact ~28 MB/hour MP3 files so your whole semester fits easily on Android or in WhatsApp saved messages.</p>
    </li>
  </ol>

  <h2>Share feedback directly with the developer</h2>
  <p>If any button label, screen-reader announcement, or keyboard path can be smoother in NVDA, JAWS, TalkBack, or VoiceOver, message Moutter Rasool directly on the <a href="/contact" data-page="contact">Contact page</a>.</p>

  <div class="btn-group">
    <a href="/" data-page="tool" class="btn">Open Speech Studio</a>
    <a href="/about" data-page="about" class="btn sec">Read about the founder</a>
  </div>
</section>`;

const GUIDE_EPUB_CHAPTERS_HTML = `<section id="guideEpubChapters" data-page-section="guideEpubChapters" class="legal">
  ${renderBreadcrumbs('EPUB Chapter Audiobook Guide', '/guides/epub-chapter-by-chapter-audiobook')}
  <h1 tabindex="-1">How to make an audiobook from an EPUB, chapter by chapter</h1>
  <p class="lead">Turn DRM-free EPUB books into cleanly split chapter audio files and synchronized captions—and bundle a complete book into one organized Audiobook ZIP.</p>

  <div class="answer-box">
    <strong>What you get:</strong>
    <p>Each chapter becomes a cleanly numbered audio track (<code>01-chapter-one.mp3</code>) paired with a synchronized <code>.srt</code> caption file and an index text file inside one ZIP archive.</p>
  </div>

  <h2>Step-by-step: EPUB to chaptered audiobook</h2>
  <ol class="editorial-steps">
    <li>
      <strong>1. Open a DRM-free EPUB file locally</strong>
      <p>Load your <code>.epub</code> file in Speech Studio. Chapters are read from the book’s internal table of contents right inside your browser without uploading the book.</p>
    </li>
    <li>
      <strong>2. Pick a single chapter or review detected sections</strong>
      <p>When multiple chapters are detected, the chapter selector appears automatically. Load just one chapter to test or export a single section using your daily free allowance.</p>
    </li>
    <li>
      <strong>3. Choose a storytelling voice and calm style</strong>
      <p>Try presets such as <em>Warm audiobook storyteller</em> or <em>Slow, clear &amp; calm narrator</em>. Keep MP3 at 64 kbps for lightweight mobile audiobooks (~28 MB per hour) or 128 kbps for higher clarity.</p>
    </li>
    <li>
      <strong>4. Add character or place name rules</strong>
      <p>If your novel or textbook uses unfamiliar historical or fictional names, add quick phonetic fixes in the Pronunciation Dictionary before generating all chapters.</p>
    </li>
    <li>
      <strong>5. Export all chapters as an Audiobook ZIP</strong>
      <p>Select <strong>Export all chapters as Audiobook ZIP</strong>. Wait as chapters finish sequentially with seamless joins and download the finished archive to any phone or audiobook player.</p>
    </li>
  </ol>

  <h2>Frequently asked questions</h2>
  <div class="faq-list">
    <details class="faq-item" open>
      <summary>Do you support password-locked or DRM-protected store ebooks?</summary>
      <p>No. Only DRM-free EPUB files you hold permission to read can be opened inside your browser.</p>
    </details>
    <details class="faq-item">
      <summary>Can I split plain pasted text or PDFs into chapters too?</summary>
      <p>Yes. Click <strong>Split into chapters</strong> in Speech Studio to divide any document containing chapter headings or long study sections.</p>
    </details>
  </div>

  <div class="btn-group">
    <a href="/pdf-to-audio" data-page="pdfStudio" class="btn">Try Books to Audio</a>
    <a href="/formats" data-page="formats" class="btn sec">Check supported file formats</a>
  </div>
</section>`;

const FORMATS_HTML = `<section id="formats" data-page-section="formats">
  ${renderBreadcrumbs('Supported Formats', '/formats')}
  <h1 tabindex="-1">Supported formats and outputs</h1>
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
    <summary>For the technical folks: Audio &amp; Subtitle Specifications</summary>
    <p class="hint">Audio joins and caption timing run cleanly inside browser audio processing without clipping or drift:</p>
    <ul>
      <li><strong>Audio formats:</strong> 24 kHz 16-bit mono PCM WAV, plus 64 kbps and 128 kbps CBR MPEG-1 Audio Layer III (MP3).</li>
      <li><strong>Smooth part joins:</strong> Inter-chunk boundaries apply 24 ms raised-cosine seam fade-in/fade-out and DC-bias removal, aligned cleanly to 1,152-sample MPEG frames so hour-long MP3s have zero audible clicks.</li>
      <li><strong>Caption timing:</strong> Every <code>.srt</code> and <code>.vtt</code> cue timestamp is computed directly from exact decoded PCM frame durations and your chosen inter-part silence gap rather than estimated reading speed.</li>
      <li><strong>Speech models:</strong> Powered by selectable Gemini TTS speech models defaulting to <code>gemini-3.1-flash-tts-preview</code> with automatic fallback options.</li>
    </ul>
  </details>

  <p class="hint">See answers in <a href="/faq" data-page="faq">FAQ</a> or try a sample in <a href="/" data-page="tool">Speech Studio</a>.</p>
</section>`;

const FAQ_HTML = `<section id="faq" data-page-section="faq" class="legal">
  ${renderBreadcrumbs('FAQ', '/faq')}
  <h1 tabindex="-1">Frequently asked questions</h1>
  <p class="lead">Plain answers on document privacy, Urdu and English voices, WhatsApp-ready MP3 file sizes, subtitles, and free limits.</p>

  <div class="faq-list">
    <details class="faq-item" open>
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
      <summary>How do the 3,000 daily free characters and Unlimited Mode work?</summary>
      <p>Every verified account gets 3,000 free characters every day with zero setup. If you want to convert long chapters or full books at once, open Step 1 and paste your own free Gemini API key (saved strictly inside your browser).</p>
    </details>
    <details class="faq-item">
      <summary>Are my PDFs, books, or MP3 files saved on external servers?</summary>
      <p>No. Documents are opened inside browser memory and finished MP3, WAV, ZIP, subtitle, and video downloads stay strictly on your own device.</p>
    </details>
    <details class="faq-item">
      <summary>How do two-speaker podcasts and .SRT subtitles work?</summary>
      <p>Switch Narration Mode to Dialogue / 2 speakers, choose voices for Speaker A and Speaker B, and prefix lines with <code>Host:</code> and <code>Guest:</code>. Every finished recording automatically creates synced <code>.srt</code> and <code>.vtt</code> subtitle files.</p>
    </details>
    <details class="faq-item">
      <summary>What happens when a PDF is a scanned image?</summary>
      <p>Voice Studio warns you that no selectable text was found and lets you open <a href="/pdf-to-audio" data-page="pdfStudio">PDF &amp; Book Studio</a> to convert just the scanned pages you need.</p>
    </details>
  </div>

  <p class="hint">Still stuck or spotted an accessibility issue? <a href="/contact" data-page="contact">Message the developer directly</a>.</p>
</section>`;

const ABOUT_HTML = `<section id="about" data-page-section="about" class="legal">
  ${renderBreadcrumbs('About Voice Studio', '/about')}
  <h1 tabindex="-1">About Voice Studio</h1>
  <p class="lead">Built by <strong>Moutter Rasool</strong>, a blind software developer in Faisalabad, Pakistan, so students and blind or low-vision readers can turn textbooks and notes into clean, accessible audio.</p>

  <h2>Why Voice Studio was created</h2>
  <p>Studying from PDFs and digital handouts often feels harder than it should: ordinary readers call out page numbers and repeating headers mid-sentence, trip over English terms inside Urdu notes, or export bulky files that burn through mobile data.</p>
  <p>Voice Studio removes that friction in a simple workspace where your documents stay private on your device and export into compact MP3 chapters (~28 MB per hour), synchronized captions, and study videos.</p>

  <h2>Built for real accessibility (WCAG 2.1 AA)</h2>
  <ul>
    <li><strong>Screen-reader first:</strong> Tested for NVDA, TalkBack, and keyboard-only navigation with clear headings, skip links, accessible dialogs, high-contrast themes, and text scaling up to 200%.</li>
    <li><strong>Urdu &amp; English everyday study:</strong> Mixed Urdu-English notes read cleanly, backed by a custom Pronunciation Dictionary saved right in your browser.</li>
    <li><strong>Free daily start:</strong> Use 3,000 free characters every day with a verified account, or bring your own free Gemini API key anytime.</li>
  </ul>

  <h2>Developer &amp; contact</h2>
  <p>Operator: <strong>Moutter Rasool</strong>, Faisalabad, Pakistan. Send feedback, accessibility suggestions, or account requests anytime via the <a href="/contact" data-page="contact">Contact page</a>.</p>
  <p class="hint">Voice Studio is an independent project and is not affiliated with Google LLC. Gemini is a trademark of Google LLC.</p>
</section>`;

const CONTACT_HTML = `<section id="contact" data-page-section="contact" class="legal">
  ${renderBreadcrumbs('Contact Us', '/contact')}
  <h1 tabindex="-1">Contact us</h1>
  <p class="lead">Send bug reports, screen-reader feedback, quota questions, or account deletion requests directly to developer Moutter Rasool.</p>

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

  <p class="hint">Operator: <strong>Moutter Rasool</strong> · Voice Studio, Faisalabad, Pakistan. Messages are usually answered within 1–3 working days.</p>
</section>`;

const PRIVACY_HTML = `<section id="privacy" data-page-section="privacy" class="legal">
  ${renderBreadcrumbs('Privacy Policy', '/privacy')}
  <h1 tabindex="-1">Privacy Policy</h1>
  <p class="hint">Effective date: 19 November 2026 · Operator: Moutter Rasool (Faisalabad, Pakistan)</p>

  <h2>1. Your Documents &amp; Media Stay on Your Device</h2>
  <p>Uploaded PDF, EPUB, Word (DOCX), Markdown, and TXT files stay inside your browser. Voice Studio never stores source files on external servers or archives finished MP3, WAV, ZIP, subtitle, or video exports.</p>

  <h2>2. Browser Preferences &amp; Personal Keys (localStorage)</h2>
  <p>Display preferences—including contrast theme, font scale, selected voice, Pronunciation Dictionary rules, and any personal Gemini API key you enter for Unlimited Mode—remain strictly in your browser storage. Clearing browser site data or clicking <strong>Clear saved key</strong> deletes them immediately.</p>

  <h2>3. Account &amp; Daily Allowance Records</h2>
  <p>To keep the 3,000-character daily free allowance fair, account records store only your user ID, email address, verification state, daily character usage, credit balance, and activity timestamps. No third-party ad trackers or behavioral ad cookies are used.</p>

  <h2>4. Temporary Speech Requests</h2>
  <p>When using the free daily allowance, only the short text excerpt currently being narrated is transmitted over encrypted HTTPS to create spoken audio and streamed straight back to your browser without keeping a copy of your book.</p>

  <h2>5. Contact Messages</h2>
  <p>Messages submitted via the <a href="/contact" data-page="contact">Contact page</a> store your name, reply email, topic, and message safely for operator follow-up and are never sold or shared with marketers.</p>

  <h2>6. Data Removal Requests</h2>
  <p>You can request deletion of your account record or contact messages anytime through the <a href="/contact" data-page="contact">Contact page</a> using the topic <em>Privacy / Account Deletion Request</em>.</p>
</section>`;

const TERMS_HTML = `<section id="terms" data-page-section="terms" class="legal">
  ${renderBreadcrumbs('Terms and Conditions', '/terms')}
  <h1 tabindex="-1">Terms and Conditions</h1>
  <p class="hint">Effective date: 19 November 2026 · Governed by the laws of Pakistan</p>

  <h2>1. Acceptance of Terms</h2>
  <p>By accessing or using Voice Studio, you agree to these Terms and Conditions. If you do not accept these terms, please discontinue use of the website.</p>

  <h2>2. Service Tiers &amp; Availability</h2>
  <p>Voice Studio offers client-side document preparation, audio and subtitle exports, and AI voice generation. Verified accounts receive a shared daily allowance subject to service capacity, or users may supply their own Google AI Studio API key locally in their browser.</p>

  <h2>3. Fair Use &amp; Account Integrity</h2>
  <p>You agree not to create multiple accounts to bypass daily limits, send automated scraping traffic against shared endpoints, attempt to bypass authentication checks, or disrupt access for other learners.</p>

  <h2>4. Content Ownership &amp; Disclosure</h2>
  <p>You keep ownership of your documents, scripts, audio files, and exported videos, and confirm you hold permission to process the material. Where you publish synthesized audio or video, follow the publishing platform’s disclosure guidelines.</p>

  <h2>5. Prohibited Conduct</h2>
  <p>Do not use Voice Studio to impersonate individuals without consent, spread fraud or harassment, generate harmful material, or break applicable laws.</p>

  <h2>6. Service Warranty &amp; Liability Limit</h2>
  <p>Voice Studio is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. Verify spoken numbers, citations, and translations before high-stakes academic, medical, legal, or commercial publishing. To the extent permitted by law, Voice Studio and Moutter Rasool are not liable for indirect or consequential losses.</p>

  <h2>7. Contact</h2>
  <p>Questions about these terms are handled via the <a href="/contact" data-page="contact">Contact page</a> (Operator: Moutter Rasool, Faisalabad, Pakistan).</p>
</section>`;

const ACCOUNT_SHELL_HTML = `<section id="account" data-page-section="account" class="legal">
  <h1 tabindex="-1">Account workspace</h1>
  <p class="lead">Sign in with your verified account to view your daily allowance, credits, and usage history.</p>
  <div id="accountMount"></div>
  <div class="btn-group">
    <a href="/" data-page="tool" class="btn">Back to Speech Studio</a>
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
    <a href="/" data-page="tool" class="btn">Go to Speech Studio</a>
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
      'Upload a PDF, EPUB, or Word file and get clean MP3 audio in Urdu or English. Free daily use, private in your browser, built for students.',
    breadcrumbLabel: 'Home',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: HOME_HTML,
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
      'How Voice Studio handles your files, browser storage, account records, and contact messages.',
    breadcrumbLabel: 'Privacy Policy',
    robots: 'index, follow, max-snippet:-1, max-image-preview:large',
    html: PRIVACY_HTML,
  },
  {
    pageId: 'terms',
    path: '/terms',
    title: 'Terms and Conditions - Voice Studio',
    description:
      'The terms for using Voice Studio, including fair use, content ownership, and prohibited conduct.',
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
  const webAppNode = {
    '@type': 'WebApplication',
    '@id': `${cleanOrigin}/#webapp`,
    name: 'Voice Studio',
    alternateName: 'Kitaab se Awaaz — Voice Studio',
    url: `${cleanOrigin}/`,
    image: `${cleanOrigin}/og-card.jpg`,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'All',
    browserRequirements: 'Requires a modern web browser with JavaScript enabled',
    inLanguage: ['en', 'ur', 'ar', 'hi', 'de', 'es', 'fr'],
    description:
      'Turn PDF textbooks, EPUB books, Word files, and Urdu or English study notes into clean MP3 audio, synced subtitles, and study videos privately in your browser.',
    creator: {
      '@type': 'Person',
      '@id': `${cleanOrigin}/about#founder`,
      name: 'Moutter Rasool',
      url: `${cleanOrigin}/about`,
      jobTitle: 'Software Developer',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Faisalabad',
        addressCountry: 'PK',
      },
    },
    author: { '@id': `${cleanOrigin}/about#founder` },
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
  };

  const graph = [webAppNode];

  if (route.path !== '/' && route.pageId !== 'notFound') {
    const items = [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${cleanOrigin}/` },
    ];
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

  if (route.pageId === 'faq') {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: [
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
          name: 'Are my PDFs, books, or MP3 files saved on external servers?',
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

  let html = templateHtml
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
