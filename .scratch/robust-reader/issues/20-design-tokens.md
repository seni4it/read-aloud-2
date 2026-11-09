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

- [ ] A Node test finds no colour value in a style file or a style block outside the token file.
- [ ] A Node test computes the contrast of each text and background token pair in both modes: each is 4.5 to 1 or more.
- [ ] If the token file has two copies, a test fails when they differ.
- [ ] Orange is used only by the play button, the word highlight and progress marks. Dark mode has no light surface, and its background is darker than its cards.
- [ ] Font sizes in use are only 12, 14, 16, 20 and 28 px.
- [ ] Screenshots in light and dark mode at 1280, 1024 and 400 px are in the ticket report, with the list of rules that were applied.

## Blocked by

- 02 (test bench)
