# 21. Reader player bar: one row, one main action, one settings panel

GitHub issue: #22
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Use the `key-design` skill (read `book/QUICK_RULES.md`, sub-chapters 1.1, 5.2, 6.1, 6.3, 6.4, 7.4, 10.1, 10.5). It is a private reference: apply the rules, copy none of its content. Follow the Design Direction section of the spec.

Rebuild the player bar of the reader. It holds, on one row: previous sentence, play or pause (the only filled orange control), next sentence, the position slider with sentence count and time left, the speed, the highlight button, the follow button and one settings button. The engine choice, the voice choice and the voice preview move to a settings panel that opens from the settings button. The status text uses the glossary words (for example 'Natural voice ready'), not model names. While the voice server makes the first sentence, the play button shows a spinner. Each control has default, hover, active, disabled and focus states. Each icon button shows a tooltip with its name and its key after 500 ms. Icons are 20 px with 8 px to their text.

## Acceptance criteria

- [ ] At 1280, 1024, 768 and 360 px the player bar is one row and no control is cut or hidden without a way to reach it.
- [ ] The only filled orange control in the reader is the play button.
- [ ] Engine, voice and preview work from the settings panel, and the choice stays after a reload.
- [ ] Press play after a server restart: the play button shows a spinner until sound starts.
- [ ] Each icon button shows a tooltip with its key. Tab reaches each control and the panel closes with Escape and returns the focus.
- [ ] With reduced motion set in the system, no transition runs.
- [ ] Screenshots in light and dark mode at 1280, 1024 and 400 px are in the ticket report, with the list of rules that were applied.

## Blocked by

- 20 (tokens)
- 08 (reader look)
- 03, 05 (they own the player logic in app.js and tts.js)
