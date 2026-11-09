# 17. Library page: fast search and clear errors

GitHub issue: #18
Status: code done, tests pass; real browser checks open (see manual-checks.md)
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Repair the library page: stop the cover reload loop, ask the export state one time per load, show a message when an add, an import or a restart fails, and give the cover placeholder enough contrast.

Evidence: audit/web-page-and-library.md findings 17, 18, 19, 23. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] With one failing cover, at most 5 tries are made and none after the card is removed.
- [ ] Typing 5 letters with 40 books sends 0 export requests.
- [ ] A file that is not JSON gives a message. A stopped server gives a message, not 'Adding…' without end.
- [ ] The restart button can be pressed again after a failed restart.
- [ ] The placeholder contrast is 4 to 1 or more.

## Blocked by

None - can start immediately
