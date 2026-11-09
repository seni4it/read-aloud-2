# 18. Add-on popup and paste page: labels and font

GitHub issue: #19
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Make each switch in the popup a real label, so that a click on its words works and a screen reader says its name. Repair the font rule of the paste page.

Evidence: audit/web-page-and-library.md findings 20, 21. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [x] A click on the words of each of the 6 switches changes the switch.
- [x] The text box of the paste page shows 16 px text.

## Blocked by

None - can start immediately

## Work report

### What was wrong (both audit findings confirmed in the code)

- Finding 21, `extension/popup.html`: the 6 switches were `<div class="sw">words <input type="checkbox"></div>`. The words were not a label. A click on the words did nothing, and a screen reader said an unnamed checkbox.
- Finding 20, `extension/paste.html`: the text box had `font: 16px/1.5 inherit;`. A CSS-wide word (`inherit`) cannot be part of a shorthand, so Chrome dropped the whole line. The text box showed the small default font of the browser, not 16 px.
- One more fault, found on the same rows: `.sw { display: flex }` wins over the browser rule `[hidden] { display: none }`. So `popup.js` could not hide the row "Hide on this site" on pages with no site (for example a Chrome page). The row was always shown.

### What changed

- `extension/popup.html`: each of the 6 switch rows is now `<label class="sw">` (the `id="siteRow"` stays). New rule `.sw[hidden] { display: none; }`. No change to the look, and no change to `popup.js` (it finds the switches by id).
- `extension/paste.html`: the text box rule is now `font: inherit; font-size: 16px; line-height: 1.5;`.

### Tests

New file `tests/node/small-pages.test.mjs` (5 tests). Node has no browser, so the tests read the HTML and its `<style>` as text.
- `popup: each of the 6 switches is inside a label, so a click on its words changes it` (criterion 1; failed before the repair)
- `popup: the labels of the switches have no other control in them`
- `popup: the "Hide on this site" row keeps its id, and the hidden row is not shown` (failed before the repair)
- `paste page: every CSS line of the text box is valid` (failed before the repair)
- `paste page: the text box shows 16 px text` (criterion 2; failed before the repair)

`./run-tests.sh`: Python 12 OK, Node 253 pass, 0 fail, `RESULT: PASS`.

### Manual check in a real Chrome

1. Open `chrome://extensions` and reload the Add-on.
2. Click the Add-on icon. Click the words "Page follows the voice". The switch changes. Click the words again. It changes back.
3. Do step 2 for the other 5 switches. Close and open the popup. Each switch keeps its value.
4. Open a Chrome page (for example `chrome://newtab`) and open the popup. The row "Hide on this site" is not shown.
5. With VoiceOver on (Cmd+F5), move to a switch. VoiceOver says the words of the row and "checkbox".
6. In the popup, click "Listen to pasted text". Type text in the box. Right-click it, Inspect: the computed font-size is 16px and the font is the same as the page.

### What is left

- Nothing for this ticket. The look of the popup and the paste page is for tickets 20 to 25.
