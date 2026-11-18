# Voice Studio: Redesign and SEO Guide (Final)

Site: https://voice-studio-three.vercel.app
Owner: Moutter Rasool, Faisalabad, Pakistan
Audit date: November 19, 2026

Purpose: Make Voice Studio look unique, attractive, and premium, so it does not feel like a generic AI-built website, and fix every SEO problem so the site can rank on Google. Give this whole file to the AI designer or developer (Claude, Bolt, or any other).

Golden rule for the AI: keep ALL existing features and logic working exactly as they are. Only change design, layout, page structure, wording, and SEO setup.

---

## Table of contents

- Part 1: Why the site feels generic (research)
- Part 2: Competitor positioning
- Part 3: Brand identity and design concept
- Part 4: Page-by-page design plan
- Part 5: Copy rewrite (plain language)
- Part 6: Bugs to fix
- Part 7: Accessibility rules
- Part 8: SEO audit (what was actually checked on the live site)
- Part 9: SEO fixes (technical)
- Part 10: SEO fixes (on-page: titles, descriptions, headings)
- Part 11: Keywords and content plan
- Part 12: Structured data (schema)
- Part 13: Off-page SEO, launch, and measurement
- Part 14: Performance and mobile
- Part 15: Final checklist
- Part 16: Paste-ready prompt for the AI

---

## Part 1: Why the site feels generic (research)

Design research from 2026 (Superdesign, GradientDeck, 21st.dev, Honter Studio, MindStudio, Joshua Snoddy) agrees on one point: AI builders pick the most *probable* design, so most AI-made sites end up with the same shape. Voice Studio currently shows most of the known "AI template tells":

| Generic tell | Where it appears on Voice Studio |
| --- | --- |
| Stock section order: hero, badges, 3 feature cards, specs, FAQ | The whole home page follows this exact order |
| Badge/pill line above the headline | "Browser-Local Parsing · 64 kbps MP3 & 24 kHz WAV · WCAG 2.1 AA" |
| Numbered feature cards (01, 02, 03) in a symmetric grid | "Core Studio Modules" section |
| Headline describes the category, not the user's result | "Document-to-audio studio for PDFs, EPUB books, and bilingual notes." |
| Jargon used to sound impressive | "1,152-sample MPEG frames", "raised-cosine seam windowing", "DC-offset centering", "PCM buffers" |
| Default blue brand color | theme-color is #1d4ed8 (standard Tailwind blue) |
| No real images or product visuals | Zero images on the page (only icons) |
| Main action hidden behind sign-in | Visitors cannot hear or try anything before signing up |
| Everything on one long page | Studio, Account, Admin, Guides, Specs, FAQ, About, Privacy, Terms all in one HTML file |

Simple test from the research: if someone could guess what your page looks like from the category alone ("text-to-speech app"), it is still generic.

Other key lessons from the research:
- Put a working control on the first screen, not just a "Get started" button.
- List 8 to 12 things that only your product has, and build the design from them.
- Carry ONE design idea through every section, not only the hero.
- Break the symmetry at least once (one big card, an off-center hero).
- Use real product visuals and real audio samples instead of stock illustrations.

---

## Part 2: Competitor positioning

| Competitor | How they open | Lesson |
| --- | --- | --- |
| Speechify | "Text to Speech. Voice Typing. Fast Answers." | Benefit first, very simple words |
| NaturalReader | "Transform any text into natural-sounding audio." plus "Trusted by over 10M users" | Result plus trust |
| ElevenLabs | Short brand line, huge voice library, emotion control | Show the voices, let people hear them |

None of them lead with technical specs. They lead with the result.

**Voice Studio's real advantages (build the identity around these):**
1. Urdu and English mixed text (code-switching) for Pakistani students.
2. Built by a blind developer, so accessibility is real, not a checkbox.
3. Privacy: files never leave the browser.
4. Study-focused: chapter and page selection, cleanup of page numbers and headers.
5. Small 64 kbps MP3 files, easy to send on WhatsApp and mobile data.
6. Urdu right-to-left subtitle videos for Reels and Shorts.
7. Free daily allowance plus "bring your own Gemini key" unlimited mode.

---

## Part 3: Brand identity and design concept

