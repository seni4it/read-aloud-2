# Testing

## Run all tests

Run one command at the root of the project:

```sh
./run-tests.sh
```

It runs the voice server tests and the browser logic tests. The last line says `RESULT: PASS` or `RESULT: FAIL`. The exit code is 0 for a pass and 1 for a fail.

The command installs no package and uses no network. It does not start, stop or change the live voice server.

## Voice server tests

These are in `tests/test_server.py`. They use the Python standard library only. Each test starts the server on a free port, with a temporary library and no voice model.

## Browser logic tests

These are in `tests/node/*.test.mjs`. They use the test runner that comes with Node (`node --test`). Every file in that folder runs. To add a test, add a file there.

The tests import the real files of the reader, for example `extension/pdf/speech.js` and `extension/pdf/lexicon.js`. These files are ES modules, and Node loads them with no change. In the page, `fetch()` loads the word list. Node cannot fetch a file URL, so the tests read `extension/pdf/vendor/lexicon.txt` from the disk and give it to the same `loadLexicon()` function.

Some of the tests:

- the speech rewrite (`speech.test.mjs`),
- the ligature repair (`lexicon.test.mjs`),
- the PDF text of the sample PDFs and made pages (`pdf-text.test.mjs`, `pdf-layout.test.mjs`, `pdf-said-right.test.mjs`, `pdf-lost-lines.test.mjs`),
- scanned pages (`scanned-pages.test.mjs`),
- the highlights and the open of a PDF in the reader (`highlights.test.mjs`),
- the add-on background script (`addon-background.test.mjs`).

The file name of each test says what it covers. Each file starts with a comment that says more.

## Sound memory size

The reader keeps the sound of the Sentences it made, up to 64 MB (`SOUND_MEMORY_MB` in `extension/pdf/tts.js`). The Sentence that was used least recently goes out first. The Sentence that plays now and the Read-ahead Sentences never go out. The tests are in `tests/node/sound-memory.test.mjs`.

`node tests/pdf-text/audio-cache-size.mjs` prints the limit, how many Sentences of the sample PDFs fit in it, and the most that the memory can hold. That last number is an estimate: the limit plus the three longest Sentences (the one that plays and the Read-ahead). The true number can differ a little, because the voice server engine splits a long Sentence in two pieces. Add `--private` to include the private books. It prints numbers only, and needs no voice server.

## Test window

`tools/test-window.sh` starts a separate test browser with the add-on loaded from `extension/`. Use it for a check by hand, or for a script that uses the DevTools protocol on port 9333.

```sh
tools/test-window.sh [url]   # start the test browser
tools/test-window.sh stop    # stop it
```

- The test browser is the program in the variable `RA2_TEST_CHROME`. When that variable is not set, the script uses the newest Chrome for Testing (or Chromium) in the folders of Puppeteer (`~/.cache/puppeteer`) or Playwright (`~/Library/Caches/ms-playwright`). When it finds none, it stops with a message. It never uses your own Chrome: it refuses a program in `Google Chrome.app`, also through a symbolic link, and any program in an app with the bundle id `com.google.Chrome`.
- The browser gets its own profile folder in the temporary folder of your user (`$TMPDIR`, or `~/.cache/read-aloud-2-test-window` when `TMPDIR` is not set), or the folder in `RA2_TEST_PROFILE`. It starts with `--use-mock-keychain`, so no keychain question comes. The script refuses a profile folder that is a symbolic link or that belongs to another user.
- The script starts the program directly and writes its process number (PID) to a file. `stop` stops only that process, and only when it still runs with the test profile folder. The script never uses `pkill`, `killall`, `open -a` or `osascript`, so it cannot touch your own Chrome.
- A start stops the test browser that the script started before. When another program listens on port 9333, the script stops with a message and changes nothing. It checks the port with `lsof`, or `nc` when there is no `lsof`; with neither, it stops with a message.

## PDF text comparison check

Use this check before and after a change to the PDF text rules in `extension/pdf/extract.js`.

```sh
node tests/pdf-text/compare.mjs
```

The check runs the real text code of the reader, with the vendored pdf.js, on each sample PDF. It writes the sentences of each PDF to one text file, with one sentence on each line. Then it prints the difference against the kept reference file.

- Public samples are in `tests/pdf-text/samples/`. Their references are in `tests/pdf-text/reference/`. The new text goes to `tests/pdf-text/out/`, which git does not keep.
- Private books stay outside the repository. Put them in the folder `~/read-aloud-samples`, or name another folder in the variable `READ_ALOUD_SAMPLES`. Their references go to `reference/` in that folder, and their new text goes to `out/` in that folder.

Read each difference. A change is good when no sample reads worse. Then keep the new text as the reference:

```sh
node tests/pdf-text/compare.mjs --update
```

The public samples are small PDFs that we made ourselves, so they can be public. They show two columns, lines that start with a number, ligature words and hyphens at line ends. To change them, edit `tests/pdf-text/make_samples.py` and run it with `python3`. Then update the references.

Do not put a book of the owner, its title or its path in the repository.

## Add-on copy on the disk inside the Mac

Chrome loads the add-on unpacked from a folder. When the project is on an external disk and that disk is not ready when Chrome starts, Chrome removes the add-on from its list. So Chrome loads the add-on from a copy in the home folder, not from `extension/`.

```sh
tools/sync-addon.sh
```

The script makes `~/read-aloud-2/extension` equal to `extension/` with `rsync`. Set `RA2_ADDON_COPY` for another folder. A git `post-commit` hook that calls the script keeps the copy up to date after each commit; the hook is local and is not in the repository. After a change, reload the add-on in `chrome://extensions`, then reload each open page.
