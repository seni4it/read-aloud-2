# 10. PDF text: characters, units and hyphens said correctly

GitHub issue: #11
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Keep every character that has a meaning; remove only private-use, unassigned and control characters. Say degrees and the micro sign correctly. Join a word that is cut at a line end, also with a soft hyphen, and keep the hyphen of a real compound. Keep mathematical letters. Break a sentence after a year. Keep ligature votes for one document only, and try the word list again after a failed load.

Evidence: audit/pdf-text.md findings 2, 6, 9, 11, 18, 20. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] Cyrillic, Hebrew, Greek letters and £ € ¥ stay in the sentences.
- [ ] '37°C' gives 'degrees C' and '5 μm' gives 'micrometres'.
- [ ] 'exam-' + 'ination' gives 'examination'; 'evidence-' + 'based' gives 'evidence-based'.
- [ ] '…in 2019. The next…' is two sentences; '1. First item' is not cut after '1.'.
- [ ] A second document does not use the ligature votes of the first.
- [ ] The comparison check shows no sample that reads worse.

## Blocked by

- 09 (pdf-text-no-lost-lines)

## Notes from the test bench (ticket 02)

- The sample `tests/pdf-text/samples/hyphen.pdf` has a real compound that is cut at a line end ("well-" + "known"). The kept reference `tests/pdf-text/reference/hyphen.txt` shows today's wrong output "wellknown". Repair it here and accept the new reference with `node tests/pdf-text/compare.mjs --update`.
