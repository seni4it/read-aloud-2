# 02: A page with an old Player bar says "reload this page"

**What to build:** After a reload of the add-on, a page that was open before keeps an old Player bar that cannot work. Today it goes away without a word. Now a small message shows in its place: "Read Aloud 2 was updated. Reload this page to listen." with a button "Reload this page" and a close button.

**Blocked by:** None (can start immediately)

**Status:** done in code and node tests; not checked in Chrome

- [x] When the web player finds that its add-on connection is gone, it removes the Player bar and the Listen button and shows the message.
- [x] The message uses no add-on call. The button reloads the page. The close button removes the message.
- [x] The message shows one time only for a page, and leaves no timer or listener behind.
- [x] The message has the status role and the look of the Player bar.
- [x] A node test covers: connection gone gives the message; close removes it.
- [x] `./run-tests.sh` passes.

## Work report

**Files changed**
- `extension/content.js`: `gone()` now calls `oldTabNote()` after it removes the old player. `oldTabNote()` makes a new element `ra2-note` with its own closed shadow root, on `<html>`. It holds the style of the Player bar (the `<style>` block of the player, read one time after the player is built) and a `div` with the classes `bar note` and `role="status"`: the text "Read Aloud 2 was updated. Reload this page to listen.", a button "Reload this page" (`location.reload()`) and a close button (it removes the element). Two new CSS rules in the player style, `.note` and `.note .reload`, use the present tokens only.
- `tests/node/old-tab-message.test.mjs` (new): 6 tests. No message while the add-on is there. Connection gone: the old player leaves and the message shows, with the status role, the reload button and the close button. The message has the style of the Player bar and the class `bar`, and no colour of its own. The reload button reloads and makes no add-on call. The close button removes the message and makes no add-on call. The message shows one time only, a closed message does not come back, and no timer waits.

**Decisions**
- The message is in a new element (`ra2-note`), not in the shadow root of the old player. The tests of earlier tickets say that the old player element leaves the page after `gone()`, and they are out of the scope of this ticket. The new element uses the same style text, so the look is the same.
- `sh.innerHTML = \`<style>...` stays as it was, because `tests/node/web-player-design.test.mjs` reads the style from the source by that text. The style for the message is read back from `sh.innerHTML`.
- When the add-on is gone before the player is built (an add-on page at load), no message shows.

**Tests**
- `./run-tests.sh`: Python tests PASS, Node tests PASS, RESULT: PASS.

**Not checked**
- The look and the reload in a real Chrome tab after a reload of the add-on.
