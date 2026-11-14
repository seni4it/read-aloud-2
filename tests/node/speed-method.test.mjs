// Tests for ticket 06, the speed method (owner's decision of 10 Nov 2026): A "Voice speaks faster" (the voice model
// makes the sound at the asked speed, played at rate 1; the default), C "Stretch, same pitch" (the speed-1 sound
// stretched by the voice server with ffmpeg), B "Simple, as before" (the speed-1 sound played faster; the method
// of before). And part 1: the reader served by the voice server asks its own origin (localhost or 127.0.0.1).
// tts.js, background.js and offscreen.js run as they are in node:vm contexts with fakes. No voice server is asked.
// Run: node --test --test-timeout=120000 tests/node/speed-method.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as language from '../../extension/pdf/language.js';  // ticket 32: app.js imports it

const TTS_JS = fileURLToPath(new URL('../../extension/pdf/tts.js', import.meta.url));
const EXT = fileURLToPath(new URL('../../extension/', import.meta.url));
const flush = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const RATE = 1000;  // the fake decode: 1000 samples a second, 4000 bytes a second

// tts.js with a fake voice server and a fake clock. server.methods: what /voices says (null: an old server, no "speed").
function loadTts({ location, methods = ['A', 'B', 'C'], element = false, refusePlay = false } = {}) {
  const clock = { now: 0 };
  const timers = [];
  let frames = [];
  const setTimeout = (fn, ms = 0) => { const t = { fn, at: clock.now + ms, live: true }; timers.push(t); return t; };
  const clearTimeout = (t) => { if (t) t.live = false; };
  const server = { mode: 'up', seconds: 1, starts: null, requests: [], methods };
  const fetch = async (url) => {
    const u = new URL(url);
    const req = { url, origin: u.origin, path: u.pathname, text: u.searchParams.get('text'), speed: u.searchParams.get('speed'),
      method: u.searchParams.get('method'), ahead: u.searchParams.has('ahead') };
    server.requests.push(req);
    if (server.mode === 'down') throw new TypeError('Failed to fetch');
    const voices = { voices: [{ id: 'af_heart', label: 'Heart', accent: 'US' }] };
    if (server.methods) voices.speed = { min: 0.5, max: 4, methods: server.methods };
    // The sound of speed s lasts seconds / s (methods A and C); B and speed 1 ask no speed.
    if (server.refuseC && req.method === 'C') return { ok: false, status: 400, arrayBuffer: async () => ({}), json: async () => ({}) };
    const s = Number(req.speed || 1);
    const slow = req.method === 'A' ? (server.aSlow || 1) : 1;  // method A is not exact: its sound can be longer than asked
    return { ok: true, status: 200, arrayBuffer: async () => ({ seconds: (server.seconds / s) * slow }),
      json: async () => (req.path === '/voices' ? voices : { starts: server.starts }) };
  };
  const sounds = [];
  class AudioContext {
    constructor() { this.state = 'running'; this.outputLatency = 0; this.baseLatency = 0; this.destination = {}; }
    get currentTime() { return clock.now / 1000; }
    resume() {}
    createBuffer(_ch, length, sampleRate) {
      const data = new Float32Array(length).fill(0.5);
      return { length, sampleRate, duration: length / sampleRate, getChannelData: () => data, copyToChannel(a) { data.set(a); } };
    }
    createBufferSource() {
      const src = { buffer: null, playbackRate: { value: 1 }, onended: null, connect() {},
        start() { sounds.push(src); src.timer = setTimeout(() => src.onended?.(), (src.buffer.duration / src.playbackRate.value) * 1000); },
        stop() { clearTimeout(src.timer); } };
      return src;
    }
  }
  class OfflineAudioContext {
    async decodeAudioData(buf) {
      const data = new Float32Array(Math.round(buf.seconds * RATE)).fill(0.5);
      return { sampleRate: RATE, getChannelData: () => data };
    }
  }
  // The sound element of the browser (14 Nov 2026): it plays a WAV file at a speed and keeps the pitch. `element: true`
  // gives the reader such an element; without it the reader has only the audio context, as an old browser.
  const elements = [], blobs = new Map(), freed = [];
  class Blob { constructor(parts, opts) { this.parts = parts; this.type = opts && opts.type; } }
  class FakeURL extends URL {
    static createObjectURL(blob) { const u = 'blob:test/' + (blobs.size + 1); blobs.set(u, blob); return u; }
    static revokeObjectURL(u) { freed.push(u); }
  }
  class Audio {
    constructor() { this.playbackRate = 1; this.preservesPitch = undefined; this.onended = null; this.onerror = null; this.paused = true; this.address = ''; elements.push(this); }
    set src(v) { this.address = v; this.blob = blobs.get(v); }
    get src() { return this.address; }
    get wav() { const part = this.blob.parts[0]; return new DataView(part.buffer || part); }
    get duration() { return this.wav.getUint32(40, true) / 2 / this.wav.getUint32(24, true); }  // the data bytes and the sample rate of the WAV header
    get currentTime() { return this.startedAt == null ? 0 : Math.min(this.duration, ((clock.now - this.startedAt) / 1000) * this.playbackRate); }
    play() {
      if (refusePlay) return Promise.reject(Object.assign(new Error('play() was refused'), { name: 'NotAllowedError' }));
      this.paused = false; this.startedAt = clock.now;
      this.timer = setTimeout(() => { this.paused = true; this.onended?.(); }, (this.duration / this.playbackRate) * 1000);
      return Promise.resolve();
    }
    pause() { this.paused = true; clearTimeout(this.timer); }
    removeAttribute() { this.address = ''; }
    load() {}
  }
  const said = [];
  const speechSynthesis = {
    speaking: false, paused: false, getVoices: () => [{ voiceURI: 'mac', name: 'Samantha', lang: 'en-US', localService: true }],
    speak(u) { said.push(u); }, cancel() {}, pause() {}, resume() {}, addEventListener() {}, removeEventListener() {},
  };
  class SpeechSynthesisUtterance { constructor(text) { this.text = text; } }
  const context = vm.createContext({
    window: { speechSynthesis, AudioContext }, document: { hidden: false }, console, URL: element ? FakeURL : URL, AbortController, Promise, Error, TypeError,
    ...(element ? { Audio, Blob } : {}),
    Set, Map, Math, Number, fetch, AudioContext, OfflineAudioContext, SpeechSynthesisUtterance, location,
    setTimeout, clearTimeout, setInterval: () => ({}), clearInterval() {},
    requestAnimationFrame: (fn) => { const f = { fn }; frames.push(f); return f; }, cancelAnimationFrame: (f) => { if (f) f.fn = null; },
  });
  const source = readFileSync(TTS_JS, 'utf8').replace(/^export /gm, '').replace(/import\.meta\.url/g, "'file:///tts.js'");
  const api = vm.runInContext(source + '\n;({ ServerEngine, SoundMemory, SPEED_METHODS, SPEED_METHOD_DEFAULT, speedPlan, serverBase, heardSpeed })',
    context, { filename: TTS_JS });
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
  return { ...api, clock, server, sounds, said, advance, elements, freed };
}

