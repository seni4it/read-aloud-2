# Read Aloud 2

Version 2 of the read-aloud tools: natural voices and a Chrome add-on like Speechify.
Version 1 (`~/.claude/read-aloud`, the Claude chat reader on port 8791) is separate and unchanged.

## Parts

- `voice-server.py`: natural voices on this Mac (Kokoro-82M through mlx-audio), port 8793, this Mac only.
- `voices.html`: the voice sampler, at http://127.0.0.1:8793/
- `extension/`: the Chrome add-on "Read Aloud 2".

## Start the voices

```
~/.local/share/uv/tools/mlx-audio/bin/python ~/"tts module"/voice-server.py
```

The first sentence after a start takes about 10 seconds; then each sentence takes about half a second.
Without the voice server the add-on still works, with the voices built into the Mac.

## Install the add-on in Chrome (once)

1. Open `chrome://extensions`.
2. Switch on "Developer mode" (top right).
3. Press "Load unpacked" and choose the folder `~/tts module/extension`.
4. Pin "Read Aloud 2" in the puzzle-piece menu so its button stays in the toolbar.

## What it does

- Toolbar button: "Listen to this page", voice, speed, switches.
- Round listen button on the right edge of every page.
- A small play button beside the paragraph under the mouse: reads from there.
- Select text: a "Listen" bubble reads just that.
- Right-click: "Listen to the selected text" and "Listen from here".
- Player bar: previous sentence, play or pause, next sentence, speed (0.5x to 4x) and voice, target button, close.
- The word being read is orange; its sentence is lightly shaded. The page itself is not changed.
- The page follows the voice until you scroll; the target button brings you back.
- While reading, a click on any word jumps there.
- "Listen to pasted text" page.
- Keyboard shortcuts: none by default, so no key starts reading by accident. Set them at `chrome://extensions/shortcuts`.
- Skips menus, footers, side bars, buttons and code blocks.

## PDFs, scanned books, other files

- A PDF opened in Chrome switches to the add-on's own reader (`extension/pdf`, Paper Reader's viewer copied from
  `~/paper-reader` at commit 8ee8a1e), with the natural voice. It finds two columns, skips citations, figure captions
  and the reference list, and highlights each word on the page. Switch off in the popup ("Open PDFs in Read Aloud 2").
  Changes from Paper Reader: the Mac voice engine (`tts.js`), scanned pages (`ocr.js`), a paper's title block no
  longer hides its columns, and a heading no longer swallows the lines after it (`extract.js`, marked "Read Aloud 2").
- Scanned PDFs (pages that are pictures): the text is read by Apple's Vision on this Mac (`ocr/ocr.swift`, built
  the first time it is needed), then read and highlighted like any PDF. About 5 seconds a page; pages ahead are
  read while you listen.
- Pictures on web pages: right-click, "Read the text in this picture".
- Plain `.txt` files: read like a page.
- Local PDF files need one switch in Chrome: the add-on's details, "Allow access to file URLs". Or press
  "Open PDF" in the reader.
- Not covered: Google Docs (drawn on a canvas, closed to add-ons), Word and EPUB files (Chrome downloads them).

## Test window

`tools/test-window.sh` opens a separate Chrome window with the add-on loaded, without touching your own Chrome.

## Licences

Kokoro-82M: Apache-2.0. mlx-audio: MIT. Both are used from the existing install on this Mac, not copied here.
Open-source alternative considered: Read Aloud by ken107 (MIT); it highlights in a separate window, not in the page.
