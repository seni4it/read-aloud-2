# 20. One design token file for all screens

GitHub issue: #21
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Use the `key-design` skill (read `book/QUICK_RULES.md`, sub-chapters 2.1, 2.2, 3.2, 3.3, 4.1, 4.3, 4.4, 4.5). It is a private reference: apply the rules, copy none of its content. Follow the Design Direction section of the spec.

Make one token file: primitive colours (navy, orange and one neutral range), semantic colours (background, surface, text, muted text, line, main action, focus, the four highlight groups) with a light and a dark mode, a type scale of 12, 14, 16, 20 and 28 px with line heights in multiples of 4 px, a spacing scale in steps of 4 and 8 px, two corner radii, one shadow set and one motion time set. Make the reader, the library, the add-on window, the paste page and the web-page player use it. Remove each colour value and each size outside the scale from the other style files. The screens look the same or cleaner after this ticket: layout changes come in tickets 21 to 24.

## Acceptance criteria

- [x] A Node test finds no colour value in a style file or a style block outside the token file.
- [x] A Node test computes the contrast of each text and background token pair in both modes: each is 4.5 to 1 or more.
- [x] If the token file has two copies, a test fails when they differ.
- [x] Orange is used only by the play button, the word highlight and progress marks. Dark mode has no light surface, and its background is darker than its cards.
- [x] Font sizes in use are only 12, 14, 16, 20 and 28 px.
- [ ] Screenshots in light and dark mode at 1280, 1024 and 400 px are in the ticket report, with the list of rules that were applied.

## Blocked by

- 02 (test bench)

## Work report

Date: 9 Nov 2026. Status: done, except the screenshots (no browser in this run; see "Manual check").

### Where the tokens are

- One file: `extension/pdf/tokens.css`. There is no copy.
- The add-on serves it at `pdf/tokens.css`. The voice server serves the folder `extension/pdf` at `/reader/`, so the same file is also at `/reader/tokens.css`.
- The reader: `styles.css` starts with `@import url("tokens.css")`.
- The popup and the paste page: their `<style>` block starts with `@import url("pdf/tokens.css")`.
- The library and the YouTube setup page: `library.css` starts with `@import url("/reader/tokens.css")`. The library already loads `/reader/restart.js` in the same way.
- `extension/manifest.json` did not change: the popup and the paste page are pages of the add-on, so they need no `web_accessible_resources` entry.
- The token file has one rule that is not a token: `:focus-visible { outline: var(--focus-ring); outline-offset: var(--focus-offset); }`. So every screen gets the same focus ring.

### Token list (light value / dark value)

Primitives: `--navy-950 #0f172a`, `--navy-900 #10233f`, `--navy-400 #42679b`, `--orange-500 #ff8c00`, `--orange-400 #ffa033`, `--orange-700 #c25e00`, neutral range `--neutral-0 #ffffff`, `-50 #f4f5f7`, `-100 #e8eef4`, `-200 #e2e8f0`, `-300 #a9b8c6`, `-400 #94a3b8`, `-450 #7b8aa0`, `-500 #64748b`, `-550 #5f738a`, `-600 #475569`, `-800 #223140`, `-850 #18222d`, `-950 #0e141b`, and `--blue-600 #2563eb`, `--blue-500 #3b82f6`, `--blue-300 #6ea8ff`, `--red-700 #b91c1c`, `--red-400 #f87171`, `--amber-100/-900/-200/-950`, `--yellow-500 #eab308`, `--green-600 #16a34a`, `--pink-600 #db2777`.

Semantic colours:

