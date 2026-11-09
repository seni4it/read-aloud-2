# 12. Scanned pages: read ahead 2 pages only, with a time limit

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Stop the chain reaction where each scanned page starts the pages after it. Recognise one page at a time. Read ahead at most 2 pages from the page that is wanted. Give the request a time limit of 60 seconds and try a failed page again later. Release the page picture after it is sent.

Evidence: audit/pdf-text.md findings 1, 10. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] Open a scanned book of 300 pages: at most 3 recognitions are asked in the first 10 seconds (counted in the server log or with a Node test of the queue).
- [ ] A stopped voice server gives a message after at most 60 seconds.
- [ ] A page that failed one time is tried again when it is wanted again.

## Blocked by

- 02 (test-bench)
