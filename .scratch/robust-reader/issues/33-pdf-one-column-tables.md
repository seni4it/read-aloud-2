# 33. PDF text: a one-column book is not split at the gap of a table

Status: done in code (commit 65e7eb1), 680 tests pass; the owner's listening check in Chrome is open
Type: AFK (done); the listening check is HITL

## Parent

`.scratch/robust-reader/spec.md`

## What was wrong

The owner's words (24 Nov 2026): "it is not reading the pdfs in the correct order". His book (319 pages, one column, many tables of two columns, made by headless Chrome) was split into two columns at a table's gap on 116 pages: all the labels were read, then all the meanings, and the text under the table came out of order. The gaps of those pages also spread to other pages through the known gaps (`doc.__gutters`). A table in small type at the top of a page was dropped as a running head. His lecture PDF (17 pages) had the same fault on 5 pages.

## What was built

See commit 65e7eb1 and the README section "A book of one column with tables".

- `buildDocument` decides `doc.__oneColumn` from the sample pages (running lines in body type that cross the middle of the text block: one-column books 0.63 to 0.83, two-column books 0.02 and 0.36; limit 0.5).
- In a one-column book a page splits only at a gap that few running lines cross (`fewCross`); a known gap must pass the same test.
- `withTables` in `readPage`: a table that holds text is read row by row, each cell whole; side-by-side boxes read box by box; a contents list, a running head row and diagram labels are not tables.
- Table cells are never page furniture; each column of a table row is one paragraph.

## Acceptance criteria

- [x] `tests/node/pdf-tables.test.mjs`: 3 tests; 2 fail on the old code.
- [x] The comparison check: the private references were updated after a review (McSpadden 2007 and Aulet read better; diagram labels unchanged or reordered). The owner's book and lecture are now private samples too.
- [ ] The owner hears page 4, 7 and 9 of his book in the right order in Chrome (the add-on copy is synced; the book's tab was reloaded at 18:20).

## Follow-up

Ticket 34.
