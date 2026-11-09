// Tests for the voice requests of the reader (extension/pdf/tts.js, ServerEngine): time limit, cancel, the priority of
// a read-ahead sentence that is wanted now, the word highlight with an output delay, and the change to the Mac voice
// when the voice server goes down (and back to the natural voice when it answers again).
// tts.js is an ES module. Its "export" words are taken out and it runs as it is in a node:vm context with fakes:
// fetch (the voice server), AudioContext (the sound), speechSynthesis (the Mac voice) and a fake clock for the timers.
// No voice server is asked. Run: node --test --test-timeout=120000 tests/node/voice-requests.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const TTS_JS = fileURLToPath(new URL('../../extension/pdf/tts.js', import.meta.url));
const flush = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

// Made lines, no book text. Fewer than 12 words: one sentence is one request.
const line = (i) => ({ text: `Made line number ${i} for the test.`, charOwners: [] });
const LONG = { text: 'One two three four five six seven eight nine ten eleven twelve thirteen.', charOwners: [] };

function loadTts({ outputLatency = 0 } = {}) {
  // The clock. Timers and animation frames run when the test moves the clock.
  const clock = { now: 0 };
  const timers = [];
  let frames = [];
  const setTimeout = (fn, ms = 0) => { const t = { fn, at: clock.now + ms, live: true }; timers.push(t); return t; };
  const clearTimeout = (t) => { if (t) t.live = false; };
  const liveTimers = () => timers.filter((t) => t.live).length;

  // The voice server. mode: 'up' answers each request after `delay` ms (read-ahead after `aheadDelay` ms),
  // 'down' refuses the connection, 'hang' never answers.
  const server = { mode: 'up', delay: 0, aheadDelay: 0, seconds: 1, starts: null, requests: [] };
  // mode 'engine' is like voice-server.py: one engine makes one sentence at a time (genMs), a started sentence is
  // never stopped, a made sentence is kept; wanted sentences go first, then read-ahead, newest first; a closed
  // request that waits is skipped (409). made: each sentence the engine made.
  Object.assign(server, { genMs: 1000, made: [], kept: new Set(), queue: [], busy: false, seq: 0 });
  const pump = () => {
    if (server.busy) return;
    for (;;) {
      server.queue = server.queue.filter((j) => !j.req.signal?.aborted);
      if (!server.queue.length) return;
      const urgent = server.queue.filter((j) => !j.req.ahead);
      const job = urgent.length ? urgent[0] : server.queue.reduce((a, b) => (b.seq > a.seq ? b : a));
      server.queue.splice(server.queue.indexOf(job), 1);
      if (server.kept.has(job.req.text)) { job.answer(); continue; }
      server.busy = true;
      setTimeout(() => { server.kept.add(job.req.text); server.made.push(job.req.text); server.busy = false; job.answer(); pump(); }, server.genMs);
      return;
    }
  };
  const fetch = (url, opts = {}) => {
    const u = new URL(url);
    const req = { path: u.pathname, text: u.searchParams.get('text'), ahead: u.searchParams.has('ahead'), signal: opts.signal, at: clock.now, done: false };
    server.requests.push(req);
    if (!opts.signal && req.path !== '/voices') req.noSignal = true;
    return new Promise((ok, fail) => {
      const end = (f, v) => { if (!req.done) { req.done = true; req.answeredAt = clock.now; f(v); } };
      opts.signal?.addEventListener('abort', () => end(fail, opts.signal.reason));
      if (server.mode === 'down') return end(fail, new TypeError('Failed to fetch'));
      if (server.mode === 'hang') return;
      if (server.timesHang && req.path === '/times') return;
      const body = {
        ok: true, status: 200,
        arrayBuffer: async () => ({ seconds: server.seconds }),
        json: async () => (req.path === '/voices' ? { voices: [{ id: 'af_heart', label: 'Heart', accent: 'US' }] } : { starts: server.starts }),
      };
      if (server.mode === 'engine' && req.path !== '/voices') {
        if (server.kept.has(req.text)) return end(ok, body);
        server.queue.push({ req, seq: server.seq++, answer: () => end(ok, body) });
        return pump();
      }
      const wait = req.path === '/speak' ? (req.ahead ? server.aheadDelay : server.delay) : 0;
      if (!wait) return end(ok, body);
      setTimeout(() => end(ok, body), wait);
    });
  };
  const live = (path = '/speak') => server.requests.filter((r) => r.path === path && !r.done && !r.signal?.aborted);

  // The sound. A source "plays" from start() until its length has passed on the clock.
  const sounds = [];
  class AudioContext {
    constructor() { this.state = 'running'; this.outputLatency = outputLatency; this.baseLatency = 0.01; this.destination = {}; }
    get currentTime() { return clock.now / 1000; }
    resume() {}
    createBuffer(_ch, length, sampleRate) {
      const data = new Float32Array(length);
      return { length, sampleRate, duration: length / sampleRate, getChannelData: () => data, copyToChannel(a) { data.set(a); } };
    }
    createBufferSource() {
      const ctx = this;
      const src = {
        buffer: null, playbackRate: { value: 1 }, onended: null, connect() {},
        start() { src.startedAt = ctx.currentTime; sounds.push(src); src.timer = setTimeout(() => src.onended?.(), (src.buffer.duration / src.playbackRate.value) * 1000); },
        stop() { clearTimeout(src.timer); src.stopped = true; },
      };
      return src;
    }
  }
  class OfflineAudioContext {
    async decodeAudioData(buf) {
      const rate = 1000;
      const data = new Float32Array(Math.round(buf.seconds * rate)).fill(0.5);
      return { sampleRate: rate, getChannelData: () => data };
    }
  }

  // The Mac voice.
  const said = [];
  const speechSynthesis = {
    speaking: false, paused: false,
    getVoices: () => [{ voiceURI: 'mac-samantha', name: 'Samantha (Enhanced)', lang: 'en-US', localService: true }],
    speak(u) { said.push(u); }, cancel() {}, pause() {}, resume() {},
    addEventListener() {}, removeEventListener() {},
  };
  class SpeechSynthesisUtterance { constructor(text) { this.text = text; } }

  const window = { speechSynthesis, AudioContext };
  const context = vm.createContext({
    window, document: { hidden: false }, console, URL, AbortController, Promise, Error, TypeError,
    fetch, AudioContext, OfflineAudioContext, SpeechSynthesisUtterance,
    setTimeout, clearTimeout, setInterval: () => ({}), clearInterval() {},
    requestAnimationFrame: (fn) => { const f = { fn }; frames.push(f); return f; },
    cancelAnimationFrame: (f) => { if (f) f.fn = null; },
  });
  const source = readFileSync(TTS_JS, 'utf8').replace(/^export /gm, '').replace(/import\.meta\.url/g, "'file:///tts.js'");
  const api = vm.runInContext(source + '\n;({ SystemEngine, KokoroEngine, ServerEngine })', context, { filename: TTS_JS });

  // Move the clock in steps of 10 ms; each step runs the timers that are due and one animation frame.
  async function advance(ms) {
    const end = clock.now + ms;
    while (clock.now < end) {
      clock.now = Math.min(end, clock.now + 10);
      for (const t of timers.filter((x) => x.live && x.at <= clock.now)) { t.live = false; t.fn(); }
      const run = frames; frames = [];
      for (const f of run) f.fn?.();
      await flush(3);
    }
  }
  return { ...api, clock, server, live, sounds, said, advance, liveTimers };
}

