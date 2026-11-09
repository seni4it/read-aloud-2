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

- [x] A drag moves the bar, and it snaps to left, right, top or bottom.
- [x] After a page reload and on another site, the bar is at the same place.
- [x] At 400 px window width and after a resize, the full bar is on the screen.
- [x] A click on play still plays, and a drag that starts on a button does not press it.
- [x] The place can be changed with the keyboard only.
- [x] A Node test covers the snap decision (pointer position to place) and the saved place.
- [ ] Checked in the Chrome test window on two sites, one of them with a fixed header.

## Blocked by

- 14 (web follow and player)
- 24 (web-page player design)

## Work report

Date: 10 Nov 2026. Status: done in code and Node tests. The check in the Chrome test window on two sites needs a browser; this run had none. It is a manual step below.

### Reuse check

The solved problem is "drag a box and snap it to an edge". Small drag libraries exist, but the platform pointer events with `setPointerCapture` do all that this needs in about 50 lines, with no file to vendor into a content script that runs on every page. So no library is used. Say this in the commit message: "Drag with platform pointer events (setPointerCapture); no library needed."

### What a person sees now

- The pointer over the bar (not over a button) is a hand. Press anywhere on the bar, also on a button, and move more than 6 px: the bar follows the pointer and never leaves the window. Let go: the bar slides in 200 ms to the nearest edge: bottom, top, left or right. At the left and right edges the bar is vertical (the position shows the count only).
- A press and release with a move of less than 6 px is a normal click: play still plays. A drag that starts on a button does not press it.
- The place is kept in chrome.storage.local: one place for all sites, after a reload and after a restart of Chrome. A move in one tab moves the bar in the other open tabs too.
- Keyboard: Tab to "Voice and settings", Enter. The panel has "Move player" with four buttons: Left, Right, Top, Bottom. The pressed one shows the place now. Escape closes the panel.
- A window lower than 440 px has no room for the vertical bar: the bar shows at the bottom, and goes back to the side when the window is high again. The saved place does not change. A horizontal bar is never wider than the window; a vertical one never higher.
- With "Reduce motion" set in the system, the bar goes to its edge with no slide.
- The speed list, the settings panel, the tooltips and the messages open on the side that faces the page at each place.

### How it works

- `snapPlace(x, y, w, h)` is a pure function: the edge of the window nearest to the point where the pointer lets go. A tie goes to bottom, then top, left, right. `fitPlace(place, w, h)` gives the place where the bar shows in a window of that size (the bottom for an unknown value or a side place in a low window). The Node tests reach both through a test-only object (`globalThis.ra2Test`), which no page sets.
- pointerdown on the bar notes the point (left button only; a press in the speed list or the settings panel is not a drag). pointermove starts the drag after 6 px, captures the pointer and moves the bar with left/top. pointerup snaps and saves; pointercancel goes back to the old place and saves nothing. The click after a drag is ignored.
- The saved place is read when the player is made, at page load: one storage read, no listener, no timer. The window resize listener is added only when the bar shows for the first time, so a page where the owner does not listen still has no extra listener (the idle-cost tests of ticket 15 pass).

### Files changed

- extension/content.js (the drag, the places, the "Move player" choice, the vertical layout).
- tests/node/web-player-move.test.mjs (new, 25 tests after the review repairs).
- extension/manifest.json did not change: the "storage" permission covers chrome.storage.local.

### Tests (tests/node/web-player-move.test.mjs)

- snap: the place is the edge of the window nearest to the point where the pointer lets go
- fit: a side place needs a window high enough for the vertical bar; else the bar shows at the bottom
- a drag moves the bar with the pointer and snaps it to the nearest edge; the place is saved for all sites
- each of the four places can be reached by a drag
- a click on play still plays: a move of less than 6 px is not a drag
- a drag that starts on a button does not press it
- a cancelled drag goes back to the old place and saves nothing
- a right button press or a drag in the settings panel does not move the bar
- after a reload and on another site, the bar is at the saved place
- a place saved in another tab moves the bar here too; a bad saved value gives the bottom
- the load saves nothing, and the resize listener comes only when the bar shows
- after a resize the bar is on the screen: a side place in a low window shows at the bottom, and goes back
- the style keeps the full bar inside the window at each place and at 400 px
- the keyboard can move the bar: Settings, then Move player, with the four places
- the snap glides in 200 ms, and not at all when the system asks for reduced motion

