# Audit: reader-ui

Read-only audit of 9 Nov 2026. Each finding is a claim. Confirm it in the code before you fix it.

Audit of /Volumes/claude/read-aloud/tts-module/extension/pdf/ (app.js, viewer.js, tts.js, speech.js, notes.js, ask.js, restart.js, index.html, styles.css, ra2-theme.css). This was read-only. I read every file in full. I also read voice-server.py lines 130-160 and 930-975 to confirm how the server answers. I edited no file.

Note: speech.js (the text normalizer) and restart.js had no defects. The code never adds an event listener twice.

## Findings, sorted by value (impact / effort)

1. **app.js:645-646** — bug — certain. If you drag the seek bar while it reads, playback stops and does not start again. The `input` handler calls `jumpTo(..., {resume:false})`, which sets `state.playing = false`. Then the `change` handler sees `state.playing` as false and does nothing. Fix: keep the state in a flag.
   ```js
   els.seek.addEventListener('input', () => { state.scrubPlay ||= state.playing; jumpTo(+els.seek.value, {resume:false}); });
   els.seek.addEventListener('change', () => { if (state.scrubPlay) { state.scrubPlay = false; play(); } });
   ```
   Also: `jumpTo` with `resume:false` (line 317) changes the icon but not `aria-label`. Add `els.playBtn.setAttribute('aria-label','Play')`.

2. **app.js:651 and 656** — bug/precision — certain. A change of speed or voice in the middle of a paragraph starts that paragraph again from its first word. Fix: in both handlers, replace `engine.stop(); speakCurrent();` with `stop(); play();`. `stop()` records `resumeAt` from `state.at`, and `play()` then goes on from that word.

3. **app.js:663-677** — bug — certain. The Preview button can stay disabled forever. Trigger: press Preview, then press Play or Space before the preview ends. `engine.speak` → `stop()` increments the token (ServerEngine), or sets `onend = null` (system engine, which also ignores 'interrupted'). So neither `onEnd` nor `onError` fires. Fix: add `els.previewBtn.disabled = false;` at the start of `stop()`, or in a `finally` after the speak call.

4. **viewer.js:106** — bug — certain. A zoom or a window resize removes the underline of the sentence being read until the next sentence starts. The cause is `this.highlighted = this.highlighted.filter(s => s.page !== n)`, which runs for every page and so empties the list. An empty list also removes the "never release the page being read" guard in `releasePage`. Fix: delete that line. `renderPage` already calls `reapplyHighlight(n)`. Also set `this.wordBoxes = []`, because the old boxes were removed with `textContent=''`.

5. **viewer.js:136-203 and 248-268** — memory/speed — likely, high impact. `releasePage` returns early while a page is still rendering. Trigger: drag the scroll bar quickly through a book. Many pages start to render, leave the view, then finish. Each one keeps its canvas, up to 6 MP, which is about 24 MB. The IntersectionObserver fires only on a change, so these pages are never released. Also, a render that is no longer needed is never cancelled, so the visible page waits behind it. `page.cleanup()` is never called either, so the pdf.js caches grow over a long book. Fix:
   - Set `entry.task = task; entry.page = page` in renderPage.
   - In the observer, set `entry.wanted = isIntersecting`.
   - After the render, add `if (!entry.wanted) this.releasePage(n)`.
   - In `releasePage`, add `entry.task?.cancel(); entry.page?.cleanup(); if (entry.canvas) entry.canvas.width = 0;`.

6. **tts.js:439, 425** — robustness — certain. No fetch to the voice server has a timeout or an abort. If the server stops answering, the status shows "generating…" without end and no error comes. `stop()` and a jump also do not abort the request for the old paragraph. But the server already stops work when the listener closes the connection (voice-server.py:945, the `gone` / 409 path). So an abort would free the engine for the paragraph you want now. Fix:
   - In `speak`, create `this.ac = new AbortController()`.
   - Pass `signal: AbortSignal.any([this.ac.signal, AbortSignal.timeout(30000)])` to fetches that are not read-ahead.
   - Call `this.ac?.abort()` in `stop()`.
   - Do not abort a job that `prefetch` also shares: only abort when the job was made by `speak`.
   - Give `init()` an `AbortSignal.timeout(3000)`.

