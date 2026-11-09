# Audit: web-page-and-library

Read-only audit of 9 Nov 2026. Each finding is a claim. Confirm it in the code before you fix it.

Read Aloud 2: read-only audit. I edited no files.

I read every file in scope in full. I also read two outside it: voice-server.py lines 48-52, to check the voice list (it matches `KNOWN` in content.js), and extension/pdf/app.js line 24, to check how the reader page connects. The uncommitted change to `voiceFor` is treated as intended. It causes no defect of its own.

The list is sorted by value (impact against effort). All paths are relative to /Volumes/claude/read-aloud/tts-module/.

1. **extension/content.js:102 — precision. Certain.**
   - What is wrong: a run of more than 280 characters with no space (a long URL, a DOI, a gene sequence) has no comma and no space to cut at. `Math.max(part.lastIndexOf(' '), 1)` then cuts every 1 character, so the voice reads hundreds of one-letter "sentences".
   - Smallest fix: `const sp = part.lastIndexOf(' '); end = start + (k > MAX / 3 ? k + 1 : sp > 0 ? sp : MAX);`

2. **extension/content.js:185-187 — bug. Likely.**
   - What is wrong: an SPA or live page can replace the DOM while reading. Then the word ranges point at detached nodes, and `getBoundingClientRect()` returns all zeros. `r.top < 40` is true, so on every word the page scrolls up by 40% of the window.
   - Smallest fix: `if (!r.width && !r.height) return;` before the `out` test. Optionally set `kept = null` there too.

3. **extension/content.js:74-75 together with 373-387 — speed. Certain.**
   - What is wrong: the MutationObserver watches the whole document (childList, subtree, characterData) on every page. On pages that keep changing (clocks, tickers, ads, chat), any change clears `kept`. Then every scroll stop (`warmScreen`, 700 ms) runs `root()`, which calls `innerText` on the article, and a full `collect()`: `closest(SKIP)` with about 40 selectors plus `getComputedStyle` up each ancestor chain. It then calls `getBoundingClientRect` on every sentence from the top of the page down to the screen. This is jank on long pages, even when the user never presses play.
   - Smallest fix: in the observer, `if (!kept) return;` first, and `kept.top.contains(m.target)` in place of the plain `some`. Cache `root()` in a variable that the same observer clears.

4. **extension/content.js:383 and 386 — speed and memory. Certain about the behaviour; the cost is a design trade-off.**
   - What is wrong: every visible tab sends up to 30 sentences to the local synthesizer 1.2 s after load, and again after each scroll. This happens before any user action, with the default voice (Kokoro). Each time, the background makes the offscreen document again (Chrome closes it after 30 s without sound). It also keeps the whole page's sentences in `kept`, which is about 2-3 times the page text, in every tab.
   - Smallest fix: `texts.length >= 4` in place of `>= 30`. Alternatively, run `warmScreen` only after the first `mouseenter` on the launcher in this tab.

5. **extension/background.js:60 — bug (unhandled rejection). Certain about the code; the trigger is possible.**
   - What is wrong: `chrome.runtime.sendMessage({to:'offscreen', cmd:'speak'…})` has no `.catch`. If the offscreen page is closing, or not listening yet, the promise is rejected. The page then never gets 'error' or 'end' and stays in "playing" with no sound.
   - Smallest fix: `.catch((e) => tell(tab, { evt: 'error', id: m.id, why: 'Audio player: ' + e.message }))`

6. **extension/background.js:75 and extension/content.js:207 — bug (race). Possible.**
   - What is wrong: `S.id` is a separate counter in each tab, and every tab starts it at 0. When tab B takes the voice from tab A, a 'tick' or 'end' from A that is already in flight still passes `owner.id === m.id` if the two ids are equal. A's 'stopped' handler does not change `S.id`, so a late 'end' makes A call `play(S.i + 1)` and take the voice back.
   - Smallest fix: `if (owner && owner.id === m.id && owner.tab === m.tab)`, and add `S.id++` in the 'stopped' branch.

7. **extension/content.js:14 — precision. Certain.**
   - What is wrong: `ABBR` does not have "al", so "Smith et al. reported" is cut into two sentences. This is very common in the dental papers he reads. "cf.", "pp.", "p.", "Eq.", "Ref.", "Inc." and initials ("J. R. Smith" becomes "J." / "R." / "Smith…") are also cut. Note also that "No." with the `i` flag joins "…said no. Then…" into one sentence.
   - Smallest fix: add `al|cf|pp?|Eq|Ref|Inc|Ltd|Jan|Feb|Aug|Sept?|Oct|Nov|Dec` to the list. Add a second test without the `i` flag: `|| /(^|\s)\p{Lu}\.$/u.test(…)`.