const line = (i) => ({ text: `Made line number ${i} for the test.`, charOwners: [] });
const speakReq = (t) => t.server.requests.filter((r) => r.path === '/speak');

async function ready(t, method, rate) {
  const engine = new t.ServerEngine();
  await engine.init();
  engine.setSpeed(method, rate);
  return engine;
}

// ---------------------------------------------------------------- part 1: the origin of the voice server

test('part 1: the reader served by the voice server asks its own origin; other pages ask the fixed address', () => {
  const t = loadTts();
  const at = (href) => t.serverBase(new URL(href));
  assert.equal(at('http://localhost:8793/reader/index.html?lib=abc'), 'http://localhost:8793');
  assert.equal(at('http://127.0.0.1:8793/reader/index.html'), 'http://127.0.0.1:8793');
  assert.equal(at('http://[::1]:8793/reader/index.html'), 'http://[::1]:8793');
  assert.equal(at('chrome-extension://abcdefghijklmnop/pdf/index.html'), 'http://127.0.0.1:8793');
  assert.equal(at('http://localhost:9000/reader/index.html'), 'http://127.0.0.1:8793', 'another port is not the voice server');
  assert.equal(at('https://example.org/x.pdf'), 'http://127.0.0.1:8793');
  assert.equal(at('file:///Users/x/a.html'), 'http://127.0.0.1:8793');
  assert.equal(t.serverBase(undefined), 'http://127.0.0.1:8793');
});

test('part 1: opened from http://localhost:8793 the engine asks localhost for the voices and the sound', async () => {
  const t = loadTts({ location: new URL('http://localhost:8793/reader/index.html') });
  assert.equal(t.ServerEngine.SERVER, 'http://localhost:8793');
  const engine = await ready(t, 'A', 1);
  engine.speak(line(1), { voiceId: 'af_heart', rate: 1 });
  await t.advance(50);
  assert.ok(t.server.requests.length >= 2);
  assert.deepEqual([...new Set(t.server.requests.map((r) => r.origin))], ['http://localhost:8793'], 'no request to another origin');
  const fromAddon = loadTts({ location: new URL('chrome-extension://abcdefghijklmnop/pdf/index.html') });
  assert.equal(fromAddon.ServerEngine.SERVER, 'http://127.0.0.1:8793');
});

// ---------------------------------------------------------------- the setting

test('the setting has three choices with plain labels, and B (as before) is the default', () => {
  const t = loadTts();
  assert.deepEqual(JSON.parse(JSON.stringify(t.SPEED_METHODS.map((m) => [m.id, m.label]))),
    [['A', 'Voice speaks faster'], ['C', 'Stretch, same pitch'], ['B', 'Simple, as before']]);
  assert.equal(t.SPEED_METHOD_DEFAULT, 'B');
  assert.equal(new t.ServerEngine().method, 'B');
});

