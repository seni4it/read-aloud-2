# 27. Reading position in the library, kept by the voice server

GitHub issue: none yet
Status: code done, tests pass; Chrome check open (see Work report)
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

The library opens on "Continue listening". It must show, for each Book, how far the owner is: the Reading position. Today the reader keeps the Reading position only in the browser storage of its own page. The voice server does not give it to the library. So the library cannot show the true progress, and two pages of different origins (the desktop app and Chrome, or 127.0.0.1 and localhost) do not share it.

1. The voice server keeps the Reading position of each Book next to the Book's highlights, as a small JSON record: the sentence, the number of sentences, the page, the number of pages, the minutes left and the time of the save. The route follows the highlights route: the same id check, a whole write (a temporary file, then a move over the old file) and the same origin check. A save that is older than the kept one is not written. The library list gives the Reading position of each Book, so the library needs no extra request for each Book.
2. The reader sends the Reading position of a library Book to the voice server when it changes: at most one send in 5 seconds while the voice reads, and at once on pause and when the page closes or goes to the background. It still keeps its own copy in the browser. When it opens a Book, it uses the newer of its own copy and the voice server's copy. When the voice server does not answer, the owner sees no error and the reader works as before.
3. The library shows the true progress in "Continue listening" (the Book read last first) and on each card, with the tokens and parts that are there now, and no new colour. The text reads well aloud, for example "Page 12 of 240, 12% done, 40 min left".

## Acceptance criteria

- [x] `GET /library/<id>/position` gives the kept Reading position, or `null` before the first save. `POST` with a JSON record keeps it. A bad id gives 404, a bad record gives 400, a record from another site gives 403.
- [x] The record is written whole: no temporary file stays, and a save older than the kept one does not replace it.
- [x] `/library.json` gives `position` for each Book (`null` when none).
- [x] The reader opens a library Book at the newer of its own copy and the voice server's copy.
- [x] With no answer from the voice server, the reader opens at its own copy, with no message.
- [x] The library shows "Page n of m" with the part done and the time left, from the voice server, also when the browser of the library has no copy.
- [ ] Chrome check (see Work report).

## Blocked by

- 23 (library design)

## Work report

Date: 10 Nov 2026.

### Where the Reading position was before

Only in the browser storage (`localStorage`) of the reader page:

- `pr.pos.<document key>`: `{i, at}`, the sentence and the first words of that sentence, so that the place is found again after a change of the text rules.
- `ra2.lib.<Book id>`: `{i, total, t, minLeft}`, only for a library Book, for the card of the library.

The library page read `ra2.lib.<Book id>` from its own browser storage. That works only when the library and the reader have the same origin and the same browser.

### New route and file format

- `GET /library/<id>/position`: the kept record, or `null`.
- `POST /library/<id>/position`: body is one JSON record, at most 4 KB. The answer is the record that is kept now.
- The id must be 12 hexadecimal characters (else 404). POST needs the origin of the app or of the add-on (else 403), as all POST routes.
- The file is `.notes/<id>.position.json` in the library folder, next to the highlights `.notes/<id>.json`. It is written to `<file>.tmp` and then moved with `os.replace`, under the same lock as the highlights.
- POST and not PUT: the voice server has no PUT handler and no CORS preflight answer. The origin check is in the POST handler, as for the highlights.

Record (all numbers; only these keys are kept, others are dropped):

```json
{"i": 120, "total": 2400, "page": 12, "pages": 240, "minLeft": 95.5, "at": "first words of the sentence", "t": 1762780000000}
```

`i` (sentence, 0 or more) is the only key that must be there. `t` is the time of the save in milliseconds; when it is missing, the voice server puts its own time. A record that is not an object, has a bad `i`, a negative number, an `at` longer than 200 characters, or is not JSON, gives 400.

### What changed

