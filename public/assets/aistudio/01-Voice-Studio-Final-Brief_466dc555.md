# Voice Studio: Final Brief (Audit, Original Identity, AdSense Readiness)

Site: https://voice-studio-three.vercel.app
Owner: Moutter Rasool, Faisalabad, Pakistan
Written: 20 November 2026

This file replaces the earlier redesign and SEO guide. It keeps that guide's good SEO findings and changes three things: the design concept (less templated), the monetisation plan (Google AdSense rules), and the legal and content fixes that AdSense and Google's Gemini terms require.

Golden rule for the AI that edits the site: keep every existing feature and all logic working exactly as it is. Change only design, layout, page structure, wording, legal text and SEO setup.

---

## 1. What was checked and what was not

Checked by opening the live home page: the full visible text, the page title, meta tags, the sign-in wall, the module descriptions, the settings text and the footer links.

Not checked by me (my tools could not open the inner pages): /urdu-tts, /pdf-to-audio, /about, /faq, /privacy, /terms, robots.txt, sitemap.xml. The earlier guide's claims about those (same HTML on every route, canonical pointing to the home page, 16 h1 tags, favicon.ico missing, og-card.jpg size) were not confirmed by me. The AI editor must re-test them after the rebuild.

## 2. Current state in plain words

Strong:
- Real, useful features: PDF/EPUB/Word to audio, chapter selection, header and page-number cleanup, Urdu and English mixed text, SRT/VTT captions, subtitled video, own-key unlimited mode.
- Privacy by design: files stay in the browser.
- Built-in trust pages: About, Contact, Privacy, Terms, FAQ, Guides, Formats.
- A real founder story and a real accessibility reason to exist.

