# 07. Highlights: correct click, keyboard, save sequence

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
