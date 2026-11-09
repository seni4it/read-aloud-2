# 08. Reader look: focus marks, contrast, control size, dark mode, narrow window

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Use the `key-design` skill. Add a focus mark to every control. Bring each text to a contrast of 4.5 to 1 or more. Make each control at least 32 px high. Make the word highlight and the saved highlights visible in dark mode. Keep the page readable when the Ask pane is open in a window of 821 to 1100 px. Reduce the font sizes to 3 and the corner radii to 2.

Evidence: audit/reader-ui.md findings 8, 14, 19, 20, 24. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] Tab through the side bar, the Highlights list, the selection bar and the Ask bar: each control shows a focus mark.
- [ ] Measured contrast of the active contents entry, the check heading and the page number is 4.5 to 1 or more.
- [ ] No control is less than 32 px high.
- [ ] Screenshots in light and dark mode show the word highlight and a saved highlight clearly.
- [ ] At 900 px with the Ask pane open, the page text is readable.

## Blocked by

None - can start immediately
