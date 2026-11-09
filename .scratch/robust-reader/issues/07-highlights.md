# 07. Highlights: correct click, keyboard, save sequence

GitHub issue: #8
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Repair the saved highlights: a click on a saved highlight must not start the reading; the mark button must work with the keyboard; the delete control must be reachable with Tab; two fast changes must be saved in sequence; the export must release its temporary address.

Evidence: audit/reader-ui.md findings 12, 21, 22, 25. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [x] Click a saved highlight: its menu opens and the reading does not move.
- [x] Focus the mark button and press Enter: the present sentence is kept, and the play state does not change.
- [x] Tab reaches the delete control of a highlight.
- [x] Two changes in 100 ms: the server holds the second one.
- [x] Node test for the write sequence passes.

## Blocked by

- 03 (reader-transport)

## Note from ticket 04 (9 Nov 2026)

Ticket 04 found a related fault in `notes.js` and `app.js`: an add or a remove of a highlight during the read-in of a new book writes the old book's highlights under the new book's key. The exact change is in the Work report of `04-reader-drawing.md` ("Review round 2", item 5). Repair it in this ticket, with a test.

## Note from ticket 05 (9 Nov 2026)

This ticket is the next owner of `app.js`. Make also the small `app.js` change that ticket 05 describes in its Work report: the status label must show the Mac voice from the first sentence after the voice server falls (app.js calculates the label before `speak`).

## Work report (9 Nov 2026)

### What was wrong (each audit finding confirmed in the code first)

1. **Finding 12, a click on a saved highlight started the reading: confirmed.** app.js and notes.js both listen to clicks on the pages. The underline is drawn under the text, so the click target is the word of the text layer. The app.js listener comes first: it stopped the reading, jumped to that sentence and pressed Play. The notes.js listener then opened the menu of the Highlight.
2. **Finding 21, the mark button did nothing with the keyboard: confirmed.** notes.js marked only when `e.detail` was not 0. Enter on a focused button gives a click with `detail` 0, so Enter did nothing.
3. **Finding 22, Tab did not reach the delete control: confirmed.** Each row of the Highlights list was a `<button>`, and the delete control was a `<span role="button">` inside it, with no tabindex. A control inside a button is not valid HTML, and Tab does not stop on it.
4. **Finding 25, two fast changes could be saved out of order: confirmed.** In a library Book, each change sent its own POST at once, with no wait. When the first POST arrives last, the voice server keeps the older list, and the newer Highlight is lost. Also, `reload()` could read the list while a save was not finished.
5. **The export did not release its temporary address: confirmed.** `URL.createObjectURL` had no `revokeObjectURL`.
6. **Note of ticket 04, Highlights written under the new Book's key during the read-in: confirmed.** Between the open of a new Book and `reload()`, `notes` still held the old Book's Highlights. A change in that time wrote them under the new key (or the library id), and so wrote over the new Book's Highlights.
7. **Found during this work: a failed read wrote over the saved Highlights.** In a library Book, when the voice server did not answer the read, `read()` gave `[]`. The next mark then saved a list with only the new Highlight, and the server lost all the others.
8. **Note of ticket 05, the status label after the voice server falls: confirmed.** `speakCurrent()` made the label before `speak()`, so the first sentence in the Mac voice still showed the old label.

### What changed

`extension/pdf/notes.js`:
- New `markAt(x, y)` gives the underline under a point (the same generous target as before). The menu uses it, and it is returned to app.js.
- The mark button marks on every click, so Enter works. Space does not come there: app.js takes Space for Play and Pause, and its `preventDefault` stops the button's own click.
- A row of the list is a `div` (`role="button"`, `tabIndex = 0`, Enter or Space opens it) with a real `<button class="del">` inside. The CSS classes are the same (`.note`, `.note .del`), so no CSS change.
- The saves of a library Book go one after the other (`saving` chain). `read()` waits for the chain first.
- The export releases its address 1 second after the download starts.
- New `reset()`: the old Book's Highlights, marks and menu go, and no change is written until `reload()` has read the new Book's list. A change in that time is refused, and the mark button shows "Wait: the highlights show when the book is read in."
- When the read fails, `reload()` keeps the list closed for changes, and the list says that the highlights could not be read, so the saved Highlights are never written over.

`extension/pdf/app.js`:
- The click handler of the pages returns when `notesUI.markAt()` finds an underline.
- `openFile` calls `notesUI.reset?.()` right after `state.parseToken++`.
- `onWord` calls `setStatus(engineLabel(engine))`; the `readyLabel` line is gone. `engineLabel()` gives the device text alone when it starts with "Mac voice" (the optional change of ticket 05).
- The calls use `?.`, because the fake notes of `tests/node/reader-transport.test.mjs` has no `reset` or `markAt` (that file is not of this ticket).

