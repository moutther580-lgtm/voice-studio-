# Voice Studio: Website Text and UI Redesign Brief

Live site: https://voice-studio-three.vercel.app
Owner: Moutter Rasool, Faisalabad, Pakistan

---

## Part A: Redesign request (for the AI designer)

Please redesign the UI of my web app "Voice Studio" so it looks unique, modern, and premium, not like a generic AI-generated SaaS template. Keep ALL existing features and logic working exactly as they are (Firebase auth, 3,000-character daily quota, own Gemini API key mode, pronunciation dictionary, PDF/EPUB/DOCX extraction, MP3/WAV export, SRT/VTT captions, video export, admin panel, contact form). Only change the visual design, layout, and wording where noted.

### Problems to fix

1. **Generic look and copy.** The page follows a standard template (hero, "Core Modules", spec lists, FAQ). It needs its own identity: a clear brand, a distinctive color palette, and a strong hero that says in one simple line what the app does (for example: "Turn your PDFs and books into clean audio, in Urdu and English").
2. **Too much technical jargon for normal users.** Phrases such as "1,152-sample MPEG frames", "24 ms raised-cosine seam windowing", "DC-offset centering", and "PCM buffers" mean nothing to students. Move these into a single collapsible "Technical details" section and use simple benefit-focused language everywhere else.
3. **Empty email in the verification message.** "We sent a verification link to ." shows with no email address, and it appears even to logged-out visitors. Show it only after sign-up, with the user's actual email.
4. **Admin Panel text is visible publicly.** The "Admin Panel" heading and description must render only for the admin account, never for normal users or visitors.
5. **Privacy Policy and Terms are missing section 1 and their titles.** Both start at "2." and have no page heading. Add proper titles ("Privacy Policy", "Terms and Conditions") and the missing "1." sections.
6. **Everything is on one long page.** Separate clearly into: Home (landing), Studio (the converter tool), PDF Studio, Podcast and Translator, Video Export, Guides, FAQ, About, Contact, Privacy, Terms. Logged-out visitors should see a clean landing page, and logged-in users should land directly in the Studio.
7. **Accessibility must stay excellent (WCAG 2.1 AA).** I am a blind developer and many users use screen readers. Keep proper heading order (one h1 per page), labelled form fields, visible focus states, skip-to-content link, high contrast, and keyboard access for every control. Do not hide important actions behind icon-only buttons without labels.

### Design direction

- A clear visual identity (logo wordmark, 2 to 3 brand colors, a modern font). Avoid the usual purple-gradient AI-template look.
- A hero with one headline, one short sentence, and one main button ("Start converting free").
- A simple 3-step "How it works" (Upload, Choose voice, Download audio).
- Feature cards written in plain language, with benefits first.
- Mobile-first and fast-loading, because most users are in Pakistan on mobile data.
- Support Urdu (RTL) text display properly wherever Urdu appears.

---

## Part B: Current full website text (as extracted)

Note: this was extracted by a text tool. Some dropdown values (such as voice names), some button labels, and logged-in screens may be missing.

Voice Studio: PDF, EPUB & Urdu Docs to MP3 Audio

Browser-Local Parsing · 64 kbps MP3 & 24 kHz WAV · WCAG 2.1 AA

### Document-to-audio studio for PDFs, EPUB books, and bilingual notes.

Voice Studio extracts PDF, EPUB, and Word text inside browser RAM, strips repeating page numbers and headers before synthesis, and renders compact 64 kbps MP3 audiobooks (~28 MB/hr), aligned .SRT/.VTT captions, and subtitled video.

Signal & Caption Pipeline: 24 ms cosine fade · 1,152-sample MPEG frames
Local Cleanup Stage: PDF.js · Mammoth · JSZip + Header Filter
Synced Caption Output: .SRT / .VTT · RTL Urdu & LTR English

Sign in to use the 3,000 daily character quota, chapter ZIP builder, and video caption exporter.

### Core Studio Modules & Measured Outputs

Three focused production tools backed by local file extraction, phonetic rules, and deterministic audio encoding.

**01. Document Extraction: AI PDF & Book Chapter Studio**
Select exact chapters, page spans, or scanned PDF pages using local bookmark indexing so quota goes only toward the sections you actually listen to.
- Supported files: PDF, EPUB, DOCX, MD, TXT
- Header & digit filter: In-browser frequency scan
- Audio footprint (64 kbps): ~28 MB / hour
- Lossless WAV (24 kHz): ~170 MB / hour