7. **app.js:501-525** — bug/memory — certain.
   - `openFile` has no try/catch. A damaged or non-PDF file gives an unhandled rejection: the start screen is hidden, the player shows, and no message appears. Fix: wrap the body and call `setStatus('Could not open …')` on error. Do the same for the `sampleBtn` fetch at line 637.
   - The old `state.doc` is never `destroy()`ed. Each document you open stays alive in the pdf.js worker. Fix: `const old = state.doc; … after viewer.load(new) → old?.destroy()`.
   - `++state.parseToken` happens only inside `parseDocument`. Until then, the old document's parse callback goes on and publishes old sentences, and highlights them on the new viewer. Fix: add `state.parseToken++` as the first line of `openFile`.

8. **ra2-theme.css:37 vs 53, 56, 61, 71, 146** — look/accessibility — certain. Keyboard users get no focus ring on `.rename`, `.side-tabs button`, `.note-filter button`, `.selbar button` or `.askbar .ask-player button`. These rules use `all: unset`, and they are either later in the file than the global `:focus-visible` rule or more specific. Only `.ask .ask-player` adds the ring again, and that player is not in `.ask`. Fix: add at the end of the file:
   ```css
   :is(.rename,.side-tabs button,.note-filter button,.selbar button,.askbar .ask-player button,.note):focus-visible { outline: 3px solid #6ea8ff; outline-offset: 2px; }
   ```

9. **tts.js:223-227** — precision — likely. The word highlight runs ahead of the sound by the output latency. With Bluetooth or AirPods this is about 150-250 ms, because `startedAt = ctx.currentTime` does not count the latency. Fix:
   ```js
   const lat = ctx.outputLatency || ctx.baseLatency || 0;
   const elapsed = ctx.currentTime - startedAt - lat;
   ```

10. **tts.js:212** — precision (sound) — certain, medium effort. Speed is applied with `source.playbackRate`, and that also changes the pitch. The default 1.1× raises the voice by about 1.6 semitones, and 1.5-3× sounds like a chipmunk. The server always synthesizes at `speed=1` (voice-server.py:158, 169). Fix:
    - Add `&speed=` to the `/speak` and `/times` URLs, and add speed to the cache key on both sides.
    - Pass the speed to `pipe(..., speed=)`, and play at a rate of 1.
    - Word times then need no `/rate`.

11. **app.js:569-574 and 602-606** — bug — likely.
    - While a document is parsed, `render()` runs every 3 pages and calls `viewer.highlight(..., {follow:true})`. If you are not playing, this pulls you back to sentence 0 each time, because `leaveVoice` acts only while playing.
    - If you press Play during the parse, the end of the parse sets `state.index` to the start point or the saved place. The highlight and the "now reading" text then jump away from what the voice says.
    - Fix: in the progress callback, call `render()` only when `state.playing`, or else update only the seek bar and the counter. At line 603, add `if (!state.playing) state.index = …`.

12. **notes.js:126 and app.js:707** — bug — likely. A click on a saved underline, to remove it or change its group, also starts reading from that word. `.mark-box` has `pointer-events:none`, so the click lands on the text span, and app.js's click-to-read handler (added first) runs too. Fix: in notes.js, register the handler with `{capture:true}` and call `e.stopPropagation()` when `hit` is found.

13. **viewer.js:237-243** — speed — likely. `buildTextLayer` writes `style.transform` and then reads `getBoundingClientRect()` on the next span. This forces a style and layout pass for each span, which is hundreds per page, on every page render and every zoom. Fix: two passes.
    ```js
    const w = measure.map(([s]) => s.getBoundingClientRect().width);
    measure.forEach(([s,t],i) => { if (w[i] > 0 && t > 0) s.style.transform = `scaleX(${t/w[i]})`; });
    ```
    `highlightWord` (310) and `drawMarks` (359) have the same read-after-write pattern. There, read `hostBox` once before the loop.

