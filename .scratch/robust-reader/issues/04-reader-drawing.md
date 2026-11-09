# 04. Reader: correct marks and less memory when pages are drawn

GitHub issue: #5
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Repair the page drawing of the reader: the sentence mark after zoom or resize, release and cancel of pages that left the screen, a render that finishes after a zoom, state that stays from the last document, the layout work of the text layer, and the retry loop of the word highlight.

Evidence: audit/reader-ui.md findings 4, 5, 13, 15, 16, 17. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] Zoom or resize while it reads: the sentence mark stays.
- [ ] Scroll fast through a book of 300 pages: the count of live page pictures stays small (at most the pages near the screen), and the memory of the tab does not grow with each pass.
- [ ] Zoom while pages draw: each page shows at the new scale only.
- [ ] Open a second PDF: no saved highlight of the first PDF shows.
- [ ] A page that cannot draw does not start a loop without end.
- [ ] The text layer is built with one read pass and one write pass.

## Blocked by

- 02 (test-bench)

## Work report

Date: 9 Nov 2026. Changed files: `extension/pdf/viewer.js`, `tests/node/reader-drawing.test.mjs` (new), this ticket.

The test file imports the real `viewer.js`. The page (DOM), the canvas, the IntersectionObserver and pdf.js are small fakes. The fake DOM counts layout passes: a read of a size after a write costs one pass. Each test below failed with the old code and passes now.

### Findings (audit/reader-ui.md)

- **Finding 4 (zoom or resize removes the sentence mark): confirmed, repaired.** `rescale()` filtered `highlighted` once for each page, so the list became empty. That also removed the guard that keeps the page that is read. Now `rescale()` keeps `highlighted`, and `renderPage` puts the mark back with `reapplyHighlight`. `wordBoxes` is emptied, because the old boxes went with the old page contents. Tests: "zoom while it reads: the sentence mark stays", "a resize while it reads also keeps the sentence mark".
- **Finding 5 (pages that left the screen keep their pictures; renders not cancelled; no `page.cleanup()`): confirmed, repaired.** `releasePage` returned when the page was still drawing, and the observer does not tell again. Measured with the old code: after a fast scroll through 300 pages, 300 pages stayed drawn. Now:
  - the observer sets `entry.wanted`; a render that ends while `wanted === false` releases its page;
  - `releasePage` also stops a page that is still drawing;
  - the new `drop(entry)` cancels the render task, sets the canvas to 0 by 0 (the picture memory goes at once), and calls `page.cleanup()`.
  - Measured now: at most 3 drawn pages, at most 3 live canvases, at most 3 × 600 × 800 × 4 bytes of canvas, at least 290 cancels and 290 cleanups, and the same after a second pass. Tests: "fast scroll through 300 pages ...", "a drawn page that leaves the screen gives its canvas back".
  - Also: the 30 s render timeout timer is now cleared after each render. Before, each render left a 30 s timer behind.
- **Finding 13 (text layer: one layout pass for each span): confirmed, repaired.** The old loop wrote `transform` and then read the size of the next span. Measured: 200 layout passes for 200 spans; now 1. The same read-after-write was in `highlightWord` and `drawMarks` (measured 9 passes for 10 saved highlights). Both now use one helper, `drawBoxes`: all reads first, then all writes; now 1 pass. `keepInView` still reads the new word box after it is drawn; that read is needed. Tests: "the text layer is built with one read pass and one write pass", "saved highlights and the word box are drawn with one layout pass".
- **Finding 15 (word highlight retry loop): confirmed, repaired.** When `getPage` fails at once, the old code looped in microtasks without end: the test process stopped and only the outer timeout ended it. Now `highlightWord(parts, retried)` tries once, and only while `parts` is still the word that is read (`lastParts`). `clearWord()` cancels a wait. Tests: "a page that cannot draw does not start a loop without end", "a late word highlight does not cover a newer word".
- **Finding 16 (state of the last PDF stays): confirmed, repaired.** `load()` now cancels the renders of the old book and resets `highlighted`, `wordBoxes`, `marks`, `lastWordBox` and `lastParts`. Test: "open a second PDF: nothing of the first PDF shows".
- **Finding 17 (a render that ends after a zoom wins): confirmed, repaired.** Each page has a `gen` number. `drop()` (used by zoom, release, a new book and `refreshVisible`) increases it. `renderPage` stops after each `await` when `gen` changed, gives back its own canvas, and does not log the cancel as an error. A zoom also draws again the pages that were still drawing, not only the drawn pages. Test: "zoom while pages draw: each page shows at the new scale only".

