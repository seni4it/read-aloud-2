# 05. Reader: voice requests with a time limit, cancel and correct priority

GitHub issue: #6
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Give each request from the reader to the voice server a time limit. Cancel the request for a sentence that is no longer wanted. Ask again without the read-ahead mark when a wanted sentence was first asked as read-ahead. Correct the word highlight for the delay of the sound output.

Evidence: audit/reader-ui.md findings 6, 9, 23. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [ ] Stop the voice server while the reader reads: a message shows in at most 30 seconds, not 'generating' without end.
- [ ] Jump 6 times fast: only the last sentence is made by the server.
- [ ] A sentence that was asked as read-ahead and is then wanted starts as fast as a direct request.
- [ ] With an output delay of 200 ms the word highlight is not ahead of the sound (unit test of the schedule with a given delay).

## Blocked by

- 01 (voice-server-robust)
- 02 (test-bench)

## Work report

Date: 9 Nov 2026. Changed files: `extension/pdf/tts.js` (only `playBuffer` and `ServerEngine`), new `tests/node/voice-requests.test.mjs` (10 tests). No other file was changed.

### Faults: confirmed in the code, then repaired

Each test below failed with the old code (7 of the first 8 failed; tests 5 and 9 are guards that passed before and after). Then the repair made all 10 pass.

1. **Finding 6: no time limit and no cancel.** Confirmed. `fetch()` in `init()` and `render()` had no signal. `stop()` and a jump did not cancel the request for the old sentence.
   Repair: each voice request has its own `AbortController` and a time limit: 30 s for a sentence that the owner waits to hear, 120 s for read-ahead, 3 s for the voice list in `init()`. `stop()` (called by the reader on Pause and on each jump) cancels every open request. When a new sentence starts in normal reading, only the old wanted requests are cancelled; read-ahead stays. The server already stops work for a closed connection (the `gone` check), so a cancel frees the engine for the sentence that is wanted now.
   Tests: "a voice server that does not answer ..." (the Mac voice reads after 30 s, not before), "6 fast jumps ..." (old code: 17 requests still open; new: only the last sentence and its 2 read-ahead sentences, and 0 after `stop()`; no time-limit timer stays), "the first question to the voice server has a time limit of 3 seconds", "a read-ahead request that waits long is cancelled after 120 s ...", "reading on from one sentence to the next keeps the read-ahead requests", "a whole sentence ... leaves no request and no timer behind".
2. **Finding 23: a read-ahead sentence that is then wanted waits behind other work.** Confirmed. The cache key left out `ahead`, so `speak()` reused the read-ahead request, and the server makes read-ahead only when nobody waits.
   Repair: when `speak()` wants a sentence that is open as read-ahead, it cancels that request and asks again without `&ahead`. The server keeps what it made, so no work is lost.
   Test: "a sentence asked as read-ahead and then wanted starts as fast as a direct request". Fake server: wanted sentence in 0.4 s, read-ahead only after 5 s. Old code: no sound within 2 s. New code: first sound at the same time as a direct request (0.41 s).
3. **Finding 9: the word highlight is ahead of the sound by the output delay.** Confirmed: `elapsed = ctx.currentTime - startedAt` did not count `outputLatency`.
   Repair: `playBuffer` takes away `ctx.outputLatency || ctx.baseLatency || 0`. A second change was necessary: with the delay, a word in the last 0.2 s of a clip was lost, because the sound ends before the ear hears its end. Now the words that are left are marked when the clip ends.
   Test: "with an output delay of 200 ms the word highlight is never ahead of the sound". Each of 7 words is marked at or after the time the ear hears it, and at most 50 ms later. Old code: word 0 was marked 190 ms early.