### 3.1 Things only Voice Studio has (design material)

- A textbook page turning into a sound waveform
- Urdu Nastaliq letters and English letters on the same line
- Page numbers and headers being "swept away" (the cleanup feature)
- Chapter bookmarks and a book spine
- A WhatsApp voice-note style audio bubble (how students actually listen)
- A study desk at night, earphones, exam season
- Subtitles appearing right-to-left in Urdu
- A file shrinking ("1 hour = about 28 MB")
- The founder's story: "Built by someone who listens to every book"

### 3.2 Three concepts (pick one)

**Concept A: "Kitaab se Awaaz" (Book to Voice)** - recommended
- Hero: an open book page on the left; its lines become a waveform on the right.
- Colors: ink blue #0F2A44, paper cream #F6EFE3, saffron accent #E8A33D, plus a dark text color #1B1B1B.
- Fonts: Fraunces (headings), Inter (body), Noto Nastaliq Urdu (Urdu text).
- Every section uses "book" visuals: chapters as bookmarks, FAQ as margin notes, tools as book tabs.

**Concept B: "Voice Note" (WhatsApp-native study audio)**
- Hero: a phone showing a chat where a PDF goes in and a voice note comes out.
- Colors: dark green-black, bright mint accent, white text.

**Concept C: "Radio Studio"**
- Hero: an on-air panel with a big record button and level meters.
- Colors: charcoal, warm amber "on air" light, off-white.

Concept A best matches "study + books + Urdu" and is the least common look among text-to-speech sites.

### 3.3 Brand assets to create

- Logo wordmark: a book merged with a sound wave.
- Favicon set: favicon.ico, favicon.svg, apple-touch-icon (180x180), icon-192, icon-512.
- Open Graph image (1200x630): book plus waveform plus headline, compressed below about 300 KB so WhatsApp and Facebook previews load reliably.
- A short tagline in both languages, for example: "Your books, in your ears" / "Kitaab ab sunein".

---

## Part 4: Page-by-page design plan

The sitemap already lists these routes. Each one must become a real, separate page with its own content, title, and heading.

| Route | What it should contain |
| --- | --- |
| / (Home) | Hero with working drop zone, 3 audio samples, "How it works" in 3 steps, the tools (one big card plus two smaller), founder story, privacy promise, short FAQ, final call to action |
| /pdf-to-audio | PDF and Book Studio tool page with its own intro, steps, and examples |
| /urdu-tts | Urdu and English text-to-speech page, with Urdu text examples and audio samples |
| /podcast-studio | Two-speaker podcast and translator page |
| /video-subtitles | Subtitle and video export page with 16:9, 9:16, 1:1 examples |
| /guides | Guides list, each guide ideally its own URL later |
| /formats | Supported formats, plus one collapsible "Technical details" section |
| /faq | Full FAQ |
| /about | Founder story, mission, how it works technically |
| /contact | Contact form |
| /privacy | "Privacy Policy" title plus all sections starting at 1 |
| /terms | "Terms and Conditions" title plus all sections starting at 1 |
| /account and /admin | Only for signed-in users and admin; never rendered in public HTML |

After login, users should land directly in the Studio workspace.

### Home page section order (not the stock template order)

1. Hero: headline, one line, drop zone, 3 sample players.
2. "Hear the difference": before/after sample (raw PDF reading with page numbers vs clean Voice Studio audio). This proves the cleanup feature better than any text.
3. Founder story (moved up, because it is the strongest unique asset).
4. Tools: "Books to Audio" as one large card, "Podcast and Translate" and "Subtitle Videos" as smaller cards.
5. How it works: Upload, Choose voice, Download.
6. Privacy promise: "Your PDF never leaves your device."
7. Who it is for: Matric, FA/FSc, university students, blind and low-vision learners, teachers, YouTube creators.
8. Short FAQ (5 questions) with a link to the full FAQ.
9. Final call to action.

---

## Part 5: Copy rewrite (plain language)

### Hero options

- "Your textbooks, read aloud in Urdu and English."
- "Turn any PDF into clean audio you can listen to anywhere."
- Supporting line: "Upload a PDF or book, pick a voice, download a small MP3. Your file never leaves your device."
- Button: "Try it free" and a second button "Hear a sample".

