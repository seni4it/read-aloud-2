# 04: Choose the Italian voice, and see which voice reads the page

**What to build:** A setting "Voice for Italian" with Sara (default) and Nicola. Italian text is read by this voice when the main voice is English; English text keeps the main voice. The setting is in the Player bar settings, the popup and the reader, and holds in all of them. The Player bar settings also show a line that says which voice reads this page and why, for example "This page is in Italian, so Sara reads it." The reader has this line already.

**Blocked by:** 01

**Status:** done in code and node tests; not checked in Chrome

- [x] The voice rule of ticket 32 uses the stored Italian voice in place of the fixed Sara, in the web player and in the reader; node tests cover Sara, Nicola, English text and text of unknown language.
- [x] The setting shows only when the voice server offers two or more Italian voices.
- [x] The Player bar settings show the reason line when the voice that reads is not the chosen main voice.
- [x] The version in the manifest goes up one time for the whole spec (last ticket).
- [x] `./run-tests.sh` passes.

## Work report

**What changed**

- `extension/pdf/language.js`: `voiceForLanguage(voice, lang, italian = 'if_sara')` takes the stored voice for Italian (a value that is no Italian voice gives Sara). New pure functions `italianVoices(voices)` (the Italian group of the server list) and `voiceReason(chosen, used, lang, place, name)` (the reason line).
- `extension/content.js` (web player): copies of `isItalianVoice`, `voiceForLanguage`, `italianVoices`, `voiceReason`. `voiceFor()` uses `voiceForLanguage` with `cfg.italianVoice`. New stored key `italianVoice` (default `if_sara`) in `DEFAULTS` of `ra2`. Player bar settings: a status line `voiceWhy` (role status) under the voice list, and a group "Voice for Italian" (buttons with `aria-pressed`, group labelled by its heading), shown only with two or more Italian voices from the server list. A press stores the key, updates the line, and reads the present Sentence again when the voice changes.
- `extension/popup.html`, `extension/popup.js`: a labelled select "Voice for Italian", hidden with fewer than two Italian voices; a change stores only the `italianVoice` key, read fresh. Copy of `italianVoices`.
- `extension/pdf/index.html`, `extension/pdf/app.js` (reader): a labelled select "Voice for Italian" in the voice group of the settings panel; `readingVoice()` uses the stored voice (Sara when the natural voice does not offer it). The voice hint now comes from `voiceReason(..., 'book', name)`; the words are the same as before.
- `extension/manifest.json`: version 2.11.0 to 2.12.0. A grep for 2.11.0 (not vendor) found no other file that repeats the version; only history text in `.scratch` notes, which was not changed.
- Tests: new `tests/node/italian-voice-choice.test.mjs` (32 tests). `tests/node/voice-groups.test.mjs` and `tests/node/version-line.test.mjs`: their small harnesses got a stub (`showItalian`, `fillItalianSelect`) for the new call; no test was changed in what it checks.

**How the setting holds in all places:** the same way as the Speed method of ticket 06. The web player and the popup use `chrome.storage.sync` `ra2.italianVoice`. The reader of the add-on reads that key at the start and writes only that key on a change; it also keeps `localStorage` `ra2.italianVoice`. The reader opened as a plain page from the voice server has no `chrome.storage`: it keeps its own value in `localStorage` only.

**Tests:** `./run-tests.sh` gives `RESULT: PASS` (Python PASS, Node 645 tests pass, after the review repairs below).

**Not checked:** nothing was checked in Chrome. The reader's old `voiceHint` line keeps no status role (an old test checks its exact tag); the new Player bar line has the status role.

### Review repairs (five points and the reason line)

1. Web player (`extension/content.js`): it keeps the last `/voices` list (`natVoices`, from the settings and from the voice server retry). The stored voice for Italian reads only when that list has it; else Sara. Before the list is known, Sara reads, and the first Italian Sentence asks the list once (`natAsked`). English text and a stored Sara ask nothing. This is the same rule as `italianFor()` in the reader.
2. Reader (`extension/pdf/app.js`): new `watchItalianVoice()`. It reads `ra2.italianVoice` at the start, and it listens to `chrome.storage.onChanged`. A change sets the value, writes localStorage, fills the select, updates the voice name and the hint. With no `chrome` it does nothing and does not throw.
3. Reader: the first read is ignored when the owner already chose in this reader (`italianChosen`).
4. Reader: `setItalianVoice()` restarts the Sentence only when `readingVoice()` changed. An English Book reads on. A value from the add-on storage is not written back.
5. Reader: the voice name is cut at the comma too. So "Sara, Italian female · Italian" gives "Sara" in the hint and on the settings button. A test uses the real option text.
6. Player bar reason line: when the voice list of the open settings says that the voice server is off, the line says that the voice server does not answer and names the Mac voice. `natOff` is not set.

Tests: `tests/node/italian-voice-choice.test.mjs` now has 39 tests.
