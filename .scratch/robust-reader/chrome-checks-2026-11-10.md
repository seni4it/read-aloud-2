# Checks in a real Chrome, 10 Nov 2026

## How the checks ran

The checks ran in Chrome for Testing 156 (the Playwright copy in `~/Library/Caches/ms-playwright/chromium-1248`), in a visible window with its own new profile in the scratch folder of this session. The owner's Chrome was not touched. The add-on loaded from `extension/` with `--load-extension` and `--disable-features=DisableLoadExtensionCommandLineSwitch`. Its id in the test profile was `mnedlghmdlfdffmboebpnjmopbdhgbkd`, version 2.9.10.

A Node script drove the window over the DevTools protocol on port 9333. The reader and library checks used the live voice server on port 8793, with the sample Book only (id `0d281938d3ff`). The web checks used made pages from a static server on 127.0.0.1:8823.

Three start problems, for the next run:

- `tools/test-window.sh` was not used. It names `chromium-1247`, which is not installed now (only 1234 and 1248). It also uses `pkill` and `open -na`.
- Chrome must start outside the tool sandbox of Claude Code, or its pages do not load.
- Chrome for Testing needs `--use-mock-keychain --password-store=basic`. Without them, the network part of Chrome waits for the Mac keychain, and no `http://` page ever loads. The tab stays blank with no error. The first tries of this run had this fault. A keychain question for "Chrome for Testing" may have shown on the screen at about 01:15 to 01:28. Those Chrome copies were stopped.
- With the window behind other windows, Chrome marks the tab as hidden, and mouse input to it waits forever. Start with `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding`.

The agent cannot hear the sound. "The voice goes on" means that the add-on or the reader reported play, and the word highlight moved word by word.

## A side effect to clean up

The test made one Highlight on the sample Book in the group "Important". The owner's setting "Key points to Claude" sends each new Highlight of that group at once to the folder of a chosen conversation. So the voice server made this new file:

`<folder of another project>/key-points/Sample paper - Trace-based JIT.md` (559 bytes, 10 Nov 01:36)

It holds one test key point from the sample paper. The file was not removed, because it is in the atlas project. Remove it, or ask the atlas main chat to remove it, before that project commits. The Highlight itself was removed from the sample Book (the list on the server is `[]` again). For later runs: mark Highlights in a group that is not sent, or turn "Key points to Claude" off first.

## Counts

- PASS: 68 lines
- FAIL: 5
- NOT RUN: 18 lines, about 45 single steps

## FAIL

1. Ticket 22, step 5 (top bar). FAIL. Steps: open the reader of the sample Book at 1280, 1024, 800 or 768 px. Seen: the top bar shows "Try sample" next to "Library" and "Open PDF", so it has 6 controls (−, 100 %, +, Library, Open PDF, Try sample). The button has the `hidden` attribute (`sampleBtn.hidden` is true), but its computed display is `flex`. A `.btn` display rule wins over `[hidden]`. At 600 px and less the button is gone, because of the rule `.topbar #sampleBtn { display: none; }`. Console: none. Likely file: `extension/pdf/styles.css` (the `.btn` rule needs `[hidden] { display: none }` or the same rule at every width). Screenshot: `reader-800-dark.png` in the scratch shots folder.

2. Ticket 21, steps 1 and 2 (bar inside the window). FAIL. Steps: open the reader, make the window 800 px or 400 px wide. Seen: the page can scroll sideways. `document.documentElement.scrollWidth` is 832 at 800 px, and 448 at 400 px. `window.scrollTo(48, 0)` moves the page 32 px. The overflow comes from `#player`: with it hidden, the width is 800 again. `#playerControls` has `scrollWidth` 824 for a width of 784. Its last child is `#settingsBtn`, at the right edge. The likely cause is the label (the `data-tip` `::after` box) of the settings button. It stays in the layout when it does not show, and it goes past the right edge of the window. At 1280 px the settings button is wide ("Heart, warm female"), so there is no overflow. Console: none. Likely file: `extension/pdf/styles.css`, the tooltip rules for `[data-tip]` (the last button needs its label aligned to the right, or the box needs `position: fixed` or a `display: none` while it is hidden).

