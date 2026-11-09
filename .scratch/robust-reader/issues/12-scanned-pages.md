# 12. Scanned pages: read ahead 2 pages only, with a time limit

GitHub issue: #13
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Stop the chain reaction where each scanned page starts the pages after it. Recognise one page at a time. Read ahead at most 2 pages from the page that is wanted. Give the request a time limit of 60 seconds and try a failed page again later. Release the page picture after it is sent.

Evidence: audit/pdf-text.md findings 1, 10. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] Open a scanned book of 300 pages: at most 3 recognitions are asked in the first 10 seconds (counted in the server log or with a Node test of the queue).
- [ ] A stopped voice server gives a message after at most 60 seconds.
- [ ] A page that failed one time is tried again when it is wanted again.

## Blocked by

- 02 (test-bench)

## Work report

Date: 9 Nov 2026. Files changed: `extension/pdf/ocr.js`; new test file `tests/node/scanned-pages.test.mjs`.

### Findings

- **pdf-text finding 1 (read-ahead chain reaction): confirmed, repaired.** In `withOcr` → `textOf`, each scanned page started `textOf(n+1)` and `textOf(n+2)`, and these read-ahead pages started their own read-ahead. So the whole book went into recognition. Nothing limited the recognitions in the add-on (the voice server has its own slots, but each page picture was made first). One part of the claim is not exact: a failed recognition was not cached as a rejected promise. `recognize(...).catch` gave the empty page text, and that empty result stayed cached for ever, so the page was never tried again. A failure in `getPage` or the page's own text reader did stay cached as a rejection, and from read-ahead it was not handled.
- **pdf-text finding 10 (no time limit, picture kept): confirmed, repaired.** In `recognize`, `fetch` had no time limit, and the canvas (about 16 MB) was held until garbage collection.

### Changes (all in `extension/pdf/ocr.js`)

- `withOcr`: a new queue `inTurn` runs one recognition at a time.
- `withOcr` → `textOf(n, ahead)`: only a wanted page reads ahead (pages n+1 and n+2). A read-ahead page does not read ahead. Read-ahead errors are caught. When the recognition or the page read fails, the page is taken out of the cache, so it is tried again when it is wanted again.
- `withOcr` → `textOf`: the time limit (`LIMIT`, 60 seconds) starts when the page is asked, so a page that waits in the queue also gives its message within 60 seconds.
- `recognize(page, until)`: the canvas is released (`width = height = 0`) after the PNG is made. `fetch` gets an `AbortController` signal with a timer up to `until`. When the time is out, the message is "Page N: no text found (the voice server did not answer in 60 seconds)."

### Acceptance criteria

- At most 3 recognitions in the first 10 seconds for a scanned book of 300 pages: **tested** (`scanned-pages.test.mjs`, exactly 3 recognitions when page 1 is opened, and only 1 at a time).
- A stopped voice server gives a message after at most 60 seconds: **tested** with fake timers, for the wanted page and for a page in the queue. A stopped server (connection refused) fails at once. A server that does not answer fails at 60 seconds.
- A page that failed one time is tried again when it is wanted again: **tested**.
- Also tested: the page picture is released after it is sent.

### Manual check (needs the browser and the Mac text reader)

1. Open a scanned PDF of many pages in the reader.
2. Count the `POST /ocr` lines in the voice server log for the first 10 seconds. Expect at most 3 lines before the read-in moves to the next page.
3. Stop the voice server and open a scanned PDF. Expect a "no text found" message within 60 seconds.
4. Start the server again and go back to that page. Expect the page text to come.

### Test run

`node --check extension/pdf/ocr.js`: no error. `./run-tests.sh`: Python tests PASS. Node tests FAIL, but only in `tests/node/pdf-said-right.test.mjs` (8 tests: speech rewrite, hyphens, ligature votes). That file is the other agent's work in progress in extract/lexicon/speech; I did not touch it. All 6 tests in `scanned-pages.test.mjs` pass.

### Left for other tickets

- No change was necessary in `app.js`, `extract.js` or `voice-server.py`.
- Rotated scanned pages (finding 14) stay as they are; that is another ticket.
- The reader can ask a failed page again many times while the voice server is stopped. Each request fails at once, so this is not a load problem.

### Review round 2 (7 risks from the reviewer)

All 7 were true. Each has a test in `tests/node/scanned-pages.test.mjs` (now 10 tests). The tests for risks 3, 1, 2 and 4 failed before the change. The test for risk 5 passed already; it now guards the behaviour.

1. **The picture and the PNG had no time limit: repaired.** `recognize(page)` now races the whole recognition of one page (`recognizeNow`: picture, PNG, request, answer) against a timer of 60 seconds that starts when the page's turn comes. After the limit, the drawing is cancelled (`cancel()` of the pdf.js render task), the request is aborted, and the queue goes on. The canvas is released in a `finally`, also after a failure. Test: "a page picture that is never drawn does not hold the queue".
2. **One queue for each `withOcr()` call: repaired.** The queue (`queue`, `inTurn`) is now in the module, one for all books. A job of a closed book is skipped when its turn comes, and a closed book gives no message and no read-ahead. The sign is `doc.loadingTask.destroyed`: pdf.js 4.10 (`extension/pdf/vendor/pdf.mjs`, `PDFDocumentLoadingTask.destroy`) sets it when app.js calls `old.destroy()`. No change in app.js is necessary. Test: "a closed book sends no more pages".
3. **A page that waited got a false message: repaired.** The rule stays: a message within 60 seconds of the ask (a timer for each page in `readPage`). The text is now true. A page that never went to the voice server says "it waited 60 seconds behind other pages". A page whose request started says "no text after 60 seconds". A page whose own recognition ran out says "text recognition took more than 60 seconds". A page that gave up is skipped when its turn comes, so it sends no late request. Test: "a page in the queue also gives its message within 60 seconds".
4. **Read-ahead asked failed pages again: repaired.** `readAhead(n)` runs only for a wanted page that is a scanned page (set `scanned`). It does not ask a page that is in the cache or in the set `failed`. A failed page is tried again only when the reader wants that page itself (`textOf(n)` with `ahead = false`). Test: "a read-ahead page that failed is not asked again by read-ahead".
5. **Test: the queue goes on after a request with no answer: added.** The server is silent for the first request and answers the next. Page 2 is asked and its text arrives.
6. **Test "10 seconds": changed.** It uses fake timers, moves the time forward 10,000 ms in steps of 500 ms, and checks that only pages 1, 2 and 3 are asked.
7. **Test: retry of a failed read-ahead page: added (in the test for risk 4).** Page 2 fails as a read-ahead page. Then `getPage(2).getTextContent()` sends a second request, and its text arrives.

Test fakes: each fake page writes its number into the canvas, so the fake PNG says which page was sent.

Test run of round 2: `node --check extension/pdf/ocr.js` gives no error. `node --test --test-timeout=120000 tests/node/scanned-pages.test.mjs` gives 10 pass, 0 fail. `./run-tests.sh` now ends with "Python tests: PASS", "Node tests:   PASS", "RESULT: PASS".
