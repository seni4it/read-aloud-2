# 21. Reader player bar: one row, one main action, one settings panel

GitHub issue: #22
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Use the `key-design` skill (read `book/QUICK_RULES.md`, sub-chapters 1.1, 5.2, 6.1, 6.3, 6.4, 7.4, 10.1, 10.5). It is a private reference: apply the rules, copy none of its content. Follow the Design Direction section of the spec.

Rebuild the player bar of the reader. It holds, on one row: previous sentence, play or pause (the only filled orange control), next sentence, the position slider with sentence count and time left, the speed, the highlight button, the follow button and one settings button. The engine choice, the voice choice and the voice preview move to a settings panel that opens from the settings button. The status text uses the glossary words (for example 'Natural voice ready'), not model names. While the voice server makes the first sentence, the play button shows a spinner. Each control has default, hover, active, disabled and focus states. Each icon button shows a tooltip with its name and its key after 500 ms. Icons are 20 px with 8 px to their text.

## Acceptance criteria

- [ ] At 1280, 1024, 768 and 360 px the player bar is one row and no control is cut or hidden without a way to reach it.
- [ ] The only filled orange control in the reader is the play button.
- [ ] Engine, voice and preview work from the settings panel, and the choice stays after a reload.
- [ ] Press play after a server restart: the play button shows a spinner until sound starts.
- [ ] Each icon button shows a tooltip with its key. Tab reaches each control and the panel closes with Escape and returns the focus.
- [ ] With reduced motion set in the system, no transition runs.
- [ ] Screenshots in light and dark mode at 1280, 1024 and 400 px are in the ticket report, with the list of rules that were applied.

## Blocked by

- 20 (tokens)
- 08 (reader look)
- 03, 05 (they own the player logic in app.js and tts.js)

## Work report

Date: 10 Nov 2026. Status: done in code and tests. The screenshots in light and dark mode at 1280, 1024 and 400 px are for the coordinator (no browser in this run). The check "press play after a server restart" needs the live voice server: it is a manual step below.

### What a person sees now

One bar at the bottom of the reader, one row, from left to right:

1. Contents (shows or hides the side bar, as before).
2. Previous sentence.
3. Play or pause: the round orange button. It is the only filled orange control in the reader.
4. Next sentence.
5. The position slider. Under it, in small grey text: the sentence count ("12 / 340"), the time left, and the voice status on the right ("Natural voice ready", "Making the voice…", or a message such as "The voice did not answer. Press Play to try again.").
6. Speed ("1.1×").
7. Highlight the sentence being read (the pen with a yellow line).
8. Follow: go to the word being read (the target).
9. Settings: a sliders icon and the name of the voice, for example "Heart". It opens the settings panel.

The settings panel opens above the bar, at the right. Its title is "Settings". Under "Voice": "Voice type" (Natural voice or Mac voice), "Voice", and the button "Hear this voice". The × or Escape closes it, and the focus goes back to the settings button. A press outside the panel also closes it. Ticket 22 adds "What to read" to the same panel.

The bar follows the light or dark mode of the system, like the top bar (see "Why the bar follows the mode"). The Ask bar above it follows the mode too; its "Ask Claude" button is the navy main button, and its answer play button is a ring, not a second orange button.

While the natural voice makes a sentence, a ring turns on the play button. It shows only for a wait of more than 300 ms, and it stops at the first word. With "Reduce motion" set in the system, the ring does not turn: a still part ring shows.

Each icon button shows a small dark label after 500 ms of hover or keyboard focus: its name, and its key where it has one ("Previous sentence (←)", "Play or pause (Space)", "Next sentence (→)", "Close (Esc)"). Contents, Highlight, Follow and Settings have no key today, so the label shows the name only. The browser's own tooltip is gone from these buttons, so only one label shows.

Narrow windows: under 800 px the settings button shows its icon only and the time left is hidden (the count stays). Under 480 px the round buttons are 32 px, play is 40 px, the speed list is narrower, and a voice message takes the place of the count. At 360 px the slider keeps about 56 px. The row never wraps and no control is hidden.

The current sentence is no longer printed above the controls. The page shows it with the sentence shade and the word highlight, and Follow brings it back into view. Its text stays in the page for a screen reader.

### Why the bar follows the mode

