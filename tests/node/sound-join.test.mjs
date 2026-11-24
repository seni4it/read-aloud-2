// Tests for the join of two Sentences on an output with a delay (a Bluetooth headset), in the add-on's sound page
// (extension/offscreen.js). 19 Nov 2026: the Report showed a silence of 0.3 s after each Sentence on a Bluetooth
// headset, against 0.04 s on a fast output. The sound page now measures the delay of the output and starts the sound
// of the next Sentence that much before the end.
//
// The fake Audio here is an output with a delay, in real time: its clock stands at 0 for the delay after play(),
// then runs, and 'ended' comes when the clock reaches the end (as Chrome does). No voice server is asked.
// As the test browser showed on a Bluetooth headset: a sound that starts after silence (also the short silence
// between two Sentences) has a longer delay than a sound that starts while another one sounds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const EXT = fileURLToPath(new URL('../../extension/', import.meta.url));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (ok, ms = 3000) => { const end = Date.now() + ms; while (!ok()) { if (Date.now() > end) throw new Error('waited too long'); await wait(5); } };

// Timers that do not hold the test run open when a test fails before it stops its sounds.
const soft = (make) => (f, ms) => { const t = make(f, ms); t.unref(); return t; };
const softTimeout = soft(setTimeout), softInterval = soft(setInterval);

function event() {
  const fns = [];
  return { fns, addListener: (f) => fns.push(f), fire: (...a) => fns.map((f) => f(...a)) };
}

// out.delay: ms between play() and the first sound in the ear, for a sound that starts while another one sounds.
// out.idle: ms more for a sound that starts when no sound plays. out.cold: ms more when no sound played for 0.5 s.
// A test can change `out` while it reads (the owner changes the output).
// seconds: the length of the sound of each text (0.5 s when not named).
function loadSoundPage(out = {}, seconds = {}) {
  const onMessage = event();
  const sent = [], made = [];
  let lastSound = 0;  // when a fake sound last sounded
  const sounds = () => made.some((a) => !a.paused && !a.ended);
  class FakeAudio {
    constructor() { this.paused = true; this.ended = false; this.playbackRate = 1; this.duration = NaN; this.readyState = 0; this.at = 0; this.callAt = 0; this.lag = 0; this.timer = null; made.push(this); }
    set src(u) { this.url = String(u); this.text = new URL(this.url).searchParams.get('text'); this.duration = seconds[this.text] || 0.5; this.readyState = 4; }
    get src() { return this.url || ''; }
    get currentTime() {
      if (this.paused || this.ended) return this.at;
      return Math.min(this.duration, this.at + Math.max(0, Date.now() - this.callAt - this.lag) / 1000 * this.playbackRate);
    }
    play() {
      if (!this.url) return Promise.reject(Object.assign(new Error('no sound'), { name: 'NotSupportedError' }));
      this.callAt = Date.now(); this.playedAt = this.playedAt || this.callAt;
      this.lag = (out.delay || 0) + (sounds() ? 0 : out.idle || 0) + (this.callAt - lastSound > 500 ? out.cold || 0 : 0);
      this.paused = false;
      const left = (this.duration - this.at) / this.playbackRate * 1000 + this.lag;
      this.timer = softTimeout(() => { this.at = this.duration; this.ended = true; this.endedAt = lastSound = Date.now(); this.onended?.(); }, left);
      this.beat = softInterval(() => { lastSound = Date.now(); }, 20);
      softTimeout(() => { if (!this.paused) this.onplaying?.(); }, 0);
      return Promise.resolve();
    }
    pause() { this.at = this.currentTime; this.paused = true; this.pausedAt = Date.now(); clearTimeout(this.timer); clearInterval(this.beat); }
    removeAttribute(k) { if (k === 'src') { this.url = ''; this.freed = true; } }
    load() {}
  }
  const ctx = vm.createContext({
    chrome: { runtime: { onMessage, sendMessage: (m) => { sent.push({ ...m, at: Date.now() }); return Promise.resolve(); } } },
    Audio: FakeAudio, fetch: async () => ({ json: async () => ({ starts: [] }) }), setInterval: softInterval, clearInterval, setTimeout: softTimeout, clearTimeout, AbortSignal, console,
  });
  vm.runInContext(readFileSync(EXT + 'offscreen.js', 'utf8'), ctx, { filename: 'offscreen.js' });
  const texts = ['One.', 'Two.', 'Three.', 'Four.', 'Five.'];
  const speak = (id, text = texts[id - 1], next = texts.slice(id, id + 2)) => onMessage.fire({ to: 'offscreen', cmd: 'speak', tab: 1, id, text, voice: 'af', rate: 1, speed: 1, method: '', keepPitch: true, next }, {}, () => {});
  const cmd = (c, more = {}) => { let answer; onMessage.fire({ to: 'offscreen', cmd: c, ...more }, {}, (v) => { answer = v; }); return answer; };
  const evt = (name, id) => sent.find((m) => m.evt === name && m.id === id);
  const stopAll = () => { cmd('stop'); made.forEach((a) => { clearTimeout(a.timer); clearInterval(a.beat); }); };
  // the page: it asks for the next Sentence when it hears the end of this one, a little later (as a real page does)
  const readTo = async (last, first = 1) => { for (let id = first; id <= last; id++) { speak(id); await until(() => evt('end', id)); await wait(15); } };
  const of = (text) => made.filter((a) => a.text === text);
  return { speak, cmd, made, sent, evt, stopAll, readTo, of, notes: (name) => sent.filter((m) => m.evt === 'note' && (!name || m.name === name)) };
}
// A Bluetooth headset as the test browser measured it: 0.18 s for a sound that joins, 0.36 s after silence, more when cold.
const headset = () => ({ delay: 180, idle: 180, cold: 350 });

