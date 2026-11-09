# 06. Speed that keeps the pitch of the voice

GitHub issue: #7
Status: ready-for-human
Type: HITL

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Today the browser plays the sound faster, and that raises the pitch. Make the voice model produce the sound at the asked speed and play it at rate 1. Add the speed to the cache key on the server and in the reader and the add-on. First make a prototype: produce the same sentence at 1.0, 1.1, 1.5, 2.0 and 3.0 and give the owner the files to compare with the present method.

Evidence: audit/reader-ui.md finding 10. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] The owner hears the comparison files and decides the speeds that use the new method.
- [ ] At a chosen speed the pitch is the same as at speed 1.0.
- [ ] Word highlights are at the correct words at each speed.
- [ ] A speed change does not make the cache grow past its limit.

## Blocked by

- 01 (voice-server-robust)
- 05 (reader-voice-requests)

## Owner

Owner: he listens and decides.
