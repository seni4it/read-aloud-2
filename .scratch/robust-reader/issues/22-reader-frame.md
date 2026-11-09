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
