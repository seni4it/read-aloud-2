// Tests for the sound memory of the reader (extension/pdf/tts.js, SoundMemory and its use in ServerEngine): the
// reader keeps the sound of Sentences up to a limit in bytes, and the least recently used Sentence goes out first.
// The Sentence that plays now and the Read-ahead Sentences never go out, so no silence comes between Sentences.
// One Sentence larger than the limit still plays. A Sentence that went out is made again when it is asked again.
// tts.js runs as it is in a node:vm context ("export" taken out), with fakes for fetch (the voice server) and the
// sound. No voice server is asked. Run: node --test --test-timeout=120000 tests/node/sound-memory.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const TTS_JS = fileURLToPath(new URL('../../extension/pdf/tts.js', import.meta.url));
const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

// The fake decode gives 1000 samples a second, Float32: 4000 bytes for each second of sound.
const RATE = 1000;
const BYTES_A_SECOND = RATE * 4;

function loadTts() {
  // The voice server: each /speak answers at once with `seconds[text]` seconds of sound (1 s when not named).
  const server = { seconds: {}, made: [] };
  const fetch = async (url) => {
    const u = new URL(url);
    const text = u.searchParams.get('text');
    if (u.pathname === '/speak') server.made.push(text);
    return {
      ok: true, status: 200,
      arrayBuffer: async () => ({ seconds: server.seconds[text] ?? 1 }),
      json: async () => (u.pathname === '/voices' ? { voices: [] } : { starts: null }),
    };
  };
  class OfflineAudioContext {
    async decodeAudioData(buf) {
      const data = new Float32Array(Math.round(buf.seconds * RATE)).fill(0.5);
      return { sampleRate: RATE, getChannelData: () => data };
    }
  }
  // The sound: a source ends as soon as the test lets the timers run.
  class AudioContext {
    constructor() { this.state = 'running'; this.outputLatency = 0; this.baseLatency = 0; this.destination = {}; }
    get currentTime() { return 0; }
    resume() {}
    createBuffer(_ch, length, sampleRate) {
      const data = new Float32Array(length);
      return { length, sampleRate, duration: length / sampleRate, getChannelData: () => data, copyToChannel(a) { data.set(a); } };
    }
    createBufferSource() {
      const src = { buffer: null, playbackRate: { value: 1 }, onended: null, connect() {}, start() { setTimeout(() => src.onended?.(), 0); }, stop() {} };
      return src;
    }
  }
  const context = vm.createContext({
    window: { AudioContext, speechSynthesis: null }, document: { hidden: false }, console, URL, AbortController,
    Promise, Error, TypeError, Set, Map, fetch, AudioContext, OfflineAudioContext,
    setTimeout, clearTimeout, setInterval: () => ({}), clearInterval() {},
    requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: (t) => clearTimeout(t),
  });
  const source = readFileSync(TTS_JS, 'utf8').replace(/^export /gm, '').replace(/import\.meta\.url/g, "'file:///tts.js'");
  const api = vm.runInContext(source + '\n;({ ServerEngine, SoundMemory, SOUND_MEMORY_MB })', context, { filename: TTS_JS });
  return { ...api, server };
}

// A made sound of `seconds` seconds, as the reader keeps it.
const sound = (seconds) => ({ audio: new Float32Array(seconds * RATE), sampleRate: RATE, starts: null });
// Made lines with fewer than 12 words, so one Sentence is one request. No book text.
const line = (i) => ({ text: `Made line number ${i} for the test.`, charOwners: [] });
const key = (s) => 'af_heart\u0000' + s.text;

// The reader's own calls when it starts a Sentence (app.js speakCurrent): speak it, then Read-ahead of the next two.
function readFrom(engine, list, i) {
  const ended = new Promise((onEnd) => engine.speak(list[i], { voiceId: 'af_heart', rate: 1, onEnd, onError: onEnd }));
  engine.prefetch(list[i + 1], 'af_heart');
  engine.prefetch(list[i + 2], 'af_heart');
  return ended;
}

test('the limit of the reader is about 64 MB, and a new engine uses it', () => {
  const t = loadTts();
  assert.equal(t.SOUND_MEMORY_MB, 64);
  const engine = new t.ServerEngine();
  assert.equal(engine.cache.limit, 64 * 1024 * 1024);
});

test('the byte count is the real size of the kept samples (4 bytes a sample), also after a Sentence goes out or is kept again', () => {
  const t = loadTts();
  const m = new t.SoundMemory(1e9);
  m.set('a', sound(2));
  m.set('b', sound(3));
  assert.equal(m.bytes, 5 * BYTES_A_SECOND);
  m.set('a', sound(1));  // the same Sentence kept again: the old sound is not counted twice
  assert.equal(m.bytes, 4 * BYTES_A_SECOND);
  m.delete('b');
  assert.equal(m.bytes, 1 * BYTES_A_SECOND);
  assert.equal(m.size, 1);
});

