# 11. PDF text: line size, rotated pages, rows, speed

GitHub issue: #12
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Take the size of a line from most of its characters, not from its first item. Read rotated pages in the correct sequence. Group items into rows by the real distance, not by fixed steps. Limit the gap search on one-column pages. Remove the regex that can run without end. Make the ligature search cheaper for words that are not damaged.

Evidence: audit/pdf-text.md findings 8, 12, 13, 14, 15, 19. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] A line with a drop cap is body text, not a heading.
- [ ] A page with rotation 90 reads its lines in sequence.
- [ ] Two items at y 4.99 and 5.01 are one line.
- [ ] A made paragraph '(Fig. 1-2-3-…-25' with no closing sign is handled in less than 50 ms.
- [ ] Reading in a 300-page book is not slower than before (time written in the ticket result).
- [ ] The comparison check shows no sample that reads worse.

## Blocked by

- 10 (pdf-text-said-right)
