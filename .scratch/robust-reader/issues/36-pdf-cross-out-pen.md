# 36. PDF reader: a cross-out pen for text the owner does not want to use

Status: done in code; the owner's check in Chrome is open
Type: AFK (done); the check is HITL

## Parent

`.scratch/robust-reader/spec.md`

## What he asked

His words (24 Nov 2026): "add the option not only to highlight in the pdf reader but also to cross through the text if i dont want to use it."

## The prototype and his choice

A prototype with 3 variants (branch `prototype/cross-out-2026-11-24`, file `prototypes/cross-out/index.html`):
A, Cross out in the selection bar with a red line and the parts in the Highlights list; B, cross out the sentence being read from the player bar, with a grey fade and its own tab; C, a cross-out pen, a thick dark line, a count above the page and no list.
His answer: "variant c".

One change from the prototype: the pen button is in the player bar, beside the highlight button, not in the top bar. The top bar keeps 5 controls or fewer (`tests/node/reader-frame.test.mjs`, Key Design).

## What was built

- `extension/pdf/crossout.js`: `spokenText(text, cuts, from)` gives the text that the voice says without the crossed-out parts, and the place in the sentence of each said letter, so the word highlight still finds each word. A sentence crossed out whole is not said.
- `notes.js`: crossed-out parts are kept in the list of the highlights with the colour `cut` (same storage), and drawn on the page also when "Show highlights on the page" is off. They are not counted, listed or exported as highlights. The pen (`penBtn`), the line above the page (`cutLine`, Bring all back), a click on a crossed-out part (Bring back; with the pen on, at once). `cutsOf(si)` for the reader.
- `app.js`: `spokenAt(i, from)` for each sentence that is said, the prefetch and the MP3 export. The skip setting "Skip crossed-out text" (`optCut`, kept as `ra2.skipCut`, on by default).
- `index.html`, `ra2-theme.css`, `tokens.css` (`--color-cut`), `styles.css` (the pen is not shown below 480 px).
- README (Highlights), GLOSSARY (Cross-out pen, Crossed-out text).

## Acceptance criteria

- [x] `tests/node/cross-out.test.mjs`: 7 tests; they fail on the old code (no `crossout.js`, no `cutsOf`).
- [x] `./run-tests.sh`: RESULT: PASS.
- [x] Browser pane check with the sample `two-columns.pdf`: the pen draws the line, the voice leaves the part out, with the switch off it is read, a click with the pen brings it back.
- [ ] The owner crosses out a part of his book in Chrome and hears it left out.
