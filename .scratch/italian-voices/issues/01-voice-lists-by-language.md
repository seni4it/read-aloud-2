# 01: Voice lists grouped by language

**What to build:** Every voice list shows the natural voices under language headings: "English", then "Italian". The lists are: the settings of the Player bar, the add-on popup, the voice list of the reader, and the voice sampler. The Mac voices stay below. The group comes from the `accent` that the voice server gives for each voice.

**Blocked by:** None (can start immediately)

**Status:** done in code and node tests; not checked in Chrome

- [x] One pure function groups a voice list by language; American and British give "English", Italian gives "Italian", an unknown accent gives a group with the name of the accent.
- [x] The Player bar settings, the popup, the reader and the voice sampler show the headings, with Sara and Nicola under "Italian".
- [x] The order inside a group is the order of the voice server.
- [x] The copy of the function in the web player has a test that keeps it equal to the reader's function.
- [x] Each heading has a heading or group role for a screen reader.
- [x] `./run-tests.sh` passes.

## Work report

**What changed**
- `extension/pdf/language.js`: new `voiceGroups(voices)` gives `[{ name, voices }]`: "English" (American, British) first, then "Italian", then each other accent as its own group, named by the accent. The server order stays inside each group. An empty group is not given. New `voiceGroup(voice)` gives the group name of one voice (for tickets 03 and 04).
- A voice with no `accent` (an old voice server, or the reader's fixed list before the voice server answers) takes its group from the first letter of its id: `a` and `b` give English, `i` gives Italian, any other gives "Other".
- `extension/content.js`: a copy of `voiceGroups`; the Player bar settings show one `h4` heading for each language ("English", "Italian"), then "Russian" (the Mac voice) as before.
- `extension/popup.js`: a copy of `voiceGroups` (the popup is a classic script, and a test runs it as one); one `optgroup` for each language in place of the one "Voices" group; "Russian" stays last.
- `extension/pdf/tts.js`: `ServerEngine` keeps the `accent` of each voice.
- `extension/pdf/app.js`: `fillVoiceSelect()` puts the natural voices in one `optgroup` for each language. The Mac voice list stays flat. `index.html` needs no change.
- `voices.html` (voice sampler): the script is now a module that imports `voiceGroups` from `/reader/language.js` (the voice server serves `extension/pdf` at `/reader/`). One `h3` heading for each language, with a grid of its voices under it.
- `extension/background.js`: no change. `voices()` gives the server list as it is, so `accent` reaches the popup and the Player bar.

**Tests:** `tests/node/voice-groups.test.mjs` (16 tests): the groups, the order, an unknown accent, no accent, `voiceGroup`, the two copies equal to `language.js` (text and result), the Player bar list, the popup list, the reader list (natural and Mac), the accent in `ServerEngine`, and the voice sampler. `./run-tests.sh`: RESULT: PASS.

**Not checked:** the lists in real Chrome (the popup, the Player bar, the reader) and the voice sampler page from the live voice server.