test('the reader settings panel and the add-on popup show the same three choices, A first and chosen', () => {
  const t = loadTts();
  const want = JSON.parse(JSON.stringify(t.SPEED_METHODS.map((m) => [m.id, m.label])));
  for (const [file, id] of [['pdf/index.html', 'methodSel'], ['popup.html', 'method']]) {
    const html = readFileSync(EXT + file, 'utf8');
    const sel = html.match(new RegExp(`<select id="${id}"[^>]*>([\\s\\S]*?)</select>`));
    assert.ok(sel, `${file} has <select id="${id}">`);
    const opts = [...sel[1].matchAll(/<option value="(\w)"[^>]*>([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(opts, want, file);
    assert.match(html, new RegExp(`<label class="(field|f)"><span>Speed method</span>\\s*<select id="${id}"|<label class="f">Speed method <select id="${id}"`), `${file}: one labelled control`);
  }
  const panel = readFileSync(EXT + 'pdf/index.html', 'utf8').match(/id="settingsPanel"[\s\S]*?<\/section>/)[0];
  assert.match(panel, /id="methodSel"/, 'the control is in the Voice group of the settings panel');
});

test('the speed plan of each method: what the server makes, and the playback rate', () => {
  const t = loadTts();
  const plan = (m, r, ms) => JSON.parse(JSON.stringify(t.speedPlan(m, r, ms)));
  assert.deepEqual(plan('A', 2), { speed: 2, method: 'A', rate: 1 });
  assert.deepEqual(plan('C', 1.5), { speed: 1.5, method: 'C', rate: 1 });
  assert.deepEqual(plan('B', 2), { speed: 1, method: '', rate: 2 });
  for (const m of ['A', 'B', 'C']) assert.deepEqual(plan(m, 1), { speed: 1, method: '', rate: 1 }, `speed 1 is one sound (${m})`);
  assert.deepEqual(plan('C', 2, ['A', 'B']), { speed: 2, method: 'A', rate: 1 }, 'no ffmpeg on the server: C is not offered, A plays');
  assert.deepEqual(plan('A', 2, ['B']), { speed: 1, method: '', rate: 2 }, 'an old voice server without speed: B, so the speed still changes');
  assert.deepEqual(plan('X', 2), plan('B', 2), 'an unknown stored value is the default');
  assert.deepEqual(plan('A', 1.25), { speed: 1.25, method: 'A', rate: 1 });
});

// ---------------------------------------------------------------- the reader engine

test('method A: the server is asked for the speed, the sound plays at rate 1, and the key has the speed', async () => {
  const t = loadTts();
  const engine = await ready(t, 'A', 2);
  engine.speak(line(1), { voiceId: 'af_heart', rate: 2 });
  await t.advance(20);
  const req = speakReq(t)[0];
  assert.equal(req.speed, '2');
  assert.equal(req.method, 'A');
  assert.equal(t.server.requests.find((r) => r.path === '/times').speed, '2', 'the Word timing of the same sound');
  assert.equal(t.sounds[0].playbackRate.value, 1, 'played at rate 1: the pitch stays');
  assert.deepEqual([...engine.cache.keys()], ['af_heart\u0000' + line(1).text + '\u0000A2']);
});

// Without a sound element (an old browser, and these fakes), B plays in the audio context: faster, and the pitch goes up.
// With a sound element the pitch stays: see "the pitch stays in the reader" at the end of this file.
test('method B: the speed-1 sound, played faster (as before)', async () => {
  const t = loadTts();
  const engine = await ready(t, 'B', 2);
  engine.speak(line(1), { voiceId: 'af_heart', rate: 2 });
  await t.advance(20);
  assert.equal(speakReq(t)[0].speed, null, 'no speed asked');
  assert.equal(t.sounds[0].playbackRate.value, 2);
  assert.deepEqual([...engine.cache.keys()], ['af_heart\u0000' + line(1).text]);
});

test('method C: the server stretches; without ffmpeg on the server the reader plays A', async () => {
  let t = loadTts();
  let engine = await ready(t, 'C', 1.5);
  engine.speak(line(1), { voiceId: 'af_heart', rate: 1.5 });
  await t.advance(20);
  assert.deepEqual([speakReq(t)[0].speed, speakReq(t)[0].method], ['1.5', 'C']);
  assert.equal(t.sounds[0].playbackRate.value, 1);
  t = loadTts({ methods: ['A', 'B'] });
  engine = await ready(t, 'C', 1.5);
  assert.deepEqual(JSON.parse(JSON.stringify(engine.methods)), ['A', 'B']);
  engine.speak(line(1), { voiceId: 'af_heart', rate: 1.5 });
  await t.advance(20);
  assert.deepEqual([speakReq(t)[0].speed, speakReq(t)[0].method], ['1.5', 'A']);
});

test('speed 1 is one sound for all methods: a change of method at speed 1 makes nothing new', async () => {
  const t = loadTts();
  const engine = await ready(t, 'A', 1);
  for (const m of ['A', 'C', 'B']) {
    engine.setSpeed(m, 1);
    engine.speak(line(1), { voiceId: 'af_heart', rate: 1 });
    await t.advance(1100);
  }
  assert.equal(speakReq(t).length, 1);
  assert.equal(engine.cache.size, 1);
});

test('Word highlight: at the words of the sound for A and C (server timing), and divided by the rate for B', async () => {
  for (const [method, at] of [['A', [0, 400, 800]], ['C', [0, 400, 800]], ['B', [0, 200, 400]]]) {
    const t = loadTts();
    t.server.seconds = 2;
    t.server.starts = [0, 0.4, 0.8];  // the server gives the times of the sound that it sends
    const engine = await ready(t, method, 2);
    const s = { text: 'One two three.', charOwners: [] };
    const words = [];
    const begin = t.clock.now;
    engine.speak(s, { voiceId: 'af_heart', rate: 2, onWord: (start) => words.push([start, t.clock.now]) });
    await t.advance(1500);
    const first = words[0][1];
    assert.deepEqual(words.map(([c]) => c), [0, 4, 8], method);
    words.forEach(([, when], k) => assert.ok(Math.abs(when - first - at[k]) <= 20, `${method}: word ${k} at ${when - first} ms, wanted ${at[k]}`));
    assert.ok(first - begin < 50);
  }
});

test('a speed change while reading: the Sentence is asked again at the new speed, the Read-ahead too, and the memory stays under its limit', async () => {
  const t = loadTts();
  const engine = await ready(t, 'A', 1);
  engine.cache = new t.SoundMemory(5 * 4000);  // room for about 5 seconds of sound
  const list = Array.from({ length: 30 }, (_, i) => line(i));
  const read = (i, rate) => {
    engine.speak(list[i], { voiceId: 'af_heart', rate });
    engine.prefetch(list[i + 1], 'af_heart');
    engine.prefetch(list[i + 2], 'af_heart');
  };
  let i = 0;
  for (const rate of [1, 1.5, 2, 3, 1.25, 2.5, 1, 3, 2, 1.5]) {
    engine.setSpeed('A', rate);  // app.js: the speed changes, stop(), play() from the present word
    read(i, rate);
    await t.advance(30);
    const asked = speakReq(t).slice(-3);
    for (const r of asked) assert.equal(r.speed, rate === 1 ? null : String(rate), `the Sentence and the Read-ahead at ${rate}`);
    assert.ok(engine.cache.bytes <= engine.cache.limit, `memory ${engine.cache.bytes} over its limit at ${rate}`);
    await t.advance(3000);
    i++;
  }
  assert.ok(engine.cache.bytes <= engine.cache.limit);
});

test('the Mac voice (the voice server is down) reads at the asked rate, as before', async () => {
  const t = loadTts();
  const engine = await ready(t, 'A', 2);
  t.server.mode = 'down';
  engine.speak(line(1), { voiceId: 'af_heart', rate: 2 });
  await t.advance(50);
  assert.equal(t.said.length, 1);
  assert.equal(t.said[0].rate, 2);
});

test('time left: method A counts the speed that the model really reaches; B and C the asked speed', () => {
  const t = loadTts();
  assert.equal(t.heardSpeed('A', 1), 1);
  assert.ok(Math.abs(t.heardSpeed('A', 2) - 1.84) < 0.02, String(t.heardSpeed('A', 2)));
  assert.ok(Math.abs(t.heardSpeed('A', 3) - 2.18) < 0.02, String(t.heardSpeed('A', 3)));
  assert.ok(t.heardSpeed('A', 4) > t.heardSpeed('A', 3));
  assert.equal(t.heardSpeed('A', 0.75), 0.75);
  assert.equal(t.heardSpeed('B', 3), 3);
  assert.equal(t.heardSpeed('C', 3), 3);
});

// ---------------------------------------------------------------- the web-page player

const event = () => { const fns = []; return { fns, addListener: (f) => fns.push(f) }; };
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

function loadBackground({ ra2 = {}, methods = ['A', 'B', 'C'], voicesFail = false, slowOffscreen = 0 } = {}) {
  const toOffscreen = [], toTabs = [], voiceAsks = [];
  let open = !slowOffscreen;
  const chrome = {
    runtime: { id: 'x', getURL: (p) => 'chrome-extension://x/' + p, getManifest: () => ({ version: '1' }),
      getContexts: async () => (open ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []),
      sendMessage: (m) => { if (m.to === 'offscreen') toOffscreen.push(m); return Promise.resolve(true); },
      reload() {}, onMessage: event(), onConnect: event(), onInstalled: event() },
    offscreen: { createDocument: () => new Promise((r) => setTimeout(() => { open = true; r(); }, slowOffscreen)) },
    tabs: { sendMessage: (t, m) => { toTabs.push([t, m]); return Promise.resolve(); }, update() {}, create() {}, query: async () => [], onUpdated: event() },
    tts: { speak() {}, stop() {}, getVoices: async () => [] },
    storage: { sync: { get: async () => ({ ra2 }) }, session: { set: async () => {} } },
    webRequest: { onHeadersReceived: event() }, alarms: { create() {}, onAlarm: event() },
    contextMenus: { create() {}, onClicked: event() }, commands: { onCommand: event() },
  };
  const fetch = async (url) => {
    if (!String(url).endsWith('/voices')) throw new Error('no network');
    voiceAsks.push(url);
    if (voicesFail) throw new TypeError('Failed to fetch');
    return { json: async () => ({ voices: [], ...(methods ? { speed: { min: 0.5, max: 4, methods } } : {}) }) };
  };
  const ctx = vm.createContext({ chrome, console, setTimeout, clearTimeout, AbortSignal, AbortController, URL, fetch, Date, Math });
  vm.runInContext(readFileSync(EXT + 'background.js', 'utf8'), ctx, { filename: 'background.js' });
  const send = (m, tab = 4) => chrome.runtime.onMessage.fns[0]({ to: 'bg', ...m }, { tab: { id: tab }, url: 'https://example.org/' }, () => {});
  return { send, toOffscreen, toTabs, ra2, voiceAsks };
}

test('web player: the background reads the one shared setting (chrome.storage.sync ra2.method) and tells the sound page the plan', async () => {
  for (const [ra2, methods, want] of [
    [{}, undefined, { speed: 1, method: '', rate: 2, keepPitch: true }],                  // default B, as before ticket 06
    [{ method: 'A' }, undefined, { speed: 2, method: 'A', rate: 1, keepPitch: true }],
    [{ method: 'C' }, undefined, { speed: 2, method: 'C', rate: 1, keepPitch: true }],
    [{ method: 'B' }, undefined, { speed: 1, method: '', rate: 2, keepPitch: true }],      // the browser keeps the pitch, as before
    [{ method: 'C' }, ['A', 'B'], { speed: 2, method: 'A', rate: 1, keepPitch: true }],    // no ffmpeg: A, as in the reader (review 3)
    [{ method: 'A' }, null, { speed: 1, method: '', rate: 2, keepPitch: true }],          // an old voice server: B, as in the reader
  ]) {
    const b = loadBackground({ ra2, methods });
    b.send({ cmd: 'speak', engine: 'kokoro', id: 1, text: 'A.', voice: 'af', rate: 2, next: ['B.'] });
    await settle();
    const m = b.toOffscreen.find((x) => x.cmd === 'speak');
    assert.ok(m, JSON.stringify(ra2));
    assert.deepEqual({ speed: m.speed, method: m.method, rate: m.rate, keepPitch: m.keepPitch }, want, JSON.stringify([ra2, methods]));
  }
});

test('web player: a speed change while reading. B changes the rate of the sound; A says the Sentence again from the present word', async () => {
  let b = loadBackground({ ra2: { method: 'B' } });
  b.send({ cmd: 'speak', engine: 'kokoro', id: 5, text: 'A.', voice: 'af', rate: 1.5 });
  await settle();
  b.send({ cmd: 'rate', rate: 2 });
  await settle();
  assert.deepEqual(b.toOffscreen.filter((m) => m.cmd === 'rate').map((m) => [m.rate, m.keepPitch]), [[2, true]]);
  assert.deepEqual(b.toTabs.filter(([, m]) => m.evt === 'lost'), []);

  b = loadBackground({ ra2: { method: 'A' } });
  b.send({ cmd: 'speak', engine: 'kokoro', id: 5, text: 'A.', voice: 'af', rate: 1.5 });
  await settle();
  b.send({ cmd: 'rate', rate: 2 });
  await settle();
  assert.deepEqual(b.toOffscreen.filter((m) => m.cmd === 'rate'), [], 'the sound of speed 1.5 cannot become speed 2');
  assert.deepEqual(b.toTabs.filter(([, m]) => m.evt === 'lost').map(([t, m]) => [t, m.id]), [[4, 5]],
    'the page says the Sentence again from the present word (content.js: "lost"), now at speed 2');
});

test('web player: Read-ahead of the screen (warm) is made at the speed and method of the setting', async () => {
  const b = loadBackground({ ra2: { method: 'A', rate: 1.5 } });
  b.send({ cmd: 'warm', texts: ['X.'], voice: 'af', prio: 1, batch: 1 });
  await settle();
  const m = b.toOffscreen.find((x) => x.cmd === 'warm');
  assert.deepEqual([m.speed, m.method], [1.5, 'A']);
  // review 6: the tab sends its present speed with the warm; it counts before the stored one
  b.send({ cmd: 'warm', texts: ['Y.'], voice: 'af', prio: 1, batch: 2, rate: 2.5 });
  await settle();
  const n = b.toOffscreen.filter((x) => x.cmd === 'warm')[1];
  assert.deepEqual([n.speed, n.method], [2.5, 'A']);
});

test('review 2: a /voices call that failed is kept for 60 s, not asked again for each Sentence', async () => {
  const b = loadBackground({ ra2: { method: 'A' }, voicesFail: true });
  for (let id = 1; id <= 4; id++) {
    b.send({ cmd: 'speak', engine: 'kokoro', id, text: 'A.', voice: 'af', rate: 2 });
    await settle();
  }
  assert.equal(b.voiceAsks.length, 1);
  const m = b.toOffscreen.filter((x) => x.cmd === 'speak').pop();
  assert.deepEqual([m.speed, m.method, m.rate], [1, '', 2], 'no answer: B, as for an old voice server');
});

test('review 7: a newer Sentence that came while the sound page opened is the only one sent', async () => {
  const b = loadBackground({ ra2: { method: 'A' }, slowOffscreen: 30 });
  b.send({ cmd: 'speak', engine: 'kokoro', id: 1, text: 'First.', voice: 'af', rate: 2 });
  await settle(3);
  b.send({ cmd: 'speak', engine: 'kokoro', id: 2, text: 'Second.', voice: 'af', rate: 2 });
  await new Promise((r) => setTimeout(r, 80));
  await settle();
  assert.deepEqual(b.toOffscreen.filter((x) => x.cmd === 'speak').map((x) => x.id), [2]);
});

function loadOffscreen({ hold = false } = {}) {
  const onMessage = event(), made = [], fetched = [], waiting = [];
  class FakeAudio { constructor() { this.currentTime = 0; this.duration = 1; made.push(this); } play() { return Promise.resolve(); } pause() {} removeAttribute() {} load() {} }
  const ctx = vm.createContext({
    chrome: { runtime: { onMessage, sendMessage: () => Promise.resolve() } },
    Audio: FakeAudio, fetch: (u) => { fetched.push(String(u));
      const answer = { json: async () => ({ starts: [] }) };
      return hold && /ahead=/.test(String(u)) ? new Promise((r) => waiting.push(() => r(answer))) : Promise.resolve(answer); },
    setInterval, clearInterval, setTimeout, clearTimeout, AbortSignal, console,
  });
  vm.runInContext(readFileSync(EXT + 'offscreen.js', 'utf8'), ctx, { filename: 'offscreen.js' });
  const fire = (m) => onMessage.fns[0]({ to: 'offscreen', tab: 1, id: 1, voice: 'af', next: [], ...m }, {}, () => {});
  return { fire, made, fetched, answer: () => waiting.splice(0).forEach((f) => f()) };
}

test('review 5: queued Read-ahead of an old speed or method is dropped when a new plan comes', async () => {
  const o = loadOffscreen({ hold: true });
  o.fire({ cmd: 'warm', texts: ['X1.', 'X2.', 'X3.', 'X4.'], prio: 3, speed: 2, method: 'A' });
  assert.equal(o.fetched.length, 2, 'two at a time');
  o.fire({ cmd: 'warm', texts: ['Y1.'], prio: 3, speed: 1.5, method: 'A' });
  o.answer();
  await settle();
  o.answer();
  await settle();
  const asked = o.fetched.map((u) => new URL(u).searchParams.get('text'));
  assert.equal(asked.length, 3, 'the two that were asked, then only Y1: ' + asked.join(' '));
  assert.ok(asked.slice(0, 2).every((t) => t.startsWith('X')));
  assert.equal(asked[2], 'Y1.', 'nothing of speed 2 is asked after the change');
});

test('sound page: the sound, its Word timing and its Read-ahead are asked at the same speed and method', async () => {
  const o = loadOffscreen();
  o.fire({ cmd: 'speak', text: 'Now.', rate: 1, speed: 2, method: 'A', keepPitch: true, next: ['Next.'] });
  const a = o.made[0];
  assert.match(a.src, /\/speak\?.*text=Now\..*&speed=2&method=A/);
  assert.equal(a.playbackRate, 1);
  a.onloadeddata();
  await settle();
  assert.ok(o.fetched.some((u) => /\/times\?.*text=Now\..*&speed=2&method=A/.test(u)), 'the Word timing of the same sound');
  assert.ok(o.fetched.some((u) => /\/speak\?.*text=Next\..*&speed=2&method=A.*&ahead=3/.test(u)), 'the Read-ahead of the same speed');
  o.fire({ cmd: 'stop' });
});

test('sound page: B plays the speed-1 sound faster with the pitch up; speed 1 asks no speed', async () => {
  const o = loadOffscreen();
  o.fire({ cmd: 'speak', text: 'Now.', rate: 2, speed: 1, method: '', keepPitch: false });
  const a = o.made[0];
  assert.doesNotMatch(a.src, /speed=/);
  assert.equal(a.playbackRate, 2);
  assert.equal(a.preservesPitch, false);
  o.fire({ cmd: 'rate', rate: 1.5, keepPitch: false });
  assert.equal(a.playbackRate, 1.5);
  o.fire({ cmd: 'stop' });
});

test('the speed plan of the add-on background gives the same sound as the reader for each method and speed', async () => {
  const t = loadTts();
  for (const methods of [['A', 'B', 'C'], ['A', 'B'], ['B']]) for (const method of ['A', 'B', 'C']) {
    for (const rate of [0.75, 1, 1.5, 2, 3]) {
      const b = loadBackground({ ra2: { method }, methods });
      b.send({ cmd: 'speak', engine: 'kokoro', id: 1, text: 'A.', voice: 'af', rate });
      await settle();
      const m = b.toOffscreen.find((x) => x.cmd === 'speak');
      const p = t.speedPlan(method, rate, methods);
      assert.deepEqual([m.speed, m.method, m.rate], [p.speed, p.method, p.rate], `${method} ${rate} ${methods}`);
      assert.equal(m.keepPitch, true, 'the web player keeps the pitch at each speed, as before ticket 06');
    }
  }
});

// ---- review 4: the voice server lost ffmpeg after the reader read /voices: a 400 for C makes the reader ask /voices
// again and play A, without the Mac voice and without an error.
test('review 4: a 400 to a request with speed reads /voices again and plays the Sentence with the new plan', async () => {
  const t = loadTts();
  const engine = await ready(t, 'C', 2);
  t.server.methods = ['A', 'B'];
  const realFetch = t.server;
  realFetch.refuseC = true;
  const errors = [], ended = [];
  engine.speak(line(1), { voiceId: 'af_heart', rate: 2, onError: (e) => errors.push(e), onEnd: () => ended.push(1) });
  await t.advance(3000);
  const asked = speakReq(t).map((r) => r.method);
  assert.deepEqual(asked, ['C', 'A']);
  assert.equal(t.server.requests.filter((r) => r.path === '/voices').length, 2, '/voices asked again');
  assert.deepEqual(errors, []);
  assert.equal(t.said.length, 0, 'no Mac voice');
  assert.equal(ended.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(engine.methods)), ['A', 'B']);
});

// ---- review 14: no Word timing from the server (Italian): the estimate uses the length of the real sound of A
test('review 14: without word times, A spreads the words over the real sound, not over the asked speed', async () => {
  const t = loadTts();
  t.server.seconds = 3;
  t.server.aSlow = 1.2;  // asked 2x: 1.5 s; the model gives 1.8 s (as the prototype found: A reaches less than asked)
  const engine = await ready(t, 'A', 2);
  const words = [];
  engine.speak({ text: 'One two three four.', charOwners: [] }, { voiceId: 'af_heart', rate: 2, onWord: (c) => words.push([c, t.clock.now]) });
  await t.advance(2000);
  const last = words[words.length - 1][1] - words[0][1];
  // weights 3.6, 3.6, 3.6, 8.6: the last word starts at 10.8 / 19.4 of the sound: 1.0 s of 1.8 s (0.84 s of 1.5 s if it used the asked speed)
  assert.ok(Math.abs(last - 1002) <= 30, `the last word at ${last} ms; the real sound is 1.8 s`);
  assert.equal(t.sounds[0].playbackRate.value, 1);
});

// ---- review 13: the web-page player counts the time left with the speed that A really reaches
test('review 13: content.js has the same heard-speed curve as the reader and uses it for the time left', () => {
  const t = loadTts();
  const src = readFileSync(EXT + 'content.js', 'utf8');
  const fn = src.match(/function heardSpeed\(method, rate\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fn, 'content.js has heardSpeed(method, rate)');
  const heard = vm.runInNewContext(`(${fn[0].replace(/^function heardSpeed/, 'function')})`, { Math });
  for (const m of ['A', 'B', 'C']) for (const r of [0.8, 1, 1.2, 1.5, 2, 2.5, 3, 3.5, 4]) {
    assert.ok(Math.abs(heard(m, r) - t.heardSpeed(m, r)) < 1e-9, `${m} ${r}`);
  }
  assert.match(src, /function timeLeft\(at\)[\s\S]{0,300}heardSpeed\(cfg\.method \|\| 'B', cfg\.rate\)/);
});

// ---- review 8: the popup writes only the method: a newer rate or voice of another tab is not written over
test('review 8: the popup reads the stored setting fresh and writes only the method key', async () => {
  let stored = { rate: 1.2, voice: 'kokoro:af_heart', method: 'A' };
  const writes = [];
  const els = {};
  const el = (id) => (els[id] ||= { id, value: '', checked: false, hidden: false, textContent: '', innerHTML: '', append() {},
    querySelector: () => ({ disabled: false }), set onchange(f) { this._change = f; }, get onchange() { return this._change; } });
  const chrome = {
    tabs: { query: async () => [{ id: 1, url: 'https://example.org/' }], sendMessage: async () => {}, create() {} },
    storage: { sync: { get: async () => ({ ra2: { ...stored } }), set: async (o) => { writes.push(o); stored = o.ra2; } } },
    runtime: { sendMessage: async () => ({ natural: [], system: [], server: true, methods: ['A', 'B', 'C'] }), getManifest: () => ({ version: '1' }) },
  };
  const document = { getElementById: el, createElement: () => ({ append() {} }) };
  vm.runInNewContext(readFileSync(EXT + 'popup.js', 'utf8'), { chrome, document, Option: class {}, URL, window: {}, Number, console });
  await settle();
  stored = { ...stored, rate: 2.5, voice: 'kokoro:bf_emma' };  // another tab changed the speed and the voice
  el('method').value = 'B';
  el('method').onchange();
  await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(stored)), { rate: 2.5, voice: 'kokoro:bf_emma', method: 'B' });
});

// ---- review 1: the reader shows A when C is chosen but the voice server cannot stretch, keeps the stored C, and says why
function loadReaderApp({ methods, stored = 'C' }) {
  const ids = {};
  const element = (id) => {
    const listeners = {};
    const opts = id === 'methodSel' ? { C: { disabled: false } } : {};
    return { id, value: '', textContent: '', hidden: false, disabled: false, checked: false, style: {}, dataset: {}, children: [], files: [],
      classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, getAttribute: () => null, hasAttribute: () => false, insertAdjacentHTML() {},
      appendChild(c) { this.children.push(c); return c; }, remove() {}, contains: () => false, querySelectorAll: () => [],
      querySelector: (q) => { const m = /value="(\w)"/.exec(q); return m ? opts[m[1]] || null : null; }, opts,
      matches: () => false, closest: () => null, focus() {}, scrollIntoView() {}, offsetWidth: 100,
      addEventListener(t, f) { (listeners[t] ||= []).push(f); }, fire(t) { for (const f of listeners[t] || []) f({ target: this, preventDefault() {} }); } };
  };
  const byId = (id) => (ids[id] ||= element(id));
  byId('rateSel').value = '2';
  const store = new Map([['ra2.speedMethod', stored]]);
  const kokoro = class { constructor() { this.id = 'kokoro'; this.ready = false; this.available = true; this.methods = ['B']; this.set = []; }
    async init() { this.ready = true; this.methods = methods; } listVoices() { return [{ id: 'v1', label: 'Voice' }]; }
    speak() { return Promise.resolve(); } stop() {} prefetch() {} setSpeed(m, r) { this.set.push([m, r]); } };
  const system = class { constructor() { this.id = 'system'; this.ready = true; this.available = true; } async init() {} listVoices() { return []; } speak() {} stop() {} };
  const modules = {
    pdfjsLib: { GlobalWorkerOptions: {} }, PdfViewer: class { constructor() { this.pages = new Map(); this.follow = true; } async load() {} highlight() {} highlightWord() {} clearWord() {} setZoom() {} relayout() {} },
    buildDocument: () => new Promise(() => {}), SystemEngine: system, ServerEngine: kokoro,
    loadLexicon: async () => {}, repairStats: () => ({}), withOcr: async (d) => d,
    setupNotes: () => ({ reload() {}, markdown() { return ''; }, reset() {}, markAt: () => null }),
    setupAsk: () => ({ reload() {}, highlightsChanged() {}, stopReading() {} }), newerPosition: () => null,
    ...language,  // ticket 32
  };
  const src = readFileSync(EXT + 'pdf/app.js', 'utf8').replace(/^import \* as (\w+) from [^;]+;$/gm, 'const $1 = __modules.$1;')
    .replace(/^import \{([^}]+)\} from [^;]+;$/gm, 'const {$1} = __modules;').replaceAll('import.meta.url', '"file:///reader/pdf/app.js"');
  const ctx = { __modules: modules, console: { log() {}, info() {}, warn() {}, error() {} },
    document: { getElementById: byId, createElement: () => element(), addEventListener() {}, visibilityState: 'visible' },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    location: { search: '', protocol: 'http:', href: 'http://127.0.0.1:8793/reader/index.html' }, navigator: {},
    setTimeout: (fn, ms) => (ms ? 0 : setTimeout(fn, 0)), clearTimeout() {}, setInterval: () => 0,
    URL, URLSearchParams, TextDecoder, TextEncoder, getSelection: () => '', confirm: () => false, addEventListener() {}, innerWidth: 1400 };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'app.js' });
  return { byId, store };
}

