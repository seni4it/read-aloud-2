# 14. Web pages: Follow and the player work on every site

GitHub issue: #15
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Repair Follow and the player of the web-page reader: no jump when the site replaced its content, Follow inside a scrolling box, the player on the root element and put back when the site removes it, no errors from a tab that lost the add-on after an update, no stop of Follow when the owner types in a form, and controls of at least 32 px.

Evidence: audit/web-page-and-library.md findings 2, 11, 12, 13, 22, 25. Each audit finding is a claim: confirm it in the code first.

From ticket 16: the content.js half of web finding 6 is still open. On a `stopped` event, content.js must raise its sentence id (`S.id++`), so that a late event of the stopped sentence is ignored.

## Acceptance criteria

- [ ] On a test page that replaces its content while it reads, the page does not jump.
- [ ] On a test page that scrolls inside a box, the text follows the voice.
- [ ] On a test page with a transform on its body, the player is at the bottom of the window.
- [ ] After a reload of the add-on, an old tab writes no error to its console.
- [ ] Space in a text field does not stop Follow.
- [ ] The 'Listen from here' button and the speed buttons are 32 px or more.

## Blocked by

- 13 (web-sentences)

## Work report

Date: 9 Nov 2026. Files changed: `extension/content.js`, new `tests/node/web-follow-player.test.mjs`, this file. No change in `background.js` or `offscreen.js`.

Tests: `tests/node/web-follow-player.test.mjs` loads the real `content.js` in `node:vm` with a fake page, the same method as `web-sentences.test.mjs`. This fake also keeps the event listeners, the timers, the scroll calls and a screen place for each element. A range on text that is no longer on the page gives a box of zeros, as in Chrome. Before the repair, 11 of the 13 tests failed, each for the fault that it names. After the repair, all 13 pass, `web-sentences.test.mjs` passes, and `./run-tests.sh` gives `RESULT: PASS`.

### Each finding

- **Finding 2 (the site replaces its content): confirmed and repaired.** In `mark()`, a word on a removed node had a box of zeros, so `r.top < 40` was true and the page scrolled up by 40% of the window on each word (the test saw `scrollTo({ top: -320 })`). Now `mark()` stops when the box has no width and no height. Test: "when the site replaces the text being read, a word move does not scroll the page".
- **Finding 12 (text that scrolls inside a box): confirmed and repaired.** Follow and the "Go to the word" button scrolled only the window. Now `scroller()` finds the nearest box around the text block that scrolls (`overflow-y` auto, scroll or overlay, and more content than its height). `bringIntoView()` scrolls that box, or the window when there is no box. The "out of view" test uses the visible part of the box, so the "away" ring is correct in a box. Tests: "Follow scrolls the box that holds the text, not the window", "the Go to the word button scrolls the box that holds the text", "in a box, a word on screen moves nothing".
  The audit proposed `scrollIntoView({ block: 'center' })` on the block. I did not use it: for a paragraph that is higher than the window, it shows the middle of the paragraph, not the word.
- **Finding 11 (the player on the root element): confirmed and repaired.** The player was appended to `<body>`. Now it is appended to `<html>`, and `ui()` puts it back when the site removed it. Tests: "the player is on the root element, not inside the body", "the player is put back when the site removes it".
- **Finding 13 (an old tab after a reload of the add-on): confirmed and repaired.** `chrome.runtime.sendMessage` throws at once in an orphaned script, and `.catch()` does not catch that. The scroll warm-up, the hover warm-up, the voices request, the "my tab" request and `chrome.storage.sync.set` could all throw. Now one function `ask()` sends every message inside `try`. On the first throw, `gone()` stops the reading, clears the highlights and removes the player, and all later calls do nothing. The voice server retry also stops. I do not use `chrome.runtime.id` as the test, because the fake `chrome` of `web-sentences.test.mjs` has no `id`. Tests: "after a reload of the add-on, scroll and hover in an old tab throw no error", "after a reload of the add-on, the old player leaves the page".
- **Finding 25 (Space in a text field): confirmed and repaired.** The window `keydown` handler called `leave()` for Space and the arrow keys in any field. Now it does not, when the target is an input, a text area, a select or editable text. Tests: "Space in a text field does not stop Follow; Space on the page does", "typing in a contenteditable box does not stop Follow".
- **Finding 22 (controls under 32 px): confirmed and repaired.** The "Listen from here" button was 28 × 28 px and the speed buttons were about 26 px high. Now the button is 32 × 32 px, it is 38 px left of the paragraph (it was 34 px), and the speed buttons have `min-height: 32px`. Tests: "the 'Listen from here' button and the speed buttons are 32 px or more", "the 'Listen from here' button does not cover the paragraph" (this one passed before too; it guards the new place).
- **Web finding 6, the content.js half (from ticket 16): confirmed and repaired.** The `stopped` branch did not change `S.id`, so a late `end` of the stopped sentence called `play(S.i + 1)` and took the voice back. Now the branch does `S.id++` first. Test: "after 'stopped', a late 'end' of the stopped sentence does not take the voice back".

### Limits, left for other tickets