test('over the limit, the least recently used Sentence goes out first; a Sentence that is read again counts as used', () => {
  const t = loadTts();
  const m = new t.SoundMemory(3 * BYTES_A_SECOND);
  m.set('a', sound(1));
  m.set('b', sound(1));
  m.set('c', sound(1));
  m.get('a');            // a is used again: b is now the oldest
  m.set('d', sound(1));
  assert.deepEqual([...m.keys()], ['c', 'a', 'd']);
  assert.ok(m.bytes <= m.limit);
  m.set('e', sound(2));  // two must go: c, then a
  assert.deepEqual([...m.keys()], ['d', 'e']);
  assert.equal(m.bytes, 3 * BYTES_A_SECOND);
});

test('the Sentence that plays now and the Read-ahead Sentences never go out, even when they are the oldest', () => {
  const t = loadTts();
  const m = new t.SoundMemory(3 * BYTES_A_SECOND);
  m.set('now', sound(1));
  m.set('next', sound(1));
  m.set('after', sound(1));
  m.need(['now']);
  m.alsoNeed(['next']);
  m.alsoNeed(['after']);
  m.set('old', sound(1));
  assert.deepEqual([...m.keys()], ['now', 'next', 'after'], 'the not needed Sentence goes out, the needed ones stay');
  // A new Sentence plays: the one before is no longer needed and can go out.
  m.need(['next']);
  m.alsoNeed(['after']);
  m.alsoNeed(['third']);
  m.set('third', sound(1));
  assert.deepEqual([...m.keys()], ['next', 'after', 'third']);
});

test('only the Read-ahead of the last two calls is needed: a pause with many jumps does not hold all of them', () => {
  const t = loadTts();
  const m = new t.SoundMemory(2 * BYTES_A_SECOND);
  m.need(['now']);
  for (const k of ['j1', 'j2', 'j3', 'j4']) { m.alsoNeed([k]); m.set(k, sound(1)); }
  assert.deepEqual([...m.keys()], ['j3', 'j4']);
});

test('Read-ahead asked before the Sentence starts (app.js warmCurrent while paused, then Play): it stays needed', () => {
  const t = loadTts();
  const m = new t.SoundMemory(2 * BYTES_A_SECOND);
  // warmCurrent: prefetch(present), prefetch(next); both come in.
  m.alsoNeed(['now']);
  m.alsoNeed(['next']);
  m.set('now', sound(1));
  m.set('next', sound(1));
  // Play: speak(present) starts before the reader asks the Read-ahead again.
  m.need(['now']);
  m.set('old', sound(1));
  assert.deepEqual([...m.keys()], ['now', 'next'], 'the Read-ahead asked before speak() stays');
  // Only the Read-ahead that is no longer wanted goes: two newer Read-ahead calls replace it.
  m.alsoNeed(['x1']);
  m.alsoNeed(['x2']);
  m.set('x1', sound(1));
  assert.ok(!m.has('next'), 'the old Read-ahead goes out when two newer calls replaced it');
});

test('a new Sentence that starts takes out the sounds no longer needed at once, when the memory is over the limit', () => {
  const t = loadTts();
  const m = new t.SoundMemory(2 * BYTES_A_SECOND);
  m.need(['a']);
  m.alsoNeed(['b']);
  m.alsoNeed(['c']);
  for (const k of ['a', 'b', 'c']) m.set(k, sound(1));
  assert.equal(m.bytes, 3 * BYTES_A_SECOND, 'over the limit: all three are needed');
  m.need(['b']);  // 'a' is no longer needed; 'b' and 'c' still are
  assert.deepEqual([...m.keys()], ['b', 'c'], 'need() takes out the old Sentence, not the Read-ahead');
  assert.ok(m.bytes <= m.limit);
});

test('needed Sentences over the limit all stay; the memory is back under the limit when they are no longer needed', () => {
  const t = loadTts();
  const m = new t.SoundMemory(2 * BYTES_A_SECOND);
  m.need(['now']);
  m.alsoNeed(['next']);
  m.alsoNeed(['after']);
  for (const k of ['now', 'next', 'after']) m.set(k, sound(2));
  assert.equal(m.size, 3, 'nothing needed goes out');
  m.need(['other']);   // a jump: the reader asks the Read-ahead of the new place just after
  m.alsoNeed(['o1']);
  m.alsoNeed(['o2']);
  m.set('other', sound(1));
  assert.deepEqual([...m.keys()], ['other']);
  assert.ok(m.bytes <= m.limit);
});