4. **Extra fault from ticket 03: the server goes down in the middle of a book, and the reader does not change to the Mac voice.** Confirmed. `ServerEngine.ready` stays true, so the change to the Mac voice in `app.js selectEngine` never runs again. `speak()` called `onError`; app.js tried once more after 1 s, then stopped with "The voice did not answer. Press Play to try again." Play then failed again. Also, when the second piece of a long sentence failed, its rejection was not handled.
   Repair, in `ServerEngine` only: a refused connection, or no answer in 30 s for a wanted sentence, sets `down = true` and `device = 'Mac voice (the natural voice does not answer)'`. The same sentence (or the rest of it, from the second piece) is then read with the Mac voice (an internal `SystemEngine`, the best English voice from its list). The word highlight follows the Mac voice, with the right place in the sentence. While `down`, no sound or read-ahead requests go to the server. At a sentence start, at most every 5 s, the engine asks `/voices` (3 s limit). When it answers, the next sentence uses the natural voice again, so one sentence never has two voices. A late read-ahead (120 s) does not count as "down". A server error with an answer (500, 409) still goes to `onError`, as before.
   Tests: "the voice server goes down in the middle of a book ..." and "the server goes down between the two pieces of a long sentence ...".

### Changes in other files that the repair needs (not made)

- `extension/pdf/app.js`, `speakCurrent()`: the status label is calculated before `engine.speak()` (`const readyLabel = engineLabel(engine)`). So for the first sentence after the server goes down, the status shows the old label; from the next sentence on it shows "ready · Mac voice (the natural voice does not answer)". Exact change: in `onWord`, replace `setStatus(readyLabel)` with `setStatus(engineLabel(engine))`, and delete the `readyLabel` line. Then the owner sees the Mac voice from its first word.
- Optional, `app.js engineLabel()`: for `eng.device` that starts with "Mac voice", return the device text without the prefix "ready · ".
- The Mac voice used in a fall is the first voice of `SystemEngine.listVoices()`, not the Mac voice that the owner chose in the menu (`pr.voice.system` in localStorage). If the owner wants his own choice, app.js can set `engines.kokoro.macVoice` and tts.js can use it; this is not done.

### Manual check in real Chrome (the unit tests cannot prove the sound)

1. Open a PDF in the reader. Select the natural voice. Press Play.
2. Stop the voice server (`launchctl unload` of its LaunchAgent, or stop the process). Do not touch the reader.
3. Expect: the reading goes on with the Mac voice in at most 30 s (at once when the connection is refused). The word highlight follows. After the next sentence starts, the status shows "Mac voice (the natural voice does not answer)".
4. Start the voice server again. Expect: in about 5 to 15 s, at the start of a sentence, the natural voice comes back. The status no longer names the Mac voice.
5. With the server running, press the next-sentence key 6 times fast. With `VOICE_LOG=1` on the server, expect only the last sentence as `NOW` and its next two as `ahead`.
6. Pause on a sentence, wait 1 s, press Play. Expect the sound in about the same time as for a direct sentence (no wait behind other read-ahead).
7. With AirPods or other Bluetooth headphones, read a paragraph. Expect the word highlight not ahead of the voice.

### Test run

- `node --check extension/pdf/tts.js`: no error.
- `node --test --test-timeout=120000 tests/node/voice-requests.test.mjs`: 10 tests, 10 pass.
- `tests/node/reader-transport.test.mjs`: 19 pass.
- `./run-tests.sh`: Python PASS; Node 197 tests, 196 pass, 1 fail: "rotated.pdf reads as its reference" in `pdf-text.test.mjs`. That is the work on extract.js and its new sample by another agent, not this ticket.

### Left for other tickets

- Speed that keeps the pitch (finding 10): ticket 06, not touched.
- The status label change in app.js (above).
- The audio cache keeps up to 60 decoded sentences (about 1 MB for each 10 s of sound). Not measured in this ticket.

## Review round 2

A reviewer found 2 bugs, 2 risks and 1 weak test. Again, the tests came first: 6 of the new or changed tests failed with the round-1 code, and all of them pass now. Changed files: only `extension/pdf/tts.js` and `tests/node/voice-requests.test.mjs` (now 15 tests).

