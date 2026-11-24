# 34. PDF text: small losses found in the owner's one-column book

Status: done in code (commit c5497b9), tests pass; the owner's check by ear in Chrome is open
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Found while ticket 33 was built, on the owner's private sample `Mastering_Rotary_Endodontic_Instrumentation.pdf` (in `~/read-aloud-samples`; never in the repository). Run `node tests/pdf-text/compare.mjs` and read its text in `~/read-aloud-samples/out/`.

1. Page 1: the title line "MASTERING ROTARY" is not read; only "ENDODONTIC INSTRUMENTATION" is.
2. Page 4: the label cell "[Current recommendation / IFU]" loses its second line "/ IFU]".
3. Full-page tables of 3 or more columns (pages 51, 82, 172, 207, 236, 276, 285) still split at a column gap. With "Skip tables" on they are skipped, so the owner does not hear them. With "Skip tables" off they read column by column. Decide with a test whether `withTables` should read them row by row.

Each item is a claim: confirm it in the code first.

## Acceptance criteria

- [x] A test for each item that fails on the old code.
- [x] The comparison check shows no sample that reads worse.

## Blocked by

None.

## Work report

Date: 24 Nov 2026. Commit c5497b9 (branch `worktree-agent-a0fe27858ba80df7f`).

### Findings

1. Page 1, "MASTERING ROTARY": confirmed. The line reached the builder. `isImageLabel` took it for a label on a photograph (short, all capitals, two words). That test came before the heading test. So the title lost its first line.
2. Page 4, "/ IFU]": confirmed. The line was a table cell. `isImageLabel` dropped it too ("IFU" is all capitals).
3. Full-page tables: confirmed for pages 51, 82, 194, 207, 236 and 285. Each page split at a gap of its table. No line of running text crosses that gap, so the one-column rule of ticket 33 let it pass. Page 172 did not split. It was already read row by row.
4. The claim "with Skip tables on they are skipped" is only partly true. "Skip tables" leaves out only the lines that sit at one height with 2 other short cells. The other lines of the table were read, column by column. On page 172 a line was left out of a sentence ("needs a minimal specific pressure. If").
5. Page 276 still splits. Its lower table (the formula sheet) has only short cells. withTables does not take a table without a cell line of 30 letters.

### Changes (all in `extension/pdf/extract.js`)

- `DocumentBuilder.addPage`: a line in big type (1.6 times the body or more) or a table cell is never a label on a photograph. Labels on photographs in body type are still left out.
- `readPage`, `withTables`, `goesOn`: a cell line with a bracket that is still open goes on in the line below. A line that starts with "/" goes on too. So "[Current recommendation" and "/ IFU]" are one cell. Each cell line also records the count of columns of its table.
- `readPage`, after the gap is chosen: in a one-column book, when 80 % or more of the rows that split at the gap are rows of a table of 3 columns or more, the page is read with withTables, row by row. The gap is not kept as a known gap for other pages.
- `dropPageFurniture`: on a page of table rows, half the gaps between lines are 0. Then the leading is the line step inside a cell (the lower quarter of the gaps above 0). Before, the leading was 0, and the running head above a full-page table was read.
- README, section "A book of one column with tables": 3 lines added.

### Decision for item 3

The test shows that row by row is right. With "Skip tables" off, each part of the table is read with its meaning and its use, and the cells stay whole. Nothing reads worse in any sample. "Skip tables" itself is not changed. A full-page table now reads like the table on page 172. A table of 3 columns or more could be skipped whole or read whole with "Skip tables" on. That is a decision for the owner. A first try skipped them whole and removed about 850 lines of his book from the default reading, so it was not kept.

### Tests

- `tests/node/pdf-small-losses.test.mjs`: 6 tests. 4 fail on the old code: the big title, the cell line "/ IFU]", the full-page table with "Skip tables" off, and the order with "Skip tables" on. 2 are guards that pass on both: a label on a photograph is still left out, and a word list in two columns is still read column by column.
- `./run-tests.sh`: RESULT: PASS. Python 53 tests, Node 674 tests, 0 fail.

### Comparison check

`node tests/pdf-text/compare.mjs`: every sample reads as its reference. Before the update of the references, 2 private samples differed. Both differences were read line by line, and each one is an improvement. Then the 2 private references were updated (`--update`). The public samples, McSpadden 2007, the lecture and the JIT paper did not change.

Changes in the reference of the owner's book (`Mastering_Rotary_Endodontic_Instrumentation`), 20 places:
- Page 1: "MASTERING ROTARY ENDODONTIC INSTRUMENTATION" in place of "ENDODONTIC INSTRUMENTATION".
- Page 4: the heading "HOW TO USE THIS BOOK" is read. "[Current recommendation I F U]" in place of "[Current recommendation".
- Pages 51, 194, 207, 236, 276 (upper table), 285: the tables are read row by row, not column by column.
- About 10 cells are now whole: for example "(Chapter 15 graphs)", "(J Endod)", "(parallel with Lightspeed)", "Self-Adjusting File (S A F) (twenty ten)".
- The running head "Mastering Rotary Endodontic Instrumentation" is no longer read in 11 places, on pages with tables.

Changes in the reference of the Aulet book, 3 places: the title page ("DISCIPLINED ENTREPRENEURSHIP", "BILL A U L E T"), the heading "ABOUT THE AUTHOR", and the column head "COCA (twenty twelve)" of a table.

With "Skip tables" off (not in the comparison check), only the owner's book and 3 places of the Aulet book changed. In the owner's book the full-page tables now read row by row with each cell whole.

### Open

- The owner listens to page 1, page 4 and page 51 of his book in Chrome, with "Skip tables" off and on.
- His decision: with "Skip tables" on, should a table of 3 columns or more be skipped whole, or read whole?
- Page 276: the formula sheet (short cells) still reads column by column.
- A lone "/" between words is dropped ("[Uncertain contested]"). This is the old rule for marks between author names.
