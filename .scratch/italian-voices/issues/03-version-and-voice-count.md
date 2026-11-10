# 03: The version and the voice count are on the screen

**What to build:** The add-on popup, the end of the Player bar settings and the settings panel of the reader show one line, for example "Read Aloud 2, version 2.12.0. 5 natural voices, 2 Italian." With an old voice server that has no Italian voice, the line says: "The voice server is old and has no Italian voice. Restart it." With no answer from the voice server, the present "off" message stays.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] One pure function makes the line from the version and the voice list; node tests cover five voices, no Italian voice, and no voice server.
- [ ] The version comes from the add-on manifest at run time. The reader opened from the voice server shows the voice count without a version.
- [ ] The line is in the popup, the Player bar settings and the reader settings panel, in the small status style.
- [ ] `./run-tests.sh` passes.