- `voice-server.py:19-21` the route list at the top. `voice-server.py:298-338` `POSITION_NUMBERS`, `position_path`, `position_read`, `position_clean`. `voice-server.py:1140` `position` in each Book of `/library.json`. `voice-server.py:1194-1198` `GET /library/<id>/position`. `voice-server.py:1381-1405` `POST /library/<id>/position`, in the same handler as the highlights.
- `extension/pdf/position.js` (new, 15 lines, no page): `newerPosition(local, remote)`. A copy with no time is the oldest; at the same time the own copy stays; a damaged copy is not used.
- `extension/pdf/app.js`, only the save and load lines:
  - `:9` the import of `newerPosition`.
  - `:225` one `queuePosition()` when the voice goes to the next sentence (at most one send in 5 s).
  - `:322` `stop()` (pause) sends at once.
  - `:490-529` `SERVER`, `POSITION_WAIT`, `sentencePage`, `positionRecord`, `sendPosition` (POST with `keepalive`, every error is quiet), `queuePosition`, `positionFromServer` (3 s at most, `null` on any failure).
  - `:531-548` `saveProgress(now)`: `t` in `pr.pos.*`; `page` and `pages` in `ra2.lib.*`; the queue to the voice server.
  - `:557-573` `loadProgress(remote)`: the newer of the two copies, then the old search by the first words.
  - `:626-629` `openFile` asks the voice server for the copy of a library Book.
  - `:770-773` `parseDocument` waits for that answer, then loads; from here sends are allowed.
  - `:1033-1036` `pagehide` and `visibilitychange` (hidden) send at once; `:1145` the Library button sends at once.
  Nothing is sent before the Reading position of the open Book is loaded, so a page that closes during the read-in cannot send sentence 0 over the true place.
- `app/library-model.js:32` `newerProgress(a, b)`; `statusText` gives "Page n of m, " first when the record has the page and the number of pages.
- `app/library.js:14` `progressOf(b)` takes the newer of `b.position` (voice server) and the browser copy.
- No change to `app/library.css` and `app/index.html`: the status line uses the `.sub` style that is there. No new colour.

### Tests

Written first; they were red before the code.

- `tests/test_server.py`, 8 new tests: round trip and `null` before the first save; the voice server time when `t` is missing; bad id (404); bad body (12 kinds, 400) and too large (413); another site (403) and the add-on origin (200); the whole write (a `.tmp` file, then `os.replace`, no `.tmp` left); an older save is not written, a newer save to an earlier sentence is; `/library.json` gives `position` (`null` for none and for a damaged file). 26 tests, OK.
- `tests/node/reading-position.test.mjs` (new), 8 tests: the choice of the newer copy (4 tests of `newerPosition`), and app.js in a fake page: the reader opens at the newer voice server copy; it keeps its own newer copy; with no answer it opens at its own copy with no message; a pause and a page hide each send one record (sentence, sentences, page, pages, first words, time, minutes left), and nothing goes during the read-in.
- `tests/node/library-page.test.mjs`, 4 new tests (37 now): the status text with the page; `newerProgress`; with an empty browser storage the Continue block and the cards show the voice server record ("Page 12 of 240, 12% done, 40 min left"), and the Book read last by the voice server time comes first; a newer browser copy wins.
- `./run-tests.sh`: Python OK, Node 461 pass, 0 fail, `RESULT: PASS`. `node --test --test-timeout=120000 tests/node/`: 461 pass, 0 fail.

### What a real Chrome check must confirm

1. Open a library Book from `http://127.0.0.1:8793/app/`. Read for 10 seconds. Pause. In DevTools > Network, one POST to `/library/<id>/position` has status 200.
2. Open `http://localhost:8793/app/` (another origin with no browser copy). The Continue block shows the same Book with "Page n of m".
3. Open the Book from there. The reader starts at the sentence where you paused.
4. Read on in one window, close it, then open the Book in the other window. It starts at the newer place.
5. Stop the voice server only at a time agreed with the owner, or use a test copy on another port: the reader opens at its own copy and shows no error.

### Review repairs (10 Nov 2026)

Tests first; the new tests were red before the repairs. Some lines above are now out of date: this section is the current state.

