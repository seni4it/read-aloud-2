# 15. Web pages: almost no work before the owner listens

GitHub issue: #16
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Stop the page scan and the voice warm-up that run on each page before the owner shows that he wants to listen. Watch page changes only while sentences are kept, and only inside the read area. Do not build the text of the whole page to find its language.

Evidence: audit/web-page-and-library.md findings 3, 4, 16. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] On a page with a ticking clock and no listen action, the add-on runs no page scan in 30 seconds (counted with a test hook).
- [ ] No request goes to the voice server from a tab before the pointer is on the listen button, a selection, or play.
- [ ] The first sentence after play starts as fast as before, within 0.3 seconds (times in the ticket result).

## Blocked by

- 14 (web-follow-player)
