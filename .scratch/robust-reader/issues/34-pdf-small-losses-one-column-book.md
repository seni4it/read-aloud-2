# 34. PDF text: small losses found in the owner's one-column book

Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Found while ticket 33 was built, on the owner's private sample `Mastering_Rotary_Endodontic_Instrumentation.pdf` (in `~/read-aloud-samples`; never in the repository). Run `node tests/pdf-text/compare.mjs` and read its text in `~/read-aloud-samples/out/`.

1. Page 1: the title line "MASTERING ROTARY" is not read; only "ENDODONTIC INSTRUMENTATION" is.
2. Page 4: the label cell "[Current recommendation / IFU]" loses its second line "/ IFU]".
3. Full-page tables of 3 or more columns (pages 51, 82, 172, 207, 236, 276, 285) still split at a column gap. With "Skip tables" on they are skipped, so the owner does not hear them. With "Skip tables" off they read column by column. Decide with a test whether `withTables` should read them row by row.

Each item is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] A test for each item that fails on the old code.
- [ ] The comparison check shows no sample that reads worse.

## Blocked by

None.