// The reader's own calls when it starts to read a sentence (app.js speakCurrent): speak it, then read-ahead of the next two.
function readFrom(engine, list, i, events = {}) {
  engine.speak(list[i], { voiceId: 'af_heart', rate: 1, ...events });
  engine.prefetch(list[i + 1], 'af_heart');
  engine.prefetch(list[i + 2], 'af_heart');
}

test('a voice server that does not answer: within 30 seconds the Mac voice reads the sentence, and the owner sees it', async () => {
  const t = loadTts();
  const engine = new t.ServerEngine();
  engine.ready = true;
  t.server.mode = 'hang';
  const errors = [];
  engine.speak(line(1), { voiceId: 'af_heart', rate: 1, onError: (e) => errors.push(e) });
  await t.advance(29000);
  assert.equal(t.said.length, 0, 'the Mac voice must not start before the time limit');
  await t.advance(1000);
  assert.equal(t.said.length, 1, 'after 30 seconds the Mac voice must read');
  assert.equal(t.said[0].text, line(1).text);
  assert.equal(errors.length, 0, 'the reading goes on: no error for the reader');
  assert.match(String(engine.device), /Mac voice/, 'the status must name the Mac voice');
  assert.equal(t.live().length, 0, 'the request that did not answer is cancelled');
});

