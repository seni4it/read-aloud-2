# Chrome Web Store listing: Read Aloud 2

**Name:** Read Aloud 2

**Category:** Accessibility · **Language:** English

**Short description (max 132 characters):**
Listen to web pages, PDFs and scanned books. Word-by-word highlighting, speed up to 4x, natural voices on your Mac.

**Detailed description:**
Read Aloud 2 reads any web page, PDF or scanned book out loud and highlights each word as it is spoken.
Made for people who read slowly or prefer to listen: dyslexia, tired eyes, or long articles.

• Press the round listen button on any page, or the play button beside any paragraph.
• Select text and press "Listen" to hear just that part.
• Right-click: "Listen from here", "Listen to the selected text", "Read the text in this picture".
• The word being read is orange; its sentence is lightly shaded. Click any word while reading to jump there.
• The page follows the voice. Scroll away freely; the target button brings you back.
• Speed from 0.5x to 4x. Previous and next sentence.
• PDFs open in a built-in reader that finds two-column layouts, skips citations, figure captions and reference lists,
  and highlights each word on the page.
• Scanned books (pages that are pictures) are read with the text recognition built into macOS.
• Paste any text and listen to it.

Voices: the voices built into your computer and Chrome work everywhere. Natural voices (Kokoro) run on your own
Mac with the free companion voice server (Apple Silicon); without it the add-on uses the built-in voices.

Privacy: nothing you read leaves your computer. No account, no tracking, no analytics.

## Single purpose
Reads the text of web pages, PDFs and pictures aloud, with word highlighting.

## Permission justifications
- **storage:** remembers your voice, speed and on/off choices.
- **contextMenus:** adds "Listen from here", "Listen to the selected text" and "Read the text in this picture" to the right-click menu.
- **offscreen:** plays the natural voice's audio while you stay on the page.
- **tts:** speaks with the voices built into the computer when the natural voice is not available.
- **webRequest:** notices when a tab opens a PDF, so the PDF can open in the add-on's reader (Chrome's own PDF viewer cannot be read by add-ons). It only reads the response type; it never blocks or changes requests.
- **Host permission (all sites):** the reader works on any page you choose to listen to, and the PDF reader must load the PDF you opened. Page text is only sent to the voice engine on your own computer (127.0.0.1).

## Data use (the "Privacy practices" tab)
- Collects no user data. Tick: "I do not sell or transfer user data to third parties", "I do not use or transfer user data for purposes unrelated to the item's single purpose", "I do not use or transfer user data to determine creditworthiness or for lending purposes".
- Remote code: No. All code ships inside the package.

## Files
- Package: `read-aloud-2-2.1.0.zip`
- Screenshots (1280x800): `screenshot-1-web-page.png`, `screenshot-2-pdf.png`, `screenshot-3-scanned-book.png`
- Small promo tile (440x280): `promo-tile.png`
- Icon (128x128): `../extension/icons/128.png`
- Privacy policy: `privacy-policy.html` (needs a public web address, see below)
