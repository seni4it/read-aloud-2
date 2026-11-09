# 15. Web pages: almost no work before the owner listens

GitHub issue: #16
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Stop the page scan and the voice warm-up that run on each page before the owner shows that he wants to listen. Watch page changes only while sentences are kept, and only inside the read area. Do not build the text of the whole page to find its language.

Evidence: audit/web-page-and-library.md findings 3, 4, 16. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] On a page with a ticking clock and no listen action, the add-on runs no page scan in 30 seconds (counted with a test hook).
- [ ] No request goes to the voice server from a tab before the pointer is on the listen button, a selection, or play.
- [ ] The first sentence after play starts as fast as before, within 0.3 seconds (times in the ticket result).

## Blocked by

- 14 (web-follow-player)

## Work report

Date: 9 Nov 2026. Files changed: `extension/content.js`, new `tests/node/web-idle-cost.test.mjs`, this file. No change in `manifest.json`, `background.js`, `offscreen.js` or `extension/pdf/`.

### How the tests measure

`tests/node/web-idle-cost.test.mjs` loads the real `content.js` in `node:vm` with a fake page, the same method as tickets 13 and 14. This fake counts the work: page and window listeners, timers (with a fake clock, so "30 seconds" is real timer order), MutationObservers made and `observe()` calls, nodes added to the page, messages to the add-on, `getComputedStyle` calls, `getBoundingClientRect` calls, page scans (`createTreeWalker`) and reads of `document.body.innerText`. A "ticking clock" is a text node that changes each second; the fake tells each observer that watches a box around it. The test hook is the fake itself: `content.js` has no code for the tests.

Tests first: 12 tests; with the old `content.js`, 11 failed and 1 passed (the Listen button test below, which guards the speed of play). After the repair all 12 pass.

### Each finding

- **Finding 3 (the MutationObserver on the whole page, and the scan after each change): confirmed and repaired.** The observer watched `<html>` on every page from load. Each change cleared the kept sentences, and the next scroll stop scanned the page again. On the clock page (40 paragraphs, a clock that ticks each second, a scroll every 3 s, 6 mouse moves over text) the old code did in 30 s: 17 page scans, 468 style reads, 237 box reads, 18 timers, 17 messages. Now: 0 scans, 0 style reads, 6 box reads (one for each new paragraph under the mouse), 0 timers, 0 messages. Repair: no observer exists before the owner shows that he wants to listen. `pageSegs()` makes it when it keeps the sentences, and it watches only the read area (`kept.top`: the article, or the body). The first change in that area drops the sentences and stops the watch (`release()`). `root()` is still asked each time, so a site that replaces its whole article gets a new scan of the new article. Tests: "a page with a ticking clock: no page scan and no message to the add-on in 30 seconds", "the page is watched only while sentences are kept, and only inside the article".
- **Finding 4 (the voice warm-up of up to 30 sentences at load and after each scroll): confirmed and repaired.** `warmScreen()` ran 1.2 s after load, at each scroll stop and at each change of tab visibility. It scanned the page and sent up to 30 sentences to the voice server, in every visible tab. Repair: `warmScreen()`, its timer, its scroll timer and the `visibilitychange` listener are removed. The warm-up now starts only when the pointer is on the Listen button, on the "Listen from here" button, on a selection, or at a right-click (see the decision below). Old numbers, a page with 5,000 paragraphs, 5 s after load: 1 scan, 5,000 style reads, 31 box reads, 2 timers, 1 message (a warm-up of 30 sentences), 1 observer. New: all 0. A scroll event (with its scroll stop): old 1 scan, 42 style reads, 42 box reads, 1 timer, 1 message (after a clock change); new all 0. Tests: "a page with 5,000 paragraphs: the load does not read the page", "a scroll event costs no style read, no box read and no timer", "on load: no timer, no observer, one node (the player), at most 9 page listeners, the Listen button shows" (old: 11 listeners, 1 timer, 1 observer; new: 9 listeners, 0 timers, 0 observers; 1 node in both: the player root).
- **The mouse over a paragraph (part of finding 4): confirmed and repaired.** The old code started a timer on each new paragraph under the mouse, and 200 ms later scanned the paragraph, read `document.body.innerText` and sent a warm-up. Now the mouse over a paragraph costs 1 box read (to place the button) and nothing else; a move inside the same paragraph costs nothing (old: 1 timer, 1 scan, 1 style read, 1 page text read, 1 message for each new paragraph). The warm-up now starts when the pointer enters the "Listen from here" button. That call also keeps the page's sentences, so the click sends the first sentence to the voice with no new scan. Tests: "the mouse over a paragraph: one box read, …", "the pointer on 'Listen from here' prepares its sentence; the click then sends it at once, with no new scan".
- **Finding 16 (`document.body.innerText` to find the language): confirmed and repaired.** `warm()` built the text of the whole page on each hover warm-up, selection and right-click, only to look for Cyrillic in its first 400 characters. It also chose the voice from the top of the page, not from the sentence: a Russian paragraph on an English page got a natural-voice warm-up, and an English paragraph on a Russian page got none. Now `warm()` finds the sentence first and asks `voiceFor()` with the sentence text, the same rule that `play()` uses. A first quick check (`voiceFor('')`) still stops the work when the owner chose a Mac voice. Tests: "a warm-up does not read the text of the whole page" (old 1 read, new 0), "the voice of a warm-up follows the sentence, not the top of the page".
- **After listening stops: repaired.** The old code kept the sentences and watched the page for ever. Now `stop()`, the end of the text and a `stopped` event (another tab took the voice) call `idle()`: it clears the marks, drops the kept sentences, stops the watch, and clears `S.segs` and `S.box`. `collect()` also clears its two element maps (`vis`, `blk`) at its end, so a scan keeps no entry for each element of the page. Test: "after listening stops, the cost goes back to the idle level" (30 s of clock and scrolls after Stop: 0 scans, 0 style reads, 0 messages, no timer waits; no watch after the end of the text either).