| Token | Light | Dark |
|---|---|---|
| `--color-bg` | #f4f5f7 | #0e141b |
| `--color-surface` | #ffffff | #18222d |
| `--color-surface-raised` | #e8eef4 | #223140 |
| `--color-text` | #0f172a | #e8eef4 |
| `--color-text-muted` | #475569 | #a9b8c6 |
| `--color-text-faint` (28 px cover letters only) | #64748b | #94a3b8 |
| `--color-line` (dividers) | #e2e8f0 | #223140 |
| `--color-control-border` | #7b8aa0 | #5f738a |
| `--color-hover` | black 6 % | white 6 % |
| `--color-action` / `--color-on-action` | #10233f / white | #42679b / white |
| `--color-chrome` (navy bar) / `--color-on-chrome` | #10233f / white | same |
| `--color-on-chrome-muted`, `--color-chrome-hover`, `--color-chrome-field`, `--color-chrome-line` | white 75 %, 14 %, 10 %, 20 % | same |
| `--color-play` / `--color-play-hover` / `--color-on-play` | #ff8c00 / #ffa033 / #0f172a | same |
| `--color-progress` | #c25e00 | #ff8c00 |
| `--color-word` / `--color-on-word` | #ff8c00 / #0f172a | same |
| `--color-sentence` | orange 18 % | same |
| `--word-opacity`, `--word-blend`, `--mark-blend` | 0.75, multiply, multiply | 0.6, screen, screen |
| `--color-focus` | #3b82f6 | #6ea8ff |
| `--color-selection` | blue 20 % | blue 30 % |
| `--color-danger` / `--color-danger-soft` | #b91c1c / 6 % | #f87171 / 10 % |
| `--color-notice-bg` / `--color-notice-text` | #fef3c7 / #78350f | #3b2f0b / #fde68a |
| `--color-page` / `--color-on-page` (PDF paper) | #ffffff / #64748b | same |
| `--color-scrim` / `--color-scrim-strong` | navy 60 % / 85 % | same |
| `--color-icon` (brand mark) | #10233f | #e8eef4 |
| `--color-menu-text` (open select list on the navy bar) | #0f172a | same |
| `--hl-yellow`, `--hl-green`, `--hl-blue`, `--hl-pink` and their `-fill` | #eab308, #16a34a, #2563eb, #db2777; fills 32 %, 22 %, 20 %, 20 % | same |

Type: `--text-12/14/16/20/28` with `--leading-12 16px`, `--leading-14 20px`, `--leading-16 24px`, `--leading-20 28px`, `--leading-28 32px`, `--leading-read 32px` (20 px reading text of the paste page), `--font-ui`.
Spacing: `--space-1 4px`, `-2 8px`, `-3 12px`, `-4 16px`, `-5 20px`, `-6 24px`, `-8 32px`, `-10 40px`, `-12 48px`. Control heights: `--control-s 32px`, `-m 40px`, `-l 48px`.
Radii: `--radius-1 8px` (controls, notes), `--radius-2 12px` (cards, panels), `--radius-round 999px` (pills, round buttons), `--radius-mark 2px` (marks on page text).
Shadows: `--shadow-1`, `--shadow-2`, `--shadow-3`, `--shadow-bar` (black, only the alpha changes; stronger in dark mode).
Motion: `--dur-hover 100ms`, `--dur-move 200ms`, `--dur-word 90ms`, `--dur-flash 1200ms`, `--ease-out`. With reduced motion, each time is `0ms`.
Focus: `--focus-width 3px`, `--focus-offset 2px`, `--focus-ring`.

### Contrast (computed by the test)