- One rule says that the top bar and the bottom bar use one colour mode. The top bar is a light surface in light mode, so a navy bottom bar broke that rule.
- In light mode a big navy block under a light page is heavy for slow reading; a light bar keeps the page the strongest element.
- The play button stays orange in both modes. Its navy icon is 7.6 to 1 on the orange, so the button is clear on a light bar too.
- In dark mode the bar is the dark card tone (#18222d), so it stays dark.
- The selection bar over the page text stays navy in both modes: it floats over the white PDF paper and must stand out from it.

### Rules applied (my own words)

- One main action per screen, in the brand colour; every other control neutral. Play is the only filled orange control.
- Few choices in sight: the bar keeps the controls of listening; the voice choices go into one panel that opens only after a press.
- Icons are 20 px; 8 px between an icon and its text.
- Control sizes from one scale: 40 px icon buttons and fields, 48 px for play, 32 px the smallest (narrow windows).
- Each control has default, hover, pressed, disabled and focus states; a disabled control is at most half strong.
- An icon-only button shows its name and its key after 500 ms.
- Hover feedback comes within 100 ms; motion stops when the system asks for reduced motion.
- A wait has a visible sign on the control that started it.
- A panel opens only after a visible action, has 24 px padding, a 12 px corner around 8 px inner corners, its content left aligned, and a visible label above each field.
- Top and bottom bars in one colour mode.
- Words of the glossary in the interface: "Natural voice", "Mac voice", "Voice server"; no "engine", no "helper".

### Visible changes, one by one

1. The bar is one row; the voice status, count and time left are one small line under the slider.
2. Voice type, voice and preview moved from the bar to the settings panel.
3. New settings button with the voice name; new settings panel.
4. Bar colours follow the mode (was navy in both modes).
5. Spinner on play while the natural voice makes the sentence.
6. Tooltips with keys on the icon buttons (the browser tooltips of these buttons are removed).
7. Icons are 20 px (were 22 px). The contents button has a drawn list icon (was the sign ☰).
8. Status words: "Natural voice ready" (was "ready · kokoro" or "ready · GPU"), "Making the voice…" (was "generating…"), "Starting the natural voice…" (was "loading voice model…"), "The natural voice does not answer. The Mac voice reads for now." (was "Natural voices are not answering — using Mac voices for now"), and a plain message for the slow case (was a message with "Kokoro" and "CPU").
9. The options of "Voice type" are "Natural voice" and "Mac voice" (were "Natural voices" and "Mac voices"); its label is "Voice type" (was "Engine").
10. The highlight icon's yellow line comes from the group token (was a colour value in the HTML).
11. The Follow button's "away" ring and the Highlight button's flash use neutral and yellow tokens that work on a light bar.
12. Ask bar: light in light mode, navy "Ask Claude" button, ring play button for answers.
13. Ask pane: "↻ Restart voice server" (was "↻ Restart helper").
14. The current sentence above the bar is hidden on the screen (kept for a screen reader).

### Controls moved

- Engine select (`#engineSel`), voice select (`#voiceSel`), preview (`#previewBtn`): from the player bar to the settings panel.
- Status (`#engineStatus`), count (`#pos`), time left (`#timeLeft`): from the bar row to the line under the slider.
- All ids stayed the same. New ids: `playerControls`, `settingsBtn`, `settingsVoice`, `settingsPanel`, `settingsTitle`, `settingsClose`, `voiceHead`.

### Files changed

- `extension/pdf/index.html` (the player bar and the settings panel; the Ask pane restart text).
- `extension/pdf/styles.css` (player bar, tooltips, settings panel, narrow widths), `extension/pdf/ra2-theme.css` (player rules moved out; Ask bar and answer player follow the mode).
- `extension/pdf/tokens.css`: three new tokens, the same in light and dark: `--dur-spin 800ms` (0 ms with reduced motion), `--delay-tip 500ms`, `--delay-wait 300ms`.
- `extension/pdf/app.js`: wiring only. The settings panel (open, close, Escape, press outside, focus), the spinner state (`setWaiting`, called where the status said "generating…", at the first word, at stop and at a jump while paused), the voice name on the settings button, 20 px icons, and the words of the status. The reading, open, voice and highlight logic did not change.
- `tests/node/highlights.test.mjs`: one expected status text, `'ready · kokoro'` became `'Natural voice ready'` (the same check).
- New: `tests/node/player-bar.test.mjs`.

### Tests

`tests/node/player-bar.test.mjs`, 17 tests:
- the player bar has one row of controls in this order: contents, previous, play, next, position, speed, highlight, follow, settings;
- at 360 px the row fits: the fixed controls and the gaps leave room for the position slider;
- the voice type, the voice and the preview are in the settings panel, not in the bar;
- every element id that a reader script uses is in the page;
- each control of the bar and the panel has a name for a screen reader;
- each icon button of the bar shows a tooltip with its name, and with its key when it has one;
- the icons are 20 px, with 8 px between an icon and its text;
- the only filled orange control of the reader is the play button;
- the player bar follows the light or dark mode of the system, like the top bar;
- each control of the bar has a hover, a pressed, a disabled and a focus state;
- with reduced motion no transition or spinner runs;
- the settings button opens the panel and moves the focus into it; Escape closes it and gives the focus back;
- the voice type and the voice chosen in the panel stay after a reload;
- the preview in the panel says the voice;
- the play button shows a spinner while the natural voice makes the first sentence, until the first word;
- the Mac voice shows no spinner: it starts at once;
- the settings button names the voice that reads.

`./run-tests.sh`: Python PASS; Node 333 tests, 333 pass; `RESULT: PASS`.

### Manual check in a real browser (coordinator)

Use the Chrome test window. Do each step in light and in dark mode, at 1280, 1024, 768, 400 and 360 px.

1. Open the reader and a sample PDF. Check: the bar is one row; nothing is cut; the only orange is play, the slider and the word highlight.
2. Hover each icon button for about half a second: a dark label with its name (and key) shows above it. The label of the last button does not go off the window.
3. Press Tab from the contents button to the settings button: the order is contents, previous, play, next, slider, speed, highlight, follow, settings. Each shows the blue ring.
4. Press Enter on settings: the panel opens and "Voice type" has the focus. Change the voice, press "Hear this voice": the voice speaks. Press Escape: the panel closes and the settings button has the focus. Reload the page: the same voice type and voice.
5. At an agreed time, restart the voice server (it stops the reading for some seconds). Press play at once: a ring turns on the play button until the first word sounds.
6. Set "Reduce motion" (System Settings, Accessibility, Display). Press play with the natural voice: the ring does not turn. Hover a button: the label shows without a fade.
7. Take the screenshots at 1280, 1024 and 400 px in both modes, with the settings panel open in one of them.

### What is left

- Screenshots and the live check of steps 5 and 6 (coordinator).
- Keys for Contents, Highlight, Follow and Settings do not exist; adding keys is a new feature, so the labels show the name only.
- Ticket 22 adds "What to read" and the read-in summary to the panel.

### Review repairs (10 Nov 2026)

Five faults came from the review and the coordinator's browser check. The tests came first.

1. Space and the arrow keys fired while a button had the focus (review item 1). So Space clicked "Hear this voice" and also started or stopped the reading. Now these keep their own Space and arrow keys: each button or link outside the player bar, and each control of the settings panel. Escape still closes the panel. In the player bar, Space stays Play or Pause, also on the highlight button. An earlier test of ticket 07 asks for that: Space must never mark. Tests: "Space and the arrows on a focused button in the settings panel do not start or move the reading", and "Space on a focused button outside the player bar (top bar, side bar) is the button's own; in the player bar it is Play".
2. The status line was a live region (review item 3). A screen reader spoke "Making the voice…" and "Natural voice ready" for each sentence, over the voice. The status line is now a plain text line. A separate hidden line (`#voiceAnnounce`, role status) gets a text only when the state really changes: ready, the Mac voice in use, a fault. It never gets "Making the voice…" or a percentage. The sentence text kept for screen readers (`#nowReading`) is not a live region. Test: "a screen reader hears a voice state only when it changes, not two messages for each sentence".
3. Tab left the open panel and the panel stayed open (review item 4). Choice: no focus trap, because the panel is a light panel beside the bar, not a blocking window. When Tab moves the focus out of the panel, the panel closes, the same as a press outside it. A focus move inside the panel, or a press on the panel itself, keeps it open. Test: "the panel closes when the focus leaves it with Tab; a focus move inside it keeps it open".
4. At 400 px the status was cut to "Natural voice r…" and the slider was about 130 px (browser check item 8). Below 480 px the bar now hides a normal status ("Natural voice ready", "Making the voice…"), so the slider gets the room; the spinner on play still shows a wait. A fault (for example "The voice did not answer. Press Play to try again." or the Mac voice in use) still shows, in place of the count. Test: "below 480 px the bar shows the voice status only for a fault, so the slider keeps its room".
5. The words of the glossary (review item 5, the bar part): see ticket 22.

Manual check (coordinator):
- Open the settings panel. Tab to "Hear this voice" and press Space: only the preview plays. Tab to the × and press Space: the panel closes and the reading does not start.
- Tab out of the panel past its last control: the panel closes.
- At 400 px press play: the bar shows the count, not "Natural voice ready". Stop the voice server at an agreed time: the fault message shows.
- With VoiceOver on, play three sentences: VoiceOver says the voice state once, not for each sentence.

`./run-tests.sh`: Node 357 tests, 357 pass; `RESULT: PASS`.
