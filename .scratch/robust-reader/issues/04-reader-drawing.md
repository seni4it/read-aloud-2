# 04. Reader: correct marks and less memory when pages are drawn

GitHub issue: #5
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Repair the page drawing of the reader: the sentence mark after zoom or resize, release and cancel of pages that left the screen, a render that finishes after a zoom, state that stays from the last document, the layout work of the text layer, and the retry loop of the word highlight.

Evidence: audit/reader-ui.md findings 4, 5, 13, 15, 16, 17. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] Zoom or resize while it reads: the sentence mark stays.
- [ ] Scroll fast through a book of 300 pages: the count of live page pictures stays small (at most the pages near the screen), and the memory of the tab does not grow with each pass.
- [ ] Zoom while pages draw: each page shows at the new scale only.
- [ ] Open a second PDF: no saved highlight of the first PDF shows.
- [ ] A page that cannot draw does not start a loop without end.
- [ ] The text layer is built with one read pass and one write pass.

## Blocked by

- 02 (test-bench)