- `scroller()` finds only the nearest scrolling box. When that box is itself partly off the window, the window does not move with it.
- A box where `<body>` itself scrolls (`html { overflow: hidden }` with `body { overflow: auto }`) is not found: the window scroll is used there, as before.
- The player is put back only when `ui()` runs (each new sentence, play, pause, a settings change). A site that removes it before any reading shows no listen button until then.
- An old tab removes its player only at its first call to the add-on (a scroll stop, a hover, a click on play). Before that, the old player stays visible.

### Manual check in real Chrome

Use the test profile window (approved on 9 Nov 2026). Load the add-on from `extension/`. Use made text only.

1. Content replaced. Open a local page with a long article of made sentences and a button whose script replaces the article with new paragraphs (`article.innerHTML = ...`). Start the reading. Click the button. Make sure that the page does not jump up. Make sure that the reading stops or goes on, with no scroll on each word.
2. Text in a box. Open a page with `html, body { height: 100%; overflow: hidden }` and one `div` with `height: 100vh; overflow: auto` that holds 40 paragraphs. Start the reading at the top. Make sure that the box scrolls with the voice. Turn the mouse wheel: Follow stops and the target button gets an orange ring. Click the target button: the box scrolls back to the word.
3. Transform on the body. Open a page with `body { transform: translateZ(0) }` and a long text. Scroll to the middle. Start the reading. Make sure that the player bar is at the bottom of the window and the listen button is at the right edge of the window.
4. Player removed. On the same page, run `document.querySelector('ra2-root').remove()` in the console while it reads. Make sure that the player comes back at the next sentence.
5. Reload of the add-on. Open a page and leave it open. On `chrome://extensions`, click the reload button of Read Aloud 2. Go back to the old tab. Open its console. Scroll, stop, and move the mouse over paragraphs. Make sure that the console shows no "Extension context invalidated" error and that the old player is gone. Reload the tab: the new player works.
6. Typing in a form. Open a page with a long text and a text field at the top. Start the reading. Click in the field and type words with spaces. Make sure that the page still follows the voice and that the target button has no orange ring.
7. Sizes. Move the mouse over a paragraph: in DevTools, the "Listen from here" button is 32 × 32 px and does not cover the text. Open the speed menu: each speed button is 32 px high or more.
8. Two tabs. Start the reading in tab A. Start the reading in tab B. Make sure that tab A stays stopped and does not start again.
9. Rendered sizes. The size test reads the CSS text only. In DevTools, select the "Listen from here" button and one speed button in the shadow root of `ra2-root`. Make sure that the box model shows 32 px or more for each.

### Review round 2

The new tests were written first. Before each repair, they failed for the fault that they name. Now `web-follow-player.test.mjs` has 18 tests and all pass. `web-sentences.test.mjs` passes, `node --check extension/content.js` passes, and `./run-tests.sh` gives `RESULT: PASS`.

1. **`gone()` before the player existed: confirmed and repaired.** On an add-on page, the `myTab` request runs before `host` was declared. A sync throw there called `gone()`, which read `host` too early and threw a ReferenceError. Now `host` is made near the top of the script, so `gone()` is safe at any time. The player shadow root is still built in the player section. Test: "an add-on page whose add-on is already gone loads with no error and shows no player".
2. **Style reads for each word: confirmed and repaired.** `scroller()` ran in each `mark()`. Now `play()` finds the scrolling box once for each sentence and keeps it in `S.box`. `mark()` and the "Go to the word" button use `S.box`. A word move still reads the box's place once, because the box can move. Test: "the scrolling box is found once for each sentence, not for each word" (it counts `getComputedStyle` calls).
3. **Work after `gone()`: confirmed and repaired.** Every page and window listener is now added with `on()`, which does nothing after `gone()`. Every timer is made with `later()`, and `gone()` clears all waiting timers. `gone()` also stops the MutationObserver. The `chrome.storage.onChanged` and `chrome.runtime.onMessage` handlers return at once after `gone()`. The player buttons need no guard because the player is removed. Test: "after the add-on is gone, scroll, hover, wheel, keys and timers do no work". It counts style reads, ranges and timers after `gone()`, and all counts stay the same.
4. **A rejected promise: decided and repaired.** Before, every rejection was swallowed and the reading went on. Now a rejection whose message has "context invalidated" also calls `gone()`, the same as a sync throw. Any other rejection is still swallowed and the reading goes on. Examples are "Could not establish connection. Receiving end does not exist." and "The message port closed before a response was received.". These come when the background restarts, and the add-on is still there. There is no unhandled rejection in any case. Tests: "a rejection "Extension context invalidated" also removes the player, with no unhandled rejection" and "a rejection "Receiving end does not exist" or "message port closed" keeps the player and the reading" (this one passed before as well; it guards the rule).
5. **Limits, not repaired:**
   - A scrolling box inside a shadow DOM is not followed. `scroller()` walks `parentElement`, which stops at the shadow root. The window scrolls there, as before.
   - The button-size test reads the CSS text in `content.js`, not the rendered size. Step 9 of the manual check covers the rendered size.