### Tests

New file `tests/node/highlights.test.mjs`, 12 tests. Before the repair: 11 fail, 1 pass (the control case passes on purpose). After: 12 pass.
- "notes.js tells where a saved highlight is on the page (markAt)"
- "Enter on the mark button keeps the present sentence and does not change the play state"
- "the delete control of a highlight is its own button, so Tab reaches it"
- "two changes in 100 ms: the voice server holds the second one" (the write sequence)
- "a read of the highlights waits for a save that is not finished"
- "when the saved highlights cannot be read, a new highlight does not write over them"
- "the Markdown export releases its temporary address"
- "a change during the read-in of a new book does not write the old book under the new key"
- "a click on a word starts the reading there (the control case)"
- "a click on a saved highlight opens its menu and the reading does not move"
- "a new book clears the old highlights before its read-in starts"
- "the status shows the Mac voice from the first word after the voice server falls"

`./run-tests.sh`: before, Python 12 OK and Node 228 pass. After, Python 12 OK and Node 248 pass, 0 fail (12 new here, 8 new from the PDF layout work of another ticket). RESULT: PASS.

A node test cannot press a real Tab key or show a real focus order. The test checks the cause (the delete control is a real button, not inside a button). The manual check below shows the real focus.

### Manual check in a real Chrome

1. Open a book and highlight a sentence. Stop the reading. Click the underline. Expect: its menu opens, and the reading does not start.
2. Press Play. Click an underline of another sentence. Expect: the menu opens, and the voice goes on with the same sentence.
3. Click the mark button once with the mouse, then press Enter (the button keeps the focus). Expect: the first press keeps the sentence, Enter takes it off again, and Play or Pause does not change. Press Space: Play or Pause changes, and no Highlight is made.
4. Open the Highlights tab. Press Tab: the focus goes to a row, then to its "×". Press Enter on the "×": the Highlight goes. Press Enter on a row: the reader goes to that Highlight. (Space on a button of the list is Play or Pause, as on every button of the reader; see review round 1, item 9, and step 4 there.)
5. In a library Book, mark two sentences very fast (press the mark button twice on two sentences, or use two fast changes of group in the menu). Reload the page. Expect: both changes are there.
6. Export as Markdown. Expect: the file downloads. In DevTools > Memory, no blob stays for it after some seconds.
7. Open a Book with Highlights. Open a second PDF and press the mark button while it is read in. Expect: the button title says "Wait: the highlights show when the book is read in." After the read-in, the second Book shows only its own Highlights. Open the first Book again: its Highlights are all there.
8. In a library Book, stop the voice server (only in a test setup, not the live one), then open the Book. Expect: the list says that the highlights could not be read, and a mark is refused. Start the server and open the Book again: all Highlights are there.
9. Read with the natural voice and stop the voice server (test setup). Expect: from the first word in the Mac voice, the status shows "Mac voice (the natural voice does not answer)".

### What is left

- A failed save (POST) of a library Book is still silent: the change shows on the page, but the server does not have it. A message or a new try is a later decision.
- In a library Book page, a PDF dropped on the page uses the library id of that page for its Highlights (old behaviour, ticket 04 named it). The key of a dropped PDF is a decision for the library ticket (17) or the reader frame.
- `tests/node/reader-transport.test.mjs` could add `reset` and `markAt` to its fake notes; then the `?.` in app.js can go. (Done in review round 1.)

## Review round 1 (9 Nov 2026)

Each finding was checked in the code first. All 10 are true; item 9 needed only a guard, not a repair (see there).