test('review 1: C chosen, the voice server has no ffmpeg: A is shown, C is disabled, a hint says why, and the stored C stays', async () => {
  const r = loadReaderApp({ methods: ['A', 'B'] });
  await settle(20);
  const sel = r.byId('methodSel');
  assert.equal(sel.value, 'A');
  assert.equal(sel.opts.C.disabled, true);
  assert.equal(r.byId('methodHint').hidden, false);
  assert.match(r.byId('methodHint').textContent || readFileSync(EXT + 'pdf/index.html', 'utf8'), /[Ss]tretch.*not available/);
  assert.equal(r.store.get('ra2.speedMethod'), 'C', 'the choice is not written over');
});

test('review 1: with ffmpeg, the stored C is shown and the hint is hidden', async () => {
  const r = loadReaderApp({ methods: ['A', 'B', 'C'] });
  await settle(20);
  assert.equal(r.byId('methodSel').value, 'C');
  assert.equal(r.byId('methodSel').opts.C.disabled, false);
  assert.equal(r.byId('methodHint').hidden, true);
});

// ---------------------------------------------------------------- 14 Nov 2026: the pitch stays in the reader
// The owner: "the readout loud is a desktop application has a different voice ... Make the desktop application use
// the same voice that is used in Google Chrome in the extension". The cause: the reader played a sound at another
// speed in the audio context, which raises the pitch with the speed (speed 1.2: 3 semitones higher). The web player
// of the add-on plays in a sound element, which keeps the pitch. Now the reader does the same.
const spoken = (t, engine, rate, sentence = line(1)) => {
  const got = { words: [], ended: false, errors: [] };
  engine.speak(sentence, { voiceId: 'af_heart', rate, onWord: (start) => got.words.push([t.clock.now, start]), onEnd: () => { got.ended = true; }, onError: (e) => got.errors.push(e) });
  return got;
};

