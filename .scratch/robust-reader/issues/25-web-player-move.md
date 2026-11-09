# 25. Web-page player: the owner can move it

GitHub issue: #26
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

The owner's words: "see that I can drag the small menu bar on Chrome to the left, right, top and bottom, and I can move it because sometimes it's in the way right now."

The player bar on web pages can be dragged with the pointer. When the owner lets go, it snaps to the nearest of four places: left edge, right edge, top or bottom. At the left and right edges the bar is vertical. The place is kept for all sites and after a restart of Chrome. The bar never leaves the screen, also after a window resize. A drag does not press a button, and a click on a button does not start a drag. The keyboard can move it too: one command in the settings of the player, "Move player", with the four places. Use the tokens and the layout of ticket 24. Reuse rule: check for a small maintained drag library first; if the platform pointer events are sufficient, use them and say so in the commit message.

## Acceptance criteria

- [ ] A drag moves the bar, and it snaps to left, right, top or bottom.
- [ ] After a page reload and on another site, the bar is at the same place.
- [ ] At 400 px window width and after a resize, the full bar is on the screen.
- [ ] A click on play still plays, and a drag that starts on a button does not press it.
- [ ] The place can be changed with the keyboard only.
- [ ] A Node test covers the snap decision (pointer position to place) and the saved place.
- [ ] Checked in the Chrome test window on two sites, one of them with a fixed header.

## Blocked by

- 14 (web follow and player)
- 24 (web-page player design)
