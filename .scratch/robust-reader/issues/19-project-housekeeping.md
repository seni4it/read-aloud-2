# 19. Project housekeeping: clean tree, current README, version

GitHub issue: #20
Status: ready-for-human
Type: HITL

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Make the working tree clean: commit the agent files, the glossary, the tests and the guide pictures; remove or ignore the old backup folder as the owner decides. Update the README for the test command and the glossary. After the last ticket, raise the version one time and write the changes list.

Evidence: answer page 'Read Aloud 2, round 1'. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] `git status` shows a clean tree.
- [ ] The README names the test command and the glossary.
- [ ] The version is raised one time for the whole run.

## Blocked by

None - can start immediately

## Owner

Owner: he decides about the backup folder and the push.

## Leftovers from other tickets (added 10 Nov 2026)

Each item is a claim of a sub-agent or a reviewer. Confirm it in the code first. An item that is real work gets its own ticket.

- Highlights, two tabs with the same library Book: each save sends the whole list and the last save wins, so an old tab can write over the Highlights of the other tab. The voice server needs a version or sequence number and must refuse an old save. The same number stops a late save that arrives after a newer one (ticket 07, reviews 1 and 2).
- Book key of a file that is not in the library: SHA-256 of the first 64 KB plus the size (`keyFor` in `extension/pdf/app.js`). Two files with the same start and size share Highlights (ticket 07, review 2).
- A PDF dropped on a library Book page still uses the library Book for the "last read" line, the audio export and Ask Claude (ticket 07).
- A failed open after the old Book is cleared: the old Book does not come back (ticket 07, review 2; open flow of ticket 03).
- `extension/pdf/speech.js` says 1000 as "ten hundred" (ticket 10).
- `extension/pdf/ocr.js` must give the items of a scanned page the page rotation (ticket 11).
- PDF text: a drop cap beside lines 1 to 3; "word-" at a paragraph end; the signs `~ ^ |` reach the voice (tickets 10 and 11).
- The audio cache size of `tts.js` (60 sentences) is not measured (ticket 05).
- A scrolling box inside a shadow DOM is not followed on a web page (ticket 14).

## Work report

Worked on 10 Nov 2026 by a sub-agent. Another agent was editing `extension/content.js`, `extension/popup.html` and `tests/node/web-player-*.test.mjs` at the same time, so this work did not touch them. No git command that changes the repository was run, and no version number was changed.

### Main items

- **Clean tree: not done here.** It needs `git add` and `git commit`, which the coordinator does. The files of this work are listed below.
- **Backup folder: nothing to do.** The owner answered "yes" to moving `backup-25oct` to the Trash (answer page round 1, question 5). The folder is no longer in the project folder.
- **README: done.** New sections "Tests" (the command `./run-tests.sh`, its last line, and a pointer to `docs/testing.md` and the PDF text comparison) and "Words" (a pointer to `GLOSSARY.md`). `docs/testing.md` now lists more of the test files and the new audio cache script.
- **Version: not done here.** The coordinator raises the version one time at the end of the run.

### Leftovers