test('the voice server goes down in the middle of a book: the Mac voice goes on, and the natural voice comes back at a sentence start', async () => {
  const t = loadTts();
  const engine = new t.ServerEngine();
  engine.ready = true;
  const list = Array.from({ length: 10 }, (_, i) => line(i));
  const ended = [], errors = [], words = [];
  const events = (i) => ({ onEnd: () => ended.push(i), onError: (e) => errors.push(e), onWord: (at) => words.push([i, at]) });

  readFrom(engine, list, 0, events(0));
  await t.advance(1100);
  assert.deepEqual(ended, [0], 'sentence 0 is read with the natural voice');
  assert.equal(t.sounds.length, 1);

  t.server.mode = 'down';
  readFrom(engine, list, 1, events(1));   // read-ahead of 1 is in the cache; 1 plays with the natural voice
  await t.advance(1100);
  readFrom(engine, list, 3, events(3));   // not made: the server is down now
  await t.advance(50);
  assert.equal(errors.length, 0, 'no error: the reading goes on');
  assert.equal(t.said.at(-1)?.text, list[3].text, 'the Mac voice reads sentence 3');
  assert.match(String(engine.device), /Mac voice/, 'the status names the Mac voice');
  t.said.at(-1).onboundary({ name: 'word', charIndex: 5, charLength: 4 });
  assert.deepEqual(words.at(-1), [3, 5], 'the word highlight follows the Mac voice');

  // While the server is down, no new requests for sound go to it.
  const before = t.server.requests.filter((r) => r.path === '/speak').length;
  t.said.at(-1).onend();
  readFrom(engine, list, 4, events(4));
  await t.advance(50);
  assert.equal(t.said.at(-1).text, list[4].text);
  assert.equal(t.server.requests.filter((r) => r.path === '/speak').length, before, 'no sound requests while the server is down');

  // The server answers again. Within some sentences the natural voice comes back, at the start of a sentence.
  t.server.mode = 'up';
  let back = -1;
  for (let i = 5; i < 9 && back < 0; i++) {
    await t.advance(6000);
    const soundsBefore = t.sounds.length;
    readFrom(engine, list, i, events(i));
    await t.advance(50);
    if (t.sounds.length > soundsBefore) back = i;
  }
  assert.ok(back > 0, 'the natural voice must come back');
  assert.ok(engine.device == null || !/Mac voice/.test(engine.device), 'the status no longer names the Mac voice');
  assert.equal(errors.length, 0);
});

