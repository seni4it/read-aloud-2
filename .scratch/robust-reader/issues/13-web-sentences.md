# 13. Web pages: sentences are cut correctly

GitHub issue: #14
Status: code done, reviewed, tests pass; real Chrome checks open (see Work report)
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Move the sentence cutting of the web-page reader to code that a Node test can load. Then repair: a long run with no space, 'et al.' and other short forms and initials, text divided by line breaks, a selection inside skipped areas, and a skip class on the body element.

Evidence: audit/web-page-and-library.md findings 1, 7, 8, 9, 10. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] A run of 600 characters with no space gives at most 3 pieces, not 600.
- [ ] 'Smith et al. reported that' is one sentence; 'J. R. Smith' is not cut.
- [ ] 'end.<br>Next' gives 'end.' and 'Next' as separate words.
- [ ] Listen on a selection inside a code block or a side box reads it.
- [ ] A page with `cookie-consent-active` on its body is read.
- [ ] Node tests for each case pass.

## Blocked by

- 02 (test-bench)

## Work report

Date: 9 Nov 2026. Files changed: `extension/content.js`, new `tests/node/web-sentences.test.mjs`.

### How the tests load the real code

The ticket asks to move the sentence cutting to code that a Node test can load. I did not move it. The new test loads `extension/content.js` as it is, in a `node:vm` context, with a small fake page (elements, text nodes, a simple selector match, a tree walker) and a fake `chrome`. A test asks the add-on to read (`readPage` or `readSelection`, the messages of the context menu), then sends 'end' for each sentence. It keeps the text of each 'speak' request. So the tests go through `collect`, `segments`, `cut`, `quick`, `start` and `play` with no copy of the code and no test hook.

### Findings

1. Finding 1 (content.js `cut`): confirmed. A 600-character run with no space gave 321 sentences (280 of 1 letter, then one of 320 letters). Repaired in `cut`: with no space, the cut is at MAX (280). The run now gives 3 sentences, and no letter is lost.
2. Finding 7 (content.js `ABBR`): confirmed. 'Smith et al. reported' was cut after 'al.'. 'J. R. Smith' gave 'J.' / 'R.' / 'Smith…'. 'cf.', 'pp.' and 'Eq.' were cut. 'said no. Then' was one sentence. Repaired: `ABBR` has `al|cf|pp?|Eq|Ref|Inc|Ltd|Jan|Feb|Aug|Sept?|Oct|Nov|Dec` and no `No`. A new function `isAbbr` (used in `segments`) also accepts 'No.' with a capital N only, and a single capital letter with a stop (an initial).
3. Finding 8 (content.js `collect`): confirmed. 'end.<br>Next' gave the one word 'end.Next'. Repaired in `collect`: a space is added to the block text when a `<br>` comes just before the text node inside its block (new function `afterBreak`; it also finds a `<br>` before an inline element such as `<span>`). The `at` offset of the part is read after the space, so the word highlight stays correct.
4. Finding 9 (content.js `collect`): confirmed. A selection inside `pre` or `aside.infobox` gave "No text to read here." Repaired: with a range, `collect` skips only `script,style,noscript,template,ra2-root`. Whole-page reading keeps the full skip list (tested).
5. Finding 10 (content.js `collect`): confirmed. `cookie-consent-active` on body matched `[class*="cookie"]`, so no text was read. Repaired with the new function `skipped(el, sel)`: a match on `<body>` or `<html>` does not count. A cookie bar inside the page is still left out (tested). The same function is used in the mouseover handler of the "Listen from here" button, because the same class on body hid that button on the whole page.

### Acceptance criteria

- A run of 600 characters with no space: tested (3 sentences).
- 'Smith et al. reported that' is one sentence; 'J. R. Smith' is not cut: tested.
- 'end.<br>Next': tested.
- Listen on a selection inside a code block or a side box: tested (`readSelection` with a fake selection).
- A page with `cookie-consent-active` on its body: tested.
- Node tests pass: `./run-tests.sh` gives `RESULT: PASS` (14 new tests).

### Known limit

A single initial in the middle of a sentence ('by J. Smith') is now cut after 'J.'. The text cannot show the difference from 'vitamin C. Then', so the review repair (item 2 below) keeps the sentence end in both cases.