test('a fast output: no sound starts early, and each Sentence gets its own sound when the page asks', async () => {
  const o = loadSoundPage({ delay: 15 });
  await o.readTo(3);
  assert.equal(o.made.length, 3, 'one sound for each Sentence that the page asked for');
  assert.ok(!o.evt('end', 2).pre && !o.evt('end', 3).pre);
  const end = o.evt('end', 2);
  assert.ok(Math.abs(end.lag - 15) < 30, 'the Report has the delay of the output: ' + end.lag);
  assert.ok(end.join > 10 && end.join < 90, 'and the silence before the Sentence, the delay and the wait of the page: ' + end.join);
  o.stopAll();
});

test('a fast output that starts late after silence: one small early start, no two Sentences together, then none', async () => {
  const o = loadSoundPage({ delay: 15, cold: 150 });
  await o.readTo(4);
  assert.equal(o.made.length, 4);
  assert.equal(o.evt('end', 2).pre, 1, 'the first Sentence started late: a small early start measures the delay');
  assert.ok(o.evt('end', 2).join > -40, 'it does not make two Sentences sound together: ' + o.evt('end', 2).join);
  assert.ok(!o.evt('end', 3).pre && !o.evt('end', 4).pre, 'the measured delay is small: no more early starts');
  assert.equal(o.notes('join-overlap').length, 0);
  o.stopAll();
});

test('a headset with a delay: the next Sentence starts early, and the silence at the join is short', async () => {
  const o = loadSoundPage(headset());
  o.speak(1);
  await until(() => o.evt('end', 1));
  assert.equal(o.of('Two.').length, 1, 'the sound of Sentence 2 was made before the page asked for it');
  const one = o.made[0], two = o.of('Two.')[0];
  const first = one.endedAt - two.playedAt;
  assert.ok(first > 5 && first < 80, 'the delay of an early sound is not measured yet: a small early start of about 30 ms: ' + first);
  await wait(15);
  o.speak(2);
  await until(() => o.evt('end', 2));
  assert.equal(o.of('Two.').length, 1, 'the page asked for Sentence 2: its early sound was taken, no new one');
  const end2 = o.evt('end', 2);
  assert.equal(end2.pre, 1, 'the Report knows that this sound started early');
  assert.ok(Math.abs(end2.lag - 180) < 50, 'the delay of a sound that starts while another one sounds: ' + end2.lag);
  assert.ok(end2.join > 90 && end2.join < 220, 'the silence before Sentence 2, the delay less the small early start: ' + end2.join);
  const three = o.of('Three.')[0];
  const early = o.made[1].endedAt - three.playedAt;
  assert.ok(early > 70 && early < 180, 'Sentence 3 started about 120 ms (the delay less the join) before the end: ' + early);
  await wait(15);
  o.speak(3);
  await until(() => o.evt('end', 3));
  assert.equal(o.of('Three.').length, 1);
  assert.ok(o.evt('start', 3), 'the page gets the start of Sentence 3');
  const end3 = o.evt('end', 3);
  assert.equal(end3.pre, 1);
  assert.ok(end3.join > 0 && end3.join < 130, 'the silence before Sentence 3 in ms (it was 375 with no early start): ' + end3.join);
  assert.ok(Math.abs(end3.heardMs - 500) < 60, 'the time that the sound took in the ear: ' + end3.heardMs);
  assert.equal(o.notes('join-overlap').length, 0, 'no two Sentences sounded together');
  o.stopAll();
});

test('the page asks for another Sentence: the early sound stops, and the asked Sentence sounds', async () => {
  const o = loadSoundPage(headset());
  await o.readTo(1);
  o.speak(2);
  await until(() => o.evt('end', 2));
  const three = o.of('Three.')[0];
  assert.ok(three && !three.paused, 'the early sound of Sentence 3 plays');
  o.speak(3, 'Another one.');
  await until(() => o.evt('start', 3));
  assert.ok(three.paused && three.freed, 'the early sound of "Three." was stopped');
  assert.equal(o.of('Another one.').length, 1);
  assert.equal(o.notes('early-start-lost').length, 1, 'the Report has a line for the lost early start');
  assert.equal(o.notes('early-start-lost')[0].data.why, 'other');
  o.stopAll();
});