test('the server goes down between the two pieces of a long sentence: the Mac voice reads the rest, with the right word places', async () => {
  const t = loadTts();
  const engine = new t.ServerEngine();
  engine.ready = true;
  const words = [], errors = [];
  t.server.delay = 0;
  // The first piece answers, the second does not: the connection is refused from the second /speak on.
  const realMode = () => (t.server.requests.filter((r) => r.path === '/speak').length > 1 ? 'down' : 'up');
  Object.defineProperty(t.server, 'mode', { get: realMode, configurable: true });
  engine.speak(LONG, { voiceId: 'af_heart', rate: 1, onWord: (at) => words.push(at), onError: (e) => errors.push(e) });
  await t.advance(1500);
  assert.equal(errors.length, 0);
  const rest = LONG.text.slice(LONG.text.indexOf('six'));
  assert.equal(t.said.at(-1)?.text.trim(), rest.trim(), 'the Mac voice reads the rest of the sentence');
  t.said.at(-1).onboundary({ name: 'word', charIndex: 0, charLength: 3 });
  assert.equal(words.at(-1), LONG.text.indexOf('six'), 'the word place counts from the start of the whole sentence');
});

test('6 fast jumps: only the last sentence and its read-ahead stay asked; stop cancels every request', async () => {
  const t = loadTts();
  const engine = new t.ServerEngine();
  engine.ready = true;
  t.server.mode = 'hang';
  const list = Array.from({ length: 20 }, (_, i) => line(i));
  for (const i of [2, 5, 9, 11, 14, 17]) { engine.stop(); readFrom(engine, list, i); await t.advance(10); }
  const wanted = t.live().map((r) => r.text).sort();
  assert.deepEqual(wanted, [list[17].text, list[18].text, list[19].text].sort(), 'requests still asked: ' + wanted.length);
  assert.deepEqual(t.live().filter((r) => !r.ahead).map((r) => r.text), [list[17].text], 'only the last sentence is asked as wanted now');
  engine.stop();
  assert.equal(t.live().length, 0, 'after stop no request is left');
  await t.advance(130000);
  assert.equal(t.liveTimers(), 0, 'no time-limit timer is left');
});

test('reading on from one sentence to the next keeps the read-ahead requests', async () => {
  const t = loadTts();
  const engine = new t.ServerEngine();
  engine.ready = true;
  // The read-ahead takes longer (1.5 s) than sentence 0 (0.3 s to make, 1 s to play): it is still open when
  // sentence 1 starts and is wanted.
  t.server.delay = 300; t.server.aheadDelay = 1500;
  const list = Array.from({ length: 6 }, (_, i) => line(i));
  readFrom(engine, list, 0, { onEnd: () => readFrom(engine, list, 1) });
  await t.advance(1400);
  const ahead1 = t.server.requests.find((r) => r.path === '/speak' && r.ahead && r.text === list[1].text);
  assert.ok(ahead1 && !ahead1.done, 'the read-ahead of sentence 1 is still open when sentence 1 starts');
  await t.advance(1000);
  const aborted = t.server.requests.filter((r) => r.signal?.aborted);
  assert.deepEqual(aborted.map((r) => r.text), [], 'no request is cancelled when the reading goes on');
  assert.ok(ahead1.done && !ahead1.signal.aborted, 'the read-ahead of sentence 1 gave its answer');
});

// The first sound with the code before this ticket is the answer time of the read-ahead request: that code waited
// for that request. The new code must never be later, and must make each sentence only once.
async function wantedAfterReadAhead(setup) {
  const t = loadTts();
  const engine = new t.ServerEngine(); engine.ready = true;
  t.server.mode = 'engine'; t.server.genMs = 1000;
  const list = Array.from({ length: 6 }, (_, i) => line(i));
  const at = await setup(t, engine, list);
  const t0 = t.clock.now;
  const before = t.sounds.length;
  engine.speak(list[1], { voiceId: 'af_heart', rate: 1 });   // sentence 1 is wanted now
  await t.advance(6000);
  const sound = t.sounds.slice(before).find((x) => x.buffer);
  const ahead = t.server.requests.find((r) => r.path === '/speak' && r.ahead && r.text === list[1].text);
  return { t, t0, at, first: sound.startedAt * 1000, oldFirst: ahead.answeredAt, ahead, made: t.server.made, list };
}

