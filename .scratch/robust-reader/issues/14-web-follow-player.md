# 14. Web pages: Follow and the player work on every site

GitHub issue: #15
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Repair Follow and the player of the web-page reader: no jump when the site replaced its content, Follow inside a scrolling box, the player on the root element and put back when the site removes it, no errors from a tab that lost the add-on after an update, no stop of Follow when the owner types in a form, and controls of at least 32 px.

Evidence: audit/web-page-and-library.md findings 2, 11, 12, 13, 22, 25. Each audit finding is a claim: confirm it in the code first.

From ticket 16: the content.js half of web finding 6 is still open. On a `stopped` event, content.js must raise its sentence id (`S.id++`), so that a late event of the stopped sentence is ignored.

## Acceptance criteria

- [ ] On a test page that replaces its content while it reads, the page does not jump.
- [ ] On a test page that scrolls inside a box, the text follows the voice.
- [ ] On a test page with a transform on its body, the player is at the bottom of the window.
- [ ] After a reload of the add-on, an old tab writes no error to its console.
- [ ] Space in a text field does not stop Follow.
- [ ] The 'Listen from here' button and the speed buttons are 32 px or more.

## Blocked by

- 13 (web-sentences)
