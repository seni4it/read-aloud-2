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

Now there are tests for:

- the speech rewrite (`speech.test.mjs`),
- the ligature repair (`lexicon.test.mjs`),
- the PDF text of the sample PDFs (`pdf-text.test.mjs`),
- the add-on background script (`addon-background.test.mjs`).

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
