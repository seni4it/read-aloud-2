# 23. Library: continue listening first, clean cards, one main action

GitHub issue: #24
Status: code done, tests pass; browser check and screenshots open (see Work report)
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Use the `key-design` skill (read `book/QUICK_RULES.md`, sub-chapters 1.1, 5.5, 6.1, 6.2, 7.1, 7.3, 7.8, 10.5). It is a private reference: apply the rules, copy none of its content. Follow the Design Direction section of the spec.

The library page opens on a 'Continue listening' block for the book that was read last: cover, title, part of the book that is done, time left, and one button 'Continue listening'. Below it is the grid. A card shows a clean title (no underscores, no source tag, no file ending), a progress line and one status text such as '12% done, 40 min left' or 'New'. The whole card opens the book. The top bar holds search, sort and '+ Add PDF' as the one main action. 'Restart the voice server' and 'YouTube' move to one 'More' menu. The empty library shows one message and the 'Add PDF' action. While the list loads, the page shows card placeholders.

## Acceptance criteria

- [ ] With one book or more that was started, the first block is 'Continue listening' and its button opens the book at the reading position.
- [ ] A file name with underscores and a source tag shows as a clean title on the card. The full file name is in the tooltip.
- [ ] The top bar has search, sort, the 'More' menu and one filled button.
- [ ] Restart and YouTube work from the 'More' menu.
- [ ] An empty library, a loading library and a stopped voice server each show their own message.
- [ ] Screenshots in light and dark mode at 1280, 1024 and 400 px are in the ticket report, with the list of rules that were applied.

## Blocked by

- 20 (tokens)
- 17 (library page repairs)

## Work report

Date: 10 Nov 2026. Status: code done, all tests pass. No browser was used in this run, so the screenshots are not made yet (see "Manual check").

### What a person sees now

- **Top bar:** the brand, then search and order, then a quiet "More" button, then one filled button "+ Add PDF". Below 1000 px the bar has two rows: the brand, More and Add PDF on row 1, and search and order on row 2 at full width. Below 400 px only the brand icon shows. (The first version of this report said that the row fit at 400 px. That was wrong; see "Review repairs".)
- **More menu:** two items, "Restart the voice server" and "Show YouTube uploads". The menu opens with a click, Enter, Space or Arrow down. Arrow up and Arrow down move between the items. Escape closes it and puts the focus back on More. A click outside it closes it, and so does a move of the focus out of it (Tab). The restart messages now go to the status line under the bar ("Restarting the voice server…", "The voice server is running again.", or a message with the next step). The word "helper" is gone from the page.
- **Continue listening:** when a Book was started, the page opens on one large block: the cover, the small line "Where you stopped", the clean title in large type, the progress line, the status text (for example "12% done, 40 min left") and one large button "Continue listening". The button opens the reader for that Book; the reader goes back to its own reading position. A finished Book is not chosen. When a search is typed, the block goes away and all matching Books show.
- **The shelf:** the heading "Other books" (or "Your books" when no Book was started), then the cards. A card shows the cover, the clean title (no underscores, no source tag such as "(z-lib.org)", no ".pdf"), a progress line and one status text: "New", "12% done, 40 min left" or "Finished". The full file name is the tooltip of the card. The whole card is one link. The remove button (×) shows on hover, on keyboard focus, and always on a touch screen. When an audio export runs or is done, one more small line says so.
- **Order:** "Recently read" (the default) uses the later of the voice server's "opened" time and the reader's own save time. "Title A to Z" sorts by the clean title.
- **States, each with its own message:** while the list loads, six grey card placeholders. An empty library: "Your library is empty", one sentence, and the button "+ Add PDF". A stopped voice server: "The voice server is not running", one sentence, and the button "Try again". A search with no result: "No book matches “…”."
- **Remove:** the question uses the clean title. When the voice server is stopped: "Could not remove “…”. The voice server is not running. Open the Read Aloud app again." When the voice server refuses: "Could not remove “…”."
- **Cover placeholder:** the "PDF" letters now use the muted text colour. Contrast: light 6.48 to 1, dark 6.55 to 1 (was 4.05 to 1 in light).
- **YouTube panel:** opens from More, at the top of the page, with a "Close" button. Its function did not change.

### Design rules applied (in my own words)

