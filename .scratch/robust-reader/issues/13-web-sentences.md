# 13. Web pages: sentences are cut correctly

GitHub issue: #14
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Move the sentence cutting of the web-page reader to code that a Node test can load. Then repair: a long run with no space, 'et al.' and other short forms and initials, text divided by line breaks, a selection inside skipped areas, and a skip class on the body element.

Evidence: audit/web-page-and-library.md findings 1, 7, 8, 9, 10. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] A run of 600 characters with no space gives at most 3 pieces, not 600.
- [ ] 'Smith et al. reported that' is one sentence; 'J. R. Smith' is not cut.
- [ ] 'end.<br>Next' gives 'end.' and 'Next' as separate words.
- [ ] Listen on a selection inside a code block or a side box reads it.
- [ ] A page with `cookie-consent-active` on its body is read.
- [ ] Node tests for each case pass.

## Blocked by

- 02 (test-bench)