3. Ticket 24 or 25 (web player, Previous and Next sentence). FAIL. Steps: open `article.html` (48 made sentences, each ends with "sentence number N"). Press the round Listen button. Let it read for 2 s. Press "Previous sentence" in the web player bar. Seen, in 5 tries: the sentence shade and the word highlight go to the NEXT sentence (for example from sentence 38 to 39, and from 30 to 31), and not to the start of the same sentence or the one before. "Next sentence" moved 2 or 3 sentences in 3 of 4 tries (15 to 18, 31 to 34, 34 to 36). A click listener in the shadow root recorded one click on `back` with `detail` 1, so the click came once. With the reading paused, the first press of Next starts the reading, as designed. One event log taken in the content script world shows no new `start` event at the Previous press. The `end` event of the sentence then came normally. This needs a check by ear. Console: none. Likely files: `extension/content.js` (`back()` at line 372, the `fwd` click, `onEvent`) and `extension/offscreen.js` (an `end` event that comes for the new sentence id when the old audio is stopped).

4. Console error on every load of the reader over the voice server. FAIL. Steps: open `http://127.0.0.1:8793/reader/index.html?lib=0d281938d3ff…`. Console: `Failed to load resource: the server responded with a status of 404 (Not found) http://127.0.0.1:8793/icons/48.png`. The page icon is `<link rel="icon" href="../icons/48.png">`. In the add-on this is the `icons` folder. The voice server serves only `extension/pdf` at `/reader/`, so `/icons/48.png` is not there. Likely file: `extension/pdf/index.html` line 7, or a route in `voice-server.py`.