8. **extension/content.js:65-67 — precision. Likely.**
   - What is wrong: text nodes separated by `<br>` (poems, addresses, abstracts, converted PDFs) are joined with no space: "end.Next". Words stick together, and the sentence does not split, because the split needs a space after the stop.
   - Smallest fix: before `b.parts.push`, add `if (b.text && !/\s$/.test(b.text) && n.previousSibling?.nodeName === 'BR') b.text += ' ';`. The `at` offset stays correct because it is read after the space is added.

9. **extension/content.js:55 (with 267 and 445) — precision. Certain.**
   - What is wrong: "Listen" on a selection uses the same `skip` list as whole-page reading. Selected text inside `pre`, `aside`, `.infobox`, `[class*="share"]`, `nav` or a table caption gives "No text to read here."
   - Smallest fix: in `collect`, use `const sk = range ? 'script,style,noscript,template,ra2-root' : skip;` and test `p.closest(sk)`.

10. **extension/content.js:55 — robustness. Possible.**
    - What is wrong: `p.closest(skip)` goes all the way up to `<html>`. Cookie or share tools often put classes such as `cookie-consent-active` on `<body>` or `<html>`. Then every text node is rejected and the whole page reads "No text to read here."
    - Smallest fix: `const c = p.closest(skip); return p && !(c && c !== document.body && c !== document.documentElement) && visible(p) ? …`

11. **extension/content.js:347 — robustness and look. Possible.**
    - What is wrong: the player host is appended to `<body>`. If the page sets `transform`, `filter` or `contain` on body, the `position: fixed` bar, launcher and hover button are placed relative to body, not the window, so they can go off screen. Frameworks that hydrate the whole document (Remix, some Next.js pages) can also remove the extra child, and the player then disappears while reading.
    - Smallest fix: `document.documentElement.appendChild(host)`. In `ui()`, add `if (!host.isConnected) document.documentElement.appendChild(host);`

12. **extension/content.js:187 and 389 — robustness. Likely.**
    - What is wrong: "follow" scrolls `window` only. Apps whose text scrolls inside a div (docs sites with `html, body {overflow: hidden}`, Notion, web mail) never follow. The 'away' ring also lights on every word.
    - Smallest fix: `seg.b.el.scrollIntoView({ block: 'center', behavior })` in place of `scrollTo(...)`. It scrolls the nearest scrolling ancestor.

13. **extension/content.js:142, 157 and 403 — MV3 robustness. Likely.**
    - What is wrong: after `chrome.runtime.reload()` (the self-update at background.js:136), the content scripts in open tabs are orphaned. `chrome.runtime.sendMessage` then throws synchronously ("Extension context invalidated"), so `.catch` does not catch it. Every hover warm-up and scroll stop throws in the page console. The old player stays and does nothing. Chrome does not inject the new content script into tabs that are already open.
    - Smallest fix: `const send = (m) => { if (!chrome.runtime?.id) return; try { chrome.runtime.sendMessage({ to: 'bg', ...m }).catch(() => {}); } catch {} };`. Optionally remove the host when `chrome.runtime.id` is gone.

14. **extension/background.js:123-135 (port opened only at extension/pdf/app.js:24) — MV3 bug. Likely.**
    - What is wrong: `readersOpen` is a global. An open port with no messages does not keep the service worker alive, so after about 30 s idle the worker stops and the reader's port disconnects. The reader never connects again. When the alarm wakes the worker, `readersOpen` is 0, and `selfUpdate` reloads while reader tabs are open. This is exactly what the guard is meant to stop.
    - Smallest fix: `if ((await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [READER + '*'] })).length) return;` in place of the counter.

15. **extension/background.js:82 — robustness. Possible.**
    - What is wrong: `fetch(SERVER + '/voices')` has no timeout. If the server accepts the connection but stalls (for example while the model loads), the popup's voice list and the player's "Loading voices…" wait forever. The 5-second `retryNatural` loop also stalls.
    - Smallest fix: `fetch(SERVER + '/voices', { signal: AbortSignal.timeout(2000) })`. Do the same for `/times` in offscreen.js:41.

16. **extension/content.js:252 — speed. Certain.**
    - What is wrong: every hover warm-up, text selection and right-click calls `document.body.innerText`. This forces layout and builds the text of the whole page, only to look for Cyrillic in the first 400 characters.
    - Smallest fix: compute `segs`/`first` first, then `const v = voiceFor(first[0].say)`. Or cache the page language once in a variable.

17. **app/library.js:49 — bug and memory. Certain.**
    - What is wrong: when a cover fails and `!b.cover`, `onerror` sets the source again every 4 s, with no limit. The loop keeps going after the card is removed. `show()` rebuilds every card on each search keystroke and each window focus, so every rebuild adds one more endless 4-second loop per failing book.
    - Smallest fix: `let tries = 0;` then `if (!b.cover && ++tries < 5 && el.isConnected) setTimeout(...)`.

18. **app/library.js:54 — speed. Certain.**
    - What is wrong: each `card()` fetches `/library/<id>/export`. Because `show()` runs on every search keystroke, typing 5 letters with 40 books sends 200 requests.
    - Smallest fix: fetch the export states once in `load()` and keep them on `b` (`b.exp`), then read `b.exp` in `card()`.