### Test results

- `node --check extension/pdf/viewer.js`: no error.
- `node --test --test-timeout=120000 tests/node/reader-drawing.test.mjs`: 10 pass, 0 fail.
- `./run-tests.sh`: Python PASS; Node FAIL with 2 failures that are not in this ticket: `pdf-text.test.mjs` "rotated.pdf reads as its reference" (the new sample `tests/pdf-text/samples/rotated.pdf` has no reference file yet) and `pdf-layout.test.mjs` "the ligature search ... less than 40 ms" (280 ms). Both belong to the extract.js work that runs at the same time.

### Not changed here (for other tickets)

- No change in `app.js` is needed for this ticket. Audit finding 7 (`state.doc.destroy()` and `parseToken` in `openFile`) is in app.js and stays for its own ticket.
- `highlight()` awaits `renderPage` of a page that is already drawing; that call returns at once, so the first underline can come only when the page ends. It was so before; the mark comes with `reapplyHighlight` when the render ends.

### Manual check in real Chrome

The unit tests cannot show the picture on the screen. Do these steps with a long PDF (300 pages or more):

1. Open the PDF in the reader. Press Play.
2. While it reads, press `+` three times, then `0`. The underline of the sentence and the word box must stay on the text, at the new size.
3. Make the window narrower and wider while it reads. The underline must stay.
4. Open the Chrome Task Manager (Window > Task Manager). Note the memory of the reader tab.
5. Drag the scroll bar quickly from the first page to the last page and back, three times. Then wait 5 seconds.
6. The memory of the tab must come back near the value of step 4. It must not grow with each pass.
7. In DevTools Console, type `[...__viewer.pages.values()].filter(e => e.rendered).length`. The number must be small (only the pages near the screen, usually 2 to 5).
8. Press `+` several times quickly while the pages draw. Each page must show one sharp picture at the last size, with no blurred or small picture over it.
9. Make a saved highlight on page 1. Open a second PDF. No highlight of the first PDF may show on page 1 of the second PDF.
10. The Console must show no new red error during these steps.

## Review round 2

A reviewer found 4 risks, 1 question and weak tests. Each item below got a test first. The test failed with the round 1 code and passes now. Tests: `tests/node/reader-drawing.test.mjs`, 16 pass, 0 fail.

The fakes are stronger now:
- A page is at left 50 px, top 1000 × n px, not at 0. A span is at its `style.left`. A range rectangle comes from its span. So a box position is a real check.
- The fake `page.cleanup()` works like pdf.js 4.10 (`#tryCleanup` in `vendor/pdf.mjs`): it gives `false` and frees nothing while a render or a text read of that page is busy. Unlike pdf.js, it does not try again later by itself.
- The fake `getPage` gives the same page object for the same number, as pdf.js does.

1. **Zoom loses the word box: confirmed, repaired.** `rescale()` emptied `wordBoxes`, and nothing drew the box again. Now the new method `drawWord()` draws the boxes of `lastParts` with no scroll. `renderPage` calls it when the page it drew has a part of the word. `highlightWord` uses `drawWord()` too. Test: "zoom while it reads: the sentence mark stays". It now makes a word box first. After a zoom to scale 2, it checks that the box is on the page at the new place (`50px` = span at 40 px + 2 letters × 5 px).
2. **White flash on zoom: confirmed, repaired.** `blank()` emptied the page before the new picture existed. Now `rescale()` keeps the canvas that is on the screen (`entry.old`) and stretches it with CSS to the new size. The text layer and the boxes go. The new picture replaces the old one only when it is ready, and then the old canvas is set to 0 by 0. A second zoom before the new picture is ready keeps the same old picture. `drop()` also clears `entry.old`, so a release frees it. Test: "zoom: a page on screen never goes white ...". It checks for a canvas on each page at each step after two zooms. Then it checks that only the new picture stays and that only 2 live canvases are left.
3. **A page that left the screen while it was read keeps its canvas: confirmed, repaired.** The new `releaseLeft(old)` releases each page of the old sentence that the observer marked `wanted === false`.
   - `clearHighlight()` and `highlight()` call it.
   - `highlight()` calls it only after it sets the new sentence. So a page that is still read stays, and it is not drawn again for each sentence.
   - Tests: "a page that left the screen while it was read is released when the reading moves on" and "a page that is read off screen is not drawn again for each sentence".