1. One main focus on each screen: the Continue listening block is the largest and the only raised block; the rest is quieter.
2. Few choices in view: the top bar went from five controls to four, and the two maintenance actions are inside one menu.
3. One filled button in the bar; the other buttons are outlined. Each button label is a verb with a noun ("Add PDF", "Continue listening", "Restart the voice server", "Try again").
4. The whole card is the link; no extra open button on a card. Card text is short: a title and one status line.
5. Hierarchy from size, weight and colour together: the title is large and bold, the status is small and muted.
6. List order is one logical rule: the Book read last comes first.
7. Each empty state and each wait has its own short message and one action; a wait shows placeholders in the shape of the result.
8. Spacing in steps of 4 and 8 px; card padding 16 px; the outer corner of the menu equals the inner corner plus its padding (8 + 4 = 12 px).
9. Cards in a grid that wraps, with a minimum card width (192 px, 140 px on a narrow window).
10. Every control has a hover, a pressed, a disabled and a focus look; hover feedback in 100 ms; no motion with reduced motion (the tokens do this).
11. Controls are at least 32 px; the main buttons and menu items are 48 px, for slow and sure aim.
12. Text contrast 4.5 to 1 or more, light and dark; orange only on the progress line.

### Files changed

- `app/library-model.js` (new): the rules with no page: clean title, status text, Continue choice, order, search match.
- `app/library.js`: the page, the More menu, the states and the remove message; cards are made with elements, not HTML text.
- `app/index.html`: new top bar, More menu, Continue block, state blocks, shelf heading; loads `library-model.js` first.
- `app/library.css`: the new layout. Only tokens from `extension/pdf/tokens.css`; no new token was needed.
- `tests/node/library-page.test.mjs`: a fuller fake page (elements, classes, attributes, focus), and new tests.

### Tests (tests/node/library-page.test.mjs, 33 tests after the review repairs)

New: "a file name with underscores, a source tag and a file ending shows as a clean title"; "the card status text: New, the part done with the time left, Finished"; "Continue listening is the Book read last that is not finished; none when no Book was started"; "the order of Books: read last first, added last first, title A to Z"; "with a started Book the page opens on Continue listening, and its button opens that Book"; "with no started Book there is no Continue listening block"; "a search shows every matching Book and hides Continue listening"; "a card shows the clean title, the full file name as its tooltip, one status text and opens the Book"; "an empty library shows one message with the Add PDF action"; "while the list loads the page shows card placeholders"; "a stopped voice server shows its own message and a Try again button"; "a remove when the voice server is stopped gives a message"; "a remove that the voice server refuses gives a message"; "keyboard reach: each card opens with a link and has its own remove button; the bar controls are buttons"; "the More menu opens with the keyboard, Escape closes it and gives the focus back"; "YouTube opens from the More menu"; "Restart works from the More menu and says "voice server", not "helper""; "the page text uses no word that the glossary forbids"; "the top bar has search, sort, the More menu and one filled button".
Changed: the cover placeholder test now asks 4.5 to 1 (was 4 to 1); the audio export and restart tests follow the new structure. The other ticket 17 tests are kept.
`./run-tests.sh` after the review repairs: Python 12 tests OK, Node 333 tests pass, `RESULT: PASS`.

### Manual check (real browser; not done in this run)

Open `http://127.0.0.1:8793/app/` in Chrome. Use the window widths 1280, 1024 and 400 px (DevTools device toolbar), first in light mode, then in dark mode (DevTools > Rendering > prefers-color-scheme). Take one screenshot of each and add them here.

1. With a Book that you read before: the first block is "Continue listening". Press its button. The reader opens at the sentence where you stopped.
2. Look at a card of a Book whose file name has underscores or a source tag. The title is clean. Hold the pointer on the card: the tooltip shows the full file name.
3. Press Tab from the top of the page. The focus goes to search, order, More, Add PDF, the Continue button, then each card and its × button. Each one shows a blue ring.
4. Press More, then Arrow down, Arrow down, Escape. The focus comes back to More.
5. Choose "Show YouTube uploads": the panel opens at the top. Press Close.
6. Choose "Restart the voice server" only at a time agreed with the owner: the status line shows the restart messages.
7. At 400 px: no row of the top bar goes out of the window; the Continue button is full width.
8. Empty and stopped states: use a test copy of the voice server on another port with an empty library, then stop it, and press Try again after it starts.

### What is left