### Technical to simple

| Current (too technical) | Better (simple, benefit-first) |
| --- | --- |
| Strips repeating page numbers and headers before synthesis | Removes page numbers and headers so your audio sounds clean |
| 24 ms cosine fade, 1,152-sample MPEG frames | Smooth audio with no clicks between parts |
| Compute .SRT and .VTT timestamps from exact decoded PCM frame durations | Subtitles that stay in sync, even for hour-long chapters |
| Browser-local parsing in browser RAM | Your files stay on your device. Nothing is uploaded. |
| 64 kbps MP3 (~28 MB/hr) | 1 hour of audio is about 28 MB, easy to send on WhatsApp |
| Three focused production tools backed by deterministic audio encoding | Three tools: Books to Audio, Podcast and Translate, Subtitle Videos |
| Select exact chapters, page spans, or scanned PDF pages using local bookmark indexing | Pick the chapter or pages you want, and only those become audio |

Keep all technical details, but move them into one collapsible "For the technical folks" section on /formats.

### Tone

- Short sentences, active voice, "you" language.
- Friendly empty states: "No file yet. Drop a chapter here and hear it in seconds."
- Specific error messages: "This PDF is a scanned image. Open PDF Studio to read it with Gemini Vision."

---

## Part 6: Bugs to fix

1. **Empty email:** "We sent a verification link to ." shows with no email, and is present for logged-out visitors. Show it only after sign-up, with the real email.
2. **Admin Panel in public HTML:** the "Admin Panel" heading and text are inside the public page source. Do not render the admin UI at all for non-admins; load it only on the protected /admin route after an admin check.
3. **Account and verification screens in public HTML:** "My Account", "Verify your email address", and "Speech and Audiobook Conversion Workspace" are also in the public HTML. Render them only for signed-in users.
4. **Privacy and Terms:** content starts at section "2." Add section 1 and make sure the titles show as the page's main heading.
5. **Model name check:** "Gemini 3.1 Flash TTS Preview" is written in the guide text. Make sure it matches the model actually used in code.

---

## Part 7: Accessibility rules (this is the brand)

The site already has good basics (skip link, accessibility settings drawer, aria labels). Keep and extend them:

- One h1 per page (currently there are 16 h1 tags in one HTML file; see Part 8).
- Correct heading order (h1, h2, h3), no skipped levels.
- Every input has a visible label; every button has clear text or an aria-label.
- Visible focus outline, full keyboard use, no keyboard traps in dialogs.
- Text contrast at least 4.5:1.
- Audio players with labelled Play, Pause, Download buttons.
- Status messages (generating, done, error) announced with aria-live.
- Urdu text uses dir="rtl" and lang="ur"; English uses lang="en".
- Respect prefers-reduced-motion.
- Test with NVDA (Windows) and TalkBack (Android).

---

## Part 8: SEO audit (what was actually checked on the live site)

These checks were run on the live site on November 19, 2026, by downloading the raw HTML, robots.txt, sitemap.xml, and key assets.

### What is already good

| Item | Status |
| --- | --- |
| robots.txt | Good. Allows the site, blocks /api/, /account, /admin, and points to the sitemap |
| sitemap.xml | Good. 12 public URLs with lastmod dates |
| Meta robots | Good. "index, follow, max-snippet:-1, max-image-preview:large" |
| Homepage title | Present: "Voice Studio: PDF, EPUB & Urdu Docs to MP3 Audio" |
| Meta description | Present |
| Open Graph and Twitter cards | Present, with og-card.jpg |
| JSON-LD | Present (WebApplication schema with features and languages) |
| Web manifest and app icon | Present (/manifest.webmanifest, /icon-192.png) |
| Skip link and noscript message | Present |
| HTML size | About 81 KB, acceptable |
| Unknown URLs | Do not return a page (good, no fake pages) |

### Problems found (most important first)