14. **ra2-theme.css:24 and 48** — look — likely. In dark mode `.word-box` and `.mark-box` use `mix-blend-mode: screen`. The PDF page stays white (`.page {background:#fff}` and the canvas). Screen blending orange over white gives white, so the word box and the saved highlights almost disappear: only the glyphs turn orange. Fix: delete both dark-mode `screen` overrides and keep `multiply`. The page is white in both modes.

15. **viewer.js:283-289** — robustness — possible. `highlightWord` calls `renderPage(...).then(() => this.highlightWord(parts))`. If that page fails to render, `renderPage` catches the error and leaves `rendered = false`. The next call tries again, so the loop does not end: up to 30 s per try, or a tight loop of errors when `getPage` fails at once. A late `.then` can also draw an old word over a newer one. Fix: add a `retried` argument, `highlightWord(parts, retried=false)`, and recurse only `if (!retried)`, after you check that `parts === this.lastParts`.

16. **viewer.js:23-26** — bug — likely. `load()` does not reset `highlighted`, `wordBoxes`, `marks` or `lastWordBox`. Until `notesUI.reload()` runs at the end of the parse, the new document shows the old document's saved highlights on pages with the same numbers. The old `highlighted` list also keeps those pages from being released. Fix: in `load()`, add `this.highlighted = []; this.wordBoxes = []; this.marks = []; this.lastWordBox = null;`.

17. **viewer.js:98-119 with 136-203** — bug — likely. When `rescale` runs during a render (zoom or resize while pages draw), the old render still finishes. It then replaces the page contents with a canvas and text layer at the old scale. The new render runs too, and whichever ends last wins. Fix: in `rescale` and `releasePage`, set `entry.gen = (entry.gen || 0) + 1`. In renderPage, capture `const gen = entry.gen` and return after each `await` if `gen !== entry.gen`.

18. **app.js:200-203 and tts.js:427** — robustness — likely. A single failed paragraph stops reading the whole book. Examples are a server 500 or a 409. Only `console.warn` reports it. `ServerEngine.ready` stays true after the server goes down, so the fallback to Mac voices at lines 112-125 never runs again. Fix: in `onError`, show `setStatus('The natural voice did not answer: press Play to try again')`. Then retry once after 1 s (`setTimeout(speakCurrent, 1000)` guarded by `state.playing`) before you call `stop()`.

19. **styles.css:221 (with ra2-theme.css:5), ra2-theme.css:106, styles.css:276** — look (contrast) — certain.
    - `.toc button.active` makes the text `--accent` #FF8C00 on a light orange background. That is about 2.1:1; AA needs 4.5:1.
    - `.check-h` is #b91c1c on the dark panel #171a21, about 2.7:1.
    - The page placeholder label is #b9bec7 on white, about 1.9:1.
    - Fix: use `.toc button.active { color: var(--ink) }`. Add a dark-mode `.ask .check-h { color: #f87171 }`. Use `.page-label { color: #6b7280 }`.

20. **ra2-theme.css:53, 56, 61, 68, 71** — look (hit targets) — certain. Several controls are smaller than 32 px:
    - `.rename` text buttons are about 16 px high. There are many in the Highlights and Ask panels.
    - `.note .del` is 22 px.
    - `.side-tabs` buttons are about 22 px, `.note-filter` buttons about 24 px, and `.selbar` buttons about 25 px.
    - Fix: add `min-height: 32px; display: inline-flex; align-items: center;` to these, and set `.note .del` to 32×32.
    - Related: font sizes use 8 steps (11.5 to 15 px) and the radius uses 7 values (2, 4, 6, 7, 8, 10, 999). Reduce them to 3 sizes and 2 radii when you touch the file.