### Open points

- The drag starts only while the pointer is still over the bar when it passes 6 px (the capture starts then). A very fast flick that leaves the bar first does not drag; a normal drag does.
- The web bar has no position slider (its position is a progress line that shows only). A drag that starts on any slider or field in the bar is left to that control.
- A drag that starts on the speed list or settings panel does not move the bar, so that the panel can scroll.

### Check in the Chrome test window (step by step)

1. Reload the add-on in chrome://extensions. Open two sites: one simple article, and one with a fixed header (a news site).
2. On the first site press the round Listen button. The bar is at the bottom.
3. Drag the bar by its edge to the left side of the window and let go. It slides to the left edge and is vertical.
4. Drag it to the right, then to the top, then back to the bottom. Each time it snaps to that edge.
5. Press play (a short click): it pauses or plays. Press on Next, move the pointer 2 cm and let go: the bar moves and the next sentence does not start.
6. Put the bar at the top. Reload the page and press Listen: the bar is at the top. Open the second site and press Listen: the bar is at the top, over or under its fixed header. Move it to the left there.
7. Go back to the first tab: its bar is at the left too.
8. Make the window 400 px wide and then 300 px high: the full bar is on the screen (at a low window it shows at the bottom). Make the window large again: the bar goes back to the left.
9. Keyboard only: Tab to "Voice and settings", Enter, Tab to "Move player", choose Bottom with Enter. The bar goes to the bottom. Escape closes the panel.
10. Set "Reduce motion" in macOS (Accessibility, Display). Drag the bar: it jumps to its edge with no slide.

### Review repairs (10 Nov 2026)

The review found these faults. Each has a test first, in tests/node/web-player-move.test.mjs.

1. A press that was let go outside the bar before 6 px left a pending press. A later hover of 6 px then started a drag with no button down. Now pointermove ends the press when the left button is not down, and pointerup or pointercancel end a pending press too. Test: "a press let go outside the bar, then a hover with no button down: no drag".
2. There was no lostpointercapture handler. When the bar hid during a drag (the reading stopped), the class "dragging", the left and top values and the press stayed. Now lostpointercapture, pointercancel and a hide of the bar end the drag cleanly: the bar stays at its old place, nothing is saved, and changes from other tabs and resizes work again. Tests: "a lost pointer capture ends the drag cleanly, at the old place, and saves nothing" and "the bar hides during a drag (the reading stops): the drag ends cleanly".
3. The place was read from chrome.storage.local at each page load. Now it is read when the bar shows (each time it goes from hidden to shown), never at load. Test: "the load reads and saves nothing; the place is read and the resize listener added when the bar shows". This test is in the move test file, because web-idle-cost.test.mjs was not in the files of this run and its fake page has no chrome.storage.local.
4. The resize listener stayed after close. Now it is added when the bar shows and removed when it hides. The chrome.storage.onChanged listener stays, because it also carries the voice and speed settings, but a place change from another tab is used only while the bar shows; a hidden bar reads the place at its next show. Tests: "after close the resize listener is gone and a resize does no work; it comes back on the next show" and "a place saved in another tab while the bar is hidden is used at the next show".
5. With reduced motion, the waiting ring on play had an animation of 0 ms that still ran. Now a reduced-motion rule sets "animation: none" on it. Test (text check): "text check: with reduced motion the waiting ring on play does not turn".
6. Size checks: a new test checks the real result of the drag clamp in a 400 px window ("in a 400 px window the dragged bar stays fully on the screen"). The check that reads the style is now named "text check: the style limits the bar to the window size at each place".
7. An old tab after a reload of the add-on: each chrome.storage call now checks chrome.runtime.id first and is inside try/catch, so nothing throws into the page. Test: "an old tab after a reload of the add-on: show, drag and Move player throw no error into the page".
8. A drag that starts on a slider or a field (input, select, textarea) in the bar does not move the bar. Test: "a drag that starts on a slider or a field in the bar does not move the bar".
9. One write to storage for each drop, none during the move. Test: "one write to storage for each drop, none during the move".
