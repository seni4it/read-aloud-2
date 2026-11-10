# 03: The version and the voice count are on the screen

**What to build:** The add-on popup, the end of the Player bar settings and the settings panel of the reader show one line, for example "Read Aloud 2, version 2.12.0. 5 natural voices, 2 Italian." With an old voice server that has no Italian voice, the line says: "The voice server is old and has no Italian voice. Restart it." With no answer from the voice server, the present "off" message stays.

**Blocked by:** 01

**Status:** done in code and node tests; not checked in Chrome

- [x] One pure function makes the line from the version and the voice list; node tests cover five voices, no Italian voice, and no voice server.
- [x] The version comes from the add-on manifest at run time. The reader opened from the voice server shows the voice count without a version.
- [x] The line is in the popup, the Player bar settings and the reader settings panel, in the small status style.
- [x] `./run-tests.sh` passes.

## Work report

**What changed**
- `extension/pdf/language.js`: new pure function `versionLine(version, voices)`. It counts the Italian voices with `voiceGroups()`. `voices` null or undefined means no answer from the voice server: the line then gives the version only (or nothing), and the present "off" message stays where it was.
- `extension/popup.js`, `extension/popup.html`: a copy of `versionLine()`; a new line `<p id="version" role="status">` under the `#server` line, in the same small muted text style. The version is `chrome.runtime.getManifest().version`.
- `extension/content.js`: a copy of `versionLine()`, and `addonVersion()` that reads the manifest in a try (an old tab gives no version and no throw). `menu()` writes the line in `<p class="ver" id="verLine" role="status">` at the end of the Player bar settings, after "Move player". Style: 12 px muted text with the present tokens.
- `extension/pdf/app.js`, `extension/pdf/index.html`: `addonVersion()` (no `chrome.runtime` on the plain page of the voice server: no version) and `showVersionLine()`, called when the settings panel opens. It uses the voices of the started natural voice; when the Mac voice reads, it asks `/voices` once (3 s limit). The line is `<p class="status" id="versionLine" role="status">` at the end of the panel.

**Tests**
- New `tests/node/version-line.test.mjs` (20 tests): the line for five voices, an old voice server, no voice server, no version, one voice; the two copies are equal; the popup, the Player bar menu (also an old tab where `getManifest` throws) and the reader line on fake pages; no fixed version number in the code.
- `tests/node/voice-groups.test.mjs` and `tests/node/speed-method.test.mjs`: the fake `chrome.runtime` now has `getManifest`, and the Player bar menu test loads the new functions.
- `./run-tests.sh`: RESULT: PASS (605 node tests).

**Not checked**
- Not checked in Chrome (the look, the screen reader, the real manifest version).