21. **notes.js:357 and 261** — accessibility — certain.
    - `if (e.detail) markReading()` ignores a keyboard press, because Enter or Space gives `detail === 0`. A keyboard user cannot mark a sentence. Fix: call `markReading()` always, and stop the global Space handler (app.js:740) from also toggling when `e.target` is a button: `if (e.target.closest('button')) return;`.
    - The delete "×" is a `<span role=button>` inside a `<button>`, so you cannot reach it with Tab. Fix: add `tabindex="0"` and a keydown handler, or move it out of the button.

22. **notes.js:323** — memory — certain, small. The Markdown export calls `URL.createObjectURL` and never revokes the URL. Fix: after `a.click()`, add `setTimeout(() => URL.revokeObjectURL(a.href), 0);`.

23. **tts.js:436-437 with 464** — speed — possible. The cache key leaves out `ahead`. If a paragraph was prefetched as read-ahead (`ahead=3`) and you then press Play or Next, `speak()` reuses that request. The server treats it as read-ahead, and read-ahead waits behind urgent work (voice-server.py:139-147, 173). The paragraph you wait for can then start later. Fix: in `speak`, when the job found in `inflight` came from a prefetch, also send a request without `ahead`. The server returns its cached result, so this costs nothing.

24. **ra2-theme.css:121-132 and ask.js:279** — look (layout under 900 px) — likely. From 821 to about 1000 px, the sidebar (264 px) and the Ask pane (at least 340 px) are both in the page flow. Only about 300 px is left for the PDF, which `computeScale` then fits too small to read. Fix: change the overlay media query from `max-width: 820px` to `max-width: 1100px` for `.askpane`, or hide the sidebar when the Ask pane opens on a narrow window.

25. **notes.js:56** — robustness — possible. For library books, each `write()` sends its POST without waiting for the one before. Two changes close together can arrive in the wrong order, and the older list then overwrites the newer one. Fix: chain the writes:
    ```js
    let q = Promise.resolve();
    q = q.then(() => fetch(...)).catch(() => {});
    ```

Not listed separately: the Enter key in the Ask box does not check `e.isComposing` (low). The audio cache has a count limit of 60 but no byte limit: 60 parts of up to about 2.4 MB each (possible).

## How the reader is structured
- **app.js** is the controller. It owns all state in `state` (`window.__pr`): sentences, index, playing, resumeAt/from/at and parseToken. It opens and parses the file (openFile → parseDocument → buildDocument from extract.js) and runs the transport (play, stop, jumpTo, speakCurrent with a pause between paragraphs). It maps a word to its glyphs (`wordPartsAt`), and handles progress, the time left, the keys and the MP3 export.
- **viewer.js** (`PdfViewer`) owns the rendering. Each page is a sized placeholder, and an IntersectionObserver (1200 px margin) draws or frees the canvas and text layer. It also draws the paragraph underline (`highlight`, `.speaking` spans), the word box (`highlightWord`, `.word-box`), the saved highlights (`setMarks`/`drawMarks`) and the follow scrolling (`keepInView`, `follow` flag).
- **tts.js** owns the sound. `SystemEngine` is speechSynthesis with real boundary events. `ServerEngine` (which extends `KokoroEngine`) fetches WAV and `/times` from 127.0.0.1:8793, and splits each paragraph into the first 5 words plus the rest. `playBuffer` plays an AudioBuffer and fires `onWord` from a rAF schedule (the server's word times, or estimates from syllables). It also has a 60-item cache and the prefetch.
- **speech.js** rewrites text for speech (numbers, years, units, initialisms) and keeps the glyph owner of each character. **notes.js** owns the saved highlights (selection bar, Highlights list, key points to Claude, copy). **ask.js** owns the Ask Claude pane and bar, and reads answers aloud through `voice.say` with the CSS Highlight API. **restart.js** restarts the server.
- **Styles**: styles.css is the base "Paper Reader" look, with tokens and dark mode. ra2-theme.css loads after it and changes the look to the navy and orange style. It also has all the styles for highlights and Ask, so most of the look fixes go there.