- **Highlights of two tabs with one library Book: done.** The voice server keeps a save number for each Book in `.notes/<id>.rev`. A read gives it in the header `X-Notes-Rev`. A save sends it as `?base=<n>`. A save with an old number gets 409 and changes nothing, so an old tab and a late save cannot write over newer Highlights. A save without a number still goes (an older reader page), and it also counts. In the reader (`notes.js`), each save sends the number of the last read or save of its Book, taken when the save goes. On a 409 the list is read again, and the owner sees "Another window saved the highlights of this book after this window read them. Your last change was not saved. The list now shows the saved highlights." Files: `voice-server.py`, `extension/pdf/notes.js`. Tests: `test_notes_save_with_an_old_number_is_refused`, `test_notes_save_without_a_number_still_goes_and_counts` (tests/test_server.py); "each save sends the save number of the last read or save of this Book", "two tabs of one Book: the save of the tab that read before the other tab saved is refused, and it reads again" (tests/node/highlights.test.mjs). The fake voice server of highlights.test.mjs now knows the save number.
- **Book key of a file that is not in the library (`keyFor`): not done, needs the owner.** Confirmed: the key is SHA-256 of the first 64 KB plus the size. A new key (for example the hash of the whole file) changes the key of every PDF that is opened in Chrome. The key names the reading position (`pr.pos.<key>`), the Highlights in the browser (`ra2.notes.<key>`) and the Ask Claude folder on the voice server (`.book.json` "key"). So the change needs a move of all three, or the owner loses them. Proposed ticket below.
- **A PDF dropped on a library Book page: done.** The reader now knows if the open document is the library Book of the page (`state.libBook`). Only then does it write the "last read" of the Book (`ra2.lib.<id>`), show and run "Export audio", and give Ask Claude the library id. A PDF opened after it uses its own key for Ask Claude. Files: `extension/pdf/app.js`, `extension/pdf/ask.js` (the library id can be a function). Test: "a PDF opened on a library Book page: no "last read" of the library Book, no audio export, Ask Claude uses its own key" (highlights.test.mjs).
- **A failed open after the old Book is cleared: done.** When a PDF fails after the old Book's text is gone (for example the scanned-page step fails), the reader opens the last shown file again (the library Book stays the library Book) and says `Could not show "<file>" (<reason>). "<old file>" is open again.` When that open fails too, the old message and "No book is open" stay. It tries one time only. The old pdf.js document is now released in this case too. File: `extension/pdf/app.js`. Test: "an open that fails after the old Book is gone: the old Book opens again, with a message"; the test "the highlights stay closed, with a true reason" still passes (the reopen fails there too).
- **speech.js says 1000 as "ten hundred": done.** `sayYear` gives "one thousand" for 1000 and "two thousand" for 2000 ("twenty hundred" before). 1066 stays "ten sixty-six", 1100 "eleven hundred". Test: "sayYear: a round thousand is ..." (speech.test.mjs).
- **ocr.js page rotation: done.** Each word of a scanned page now gets the direction of the page's lines on the unturned sheet: the direction along the line and its up are taken from `convertToPdfPoint`, as pdf.js gives the text of a turned page. `extract.js` then turns a /Rotate 90 page back as it does for normal text. Tests: two new tests in scanned-pages.test.mjs (an upright page as a control, a page turned 90 degrees).
- **PDF text, drop cap beside lines 1 to 3: done.** New `moveDropCaps()` in `extract.js`: a row that starts with one capital letter at least twice the text size, with the rows above it (within the letter's height) all starting right of the letter, and the top row starting with a small letter: the letter moves to the start of the top row, with no space after it. Tests: "a drop cap beside lines 1 to 3 ...", and a guard "a big letter alone that is not beside the start of a paragraph is not moved" (pdf-layout.test.mjs). A drop cap of a one-letter word ("A", "I") is joined to the next word; the samples had none.
- **PDF text, "word-" at a paragraph end: done.** A paragraph that ends in a letter and a hyphen ends in the word; a dash after a space stays. Joining the word across the break was not done: in the private samples the next block after such a break is a caption, a running head or a figure, not the end of the word. Tests: two in pdf-said-right.test.mjs.
- **PDF text, the signs `~ ^ |`: done, in the speech rewrite (`speech.js`).** "~5 mm" is said "about five millimetres", "10^3" and "2^n" "to the power of", any other `~ ^ |` is a space (a short pause). Test: "the signs ~ ^ | do not reach the voice as signs ..." (speech.test.mjs).
- **Audio cache size of `tts.js`: measured, no change.** New script `tests/pdf-text/audio-cache-size.mjs` (no voice server; numbers only). tts.js keeps each sentence as decoded samples, Float32 at 24 kHz, so 96 KB for each second of speech; the length comes from the reader's sentences at 160 words a minute. Result for the private books: 2560 sentences, mean 16.7 s (1.6 MB), median 15.0 s, longest 61.5 s; 60 sentences hold about 96 MB, and at most about 234 MB. The public samples: mean 2.2 MB. A sentence of the reader is often a whole paragraph, so 60 of them is much more than the read-ahead needs. Proposed ticket below.
- **Scrolling box inside a shadow DOM on a web page: not done.** It needs `extension/content.js`, which another agent was editing.

### PDF text comparison (`node tests/pdf-text/compare.mjs`, no `--update`)

Public samples: no difference. Private books: 3 of 3 differ. Book 1: "ten hundred" to "one thousand" (1, better); a hyphen dropped at the end of a paragraph that stops before a caption or a running head (4, same). Book 2: drop caps (about 24, better: the first word of a chapter is whole, and the letter no longer goes in front of line 3); "twenty hundred" to "two thousand" (2, better). Book 3: "ten hundred" to "one thousand" (1, better); one hyphen at a paragraph end dropped (1, same). No difference reads worse. The references of the private books were not updated.

### Files changed

`voice-server.py`, `extension/pdf/notes.js`, `extension/pdf/app.js`, `extension/pdf/ask.js`, `extension/pdf/speech.js`, `extension/pdf/ocr.js`, `extension/pdf/extract.js`, `README.md`, `docs/testing.md`, `tests/test_server.py`, `tests/node/highlights.test.mjs`, `tests/node/speech.test.mjs`, `tests/node/scanned-pages.test.mjs`, `tests/node/pdf-layout.test.mjs`, `tests/node/pdf-said-right.test.mjs`, `tests/pdf-text/audio-cache-size.mjs` (new), this file.

`./run-tests.sh`: Python 14 tests OK, Node 409 tests pass, RESULT: PASS.

### Proposed new tickets

**Book key of a PDF opened in Chrome: the whole file.** Two different files with the same first 64 KB and the same size share their reading position, their Highlights and their Ask Claude folder. Make the key from the whole file. Move the old data on the first open: the reading position and the Highlights in the browser storage, and the key in `.book.json` of the Ask Claude folder (the voice server finds the folder by its key). When two files had the same old key, only the first one opened keeps the old data. The owner decides if the move is wanted, or if a new start is acceptable. Acceptance: two made PDFs with the same first 64 KB and size get two keys; a PDF with old data keeps it after the change.

**Audio cache of the reader by size, not by count.** tts.js keeps 60 sentences. Measured: about 96 MB with the usual sentences, up to about 234 MB with long paragraphs. Limit the cache by bytes (as the voice server does with `CACHE_BYTES`), for example 30 MB, and always keep the sentence that plays and the read-ahead. Acceptance: a test with long made sentences shows the cache under the limit.

**Web page: follow a scrolling box inside a shadow DOM.** Left from ticket 14; it needs `extension/content.js`.

### Review round 1 (9 points)

Tests first. Each new test failed before its repair, except the thread test (a guard: the one lock was there already).

1. **A refused save of a Book that is not open was lost with no message: repaired.** `notes.js` `olderElsewhere()`: on a 409 for a Book that is not open, the owner sees "A change to the highlights of the book opened before was not saved: ..." and that Book is read again for its save number. Test: "review: a refused save of the Book opened before shows a message, and that Book's number is read again".
2. **A late older read could store an old save number: repaired.** `read()` no longer stores the number. `refresh()` keeps it (`keepNumber()`) only when the read is still the newest and no save of that Book had an answer while the read was on the way (a count of answered saves for each Book). Tests: "review: a late read with an old number does not replace the number of a newer read", "review: a read whose answer comes after a save of the same Book does not bring back the old number".
3. **The number file was written in place, and a bad file gave 0: repaired.** `notes_rev_save()` writes `.rev.tmp`, then `os.replace`. A damaged file (empty, not a number) never gives 0: it gets a new number from the clock in milliseconds, above every number a tab can hold, and that number is written. So every old save is refused and the tabs read again. A missing file is 0, as before. The save holds one lock (`_notes`) over reading the number, writing the notes and writing the number. Tests: `test_notes_bad_number_file_refuses_every_old_number`, `test_notes_saves_from_many_threads_each_get_their_own_number` (8 saves with number 0 at the same time: one wins, 7 get 409).
4. **The header across origins: checked and repaired.** The voice server makes no CORS headers. The Highlights of a library Book are read only by the reader page of the voice server itself (`/reader/?lib=`), with a relative address, so the read is same-origin. An add-on page has host permission for 127.0.0.1 and can read the headers too. The notes answers (read, save, 409) now also send `Access-Control-Expose-Headers: X-Notes-Rev`. When the header is missing, the reader no longer turns the check off silently: it saves without a number and the Highlights list says "The voice server is an older version ... Restart the voice server." Tests: `test_notes_number_header_is_exposed_to_other_origins`; "review: a voice server that sends no save number: the owner is told the check is off".
5. **"10^-3" became "10 -3": repaired.** A minus (hyphen or U+2212) after `^` is said "minus": "10 to the power of minus 3". Test: "review: a negative power is said with "minus" ...".
6. **"1,000": checked.** The speech rewrite leaves "1,000" and "2,000" as they are. The voice gets them whole, and the voice's text step (misaki, in the mlx-audio install) takes the commas out and says the number in words. It was not heard here (no voice server was used). The check found three wrong cases where other rules cut a comma number: "1,000-2,000" became "1,zero to two,000", "1,500 mm" became "1,five hundred millimetres", and "10,000.5" became "10,zero point five". Now no number rule starts or ends inside a comma number (`sayWhole()`). Test: "review: a number with thousands commas ...".
7. **`state.libBook` stayed true after a failed library open with no restore: repaired.** In that path the reader sets it to false and hides "Export audio". Test: "review: a library Book whose open fails with no Book to bring back ...".
8. **The "not moved" test missed the last checks of `moveDropCaps`: repaired.** Two new tests, with the rows above starting right of the capital: a top row that starts with a capital, and a capital less than twice the text size. A trial with each check taken out made its test fail; the code was then put back.
9. **audio-cache-size.mjs: repaired.** The header names the true sources: the cache size and the sample rate in `extension/pdf/tts.js`, WPM in `extension/pdf/app.js`, the sentences through `tests/pdf-text/extract-text.mjs`. The constants are not exported (and app.js cannot be imported in Node), so the script reads them from the source text and stops when a value is not found.

Files: `extension/pdf/notes.js`, `extension/pdf/speech.js`, `extension/pdf/app.js`, `voice-server.py`, `tests/test_server.py`, `tests/node/highlights.test.mjs`, `tests/node/speech.test.mjs`, `tests/node/pdf-layout.test.mjs`, `tests/pdf-text/audio-cache-size.mjs`, this file.

`./run-tests.sh`: Python 17 tests OK, Node 418 tests pass, RESULT: PASS.

`node tests/pdf-text/compare.mjs`: the public samples are the same as their references. One sentence of private book 2 changed, because of point 6. It is a table row with five money amounts that have thousands commas. Before, each amount was cut ("$7," then the rest said in words). Now each amount goes to the voice whole. This is better.
