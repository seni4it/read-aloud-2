# 26. Web-page player: leftovers after the Chrome check

GitHub issue: none yet
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Three faults of the player bar on web pages (`extension/content.js`, `extension/content.css`) are left after the checks in a real Chrome on 10 Nov 2026.

1. The first Sentence of a web reading shows as several short Sentences. The sentence shade covers only a few words, the count goes up inside one Sentence, and Previous during the second Sentence goes to the last piece of the first Sentence, not to its start.
2. Follow does not move the text when the text is in a scrolling box inside a shadow root, or in a scrolling box inside another scrolling box. The nearest box that scrolls must move, also across a shadow root, and each outer box (and the window) must then show the word.
3. `extension/content.css` holds raw colour values for the Word highlight and its Sentence shade. It must use the design tokens (`--color-word`, `--color-on-word`, `--color-sentence` of `extension/pdf/tokens.css`), with the token values as fallback, because a web page does not load the token file.

Also noted: a very fast flick that leaves the bar before the pointer moved 6 px starts no drag of the player bar (ticket 25, open points). It stays as it is: see the Work report.

## Acceptance criteria

- [x] The voice still gets the first Sentence in two pieces, so the voice starts at once.
- [x] The shade covers the whole Sentence while each piece is read; the count counts the Sentence once.
- [x] Previous goes to the start of the Sentence before; Next goes to the next Sentence, past the pieces.
- [x] Follow scrolls a box in a shadow root, a box around a shadow host, a box that shows the text in a `<slot>`, and each of nested boxes.
- [x] content.css uses the three tokens, under our own names `--ra2-color-word`, `--ra2-color-on-word` and `--ra2-color-sentence`, with fallback values equal to tokens.css; no raw or named colour outside a fallback.
- [x] Node tests cover each point.
- [ ] Checked in a real Chrome (steps below).

## Blocked by

- 24 (web-page player design)
- 25 (web-page player: the owner can move it)

## Work report

Date: 10 Nov 2026. Status: done in code and Node tests. A check in a real Chrome is still needed; this run had no browser.

### Fault 1: the first Sentence in short pieces

Cause. `start()` gives the voice the first 4 or so words of the first Sentence alone, for a fast start (`quick()`), and the rest as a second piece. After a short title (fewer than 6 words) it does the same with the next Sentence. These pieces went into the list of Sentences as Sentences of their own. So the shade covered one piece, the count went from 1 to 2 inside one Sentence, and Previous and Next counted the pieces. This is the note in `.scratch/robust-reader/chrome-checks-2026-11-10.md` ("One Previous pressed during sentence 2 went to the last piece of sentence 1").

What I also looked at, from the code, and did not change: a title or heading with no end mark (it is its own block, so its own Sentence, which is correct); inline elements (`blockOf` keeps `inline`, `inline-block` and `contents` in the block); initials and short forms (`isAbbr`, covered by the tests of ticket 13). Two other causes are possible on real sites but were not seen in a check, so I did not change them: a floated or positioned first letter (a drop cap: Chrome gives it the display `block`, so the letter would be its own block), and an initialism with dots such as "U.S." in the middle of a sentence (it ends the sentence now). If the Chrome check shows one of them, it needs its own ticket.

What changed.
- `extension/content.js:169` (`quick()`): each piece keeps its whole Sentence in `of`. The voice gets the same pieces as before.
- `extension/content.js:242` (`play()`): the Sentence shade covers the whole Sentence (`seg.of`), also during each piece.
- `extension/content.js:399-402`: `same()`, `headOf()`, `back()` and the new `next()`. Previous goes to the first piece of the Sentence before (the first Sentence starts again). Next goes past the pieces of the present Sentence. The Next button (line 602) and the "forward" command (line 339) use `next()`.
- `extension/content.js:581` (`ui()`): the count and the progress line count Sentences; the pieces of one Sentence count once.

### Fault 2: Follow in a shadow root and in nested boxes

