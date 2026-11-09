# 22. Reader top bar and side bar: contents first, settings out of the way

GitHub issue: #23
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Use the `key-design` skill (read `book/QUICK_RULES.md`, sub-chapters 1.1, 4.1, 6.1, 7.3, 9.1). It is a private reference: apply the rules, copy none of its content. Follow the Design Direction section of the spec.

The side bar shows only its three tabs (Contents, Highlights, Ask) in sentence case at 14 px, and the list of the open tab uses the full height. The 7 skip settings and the buttons 'Re-read document' and 'Export audio (MP3)' move to the settings panel of ticket 21, under a heading 'What to read'. The orange strip with the numbers of sentences and repairs goes away: its text moves to the foot of the settings panel. In the top bar the filled button style goes away: 'Open PDF' and 'Library' are quiet buttons, and the book title is the heading. A contents entry is 40 px high, a long entry wraps to two lines and is not cut, and a nested entry lines up with the text of its parent. The entry of the part that is read now has a clear mark.

## Acceptance criteria

- [ ] With a book of 30 contents entries at 768 px window height, the contents list shows 10 entries or more without a scroll.
- [ ] No contents entry is cut in the middle of a line.
- [ ] Each skip setting, re-read and export works from the settings panel and keeps its state.
- [ ] The top bar has 5 controls or fewer and no filled button.
- [ ] The side bar opens and closes with the same key and button as before.
- [ ] Screenshots in light and dark mode at 1280, 1024 and 400 px are in the ticket report, with the list of rules that were applied.

## Blocked by

- 21 (player bar and settings panel)
- 04, 07 (they own viewer.js and notes.js)

## Work report

Date: 10 Nov 2026. Status: done in code and tests. The screenshots in light and dark mode at 1280, 1024 and 400 px are for the coordinator (no browser in this run).

### What a person sees now

Top bar, from left to right: the small brand mark (headphones), the book title as the heading of the page (16 px, dark, bold), the zoom buttons (−, 100 %, +), then "← Library" (only in the desktop app) and "Open PDF". All buttons are quiet: an outline, no fill. That is 5 controls at most. Each zoom button shows its name and key after 500 ms ("Zoom in (⌘ +)").

Under the top bar, while the text of a book is read in, a thin 4 px line fills from left to right in orange. There is no strip with numbers any more.

Side bar: only the three tabs "Contents", "Highlights (0)" and "Ask", in sentence case at 14 px, and the × that hides it. The side bar is 320 px wide (was 264 px), so the three tabs fit and none is cut. The list of the open tab uses the full height down to the player bar.

Contents list: each entry is at least 40 px high. A long title wraps to a second or third line and is never cut. A chapter entry is bold; an entry inside a chapter has the same left edge as the chapter's text and is grey, not smaller. The part that is read now has a grey row with a 4 px orange bar on its left and bold text.

Settings panel (from the settings button of the player bar): under "Voice" the voice choices of ticket 21; under "What to read" the seven skip settings as rows of 40 px with a 20 px box ("Skip citations", "Skip figure captions", "Stop at references", "Start at abstract", "Skip boxed quotes", "Skip tables", "Skip text in parentheses"), then the quiet buttons "Re-read document" and "Export audio (MP3)" (the export only in the desktop app) and the export progress. At the foot, in small grey text: the read-in summary ("340 sentences · 12 sections · 3 ligature words repaired · resumed at 41").

Each skip setting is now kept after a reload, all seven (before, only three were kept).

A file that cannot open: the message ("Could not open "notes.txt": it is not a PDF, or it is damaged.") shows on the start screen in bold, under the start text.

### Rules applied (my own words)

- One main action per screen: the filled button style is only for Play; the top bar has quiet buttons.
- Every element earns its place: settings that are used rarely go into one panel, and the list that is used often gets the full height.
- The heading of a screen is its subject: the book title.
- Navigation and list items are 40 px high; a two-line item grows instead of being cut.
- A nested list item lines up with the text of its parent; hierarchy comes from weight and colour, not from many indents.
- Few items in a side bar: three tabs.
- Text labels in sentence case, not capitals.
- Settings in a panel: a heading for each group, a visible label for each control, quiet buttons, left aligned.
- Spacing and sizes from the 4 and 8 px scale.

### Visible changes, one by one

1. Top bar: "Open PDF" is a quiet button (was filled navy). The title is the heading: dark and bold at 16 px (was grey 14 px). The name "Read Aloud 2" next to the mark is now for a screen reader only (the window title keeps it).
2. Zoom buttons: 500 ms labels with keys; no browser tooltip.
3. The orange strip with numbers under the top bar is now a 4 px progress line; the numbers are at the foot of the settings panel.
4. Side bar: 320 px wide; tabs in sentence case at 14 px (were capitals at 12 px); the tab corners are 8 px (were round).
5. The skip settings, "Re-read document", "Export audio (MP3)" and the export progress moved from the bottom of the side bar to the settings panel, under "What to read".
6. Contents entries: 40 px or more, no cut at two lines, nested entries at the same left edge (were indented and 12 px), a 4 px mark on the part read now (was 3 px).
7. Start screen: a message line for a file that could not open. Its heading is now the second level (the book title is the first).
8. All seven skip settings are kept after a reload.

### Controls moved