test('the pitch stays: method B at speed 1.5 plays in a sound element that keeps the pitch, and not in the audio context', async () => {
  const t = loadTts({ element: true });
  const engine = await ready(t, 'B', 1.5);
  const got = spoken(t, engine, 1.5);
  await t.advance(100);
  assert.equal(speakReq(t)[0].speed, null, 'the voice server gives the speed-1 sound');
  assert.equal(t.sounds.length, 0, 'no source of the audio context: it would raise the pitch');
  assert.equal(t.elements.length, 1);
  assert.equal(t.elements[0].playbackRate, 1.5);
  assert.equal(t.elements[0].preservesPitch, true);
  assert.equal(t.elements[0].wav.getUint32(24, true), RATE, 'the WAV file has the sample rate of the sound');
  assert.equal(t.elements[0].duration, 1, 'and all of its samples');
  assert.equal(got.ended, false);
  await t.advance(700);  // 1 s of sound at speed 1.5 is about 0.67 s
  assert.equal(got.ended, true);
  assert.deepEqual(got.errors, []);
});

test('the pitch stays: speed 1, and the methods A and C, play in the audio context as before', async () => {
  for (const [method, rate] of [['B', 1], ['A', 1.5], ['C', 1.5]]) {
    const t = loadTts({ element: true });
    const engine = await ready(t, method, rate);
    spoken(t, engine, rate);
    await t.advance(100);
    assert.equal(t.elements.length, 0, `${method} at ${rate}: no sound element`);
    assert.equal(t.sounds.length, 1);
    assert.equal(t.sounds[0].playbackRate.value, 1);
  }
});