**02. Bilingual Dialogue & Adaptation: Podcast & Speech Translator**
Convert lecture outlines into two-voice Host/Guest scripts or adapt text into Urdu, English, Arabic, Hindi, Spanish, French, and German with Pronunciation Dictionary overrides.

**03. Timed Video Rendering: Subtitles & Video Export**
Compute .SRT and .VTT timestamps from exact decoded PCM frame durations (zero drift across hour-long chapters) and render 16:9, 9:16, or 1:1 MP4/WebM video with RTL Urdu captions.

We sent a verification link to . Open the link in your inbox, then select I verified, refresh status to open the converter workspace and activate your 3,000 characters/day free allowance.

Select your narrator voice and export bitrate below, then drop or paste your document to build clean MP3, WAV, or chapter ZIP audio.

### 1. Voice, model & speaking style

Prefix lines with Host: / Guest: or A: / B: to switch speakers automatically.

Custom speaking style / tone (optional, guides delivery, never spoken aloud). For example: slowly, clearly, and calmly.

Pick a quick preset above or type custom delivery notes here. Leave blank for standard natural delivery.

Audio format & advanced settings (MP3 64 kbps)
- Audio output format: MP3 (compressed, small file size) / WAV (uncompressed PCM)
- MP3 quality: 64 kbps (speech optimized, smallest) / 128 kbps (higher fidelity)
- Characters per part: 1800
- Pause between requests (seconds): 1
- Silence between parts (milliseconds): 250

Own Gemini API Key (optional Unlimited Mode)
- Use My Own Free Gemini API Key (Unlimited Mode)
- Your Gemini API key (stored only in your browser): AIza...
- Show key / Clear saved key

Saved strictly in your browser's localStorage and never sent to Firebase or our server. When enabled with a valid key, speech requests run directly from your browser and bypass the 3,000-character daily limit. Leave unchecked to use the built-in free allowance.

Pronunciation dictionary (0 active rules)
Fix how specific abbreviations, names, or non-English terms are spoken before audio is generated. Your original text stays untouched.
- Written text (for example: Jieshuo or Dr.) / Spoken as (for example: Jay-shwoh or Doctor)
- Match whole word only
- Add rule / Add academic presets

Smart document cleanup (remove standalone page numbers and repeated headers/footers from PDF & EPUB files)
Text to convert (or drop a PDF, DOCX, EPUB, TXT file below)

Audio is generated by AI. Please follow the rules of the platform where you publish it, including any disclosure of synthetic voices. Audio from Gemini carries an inaudible watermark.

Check your daily free allowance, available credits, speech server status, and recent activity.

Recent usage & credit history
- No usage recorded yet.

### Admin Panel
Manage user accounts, credits, daily limits, activity history, and visitor messages.

### AI PDF & Book Chapter to Audio Studio
Load any textbook PDF, research paper, EPUB book, or scanned document, ask for a specific chapter, topic, or page range, and Voice Studio builds a clean audio script without wasting quota on unrelated pages.

**Extract & record selected chapters or pages**
No file loaded yet. Choose a PDF, EPUB, DOCX, or TXT file below (processed privately in your browser).

**How the 3-Tier PDF Agent Works**
1. Bookmark & Page Indexing: Reads PDF bookmarks and short page previews locally first so the planner isolates only the requested page span.
2. Clean Speech Adaptation: Strips repeating page numbers, citation brackets like [12], URLs, and broken hyphenated words before synthesis.
3. Scanned PDF Vision: Detects image-only scans lacking a selectable text layer and transcribes targeted pages through Gemini Vision.
4. Offline Bookmark Fallback: When offline or without server credits, matches chapter headings, page ranges (e.g. pages 5-10), and keywords deterministically in-browser.

### AI Podcast Script & Speech Translator Studio
Start from a structured creator template, turn lecture notes into a two-speaker Host & Guest dialogue, or translate an existing script for natural spoken cadence.

Built for lectures, university handouts, and creator scripts that move between Urdu sentences and English technical terms inside the same paragraph.

