# 04: Choose the Italian voice, and see which voice reads the page

**What to build:** A setting "Voice for Italian" with Sara (default) and Nicola. Italian text is read by this voice when the main voice is English; English text keeps the main voice. The setting is in the Player bar settings, the popup and the reader, and holds in all of them. The Player bar settings also show a line that says which voice reads this page and why, for example "This page is in Italian, so Sara reads it." The reader has this line already.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] The voice rule of ticket 32 uses the stored Italian voice in place of the fixed Sara, in the web player and in the reader; node tests cover Sara, Nicola, English text and text of unknown language.
- [ ] The setting shows only when the voice server offers two or more Italian voices.
- [ ] The Player bar settings show the reason line when the voice that reads is not the chosen main voice.
- [ ] The version in the manifest goes up one time for the whole spec (last ticket).
- [ ] `./run-tests.sh` passes.