test('the pitch stays: the words follow the clock of the sound element', async () => {
  const t = loadTts({ element: true });
  t.server.seconds = 2;
  t.server.starts = [0, 0.4, 0.8, 1.0, 1.2, 1.4, 1.6];  // "Made line number 1 for the test.": 7 words
  const engine = await ready(t, 'B', 2);
  const got = spoken(t, engine, 2);
  await t.advance(1100);  // 2 s of sound at speed 2
  assert.equal(got.ended, true);
  assert.equal(got.words.length, 7);
  const at = got.words.map(([ms]) => ms - got.words[0][0]);
  assert.ok(Math.abs(at[1] - 200) <= 40, 'the word at 0.4 s of the sound comes after about 0.2 s: ' + at[1]);
  assert.ok(Math.abs(at[6] - 800) <= 40, 'the word at 1.6 s comes after about 0.8 s: ' + at[6]);
});

test('the pitch stays: stop silences the sound element and frees its file; the next Sentence gets a new element', async () => {
  const t = loadTts({ element: true });
  const engine = await ready(t, 'B', 1.5);
  const got = spoken(t, engine, 1.5);
  await t.advance(100);
  engine.stop();
  await t.advance(900);
  assert.equal(t.elements[0].paused, true);
  assert.equal(got.ended, false, 'a stopped Sentence does not end');
  assert.equal(t.freed.length, 1, 'the file of the sound is freed');
  const next = spoken(t, engine, 1.5, line(2));
  await t.advance(800);
  assert.equal(t.elements.length, 2);
  assert.equal(next.ended, true);
  assert.equal(t.freed.length, 2);
});

test('the pitch stays: when the browser refuses the sound element, the Sentence still sounds (as before, in the audio context)', async () => {
  const t = loadTts({ element: true, refusePlay: true });
  const engine = await ready(t, 'B', 1.5);
  const got = spoken(t, engine, 1.5);
  await t.advance(800);
  assert.equal(t.sounds.length, 1, 'never silence');
  assert.equal(t.sounds[0].playbackRate.value, 1.5);
  assert.equal(got.ended, true);
  assert.deepEqual(got.errors, []);
});