test('one Sentence larger than the limit still plays, and the memory does not keep it once it is no longer needed', async () => {
  const t = loadTts();
  const engine = new t.ServerEngine();
  engine.ready = true;
  engine.cache.limit = 5 * BYTES_A_SECOND;
  const list = [line(0), line(1), line(2), line(3)];
  t.server.seconds[list[0].text] = 20;  // four times the limit
  const words = [];
  const done = new Promise((onEnd) => engine.speak(list[0], { voiceId: 'af_heart', rate: 1, onEnd, onError: (e) => onEnd('error ' + e), onWord: (at) => words.push(at) }));
  assert.equal(await done, undefined, 'the giant Sentence plays to its end, with no error');
  assert.ok(words.length > 0, 'its words are marked');
  await readFrom(engine, list, 1);
  await flush();
  assert.ok(!engine.cache.has(key(list[0])), 'the giant Sentence went out when the next Sentence came in');
  assert.ok(engine.cache.bytes <= engine.cache.limit);
});

test('reading on through a book: the memory stays under the limit, and the Read-ahead is always there when its turn comes', async () => {
  const t = loadTts();
  const engine = new t.ServerEngine();
  engine.ready = true;
  engine.cache.limit = 4 * BYTES_A_SECOND;  // room for four Sentences of 1 s
  const list = Array.from({ length: 30 }, (_, i) => line(i));
  for (let i = 0; i < 28; i++) {
    await flush();  // the Read-ahead of the last call has come in
    if (i > 0) {
      assert.ok(engine.cache.has(key(list[i])), `Sentence ${i} (Read-ahead) is kept when its turn comes`);
      assert.ok(engine.cache.has(key(list[i + 1])), `Sentence ${i + 1} (Read-ahead) is kept`);
    }
    await readFrom(engine, list, i);
    assert.ok(engine.cache.bytes <= engine.cache.limit, `under the limit after Sentence ${i}`);
  }
  assert.equal(t.server.made.length, new Set(t.server.made).size, 'each Sentence was made one time only: no Read-ahead was lost');
  // A jump back to a Sentence that went out: it is made again, one time, and plays.
  assert.ok(!engine.cache.has(key(list[3])), 'Sentence 3 went out');
  engine.stop();
  assert.equal(await readFrom(engine, list, 3), undefined, 'Sentence 3 plays again');
  await flush();
  assert.equal(t.server.made.filter((x) => x === list[3].text).length, 2, 'Sentence 3 was made again one time');
  assert.equal(t.server.made.filter((x) => x === list[4].text).length, 2, 'its Read-ahead was made again one time');
  assert.ok(engine.cache.bytes <= engine.cache.limit);
});

test('the Read-ahead stays when the memory is full of large old Sentences', async () => {
  const t = loadTts();
  const engine = new t.ServerEngine();
  engine.ready = true;
  engine.cache.limit = 4 * BYTES_A_SECOND;
  const list = Array.from({ length: 6 }, (_, i) => line(i));
  for (const s of list.slice(0, 3)) t.server.seconds[s.text] = 3;  // each one almost fills the memory
  await readFrom(engine, list, 0);
  await flush();
  assert.ok(engine.cache.has(key(list[1])) && engine.cache.has(key(list[2])), 'both Read-ahead Sentences stay, over the limit');
  await readFrom(engine, list, 1);
  await flush();
  assert.ok(!engine.cache.has(key(list[0])), 'the Sentence that played before goes out');
  assert.ok(engine.cache.has(key(list[2])) && engine.cache.has(key(list[3])));
});

test('a Sentence that went out is made again when it is read again', async () => {
  const t = loadTts();
  const engine = new t.ServerEngine();
  engine.ready = true;
  engine.cache.limit = 3 * BYTES_A_SECOND;
  const list = Array.from({ length: 12 }, (_, i) => line(i));
  for (let i = 0; i < 8; i++) { await flush(); await readFrom(engine, list, i); }
  await flush();
  assert.ok(!engine.cache.has(key(list[0])), 'Sentence 0 went out');
  const before = t.server.made.filter((x) => x === list[0].text).length;
  engine.stop();
  const ended = await readFrom(engine, list, 0);
  assert.equal(ended, undefined, 'Sentence 0 plays again, with no error');
  assert.equal(t.server.made.filter((x) => x === list[0].text).length, before + 1, 'it was made again by the voice server');
  assert.ok(engine.cache.has(key(list[0])));
});
