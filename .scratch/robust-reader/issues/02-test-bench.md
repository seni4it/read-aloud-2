# 02. Test bench: one command, Node tests, PDF text comparison

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Give the project one command that runs every automatic test. Add the Node built-in test runner for browser logic, with no package install. Add a comparison check for PDF text: it writes the sentences of each sample PDF to a text file, so that a change can be compared before and after. Use only sample PDFs that can be public; keep the owner's books out of the repository and read them from a folder outside it when it exists. Add a short `docs/testing.md`.

Evidence: spec: Testing Decisions. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] One command runs the Python tests and the Node tests and gives one pass or fail result.
- [ ] One Node test for the speech rewrite and one for the ligature repair pass.
- [ ] The comparison check writes one text file per sample PDF and prints a difference against a kept reference.
- [ ] No package is installed and no network is used.

## Blocked by

None - can start immediately