| # | Problem | Why it matters | Priority |
| --- | --- | --- | --- |
| 1 | **Every route serves the same HTML.** /, /about, /faq, /urdu-tts, /pdf-to-audio all return the same title and same description in the raw HTML | Google may see all pages as duplicates. WhatsApp, Facebook, and LinkedIn link previews read raw HTML, so every page shares the same preview | Critical |
| 2 | **Canonical on every route points to the homepage.** For example /urdu-tts has canonical = https://voice-studio-three.vercel.app/ in the raw HTML | This tells Google "this page is a copy of the homepage", so subpages may never be indexed | Critical |
| 3 | **16 h1 headings in one HTML file**, including "Admin Panel", "My Account", "Verify your email address" | Confuses search engines about what each page is about; also exposes private screens' text | High |
| 4 | **Site does not appear in search results yet.** A web search for the domain returned no result for it | Needs Google Search Console setup and sitemap submission | High |
| 5 | **On a vercel.app subdomain**, not your own domain | Harder to build trust, brand, and long-term ranking; links point to Vercel's domain | High |
| 6 | **Content depends on JavaScript** ("Voice Studio needs JavaScript to work") | Google can render JS, but slower and less reliably; other search engines and AI crawlers often read only raw HTML | High |
| 7 | **Only lang="en", no Urdu signals** (no hreflang, no lang="ur" sections in source) | Hard to rank for Urdu searches | Medium |
| 8 | **Zero images** on the page | No image search traffic, no visual proof; pages look thin | Medium |
| 9 | **og-card.jpg is about 609 KB** | Large preview images can fail on WhatsApp and slow sharing | Medium |
| 10 | **Favicon is only an inline SVG**; /favicon.ico does not load | Google's search results favicon may not show; some browsers expect /favicon.ico | Medium |
| 11 | **Meta keywords tag is stuffed** with long phrases | Google ignores meta keywords; it adds nothing and looks spammy | Low |
| 12 | **Description and title use jargon** ("64 kbps", ".SRT captions") | Lower click-through from search results | Medium |
| 13 | **No llms.txt** | Optional, but helps AI assistants understand the site | Low |
| 14 | **sitemap lastmod is the same for every URL** | Fine for now, but should update only when a page truly changes | Low |

---

## Part 9: SEO fixes (technical)

1. **Prerender every route to static HTML.** Use a prerender or static site generation step for the Vite app (for example vite-plugin-prerender, vite-ssg, or move the marketing pages to Astro or Next.js). Each route must ship its own HTML with its own title, description, canonical, Open Graph tags, h1, and main content, before any JavaScript runs.
2. **Self-referencing canonical on each page.** /urdu-tts must have canonical https://YOUR-DOMAIN/urdu-tts, not the homepage.
3. **Split the single HTML.** Public pages contain only their own content. Studio, Account, and Admin load as separate client-side screens after login and are never in public HTML.
4. **Custom domain.** Buy a short domain (for example voicestudio.pk or a similar available name), connect it in Vercel, set the vercel.app address to redirect (301) to the new domain, and update canonical, sitemap, Open Graph URLs, and robots.txt.
5. **Google Search Console and Bing Webmaster Tools.** Verify the domain, submit sitemap.xml, use URL Inspection on each page, and request indexing.
6. **Real 404 page** with a helpful message and links back to the tools, returning HTTP status 404.
7. **Favicons:** add /favicon.ico, /favicon.svg, /apple-touch-icon.png, and link them in the head.
8. **Compress og-card.jpg** to below about 300 KB (1200x630), and create one Open Graph image per main page if possible.
9. **Remove the meta keywords tag.**
10. **Language:** keep lang="en" on the html element, add lang="ur" dir="rtl" on Urdu blocks. If you later make full Urdu pages (for example /ur/), add hreflang tags linking English and Urdu versions.
11. **Add llms.txt** at the root: a short plain-text summary of what Voice Studio is, its pages, and who it is for.
12. **Internal links:** link every tool page to the related guide and FAQ, and every guide back to the tool. Use descriptive link text ("convert a PDF to Urdu audio"), not "click here".
13. **Breadcrumbs** on inner pages (Home > Urdu Text to Speech).

---

## Part 10: SEO fixes (on-page: titles, descriptions, headings)

Each page gets a unique title (about 60 characters max), unique description (about 150 to 160 characters), and exactly one h1.

