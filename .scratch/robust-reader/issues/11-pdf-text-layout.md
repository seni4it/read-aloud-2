# 11. PDF text: line size, rotated pages, rows, speed

GitHub issue: #12
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Take the size of a line from most of its characters, not from its first item. Read rotated pages in the correct sequence. Group items into rows by the real distance, not by fixed steps. Limit the gap search on one-column pages. Remove the regex that can run without end. Make the ligature search cheaper for words that are not damaged.

Evidence: audit/pdf-text.md findings 8, 12, 13, 14, 15, 19. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] A line with a drop cap is body text, not a heading.
- [ ] A page with rotation 90 reads its lines in sequence.
- [ ] Two items at y 4.99 and 5.01 are one line.
- [ ] A made paragraph '(Fig. 1-2-3-…-25' with no closing sign is handled in less than 50 ms.
- [ ] Reading in a 300-page book is not slower than before (time written in the ticket result).
- [ ] The comparison check shows no sample that reads worse.

## Blocked by

- 10 (pdf-text-said-right)

## Note from ticket 09

`learnRepeatedLines` takes the first 3 and the last 3 lines of each sample page. On a page with fewer than 6 lines, one line is in both groups and is counted twice, so it can be removed as a running head from one page alone. Repair it here, with a test.

## Work report

Date: 9 Nov 2026. Tests: `tests/node/pdf-layout.test.mjs` (30 tests after review round 1, made lines only, and the new public sample `rotated.pdf`). The tests marked "guard" pass with the old code too; every other test failed with the old code (checked by running the same test file against the committed `extract.js` and `lexicon.js`).

### Findings of the audit

- **8 (line size from the first item): confirmed, repaired.** `makeLine` took `size` from `entries[0]`. New `lineSize()`: the size that sets the most letters. A line keeps `first` (the size of its first item); `addPage` compares the main size of the last line with `first` of this line, so a line that holds two sizes (the end of a sentence in body type, then a note in small type) does not break its sentence. Tests: drop cap, "most of its characters", "16 mm. (Note ...)" (guard).
- **12 (ligature search speed): confirmed, repaired** (`lexicon.js`). An unknown 12-letter name cost about 6 ms (all insertions, then all pairs of insertions); ambiguous words were searched again at each occurrence. Now the insertions go from left to right and stop at the first place where no word of the list starts with the text before it (binary search in the sorted list, which `loadLexicon` keeps; `lexicon.txt` is already sorted). The set of words found is the same as with the full search. The letters found for a word are kept in `searched` (cleared by `resetRepairs()`). 40 unknown names: 236 ms before, 11 ms after.
- **13 (gap search on one-column pages): confirmed, repaired.** The "one-sided row" loop ran a gap search from every one-sided row. Now only where a run of one-sided rows starts, and 3 times at most. A made page of 300 short lines: 180 ms before, 17 ms after (test limit 40 ms).
- **14 (rotated pages): confirmed, repaired.** New `uprightItems()`: the direction of most characters, in quarter turns, is turned back on every item, and the page width is measured along the lines (from `viewport.viewBox`). A page of upright text is not changed. Tests: a made /Rotate 90 page, and the new public sample `rotated.pdf` (made by `make_samples.py`, read by the real pdf.js). Not done: `ocr.js` gives its items an upright matrix in the unturned sheet, so a scanned page with /Rotate 90 is still mixed; `ocr.js` must give the items the page's turn (other ticket).
- **15 (rows in fixed 2pt steps): confirmed, repaired.** Rows are now made by the distance from the row's baseline: within 0.15 of the type size (a bullet sits 1pt above its 8pt text), or for a subscript (smaller, a little below, right next to a letter of the row) within 0.4 of the row's size. A superscript stays apart, as before. A first try with a plain 2pt distance made a two-column figure read line across line and glued note signs to words; this rule came from the comparison check. Tests: 4.99 / 5.01, two lines 10pt apart (guard), subscript and superscript.
- **19 (regex without end): confirmed, repaired.** "(Fig. 1-2-3-...-25" took 4.1 s; now under 1 ms (each number is taken whole with `(?=(...))\1`). The author-year regex had the same fault ("[A-Z]?[A-Za-z]*" has two ways to match a name): 20 names with no closing bracket took 192 ms; now under 1 ms. Guards: the usual figure references and author-year citations are still left out.
- **Note from ticket 09 (`learnRepeatedLines`): confirmed, repaired.** Each sample page now counts a line once. Test: a page of 2 lines no longer makes its own lines running heads; a line at the top of 4 pages still is one (guard).

### Repairs for the comparison check

Each of these came from a sentence that read worse after the repairs above; each has a test.

