# 35. PDF text: the owner's lecture "Choosing the File" is not read well

Status: done in code (commits 2c14044, 145f677), the second ticket review passed, 717 Node tests pass; the owner's check by ear in Chrome is open
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## The owner's report

24 Nov 2026, on the answer page `ticket-run-round-1`: "it is not reading well this file". The file: `~/Downloads/Lecture-Choosing-the-File.pdf` (a private sample in `~/read-aloud-samples`; never in the repository). He opened it in the reader of the add-on.

## What to build

A read-only diagnosis of 24 Nov 2026 ran the reader code of main with the default Skip settings (144 Sentences). The prose reads correctly. These faults remain, worst first. Each item is a claim: confirm it in the code first.

1. Page 14 and 15, table "The six canals on one page": with "Skip tables" on, the voice reads broken strings of cells in 9 short Sentences. Causes: `cellsOf` in `readPage` (extract.js) joins 2 cells when their gap is less than 2.5 type sizes, so the joined cell has 40 letters or more and the row is not a table row. On page 15 the table end has only 2 rows, and the rule `table.length >= 3` fails. `withTables` also joins columns at narrow gaps.
2. Page 11, table "The four stages on one page": rows Body and Apex are read as 8 one-cell Sentences. Cause: the same `cellsOf` join.
3. Page 9, table "The five questions on one page": the table is lost, also with "Skip tables" off. Cause: the footnote rule in `DocumentBuilder.addPage` takes small type below the body as footnotes when "Skip citations" is on; table cells (`l.cell`) are not exempt. With "Skip citations" off, the cells become headings in the contents list.
4. Page 5, the formula "tip size + (taper × distance …)": the "+" is lost (`MARKER_RUN` in `NOISE`), and the next line runs on with no pause.
5. Numbers that start with a point: "a .04 taper" becomes "a.04 taper" (`finish()`, "Drop punctuation orphaned by a strip"). The speech rewrite has no rule for ".04", "25/.06", "25/.08". 5 places.
6. Lines with no end mark run together into one Sentence: the subtitle, audience line and note on page 1, and the list of the 4 parts on page 2. Cause: `traceToSentences` cuts only at ". ! ?", and `addPage` joins the lines of a block.
7. Page references in square brackets ("[p. 36]", "[pp. 7, 15]", "[p. 64, Fig. 67]"), 47 places, are read with "Skip citations" on, and their numbers are said in 2 ways. The owner decides if he hears them (answer page `ticket-run-round-2`).
8. Contents list only: a list item becomes a section on page 2 and page 17, and the real heading "4. Which design for which stage of shaping" on page 10 is not a section.
9. Small: `STOP_SECTION` knows only "References", so the part "Reference" on page 17 is read.
10. With "Skip tables" off: the table on page 4 becomes 1 Sentence of 478 letters. Cause: the `prose` test in `withTables` reads no table row by row when no cell has 30 letters or more.

The diagnosis files (Sentences with page numbers, page pictures, scripts) are in `/Users/semion/.claude/jobs/b7a4fc9e/tmp/lecture-diagnosis/` while this job lives.

## Acceptance criteria

- [ ] A test with made lines for each item, which fails on the old code.
- [ ] The comparison check (`node tests/pdf-text/compare.mjs`) shows no sample that reads worse. The lecture reference is updated only for each improvement.
- [ ] Item 7 follows the owner's answer.

## Blocked by

- 34 (pdf-small-losses-one-column-book): both change `extension/pdf/extract.js`.

## Work report

Builder of 24 Nov 2026, in a private copy made from main 899a9e9. Each item was a claim. The code confirmed all 10. The new tests are in `tests/node/pdf-lecture.test.mjs`, with made lines only. Each item test fails on the old code and passes now. Two more tests in that file are guards: they pass on the old code too.

1. Done. A table of 6 columns in the reader:
   - `cellsOf` cuts a cell of 40 letters or more at its gaps of one type size, when the row is in a table of short cells that `withTables` found. Example: "Lemon or lime" "Needs a warm" "Deep and slow too". In side-by-side boxes of running text, the cell stays whole.
   - Two rows with 4 cells or more that line up are a table, for the end of a table on the next page.
   - A short line that ends with "?" ("or shade?") does not end the table area. The second lines of the last row belong to it.
   - When a quarter of the lines of a table are table lines, all its lines are table lines.
   - Test: "item 1: a table of 6 columns with narrow gaps, and its end of 2 rows on the next page, is skipped".