| Route | Title | Meta description | h1 |
| --- | --- | --- | --- |
| / | Voice Studio: Turn PDFs and Books into Urdu and English Audio | Upload a PDF, EPUB, or Word file and get clean MP3 audio in Urdu or English. Free daily use, private in your browser, built for students. | Your textbooks, read aloud in Urdu and English |
| /pdf-to-audio | PDF to Audio Converter: Listen to Any Chapter as MP3 | Pick a chapter or page range from any PDF or book and turn it into clean MP3 audio. Page numbers and headers are removed automatically. | Turn any PDF chapter into clean audio |
| /urdu-tts | Urdu Text to Speech Free: Natural Urdu and English Voices | Convert Urdu, English, or mixed Urdu-English notes into natural speech. Fix pronunciation of names and terms. Free daily allowance. | Urdu text to speech that understands English words too |
| /podcast-studio | AI Podcast Maker: Turn Notes into a Two-Voice Podcast | Turn lecture notes into a Host and Guest podcast with two AI voices, or translate a script into Urdu, English, Arabic, and more. | Turn your notes into a two-voice podcast |
| /video-subtitles | Audio to Subtitled Video: Urdu Captions for Reels and Shorts | Make 16:9, 9:16, or 1:1 videos with synced Urdu or English subtitles from your audio. Download SRT and VTT files too. | Make subtitled videos from your audio |
| /guides | Guides: Make Clean Study Audio and Audiobooks | Step-by-step guides for turning PDFs, books, and notes into clean audio, chapter audiobooks, and subtitled videos. | Guides and workflows |
| /formats | Supported Formats: PDF, EPUB, DOCX to MP3, WAV, SRT | See which files Voice Studio reads and which audio, subtitle, and video formats it exports, with file sizes per hour. | Supported formats and outputs |
| /faq | Voice Studio FAQ: Privacy, Urdu Voices, Limits, Subtitles | Answers about privacy, Urdu and English voices, the free daily limit, your own Gemini key, subtitles, and scanned PDFs. | Frequently asked questions |
| /about | About Voice Studio: Built by a Blind Developer in Pakistan | Voice Studio was built by Moutter Rasool, a blind developer from Faisalabad, to turn books and notes into clean, accessible audio. | About Voice Studio |
| /contact | Contact Voice Studio | Send bug reports, feedback, quota questions, or account deletion requests directly to the developer. | Contact us |
| /privacy | Privacy Policy - Voice Studio | How Voice Studio handles your files, browser storage, account records, and contact messages. | Privacy Policy |
| /terms | Terms and Conditions - Voice Studio | The terms for using Voice Studio, including fair use, content ownership, and prohibited conduct. | Terms and Conditions |

Heading rules: one h1, then h2 for sections, h3 for sub-points. Put the main keyword naturally in the h1, the first paragraph, and one h2.

Image rules (once images are added): descriptive file names (urdu-text-to-speech-sample.webp), meaningful alt text, WebP or AVIF format, width and height set, lazy loading below the fold.

---

## Part 11: Keywords and content plan

Note: these are suggested target phrases based on what the product does and who it serves. Search volumes were not measured. Check them in Google Search Console (after launch) and Google Keyword Planner before committing.

### Target keyword groups

| Group | Example phrases | Best page |
| --- | --- | --- |
| Urdu TTS | urdu text to speech, urdu text to speech free, urdu voice generator, urdu tts online | /urdu-tts |
| PDF to audio | pdf to audio, pdf to mp3, pdf reader aloud, listen to pdf | /pdf-to-audio |
| Books | epub to audiobook, book to audio, textbook audio | /pdf-to-audio, guides |
| Students | listen to notes, study audio, audio notes for exams, FA/FSc notes audio | Home, guides |
| Accessibility | text to speech for blind students, accessible pdf reader, screen reader friendly tts | /about, guides |
| Creators | urdu subtitles video, ai podcast generator, faceless video voiceover urdu | /video-subtitles, /podcast-studio |
| Roman Urdu searches | urdu mein pdf sunna, kitaab ko audio mein badlein | Urdu or Roman Urdu guides |

### Content plan (guides that bring search traffic)

Write each as its own page under /guides/... with real steps and a short audio sample:

