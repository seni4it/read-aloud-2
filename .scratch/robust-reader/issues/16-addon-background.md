# 16. Add-on background: no lost events, no wrong owner, safe self-update

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Repair the background part of the add-on: report an error to the tab when the sound page does not answer; accept events only from the tab that owns the voice; decide 'a reader is open' by asking the browser; give the requests to the voice server a time limit; send events to add-on pages only when an add-on page is the speaker.

Evidence: audit/web-page-and-library.md findings 5, 6, 14, 15, 24. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] With the sound page closed, play shows an error and not a silent 'playing' state.
- [ ] Tab A stopped, tab B reads: tab A never takes the voice back.
- [ ] With a reader tab open for 5 minutes, the self-update does not reload the add-on.
- [ ] A voice server that accepts and then waits gives the Mac voices after 2 seconds.
- [ ] A web tab that reads sends no tick event to other add-on pages.

## Blocked by

None - can start immediately