- Light: the lowest text pair is 4.54 to 1 (white text on the scrim over the page). Then 4.76 (page label on the PDF paper). Body text 16.37 on the page. Muted text 6.95 on the page.
- Light controls: field edge 3.22 on the page, 3.51 on a card. Progress mark 3.48 on its track. Focus ring 3.37 on the page, 3.68 on a card, 4.28 on the navy bar.
- Dark: the lowest text pair is 4.76 to 1 (page label on the PDF paper, which stays white). Then 5.07 (warning text in its box). Body text 15.84. Muted text 9.13.
- Dark controls: the main button on the page 3.21. Field edge 3.30 on a card. Focus ring 6.53 or more.
- Orange on white is less than 3 to 1. So the progress mark in light mode uses a darker orange (#c25e00). The play button and the word highlight keep #ff8c00: their text (#0f172a) is 7.65 to 1 on it.

### Rules applied (my own words)

- Spacing and sizes on a 4 px grid, gaps mostly in 8 px steps; line heights in steps of 4 px.
- Outer radius = inner radius + inner gap (cards 12 px around 8 px controls).
- One type scale of five sizes; smallest text 12 px; body text 16 px on a 24 px line; meta text 14 px on 20 px.
- Few colours: neutrals everywhere, the brand orange only on the main action (play), the word highlight and progress; icons neutral.
- Three colour layers: values, primitives named by family and weight, semantic tokens named by use, with a light and a dark mode.
- Text contrast 4.5 to 1 or more; control edges and focus ring 3 to 1 or more; a brand colour that fails is darkened.
- Dark mode: no light surface; the background is the darkest tone, cards lighter; a dark tone, not pure black; muted text.
- Shadows from black with only the alpha changed.
- Hover feedback in 100 ms; motion stops when the system asks for reduced motion.
- A visible focus state on each control.

### Visible changes (what a person will see)

All screens:
- A blue focus ring on each control that gets the keyboard focus (the popup and the paste page had none).
- Text sizes 13, 13.5, 14.5, 15, 17, 18, 19, 22, 24 and 26 px became 12, 14, 16, 20 or 28 px. The reader body text is 16 px (was 15 px).
- Field and quiet-button edges are darker grey (3 to 1), so a field is easier to see.

Reader:
- Dark mode uses the same blue-grey tones as the library (background #0e141b, panels #18222d), not the old grey-black.
- Dark mode: "Open PDF" is a lighter navy button with white text, not orange.
- The active contents entry is a grey row with an orange bar on its left, not orange text on an orange shade.
- The selected side tab, the icon-button hover, the text selection and the drop frame are neutral or blue, not orange.
- The "Ask" button on the navy Ask bar is white with navy text, not orange. The Ask text box is dark in dark mode.
- The follow button "away" state is a white ring, not orange. A found highlight flashes with a blue ring, not orange.
- The checkboxes are navy, not orange. The highlight dots are 12 px (were 14 px). Top-bar icon buttons are 32 px (were 34 px).

Library and YouTube page:
- Dark mode: the "+ Add PDF" button is lighter navy, not orange; the brand mark is light, not orange.
- The hover ring of a book card is grey, not orange.
- Light mode: the progress line on a card is a darker orange (#c25e00).
- The brand name is 20 px (was 18 px); card titles 16 px (were 15 px).
- YouTube setup: the step numbers are navy circles (were red); the text is 20 px (was 19 px).

Popup and paste page:
- Dark mode: the page is the card tone #18222d (was #0e141b).
- The popup title is 20 px (was 17 px); the paste title is 28 px (was 24 px); the paste text line is 32 px (was 34 px).
- The speed slider and switches are navy, not orange. "Listen to this page" and "Listen" stay orange: they are play buttons.

### Files changed

- New: `extension/pdf/tokens.css`, `tests/node/design-tokens.test.mjs`.
- Changed: `extension/pdf/styles.css`, `extension/pdf/ra2-theme.css`, `app/library.css`, the `<style>` blocks of `extension/popup.html`, `extension/paste.html`, `app/youtube-setup.html`.
- Changed outside the listed files, the smallest change: two earlier tests read the raw values that are now tokens. `tests/node/library-page.test.mjs` (cover contrast) and `tests/node/small-pages.test.mjs` (paste text size 16 px) now resolve the token names. Their checks and limits are the same.
- Not changed: every `.js` file, `extension/content.css`, `voice-server.py`, `extension/manifest.json`.

### Tests

`tests/node/design-tokens.test.mjs` has 13 tests:
- the contrast of 30 pairs in light mode and in dark mode (text 4.5, large text and controls 3);
- dark mode: no light surface, background darker than cards;
- one copy of the token file only, and the server path `/reader/` is `extension/pdf`;
- each screen imports the token file first;
- no colour value (hex, rgb, hsl or a colour name) and no token definition in a style file or `<style>` block outside the token file;
- each `var(--…)` is defined in the token file;
- font sizes only 12, 14, 16, 20, 28 px, through the `--text-*` tokens; line heights are tokens;
- px values of space and size are steps of 4 px (borders and the word-box pad of 1 to 2 px are allowed);
- orange: the orange primitives feed only the play, progress, word and sentence tokens, and these are used only on play controls, progress marks and the word or sentence marks;
- motion: each transition and animation uses a motion token, and reduced motion sets each to 0;
- the focus ring rule is in the token file, and no screen removes a ring without another mark;
- no `.js` file uses a CSS token.

`./run-tests.sh`: Python 12 tests OK; Node 278 tests, 278 pass; `RESULT: PASS`.

Allowed exceptions (not checked by the colour test):
- `extension/content.css` and the styles that `extension/content.js` injects: the web-page player, ticket 24.
- The SVG attribute `stroke="#eab308"` of the highlight button icon in `extension/pdf/index.html`: an HTML attribute, not a style. Ticket 21 rebuilds that button; it can use `stroke="currentColor"` with a class that sets `color: var(--hl-yellow)`.

### Manual check in a real Chrome (light and dark)

Use the Chrome test window (test profile). Set the system to light mode, then repeat each step in dark mode (System Settings, Appearance). Take screenshots at 1280, 1024 and 400 px window width.

1. Reload the add-on in `chrome://extensions` at an agreed time (the reload stops the reading for some seconds).
2. Open the reader from the popup ("Open a PDF"). Open a sample PDF from `tests/pdf-text/samples/`.
3. Check: the top bar, the side bar and the page show no orange except the play button, the seek bar and the parse bar.
4. Press play. Check: the word box is orange, the sentence shade is light orange, the active contents entry has an orange bar on its left.
5. Press Tab several times. Check: each control shows a blue ring, also on the navy player bar.
6. Make a highlight of each group. Open the Highlights tab. Check the four colours on the page and in the list.
7. Open the Ask tab and the Ask bar. Check: the Ask text box is dark in dark mode, the Ask button is white on the navy bar.
8. Open `http://127.0.0.1:8793/app/` (the library). Check: the page has its colours (if the token file did not load, the page has no background colour and no card shadow). Check the card progress line, the hover ring and "+ Add PDF".
9. Open the popup and the paste page. Check: the orange play button, navy switches, the focus ring.
10. Set "Reduce motion" in System Settings, Accessibility, Display. Check: the word box jumps without a slide, and a found highlight does not flash.

### What tickets 21 to 25 need

- All tickets: use only the tokens; the test fails on a new colour value, a font size outside the scale, or a raw motion time. A new token goes into `extension/pdf/tokens.css` with a light and, if it differs, a dark value, and a contrast pair in the test if it is text or a control.
- 21 (player bar): `--color-chrome`, `--color-on-chrome(-muted)`, `--color-chrome-hover`, `--color-chrome-field`, `--color-chrome-line`, `--color-play(-hover)`, `--color-on-play`, `--color-progress`, `--control-m` (icon buttons), `--control-l` (play), `--dur-hover`, `--shadow-bar`, `--shadow-3` (settings panel), `--radius-2`. Replace the SVG `stroke="#eab308"` of the highlight button (see above). A spinner on play must use `--dur-*` so that reduced motion stops it.
- 22 (reader frame): `--color-surface`, `--color-surface-raised` (selected tab and active entry), `--color-progress` (the mark of the part read now), `--text-14`/`--leading-14`, `--space-*`; the parse bar uses `--color-progress` at 16 %.
- 23 (library): `--color-progress` for progress lines, `--color-action` for the one filled button, `--shadow-2`, `--radius-2`; card placeholders can use `--color-surface-raised`.
- 24 (web-page player, popup, paste page): the player in `content.js` and `content.css` still has its own colours. It needs: `--color-chrome`, `--color-on-chrome`, `--color-on-chrome-muted`, `--color-chrome-hover`, `--color-chrome-field`, `--color-chrome-line`, `--color-play`, `--color-play-hover`, `--color-on-play`, `--color-word`, `--color-on-word`, `--color-sentence`, `--color-progress`, `--color-focus`, `--focus-ring`, `--control-s/-m/-l`, `--radius-round`, `--shadow-3`, `--dur-hover`, `--dur-word`, `--text-12/14/16`, `--font-ui`. A web page cannot read `:root` tokens of the add-on: the player in its own style scope (shadow root) must load `pdf/tokens.css` (then `extension/manifest.json` needs `pdf/tokens.css` in `web_accessible_resources`) or a generated copy of the values with a test that compares it to the token file. Note: on a web page the tokens must be set on the player's host (`:host`), not on the page's `:root`, so that a site's own `--color-*` variables cannot change the player. The highlights `::highlight(ra2-sentence)` and `::highlight(ra2-word)` in `content.css` need `--color-sentence` and `--color-word`. Add `content.css` and `content.js` to the colour test of `design-tokens.test.mjs` when done.
- 25 (player move): no new colour; use `--dur-move` for the snap, so that reduced motion stops it.
