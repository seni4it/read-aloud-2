# 28. Sound memory of the reader: a limit in bytes

GitHub issue: none yet
Status: code done, tests pass; Chrome check open (see Work report)
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

The reader keeps the sound of the Sentences it made, so that a Sentence read again, or made as Read-ahead, does not wait for the voice. Today `extension/pdf/tts.js` keeps the sound of 60 Sentences. A Sentence of the reader is often a whole paragraph, so 60 Sentences are much more than the Read-ahead needs. Ticket 19 measured it: about 96 MB with the usual Sentences, and up to about 234 MB.

Limit the sound memory by bytes, about 64 MB. When a new sound makes it go over the limit, the Sentence that was used least recently goes out first. The Sentence that plays now and the Read-ahead Sentences never go out, so no silence comes between Sentences. Count the real bytes of what is kept. One Sentence larger than the limit must still play. A Sentence that went out is made again when it is read again. Keep a limit by count only if it still has a purpose.

Do not change how the speed works (ticket 06 does that later in `tts.js`).

## Acceptance criteria

- [x] The sound memory has a limit in bytes (64 MB) and no limit by count.
- [x] Over the limit, the least recently used Sentence goes out first. A Sentence that is read again counts as used.
- [x] The Sentence that plays now and the Read-ahead Sentences never go out.
- [x] The byte count is the real size of the kept samples.
- [x] One Sentence larger than the limit plays to its end.
- [x] A Sentence that went out is made again when it is read again.
- [x] `tests/pdf-text/audio-cache-size.mjs` reports the new limit.
- [ ] Chrome check (see Work report).

## Blocked by

None - can start immediately

## Work report

Date: 10 Nov 2026. Another agent was editing `voice-server.py`, `app/`, `extension/pdf/app.js`, `extension/pdf/position.js` and their tests at the same time. This work did not touch them. No git command that changes the repository was run.

### What is kept, and its size

The voice server sends a WAV. `ServerEngine` decodes it with `new OfflineAudioContext(1, 1, 24000)` and keeps only `getChannelData(0)`: a Float32Array of the first channel at 24 kHz, 4 bytes a sample. The AudioBuffer itself is not kept. So the bytes of one kept sound are its samples times 4, for one channel. `soundBytes()` counts the bytes of the Float32Array, or of the buffer under it when that buffer is larger (a view keeps its whole buffer). The word timing (`starts`) is a short list and is not counted. `KokoroEngine` (the voice model in the page) keeps the samples of its worker in the same way and uses the same sound memory. Its worker file is not in the add-on now.

### What changed

- `extension/pdf/tts.js:265` `export const SOUND_MEMORY_MB = 64` (1 MB = 1024 * 1024 bytes). That is about 11.7 minutes of speech.
- `extension/pdf/tts.js:283` new `export class SoundMemory`. It has the calls of a Map that the engines use (`has`, `get`, `set`, `delete`, `size`, `keys`, `values`), and also `bytes`, `limit`, `need(keys)` and `alsoNeed(keys)`. `get` makes the Sentence the newest use. `set` adds the bytes and then takes out the oldest sounds until the memory is under the limit (`#trim`, line 338). It skips the needed sounds. When the needed sounds alone are over the limit, they all stay, and they go out at a later `set`, when they are no longer needed. So a Sentence larger than the limit plays.
- `need(keys)` gives the keys of the Sentence that starts now, and clears the Read-ahead. `alsoNeed(keys)` adds the keys of one Read-ahead Sentence. Only the last 2 Read-ahead calls count (`SoundMemory.AHEAD`), as the reader asks Read-ahead for the next 2 Sentences (`app.js` speakCurrent and warmCurrent). So a pause with many jumps does not hold all the Sentences it warmed.
- Only `set` takes sounds out. A call of `need()` takes nothing out. This is important: the reader calls `speak()` and then `prefetch()` for the next Sentences. If `need()` took sounds out, the next Read-ahead Sentence could go out in the moment between the two calls.
- `extension/pdf/tts.js:367` the engines use `new SoundMemory()` in place of `new Map()`. The two lines `if (this.cache.size > 60) ...` are gone (lines 459 and 581 now). The limit by count was removed: the bytes are what costs, and a limit by count can only take out needed Read-ahead.
- `KokoroEngine.speak()` calls `need()` (line 481), `KokoroEngine.prefetch()` calls `alsoNeed()` (line 474). `ServerEngine.speak()` calls `need()` with the keys of both pieces of a long Sentence (line 685), also when the Mac voice reads. `ServerEngine.prefetch()` calls `alsoNeed()` with the keys of both pieces (line 665).
- New helper `soundKey(voiceId, text)` (line 349), the key that the engines used before.
- The speed and the playback did not change.

### Tests