- A printer's slug ("file.qxp date time Page N") is not read (`SLUG`). One book had its slugs learned as running heads only through the double count.
- The first page of the index, under a big heading "Index", is skipped like a contents page. Its rows now group a little differently, and it fell under the half of lines that end in a page number.
- A folio in small Roman numerals ("xiv Preface") is a page header (`RUNNING`).
- In a table, a bullet starts a cell (`cellsOf`): bullets now share their text's row. A short line (under 40 letters) inside the table's area is a table line too (a cell's second line).
- A gap that another page uses is not taken when 3 rows in 4 of this page run across it (a one-column page whose header row has the page number and the title far apart was split there).

### Comparison check

Before the work: every sample read as its reference. After: public samples all "same"; `rotated.pdf` is new (reference written with `READ_ALOUD_SAMPLES` pointed at an empty folder). Private books (3), changed sentences (a block of changed lines counts as its larger side):

- Book of about 240 pages: see Review round 1 (the first count here was wrong: it called 6 lost body blocks "captions skipped").
- Book of about 290 pages: 153 better, 23 same, 0 worse. Better: 73 sentences no longer broken in the middle by a change of type size at a line start (bullets, small capitals), many sentence ends no longer moved to the end of the page by a wrong column gap, 4 words with a line-end hyphen now joined, running heads and Roman folios no longer read inside sentences, loose table words no longer read. Same: table and glossary pages read in another order, list items as separate sentences, 3 words of a screenshot.
- Paper of 14 pages: see Review round 1.

### Speed (best of 3 runs, the same machine, `sentencesOf`)

- Book of about 290 pages: 3315 ms before, 815 ms after.
- Book of about 240 pages: 1079 ms before, 373 ms after.
- Paper of 14 pages: 685 ms before, 122 ms after.
- Made book of 300 pages in the test: about 110 ms (limit 3 s).

### Files changed

`extension/pdf/extract.js`, `extension/pdf/lexicon.js`, `tests/node/pdf-layout.test.mjs` (new), `tests/pdf-text/make_samples.py` (new sample `rotated.pdf`; the other samples are written byte for byte as before), `tests/pdf-text/samples/rotated.pdf`, `tests/pdf-text/reference/rotated.txt`, this file.

### Left for other tickets

- `ocr.js`: items of a scanned page with /Rotate 90 need the page's turn in their matrix (see finding 14).
- A drop cap whose baseline is on the third line (the letter in a row of its own beside lines 1 to 3) still joins line 3; only a raised cap on the first line is handled.
- "word-" at a paragraph end when the paragraph breaks right after the hyphen; `~ ^ |` reaching the voice: not about layout, not changed.
- `speech.js`: 1000 said "ten hundred" (the year rule), not changed here.
- Running heads at body size that do not repeat on the sample pages, and table text that is not marked as a table, are still read in places, as before.

### Review round 1

Tests first: 8 new tests in `tests/node/pdf-layout.test.mjs`, all with made text. Each failed before its repair, except "caption skip off" (a guard) and the single-letter note and the layout-file line, which failed only with the round-0 rules (the old code passed them).

1. **Small caption skip took body text: confirmed, repaired.** A caption in small type skipped every next line of the same size. Now a label alone on its line ("Fig. 70") is the whole caption, and a caption with text ends at its first sentence end, at a change of size, or at a gap wider than a line. Tests: small body paragraphs below a lone label are read; a two-line small caption ends at its full stop and the small text after it is read; with the caption skip off nothing is dropped (guard). Of the six blocks named in the review, five are back (the paragraph on page 75 and the four small paragraphs on page 111). The sixth is not body text: it is the end of the first sentence of a caption that starts on its own label line ("Fig. 107 ..."). With the caption skip on, it is skipped as designed. With the skip off, it is read (checked: 1 occurrence, as in the reference).
2. **"Index" heading: confirmed, repaired.** The heading counts only when the page looks like an index: 8 or more other lines, and 40% or more of them end in a page number or a page range. It no longer sets `inContents`. The contents page number at a line end is now a number or a lowercase Roman numeral of 2 letters or more (no `i` flag). A page goes on from a contents page only when its median line is 45 letters or less, because body text can end a line in a year. Tests: a mid-book section named "Index" keeps its body; a body page after an index page is read (it failed with the old code too).
3. **One table box per page: confirmed, repaired.** There is now one box for each table: a row of text (a sentence end, or 40 letters or more) between table rows ends the box. A line that ends a sentence is never taken by a box. Test: a short body line between two tables is read. It fails with one box for the page. The review's example "Table 3 shows the means." is not used, because the caption rule takes any line that starts "Table 3", in the old code too.
4. **Single-letter Roman folio: confirmed, repaired.** `ROMAN` now requires 2 or more letters as a whole word. Test: the foot note "c Not significant ..." is read.
5. **Slug without anchor: confirmed, repaired.** `SLUG` now has to be the whole line: file name, date, time, and an optional "Page N". Test: a body line that names "book.indd" and "1:25" is read.
6. **Timing tests: repaired.** Each one now runs a job that took seconds with the old code: 25-step figure reference 4.3 s, 24 names 3.0 s, 900-row page 1.4 s, 384 names 2.0 s. The new code takes under 0.1 s for each. The limits are now 0.5 s to 1 s.

Comparison check after round 1. Public samples: all "same". Private books, changed sentences (a block of changed lines counts as its larger side):

- Book of about 240 pages: 17 better, 14 same, 12 doubtful, 0 worse, 0 body text lost. Better: 14 printer's slugs not read, 1 lost sentence recovered, 2 sentences no longer cut. Same: figure labels and table numbers in another order, and one caption sentence skipped by the setting. Doubtful: 12 sentences of small type after a figure label that stands alone on its line. They are now read, under the rule "when in doubt, read". Some of them can be caption text.
- Book of about 290 pages: 153 better, 23 same, 0 worse (no change in round 1).
- Paper of 14 pages: 25 better, 2 same, 1 doubtful (one stray figure letter now read after a figure label), 0 worse.
- The deletions against the references were all checked. They are printer's slugs, running heads, Roman folios, number tables, and figure or caption text, and sentences that moved to their correct place. No body sentence is lost.
