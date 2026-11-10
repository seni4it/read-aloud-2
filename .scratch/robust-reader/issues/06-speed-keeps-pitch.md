# 06. Speed that keeps the pitch of the voice

GitHub issue: #7
Status: ready-for-human
Type: HITL

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Today the browser plays the sound faster, and that raises the pitch. Make the voice model produce the sound at the asked speed and play it at rate 1. Add the speed to the cache key on the server and in the reader and the add-on. First make a prototype: produce the same sentence at 1.0, 1.1, 1.5, 2.0 and 3.0 and give the owner the files to compare with the present method.

Evidence: audit/reader-ui.md finding 10. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] The owner hears the comparison files and decides the speeds that use the new method.
- [ ] At a chosen speed the pitch is the same as at speed 1.0.
- [ ] Word highlights are at the correct words at each speed.
- [ ] A speed change does not make the cache grow past its limit.

## Blocked by

- 01 (voice-server-robust)
- 05 (reader-voice-requests)

## Owner

Owner: he listens and decides.

## Work report

10 Nov 2026, prototype only. The script tools/speed-compare.py loads the same Kokoro model (mlx-community/Kokoro-82M-bf16, offline) through the same English pipeline code as voice-server.py, in its own process, with the Python of the LaunchAgent. It did not touch the live server. It says one fixed passage of three sentences with the default voice af_heart at speeds 1.0, 1.1, 1.5, 2.0 and 3.0, trims the edges with the server's own trim(), and writes 15 WAV files and a listening page to ~/read-aloud-samples/speed-compare/ (index.html).

The three methods are: A, the model's own speed parameter; B, today's method (the speed-1.0 sound resampled, so the pitch goes up); C, the speed-1.0 sound stretched with ffmpeg atempo, pitch kept. ffmpeg was found at /opt/homebrew/bin/ffmpeg.

Results. The speed-1.0 passage lasts 15.86 seconds. Methods B and C hit the asked length within 0.2 percent at every speed. Method A gave 15.14 s at 1.1 (5 percent long), 10.35 s at 1.5 (2 percent short), 8.64 s at 2.0 (9 percent long) and 7.29 s at 3.0 (38 percent long). So the model reaches only about 2.2 times at the setting 3.0. No file is silent and no file clips: the peak is 0.27 to 0.33 in all files. Making the sound with the model took 0.67 s at 1.0 and 0.32 s at 3.0, so model speed does not cost time; it is quicker at higher speed because there is less sound to make.

Next step: the owner listens and decides which speeds use which method. If he picks the model method above 2.0, the reader must still play the rest of the speed (for example model 2.0 and a stretch for the rest), because the model alone does not reach 3.0.

## Work report: build

Date: 10 Nov 2026. Tests first: the new Python tests failed before the change (no `find_ffmpeg`, then 403/400/200 mismatches), the new node file failed before `tts.js`, `background.js` and `offscreen.js` had the new code. No server was started or restarted, nothing was asked of port 8793 or 8791, no package was installed, no git command that changes the repository was run. `extension/content.js` was not changed in the build; it was changed in the review repairs.

### The owner's decision of 10 Nov 2026

