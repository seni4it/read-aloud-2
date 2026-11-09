# 07. Highlights: correct click, keyboard, save sequence

GitHub issue: #8
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Repair the saved highlights: a click on a saved highlight must not start the reading; the mark button must work with the keyboard; the delete control must be reachable with Tab; two fast changes must be saved in sequence; the export must release its temporary address.

Evidence: audit/reader-ui.md findings 12, 21, 22, 25. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] Click a saved highlight: its menu opens and the reading does not move.
- [ ] Focus the mark button and press Enter: the present sentence is kept, and the play state does not change.
- [ ] Tab reaches the delete control of a highlight.
- [ ] Two changes in 100 ms: the server holds the second one.
- [ ] Node test for the write sequence passes.

## Blocked by

- 03 (reader-transport)

## Note from ticket 04 (9 Nov 2026)

Ticket 04 found a related fault in `notes.js` and `app.js`: an add or a remove of a highlight during the read-in of a new book writes the old book's highlights under the new book's key. The exact change is in the Work report of `04-reader-drawing.md` ("Review round 2", item 5). Repair it in this ticket, with a test.