Cause. `scroller()` went up with `parentElement` and stopped at the first box that scrolls. At the top of a shadow root `parentElement` is null, so the search ended there and the window was used. Text from the page that a component shows in a `<slot>` went up through the page, not through the box of the component. With a box in a box, only the nearest box moved, so a word in an inner box that was itself out of view stayed out of view.

What changed.
- `extension/content.js:264` `up()`: the next box up is the `<slot>` of the node (`assignedSlot`), else `parentElement`, else the host of its shadow root (`getRootNode().host`).
- `extension/content.js:265` `scrollers()` gives every box around the text that scrolls, the nearest first. It is found once for each Sentence, as before (line 234, `S.boxes`).
- `extension/content.js:256` (`mark()`): the word is out of view when it is outside the part of the window that each box also shows.
- `extension/content.js:275` `bringIntoView()`: each box, the nearest first, then the window, that does not show the word moves it to 40% of its height. Each box uses the place of the word after the boxes inside it moved. The target button (line 609) also moves the nearest box when it shows the word, as before.

### Fault 3: raw colours in content.css

Cause. content.css was older than the tokens of ticket 20 and 24, and the token test leaves it out on purpose.

What changed (first version; the review repairs below changed the names to `--ra2-color-…`). `extension/content.css:4-5`: the Sentence shade is `var(--color-sentence, rgba(255, 140, 0, 0.18))`; the Word highlight is `var(--color-word, #ff8c00)` with the text `var(--color-on-word, #0f172a)`. The text on the word was `#111111` before; it is now the token value. A page has no such custom properties, so the fallback values are used; they are equal to tokens.css, and a test checks that.

### The small drag point

A fast flick that leaves the bar before 6 px does not drag, because the bar captures the pointer only after 6 px. A capture at the press would send the click of a short press to the bar, not to the button, so play would stop working. This is not a one-line change, and it stays as it is.

### Tests added (tests/node/web-player-leftovers.test.mjs, 15 tests)

- the voice still gets the first Sentence in two pieces, for a fast start
- the shade covers the whole first Sentence while each of its pieces is read
- the count shows Sentences, not pieces: 1 / 3 for both pieces of the first Sentence
- Previous during the second Sentence goes to the start of the first Sentence, not to its last piece
- Previous in the second piece of the first Sentence starts that Sentence again
- Next in the first piece goes to the next Sentence, not to the second piece
- after a short title, the next Sentence is in pieces for the voice, and one Sentence for the owner
- text in a shadow root: Follow scrolls the scrolling box in the shadow root, not the window
- text in a shadow root of a part of the page that sits in a scrolling box of the page: Follow scrolls that box
- a scrolling box in a shadow root that holds the page text in a `<slot>`: Follow scrolls that box
- nested scrolling boxes: the inner box shows the word, and the outer box brings the inner box into view
- nested scrolling boxes: a word out of the inner box moves the inner box, then the outer box
- a scrolling box below the window: the box shows the word, then the window shows the box
- content.css: the Word highlight uses `--color-word` and `--color-on-word`, the Sentence shade `--color-sentence`, each with the token value as fallback
- content.css: no colour value outside a var() fallback

Before the repair 12 of the 15 failed. The 3 that passed guard what stays: the two pieces for the voice, Previous in the second piece, and a box in the same shadow root as the text. After the repair: all node tests pass (457 of 457).

### Open points

- (Closed in the review repairs: content.css now uses names with our prefix, `--ra2-color-…`.)
- The voice may make a short pause between the two pieces of the first Sentence. This is in the sound page, not in content.js, and was not changed.

### Check in a real Chrome (step by step)

1. Reload the add-on in chrome://extensions.
2. Open an article with a title and a long first sentence. Press the round Listen button. The shade covers the whole first Sentence while the voice reads it, and the count stays "1 / n" until the next Sentence.
3. During the second Sentence press Previous. The reading goes to the first word of the first Sentence. Press Next twice. Each press moves one Sentence.
4. Open a page whose text is in a component with a shadow root and its own scrolling box (a web component reader, or a made page with `attachShadow` and `overflow: auto`). Let it read past the bottom of the box. The box moves with the voice; the window does not.
5. Open a made page with a scrolling box inside a scrolling box, where the inner box starts below the view of the outer box. Let it read into the inner box. The outer box moves so that the word shows.
6. In DevTools, look at the Word highlight: orange `#ff8c00` with dark text, and a light orange shade on its Sentence, in light and in dark mode, on a site with no Read Aloud tokens.