1. **A read that started before `reset()` still ran: true, repaired.** `refresh()` (the body of `reload()`) takes a number from `loadId`; `reset()` and each new read change it. A late answer of an older read is dropped. Test: "a read of the old book that answers after a new book is opened is dropped".
2. **A PDF opened or dropped on a library Book page wrote under the page's library id: true, repaired.** `reset(id)` now takes the library id of the Book that opens, and `read()`/`write()` use it. app.js `openFile(file, { library })`: only the `?file=` of the boot is the library Book (`library: true`); a file from Open PDF, the sample or a drop calls `reset('')`, so it keeps its highlights under its own key in the browser, as any PDF that is not in the library. A save that waits in the queue keeps the id of its own Book. Tests: "a PDF opened on a library Book page keeps its highlights under its own key, not under the library Book" (notes.js) and "the library Book of the page gets its library id; a PDF opened after it gets none" (app.js).
3. **A save or read that never answers stopped the queue for ever: true, repaired.** Every request of notes.js to the voice server (read, save, the Key points list) has a time limit of 30 s (`LIMIT`, the same as the other voice server requests), with an `AbortController`. A save that fails, is refused (not `ok`) or times out does not stop the saves after it. Then the list shows on top: "A change was not saved: the voice server did not answer. The next change saves all highlights again." Each save sends the whole list, so the next save repairs it; the message goes when a save works. After a failed read, the list says "The highlights could not be read (the voice server did not answer). Mark again in a moment: the highlights are read again." The next change is refused (nothing is written) and starts a new read. Tests: "a save that never answers stops after 30 s; the next save goes, and the owner sees a message", "a save that the voice server refuses does not stop the next save", "when the saved highlights cannot be read, a change does not write over them, and starts a new read", "a read that never answers stops after 30 s; the next change reads again".
4. **A storage error or a damaged value became an empty list, and the next write went over it: true, repaired.** `read()` gives `[]` only when no value is stored; an error, a damaged value or a value that is not a list gives `null`, and the Book stays closed for changes (message: "...the browser storage did not answer..."). A failed `localStorage.setItem` now also shows the "not saved" message. Tests: "a damaged value in the browser storage: ...", "a storage error in the browser storage: ...", "no value in the browser storage is a good empty list: a change is kept".
5. **The 6 px halo of `markAt`: true, repaired.** 2 px now. The drawn box covers the whole word (viewer.js `drawBoxes`), so a click on the underlined words still opens the menu. Test: "notes.js tells where a saved highlight is on the page (markAt): the drawn box, 2 px at most around it" (near misses of 4 and 5 px give no hit).
6. **The focus went to the page body after a delete: true, repaired.** After a delete from the list, the focus goes to the text button of the next row, else of the row before, else to the mark button. Test: "after a delete from the list, the focus goes to the next row, then the one before, then the mark button".
7. **A row with role=button that holds a button: true, repaired.** A row is now a plain `div.note` (no role, no tabindex) with two real buttons: `button.note-open` (the text, opens the Highlight) and `button.del`. The text button gets an inline reset of the button look (no colour value, no outline change, so the focus ring of the theme stays). A click on the edge of the row opens it too. Test: "each row of the list holds two real buttons: ...".
8. **`?.` in app.js: repaired.** `notesUI.reset(...)` and `notesUI.markAt(...)` are plain calls; the fake notes in `tests/node/reader-transport.test.mjs` has `reset() {}` and `markAt: () => null`.
9. **Space: what the code does.** app.js listens to `keydown` on `document`, in the bubble phase (not on window, not capture). For Space it calls `preventDefault()` and `toggle()`, unless the target is an input, select or textarea. ask.js has a capture listener on `document` that takes Space only while an answer of Ask Claude is open (`stopImmediatePropagation`). So Space on the mark button, or on a button of the list, is Play/Pause once. In Chrome, a button is clicked at Space keyup only when its own keydown default ran (the button became active); `preventDefault()` on keydown stops that, so no click comes. That is one action, not two. To make this not depend on app.js alone, notes.js also calls `preventDefault()` at Space keyup on the mark button. Enter is not taken by app.js, so the button's own click comes (detail 0) and marks. The old custom Enter/Space handler of the list row is gone: the rows now use real buttons, so Enter opens and Space is Play/Pause, as on every other button of the reader. Tests: "keys on the mark button: Space is Play or Pause once (no click), Enter is left to the button (it marks)" (app.js, real listeners), "Space on the mark button never marks: its keyup stops the button's own click" (notes.js).
10. **Tests.** The fake DOM cannot make Chrome's own Enter-to-click step. The app.js test fires Enter and Space through the real document listeners and checks the play state and `preventDefault`; the notes.js test fires the click with detail 0 that Chrome makes from Enter. The status test now also checks that the label goes back to the natural voice ("ready · kokoro") when tts.js sets `device` back to null. The test "two changes in 100 ms" is now "two fast saves that the network delivers in the other order: the voice server holds the second one".

### Test results, review round 1

- `tests/node/highlights.test.mjs`: 24 tests, 24 pass. Run against the code before this ticket (a copy of HEAD notes.js and app.js in the scratch folder): 19 fail, 4 pass, 1 cancelled (the read that never answers waits until the 120 s test limit). The 4 that pass test a behaviour that was already right (a refused save, an empty storage, the click on a word, Space as Play/Pause).
- `./run-tests.sh`: Python 12 OK. Node 278 tests, 272 pass, 6 fail. The 6 failures are all in `tests/node/design-tokens.test.mjs`, the new, unfinished test file of ticket 20 (design tokens; `extension/pdf/tokens.css` is new and the style files do not import it yet). They do not come from this ticket. All other files pass, `reader-transport.test.mjs` too.

### Manual check in real Chrome, changed and new steps