Recommended Settings for Urdu + English: Select Gemini 3.1 Flash TTS Preview in Step 1 with MP3 (64 kbps) for compact ~28 MB/hour files, and pair voices such as Kore, Charon, or Puck for even code-switching across technical vocabulary.

**Handling Mixed Urdu & English Terms Cleanly**
Study handouts frequently mix Urdu explanations with English abbreviations such as CSS, HTML, TCP/IP, or domain jargon. Instead of editing your original document manually, open the Pronunciation dictionary in Step 1 and map written terms to phonetic spellings (for example, mapping "Ch." to "Chapter" or specialized acronyms to clear spoken equivalents).

**Synced .SRT Subtitles & Burned-In Urdu RTL Video**
Every generated MP3 or WAV file computes segment durations for .srt and .vtt caption files. Below the audio player, select an aspect ratio and press Download video with burned-in subtitles. Urdu segments render right-to-left (RTL) inside 16:9, 9:16 vertical Reels, or 1:1 square video frames.

### Subtitled Video Export (.SRT, .VTT, MP4 & WebM)
Turn any generated MP3 or WAV recording into a publish-ready video file inside your browser with timing derived directly from each decoded speech segment.

| Export Option | Dimensions / Behavior | Common Publishing Target |
| --- | --- | --- |
| 16:9 Widescreen Video | 1280x720 high-contrast canvas with centered multi-line caption box and duration progress bar | YouTube lectures, Udemy modules, recorded documentation |
| 9:16 Vertical Video | 720x1280 portrait layout sized for up to 5 wrapped lines per caption turn | YouTube Shorts, Instagram Reels, TikTok study clips |
| 1:1 Square Video | 720x720 balanced feed frame with automatic RTL Urdu & LTR English text direction | LinkedIn, Facebook, Telegram, and feed posts |
| .SRT & .VTT Subtitle Files | Generated from exact PCM sample lengths of every synthesized part and inter-part pause | External video editors (Premiere, CapCut, DaVinci Resolve) |

**How Timing Alignment Works**
Because subtitles are computed from the actual synthesized PCM buffers and configured pause intervals, rather than an estimated words-per-minute guess, longer audiobooks do not drift out of sync toward the end of a recording.

### Guides & Production Workflows
Technical workflows for preparing clean speech audio, multi-chapter audiobooks, and subtitled video clips from study and creator source files.

Workflow Summary: Load PDF, EPUB, DOCX, Markdown, or TXT in browser memory, run Smart Document Cleanup to remove headers and hyphen breaks, then export numbered chapter MP3s, 24 kHz WAV masters, or synced captions.

**1. Academic PDF Cleanup & Hyphen Repair** (Deterministic header/footer stripping before speech synthesis)
University handouts repeat titles, page numbers, and citation brackets across every page. Enabling Smart document cleanup scans top and bottom lines across pages locally, removes standalone page digits, and rejoins words split across line-end hyphens before chunking.

**2. Bilingual Terminology & Phonetic Rules** (Keeping acronyms intact in mixed Urdu and English scripts)
Map domain abbreviations such as "Dr.", "Eq.", or technical acronyms inside the Pronunciation dictionary in Step 1. Voice Studio applies word-boundary substitutions only to the synthesized payload while leaving your source text editable.

**3. Multi-Chapter EPUB & ZIP Packaging** (Chapter splitting, file naming, and paired subtitle tracks)
Load a DRM-free EPUB or pasted textbook and run Split into chapters to isolate individual headings, or trigger Export all chapters as Audiobook ZIP to bundle sequentially numbered tracks alongside frame-accurate .srt captions.

**4. Targeted Page Spans & Two-Speaker Scripts** (Isolation via AI PDF Studio and Host/Guest Dialogue Mode)
Use AI PDF & Book Studio to extract a specific chapter, page range, or image scan through Gemini Vision, or open Podcast & Translator for structured Host: / Guest: dialogues.

Open the Speech Studio or verify bitrate metrics in Supported Formats.

### Supported Formats & Output Specifications
Input documents are read locally in browser memory, and outputs export in portable MP3, uncompressed WAV, timed caption tracks, or subtitled video.

Specification Overview: Import PDF, EPUB, DOCX, Markdown, or TXT locally without uploading source files for storage, then export 64 kbps MP3 (~28 MB/hour), 128 kbps MP3 (~56 MB/hour), 24 kHz PCM WAV (~170 MB/hour), .SRT / .VTT subtitles, or burned-in subtitle video.