### Review repairs (10 Nov 2026)

The review found 7 points. Each has a test first, in tests/node/web-player-leftovers.test.mjs. The fake scrolling box now has a `scrollTop`, and the fake page counts style reads and keeps every message to the add-on.

1. A box at its scroll limit. `bringIntoView()` took it that each box moves the full distance. A box near its end moves less, so the word place for the next box and for the window was wrong. Now the distance is limited to what the box can move (`-scrollTop` up to `scrollHeight - clientHeight - scrollTop`), and a box that cannot move is not asked to move (`extension/content.js:283-286`). The window then does the rest. Tests: "a box at its scroll limit moves only what it can; the window then brings the word into view" and "a box that is scrolled to its end does not move up past its start".
2. The target button with nested boxes. Test: "the target button with nested boxes and the word in view: the nearest box moves the word to its 40% line; the outer box and the window stay". It passed before the change, and it guards the behaviour now.
3. The style reads. `scrollers()` read the style of each box around the text for each piece. Now the boxes are found once for each block and kept while the next pieces and Sentences are in the same block (`extension/content.js:234-236`, `S.boxesOf`; cleared in `idle()`). The comment says this now. Test: "the boxes are found once for a block: the second piece of a Sentence reads no style".
4. Test: "a box with overflow hidden is not scrolled: the window moves". It passed before the change. The box-limit tests are in point 1.
5. The colour test now also finds a named colour: each value outside a var() fallback must be empty. Tests: "content.css: no colour value outside a var() fallback, also no named colour" and "the colour test sees a named colour" (a check of the check).
6. Pause and resume in the first piece. Tests: "pause in the first piece, then resume with the Mac voice: only the rest of that piece is said; one shade, count 1 / 3" (the Mac voice says "long sentence", then the second piece) and "pause in the first piece, then resume with the natural voice: the voice goes on, nothing new is said; one shade, count 1 / 3". Both passed before the change.
7. Our own names. content.css uses `--ra2-color-sentence`, `--ra2-color-word` and `--ra2-color-on-word` (`extension/content.css:6-7`), each with the value of its token in tokens.css as fallback. So a page with its own `--color-word` cannot change our marks. content.js does not set these names (its TOKENS block has none of them), so there is nothing to keep in step there. The test checks the new names and the fallbacks.

Counts: before the repairs 4 of the 23 tests in this file failed (box at its limit, twice; style reads; the names). After the repairs all node tests pass: 469 of 469.

### Chrome check repairs (10 Nov 2026)

The real Chrome check had one FAIL: on a page whose text is in a scrolling box inside an open shadow root, Listen said "Finished." at once, with no count and no Word highlight. Text shown through a `<slot>` and nested boxes passed.

Cause. `collect()` found the text with a TreeWalker over the page. A TreeWalker does not go into shadow roots, so the text in the shadow root was never found. The later steps had three more gaps for such text. The `::highlight()` rules of content.css style only the text of the document, not the text in a shadow root. The caret under a click was asked without the shadow roots, so Chrome gives the host and not the word. A link in a shadow root was not seen as a link, because the click target is the host.