4. **`cleanup()` while the page is busy: confirmed, repaired.**
   - In the round 1 code, `drop()` cancels the task and calls `cleanup()` at once. At that moment pdf.js still counts the render task (the cancel ends it later), so `cleanup()` gives `false`.
   - The vendored pdf.js 4.10 keeps `#pendingCleanup = true`. When the render task completes, it calls `#tryCleanup(true)`, and that cleans 5 s later. So the claim "the memory is not freed" is only partly right: the memory was freed late, and only through internal pdf.js behaviour.
   - Now the `finally` of a dropped `renderPage` calls `page.cleanup()` again, after all its work has ended, but only when no newer render uses the page. So the reader does not depend on that internal behaviour.
   - Test: "pdf.js memory of a page is freed after its busy render ends". The fast-scroll test also now counts successful cleanups: the round 1 code gave 0, and now at least 290 pages are cleaned.
5. **Question (are saved highlights of the new book missing after `load()` sets `marks = []`?): not a fault in viewer.js.** Proof from the code (read only):
   - `app.js` `openFile`: `state.sentences = []` (line 548) comes before `viewer.load()` (line 566).
   - `notes.js` `draw()` (lines 72-83) builds each mark from `state.sentences` with `where()` and `wordPartsAt`. With no sentences, every mark has no parts. So a draw before `load()` cannot carry highlights of the new book: they do not exist yet.
   - The highlights of the new book are read and drawn by `notesUI.reload()` → `draw()` → `setMarks()`. `parseDocument` calls it at line 656, after `load()` and after the sentences are set (line 653).
   - Test: "saved highlights set before a new book loads do not show; the next setMarks shows them".
   - **A fault that I found in notes.js (another owner):** between `load()` and `reload()`, the `notes` array of notes.js still holds the notes of the old book, but `state.docKey` is already the new key (app.js line 557). A highlight that is added or removed during the read-in calls `write()`. That stores the old book's notes under the new book's key, or the library id of the page. Also, the progress callback sets `state.sentences` to the partial sentences (app.js line 634). So a `draw()` in that time matches the old notes against the new text.
   - Exact change for the notes.js owner: add `reset() { notes = []; viewer.setMarks([]); list(); }` to the object that `setupNotes` returns. In `app.js` `openFile`, call `notesUI.reset();` right after `state.parseToken++;`.
6. **Weak tests: repaired.** New test: "saved highlights and the word box come back when a released page is drawn again". It draws a saved highlight and a word box on page 3 (page at left 50, top 3000), checks their exact positions, releases the page, draws it again, and checks the same positions. The text layer test and the layout-pass tests are unchanged.

### Test results, round 2

- `node --check extension/pdf/viewer.js`: no error.
- `node --test --test-timeout=120000 tests/node/reader-drawing.test.mjs`: 16 tests, 16 pass, 0 fail.
- `./run-tests.sh`: Python PASS. Node FAIL, only because of `pdf-text.test.mjs` "rotated.pdf reads as its reference" (the new sample of the extract.js work has no reference file yet). That failure does not come from this ticket.

### Manual check in real Chrome, more steps

11. While it reads, press `+`. The pages must not go white. For a short time the old picture shows, a little soft, then the sharp one comes. The word box must come back on the word.
12. Press Play. Scroll far away from the page that is read and wait for the next sentence. In DevTools, the count of step 7 must stay small.