New file `tests/node/sound-memory.test.mjs`, 10 tests. They were written first and all 10 failed before the change. They load `tts.js` in a node:vm context with a fake voice server and fake sound, as `voice-requests.test.mjs` does.

- the limit is 64 MB, and a new engine uses it;
- the byte count is right, also when a Sentence is kept again or goes out;
- the least recently used Sentence goes out first; a Sentence read again counts as used;
- the Sentence that plays and the Read-ahead never go out, even when they are the oldest;
- only the Read-ahead of the last 2 calls is needed;
- needed Sentences over the limit all stay, and the memory is under the limit again when they are no longer needed;
- one Sentence of 4 times the limit plays to its end, with its words marked, and goes out after the next Sentence comes;
- 28 Sentences read on: the memory stays under the limit, the Read-ahead is there when its turn comes, and each Sentence is made one time only;
- the Read-ahead stays when the memory is full of large old Sentences;
- a Sentence that went out is made again by the voice server and plays.

A trial with the protection taken out (`#needed` always false) made 3 of the tests fail; the code was then put back.

`node --test --test-timeout=120000 tests/node/`: 486 tests, 486 pass. `voice-requests.test.mjs` and `highlights.test.mjs`, which also load `tts.js`, pass.

### Measurement (`node tests/pdf-text/audio-cache-size.mjs --private`)

The script now reads `SOUND_MEMORY_MB` from `tts.js` and prints the limit, how many Sentences fit, and the most the memory can hold (the limit plus the 3 longest Sentences, when they are the one that plays and the Read-ahead). MB in the script is now 1024 * 1024 bytes, as in `tts.js`.

- Limit: 64.0 MB, 11.7 minutes of speech.
- Public samples: 10 Sentences, mean 2.1 MB a Sentence. About 30 usual Sentences fit. At most 74.0 MB.
- Private books: 2560 Sentences, mean 1.5 MB, longest 5.6 MB. About 41 usual Sentences fit, at least 15 of the longest. At most 79.2 MB (before: up to about 234 MB).

### What a real Chrome check must confirm

1. Read a library Book for 15 minutes or more, with long paragraphs. No silence comes between Sentences that was not there before.
2. In the Chrome task manager (or the Memory tab of DevTools), the memory of the reader page stays at about 64 MB of sound plus the page, and does not grow past that.
3. Go back 20 or more Sentences and play: the Sentence is made again and plays, with the word highlight.
4. A very long paragraph (a minute of speech or more) plays to its end.

### Open points

- "Sound memory" is the word in this ticket and in the code comments. It is not in `GLOSSARY.md` yet. The glossary was not changed in this work.
- The code still names the field `this.cache` (other files and tests read `engine.cache`).

### Review repairs

Review of 10 Nov 2026: no bug, but risks. Tests first: the 2 new tests failed before the change.

- **Call order of app.js (point 5).** Read only. `speakCurrent()` calls `speak()`, then `prefetch()` for the next 2 Sentences. But `warmCurrent()` (while paused) calls `prefetch()` for the present and the next Sentence before any `speak()`; Play then calls `speak()`. So Read-ahead can come before `speak()`. Repair: `need()` keeps the Read-ahead list. It takes off only an entry that is now the Sentence that plays. An old Read-ahead entry goes when two newer Read-ahead calls replace it (`SoundMemory.AHEAD` = 2). New test: "Read-ahead asked before the Sentence starts (app.js warmCurrent while paused, then Play): it stays needed". With the old rule (`need()` clears the list) this test fails.
- **Trim in `need()` (point 6).** `need()` now runs `#trim()` after the needed set changes, so the sounds that are no longer needed go out at once when the memory is over the limit. This is safe because `need()` keeps the Read-ahead now. `alsoNeed()` takes nothing out. The header comment of `SoundMemory` and the comment of `#trim()` now say this. New test: "a new Sentence that starts takes out the sounds no longer needed at once, when the memory is over the limit". The test "needed Sentences over the limit all stay ..." changed to the new rule: after a jump, the old Read-ahead goes when the reader asks the Read-ahead of the new place.
- **Jump back in the book test (point 7).** The test "reading on through a book" now also goes back to Sentence 3, which went out. Sentence 3 plays, the voice server makes it again one time, and its Read-ahead (Sentence 4) is made again one time. The memory stays under the limit.
- **"At most" is an estimate (point 8).** `audio-cache-size.mjs` now prints "at most about ... (an estimate ...)", and its comment says why: the voice server engine splits a Sentence of 12 words or more in two pieces, and a Sentence started at a clicked word is a new, shorter text. `docs/testing.md` says the same.

Files: `extension/pdf/tts.js` (`need()`, comments), `tests/node/sound-memory.test.mjs` (12 tests now), `tests/pdf-text/audio-cache-size.mjs`, `docs/testing.md`.

`node --test --test-timeout=120000 tests/node/`: 494 tests, 494 pass.