**Signal & Encoding Specifications**
1. 24,000 Hz PCM Synthesis & DC Normalization: Incoming speech chunks decode at 24 kHz mono 16-bit PCM with DC-offset centering before concatenation.
2. 24 ms Raised-Cosine Seam Windowing: Chunk boundaries apply 24 ms cosine fades aligned to 1,152-sample MPEG-1 Layer III frames to prevent click artifacts.
3. Sample-Accurate .SRT & .VTT Timing: Cue timestamps accumulate exact PCM buffer sample durations plus configured inter-part silence milliseconds, no WPM estimation drift.
4. Client-Side Canvas & Bidi Video Export: HTML5 Canvas renders 1280x720 (16:9), 720x1280 (9:16), or 720x720 (1:1) video with native RTL Urdu and LTR English text shaping.

### Frequently Asked Questions
Direct technical details on file cleanup, MP3 compression ratios, Urdu and English pronunciation rules, video subtitles, and account quotas.

**How does Voice Studio prevent page numbers and headers from interrupting study audio?**
When Smart Document Cleanup is enabled, Voice Studio parses your PDF or EPUB locally, detects recurring header/footer strings across pages, removes standalone page numbers, and rejoins words split across line-end hyphens before synthesis.

**How big is an hour of speech audio, and does it work well over mobile data or WhatsApp?**
At the default 64 kbps speech MP3 bitrate, a 60-minute lecture fits in roughly 28 MB, compact enough for messaging groups and low-storage phones. For desktop video editing, switch to 128 kbps MP3 or 24 kHz uncompressed WAV in Step 1.

**Does Voice Studio handle mixed Urdu and English study notes accurately?**
Yes. Neural speech models read both Urdu and English paragraphs in one pass. For localized names or technical acronyms, add a replacement rule in the Pronunciation Dictionary so your source text stays untouched.

**How do the 3,000 daily free characters and Unlimited Mode differ?**
Verified accounts receive 3,000 free daily characters funded by the shared server allowance with no API key setup. For entire books or heavy daily production, turn on Own Gemini API Key in Step 1; your key stays strictly inside browser localStorage.

**Are my uploaded documents or generated MP3 files kept on any server?**
No. Document parsing, chapter splitting, MP3 encoding, ZIP creation, and video rendering execute directly in browser memory. Only the short text chunk currently being voiced is forwarded transiently to Gemini with zero document storage.

**How do two-speaker dialogues and synchronized .SRT subtitles work?**
Set Narration Mode to Dialogue / 2 speakers, choose Speaker A and Speaker B voices, and prefix turns with Host: / Guest: or A: / B:. Every rendered track calculates cue timestamps automatically from the synthesized PCM audio for optional .srt and .vtt downloads.

**How does burned-in subtitle video export work?**
After generating audio, choose 16:9, 9:16 vertical, or 1:1 square in the export panel and press Download video with burned-in subtitles. Your browser renders high-contrast RTL Urdu or LTR English captions directly into an MP4 or WebM video using the synced subtitle cues.

**What happens if a PDF is a scanned image without selectable text?**
Voice Studio checks for an embedded text layer locally and alerts you if pages are image-only scans. Open the AI PDF & Book Studio to read targeted scanned pages with Gemini Vision instead of spending quota blindly.

### About Voice Studio
Developed and operated by Moutter Rasool in Faisalabad, Pakistan as a fast, browser-private document-to-audio and subtitled video workstation.

**Why Voice Studio Exists**
Long academic PDFs, multi-chapter EPUB books, and bilingual Urdu-English handouts are cumbersome to turn into clean listening material. Most online tools upload entire books to remote servers, leave repeating page footers intact inside the narration, or charge per file for basic MP3 compression.

Voice Studio approaches the problem differently: PDF, EPUB, and Word parsing execute in browser RAM via Mozilla PDF.js, JSZip, and Mammoth; recurring headers and page numbers are filtered deterministically before a single character reaches the TTS model; and parts are joined with DC-bias normalization, raised-cosine fades, and frame-aligned MP3 encoding into compact 64 kbps files.

