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

`/Users/semion/tooth-3d-atlas/key-points/Sample paper - Trace-based JIT.md` (559 bytes, 10 Nov 01:36)

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
