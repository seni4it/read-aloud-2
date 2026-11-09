# 08. Reader look: focus marks, contrast, control size, dark mode, narrow window

GitHub issue: #9
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Use the `key-design` skill. Add a focus mark to every control. Bring each text to a contrast of 4.5 to 1 or more. Make each control at least 32 px high. Make the word highlight and the saved highlights visible in dark mode. Keep the page readable when the Ask pane is open in a window of 821 to 1100 px. Use only the token names of ticket 20 for colour, size and radius. This ticket is the accessibility floor of the reader. The larger layout work is in tickets 21 and 22.

Evidence: audit/reader-ui.md findings 8, 14, 19, 20, 24. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] Tab through the side bar, the Highlights list, the selection bar and the Ask bar: each control shows a focus mark.
- [ ] Measured contrast of the active contents entry, the check heading and the page number is 4.5 to 1 or more.
- [ ] No control is less than 32 px high.
- [ ] Screenshots in light and dark mode show the word highlight and a saved highlight clearly.
- [ ] At 900 px with the Ask pane open, the page text is readable.

## Blocked by

- 20 (tokens)

## Work report

Date: 10 Nov 2026. Status: done in code and tests. The screenshots and the measured check in a real browser are for the coordinator (no browser in this run).

### What a person sees now

- Press Tab anywhere in the reader: each control shows the blue focus ring. This now includes the side bar tabs, the group filters and the text buttons of the Highlights list, the selection bar, the delete button of a highlight, and the answer player of the Ask bar. Before, these controls had no ring.
- No control is less than 32 px high. The side bar tabs, the group filters, the selection bar buttons, the text buttons ("Rename groups", "Restart helper", the Ask links), the selects of the Ask bar and the Ask pane, the check box rows and each button are now 32 px or more. The delete button of a highlight is 32 by 32 px (it was 24 px). A highlight card is 40 px or more.
- Dark mode: the orange word box and the saved highlights are clear on the page. The PDF paper stays white in dark mode, and the old light blend made an orange box on white look white. Now both darken the paper (multiply) in both modes.
- A window of 821 to 1100 px with the Ask pane open: the side bar steps aside while the pane is open, and the pane takes at most 40 % of the window. At 900 px the page column is about 540 px wide. The pages are drawn again at the new width when the pane opens or closes, so the text is not cut and not too small. While the pane is open at this width, the side bar stays hidden; the × of the pane closes it and the side bar comes back.
- Contrast: the active contents entry (dark text on a grey row), the check heading of an answer and the page number on a page that is not drawn yet were already 4.5 to 1 or more after ticket 20. They are now tested in light and dark mode.

### Rules applied (my own words)

- Each control has a visible focus state, not only a hover state.
- Text has a contrast of 4.5 to 1 or more on its background, in light and in dark mode.
- A control is at least 32 px high; list rows are 40 px.
- In dark mode, a coloured mark on a light content area keeps its colour (no blend that washes it out); muted colours stay readable.
- A side panel must not press the main content to an unreadable width: on a medium window one panel gives way to the other.

### Visible changes, one by one

1. Focus ring on every control of the reader (one rule at the end of `ra2-theme.css`, stronger than each `all: unset` rule).
2. Side bar tabs, group filters, selection bar buttons, text buttons: 32 px high.
3. Delete button of a highlight: 32 by 32 px; the card keeps 40 px on its right for it.
4. Selects in the Ask bar, the Ask pane and the key points box: 32 px high. Check box rows ("Hostile check", the skip settings, "Show highlights on the page"): 32 px high.
5. Buttons with the `.btn` style: 32 px high or more, text centred.
6. Word box and saved highlights: multiply blend in both modes.
7. 821 to 1100 px: the open Ask pane hides the side bar and is at most 40 % of the window wide.
8. The pages are drawn again when the page column changes width without a window resize (`app.js`, a `ResizeObserver` on the page column; the window resize handler is unchanged).

### Files changed