1. **Infinity and NaN.** `position_clean` now asks `math.isfinite` for every number. `Infinity`, `-Infinity` and `NaN` give 400. The record is written with `allow_nan=False`, and the two answers are made with `allow_nan=False`. `position_read` refuses a file with such a value (`parse_constant`), so `/library.json` stays strict JSON. Test: `test_position_infinity_and_nan_are_refused`.
2. **Times and the order of saves.** The voice server no longer trusts the reader clock for the order. The reader still sends `t` (its clock). The voice server keeps it as `ct`, and never later than its own clock. A `t` of 9e12 becomes the time of the save. `t` in the kept record is now the voice server's time of the save. A save is not written when its `ct` is older than the kept `ct`. A clock that was ahead can therefore not lock the later saves. Test: `test_position_far_future_time_does_not_lock_later_saves`.
   The library: `progressFrom(server, browser)` in `app/library-model.js` replaces `newerProgress`. It shows the voice server copy when there is one, because every page shares that copy. The browser copy is used only for a Book that has no voice server copy, and its time is dropped. So the "Recently read" order and the Continue choice compare only voice server times (`opened` and `position.t`).
   The reader: the rule for "the newer of the own copy and the voice server copy" (`newerPosition` in `extension/pdf/position.js`) is as follows. The copy with the later time wins. Both times are clocks of this one Mac: the own copy has the browser clock, and the voice server copy has the voice server's time of the save. A time more than 60 s in the future is not trusted and counts as 0. A copy with no time also counts as 0. At the same time, the own copy stays. So a bad clock cannot make a stale copy win for ever. The own copy keeps its old time when the place did not change, so a pause or a close with no move does not make an old place look new.
3. **The answer of a send.** `sendPosition` reads the answer. When the voice server keeps another place, the reader keeps it as "the place that the voice server has". The reader never sends its older place again. When the owner has not moved since the send and the voice is not reading, the reader goes to the kept place and writes its own copies (`adoptPosition`). A place that is the same as the last place sent or kept is not sent again. So a tab left open on an old place does not write that place over the place of another tab when it closes.
4. **Sends wait for the answer.** `positionFromServer` now gives the answer with no time limit, and also the 3 s wait for the read-in. Sends are held until the answer comes or fails. When the answer comes after the read-in, `positionAnswer` checks the answer. If it is newer and the owner has not moved, the reader goes there and drops the held place. Otherwise the held place goes. An answer for an older open is dropped (`positionOpen`).
5. **Timer and warning.** The 3 s timer is cleared when the answer comes. On every null path (no answer, an HTTP error or 3 s) the reader writes a `console.warn` and shows no message for the owner.
6. **Content-Length.** The POST handler now gives 400 when Content-Length is not a whole number (negative, text or `1e3`). It never calls `rfile.read(-1)`. This holds for all POST routes. Test: `test_position_bad_content_length_is_a_400` (raw socket).
7. **A voice server copy with no first words.** It is used only when its sentence is inside the Book (`i < number of sentences`). Otherwise the own copy is used.
8. **Known point:** `GET /library/<id>/position` has no origin check, the same rule as `GET /library/<id>/notes` and `/library.json`. The Host check (127.0.0.1 or localhost only) still applies.

Changed in this round: `voice-server.py` (`import math`; `position_read`, `_no_constant`, `position_clean`; the POST route; the Content-Length check at the top of `do_POST`), `extension/pdf/position.js` (`newerPosition(local, remote, {now, count})`), `extension/pdf/app.js` (the ticket 27 block before `saveProgress`; `saveProgress` keeps the old time when the place did not change; `loadProgress` is split into `loadProgress` and `placeOf`; `openFile` and `parseDocument` lines of the open), `app/library-model.js`, `app/library.js`.

New tests:
- Python: Infinity, -Infinity and NaN (400, and a damaged file gives no position in strict JSON); a far-future `t`; the answer to a refused save is the kept record; a bad Content-Length.
- Node, `reading-position.test.mjs`: a far-future time does not win; a sentence beyond the end with no first words is not used (unit test and reader test); a voice server that hangs, with fake timers (the 3 s path, held sends, a late newer answer is used); a late answer after the owner moved is not used and the held place goes; two tabs in turn on one fake voice server; a kept newer place is taken and the old one is not sent again.
- Node, `library-page.test.mjs`: `progressFrom`; the order uses only voice server times, and a browser time far in the future does not win.

Counts: `python -m unittest tests.test_server`: 29 tests, OK (6 runs in a row, all OK). `node --test --test-timeout=120000 tests/node/`: 486 pass, 0 fail (476 at the first run; the other agent adds tests in parallel).