- Screenshots in light and dark at 1280, 1024 and 400 px (needs a browser).
- Data that the voice server does not give: the time when the reading position was saved and the minutes left are only in the browser storage of the reader (`ra2.lib.<id>`). So "Continue listening" and "min left" are known only in the browser where the owner reads; the desktop app window and Chrome share them only when they use the same browser storage. A field such as `position: {i, total, minLeft, saved}` in `/library.json` would fix this (a voice server change, out of this ticket).
- The source tag cleaner knows common download sites and web addresses; an unknown tag stays in the title (the full name is in the tooltip).

### Review repairs (10 Nov 2026)

Tests first. The new tests were red before the repairs.

1. **Escape on the More button.** Before, only the menu listened for Escape. Now Escape on the More button also closes the menu, and the focus stays on More. Test: "Escape on the More button closes the menu and keeps the focus on More".
2. **Tab from More.** The menu now closes when the focus leaves `.more` (`#moreWrap`, the `focusout` event). A move inside the menu keeps it open. I removed the old Tab handler of the menu, because it closed the menu even on a move to the next item. Test: "the More menu closes when the focus leaves it (Tab from More)".
3. **Loads that overlap.** Each load gets a number. An answer of an older load is dropped: the Book list, the stopped-server state and the audio export lines. Test: "two loads that answer in the wrong order: the older answer is dropped".
4. **Trash question.** It now says "Remove “…” from the library? The book goes to the Trash." The page uses lower case "book" everywhere ("Your books", "Other books", "No book matches"), so the question does too. Test: "the remove question says the book goes to the Trash".
5. **Focus after Restart.** The focus now goes back to More, not to the page body. The "Restart works from the More menu" test checks it.
6. **Narrow top bar.** The old claim was wrong. At 400 px the row had 368 px of room (400 − 2 × 16 padding). It needed about 379 px: brand about 157, More 88, Add PDF about 110, two gaps 24. So Add PDF went to a row by itself. The same fault was in the one-row bar from 641 px to about 956 px. One row needs about 621 px + 30 % of the window, and that must fit in the window − 48 px. Repair: below 1000 px the bar is a grid with the columns "brand (can shrink) | More | Add PDF", and search with order on a full row 2. A button cannot go alone to a new row. The brand name gets "…" if there is no room. Below 400 px only the brand icon shows, and its name stays for a screen reader. At 320 px: 288 px of room, and icon 24 + More about 76 + Add PDF about 110 + gaps 24 = about 234 px. At 1024 px the bar is one row: about 928 px of 976 px. The media queries use the form `(width < 1000px)` and `(width < 400px)`, because the token test asks for sizes in steps of 4 px. These text widths are estimates of the system font. Check them in a real browser at 320, 400, 480, 900 and 1024 px.
7. **Glossary words.** The test now reads all the text that the owner sees: the page text, title, aria-label, placeholder and the messages in library.js. It refuses "helper", "file" and "document". Two exceptions: the Google "key file" of the YouTube panel (a real file, not a Book), and the Finder folder name "Documents › Read Aloud Library". Changed text: "Only PDFs can be added." and "Add a PDF, or drag PDFs onto this window." Test: "the page text uses no word that the glossary forbids".
8. **Contrast of muted text.** A new test reads library.css and checks six pairs in light and dark mode, each at 4.5 to 1 or more: the card status and the audio line on a card, the Continue status, the line "Where you stopped" on the Continue block, the empty or stopped message on the page, and the status line on the page. All pairs passed with no token change, because the muted text token was already high enough. Test: "muted text has a contrast of 4.5 to 1 or more on its surface, light and dark".
9. **Fixed px values.** Changed to tokens: the brand icon (24 px, `--space-6`), the progress bar (8 px, `--space-2`), the placeholder line (12 px, `--space-3`), the checkbox (20 px, `--space-5`), the card hover ring (`--focus-width`, as wide as the focus ring), the title height (2 × `--leading-20`), and the state margin (12vh became `--space-12`). These layout sizes have no token, so they stay, each with a one-line comment that gives the reason: the search width, the button minimum width 88 px, the menu 264 px, the page 1280 px, the Continue cover 160 px and 96 px, the Continue block 760 px, the Continue bar 360 px, the card minimum width 192 px and 140 px, the state 520 px, the panel 760 px and the queue 220 px.

Checks: `node --check` passes on `app/library.js` and on `app/library-model.js`. `node --test --test-timeout=120000 tests/node/library-page.test.mjs` gives 33 pass and 0 fail. `./run-tests.sh` gives `RESULT: PASS`.