### Acceptance criteria

- No page scan in 30 s on a page with a ticking clock and no listen action: tested (17 before, 0 now).
- No request to the voice server before the pointer is on a listen button, a selection, or play: tested for load, 30 s of clock, scrolls, mouse over paragraphs and a click with no selection (0 messages). The pointer on the Listen button and on "Listen from here" sends one warm-up.
- The first sentence after play as fast as before: in the fake page with 5,000 paragraphs, the time from the click on the Listen button to the 'speak' message is 4.5 ms before and 5.4 ms after, because the pointer on the button already kept the sentences. The real time in Chrome is a manual check (below).

### Decisions and limits

- **The scan moved from load to the first sign of listening.** The pointer on the Listen button or on "Listen from here" now scans the page at that moment (fake page, 5,000 paragraphs: 138 ms in Node; before, the same scan ran at load). A play with no pointer before it (the keyboard shortcut, the context menu "Read page") now scans at play: 140 ms in Node on 5,000 paragraphs, 5 ms before. On a normal page this is a few milliseconds. The first sentence is also not prepared before such a play.
- **The "Listen from here" warm-up starts when the pointer enters the button, not 200 ms after it enters the paragraph.** When the owner moves to the button fast, the request now goes earlier; when he rests on the paragraph first, it goes later than before. The manual check below measures this.
- **A right-click still prepares its sentence.** The context menu holds "Read from here", and the warm-up makes its first sound fast. This sends one warm-up for each right-click on text, also when the owner does not listen. The ticket names only the listen button, a selection and play; I kept the right-click as a listen sign. To remove it, delete the `warm(...)` calls in the `contextmenu` handler.
- **An old tab after a reload of the add-on.** Before, the scroll warm-up was the call that found the add-on gone and removed the old player. Now the scroll handler reads `chrome.runtime.id` (it is empty in an orphaned script) and only then calls the add-on, which throws and calls `gone()`. In real Chrome a live tab sends nothing on scroll. The fake pages of the older test files have no runtime id, so there a scroll sends one 'ping' message; the background ignores an unknown command.
- `release()` calls `watch?.disconnect?.()`: the fake page of `web-sentences.test.mjs` has an observer with no `disconnect()`, and that file is not mine to change.
- Not measured here: real memory (the kept sentences now exist only while listening), and the cost of `root()` (`innerText` of the article), which now runs only at a listen sign.

### Manual check in real Chrome

Use the test profile window. Load the add-on from `extension/` (Developer mode, Reload). Use made text only. Start the voice server as usual (do not restart it for this check).

1. Idle cost, Performance panel. Open a long page with a ticking clock (a local page with 2,000 paragraphs of made text and `setInterval(() => clock.textContent = new Date().toLocaleTimeString(), 1000)`). Open DevTools, Performance. Record 30 s: do not touch the page for 10 s, then scroll a few times, then move the mouse over paragraphs. In the flame chart, filter on `content.js`. Make sure that there is no long task from `content.js` (only short `mouseover` and `scroll` handlers) and no "Recalculate style" or "Layout" that `content.js` starts.
2. No request before a listen sign. In the voice server log (or DevTools of the offscreen page, Network), make sure that no `/warm` or `/speak` request comes while you load, scroll and move the mouse over paragraphs.
3. Memory, Task Manager. Open the same page in 5 tabs. In Chrome Task Manager (Window > Task Manager) note the memory of each tab. Compare with the add-on turned off. The difference must be small (the player only), and must not grow over 2 minutes.
4. First sound, Listen button. Move the pointer to the Listen button, wait about half a second, click. Measure from the click to the first sound with a screen recording at 60 frames per second (or the `speak` request time in the offscreen Network panel against the click time in the Performance panel). Make sure that it is 0.3 s or less, and that it is the same as with the old version (`git stash` is not allowed for agents; the owner can compare with the version of the previous commit).
5. First sound, "Listen from here". Move the mouse over a paragraph, then on the orange button, click at once. Measure the same way. Then rest the pointer on the button for 1 s before the click. Both must start in 0.3 s or less.
6. After listening. Start the reading, let it read two sentences, click Stop. Record 30 s in the Performance panel with the clock page: the same as step 1 (no scan, no request).
7. Old tab. Reload the add-on on `chrome://extensions`, go back to an old tab, scroll. The old player goes away and the console shows no error.

