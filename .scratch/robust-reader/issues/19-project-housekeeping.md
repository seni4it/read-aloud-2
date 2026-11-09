# 19. Project housekeeping: clean tree, current README, version

GitHub issue: #20
Status: ready-for-human
Type: HITL

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Make the working tree clean: commit the agent files, the glossary, the tests and the guide pictures; remove or ignore the old backup folder as the owner decides. Update the README for the test command and the glossary. After the last ticket, raise the version one time and write the changes list.

Evidence: answer page 'Read Aloud 2, round 1'. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] `git status` shows a clean tree.
- [ ] The README names the test command and the glossary.
- [ ] The version is raised one time for the whole run.

## Blocked by

None - can start immediately

## Owner

Owner: he decides about the backup folder and the push.

## Leftovers from other tickets (added 10 Nov 2026)

Each item is a claim of a sub-agent or a reviewer. Confirm it in the code first. An item that is real work gets its own ticket.

- Highlights, two tabs with the same library Book: each save sends the whole list and the last save wins, so an old tab can write over the Highlights of the other tab. The voice server needs a version or sequence number and must refuse an old save. The same number stops a late save that arrives after a newer one (ticket 07, reviews 1 and 2).
- Book key of a file that is not in the library: SHA-256 of the first 64 KB plus the size (`keyFor` in `extension/pdf/app.js`). Two files with the same start and size share Highlights (ticket 07, review 2).
- A PDF dropped on a library Book page still uses the library Book for the "last read" line, the audio export and Ask Claude (ticket 07).
- A failed open after the old Book is cleared: the old Book does not come back (ticket 07, review 2; open flow of ticket 03).
- `extension/pdf/speech.js` says 1000 as "ten hundred" (ticket 10).
- `extension/pdf/ocr.js` must give the items of a scanned page the page rotation (ticket 11).
- PDF text: a drop cap beside lines 1 to 3; "word-" at a paragraph end; the signs `~ ^ |` reach the voice (tickets 10 and 11).
- The audio cache size of `tts.js` (60 sentences) is not measured (ticket 05).
- A scrolling box inside a shadow DOM is not followed on a web page (ticket 14).
