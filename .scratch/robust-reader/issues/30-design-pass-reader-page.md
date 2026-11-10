# 30. Design pass on the reader page and the add-on window

Status: done in code; Node tests pass (540 of 540). Screenshots are in the scratch folder of the session, not in the repository.
Type: AFK

## Parent

`.scratch/robust-reader/spec.md` (Design Direction). The decisions of the owner stay as they were: one look from `tokens.css`, orange only for play, the Word highlight and progress, the Player bar in one row, one settings panel, the names from `GLOSSARY.md`.

## How the page was looked at

The reader was opened from the voice server on port 8793 with the sample Book only (id `0d281938d3ff`), in the test browser on port 9333, in its own tab. Light and dark mode, at 1280 px and 900 px wide, with the settings panel closed and open, and once with the Speed method hint shown. The add-on window (`popup.html`) was opened as a file at 320 px. A script measured each control: its height, its text size and weight, and its padding and margins. No Highlight was made.

The windowed Chrome for Testing did not open its DevTools port on this run (it stopped at start, three times). `tools/test-window.sh` was then started with `RA2_TEST_CHROME` set to the Playwright headless shell of the same version (156). The owner's Chrome was not used.

## What was wrong, and what changed

1. **Speed method hint far from its select.** The hint "Stretch, same pitch is not available ..." sat 12 px under the Speed method select. That is the same gap as the one to the next field, so the eye could not tell which field it belongs to. Helper text must sit close to its field. Now it sits 4 px under the select, the same gap as between a label and its field (`styles.css`, `.settings .field + .status`).
2. **Speed method hint not tied to the select for a screen reader.** The select had no description. Now `app.js` (`showMethods`) sets `aria-describedby="methodHint"` on the select while the hint shows, and removes it when the hint hides. A hidden element that is named in `aria-describedby` is still read, so the attribute is not in the HTML.
3. **Buttons with text were 38 px high.** `.btn` had 8 px padding above and below, a 20 px line and a 1 px border: 38 px, off the 4 px grid. In the top bar they stood beside the 32 px zoom buttons; in the settings panel beside 40 px selects. Now `.btn` has no padding above and below, so its height is the control token: 32 px in the top bar, and 40 px in the settings panel (`.settings .btn`), the same as the selects. "Hear this voice", "Re-read book" and "Export audio (MP3)" are now 40 px.
4. **A button with text had no disabled look.** "Hear this voice" is disabled while a voice sample plays and while the reader is busy, but it looked the same as when it works. The disabled rule of play, the icon buttons and the selects (45% opacity) now covers `.btn` too.
5. **Font weights 650 and 550.** The brand, the book title, the contents entry that is read now, the chapter entries and the two settings headings used 650; the text buttons used 550. These are between the normal weights, and they look different on other systems. Now 600 and 500, the weights that the rest of the page uses.
6. **Light controls in dark mode.** In dark mode an empty check box ("Skip boxed quotes"), the scroll bars and the open list of a select were drawn white or light by the browser. A dark screen must have no light surface. `tokens.css` now sets `color-scheme: light dark` on the root, so the controls that the browser draws follow the mode on every screen that uses the token file. The library page already had this as a meta tag.
7. **Two check box sizes.** The check box "Show highlights" in the Highlights list was 16 px; the check boxes of the settings panel and the add-on window are 20 px. Now all are 20 px (`ra2-theme.css`, `.show-marks input`).
8. **Two heading styles for panels.** The head of the Ask Claude panel was in capitals, 12 px, bold, wide letter spacing and muted. The side bar tabs and the settings headings are in sentence case, 14 px, 600. Now the Ask Claude head uses the same sentence case style (`ra2-theme.css`, `.askpane-head`).
9. **Raw pixel values where a token exists.** The width of the settings panel used `100vw - 32px` and, below 480 px, `100vw - 16px`; the zoom level used `48px` below 600 px. Now these use the spacing tokens (`--space-8`, `--space-4`, `--space-12`). The look does not change.
10. **Add-on window: selects 37 px high with 14 px text.** The Voice and Speed method selects were 37 px high (off the grid) with 14 px text, while the same controls in the reader settings are 40 px with 16 px text. Now they are 40 px (`--control-m`) with 16 px text and 12 px side padding, and they have a hover state. The field labels now have the 20 px line height of 14 px text, so each field is 64 px (label 20, gap 4, select 40) instead of 65 px.

## What was left, and why

These need a decision of the owner, or they would be a new feature or a layout change:

- **Speed method as a select.** Three choices that the owner must compare are easier to read as three radio buttons, each with one short line that says what it does. The default ("Simple, as before") is also the last of the three. This changes the layout and the words of the panel.
- **The word "ffmpeg" in the hint.** It is the name of a program, not a word of the glossary. A plain sentence (for example "the voice server cannot stretch the sound on this Mac") would read better aloud. The words are the owner's choice.
- **No hint in the add-on window.** When the voice server cannot stretch the sound, the reader says so under the select; the add-on window does not. This needs code in `popup.js`.
- **The start screen has no action.** "Listen to your papers" says "open one", but the only Open PDF button is in the top bar. One button on the start screen would be a new control.
- **A failed file looks like a normal message.** The message on the start screen copies the read-in text, so the page cannot tell an error from a summary. A clear error look needs a change in `app.js`.
- **No hover on the skip settings.** The rows of "What to read" give no hover feedback. A hover background on a row without side padding would not line up with the headings; it needs a small layout change.
- **2 px values in the Ask Claude area** (the small line under a question, the gap under the Ask bar) are off the 4 px grid. That area is outside this pass.

## Files changed

- `extension/pdf/styles.css`
- `extension/pdf/ra2-theme.css`
- `extension/pdf/tokens.css`
- `extension/pdf/app.js` (`showMethods` only)
- `extension/popup.html` (its style block only)

No element id, class that the scripts use, or data attribute was changed. `index.html` was not changed.

## Checks

- `node --test --test-timeout=120000 tests/node/`: 540 tests, 540 pass. (One run in between had one failure in `web-player-move.test.mjs`, while another session was changing `content.js` and that test file; the file alone passed, and the next full run passed.)
- Screenshots after the change, light and dark at 1280 and 900 px: the top bar buttons and the zoom buttons have one height; the hint sits under its select; the empty check box and the scroll bars are dark in dark mode; the add-on window selects are 40 px.