- `#optCitations`, `#optCaptions`, `#optRefs`, `#optFrontMatter`, `#optInsets`, `#optTables`, `#optParens`, `#reparseBtn`, `#exportBtn`, `#exportStatus`: from the bottom of the side bar to the settings panel, group "What to read" (`#readGroup`).
- `#parseText`: from the strip under the top bar to the foot of the settings panel. `#parseBar` and `#parseFill` stay under the top bar as the progress line.
- `#tocBtn` stays in the player bar and `#closeSidebar` in the side bar: the side bar opens and closes with the same buttons as before.
- All ids stayed. New ids: `readGroup`, `readHead`, `emptyMsg`.

### Files changed

- `extension/pdf/index.html`, `extension/pdf/styles.css`, `extension/pdf/ra2-theme.css`.
- `extension/pdf/app.js`, wiring only: the four first skip settings are kept like the other three (same storage, old defaults), and the read-in message is shown on the start screen too (a `MutationObserver` copies the text of `#parseText` to `#emptyMsg`). The reading and open logic did not change.
- New: `tests/node/reader-frame.test.mjs`. The shared helper `tests/node/reader-css.mjs` got a fake `MutationObserver`.

### Tests

`tests/node/reader-frame.test.mjs`, 13 tests:
- the side bar holds only the three tabs, the close button and the lists of the tabs;
- the three tabs fit in the side bar: no tab is cut at the right edge;
- the skip settings, Re-read and Export are in the settings panel under "What to read";
- the read-in summary is at the foot of the settings panel; the strip above the page is a thin progress line;
- a file that cannot open shows its message on the start screen;
- the top bar has 5 controls or fewer, no filled button, and the book title is its heading;
- a contents entry is at least 40 px high, wraps to more lines and is never cut;
- a nested contents entry lines up with the text of its parent;
- the entry of the part that is read now has a clear mark;
- with 30 contents entries in a window 768 px high the list shows 10 entries or more (the calculation gives 14);
- each skip setting keeps its state after a reload, and a change reads the book again;
- the side bar opens and closes with the same button as before;
- no control is lost: every control of the reader before tickets 21 and 22 is still in the page.

`./run-tests.sh`: Python PASS; Node 346 tests, 346 pass; `RESULT: PASS`.

### Manual check in a real browser (coordinator)

Use the Chrome test window. Do each step in light and in dark mode, at 1280, 1024 and 400 px.

1. Open the reader with a book that has about 30 contents entries (a sample PDF with bookmarks, or a library book). Set the window height to 768 px. Check: 10 entries or more show without a scroll; a long entry wraps and is not cut; nested entries start at the same left edge as their chapter.
2. Press play: the entry of the part that is read has a grey row with an orange bar on its left.
3. Check the side bar tabs: "Contents", "Highlights (0)", "Ask", none cut at the right edge.
4. Open the settings panel: change each skip setting; the book is read in again; reload the page; each setting is the same. Press "Re-read document". In the desktop app, press "Export audio (MP3)" and cancel the question.
5. The top bar: no filled button; at most 5 controls; the book title is bold.
6. Open a file that is not a PDF on the start screen: the message shows under the start text.
7. Press the contents button in the player bar and the × of the side bar: the side bar shows and hides as before.
8. Take the screenshots at 1280, 1024 and 400 px in both modes, one with the settings panel open.

### What is left

- Screenshots (coordinator).
- The "Ligature repair OFF" message (a missing word list file) now shows only at the foot of the settings panel, not in a strip; it is a developer message.

### Review repairs (10 Nov 2026)

Two faults came from the review and the coordinator's browser check. The tests came first.

1. Words outside the glossary (review item 5). The changes:
   - "No document open" became "No book open".
   - "Re-read document" became "Re-read book".
   - The default name of a PDF without a name became "book.pdf" (it was "document.pdf").
   - A new test reads the visible text and the labels of `index.html` and the string literals of `app.js`. It fails on "helper", "document" or "Kokoro". Test: "the reader uses the words of the glossary: no "helper", "document" or "Kokoro" for the owner".
2. At 800 px the open side bar covered the left 40 % of the page, and the title and the zoom buttons were gone (browser check item 6). The changes:
   - Up to 900 px the side bar and a readable page do not both fit: 320 px plus 480 px or more. In that range the side bar lies over the page, and it starts closed on load and when the window gets narrow.
   - The contents button opens it. The ×, Escape or a press outside it closes it. If the settings panel is open, Escape closes the panel first, not both.
   - Above 900 px the side bar stays beside the page as before.
   - The book title stays in the top bar at every width and ends with "…" when it is long.
   - The zoom buttons stay at every width.
   - Below 600 px "Open PDF" and "Library" show their 20 px icon only (a folder and a back arrow). Their words stay for a screen reader and in a label after 500 ms.
   - Tests: "up to 900 px the side bar is an overlay that starts closed; the title and the zoom stay in the top bar", "on a narrow window the open side bar closes with Escape, its × or a press outside it", and "on a small window the top bar buttons show their icon only, and their names stay for a screen reader".

Manual check (coordinator), in light and dark mode:
- At 800 px reload a book: the side bar is closed, the title shows, and the zoom buttons show.
- Press the contents button: the side bar lies over the page with a shadow. Press Escape: it closes. Open it again and press on the page: it closes.
- At 400 px: the top bar shows the mark, the title with "…", −, 100 %, +, and the folder icon. Hover the folder: the label "Open PDF" shows.
- At 1280 px: the side bar is beside the page and stays open after a press on the page.

`./run-tests.sh`: Node 357 tests, 357 pass; `RESULT: PASS`.