### Manual check in a real browser

1. Load the add-on from `extension/` in Chrome (Developer mode, Reload).
2. Open a page with a long URL in its text (more than 300 characters with no space). Press the Listen button. The voice reads the URL in at most 3 pieces, not letter by letter.
3. Open a paper page with 'et al.' and initials. Press Listen. 'Smith et al. reported' and 'J. R. Smith' are read with no stop and the sentence shade covers the whole sentence.
4. Open a poem or an address with `<br>` lines. Press Listen. Each line ends with a pause, and the word highlight is on the correct word after each line break.
5. Select text in a code block (for example on a documentation page) and press the Listen bubble. The selection is read.
6. In DevTools, add the class `cookie-consent-active` to `<body>`. Press Listen. The page is read, the cookie bar (if any) is not read, and the "Listen from here" button still shows on paragraphs.

### Left for other tickets

- Findings 2, 3, 4, 11, 12, 13, 16, 22, 25 (content.js) belong to tickets 14, 15, 24 and 25. I did not change them.
- Findings 5, 6, 14, 15, 24 are in `background.js` / `offscreen.js`. No change was necessary for this ticket.

### Review repairs (9 Nov 2026)

Tests first: each item below got a test that failed, then the repair. The new tests are in `tests/node/web-sentences.test.mjs` (23 tests in all).

1. Months and state codes: confirmed. With the `i` flag, 'al' and 'ca' matched 'AL.' and 'CA.', and 'Dec.' always joined the next sentence. Repaired in `isAbbr` (content.js): `al`, `ca` and `No` match only as written ('et al.', 'ca. 1900', 'No. 5'). A month ('Jan', 'Feb', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec') joins only when the next piece starts with a digit. Tests: 'Montgomery, AL. Next', 'Fresno, CA. Next', 'ca. 1900', 'Dec. 5', 'born in Dec. Then'. While I wrote the month test, I found that a test sentence with 8 words or more can pass because `quick` splits it. The test sentences are now shorter than 8 words.
2. Single capital letters: confirmed. 'Grade A. Next' was one sentence. Repaired in `isAbbr`: a capital letter with a stop joins only when the sentence so far is only initials ('J.'), ends in two initials ('J. R.'), or the next piece is an initial. Tests: 'Grade A. Next', 'vitamin C. Then', 'J. R. Smith wrote it', 'Written by J. R. Smith today'.
3. Selection across a skipped area: confirmed. A selection from one paragraph to another read the nav between them. Repaired in `skipped(el, sel, range)` (content.js): for a selection, a skipped area is read only when it holds the start or the end of the selection. Script, style, noscript, template and the player stay out always. `collect` no longer has its own short skip list. Tests: a selection across a nav (the nav is not read), and a selection that starts in a code block and ends after it.
4. The space after a `<br>` and the word highlight: not a fault. In `rangeOf`, an offset in the gap goes to the start of the next text node, and an end offset on the end of a text node stays in that node. The tests now give the add-on a fake `Highlight` and read the ranges. After 'It is the end.<br>Next line here.', the word highlight is on 'It' and then on 'Next', and the sentence shade covers each sentence. In 'First line<br>second line.', the word highlight goes to 'line' and then to 'second' (with 'times' and 'tick' events). No change to the code.
5. `<br>` with a space text node between: confirmed. 'end.<br> <span>Next</span>' gave 'end.Next'. Repaired in `afterBreak`: text nodes that hold only spaces, and comments, are not counted as siblings. Test added.
6. The fake selector match: confirmed. It returned false for a selector it did not understand. Repaired in the test file: `matchesOne` throws on a selector it does not understand, and `matches` reads every selector of a list (not only up to the first match). Every selector of the real skip list is now read on each `closest` call, and all tests pass, so the fake understands the whole list. The test `selection()` helper now also gives the correct common ancestor for a selection across blocks.

Manual check in a real browser, added:
7. Select from one paragraph, across a site menu, to the next paragraph, and press Listen. The menu is not read.
8. Read a page with 'Grade A.' or a state code ('Fresno, CA.') at a sentence end. The voice stops there, and the next sentence is shaded alone.