He listened to the comparison files. The default for all speeds above 1.0 is method **A**: the voice model makes the speech at the asked speed (Kokoro's speed parameter), and it plays at rate 1, so the pitch stays. Today's method **B** stays as a switch in the settings ("yes"). A third choice **C** was added for a comparison in the real reader: the speed-1 sound stretched with the pitch kept (a local speech-to-text test understood C fully at 3.0 and A not; his ears prefer A). Method A is not exact (2.0 gives about 1.84, 3.0 about 2.2). The reader plays what the model gives; nothing corrects the rest.

### Part 1: the reader from http://localhost:8793 could not reach the natural voice

Cause: `ServerEngine.SERVER` was fixed to `http://127.0.0.1:8793`. A page of `http://localhost:8793` is another origin, and the voice server sent no `Access-Control-Allow-Origin` on its answers, so Chrome blocked `/voices` and the reader fell to the Mac voice.

Repair, in two places:
- `extension/pdf/tts.js:410` `serverBase(location)`: the reader served by the voice server (`localhost`, `127.0.0.1` or `[::1]` on port 8793) asks its own origin; every other page (the add-on's own pages, `chrome-extension://`) asks the fixed address. `tts.js:595` `static SERVER = serverBase(...)`.
- `voice-server.py:56` `own_origins(port)` and `end_headers()` : an answer to a page of one of the server's own names (`http://localhost:PORT`, `http://127.0.0.1:PORT`, `http://[::1]:PORT`) gets `Access-Control-Allow-Origin: <that origin>`, for all routes, also for error answers. Other origins get no such header. Every answer has `Vary: Origin` (review repair 9). `do_OPTIONS` answers the browser's preflight from the own origins only (204), so a POST with a body type (a picture to `/ocr`) works too; any other origin gets 403.

Other reader files: `app.js`, `notes.js`, `ask.js` and `restart.js` already use the own origin ('') on an http page: no fault. `extension/pdf/ocr.js:4` (not owned by this ticket, not edited) has the fixed `http://127.0.0.1:8793`: from `localhost` it is cross-origin, and the server's new allow header and preflight answer now cover it. `extension/offscreen.js` sends Read-ahead to `localhost` on purpose (a second address for Chrome's 6 connections); it is an add-on page with host permission, so CORS does not apply.

### Part 2: the speed method

**Rules chosen**
- Three choices, default A. Labels (plain, short, readable aloud): A "Voice speaks faster", C "Stretch, same pitch", B "Simple, pitch goes up". One list in `tts.js:368` `SPEED_METHODS`; the same labels in `pdf/index.html` and `popup.html` (a test keeps them equal).
- Speed 1.0 is one sound for all methods (one cache entry, on the server and in the reader). B always uses the speed-1 sound.
- The server takes speeds from 0.5 to 4.0 (what the reader, 0.75 to 3, and the add-on, 0.5 to 4, offer). A speed that is not a finite number in that range, an unknown method, or C at a speed other than 1 without ffmpeg is a 400. 1.5 and 1.50 are one speed (2 decimals).
- C without ffmpeg: the server says so (`/voices` gives `"speed": {"min", "max", "methods"}`, without "C"). The reader then plays A and shows C as not available (its sound path, an AudioBufferSourceNode, has no pitch-kept playback). The web-page player plays A too (one rule with the reader, review repair 3).
- An old voice server (no `"speed"` in `/voices`, until the voice server is restarted with the new code), or no answer to `/voices`: the reader and the add-on use B, so the speed still changes.
- A speed change (or a method change) while reading: the present Sentence is said again from the present word at the new speed (the reader's `stop(); play()`, as before; the web-page player gets "lost" from the background, which says the Sentence again from the present word). The silence is the time to make the first piece of that text (the reader asks the first five words first, about half a second). Exception: B in the web-page player changes the rate of the playing sound at once, as before. The Read-ahead is asked again at the new speed. The old-speed sounds are no longer needed and leave the sound memory by its normal rule (least recently used first), so the memory stays under its 64 MB limit.
- Word timing: for A the server gives Kokoro's timing of the sound made at that speed; for C the speed-1 timing divided by the speed; both in seconds of the sent sound, played at rate 1. For B the reader divides by the rate, as before.
- Time left: the reader counts the speed that the ear hears. For A it uses the measured curve of the prototype (`tts.js:396` `heardSpeed`: 1.84 at 2, 2.18 at 3); B, C and the Mac voice count the asked speed. The web-page player's time left (`content.js` `heardSpeed()`) uses the same curve (review repair 13).
- Mac voice (the fallback): unchanged, it reads at the asked rate.

**Voice server (`voice-server.py`)**
- Line 68 `SPEED_MIN, SPEED_MAX = 0.5, 4.0`; line 72 `find_ffmpeg()` (PATH, then `/opt/homebrew/bin` and `/usr/local/bin`, as the LaunchAgent's PATH may not have Homebrew); line 78 `STRETCH = find_ffmpeg()`, found once at start.
- Line 167 `sound_key()`: `(voice, text)` for speed 1 or B, else `(voice, text, method, speed)`.
- Line 174 `speed_args()`: validation (400 in the handler, line 1227, for `/speak` and `/times`).
- Line 189 `atempo_chain()`: atempo filters of at most 2.0 each (3.0 = `atempo=2,atempo=1.5`).
- Line 202 `stretch_wav()`: ffmpeg from a pipe to raw 16-bit, then a 24 kHz mono WAV.
- Line 212 `speak(..., speed, method)`: A goes to the model with the speed (`synth(text, voice, speed)`, the English pipeline and the plain path both take `speed`); C takes the speed-1 sound (made or kept as its own entry), stretches it outside the engine lock and scales the Word timing by 1/speed.
- `/voices` (line 1218) gives `"speed": {"min": 0.5, "max": 4.0, "methods": [...]}`.
- The MP3 export (`export_book`, `synth_low`) does not use speed: it stays at speed 1 (README says so).

**Reader (`extension/pdf/tts.js`, `app.js`, `index.html`)**
- `tts.js:358` `soundKey(voiceId, text, plan)`: speed 1 keeps the old key; A and C add method and speed.
- `tts.js:381` `speedPlan(method, rate, methods)`: `{speed, method, rate}`; a method the server does not offer falls to A, then B.
- `ServerEngine`: `method`, `rate`, `methods` ; `setSpeed(method, rate)`; `heardSpeed(rate)`; `init()` reads the methods; `render()`, `prefetch()` and `speak()` use the plan in the key and the query (`&speed=..&method=..`); `speak()` plays at `plan.rate`. `KokoroEngine` (the in-page model, not in the add-on now) is unchanged: B.
- `index.html`: one control in the Voice group of the settings panel, `<label class="field"><span>Speed method</span><select id="methodSel">`, the existing field component and tokens; no CSS change, no new colour.
- `app.js:1160` the setting: stored in `chrome.storage.sync` `ra2.method` when the reader is a page of the add-on (the same place as the web-page player), and in `localStorage` `ra2.speedMethod` (always; the only place for the reader served by the voice server, which has no chrome.storage). A change says the Sentence again from the present word. `showMethods()` disables C when the server has no ffmpeg. `heardRate()` (line 467) for the time left and the minutes left sent with the Reading position.

**Web-page player (`background.js`, `offscreen.js`, `popup.*`)**
- The one shared setting: `chrome.storage.sync` `ra2.method` (the popup writes it; `content.js` keeps unknown keys of `ra2` when it saves, and reloads them on change).
- `background.js:27` `soundPlan()` (the same rule as `speedPlan()`, plus `keepPitch`; a test compares them for all methods and speeds); line 16 `serverMethods()` (the `/voices` answer, kept one minute; `voices()` refreshes it). `speak()` reads the setting and sends `speed`, `method`, `rate`, `keepPitch` to the sound page; `warm` (the screen's Read-ahead) uses the stored speed and method; `rate` (line 121) changes only the rate of a sound of the same speed, else tells the page "lost" (the page says the Sentence again from the present word, at the new speed).
- `offscreen.js:11` the sound, its Word timing (`/times`) and its Read-ahead ask the same speed and method; `preservesPitch` follows `keepPitch` (B: the pitch goes up, as its name says; before, the web-page player kept the pitch with the browser's own playback).
- `popup.html`/`popup.js`: one control "Speed method" under Speed, the existing popup label style; C disabled when the voice server has no ffmpeg.
- `content.js`: no edit in the build; the review repairs added the speed to `warm` and the heard-speed curve to the time left.

### Tests

- `tests/test_server.py`: new classes `SpeedMethod` (8 tests: bad speed or method is a 400 for `/speak` and `/times`; A asks the model for the speed and the Word timing matches; speed 1 is one sound for all methods; the cache key; the atempo chain; C stretches the speed-1 sound and scales the timing; without ffmpeg C is refused and not offered; a real ffmpeg stretch gives the asked length, run only when ffmpeg is there) and `OwnOrigins` (3 tests: both own names may read the answers, also of an error; other origins get no allow header; the preflight of the own origins only). The voice model is never loaded: `synth()` is a fake.
- `tests/node/speed-method.test.mjs`: 19 tests (the origin choice; the three choices and the default; the same labels in the reader and the popup; the plan of each method; A, B and C in the engine; one sound at speed 1; the Word highlight for each method; a speed change keeps the memory under its limit and asks the Read-ahead at the new speed; the Mac voice; the time left; the background's plan, rate change and warm; the sound page's queries and pitch; the background and the reader give the same plan).
- `~/.local/share/uv/tools/mlx-audio/bin/python -m unittest tests.test_server`: 43 tests, OK.
- `node --test --test-timeout=120000 tests/node/`: 524 tests, 524 pass.

### What a real Chrome check must confirm (after the voice server is restarted with the new code)

1. Open the reader from `http://localhost:8793/reader/...`: the natural voice reads (no CORS error in the console), and the same from `http://127.0.0.1:8793`.
2. Settings panel, Voice group: "Speed method" shows the three choices, "Voice speaks faster" chosen. At 2x and 3x, A keeps the pitch of 1x; C keeps the pitch; B raises it.
3. At 1.5x, 2x and 3x, for each method: the Word highlight is on the word that is heard.
4. Change the speed while reading: the Sentence goes on from the present word at the new speed after a short pause, and the next Sentences come without a gap.
5. Change the speed many times in a long book: the reader page's memory does not grow past about 64 MB of sound.
6. The web-page player and the popup: the same setting (a change in the popup is used by the next Sentence of a web page and by the reader of the add-on); at 2x the three methods sound as in the reader.
7. The time left in the reader is about right at 2x with A (it counts about 1.84x).

### Open points

- `content.js` time left: repaired in the review repairs (13).
- A speed change while the web-page player is paused, with A or C: the paused sound keeps its old speed when it resumes; the next Sentence has the new speed (the same as before for B, where a paused rate change was also not applied).
- A change of the method in the popup while a web page reads is used from the next Sentence.
- `GLOSSARY.md` was not changed. "Speed method" is a new owner-facing name of a setting; add it if the glossary should name settings.
- The version was not bumped.

### Review repairs

Date: 10 Nov 2026. Tests first: the new tests failed before each repair (Python 3 of 4; node 12 of 12; the real-ffmpeg `/speak` test passed at once, as the build already had the path). The same limits as the build: no git write, no network, no browser, no restart of a server, no install.

1. **Bug, C chosen and not available** (`app.js` `showMethods()`): when the voice server cannot stretch, the select shows A, C is disabled, and the hint `methodHint` (`index.html`, existing `.status` text style) says "Stretch, same pitch is not available: this Mac has no ffmpeg. The voice speaks faster for now." The stored choice (`wantedMethod`, localStorage and `ra2.method`) stays C, so C comes back when the voice server can stretch again. `showMethods()` runs after the voice server answers and at the first word of each Sentence (the engine can read the methods again, repair 4).
2. `background.js` `serverMethods()`: a failed `/voices` call is kept for 60 s (B meanwhile), not asked again for each Sentence.
3. One rule in `soundPlan()` (`background.js`) and `speedPlan()` (`tts.js`): C without ffmpeg plays A; an old voice server or no answer plays B. `keepPitch` is false only when the plain sound plays faster. The test "same sound as the reader" covers methods A, B, C, speeds 0.75 to 3 and server lists [A,B,C], [A,B], [B].
4. `tts.js` `ServerEngine.speak()`: a 400 to a sound with a speed reads `/voices` again (`#readMethods()`) and says the rest of the Sentence with the new plan, before the server-failure path (no Mac voice, no error). Once only per Sentence (`replanned`).
5. `offscreen.js` `early()`: queued Read-ahead of another speed or method is dropped when a new plan comes.
6. `content.js` sends its present speed with `warm`; `background.js` uses it first, the stored speed only for a page that does not send it.
7. `background.js` `speak()`: `mine()` is checked again after `await offscreen()` (and after the plan), so a Sentence that was replaced while the sound page opened is never sent.
8. `popup.js` and the reader (`app.js`): a method change reads `ra2` fresh and writes only the method key, so a speed or voice that another tab saved meanwhile is kept.
9. `voice-server.py` `end_headers()`: `Vary: Origin` on every answer.
10. `voice-server.py` `stretch_wav()`: an ffmpeg failure is logged (with its detail) and answers 500 with the fixed text "The stretch of the sound failed" (no path, no arguments).
11. `voice-server.py` `speak()`: method C has a lock per key (`_stretching`), so two requests for the same stretch make it once; the second takes the kept sound. It was small (about 10 lines).
12. `tests/test_server.py`: method C through `/speak` with the real ffmpeg (skipped when ffmpeg is absent): the sound is half the length of the speed-1 sound at 2x, and the model is asked once, at speed 1.
13. `content.js` `heardSpeed()`: the time left of the web-page player uses the same curve as the reader for method A (a test compares the two functions for all methods and speeds).
14. Question: with no Word timing from the server (`/times` gives null, for example Italian), is the estimate for A spread over the real sound? Yes. `playBuffer()` spreads the words over `voicedSpan(buffer)`, the voiced length of the sound that was made, divided by `plan.rate`, which is 1 for A. The web-page player moves the highlight by `t / d` of the `<audio>` element, also the real sound. A test with a sound 20 percent longer than asked confirms it; no repair was needed.
15. `tools/speed-compare.py` is in git (`git ls-files tools/` lists it). The role words were taken out of this report.

New tests: `tests/test_server.py` 4 (a failed stretch gives a fixed 500; one stretch for two requests; C through `/speak` with real ffmpeg; `Vary: Origin` always). `tests/node/speed-method.test.mjs` 9 (repairs 1 (2 tests), 2, 4, 5, 7, 8, 13, 14; repairs 3 and 6 extend tests that were there).

`~/.local/share/uv/tools/mlx-audio/bin/python -m unittest tests.test_server`: 47 tests, OK. `node --test --test-timeout=120000 tests/node/`: 533 tests, 533 pass.