Weak:
1. A sign-in wall hides the product. Visitors (and Google's reviewer) cannot try anything.
2. It looks like a template: badge line above the headline, three numbered cards, spec lists, FAQ, one blue colour, no real images.
3. Wording is full of engineering terms (MPEG frames, PCM buffers, DC offset) that students do not understand.
4. Text content is thin and technical. Guides are summaries, not real articles.
5. It lives on a vercel.app address.
6. The Privacy Policy says no ad networks are used, which will become false once ads are added.
7. The text recommends "Gemini 3.1 Flash TTS Preview". Google's Gemini API terms do not allow Preview models in production use.
8. Public HTML reportedly contains Admin, Account and verification text, and "We sent a verification link to ." with no email.
9. Privacy and Terms start at section 2 and have no title.

## 3. Rough worth, honestly

- With no revenue and no traffic, the site is worth very little as a sale item. Flippa's own rule caps the asking price of any pre-revenue site or app at $9,999, and its normal starting price for a business with profit is 2 to 2.5 times yearly net profit. Content sites with real profit sell for a multiple of monthly profit; yours has no profit yet.
- My own judgment, not a quote: as code plus a brand, today it is a few hundred dollars, perhaps a little more. Its value is future earning, not resale.
- What raises the value: organic search traffic, a custom domain with age, a steady stream of useful articles, an email list, and any paying users.
- Plan to earn from it, not to sell it.

## 4. AdSense: the rules that matter for this site

Facts taken from Google's policy pages and recent guides:

1. Ads are not allowed on screens without real publisher content, on low-value content, on under-construction screens, or on dead-end screens such as Log in, Thank You, Exit and Error pages. Tool-only sites are a known rejection reason, so every tool page needs substantial original text around it.
2. Do not place ads on automatically generated content that nobody reviewed or curated. Write and edit articles by hand.
3. Content behind a login is not seen by Google unless credentials are given to it. The public pages must carry the content.
4. You must own or control the site. A *.vercel.app address is a subdomain Vercel controls, and reports say AdSense rejects such sites. Use a custom domain with HTTPS.
5. Required trust pages: Privacy Policy that mentions ads and cookies, About, Contact (working email or form). Google sets no fixed minimum for traffic, domain age or article count, but most guides advise 15 to 25 good articles before applying.
6. The Privacy Policy must disclose Google as a third-party advertising vendor, ad cookies, and how users can opt out. For visitors in the EEA, UK and Switzerland a consent banner from a Google-certified consent platform is needed. Check Google's current EU User Consent rules before launch.
7. After approval, add ads.txt at the site root.
8. Pakistan: AdSense pays by bank wire transfer (Western Union has also been reported). Expect address (PIN) verification by post, US tax information (W-8BEN) and a payment threshold of about $100. Confirm the current options in Google's own payment table.
9. Ad placement rules: no ads near buttons that invite accidental clicks, no auto-refreshing ads, and ads must not outweigh content.

### Ad policy for Voice Studio (decide now)

- The tool workspace stays ad-free, for everyone. It protects the screen-reader experience and keeps the site inside the "no ads on non-content screens" rule.
- Ads go only on article pages (guides, how-tos) between paragraphs, never directly beside buttons.
- No ads on sign-in, error, thank-you or account pages.
- Mark ad slots with a visible label and make sure they never trap keyboard focus.

## 5. Gemini API rules that affect a monetised site

From Google's Gemini API additional terms (checked earlier in this project):
- Users of apps built on the API must be 18 or older.
- Preview-labelled models are not allowed for production use. Use a generally available model, and check each model's label in AI Studio before launch.
- Apps offered to users in the EEA, Switzerland or the UK may use only paid Gemini API services.
- On the free quota Google may use submitted content to improve its products and human reviewers may read it. The shared daily allowance on the server should therefore use a paid key, and the Privacy Policy must say plainly that the text being voiced goes to Google and is handled under Google's terms.
- Google does not claim ownership of generated content, but may generate the same or similar content for others. In the United States, content made only by AI is generally not copyrightable, so do not promise users exclusive copyright over the audio.
- Audio from Gemini carries an inaudible SynthID watermark. Keep the notice that users should follow each platform's rules for disclosing synthetic voices.

## 6. An original identity (not the template look)

Why the old concept needs care: "warm cream paper, serif headline, saffron accent, open book" is itself becoming a common AI-editorial default. Use it only if it is carried through with real material.

### Concept: "The Page That Speaks"

Voice Studio is built by someone who listens to his books. So the site itself should speak.

Three signature ideas that no template has:

1. **Listen to this page.** Every article and every main section has a real "Listen to this section" button that reads it aloud with Voice Studio's own voice. The product proves itself on every page, and it is a real accessibility feature.
2. **The page as an audio timeline.** The home page is laid out like a simple audio editor: sections are clips on one horizontal track with time labels (00:00 Hear it, 00:40 How it works, 01:20 Your privacy, and so on). Visually it is a timeline; in the code it stays normal headings and links, so screen readers read it as a normal page.
3. **Urdu and English on one line.** Show mixed Urdu and English text with a moving highlight that follows the voice, right-to-left and left-to-right together. This is the one thing Pakistani students cannot get from big competitors.

Real material to use instead of stock art:
- A real PDF page, before and after cleanup (page numbers and headers fading away).
- Real screenshots of the tool, real audio samples recorded with it.
- A founder photo or voice note and a short honest story.
- A "file size ruler": one hour of audio is about 28 MB, shown next to a WhatsApp chat bubble.

### Design tokens (all contrast ratios measured)

| Role | Colour | Check |
| --- | --- | --- |
| Paper (light mode background) | #F6F4EF | |
| Ink (text) | #14181C | 16.2:1 on paper |
| Muted text | #5B6470 | 5.5:1 on paper |
| Signal tangerine (buttons, highlights) | #FF6A2B | ink text on it is 6.2:1; never use it as text on paper |
| Deep teal (links, secondary buttons) | #0B6B63 | 5.8:1 on paper, white on teal 6.4:1 |
| Dark mode background | #11161A | text #F2EFE8 15.9:1, muted #9AA5B1 7.3:1, tangerine #FF8A55 7.8:1 |

- Avoid: purple-blue gradients, badge pills above the headline, three equal icon cards, glassmorphism.
- Fonts (check each on Google Fonts): headings Bricolage Grotesque; body Atkinson Hyperlegible (designed for readability by the Braille Institute, which also tells the accessibility story); Urdu Noto Nastaliq Urdu with generous line height.
- Break symmetry: one large "Books to Audio" card, two smaller ones. One feature gets a full-width demo.
- Respect prefers-reduced-motion and prefers-color-scheme. Provide a visible light/dark switch.

## 7. Page plan

Public pages must hold their own content in static HTML before any script runs.

| Route | Purpose |
| --- | --- |
| / | Hero with a working try-it box (no sign-in), three real samples, before/after cleanup, founder story, tools, privacy promise, who it is for, short FAQ |
| /app | The workspace (sign-in allowed here, ad-free) |
| /pdf-to-audio | Books and PDF tool page with real explanation, steps and examples |
| /urdu-tts | Urdu and English text to speech, with Urdu examples and samples |
| /podcast-studio | Two-voice podcast and translation |
| /video-subtitles | Subtitled video export |
| /guides and /guides/[title] | Real articles (see section 8) |
| /formats | Supported formats; technical details in one collapsible section |
| /faq, /about, /contact, /privacy, /terms | Complete, written by hand |
| /404 | Helpful page with links, returning status 404 |

Public try-it box: allow a short free trial without signing in (for example 300 characters, or one preview using the visitor's own key). Sign-in is needed only for the larger daily allowance, ZIP and video.

## 8. Content that AdSense and search will accept

Rule: every article is written or heavily edited by a person, from real use. No bulk generated text. Each article has: a real author box (name, short bio, link to About), a date and last-updated date, 800 to 1,500 words, original screenshots or audio, and a clear helpful answer.

Starter list (aim for 20 before applying; publish about 2 a week):
1. How to turn a PDF textbook into MP3 audio, step by step
2. Urdu text to speech: getting English terms pronounced correctly
3. How blind and low-vision students can listen to their textbooks
4. How to make an audiobook from an EPUB, chapter by chapter
5. How to turn class notes into a two-voice study podcast
6. How to make Urdu subtitle videos for Shorts and Reels
7. How to use your own free Gemini API key for unlimited audio
8. Revising for Matric and FSc by listening: an exam-season plan
9. What to do when a scanned PDF will not read aloud
10. Best audio size settings for sharing on WhatsApp
11. How to remove page numbers and headers before listening
12. Roman Urdu and Urdu script: which reads better aloud
13. Listening to research papers: a method for university students
14. How to check and fix wrong pronunciations in long documents
15. Making lecture audio for classmates on slow mobile data
16. A day of study using only audio: a real test with results
17. Voice Studio compared with other PDF readers: honest strengths and limits
18. Privacy: what stays on your device and what goes to Google
19. Accessibility tips for using Voice Studio with NVDA and TalkBack
20. How to cite and disclose AI-generated audio on YouTube and in class

Titles 16 and 17 need real tests by the owner. Do not publish invented results.

## 9. Legal text fixes (needed before applying)

Privacy Policy (add title and numbering from 1):
- Say clearly that Google AdSense and its partners show ads on content pages, use cookies and similar technologies, and that users can manage ad settings in Google's Ads Settings and opt out of personalised ads. The workspace shows no ads.
- Say that text sent for voicing goes to Google's Gemini API and is processed under Google's terms. Do not say "no third party sees your text".
- Keep: files parsed in the browser, localStorage use (own key), Firebase account records, contact messages, deletion on request.
- Add: how long records are kept, a cookie and consent section (with the consent banner for EEA, UK and Swiss visitors), a children section (18 and over), the date of the last update, and a working contact email.
- Remove: the sentence that no ad networks or advertising trackers are used, as soon as ads go live.

Terms and Conditions (add title and section 1):
- Add: advertising on content pages, no guarantee of audio accuracy, fair-use limits, termination of abusive accounts, and a statement that generated audio may not be copyrightable in some countries.
- Keep: ownership of user content, synthetic voice disclosure, prohibited conduct (impersonation, fraud, harassment, malware, unlawful content).

Other pages: About must say who runs the site and why; Contact must show a real email address plus the form. Have a lawyer read the final legal pages before relying on them.

## 10. SEO and technical list (from the earlier guide, still valid, re-test everything)

- Prerender every public route to static HTML with its own title, description, self-referencing canonical, Open Graph and Twitter tags, exactly one h1, and its own content.
- Custom domain, 301 redirect from vercel.app, update canonical, sitemap and robots.txt; Search Console and Bing verified; sitemap submitted.
- Remove the meta keywords tag. Add favicon.ico, favicon.svg, apple-touch-icon. Compress og-card.jpg under about 300 KB at 1200 by 630.
- lang="en" on the page, lang="ur" dir="rtl" on Urdu blocks; hreflang only when full Urdu pages exist.
- Structured data: WebApplication with free offer and creator Person, BreadcrumbList on inner pages, Organization or Person with logo and profile links. Validate with Google's Rich Results Test.
- Load heavy libraries (PDF.js, Mammoth, JSZip, MP3 encoder, Firebase) only inside /app. Target LCP under 2.5 s, INP under 200 ms, CLS under 0.1 on mobile.
- Do not render Admin, Account or verification screens in public HTML. Fix the empty verification email message.
- llms.txt is optional. ads.txt only after AdSense approval.

## 11. Accessibility (this is the brand)

Keep the existing skip link, labels and settings drawer. Add: one h1 per page and correct heading order; visible labels on every field; visible focus; no keyboard traps; contrast 4.5:1 or better; aria-live for status messages; labelled player controls; the "Listen to this section" feature; ad slots labelled and outside the focus path of the tool; tested with NVDA and TalkBack.

## 12. Order of work

1. Buy a custom domain and connect it. 2. Rebuild the design and static pages with the try-it box. 3. Fix legal pages and the Gemini model label. 4. Write the first 10 real articles with the owner's tests and audio. 5. Verify Search Console, check mobile and accessibility. 6. Reach 20 articles, add the consent banner, apply for AdSense. 7. After approval add ads.txt and ads on article pages only. 8. Review Search Console monthly.

## 13. Sources used for this brief

Google AdSense publisher policies (screens without publisher content, ad placement), recent 2026 AdSense approval guides, Gemini API additional terms, Flippa valuation help pages, Pakistan AdSense payment guides, and design research on generic AI-built websites. Secondary guides can be wrong: confirm each rule on Google's own pages before acting.