1. How to turn a PDF textbook into MP3 audio (step by step)
2. Urdu text to speech: how to get correct pronunciation of English terms
3. How blind and low-vision students can listen to their textbooks
4. How to make an audiobook from an EPUB, chapter by chapter
5. How to make a two-voice study podcast from your class notes
6. How to make Urdu subtitle videos for YouTube Shorts and Reels
7. How to use your own free Gemini API key for unlimited audio
8. Matric and FA/FSc: how to revise by listening (exam-season guide)
9. Scanned PDF to audio: what to do when text cannot be selected
10. Best audio settings for WhatsApp sharing (file size guide)

Publish 1 guide per week. Each guide: 600 to 1,200 words, one h1, steps as an ordered list, an FAQ block at the end, and links to the matching tool.

Later: an Urdu version of the top pages (in Urdu script, lang="ur") with hreflang, because there is far less competition for Urdu-language pages.

---

## Part 12: Structured data (schema)

Keep the existing WebApplication schema and improve it:

- Add "offers": price 0, priceCurrency USD (or PKR), to show it is free.
- Add "author" / "creator": a Person (Moutter Rasool) with url to /about.
- Add an Organization or Person block with logo and sameAs links (GitHub, LinkedIn, YouTube when available).
- Add BreadcrumbList on inner pages.
- Add HowTo-style content in guides (as normal steps; rich result support for HowTo has been reduced by Google, so focus on clear content).
- FAQPage schema on /faq is fine to keep, but Google now shows FAQ rich results mainly for government and health sites, so do not expect stars or dropdowns in results.
- Validate everything with Google's Rich Results Test and the Schema Markup Validator.

---

## Part 13: Off-page SEO, launch, and measurement

### Get the first links and users

- Share in Pakistani student groups (Facebook, WhatsApp communities, Reddit r/pakistan, r/PakistaniTech) with a short demo audio.
- Accessibility communities: blind and low-vision groups, NGOs, and university disability offices in Pakistan.
- Product listings: Product Hunt, There's An AI For That, Futurepedia, AlternativeTo (as an alternative to Speechify and NaturalReader).
- Put the link on your GitHub profile, LinkedIn, and YouTube channel descriptions.
- Make short videos (Shorts/Reels) showing a PDF turning into Urdu audio, made with Voice Studio's own subtitle export, with the link in the description.

### Measure

- Google Search Console: impressions, clicks, which queries bring people, indexing errors.
- A privacy-friendly analytics tool (for example Vercel Analytics, Plausible, or Umami). Note: your privacy policy currently says no analytics trackers are used, so update the policy if you add one.
- Review monthly: which pages get impressions but few clicks (improve their titles and descriptions).

---

## Part 14: Performance and mobile

- Target Core Web Vitals: LCP under 2.5 s, INP under 200 ms, CLS under 0.1. Test with PageSpeed Insights on mobile.
- Load heavy libraries (PDF.js, Mammoth, JSZip, MP3 encoder, Firebase) only on the Studio pages, not on landing and guide pages.
- Preload the main fonts and use font-display: swap; subset the Urdu font if possible.
- Compress images to WebP or AVIF; set width and height to prevent layout shift.
- Mobile first: most users are on phones and mobile data in Pakistan.

---

## Part 15: Final checklist

Design
- [ ] One clear concept applied to every section (Concept A recommended)
- [ ] New logo, favicon set, brand colors, fonts
- [ ] Hero with working drop zone and 3 audio samples
- [ ] Before/after cleanup sample
- [ ] Founder story and privacy promise sections
- [ ] Plain-language copy; tech details collapsed on /formats

Bugs
- [ ] Empty verification email fixed
- [ ] Admin, Account, and verification screens removed from public HTML
- [ ] Privacy and Terms titles and section 1 added
- [ ] Model name matches code

SEO
- [ ] Every route prerendered with unique title, description, canonical, Open Graph, h1
- [ ] Custom domain with 301 redirect from vercel.app
- [ ] Search Console and Bing verified, sitemap submitted
- [ ] favicon.ico and icon set added
- [ ] og-card.jpg compressed below about 300 KB
- [ ] Meta keywords removed
- [ ] lang="ur" and dir="rtl" on Urdu content
- [ ] llms.txt added
- [ ] Schema improved and validated
- [ ] First 4 guides published

