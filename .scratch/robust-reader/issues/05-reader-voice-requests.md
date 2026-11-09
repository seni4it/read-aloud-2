# 05. Reader: voice requests with a time limit, cancel and correct priority

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Give each request from the reader to the voice server a time limit. Cancel the request for a sentence that is no longer wanted. Ask again without the read-ahead mark when a wanted sentence was first asked as read-ahead. Correct the word highlight for the delay of the sound output.

Evidence: audit/reader-ui.md findings 6, 9, 23. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] Stop the voice server while the reader reads: a message shows in at most 30 seconds, not 'generating' without end.
- [ ] Jump 6 times fast: only the last sentence is made by the server.
- [ ] A sentence that was asked as read-ahead and is then wanted starts as fast as a direct request.
- [ ] With an output delay of 200 ms the word highlight is not ahead of the sound (unit test of the schedule with a given delay).

## Blocked by

- 01 (voice-server-robust)
- 02 (test-bench)