test('read-ahead already being made, then wanted: the sound is not later than before, the sentence is made once', async () => {
  const r = await wantedAfterReadAhead(async (t, engine, list) => {
    engine.prefetch(list[1], 'af_heart');   // the engine starts on it at once
    await t.advance(300);
  });
  assert.ok(!r.ahead.signal.aborted, 'the read-ahead request is not cancelled');
  assert.ok(r.first <= r.oldFirst + 20, `first sound at ${r.first} ms, the old code at ${r.oldFirst} ms`);
  assert.ok(r.first - r.t0 <= 750, `first sound ${r.first - r.t0} ms after Play: only the rest of the making`);
  assert.equal(r.made.filter((x) => x === r.list[1].text).length, 1, 'sentence 1 is made once');
});

test('read-ahead waiting in the queue, then wanted: it goes first and the sound comes earlier than before', async () => {
  const r = await wantedAfterReadAhead(async (t, engine, list) => {
    engine.speak(list[0], { voiceId: 'af_heart', rate: 1 });   // the engine makes sentence 0 now
    engine.prefetch(list[1], 'af_heart');                        // queued
    engine.prefetch(list[2], 'af_heart');                        // queued, newer: the server makes it before 1
    await t.advance(200);
  });
  assert.ok(r.first <= r.oldFirst + 20, `first sound at ${r.first} ms, the old code at ${r.oldFirst} ms`);
  assert.ok(r.first < r.oldFirst, 'a wanted sentence does not wait behind newer read-ahead');
  assert.equal(r.made.filter((x) => x === r.list[1].text).length, 1, 'sentence 1 is made once');
});

test('a read-ahead request that becomes wanted gets the time limit of a wanted sentence (30 s from then)', async () => {
  const t = loadTts();
  const engine = new t.ServerEngine(); engine.ready = true;
  t.server.mode = 'hang';
  engine.prefetch(line(1), 'af_heart');
  await t.advance(60000);
  engine.speak(line(1), { voiceId: 'af_heart', rate: 1 });
  await t.advance(29000);
  assert.equal(t.said.length, 0);
  await t.advance(1100);
  assert.equal(t.said.length, 1, 'after 30 s the Mac voice reads');
  assert.equal(t.live().length, 0);
});

test('with an output delay of 200 ms the word highlight is never ahead of the sound', async () => {
  const t = loadTts({ outputLatency: 0.2 });
  const engine = new t.ServerEngine();
  engine.ready = true;
  t.server.seconds = 2;
  t.server.starts = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.8];   // word timing from the server, one per word of the line
  const marks = [];
  const text = 'Made line number one for the test.';
  engine.speak({ text, charOwners: [] }, { voiceId: 'af_heart', rate: 1, onWord: (at) => marks.push({ at, time: t.clock.now / 1000 }) });
  await t.advance(2500);
  assert.equal(marks.length, 7);
  const start = t.sounds[0].startedAt;
  marks.forEach((m, i) => {
    const heard = start + t.server.starts[i] + 0.2;
    assert.ok(m.time >= heard - 1e-9, `word ${i} marked at ${m.time.toFixed(3)} s, heard at ${heard.toFixed(3)} s`);
    assert.ok(m.time <= heard + 0.05, `word ${i} marked too late: ${m.time.toFixed(3)} s, heard at ${heard.toFixed(3)} s`);
  });
});

test('the first question to the voice server has a time limit of 3 seconds', async () => {
  const t = loadTts();
  const engine = new t.ServerEngine();
  t.server.mode = 'hang';
  let failed = null;
  engine.init().catch((e) => { failed = e; });
  await t.advance(3100);
  assert.ok(failed, 'init() must fail within 3 seconds when the server does not answer');
  assert.equal(engine.ready, false);
});