What changed (extension/content.js).
- Lines 93-136: `textsIn()` walks the page in the order that it shows. It goes into each open shadow root (`element.shadowRoot`) at the place of its host. A `<slot>` gives the nodes that it shows (`assignedNodes({ flatten: true })`), not its fallback text. The light children of a host are read through its slots only. The player's own root is closed and is not entered; a closed root of a page cannot be read and is left. `skippedDeep()` applies the same skip list as before, also through the host chain, so a shadow root inside a nav of the page stays out. The filter of the walker collects the nodes itself, because only the filter is asked in tree order at the place of a host.
- Lines 166-175: the shadow roots that were read are watched too, so a change in them makes the kept Sentences again.
- Lines 39-55 and 304: when a Sentence in a shadow root is read, the same `::highlight()` rules go into that root as one adopted style sheet (no element is added to the page, so no page observer sees a change, and a style rule of the page's CSP does not block it). The sheet is added once for each root. It is removed when the reading ends (`idle()`, line 367) and when the add-on is gone (line 265). The page's own sheets in that root stay.
- Line 484: the token block now also holds `--color-word`, `--color-on-word` and `--color-sentence`, because the rules of the adopted sheet are made from it (line 39) and content.js may hold colour values in that block only. The test of ticket 24 checks these values against tokens.css; the new test checks that the sheet text equals content.css.
- Line 443: the caret under a click is asked with the open shadow roots of the reading (`caretPositionFromPoint(x, y, { shadowRoots })`), so a click on a word in a shadow root starts the reading at that word.
- Line 842: the click uses the first element of `composedPath()`, so a click on a link or a button in a shadow root does not move the reading.
- Range creation and Follow needed no change: a Range can hold text in a shadow root, and `scrollers()` already goes up through `getRootNode().host`.

Point 3 of the check (each Next moved 3 Sentences, seen once in the first nested-box run): no cause was found in the code. `next()` skips only pieces of the same Sentence (`same()` needs the same `of`), and a short title has no `of`. A new test reads a page with a title, a Sentence in pieces and nested boxes, and presses Next four times: the count goes 1, 2, 3, 4, 5 of 5. The earlier FAIL 3 of the first Chrome run (Next moved 2 or 3 Sentences) came from late events of the sound page and was repaired before this ticket; the one run may have been the same kind of event. A second check must watch for it.

Tests added (tests/node/web-player-leftovers.test.mjs). The fake page now has a lazy tree walker with the DOM filter rules, `shadowRoot`, `assignedNodes()`, adopted style sheets, the caret with shadow roots, and a count of observed nodes.
- Listen reads the text in an open shadow root, in page order, and leaves out its nav and script
- in an open shadow root: the count, the shade and the Word highlight are on the shadow text
- in an open shadow root: Follow scrolls the box in the shadow root
- a shadow root inside a nav of the page is left out, as the nav is
- a slot in an open shadow root reads the nodes it shows, at the place of the slot, and not its fallback text
- the Word highlight style is added to each shadow root that is read, once, and removed when the reading stops
- the style of the page in the shadow root stays when ours is removed
- a click on a word in a shadow root jumps there: the caret is asked with the shadow roots of the reading
- a click on a link in a shadow root does not move the reading
- a change in a shadow root that was read is watched, so the kept Sentences are made again
- the Chrome check: with a title, pieces and nested boxes, each Next moves one Sentence

Before the repair 8 of these 11 failed. The nav test, the link test and the Next test passed already, and they guard the behaviour now. The existing slot test now gives `assignedNodes()`, as Chrome does. After the repair: all node tests pass, 505 of 505.

Open points.
- The "Listen from here" button that shows next to a paragraph under the pointer does not show for a paragraph in a shadow root (the pointer event gives the host). Listen, a selection, the context menu and a click on a word work.
- A closed shadow root of a page cannot be read.

What a second Chrome check must confirm.
1. The page with the text in a scrolling box inside an open shadow root: Listen reads it, the count shows, the Word highlight is orange and the Sentence has a light orange shade (the style in the shadow root), and the box moves with the voice.
2. Stop the reading: in DevTools, the shadow root's `adoptedStyleSheets` has no Read Aloud sheet left.
3. A click on a word in the shadow root during the reading starts the reading at that word. A click on a link there opens the link and does not move the reading.
4. The `<slot>` page and the nested-box page still pass. On the nested-box page press Next 5 times and count: one Sentence for each press.
5. A normal article page still reads in the same order as before.
