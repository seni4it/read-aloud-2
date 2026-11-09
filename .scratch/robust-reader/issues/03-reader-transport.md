# 03. Reader: the reading does not stop or start again by error

GitHub issue: #4
Status: code done, reviewed, tests pass; real browser checks open (see manual-checks.md)
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Repair the transport of the reader: seek-bar drag, change of speed or voice in a paragraph, the Preview button, opening a file (bad file, second file, old parse), jumps while a document is still read in, and one failed sentence.

Evidence: audit/reader-ui.md findings 1, 2, 3, 7, 11, 18. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] Drag the seek bar while it reads: the reading goes on from the new place.
- [ ] Change the speed or the voice in a paragraph: the reading continues from the present word.
- [ ] Press Preview, then Play before the preview ends: Preview can be pressed again.
- [ ] Open a file that is not a PDF: a message shows and the start screen stays.
- [ ] Open a second PDF: the first document is released and none of its sentences show.
- [ ] While a document is read in and nothing plays, the page does not jump back to the first sentence.
- [ ] One failed sentence: a message shows, one new try after 1 second, then a stop with a message.

## Blocked by

- 02 (test-bench)