test('a whole sentence read with the natural voice leaves no request and no timer behind', async () => {
  const t = loadTts();
  const engine = new t.ServerEngine();
  engine.ready = true;
  let ended = false;
  engine.speak(line(1), { voiceId: 'af_heart', rate: 1, onEnd: () => { ended = true; } });
  await t.advance(1500);
  assert.ok(ended);
  assert.equal(t.live().length, 0);
  assert.equal(t.liveTimers(), 0, 'every time-limit timer is cleared');
  assert.equal(engine.requests?.size ?? engine.inflight.size, 0);
});

test('a read-ahead request that waits long is cancelled after 120 s, but does not change the voice', async () => {
  const t = loadTts();
  const engine = new t.ServerEngine();
  engine.ready = true;
  t.server.mode = 'hang';
  engine.prefetch(line(1), 'af_heart');
  await t.advance(121000);
  assert.equal(t.live().length, 0, 'the read-ahead request is cancelled');
  assert.equal(engine.down, false, 'the natural voice stays');
  assert.equal(t.liveTimers(), 0);
});

test('a word 0.1 s before the clip end is marked when the ear hears it; the end comes at most the output delay later', async () => {
  const t = loadTts({ outputLatency: 0.2 });
  const engine = new t.ServerEngine();
  engine.ready = true;
  t.server.seconds = 2;
  t.server.starts = [0, 0.3, 0.6, 0.9, 1.2, 1.5, 1.9];
  const marks = []; let endAt = null;
  engine.speak({ text: 'Made line number one for the test.', charOwners: [] }, {
    voiceId: 'af_heart', rate: 1,
    onWord: () => marks.push(t.clock.now / 1000), onEnd: () => { endAt = t.clock.now / 1000; } });
  await t.advance(3000);
  const start = t.sounds[0].startedAt;
  assert.equal(marks.length, 7);
  assert.ok(marks[6] >= start + 1.9 + 0.2 - 1e-9, `last word marked at ${marks[6].toFixed(3)} s, heard at ${(start + 2.1).toFixed(3)} s`);
  const clipEnd = start + 2;
  assert.ok(endAt != null && endAt >= clipEnd, 'the end comes');
  assert.ok(endAt - clipEnd <= 0.2 + 0.011, `the gap grows by ${(endAt - clipEnd).toFixed(3)} s, the output delay is 0.2 s`);
});

test('a stop while the word timing is asked: the sentence is not kept without its word timing', async () => {
  const t = loadTts();
  const engine = new t.ServerEngine();
  engine.ready = true;
  t.server.starts = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
  t.server.timesHang = true;
  engine.speak(line(1), { voiceId: 'af_heart', rate: 1 });
  await t.advance(50);
  engine.stop();
  await t.advance(50);
  assert.equal(engine.cache.size, 0, 'nothing kept: the word timing was not received');
  t.server.timesHang = false;
  const marks = [];
  engine.speak(line(1), { voiceId: 'af_heart', rate: 1, onWord: () => marks.push(t.clock.now) });
  await t.advance(1500);
  assert.ok(t.server.requests.some((r) => r.path === '/times' && r.done && !r.signal.aborted), 'the word timing is asked again');
  assert.equal(engine.cache.values().next().value?.starts?.length, 7, 'the kept sentence has the word timing of the server');
});

test('speak() ends after stop(): while it plays, and while it waits for the server', async () => {
  const t = loadTts();
  const engine = new t.ServerEngine();
  engine.ready = true;
  let done = false;
  engine.speak(line(1), { voiceId: 'af_heart', rate: 1 }).then(() => { done = true; });
  await t.advance(300);
  assert.equal(t.sounds.length, 1, 'it plays');
  engine.stop();
  await t.advance(20);
  assert.ok(done, 'speak() ended after a stop while it played');

  t.server.mode = 'hang';
  done = false;
  engine.speak(line(2), { voiceId: 'af_heart', rate: 1 }).then(() => { done = true; });
  await t.advance(100);
  engine.stop();
  await t.advance(20);
  assert.ok(done, 'speak() ended after a stop while it waited');
});