2. Done, by the same change. Test: "item 2: a table of 4 columns with a narrow first column is skipped".
3. Done. A table line in small type below the body is not a footnote. A cell of a table is never a heading. Tests: "item 3: a table in small type below the body text is read" and "item 3: a cell of a table is not a heading in the contents list". The guard test "item 3: with "Skip tables" on, the table in small type is skipped" passes on the old code too.
4. Done. A lone "+" between two words or numbers is not a mark run. The speech rewrite says "plus". A run of marks ("# # + +# +") is still not said. The formula line ends its Sentence by the rule of item 6. Test: "item 4: a formula line". Guard test: "item 4: a run of affiliation marks between names is still not said".
5. Done. `finish()` keeps the space before a point that a digit follows. The speech rewrite says ".04" as "point zero four", ".27 mm" as "point two seven millimetres", and "25/.06" and "25-.06" as "twenty-five, point zero six". A price ("$.99") and a point inside a word stay. Test: "item 5: a number that starts with a point". The words "twenty-five, point zero six" are a choice of the builder. The owner can ask for another form.
6. Done. A line with no end mark ends its paragraph in two cases. Case 1: the next line starts with a capital letter or a number, below a gap of 1.5 line steps. Case 2: the next line is a numbered list item, and a gap, a line that ends with ":" or another list item is above it. The line step is the lowest quarter of the steps between lines of one type size. Repair after the ticket review of 24 Nov 2026: no case ends a paragraph after a line that ends with a comma, a hyphen, a dash or a small word ("in", "of", "and", "the" and others). Case 1 does not end it before a figure letter (a capital alone on its line, or a capital in its own type size at the line start) or before "(1.)". This removes the 7 cuts that the review found in 3 private samples. Tests: "item 6: a subtitle, an audience line and a note with no end marks are separate Sentences", "item 6: a chapter number that wraps to the start of a line does not cut the sentence", "item 6: a lone figure letter after a gap does not cut the sentence" and "item 6: a line that ends with a comma or a small word does not end its Sentence at a gap".
7. Done, by the answer A. Page references in square brackets are a citation pattern: "Skip citations" on skips them, and off reads them. With it off, a page range is still said in words ("sixty-four to sixty-five") and a single page in digits. The voice says both as numbers. Test: "item 7: page references in square brackets".
8. Done. A numbered line set 1.2 times the body or larger is a heading at any length. A numbered line at body size with a numbered line above or below it is a list item. A heading in larger type that stops mid-sentence takes its next line in lower case, and a word cut by a hyphen is joined. The old rule cut 4 question headings of McSpadden 2007 in two. Tests: "item 8: a numbered list is not a section, and a numbered heading in larger type is" and "item 8: a numbered heading in larger type over 2 lines keeps its cut word whole". The lecture now has 8 sections, one for each part.
9. Done. `STOP_SECTION` takes "Reference" too. Test: "item 9: a part named "Reference" near the end is not read".
10. Done. In `withTables`, a grid is a table too, also with no cell of 30 letters. A grid has 3 columns and 3 rows with text in every column, or 4 columns and 2 such rows. Each cell is its own Sentence. Test: "item 10: a table of short cells is read row by row with "Skip tables" off".

Changed tests of ticket 34 (`tests/node/pdf-small-losses.test.mjs`). The old test "with "Skip tables" on, what is read of a table of 3 columns comes row by row" asked that 3 lines of its table be read. That table is now skipped whole, by the rule of item 1. Now 2 tests replace it. "with "Skip tables" on, a table of 3 columns that fills the page is skipped whole" checks that no cell of that table is read. "with "Skip tables" on, what is read of a table of 3 columns comes row by row" uses a new made table where less than a quarter of the lines are table lines. It checks that 3 lines or more are read, that some lines are skipped, and that the lines come in the order of the rows.

Comparison check (`node tests/pdf-text/compare.mjs`): the 5 public samples and the lecture read as their references. The lecture reference is updated. These private samples differ from their references, and their references are not updated:

- McSpadden 2007: no word is lost. The speech rewrite now says the numbers that start with a point (".04", "25/.06"). Some Sentences end at a paragraph gap or between list items, mostly at the labels of diagrams and at the head of a page. 4 question headings are now sections.
- Aulet: 227 words of tables and diagram labels are skipped. Before, they were read as loose words. "+" is said as "plus" in 2 places. Some Sentences end after a quotation and its name line, at "EXAMPLE" labels and at diagram labels.
- The owner's book: about 4760 words of tables are skipped with "Skip tables" on. Before, parts of these tables were read and other parts were skipped. Some short leftovers of tables are still read, as before. Some Sentences end at the lines of the contents list, at list items and at the entries of the word list.
- The JIT paper: one table row is skipped. "+" in a code line is said as "plus". 2 Sentences end at the start of a new paragraph in the related work, where a word of the old text is already lost ("...guards along interpreter" / "To our knowledge").

The builder compared the Sentence ends of each private sample with the text of the c07132e code. Every new Sentence end with no end mark was read. None of them is inside a sentence that goes on in the next line.

Left: in tables where less than a quarter of the lines are table lines, the reader still reads parts and skips parts, as before. With "Skip citations" off, the speech rewrite says a page range in words and a single page in digits.