1. **The last word was marked before the ear heard it.** Confirmed: the round-1 `onended` marked all words that were left at the clip end, so a word 0.1 s before the end was marked 0.1 s early. Repair: at the clip end, `playBuffer` waits the output delay (a timer in `handle.tail`, cleared by `cancelTick`, so a stop or a new sentence cancels it). The words go on during that time, then the sentence ends. Test: "a word 0.1 s before the clip end ...": the last word is marked at or after 2.1 s (clip 2 s + delay 0.2 s). The end of the sentence comes at most 0.2 s + 10 ms after the clip end, so the gap between sentences grows by the output delay only.
2. **Cancel-and-ask-again for a wanted read-ahead sentence.** I read `voice-server.py`. One part of the claim is wrong. `speak()` looks in the cache when the request arrives. `_make()` looks in the cache again after it gets the engine (line ~205). `synth()` is never stopped after it starts (the `gone` check is only before `synth`). `cache_put` runs before the lock opens. So a cancelled read-ahead that is being made still finishes and is stored, and the wanted request then gets it from the cache: no second generation, and no work is lost. The true cause of finding 23 is only the queue. A read-ahead request waits while any wanted sentence waits, and the newest read-ahead goes first (`_take`). I found no other cause: `/times` of a read-ahead request returns at once from the cache.
   Repair, as the reviewer asked: the read-ahead request is no longer cancelled when its sentence becomes wanted. Its result counts, and from that moment it has the 30 s limit of a wanted sentence. A second request without `&ahead` also goes to the server, so the sentence does not wait behind newer read-ahead. The first answer counts. Read-ahead is cancelled only by `stop()` (a pause or a jump, when the sentence is no longer near), or after 120 s.
   New fake: one engine that makes one sentence at a time (1 s each). It never stops a started sentence and keeps what it made. Wanted sentences go first, then read-ahead, newest first. A closed request that still waits is skipped. "The old code" time is the answer time of the read-ahead request, because the code before this ticket waited for exactly that request.
   - Test "read-ahead already being made, then wanted": the first sound is not later than with the old code (at most 0.75 s after Play), the read-ahead request is not cancelled, and the sentence is made once.
   - Test "read-ahead waiting in the queue, then wanted": the first sound comes at about 2 s; the old code needs about 3 s, because it waited behind the newer read-ahead. The sentence is made once.
   - Test "a read-ahead request that becomes wanted gets the time limit of a wanted sentence".
   The round-1 test "starts as fast as a direct request" is removed. Its fake had a fixed delay with no engine, so it did not prove the claim.
3. **The word timing was lost on a cancel.** Confirmed: `get('times').catch(() => ({}))` also caught the cancel, so the sentence was kept with `starts = null` and its word highlight used the estimate. Repair: a cancel is thrown again, and nothing is kept. A real failure of `/times` still gives the estimate, as before. Test: "a stop while the word timing is asked ...": after the stop the cache is empty; the next request asks `/times` again and keeps the server timing.
4. **`speak()` never ended after `stop()`.** The fault is confirmed: `stop()` sets `onended` to null, so the wait for the sound never ended. That kept the sentence's buffer and callbacks alive after each stop. Repair: `speak()` keeps the end of its wait in `this.wake`, and `stop()` ends it. The claim "the Preview button stays disabled" is not true in the present app.js: `stop()`, `play()` and `jumpTo()` in app.js set `previewBtn.disabled = false`, and nothing comes after the `await` in the Preview handler. Test: "speak() ends after stop(): while it plays, and while it waits for the server".
5. **Weak test.** Confirmed: in round 1 the read-ahead ended before its sentence started. The reason filter never matched. Now the read-ahead takes 1.5 s, longer than sentence 0 (0.3 s to make + 1 s to play). The test first checks that the read-ahead of sentence 1 is still open when sentence 1 starts. Then it checks that no request was cancelled and that this read-ahead gave its answer. It failed with the round-1 code.

### Manual check in real Chrome, added to the list above

8. With `VOICE_LOG=1` on the server: pause, then press Play on a sentence that was read ahead. Expect no second `NOW` line that makes the same sentence again, and the sound without a wait behind other read-ahead.
9. With Bluetooth headphones: the last word of a paragraph is marked when it is heard, and the pause between paragraphs is not much longer than with the speaker of the Mac.

### Test run, round 2

- `node --check extension/pdf/tts.js`: no error.
- `tests/node/voice-requests.test.mjs`: 15 tests, 15 pass.
- `tests/node/reader-transport.test.mjs`: 19 pass.
- `./run-tests.sh`: Python PASS; Node 202 tests, 201 pass, 1 fail: "rotated.pdf reads as its reference" (`pdf-text.test.mjs`). That failure belongs to the extract.js work of another agent.