19. **app/library.js:122, 73 and 116 — bug (unhandled rejections). Certain.**
    - What is wrong, three places:
      - Line 122: if he picks a file that is not JSON, `JSON.parse` throws and he gets no message.
      - Line 73: if the server is down, `fetch` is rejected and the status stays "Adding…".
      - Line 116: if `import('/reader/restart.js')` or `restartServer` fails, the restart button stays disabled for good.
    - Smallest fix: wrap each one in `try { … } catch { status(…) }`. Use `finally` for the button reset.

20. **extension/paste.html:14 — look. Certain.**
    - What is wrong: `font: 16px/1.5 inherit` is not valid CSS, because `inherit` cannot be part of a shorthand. Chrome drops the whole declaration, so the textarea shows the browser's default small font, not 16 px.
    - Smallest fix: `font: inherit; font-size: 16px; line-height: 1.5;`

21. **extension/popup.html:28-33 — look and accessibility. Certain.**
    - What is wrong: the six switches are `<div class="sw">text <input type=checkbox></div>`. The text is not a label, so clicking the words does nothing and screen readers announce an unnamed checkbox. The only hit target is the 20 px box.
    - Smallest fix: change `<div class="sw">` to `<label class="sw">`, keeping the `id` on `siteRow`.

22. **extension/content.js:327 and 324 — look (hit targets). Certain.**
    - What is wrong: the "Listen from here" button is 28 × 28 px. The speed preset buttons (`.rates button`, padding 4px 10px at 14 px) are about 26 px high. Both are under 32 px.
    - Smallest fix: `.hover { width: 32px; height: 32px; }` and set `left` to `r.left - 38`. Add `.menu .rates button { min-height: 32px; }`.

23. **app/library.css:21 — look (contrast). Certain.**
    - What is wrong: the "PDF" placeholder on covers is `#94a3b8` on `#e9edf2`, about 2.2:1. That fails WCAG AA even for large text, which needs 3:1.
    - Smallest fix: `color: #64748b` (about 4:1).

24. **extension/background.js:31 — speed. Certain; low impact.**
    - What is wrong: `tell()` sends every event as a runtime broadcast as well as to the tab. 'tick' comes 14 times a second, so each one is copied to every extension page: the offscreen page, the popup, and all PDF reader and paste tabs. This happens even when the speaker is an ordinary web tab.
    - Smallest fix: in `speak()`, keep `owner.ext = !sender.tab || sender.url.startsWith('chrome-extension:')` (pass `sender` in). Send the runtime broadcast only when `owner.ext` is true.

25. **extension/content.js:462 — bug. Certain; low impact.**
    - What is wrong: pressing Space (or the arrow keys) inside a text field while reading calls `leave()`, so the page stops following the voice. This happens, for example, when he takes notes in a form while listening.
    - Smallest fix: `if (e.target.closest?.('input,textarea,[contenteditable]')) return;` at the start of the handler.

**Checked, no defect found:**
- The shell scripts quote all paths, so the space in "tts module" is safe. One small risk: make-store-zip.sh:4 puts `$DIR` inside a Python string literal, which breaks only if the path contains a `'`.
- The offscreen page cannot be created twice: the `making` promise and the "single offscreen" error check together prevent it.
- The 'voices' handler returns `true` for its async reply.
- The offscreen 'resume' answers synchronously.
- `host` is used in the observer before its `const` line, but the observer runs after the script has finished, so this is safe.
- Decimals ("3.5") and clock times ("10:30") stay whole.

**Message flow between content.js, background.js and offscreen.js:**
1. content.js sends `{to:'bg', cmd:'speak'|'warm'|'pause'|'resume'|'rate'|'stop'|'voices'}` with `chrome.runtime.sendMessage`. The background keeps one global `owner` = {tab, id, engine}.
2. For the system engine, background.js calls `chrome.tts.speak`. Its `onEvent` (start, word, end, error) goes back through `tell()`, which uses `chrome.tabs.sendMessage(tab)` and also a runtime broadcast for extension pages.
3. For Kokoro, background.js makes or reuses offscreen.html. It forwards `{to:'offscreen', cmd…}`. The offscreen page plays `/speak` WAVs from 127.0.0.1:8793 and warms the next sentences through localhost:8793, at most 2 at a time.
4. offscreen.js sends `{to:'bg-evt', tab, id, evt:'start'|'times'|'tick'|'end'|'error'}`. The background passes it on to the tab with `tell()` only while `owner.id` matches.
5. content.js moves the highlight on 'times', 'tick' and 'word', and calls `play(i+1)` on 'end'. It changes to the Mac voice on a Kokoro error. On 'lost' (no offscreen page or no owner after a long pause) it says the sentence again from the current word. Context menu and keyboard commands reach the tab directly from the background with `tabs.sendMessage`.
