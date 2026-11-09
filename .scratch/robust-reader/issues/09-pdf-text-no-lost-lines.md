# 09. PDF text: no body line is lost

GitHub issue: #10
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Stop the furniture filters from removing body text: the copyright block rule, the running-head rule, the contents-page rule. Pass a damaged page and go on. Return the correct shape when a page has no body size. Test each pair of words in the split-word repair.

Evidence: audit/pdf-text.md findings 3, 4, 5, 7, 16, 17. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] A body line that starts '150-200 patients were' or ends 'was 45' is read (unit tests with made lines).
- [ ] A page with a number table is not removed as a contents page.
- [ ] A document with one damaged page reads its other pages.
- [ ] 'the A er' is repaired to 'the After'.
- [ ] The comparison check shows no sample that reads worse.

## Blocked by

- 02 (test-bench)

## Notes from the test bench (ticket 02)

- `tests/node/lexicon.test.mjs` records the present behaviour: `repairSplit('A', 'er')` returns null, but the comment in `lexicon.js` says that it gives "After". Change that test when the repair works.
- `tests/pdf-text/extract-text.mjs` passes its own options to the extraction. Confirm that they are the same as the default switches of the reader in `extension/pdf/index.html`, and correct the script if they are not.