4. (new text) Open the Highlights tab and press Tab: the focus goes to the text of the first Highlight, then to its "×", then to the next Highlight. Enter on the text: the reader goes to it. Enter on "×": the Highlight goes, and the focus is on the next Highlight. Delete the last one: the focus goes to the mark button. With VoiceOver: each row reads as two buttons. Space on a button of the list starts or pauses the reading (app.js), and does not open or delete the Highlight.
10. Click 3 to 5 px next to an underline (not on it): the reading starts at that word, the menu does not open.
11. On a library Book page, drop another PDF and mark a sentence. Open the library Book again: its Highlights are the same as before. Open the dropped PDF in Chrome: its Highlight is there.
12. On a library Book page, stop the voice server (test setup) and mark: after at most 30 s the list says that a change was not saved. Start the server and mark again: the message goes, and both Highlights are saved.

### What is left, more

- Two tabs with the same library Book: the last save wins and can remove a Highlight made in the other tab. This needs a version check in the voice server (the coordinator writes a ticket).
- Other parts of app.js still use `LIB_ID` for a dropped PDF: the "last read" line of the library (`ra2.lib.<id>`), the MP3 export and Ask Claude (`libId` of ask.js). A dropped PDF can so change the library Book's reading line, and an export or a question goes to the library Book. This is for the library ticket (17) or the reader-frame ticket.

## Review round 2 (10 Nov 2026)

Each finding was checked in the code first. Items 1 to 4 are true and repaired. For item 5, no repair was needed.

1. **The time limit stopped when the headers came, so the body could wait for ever: true, repaired.** `ask(url, opts, take)` now reads the body inside the time limit (`take`, for example `r => r.json()`). A race with a 30 s timer rejects, and the request is aborted. `read()` and the Key points list use it. Test: "a read whose body never comes stops after 30 s; the next change reads again".
2. **An open that fails after `reset()` left the Highlights closed with a false message: true, repaired.** What the code does: `reset()` runs only after pdf.js has read the new file. If pdf.js cannot read it, nothing changes, and the old Book and its Highlights stay as they are. But when `keyFor`, `withOcr` or `viewer.load` throws, app.js has already cleared the old Book (`state.sentences = []`, `state.doc` is the new document). So the old Book is not on the screen in a state that can be read or marked, and its Highlights cannot work again without a new read-in. Bringing the old Book back is a change to the open flow of app.js (ticket 03's area), not to the Highlights. Repair: in that catch, app.js calls `notesUI.reset('', 'No book is open. Open a PDF to see its highlights.')`. `reset(id, why)` takes the reason. The Highlights tab and the mark button say it, changes stay refused, and the "wait for the read-in" message no longer shows. Tests: "reset() with a reason: ..." (notes.js), "an open that fails before the PDF is read: the old Book and its highlights stay as they are" and "an open that fails after the old Book is gone: the highlights stay closed, with a true reason" (app.js; the fake pdf.js now refuses a file that is not a PDF).
3. **A late answer of an old Book's save changed the message of the new Book: true, repaired.** Each save remembers its Book id. It sets or clears the "not saved" message only when that id is the Book that is open now. Tests: "a late failed save of the old Book does not show "not saved" on the new Book", "a late good save of the old Book does not clear the "not saved" message of the new Book".
4. **The read of a new Book waited behind the old Book's saves: true, repaired.** `saving` is now a map with one queue for each library id. A read waits only for the saves of its own Book. The old Book's saves still run to their end. Test: "the read of a new Book does not wait for the saves of the old Book; the old saves still end".
5. **What does GET of a Book with no highlights answer: checked in `voice-server.py`, no repair needed.** The GET handler of `/library/<12 hex>/notes` reads `.notes/<id>.json`, and on `OSError` (no file yet) it answers 200 with `[]`. A 404 comes only when the path does not match (an id that is not 12 hex characters). So `!r.ok` means an error, and `null` is right. A comment in `read()` says this.

Manual step 4 is corrected: Space on a button of the list is Play or Pause (app.js, as on every button of the reader). It does not open or delete the Highlight.

### Test results, review round 2

- `tests/node/highlights.test.mjs`: 31 tests. Before the repair: 4 fail, 3 cancelled at the 120 s test limit, 24 pass. One of the failures was in the test itself: the fake pdf.js accepted a file that was not a PDF. After the repair: 31 pass.
- `./run-tests.sh`: Python 12 OK. Node 285 tests, 285 pass, 0 fail. Without `design-tokens.test.mjs` (13 tests, all pass now; it belongs to ticket 20): 272 pass, 0 fail. RESULT: PASS.

### What is left, more

- After an open that fails late, the old Book is not brought back. The owner opens it again. This is the open flow of app.js (ticket 03's area).
- The coordinator writes a ticket for a version number of the saves in the voice server, and for the Book key (the first 64 KB plus the size).