### Left for other tickets

- Findings 5, 6 (background part), 14, 15, 24 are in `background.js` / `offscreen.js` (ticket 16).
- The listeners for wheel, touch, keys and click stay on the page at all times (passive, one boolean check each). Adding them only while reading would save little and needs care with `gone()`.

### Review round 1

Tests first: 7 new tests and 3 changed tests in `tests/node/web-idle-cost.test.mjs` (now 19). Before the repairs, 3 failed: one for item 1, one for item 3, and one because of a fault in the test itself (item 4). After the repairs all 19 pass. `web-sentences.test.mjs` (23) and `web-follow-player.test.mjs` (18) pass. `./run-tests.sh` gives `RESULT: PASS` (Node 228/228, Python 12 OK). The fake observer now keeps the `subtree` option and tells a `childList`-only watch only about its own children. Fake elements have `isConnected`.

1. **The removal of the read area itself: confirmed and repaired.** A watch on the subtree of `kept.top` sees no change when the site removes `kept.top`, because that change is on its parent. The next `pageSegs(root())` already scanned the new article (`kept.top !== top`), but the old sentences and the watch on the removed node stayed in memory. The reading that runs is not stopped: it goes on as before (ticket 14 behaviour: no scroll on removed text). Now `pageSegs()` also watches each ancestor of the read area with `childList` only (no subtree: only its own children, a few `observe` calls). The callback releases when the read area is no longer on the page (`isConnected`) or when the change is inside it. Test: "the site removes the read area itself: the kept sentences are dropped and the watch stops" (before: the watch stayed on the removed article).
2. **Our own player releases the sentences: not true.** The player root is on `<html>`, outside `<body>` and outside any article, so the watch of the read area never sees its changes. The old `!host.contains(m.target)` filter was needed only because the old watch covered `<html>`. No code change. Test: "changes of the player itself never drop the kept sentences".
   **A page with no article:** the read area is `<body>`, so a clock or an advertisement in the body releases the sentences at its first change during listening. The reading goes on with its own sentences (`S.segs`), so it is not disturbed. Measured with a clock that ticks each second for 30 s during listening: 1 release, 0 scans, 0 style reads, 0 timers, 0 messages; later ticks cost nothing because the watch is stopped. The next listen sign (the pointer on a listen button, a right-click, play) scans the page again once. Test: "listening on a page with no article and a ticking clock: one release, no scan, the reading goes on".
3. **A timer of play() after Stop: not true as stated.** `play()` starts no timer. But the test found a real cost: after a voice server error, the natural voice retry (`natTimer`, a 'voices' message every 5 s) went on after Stop for as long as the server was down, and a note timer waited too. Repaired: `idle()` cancels the retry, sets `natOff = false` (the next play tries the natural voice again; if the server is still down, the Mac voice takes over after one error, as before) and clears the note. Test: "Stop after a voice server error: no timer waits, and no message comes later" (before: 2 timers waited).
4. **`vis` and `blk` cleared at the end of `collect()`: not a fault.** Only `visible()` reads `vis`, only inside `collect()`. `blockOf()` reads `blk` as a cache, and it works the same without an entry. `skipped()`, `mark()` and Follow do not read them. No code change. Test: "after a scan, Follow and 'Listen from here' still work" (play from line 20, two sentence ends, Follow scrolls; after Stop, "Listen from here" on line 5 reads line 5). The first version of this test failed on a wrong count of sentence ends in the test, not on the code.
5. **`voiceFor('')` as the first gate of `warm()`: no fault.** There is no automatic voice setting. The voice is a stored choice (default `kokoro:af_heart`); `voiceFor('')` returns that choice, or the Mac voice when the owner chose a Mac voice or the server failed. The sentence's own voice is checked after. Test: "the default voice on an English page warms the natural voice; a Mac voice setting sends no warm-up".
6. **The 5,000-paragraph test: repaired.** It now asserts the player root (1 node) and at most 9 listeners at load. Then it takes a snapshot and asserts each counter by name in the 5 s after load (all 0).
7. **A watch during listening: test added.** Listen pressed, no Stop, a clock outside the article ticks for 30 s: 0 scans, the article is still watched. Then 5 changes inside the article: 1 release, 0 scans.
8. **Timers directly after Stop: assert added** in "after listening stops, the cost goes back to the idle level", before the 30 s of fake time.