Accessibility
- [ ] One h1 per page, correct heading order
- [ ] Tested with NVDA and TalkBack
- [ ] Contrast, focus, keyboard, aria-live checked

---

## Part 16: Paste-ready prompt for the AI

```
Redesign and SEO-fix my web app "Voice Studio" (https://voice-studio-three.vercel.app) using this guide. Keep ALL existing features and logic working exactly as they are (Firebase auth, 3,000-character daily quota, own Gemini API key mode, pronunciation dictionary, PDF/EPUB/DOCX extraction, smart cleanup, MP3/WAV export, chapter ZIP, SRT/VTT captions, video export, admin panel, contact form). Only change visual design, layout, page structure, wording, and SEO setup.

DESIGN
Concept "Kitaab se Awaaz" (Book to Voice): an open book page whose lines turn into a sound waveform. Colors: ink blue #0F2A44, paper cream #F6EFE3, saffron accent #E8A33D. Headings in Fraunces, body in Inter, Urdu in Noto Nastaliq Urdu. Do NOT use a purple-blue gradient, badge pills above the headline, or three equal icon cards. Break the symmetry: one large "Books to Audio" card and two smaller cards.

Home hero: headline "Your textbooks, read aloud in Urdu and English." Subline: "Upload a PDF or book, pick a voice, download a small MP3. Your file never leaves your device." A working drop zone and three sample audio players (Urdu lecture, English chapter, mixed Urdu-English notes) on the first screen. Then a before/after cleanup sample, founder story (Moutter Rasool, a blind developer from Faisalabad, Pakistan), tools, 3-step how it works, privacy promise, who it is for, short FAQ, final call to action.

Rewrite all copy in simple, benefit-first language. Move technical specs (PCM, MPEG frames, cosine fades, DC offset) into one collapsible "Technical details" section on /formats.

PAGES AND BUGS
Make these real separate pages: /, /pdf-to-audio, /urdu-tts, /podcast-studio, /video-subtitles, /guides, /formats, /faq, /about, /contact, /privacy, /terms. Studio, Account, and Admin screens must NOT be in public HTML; render them only after login (Admin only after an admin check). Fix the empty email in "We sent a verification link to". Add titles and section 1 to Privacy Policy and Terms and Conditions.

SEO
Prerender every public route to static HTML (vite-plugin-prerender, vite-ssg, or similar) so each page ships its own unique title, meta description, self-referencing canonical, Open Graph and Twitter tags, exactly one h1, and its main content before JavaScript runs. Use the titles, descriptions, and h1s from the table in Part 10 of the guide. Remove the meta keywords tag. Add favicon.ico, favicon.svg, apple-touch-icon.png. Compress og-card.jpg below 300 KB at 1200x630. Add lang="ur" dir="rtl" to Urdu text. Add llms.txt. Improve JSON-LD: add offers (price 0), creator Person (Moutter Rasool), BreadcrumbList on inner pages. Add a real 404 page with status 404. Load heavy libraries (PDF.js, Mammoth, JSZip, MP3 encoder, Firebase) only on Studio pages.

ACCESSIBILITY (critical, the founder is blind; WCAG 2.1 AA)
One h1 per page, correct heading order, labelled inputs and buttons, skip link, visible focus, full keyboard access, 4.5:1 contrast, aria-live for status messages, prefers-reduced-motion support. Mobile first.
```

---

## Sources

- Design research: Superdesign (Fix a Generic AI Landing Page), GradientDeck (AI landing page that does not look generated), 21st.dev (How to make a site not look AI generated), Honter Studio (Make your website look less AI-generated), MindStudio (Avoid vibecoded landing pages), Joshua Snoddy (Why AI websites look the same).
- Competitors: public homepages of Speechify, NaturalReader, and ElevenLabs.
- SEO audit: live checks of https://voice-studio-three.vercel.app raw HTML, /robots.txt, /sitemap.xml, /urdu-tts, /pdf-to-audio, /about, /faq, /og-card.jpg, /manifest.webmanifest, /icon-192.png, /favicon.ico, /llms.txt on November 19, 2026.
