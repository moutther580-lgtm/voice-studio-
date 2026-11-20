# Prompt for Google AI Studio

How to use: open your Voice Studio project in Google AI Studio, attach file 01-Voice-Studio-Final-Brief.md, then paste the prompt below. Work in two rounds if the answer is too long: first the structure and design (sections A to C), then pages and legal text (sections D to F).

```
You are redesigning my web app "Voice Studio" (live at https://voice-studio-three.vercel.app). The attached file 01-Voice-Studio-Final-Brief.md is the full brief. Follow it.

NON-NEGOTIABLE
Keep every existing feature and all logic working exactly as it is: Firebase sign-in, the 3,000-character daily allowance, own Gemini API key mode, pronunciation dictionary, PDF/EPUB/DOCX/MD/TXT extraction, smart cleanup, chapter splitting, MP3 and WAV export, chapter ZIP, SRT/VTT captions, subtitled video export, admin panel, contact form. Change only design, layout, page structure, wording, legal text and SEO setup. After every round, list what you changed and confirm each feature still works.

GOAL
An original, premium, human-looking site that is also ready for a Google AdSense application. It must not look like a generic AI template.

A. IDENTITY AND DESIGN
Concept "The Page That Speaks":
1. Every article and main section has a real "Listen to this section" button that reads that text aloud with the app's own voice.
2. The home page is laid out like a simple audio timeline: sections are clips on one horizontal track with time labels (00:00 Hear it, 00:40 How it works, 01:20 Your privacy). Visual only: in the code keep normal headings and links.
3. Show mixed Urdu and English text with a highlight that follows the voice, right-to-left and left-to-right together.
Use real material, not stock art: a real PDF page before and after cleanup, real screenshots, real audio samples, a founder note from Moutter Rasool (blind developer, Faisalabad, Pakistan), and a "file size ruler" (one hour of audio is about 28 MB, about a WhatsApp voice note).
Tokens: paper #F6F4EF, ink #14181C, muted #5B6470, signal tangerine #FF6A2B (buttons and highlights only; ink text on it), deep teal #0B6B63 (links, secondary buttons). Dark mode: background #11161A, text #F2EFE8, muted #9AA5B1, tangerine #FF8A55. Provide a visible light/dark switch and respect prefers-color-scheme and prefers-reduced-motion.
Fonts: Bricolage Grotesque for headings, Atkinson Hyperlegible for body, Noto Nastaliq Urdu for Urdu with generous line height. Check availability and fall back to system fonts.
Do NOT use: purple-blue gradients, a badge line above the headline, three equal numbered icon cards, glass effects, generic stock illustrations.
Break symmetry: one large "Books to Audio" card, two smaller cards, one full-width demo.

B. COPY
Rewrite all visible text in plain, benefit-first language, short sentences, "you" voice. Example hero: "Your textbooks, read aloud in Urdu and English." Subline: "Upload a PDF or book, pick a voice, download a small MP3. Your file stays on your device." Move every engineering detail (PCM, MPEG frames, cosine fades, DC offset) into one collapsible "Technical details" section on /formats.

C. TRY-IT WITHOUT SIGN-IN
Put a working try-it box on the home page: a short text or file drop, a voice choice, and a short free preview (about 300 characters, or one preview with the visitor's own key). Sign-in is needed only for the larger daily allowance, chapter ZIP and video export.

D. PAGES (each real, separate, static HTML before any script runs)
/, /app (workspace, ad-free), /pdf-to-audio, /urdu-tts, /podcast-studio, /video-subtitles, /guides and /guides/[slug], /formats, /faq, /about, /contact, /privacy, /terms, and a real 404 page (HTTP 404).
Admin, Account and email-verification screens must not appear in public HTML: render them only after sign-in, and Admin only after an admin check. Fix "We sent a verification link to ." (show it only after sign-up, with the real email).
Each page: unique title, meta description, self-referencing canonical, Open Graph and Twitter tags, exactly one h1 and correct heading order. Prerender all public routes (vite-ssg, vite-plugin-prerender or similar). If prerendering is not possible inside this project, tell me, and generate the content pages as static HTML files instead.

E. ADSENSE READINESS (do not add ad code yet)
- Ads will go only on article pages, between paragraphs, never beside buttons, never on sign-in, error, thank-you or account pages, and never in /app. Prepare empty, labelled placeholder containers on article templates only.
- Create a "guides" article template with: title, author box (Moutter Rasool, short bio, link to About), published and updated dates, 800 to 1,500 words, space for screenshots and an audio sample, related links, and a "Listen to this article" button. Create 3 complete example articles from this list, and leave the other titles as drafts: (1) How to turn a PDF textbook into MP3 audio, (2) Urdu text to speech: getting English terms pronounced correctly, (3) How blind and low-vision students can listen to their textbooks. Write them honestly from how the app really works. Do not invent test results or statistics.
- Add a cookie and consent area ready for a Google-certified consent platform (EEA, UK, Switzerland visitors).
- Add ads.txt support but leave it empty until I give you my publisher ID.

F. LEGAL AND MODEL FIXES
- Privacy Policy: add the title, number sections from 1; state that Google AdSense and partners show ads on content pages and use cookies, with a link explaining Ads Settings and opting out of personalised ads; state that no ads appear in the workspace; state that text sent for voicing goes to Google's Gemini API and is handled under Google's terms; keep the sections on browser parsing, localStorage (own key), Firebase records, contact messages and deletion on request; add data retention, cookies and consent, children (18 and over), and the last-updated date. Remove the sentence saying no ad networks are used.
- Terms and Conditions: add the title and section 1; add advertising on content pages, no guarantee of accuracy, fair use, termination of abusive accounts, and that AI-generated audio may not be copyrightable in some countries; keep ownership of content, synthetic-voice disclosure and prohibited conduct.
- About must say who runs the site and why. Contact must show the real email moutther580@gmail.com plus the form.
- Replace any mention of "Gemini 3.1 Flash TTS Preview" in text with the model the code actually uses, and tell me which model that is. Google's terms do not allow Preview models in production, so flag it if the code uses one.
- Keep the AI-voice disclosure notice and the "not affiliated with Google" line.

G. ACCESSIBILITY (WCAG 2.1 AA, the founder is blind)
Keep the skip link and settings drawer. One h1 per page; labelled inputs and buttons; visible focus; full keyboard use, no traps; contrast 4.5:1 or better; aria-live for status messages; labelled player controls; Urdu text with lang="ur" dir="rtl". Do not hide actions behind unlabeled icon buttons.

H. PERFORMANCE AND SEO
Load PDF.js, Mammoth, JSZip, the MP3 encoder and Firebase only inside /app. Compress images to WebP, set width and height, lazy-load below the fold. Targets on mobile: LCP under 2.5 s, INP under 200 ms, CLS under 0.1. Remove the meta keywords tag. Add favicon.ico, favicon.svg, apple-touch-icon. Compress og-card.jpg below 300 KB (1200 by 630). Improve JSON-LD (WebApplication with free offer and creator Person, BreadcrumbList on inner pages). Add sitemap.xml and robots.txt that match the new routes, and optionally llms.txt.

OUTPUT
1) The plan in 10 lines. 2) The code changes. 3) A short checklist: each existing feature still works, one h1 per page, titles and canonicals unique, ads absent from /app, privacy text matches reality.
```
