# 31. The drag of the Player bar fails; the Listen button can move

Status: done in code and Node tests; checked with real mouse input in the test browser.
Type: AFK

## The owner's report

After a reload of the add-on he could not drag the player on Chrome. Earlier he asked that he can drag the small bar to the left, right, top and bottom, because sometimes it is in the way.

## Cause found

The bar took the pointer capture only after the pointer had moved 6 px. Chrome gives no implicit capture to a mouse, so until then the bar saw only the move events that were over the bar itself. The bar is 58 px high. A normal hand move gives its first move event 20 to 40 px away from the press, which is already outside the bar (or over an iframe). The bar then never saw a move, so the drag did not start and the bar stayed where it was.

Checked with real mouse input (DevTools protocol `Input.dispatchMouseEvent`: press, moves with the left button down, release) on a local test page. Before the repair, 11 of 12 drags did not move the bar: a press on the empty area, on the progress part, on play and on the settings button, slow and fast, on a page with `user-select: none`, with an iframe under the path, with a page `pointerdown` handler that calls `preventDefault`, and on a page scrolled down. The only drag that worked was one to the right edge whose first moves stayed on the bar. `touch-action: none` and `user-select: none` were already on the bar, and no image drag starts there, so these were not the cause. The Listen button had no drag code at all.

## What changed (extension/content.js)

- One drag helper, `draggable(el, h)`, for the Player bar and the Listen button. The pressed element takes the pointer capture at the press. It is the button under the pointer, or the box itself, so a short press still clicks that button. Every later move comes to the player, also outside it and over an iframe. A move of less than 6 px is still a click. The click after a drag presses nothing.
- The Player bar keeps its snap to the four edges and its saved place (`ra2Place`).
- The Listen button can be dragged. When it is let go, it goes to the nearest side edge (left or right) at the height where it was let go. The place is kept in `chrome.storage.local` as `ra2Launch` (the side, and the height as a part of the window height). It comes back on each page and after a reload, and a change in another tab moves it there too. A CSS `clamp()` keeps it inside the window at any size, so it needs no resize listener. The place is read once, when the button first shows. The keyboard use is unchanged.
- The Player bar has a grip at its start: six dots, the tooltip "Move", and the grab cursor. The whole bar still drags. At the left and right edges the grip turns with the bar.
- Only the design tokens of the file are used; there is no new colour value.

## Tests

`tests/node/web-player-move.test.mjs` has 7 new tests: the capture at the press, the capture on the pressed button, the drag of the Listen button to the left edge with its kept height, a short press that starts the reading, the saved place on a new page and from another tab, a cancelled drag, and a text check of the grip and of the one drag helper. One old test changed: at page load the add-on now reads one value, the place of the Listen button.

## Checked with real mouse input

In the test browser, with the new content.js put into the tab: all 12 drags above now move the bar and snap it to the edge where the pointer was let go. A drag by the grip works. The Listen button moved from the right edge to the left edge at the height where it was let go, kept that place after a reload of another page, and a fast drag of two moves took it back to the right edge. A short press on the Listen button started the reading, and a short click on play paused it.

The shared test browser is a headless shell without add-ons, so the check put content.js into the tab through the DevTools protocol, with a small stand-in for `chrome.runtime` and `chrome.storage`. The pointer events were real browser input. A check in Chrome with the add-on loaded remains for the owner: reload the add-on, then drag the bar and the Listen button.