5. Add-on on its own pages (found in this run, not in a ticket list). FAIL. Steps: with the add-on loaded, open the reader or the library page at 127.0.0.1:8793. Seen: the round Listen button of the add-on shows on the right edge of the reader (over the PDF page) and on the library page. In the reader, the Tab key goes from the settings button of the player bar to the `RA2-ROOT` element of the add-on. In the library, the Tab order goes through it after the last card. The owner sees two players in one window. Console: none. Likely file: `extension/content.js` (no rule that skips the reader and library pages of the voice server; `hiddenHere()` uses only the owner's "Hide on this site" list). Screenshot: `reader-1280-light-start.png`.

## PASS

### Reader (sample Book, 127.0.0.1:8793/reader/)

- Reader: Play starts the reading; the status says "Natural voice ready"; the button label changes to "Pause". PASS
- Reader: the Word highlight (`.word-box`) moves word by word and line by line during play, and the sentence underline (`.speaking`) follows. PASS
- Reader: Pause stops it; after 1.5 s the sentence number is the same. PASS
- Reader: Next and Previous buttons, and the Arrow Right and Arrow Left keys, move one sentence each way. PASS
- Reader: Follow. The mouse wheel during play stops the follow, and the target button gets the class `away`. A press on the target button brings the word back into view and follows again. PASS
- Ticket 03, step 2 (speed): a change from 1.1× to 1.5× during play goes on from the same sentence. PASS
- Ticket 03, step 1 (seek bar): a move of the seek bar during play goes on from the new place (sentence 13 to 138, still playing). PASS
- Ticket 03, step 4 and ticket 22, step 6: a text file with the name `not-a-pdf.pdf` gives the message "Could not open "not-a-pdf.pdf": it is not a PDF, or it is damaged." The open Book stays, with 277 sentences and Play usable. PASS
- Ticket 04, step 2: `Cmd` and `+` three times (145 %), then `Cmd` and `0`, during play: the word box stays on the sentence and in view. The sample Book has about 12 pages, not 300. PASS
- Ticket 04, step 3: the window made narrower (700 px) and wider during play: the word box stays on the sentence. PASS
- Ticket 08 (reflow): at 1280 px with page 3 at the top, then 400 px, then 1280 px, then the side bar opened and closed: all pages have one width each time, and page 3 stays in view. PASS
- Ticket 08 (dark mode): the word box is orange with `mix-blend-mode: multiply` on the white paper. PASS
- Ticket 21, step 1: the player bar is one row at 1280, 1024, 800, 768, 400 and 360 px, in light and in dark mode. Nothing is cut. At 400 px the bar shows the count and no "min left". PASS
- Ticket 21: button sizes: play 48 by 48 px; contents, previous, next, highlight, follow 40 by 40 px; speed and settings 40 px high. PASS
- Ticket 21, step 2: hover labels show ("Next sentence (→)", "Voice and settings") with opacity 1. PASS
- Ticket 21, step 3: Tab order contents, previous, play, next, slider, speed, highlight, follow, settings, each with a 3 px blue ring. PASS
- Ticket 21, step 4: Enter on settings opens the panel and "Voice type" (`engineSel`) has the focus. Escape closes it, and the settings button has the focus. A changed voice is the same after a reload (it was put back after the check). PASS
- Ticket 21 (manual list): the × closes the panel and the reading does not start; Tab out of the last control (`exportBtn`) closes the panel. PASS
- Reader dark mode (emulated `prefers-color-scheme: dark`): page `rgb(14, 20, 27)`, player bar `rgb(24, 34, 45)`, play orange `rgb(255, 140, 0)`. The top bar and the bottom bar follow the same mode. PASS
- Ticket 22, step 3: the side bar tabs "Contents", "Highlights (0)" and "Ask" are not cut. PASS
- Ticket 22 (manual list, 800 px): the side bar starts closed; the contents button opens it over the page with a shadow; Escape closes it; a press on the page closes it. Note: the press on the page also starts the reading at that word. PASS
- Ticket 22 (manual list, 400 px): the top bar shows the mark, the title with "…", −, 100 %, +, the Library icon and the folder icon. PASS
- Ticket 22, step 2: during play the contents entry of the part read is marked (grey row, orange bar), seen in the screenshots. PASS
- Reader console: no error during play, pause, seek, zoom, settings and the Highlights checks, except FAIL 4. PASS

### Highlights

- Ticket 19 (save number, two tabs): tab A and tab B read the sample Book (save number 0). Tab A marks a sentence and saves (number 1). Tab B marks another sentence: the save gets 409, and tab B shows "Another window saved the highlights of this book after this window read them. Your last change was not saved. The list now shows the saved highlights." Its list then shows the Highlight of tab A. PASS
- Ticket 07, step 1: a click on the underline with the reading stopped opens its menu ("Remove underline", the groups), and the reading does not start. PASS
- Ticket 07, step 10: a click 4 px above the underline starts the reading at that place, and the menu does not open. PASS
- Ticket 07, step 4: in the Highlights tab, Tab goes from the text of the Highlight to its × ("Delete this highlight", 3 px ring). Enter on × removes it; the last one gone, the focus goes to the mark button. PASS

### Library page (127.0.0.1:8793/app/)

- Ticket 23: the page opens on "Continue listening" with the sample Book, then "Other books" and the cards. No offline or empty message. PASS
- Ticket 23, step 1: the Continue button opens the reader at the saved sentence (20 / 277, the same as before). PASS
- Ticket 23, step 3: Tab order search, order, More, Add PDF, Continue, then each card and its ×, each with a 3 px ring. PASS
- Ticket 23, step 4: Enter on More opens the menu; Arrow down goes to "Restart the voice server", then "Show YouTube uploads"; Arrow up goes back; Escape closes it and More has the focus. A click outside closes it. PASS
- Ticket 23, step 5: "Show YouTube uploads" opens the panel at the top; Close closes it. PASS
- Ticket 23, step 7: at 400 and 320 px no control of the top bar goes out of the window; below 1000 px the bar has 2 rows; no sideways scroll at 1280, 1024, 800, 400, 320 px, light and dark. Note: at 400 px the Continue button fills the text column beside the cover (224 px of a 368 px block), not the whole block. PASS
- Ticket 23, step 2 (part): each card has a `title` with the full name. PASS
- Ticket 17, step 2: 5 letters typed in the search send no `/export` request (and no cover request). The message "No book matches “zzqxw”." shows, and the Continue block goes away. PASS
- Library dark mode: the page follows it (`rgb(14, 20, 27)`). PASS
- Library console: no error. PASS

### Add-on on a web page (made article, 48 sentences)

- Web: the round Listen button is on the right edge; a press starts the reading; the bar shows at the bottom. PASS
- Web: the sentences are read in order (shade and word highlight move through sentences 1, 2, 3 … in order). PASS
- Web: the word highlight (`CSS.highlights` "ra2-word") moves word by word inside the shaded sentence. PASS
- Ticket 24, step 2: bar order previous, play (orange), next, position, speed, follow, settings, close. PASS
- Ticket 24, step 3: same look as the reader: round buttons 40 by 40 px, play 48 by 48 px, white bar in light mode. The speed button is 74 by 42 px. PASS
- Ticket 24, step 4: in dark mode the web bar is `rgb(24, 34, 45)`, the same as the reader bar; play stays orange. PASS
- Ticket 24, step 5: hover label "Next sentence" shows. PASS
- Ticket 24, step 6: Speed opens its list above the button; 1.5× sets "1.5×" and the list closes. PASS
- Ticket 24, step 7: the settings panel shows Voice and Move player; Escape closes it. PASS
- Ticket 24, step 8: with the focus on the settings button (3 px ring), Enter opens the panel and the panel has the focus. PASS
- Ticket 24, step 9: at 1280, 1024 and 400 px, light and dark, the bar is one row and on the screen (at 400 px it is 384 px wide from x = 1). PASS
- Ticket 24, step 1 (part): on a dark made site with the system in light mode, the bar is white, as the reader bar. PASS
- Ticket 24, step 10 and ticket 18: the add-on window (opened as a tab): one orange button "Listen to this page" at the top, then Voice and Speed, then "Settings" with six rows (words left, box right), then grey links. PASS
- Ticket 18, steps 2 and 3: a click on the words of each of the six rows changes it; after a new open each value is kept. All values were put back. PASS
- Ticket 24, step 11: "Listen to pasted text" has one orange "Listen" button. PASS
- Ticket 25, steps 3 and 4: a drag of the bar snaps it to the left (vertical, 84 by 380 px), right, top and bottom. PASS
- Ticket 25, step 5: a short click on play still pauses; a drag that starts on Next does not start the next sentence. PASS
- Ticket 25, step 6: the place is kept after a reload, and also after a restart of the test Chrome. PASS
- Ticket 25, step 7: a place set in a second tab is used by the first tab at its next show. PASS
- Ticket 25, step 8: left place at 400 px wide stays left; at 400 by 300 px the bar shows at the bottom; at full size it goes back to the left. PASS
- Ticket 25, step 9: Settings, Move player, Bottom moves the bar to the bottom, and "Bottom" is pressed. PASS
- Web Follow (window): the wheel during play stops the follow (target `away`); the target button brings the word back. PASS
- Ticket 14, step 2 (text in a box): the box scrolls with the voice; the wheel stops the follow and marks the target; the target brings the box back to the word. PASS
- Ticket 14, step 3 (transform on the body): the bar is at the bottom of the window and the Listen button at the right edge. PASS
- Ticket 13, step 3: "The first study by Smith et al. reported …" and "The work of J. R. Smith …" are each one sentence, one shade. PASS
- Ticket 13, step 8: "The pupil got Grade A." and "The office is in Fresno, CA." end there; the next sentence is shaded alone. PASS
- Ticket 13, step 4: three lines with `<br>`: the word highlight is on the correct line after each break. The pause is not heard. PASS
- Ticket 15, step 2: no request to the voice server during load, scroll and mouse moves over paragraphs (DevTools Network on the add-on pages). The pointer on the Listen button sends the warm-up (`/speak` of the first two sentences). The first word highlight came 103 ms after the press. PASS
- Ticket 16, step 2 (short form): reading in a second tab hides the bar of the first tab, and the first tab does not start again. Not run for 30 s. PASS
- Web console: no error on the made pages (only a 404 for `favicon.ico` of the static server). PASS

## NOT RUN

- Ticket 03, step 3 (Preview then Play at once), step 5 (two PDFs at once), step 6 (scroll during the read-in of a large PDF): no large PDF that may be used; not done in this time.
- Ticket 03, step 7 and ticket 05, all steps; ticket 21, step 5; ticket 23, steps 6 and 8; ticket 17, steps 4 to 6; ticket 07, step 12; ticket 12, step 3: they stop or restart the voice server, which this run must not do.
- Ticket 05, step 5 and step 8 (`VOICE_LOG=1`) and step 9 (Bluetooth): no server log, no headphones.
- Ticket 04, steps 11 and 12: they need the DevTools counts of a long PDF.
- Ticket 07, step 2: not done in this time. Step 3 (mark button with Enter and Space) and step 5: not done, because each new Highlight in the default group is sent to a conversation folder (see "A side effect"). Step 11: it opens a second PDF on the Book page.
- Ticket 08, full focus-ring walk of the side bar, Ask bar and selection bar at three widths: only the player bar and the library were walked.
- Ticket 12, steps 1, 2 and 4: no scanned PDF that may be used.
- Ticket 13, step 2 (long address in at most 3 pieces): the shade showed the address as its own piece, but the pieces cannot be counted by ear. Steps 5 and 7 (selections): not done.
- Ticket 14, step 1 (content replaced): not done in this time.
- Ticket 15, steps 1 and 3: the Performance panel and the Task Manager need a person.
- Ticket 16, steps 1, 3, 4 and 5: they close the sound page, change the manifest, or need the server while it loads.
- Ticket 17, step 3 (cover requests) and step 7 (placeholder): the sample Book has a cover.
- Ticket 18, step 4: needs the real popup from the toolbar on a `chrome://` page; opened as a tab, the popup itself is the active tab. Step 5: VoiceOver.
- Ticket 20: the full colour audit in screenshots at 1280, 1024 and 400 px: screenshots were taken (see below), the audit was not done.
- Ticket 21, step 6 and ticket 25, step 10: "Reduce motion" is a system setting.
- Ticket 22, step 1 (10 entries at 768 px height), step 4 (skip settings and re-read, export audio), step 7: not done in this time.
- Ticket 24, step 1 with real sites: no network except 127.0.0.1.
- All VoiceOver steps (tickets 07, 18, 21).

## Screenshots

In the scratch folder of this session, `shots/`: reader at 1280, 800 and 400 px in light and dark, reader during play (light and dark), settings panel open (light and dark), library at 1280, 800 and 400 px (light and dark; they show the owner's book covers, so they stay out of the repository), web bar at 1280, 1024 and 400 px (light and dark), the bar at the left edge, the add-on window (light and dark), and the paste page.

## Second run after the repairs

Date: 10 Nov 2026, later the same night. The setup was the same as in the first run: Chrome for Testing 156, started directly as a binary with a new profile folder in the scratch folder, port 9333, and `--use-mock-keychain --password-store=basic` from the first start. No keychain question came, and every page loaded at once. The add-on loaded from the working tree of `extension/`, so the repairs of FAIL 3 and FAIL 5 that are not committed yet were in the test. This run made no Highlight. The Highlights list of the sample Book on the server is `[]` at the end.

### The five old FAILs

- FAIL 1 (ticket 22, "Try sample"): PASS. At 1280, 1024, 800 and 601 px the button has the `hidden` attribute and its computed display is `none`. The top bar has 5 controls at each width.
- FAIL 2 (ticket 21, sideways scroll): PASS. At 1280, 1024, 800, 601, 600, 400 and 320 px, `document.documentElement.scrollWidth` equals `innerWidth`. That was also true while the label of the settings button (the last control), of the contents button (the first control) and of the follow button showed, on hover and on focus. The library page has no sideways scroll at 1280, 800, 400 and 320 px.
- FAIL 4 (icon 404): PASS. No response of 400 or more on the reader load, and no console message about the icon.
- FAIL 5 (add-on on its own pages): PASS. The reader page and the library page at 127.0.0.1:8793 have no `ra2-root` element and no Listen button. In the reader, Tab from the settings button goes to the page body. In the library, Tab from the last × goes to the page body. The made article on 127.0.0.1:8823 still gets the `ra2-root` element and the Listen button.

### FAIL 3: Previous and Next in the web player

The test page had 30 sentences of three lengths, one after the other. "Sentence N is short." takes about 1.3 s. "Sentence N has a middle length …" takes about 3 s. "Sentence N tells a long story …" takes 7 to 12 s.

How the clicks were made: with `Input.dispatchMouseEvent`. One `mouseMoved`, one `mousePressed` and one `mouseReleased` (left button, `clickCount` 1) went to the centre of the button, measured with `getBoundingClientRect()` inside the closed shadow root just before each click. There was one click for each press.

What was recorded:

- every 100 ms, the sentence and the word that the add-on highlights (`CSS.highlights` "ra2-sentence" and "ra2-word");
- the add-on events that reach the page, logged in the content script's isolated world: `times`, `start`, `end`, `stopped`, `error`, and every tenth `tick`;
- the network of the add-on's offscreen page (the `/speak` and `/times` requests) and its console. The offscreen console had no message.

The voice was the natural voice `af_heart`, played by the offscreen page. The Mac voice was not used.

- (a) One Previous during sentence k (k from 4 to 11): PASS, 5 of 5. Each time, the highlight went at once (within 10 ms) to sentence k − 1, at its first word "Sentence". It stayed there until that sentence's own `end` event. Only then did sentence k start. Example: Previous at 6602 ms. Sentence 3 `start` at 6618 ms. Sentence 3 `end` at 7917 ms. Sentence 4 `start` at 7939 ms.
- (b) One Next: PASS, 5 of 5. Exactly +1 each time (2→3, 7→8, 10→11, 13→14, 16→17), at the first word of the sentence.
- (c) Two Nexts 150 ms apart: PASS, 5 of 5. Exactly +2 each time (4→6, 8→10, 11→13, 14→16, 17→19).
- (d) Pause, then Next, then Play: PASS, 1 of 1. The reading was paused at sentence 19. Next started sentence 20 at once, and the button showed "Pause". The reading went on to sentence 21 after its end.
- (e) Pause right after a Next, wait 2 s, then Play: PASS, 11 of 11. The pause came 0, 5, 20, 40, 50, 60, 80 or 100 ms after the Next, in each case after the `start` event of the new sentence. After 2 s the highlight was on the first word of the new sentence, and the button showed "Play". After Play, the word highlight moved again within about 400 ms (`tick` events came again). The sentence played to its end, and the next sentence followed. No stall.

In an early try of (e), the log showed no event for 9 s after Play. That log did not record `tick` events or word changes, and that sentence was a long one (sentence 22). So it is not evidence of a stall. The 11 tries with word tracking all moved.

A note, not a fail: the first sentence of a reading is cut into short pieces for a fast start. One Previous pressed during sentence 2 went to the last piece of sentence 1 ("while the evening light …"), not to the start of sentence 1.

The voice in the first run, when FAIL 3 was seen, was the same natural voice `af_heart` through the offscreen page. The network log of that run shows `/speak?voice=af_heart` requests from the offscreen page, and no Mac voice was used.

### Cleanup

Only the test Chrome PID that this run started, and the static server on port 8823, were stopped. The voice server still answers. No Highlight was made, so no key point file was written. The file from the first run in the atlas project is a separate matter (see "A side effect to clean up").

## Third run: tickets 26 to 29

Date: 10 Nov 2026, later. The test browser was started only with `tools/test-window.sh` (ticket 29). It found Chrome for Testing 156 in `~/Library/Caches/ms-playwright/chromium-1248`, with its own profile folder in the temporary folder of the user, port 9333 and the mock keychain. No keychain question came. The script had to run outside the tool sandbox of Claude Code, as in the first run. Before the first command to port 9333, `lsof` showed that the process that listens on 9333 is the PID in the script's PID file, and its command line has the test profile folder. (`/json/version` does not name the profile folder.) A Node script drove the browser over the DevTools protocol. The web checks used made pages from a static server on 127.0.0.1:8847. The reader and library checks used the live voice server on port 8793 with the sample Book only (id `0d281938d3ff`). No Highlight was made: the Highlights list of the sample Book is `[]` at the end. The voice server was not stopped or restarted.

### Counts

- PASS: 20
- FAIL: 2
- NOT RUN: 3

### FAIL

1. Ticket 26, Follow in a shadow root. FAIL. Page: a scrolling box (`overflow: auto`, 180 px high) inside an open shadow root, with 30 sentences in it, and only a short heading outside it. Steps: press the round Listen button. Seen: the bar shows "Finished." at once, the count is empty, and no Word highlight or Sentence shade comes. So the text in the shadow root is never read, and Follow cannot be checked there. Cause, from the code: `collect()` (`extension/content.js:72`) walks the page with a `TreeWalker`, which does not go into shadow roots. The "Listen from here" button also cannot show: the `mouseover` target is the shadow host, and `closest('p,li,…')` finds no paragraph. The Node tests of ticket 26 give the text to Follow directly, so they do not see this. Text from the page shown in a `<slot>` of a scrolling box in a shadow root works (see PASS). Console: none.

2. Reader opened from `http://localhost:8793` (the library at `http://localhost:8793/app/` opens the reader on that origin). FAIL. Steps: open the reader of the sample Book at `http://localhost:8793/reader/index.html?lib=0d281938d3ff…`. Seen: the console has, on every load and again on Play, "Access to fetch at 'http://127.0.0.1:8793/voices' from origin 'http://localhost:8793' has been blocked by CORS policy" and "Failed to load resource: net::ERR_FAILED". The status line says "The natural voice does not answer. The Mac voice reads for now.", the voice type changes to the Mac voice (Daniel), and in 5 s of Play the place did not move and no Word box showed. The same Book at `http://127.0.0.1:8793/reader/…` says "Natural voice ready", and `/speak` and `/times` answer 200. Likely file: `extension/pdf/tts.js:534` (`static SERVER = 'http://127.0.0.1:8793'`, used also from an http page; `app.js:504`, `ask.js`, `notes.js` and `restart.js` use the page's own origin when they are on http), or the CORS rule of `voice-server.py`. This is not code of ticket 27, but the ticket 27 check uses the localhost library. The Reading position itself works on both origins.

### PASS

Ticket 29 (test window script):

- Start: `tools/test-window.sh about:blank` started PID 11247 with `--user-data-dir=<test profile> --remote-debugging-port=9333 --use-mock-keychain --password-store=basic --load-extension=/Volumes/claude/read-aloud/tts-module/extension`. `/json/version` answered (Chrome/156.0.8078.4). PASS
- The add-on is loaded: its service worker `chrome-extension://mnedlghmdlfdffmboebpnjmopbdhgbkd/background.js` answers with the name "Read Aloud 2", version 2.9.10. PASS
- `stop`: "the test browser (PID 11247) is stopped"; the PID is gone and nothing listens on 9333. A second `stop` says "no test browser of this script runs" (exit 0). The own Chrome still ran (115 processes before the start, 119 after the stop; the number moves as the own Chrome opens and closes its helper processes). PASS
- A second start works (PID 11682). A start while it runs stops only that PID and starts a new one (PID 11829). The final `stop` stopped PID 11829; the own Chrome still ran (110 processes). PASS

Ticket 26 (web player):

- Short title, then a long first Sentence (168 characters). One shade covers the whole Sentence for all of its 10 s, while the Word highlight moves word by word through both pieces. The count stays the same during the whole Sentence. Note: the count was "2 / 13", not "1 / 13", because the reading started below the title: `onScreen` skips a Sentence whose bottom is in the top 60 px of the window, and the title was there. That is the start rule, not a fault of the pieces. PASS
- Previous during the second Sentence goes to the first word of the first Sentence ("first", count 2 / 13, the whole 168 characters shaded), not to its last piece. Next then goes +1 each time (3 / 13, then 4 / 13), and Previous goes back one (3 / 13). Repeated in a second run in a later part of the page: the same. PASS
- Nested boxes (an outer box of 260 px, an inner box of 150 px that starts 600 px down in the outer box). In three runs, the outer box moved (scrollTop 516) so that the inner box showed, then the inner box moved (scrollTop 87.5) when the voice went past its bottom. In 14 and 26 probes after Next, the word was inside the inner box, inside the outer box and inside the window each time. The window did not scroll. Note: in the very first run, the outer box did not move for the first 5 probes, and each Next moved 3 Sentences (3, 6, 9, 12, 15) before it went back to +1 and the box moved. This was not seen again in 3 more runs, so the cause is not known. PASS
- Text from the page in a `<slot>` of a scrolling box in a shadow root: the box moved (scrollTop 94) when the voice went past its bottom; in 26 probes the word was always inside the box and the window; the window did not scroll. PASS
- Colours. On a plain page, in light and in dark mode, and on a page that sets its own `--color-word: #00ff00`, `--color-on-word: #ff00ff` and `--color-sentence: rgba(0, 0, 255, 0.5)`: the computed style of `::highlight(ra2-word)` is background `rgb(255, 140, 0)` with text `rgb(15, 23, 42)`, and `::highlight(ra2-sentence)` is `rgba(255, 140, 0, 0.18)`. These are the token values. The screenshots show orange on the word and a light orange shade on the Sentence on all four pages, and no green or blue. PASS

Ticket 27 (Reading position):

- Before the run, `GET /library/0d281938d3ff/position` gave `null`. The reader played, Next went 4 times, and Pause sent one `POST /library/0d281938d3ff/position` with status 200 and the record `{"i":11,"total":277,"page":1,"pages":14,…}`. The GET then gave `i` 11, the place shown as "12 / 277". PASS
- The library page at `http://localhost:8793/app/` shows the sample Book in "Continue listening" ("Where you stopped"), with the status "Page 1 of 14, 4% done, 1 h 06 min left". PASS
- Close the reader and open the Book again: it opens at "12 / 277", the saved place. The reader at `127.0.0.1:8793` (another origin) also opened at the voice server's place. PASS
- Two tabs A and B of the Book, both at "14 / 277". In A: Play, Next 5 times, Pause: A is at "19 / 277", and the voice server has `i` 18. Then B to the front (A hidden), then A to the front (B hidden, `visibilityState` "hidden"), then B closed: the voice server keeps `i` 18 with the same time each time. Only A sent a POST. A new tab of the Book opens at "19 / 277". PASS
- No error in the console of the reader at 127.0.0.1 during these steps (the localhost errors are FAIL 2). PASS

Ticket 28 (sound memory), reader at `127.0.0.1:8793`, speed 2×:

- 75 s of play with no input: 16 sounds played (Sentences 19 to 26). The silence between the end of one sound and the start of the next (measured on `AudioBufferSourceNode` start and `ended`) was 7 to 28 ms between the two pieces of a Sentence, and 159 to 162 ms between Sentences. That is the planned pause of 300 ms at speed 2. No longer silence. PASS
- Next pressed 85 times, 1.1 s apart: the reading went from "26 / 277" to "145 / 277" (119 Sentences, as the short Sentences also ended on their own). Each Sentence played. PASS
- Back 20 Sentences (Previous 20 times, "145" to "125"), then Play: the Sentence played for 9 s with the Word box, and the reading went on to "126 / 277". It was still in the sound memory, so no `/speak` request was needed. PASS
- Memory of the reader page (`Runtime.getHeapUsage` and `performance.memory`): ArrayBuffer backing store 8.7 MB at the start, 26 MB after the 75 s, 63 MB after 20 Next, then 69, 73, 70 and 72 MB after 40, 60, 80 and 85 Next, and 67 MB at the end. `performance.memory` used heap: 37, 49, 86, 92, 95, 93, 95 and 90 MB. The JS heap stayed at about 23 MB. So the memory stops growing at about the 64 MB limit plus the page. PASS
- Console of the reader during the whole ticket 28 run: 0 errors and 0 warnings. PASS

### NOT RUN

- Ticket 28: a Sentence that went out of the sound memory and is made again. Going back 20 Sentences at speed 2 stayed inside the 64 MB, so this path was not reached. Also not run: 15 minutes of reading, and a paragraph of a minute or more (the sample Book has none).
- Ticket 27, step 5 (voice server down): the voice server must not be stopped in this run.
- Ticket 26: a box around a shadow host, and the Mac voice. Not done in this time.

### Cleanup

The test browser was stopped with `tools/test-window.sh stop` (PID 11829 gone, nothing on 9333). The static server on 8847 was stopped. The own Chrome still runs (110 processes at the end). The voice server still answers. Screenshots of the colour check are in the scratch folder of this session (`shots/b3-*.png`).
