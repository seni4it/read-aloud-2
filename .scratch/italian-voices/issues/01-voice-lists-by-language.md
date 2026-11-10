# 01: Voice lists grouped by language

**What to build:** Every voice list shows the natural voices under language headings: "English", then "Italian". The lists are: the settings of the Player bar, the add-on popup, the voice list of the reader, and the voice sampler. The Mac voices stay below. The group comes from the `accent` that the voice server gives for each voice.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] One pure function groups a voice list by language; American and British give "English", Italian gives "Italian", an unknown accent gives a group with the name of the accent.
- [ ] The Player bar settings, the popup, the reader and the voice sampler show the headings, with Sara and Nicola under "Italian".
- [ ] The order inside a group is the order of the voice server.
- [ ] The copy of the function in the web player has a test that keeps it equal to the reader's function.
- [ ] Each heading has a heading or group role for a screen reader.
- [ ] `./run-tests.sh` passes.