- `extension/pdf/styles.css`, `extension/pdf/ra2-theme.css`.
- `extension/pdf/app.js`: only the width watch of the page column (item 8). The reading, open, voice and highlight logic did not change.
- New: `tests/node/reader-look.test.mjs`, and the shared helper `tests/node/reader-css.mjs` (a small CSS reader, the tokens in light and dark mode, a contrast function, and app.js on a fake page).

### Tests

`tests/node/reader-look.test.mjs`, 8 tests:
- a focus ring rule covers every control of the reader and wins over each rule that resets a control;
- every control in the reader page is a native control that the focus rule covers;
- the active contents entry, the check heading and the page number have a contrast of 4.5 to 1 or more (light and dark);
- no control of the reader is less than 32 px high;
- no rule makes a button, a field or a text button smaller than 32 px;
- in dark mode the word highlight and the saved highlights stay visible on the white PDF paper;
- from 821 to 1100 px the open Ask pane hides the side bar and takes at most 40 % of the window;
- the page is drawn again at the new width when the Ask pane opens or closes.

`./run-tests.sh`: Python PASS; Node 311 tests, 311 pass; `RESULT: PASS`.

### Manual check in a real browser (coordinator)

Use the Chrome test window. Do each step in light mode and in dark mode (System Settings, Appearance), at 1280, 900 and 400 px window width.

1. Open the reader and a sample PDF from `tests/pdf-text/samples/`.
2. Press Tab through the top bar, the side bar (tabs, contents, Highlights list with its filters and text buttons), the player bar and the Ask bar. Check: each control shows a blue ring.
3. Select some text: the selection bar shows. Press Tab: each of its buttons shows the ring.
4. Press play. Check in dark mode: the orange word box and the light orange sentence shade are clearly visible on the white page. Make a highlight of each group: each fill and line is visible.
5. With the browser's measuring tool (DevTools, inspect, the contrast line of the colour picker), check the active contents entry, the check heading of an answer ("Check") and a page number of a page that is still blank: 4.5 or more.
6. In DevTools, inspect the side tabs, a group filter, a highlight's delete button and a select of the Ask bar: each is 32 px high or more.
7. At 900 px open the Ask tab. Check: the side bar steps aside, the pane is about 360 px wide, and the page text can be read. Close the pane with its ×: the side bar comes back, and the page takes the new width.
8. Take screenshots of steps 4 and 7 in both modes for the ticket.

### What is left

- The screenshots (coordinator).
- The player bar, the settings panel and the side bar layout are tickets 21 and 22.

### Review repairs (10 Nov 2026)

Two faults came from the review and the coordinator's browser check. The tests came first.

1. A column change after a window resize was skipped (review item 2). The width watch kept its own copy of the window width, and only the watch updated it. Now one redraw path serves every width change: a window resize, the Ask pane and the side bar. It waits 250 ms after the last change. It redraws only when the page column width really changed. A window resize and a column change at the same time give one redraw, not two. Test: "one redraw after a window resize and a column change together; a column change after a resize is not skipped".
2. At 400 px page 1 was small and page 2 full width (browser check item 7). Cause: `viewer.relayout()` measures the new scale before `rescale()` measures the old one. So `rescale()` stretched the picture on screen by a ratio of 1, and page 1 kept its old small picture until a new render replaced it. `app.js` now calls `viewer.rescale()`, which measures both scales itself, so every page gets the right size at once. The redraw keeps the place in the book (the same part of the scroll height). The viewer keeps the word highlight and the sentence mark and draws them again on the new pages. Test: "a width change draws all pages at one new scale and keeps the reading position". Note for the owner of `viewer.js`: `relayout()` still has the ratio fault; no other caller uses it now.

What a person sees now: after any width change (window, Ask pane, side bar), all pages have one size about a quarter second later, and the page stays at the same place.

Manual check (coordinator): at 1280 px open a book and scroll to page 3. Make the window 400 px wide, then 1280 px again. Open and close the Ask pane. Each time, all pages have the same width and page 3 stays in view. Press play first: the word highlight stays on the word.

`./run-tests.sh`: Node 357 tests, 357 pass; `RESULT: PASS`.
