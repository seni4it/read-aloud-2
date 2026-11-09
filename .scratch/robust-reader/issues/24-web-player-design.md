# 24. Web-page player and add-on window: the same player, the same look

GitHub issue: #25
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Use the `key-design` skill (read `book/QUICK_RULES.md`, sub-chapters 1.1, 4.1, 6.1, 6.2, 6.4, 8.1, 8.4). It is a private reference: apply the rules, copy none of its content. Follow the Design Direction section of the spec.

The player on web pages uses the same tokens, the same order of controls and the same states as the reader player bar of ticket 21. The add-on window has one main action ('Listen to this page'), then voice and speed, then the switches in one group with one label style, then the links as quiet text. The paste page uses the same tokens and one main action. The page styles of a web site must not change the player: keep it inside its own style scope.

## Acceptance criteria

- [ ] Side-by-side screenshots of the reader player and the web-page player show the same order, sizes and colours.
- [ ] On a page with a dark theme and on a page with a light theme the player has the same look.
- [ ] The add-on window has one filled button and each switch is 32 px high or more with its label on the left.
- [ ] A Node test finds no colour value in content.js, popup.html or paste.html outside the token names.
- [ ] Screenshots in light and dark mode at 1280, 1024 and 400 px are in the ticket report, with the list of rules that were applied.

## Blocked by

- 20 (tokens)
- 21 (player bar)
- 15, 18 (they own content.js and the small pages)