**Technical Architecture**
- Client-Side Parsing & Media Assembly: Source files remain on your device. Chapter splitting, ZIP packaging, MP3/WAV encoding, .SRT/.VTT generation, and HTML5 Canvas video rendering all execute inside the browser.
- Dual Quota Model: Verified accounts receive a shared daily allowance of 3,000 characters handled via stateless API proxies and Firebase Firestore tracking, while Unlimited Mode runs directly from your browser using your own Google AI Studio key stored in localStorage.
- Audio Continuity Engineering: Inter-part seams normalize DC offset and apply 24 ms raised-cosine windowing aligned to 1,152-sample MPEG frames to prevent clicks and pops between synthesized segments.

**Operator & Support**
Operator: Moutter Rasool, Faisalabad, Pakistan. Technical questions, bug reports, and account requests are handled directly via the Contact page.

Voice Studio is an independent project and is not affiliated with Google LLC. Gemini is a trademark of Google LLC.

### Contact Voice Studio
Send bug reports, audio feedback, account quota questions, or deletion requests directly to the developer.

Messages save securely to the operator inbox without opening an external mail client.

### Privacy (as currently shown, section 1 and title missing)
Uploaded PDF, EPUB, Word (DOCX), Markdown, and TXT files are parsed entirely inside your browser's RAM. Voice Studio does not upload source files to object storage or retain finished MP3, WAV, ZIP, .SRT, .VTT, or video recordings on any server.

**2. Browser-Local Storage (localStorage)**
Preferences, including selected model, voice, bitrate, speaking style, custom Pronunciation Dictionary rules, and any personal Gemini API key you enter for Unlimited Mode, are saved strictly in your browser's localStorage. Clear site data in your browser settings or select Clear saved key to erase them immediately.

**3. Account & Quota Records**
To prevent abuse of the shared 3,000-character daily allowance, Google Firebase Authentication and Cloud Firestore store your user ID, email address, verification status, daily character count, credit balance, and ledger timestamps. No analytics advertising trackers or third-party ad networks are used.

**4. Transient API Processing**
When using the shared speech allowance, only the active text chunk being voiced (or the selected script/pages submitted to the AI studios) is transmitted over HTTPS through stateless API routes (Vercel Serverless Functions and Cloudflare Workers) to Google's Gemini API and streamed back immediately without payload archival.

**5. Contact Form Messages**
Submissions sent through the Contact page record your name, reply email, topic, and message inside access-restricted Cloud Firestore storage solely so the operator can respond. Contact records are never sold or shared with marketers.

**6. Access, Export & Account Deletion**
You may request removal of your account profile, quota ledger, or prior contact messages anytime through the Contact page using the topic Privacy / Account Deletion Request.

### Terms (as currently shown, section 1 and title missing)
By accessing or using Voice Studio, you agree to these Terms and Conditions. If you do not accept these terms, discontinue use of the service.

**2. Service Tiers & Availability**
Voice Studio supplies client-side document extraction, audio/video encoding tools, and AI speech synthesis backed by Google Gemini models. Verified accounts receive a shared daily character allowance subject to server capacity; users may also supply their own Google AI Studio API key locally inside browser storage.

**3. Fair Use & Account Integrity**
You agree not to register multiple accounts to multiply daily character quotas, automate bulk scraping requests against the shared API routes, reverse-engineer authentication checks, or interfere with service availability for other users.

**4. Content Ownership & Disclosure**
You retain ownership of documents, scripts, and exported audio/video files you create and warrant that you hold the right or license to process the source text. When publishing synthesized audio or video publicly, comply with the hosting platform's synthetic media disclosure policies.

**5. Prohibited Conduct**
You must not use Voice Studio to produce non-consensual voice impersonations, fraud, harassment, defamation, malware scripts, or content unlawful under applicable law.

**6. Warranty Disclaimer & Liability Limit**
Voice Studio is provided on an "as is" and "as available" basis without warranties of uninterrupted uptime or error-free pronunciation. Verify synthesized numbers, citations, and translations independently before academic, legal, medical, or commercial distribution. To the maximum extent permitted by law, Voice Studio and Moutter Rasool are not liable for indirect, incidental, or consequential damages arising from use of the service.

**7. Contact**
Service notices and inquiries are handled through the Contact page (Operator: Moutter Rasool, Faisalabad, Pakistan).
