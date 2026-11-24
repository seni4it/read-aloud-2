# 35. PDF text: the owner's lecture "Choosing the File" is not read well

Status: ready-for-agent
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