test('a pause after the early start: the early sound stops; after resume the same Sentence goes on, and the join is safe', async () => {
  const o = loadSoundPage(headset(), { 'Two.': 0.6 });
  await o.readTo(1);
  o.speak(2);
  await until(() => o.of('Three.').length === 1 && !o.of('Three.')[0].paused);
  const three = o.of('Three.')[0];
  o.cmd('pause');
  assert.ok(three.paused && three.freed, 'the early sound was stopped by the pause');
  assert.ok(!o.evt('end', 2), 'Sentence 2 did not end');
  assert.equal(o.cmd('resume'), true);
  await until(() => o.evt('end', 2));
  await wait(15);
  o.speak(3);
  await until(() => o.evt('end', 3));
  assert.equal(o.of('Three.').length, 2, 'Sentence 3 got a new sound after the pause');
  assert.ok(o.evt('end', 3).join === undefined || o.evt('end', 3).join > -40, 'no two Sentences sounded together after the pause');
  assert.equal(o.notes('join-overlap').length, 0);
  assert.deepEqual(o.sent.filter((m) => m.evt === 'end').map((m) => m.id), [1, 2, 3], 'each Sentence ends once');
  o.stopAll();
});

test('stop after the early start stops both sounds', async () => {
  const o = loadSoundPage(headset(), { 'Two.': 0.6 });
  await o.readTo(1);
  o.speak(2);
  await until(() => o.of('Three.').length === 1 && !o.of('Three.')[0].paused);
  o.cmd('stop');
  assert.ok(o.made.every((a) => a.paused || a.ended), 'no sound goes on');
  await wait(700);
  assert.ok(!o.evt('end', 2) && !o.evt('start', 3), 'no event after the stop');
  o.stopAll();
});

test('a page that does not ask for the next Sentence: the early sound is stopped, it does not read on by itself', async () => {
  const o = loadSoundPage(headset(), { 'Three.': 4 });
  await o.readTo(1);
  o.speak(2);
  await until(() => o.evt('end', 2));
  const three = o.of('Three.')[0];
  assert.ok(three && !three.paused, 'the early sound plays');
  await wait(1700);
  assert.ok(three.paused && three.freed, 'after 1.5 s with no ask, it is stopped');
  assert.equal(o.notes('early-start-lost')[0].data.why, 'late');
  o.stopAll();
});

test('the reading goes on early from Sentence to Sentence; a short Sentence does not break it; no two Sentences together', async () => {
  const o = loadSoundPage(headset(), { 'Three.': 0.2, 'Four.': 0.5 });
  await o.readTo(5);
  assert.equal(o.made.length, 5, 'five Sentences, five sounds');
  for (const id of [2, 3, 4, 5]) {
    const end = o.evt('end', id);
    assert.equal(end.pre, 1, 'Sentence ' + id + ' started early');
    assert.ok(end.join > -40 && end.join < (id === 2 ? 220 : 150), 'the silence before Sentence ' + id + ': ' + end.join);
  }
  assert.equal(o.notes('join-overlap').length, 0);
  assert.deepEqual(o.sent.filter((m) => m.evt === 'start').map((m) => m.id), [1, 2, 3, 4, 5], 'each Sentence starts once, in order');
  assert.deepEqual(o.sent.filter((m) => m.evt === 'end').map((m) => m.id), [1, 2, 3, 4, 5], 'each Sentence ends once, in order');
  o.stopAll();
});

test('two Sentences that sounded together: the Report gets a line, and the delay is measured again', async () => {
  // the output gets faster in the reading (the owner moved from the headset to the speakers): one join comes too early
  const out = { delay: 180 };
  const o = loadSoundPage(out);
  await o.readTo(2);
  o.speak(3);
  await until(() => o.of('Four.').length === 1);  // the early start of Sentence 4 is planned with the delay of the headset
  out.delay = 15;
  await until(() => o.evt('end', 3)); await wait(15);
  o.speak(4);
  await until(() => o.evt('end', 4)); await wait(15);
  assert.ok(o.evt('end', 4).join < -40, 'Sentence 4 came too early once: ' + o.evt('end', 4).join);
  assert.equal(o.notes('join-overlap').length, 1, 'the Report has a line for it');
  o.speak(5);
  await until(() => o.evt('end', 5));
  assert.ok(o.evt('end', 5).join > -40, 'the next join is right again: ' + o.evt('end', 5).join);
  assert.equal(o.notes('join-overlap').length, 1);
  o.stopAll();
});

test('a short first Sentence on a headset: its clock stands still for the delay, and the next Sentence waits for it', async () => {
  const o = loadSoundPage(headset(), { 'One.': 0.2 });  // 0.2 s of sound that starts 0.71 s after play()
  await o.readTo(3);
  for (const id of [2, 3]) assert.ok(o.evt('end', id).join > -40, 'the silence before Sentence ' + id + ': ' + o.evt('end', id).join);
  assert.equal(o.notes('join-overlap').length, 0, 'no two Sentences sounded together');
  assert.deepEqual([o.of('One.').length, o.of('Two.').length, o.of('Three.').length], [1, 1, 1], 'one sound for each Sentence');
  o.stopAll();
});
