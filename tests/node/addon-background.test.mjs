// Tests for the add-on's background script (extension/background.js) and its sound page (extension/offscreen.js).
// Each script is loaded as it is, in a node:vm context with a fake `chrome`, the way Chrome loads it.
// Run: node --test tests/node/addon-background.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const EXT = fileURLToPath(new URL('../../extension/', import.meta.url));
const ID = 'abcdefghijklmnop';
const BASE = `chrome-extension://${ID}/`;
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 5) => { for (let i = 0; i < n; i++) await tick(); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function event() {
  const fns = [];
  return { fns, addListener: (f) => fns.push(f), fire: (...a) => fns.map((f) => f(...a)) };
}

// A fake browser for background.js. `opts.offscreen` decides what the sound page does with a message.
function loadBackground(opts = {}) {
  const sentToTabs = [];   // [tabId, msg]
  const broadcasts = [];   // runtime.sendMessage calls
  const reloads = [];
  let contexts = opts.contexts || [{ contextType: 'OFFSCREEN_DOCUMENT', documentUrl: BASE + 'offscreen.html' }];
  const chrome = {
    runtime: {
      id: ID,
      getURL: (p) => BASE + p,
      getManifest: () => ({ version: '1.0.0' }),
      getContexts: async (f) => contexts.filter((c) => !f.contextTypes || f.contextTypes.includes(c.contextType))
        .filter((c) => !f.documentUrls || f.documentUrls.includes(c.documentUrl)),
      sendMessage: (m) => {
        broadcasts.push(m);
        if (m.to === 'offscreen') return opts.offscreen ? opts.offscreen(m) : Promise.resolve(true);
        return Promise.resolve(undefined);
      },
      reload: () => reloads.push(1),
      onMessage: event(), onConnect: event(), onInstalled: event(),
    },
    offscreen: { createDocument: async () => {} },
    tabs: { sendMessage: (t, m) => { sentToTabs.push([t, m]); return Promise.resolve(); }, update: () => {}, create: () => {}, query: async () => [], onUpdated: event() },
    tts: { speak: () => {}, stop: () => {}, getVoices: async () => [{ voiceName: 'Milena', lang: 'ru-RU', remote: false }] },
    storage: { sync: { get: async () => ({}) }, session: { set: async () => {} } },
    webRequest: { onHeadersReceived: event() },
    alarms: { create: () => {}, onAlarm: event() },
    contextMenus: { create: () => {}, onClicked: event() },
    commands: { onCommand: event() },
  };
  const ctx = vm.createContext({
    chrome, console, clearTimeout, AbortSignal, AbortController, URL,
    setTimeout: opts.fast ? (f, ms) => setTimeout(f, Math.min(ms || 0, 5)) : setTimeout,  // fast: the waits of the tries and of the report are short
    fetch: opts.fetch || (async () => { throw new Error('no network in tests'); }),
  });
  vm.runInContext(readFileSync(EXT + 'background.js', 'utf8'), ctx, { filename: 'background.js' });
  const send = (m, sender) => {
    let answer;
    const kept = chrome.runtime.onMessage.fns[0](m, sender, (v) => { answer = v; });
    return { kept, answer: () => answer };
  };
  return {
    chrome, sentToTabs, broadcasts, reloads, send,
    setContexts: (c) => { contexts = c; },
    webTab: (id) => ({ tab: { id }, url: `https://example.org/${id}` }),
    extTab: (id) => ({ tab: { id }, url: BASE + 'paste.html' }),
    offscreenSender: { url: BASE + 'offscreen.html' },
  };
}

// --- finding 5: the sound page does not take the sentence -> the page gets an error, not a silent 'playing'.
// Since 13 Nov 2026 the Sentence is tried 2 more times first (see the tests of the second try below).
test('play with a sound page that does not answer gives an error event to the tab', async () => {
  const b = loadBackground({ fast: true, offscreen: (m) => (m.cmd === 'speak' ? Promise.reject(new Error('Receiving end does not exist.')) : Promise.resolve(true)) });
  b.send({ to: 'bg', cmd: 'speak', engine: 'kokoro', id: 3, text: 'Hello.', voice: 'af', rate: 1 }, b.webTab(7));
  await wait(60);
  const errs = b.sentToTabs.filter(([t, m]) => t === 7 && m.evt === 'error' && m.id === 3);
  assert.equal(errs.length, 1, 'one error event reaches tab 7');
  assert.match(errs[0][1].why, /Audio player/);
});

test('play with a sound page that takes the sentence gives no error', async () => {
  const b = loadBackground();
  b.send({ to: 'bg', cmd: 'speak', engine: 'kokoro', id: 3, text: 'Hello.', voice: 'af', rate: 1 }, b.webTab(7));
  await settle();
  assert.equal(b.sentToTabs.filter(([, m]) => m.evt === 'error').length, 0);
  assert.ok(b.broadcasts.some((m) => m.to === 'offscreen' && m.cmd === 'speak' && m.id === 3));
});

// --- finding 6: a late event of tab A, with the same id as tab B's sentence, does not reach tab A
test('tab B reads after tab A: a late end event of tab A is not passed on', async () => {
  const b = loadBackground();
  b.send({ to: 'bg', cmd: 'speak', engine: 'kokoro', id: 1, text: 'A.', voice: 'af', rate: 1 }, b.webTab(1));
  await settle();
  b.send({ to: 'bg', cmd: 'speak', engine: 'kokoro', id: 1, text: 'B.', voice: 'af', rate: 1 }, b.webTab(2));
  await settle();
  b.sentToTabs.length = 0;
  b.send({ to: 'bg-evt', tab: 1, id: 1, evt: 'end' }, b.offscreenSender);   // in flight from tab A's sentence
  b.send({ to: 'bg-evt', tab: 2, id: 1, evt: 'tick', t: 0.1, d: 1 }, b.offscreenSender);
  await settle();
  assert.deepEqual(b.sentToTabs.filter(([t]) => t === 1), [], 'tab A gets nothing');
  assert.equal(b.sentToTabs.filter(([t, m]) => t === 2 && m.evt === 'tick').length, 1, 'tab B gets its tick');
});

test('Mac voice: a late voice event of tab A is not passed on after tab B reads', async () => {
  const b = loadBackground();
  const handlers = [];
  b.chrome.tts.speak = (text, o) => handlers.push(o.onEvent);
  b.send({ to: 'bg', cmd: 'speak', engine: 'system', id: 1, text: 'A.', rate: 1 }, b.webTab(1));
  b.send({ to: 'bg', cmd: 'speak', engine: 'system', id: 1, text: 'B.', rate: 1 }, b.webTab(2));
  await settle();
  b.sentToTabs.length = 0;
  handlers[0]({ type: 'end' });   // tab A's voice, late
  await settle();
  assert.deepEqual(b.sentToTabs.filter(([t]) => t === 1), []);
});

// --- finding 14: 'a reader is open' comes from the browser, not from a counter
test('self-update waits while a reader tab is open, even when the background forgot the port', async () => {
  const b = loadBackground({ fetch: async () => ({ json: async () => ({ version: '2.0.0' }) }) });
  b.setContexts([{ contextType: 'TAB', documentUrl: BASE + 'pdf/index.html?file=https%3A%2F%2Fexample.org%2Fa.pdf' }]);
  // no port was ever connected: this is a background that the browser stopped and started again
  b.chrome.alarms.onAlarm.fire({ name: 'self-update' });
  await settle(10);
  assert.equal(b.reloads.length, 0, 'no reload while the reader is open');
  b.setContexts([{ contextType: 'TAB', documentUrl: 'https://example.org/page' }]);
  b.chrome.alarms.onAlarm.fire({ name: 'self-update' });
  await settle(10);
  assert.equal(b.reloads.length, 1, 'reload when no reader is open');
});

test('self-update does nothing when the version on disk is the same', async () => {
  const b = loadBackground({ fetch: async () => ({ json: async () => ({ version: '1.0.0' }) }) });
  b.setContexts([]);
  b.chrome.alarms.onAlarm.fire({ name: 'self-update' });
  await settle(10);
  assert.equal(b.reloads.length, 0);
});

// --- finding 15: a voice server that accepts and then waits gives the Mac voices after 2 seconds
test('voices: a voice server that never answers gives the Mac voices after about 2 seconds', async () => {
  const stalled = (url, o = {}) => new Promise((_, no) => {
    if (o.signal) o.signal.addEventListener('abort', () => no(o.signal.reason || new Error('aborted')));
  });
  const b = loadBackground({ fetch: stalled });
  const t0 = Date.now();
  const r = b.send({ to: 'bg', cmd: 'voices' }, { url: BASE + 'popup.html' });
  assert.equal(r.kept, true);
  const answer = await new Promise((ok, no) => {
    const iv = setInterval(() => { if (r.answer()) { clearInterval(iv); ok(r.answer()); } }, 50);
    setTimeout(() => { clearInterval(iv); no(new Error('no answer after 4 s')); }, 4000);
  });
  const took = Date.now() - t0;
  assert.ok(took >= 1800 && took < 3500, `answer after ${took} ms`);
  assert.equal(answer.server, false);
  assert.deepEqual(answer.system.map((v) => v.id), ['Milena']);
});

// --- finding 24: a web tab that reads sends no event to the add-on pages
test('a web tab that reads: events go to the tab only, not to the add-on pages', async () => {
  const b = loadBackground();
  b.send({ to: 'bg', cmd: 'speak', engine: 'kokoro', id: 1, text: 'A.', voice: 'af', rate: 1 }, b.webTab(4));
  await settle();
  const before = b.broadcasts.length;
  b.send({ to: 'bg-evt', tab: 4, id: 1, evt: 'tick', t: 0.1, d: 1 }, b.offscreenSender);
  await settle();
  assert.equal(b.sentToTabs.filter(([t, m]) => t === 4 && m.evt === 'tick').length, 1);
  assert.deepEqual(b.broadcasts.slice(before).filter((m) => m.to === 'page'), []);
});

test('an add-on page that reads (the paste page) still gets its events by broadcast', async () => {
  const b = loadBackground();
  b.send({ to: 'bg', cmd: 'speak', engine: 'kokoro', id: 1, text: 'A.', voice: 'af', rate: 1 }, b.extTab(5));
  await settle();
  b.send({ to: 'bg-evt', tab: 5, id: 1, evt: 'tick', t: 0.1, d: 1 }, b.offscreenSender);
  await settle();
  assert.equal(b.broadcasts.filter((m) => m.to === 'page' && m.evt === 'tick' && m.tab === 5).length, 1);
});

test('the paste page that took the voice from a web tab: the web tab gets "stopped", the paste page its events', async () => {
  const b = loadBackground();
  b.send({ to: 'bg', cmd: 'speak', engine: 'kokoro', id: 1, text: 'A.', voice: 'af', rate: 1 }, b.webTab(4));
  b.send({ to: 'bg', cmd: 'speak', engine: 'system', id: 2, text: 'B.', rate: 1 }, b.extTab(5));
  await settle();
  assert.equal(b.sentToTabs.filter(([t, m]) => t === 4 && m.evt === 'stopped').length, 1);
  assert.equal(b.broadcasts.filter((m) => m.to === 'page' && m.evt === 'stopped').length, 0, 'web tab stop is not broadcast');
});

test('resume with no audio left: the paste page gets "lost" by broadcast, a web tab directly', async () => {
  const b = loadBackground({ contexts: [] });
  b.send({ to: 'bg', cmd: 'resume', id: 9 }, b.extTab(5));
  b.send({ to: 'bg', cmd: 'resume', id: 8 }, b.webTab(4));
  await settle();
  assert.equal(b.broadcasts.filter((m) => m.to === 'page' && m.evt === 'lost' && m.tab === 5).length, 1);
  assert.equal(b.broadcasts.filter((m) => m.to === 'page' && m.evt === 'lost' && m.tab === 4).length, 0);
  assert.equal(b.sentToTabs.filter(([t, m]) => t === 4 && m.evt === 'lost').length, 1);
});

// --- sound page (offscreen.js)
function loadOffscreen(fetchImpl) {
  const onMessage = event();
  const sent = [];
  class FakeAudio { constructor() { this.currentTime = 0; this.duration = 1; } play() { return Promise.resolve(); } pause() {} removeAttribute() {} }
  const ctx = vm.createContext({
    chrome: { runtime: { onMessage, sendMessage: (m) => { sent.push(m); return Promise.resolve(); } } },
    Audio: FakeAudio, fetch: fetchImpl, setInterval, clearInterval, setTimeout, clearTimeout, AbortSignal, console,
  });
  vm.runInContext(readFileSync(EXT + 'offscreen.js', 'utf8'), ctx, { filename: 'offscreen.js' });
  return { onMessage, sent };
}

test('sound page: it answers that it took the sentence, so the background knows it is there', async () => {
  const o = loadOffscreen(async () => ({ json: async () => ({ starts: [] }) }));
  let answer;
  o.onMessage.fire({ to: 'offscreen', cmd: 'speak', tab: 1, id: 1, text: 'A.', voice: 'af', rate: 1, next: [] }, {}, (v) => { answer = v; });
  await settle();
  o.onMessage.fire({ to: 'offscreen', cmd: 'stop' }, {}, () => {});
  assert.equal(answer, true);
});

test('sound page: the word-time request has a time limit', async () => {
  const seen = [];
  const o = loadOffscreen(async (url, opts = {}) => { seen.push([url, opts]); return { json: async () => ({ starts: [] }) }; });
  o.onMessage.fire({ to: 'offscreen', cmd: 'speak', tab: 1, id: 1, text: 'A.', voice: 'af', rate: 1, next: [] }, {}, () => {});
  await settle();
  o.onMessage.fire({ to: 'offscreen', cmd: 'stop' }, {}, () => {});
  const times = seen.find(([u]) => u.includes('/times?'));
  assert.ok(times, 'a /times request was made');
  assert.ok(times[1].signal, 'the /times request has an abort signal');
});

// Chrome check of 10 Nov 2026, FAIL 3: Previous moved the reading to the next sentence, Next moved 2 or 3. Each event
// of the sound page must carry the id of the sentence whose sound made it. An event of a sentence that was stopped
// (Chrome can hand it out after the switch) must never carry the id of the new sentence, or the page moves on once more.
function loadOffscreenAudio() {
  const onMessage = event();
  const sent = [], made = [];
  class FakeAudio {
    constructor() { this.currentTime = 0; this.duration = 1; this.ended = false; this.plays = []; made.push(this); }
    play() { this.paused = false; return new Promise((ok, no) => this.plays.push({ ok, no })); }
    // as in Chrome: pause() rejects each play() that has not answered yet with an AbortError
    pause() { this.paused = true; const p = this.plays; this.plays = []; p.forEach((x) => x.no(Object.assign(new Error('interrupted by pause()'), { name: 'AbortError' }))); }
    sound() { this.onplaying?.(); const p = this.plays; this.plays = []; p.forEach((x) => x.ok()); }  // the sound starts: 'playing', then play() answers
    load() {} removeAttribute(k) { if (k === 'src') this.src = ''; }
  }
  const ctx = vm.createContext({
    chrome: { runtime: { onMessage, sendMessage: (m) => { sent.push(m); return Promise.resolve(); } } },
    Audio: FakeAudio, fetch: async () => ({ json: async () => ({ starts: [] }) }), setInterval, clearInterval, setTimeout, clearTimeout, AbortSignal, console,
  });
  vm.runInContext(readFileSync(EXT + 'offscreen.js', 'utf8'), ctx, { filename: 'offscreen.js' });
  const speak = (id) => onMessage.fire({ to: 'offscreen', cmd: 'speak', tab: 1, id, text: 'Sentence ' + id + '.', voice: 'af', rate: 1, next: [] }, {}, () => {});
  const cmd = (c) => { let answer; onMessage.fire({ to: 'offscreen', cmd: c }, {}, (v) => { answer = v; }); return answer; };
  const evts = (evt) => sent.filter((m) => m.evt === evt).map((m) => m.id);
  return { speak, cmd, made, evts, current: () => made[made.length - 1] };
}

test('sound page: an end or error of a stopped sentence never carries the id of the sentence after it', async () => {
  const o = loadOffscreenAudio();
  o.speak(1); o.current().sound(); await settle();
  assert.deepEqual(o.evts('start'), [1]);
  const first = o.current(), firstEnded = first.onended, firstError = first.onerror;
  o.speak(2);  // Previous or Next: sentence 2 is asked for while sentence 1 sounds
  await settle();
  // what Chrome may still hand out for the stopped sound: its 'ended' or 'error', to the element's handler of now
  first.onended?.(); first.onerror?.();
  firstEnded?.(); firstError?.();
  assert.deepEqual(o.evts('end'), [], 'no end for sentence 2 before it was even heard');
  assert.deepEqual(o.evts('error'), [], 'no error for sentence 2 from the old sound');
  o.current().sound(); await settle();
  assert.deepEqual(o.evts('start'), [1, 2]);
  o.current().ended = true; o.current().onended();
  o.current().onended?.();  // a second 'ended' of the same sound
  assert.deepEqual(o.evts('end'), [2], 'sentence 2 ends once');
  o.cmd('stop');
});

test('sound page: an end that comes before the sentence started is not sent; it is sent when the start comes', async () => {
  const o = loadOffscreenAudio();
  o.speak(1);
  const a = o.current();
  a.ended = true; a.onended?.();  // a very short sound that ended before play() answered
  assert.deepEqual(o.evts('end'), [], 'no end before the start');
  a.sound(); await settle();
  assert.deepEqual(o.evts('start'), [1]);
  assert.deepEqual(o.evts('end'), [1], 'the end follows the start');
  o.cmd('stop');
});

// Review of 10 Nov 2026: a pause while the first sound still loads rejects play() with an AbortError. The start must
// still come (from the element's own 'playing' or from resume), or the end is never sent and the reading stops.
test('sound page: pause while the sound loads, then resume: one start and one end', async () => {
  const o = loadOffscreenAudio();
  o.speak(1);
  const a = o.current();
  o.cmd('pause'); await settle();  // the pending play() is rejected with an AbortError
  assert.deepEqual(o.evts('start'), [], 'nothing was heard yet');
  assert.equal(o.cmd('resume'), true, 'there is audio to go on with');
  a.sound(); await settle();
  assert.deepEqual(o.evts('start'), [1], 'one start');
  a.ended = true; a.onended(); a.onended();
  assert.deepEqual(o.evts('end'), [1], 'one end');
  assert.deepEqual(o.evts('error'), []);
  o.cmd('stop');
});

test('sound page: pause while the sound loads, then Next before resume: only the next sentence starts and ends', async () => {
  const o = loadOffscreenAudio();
  o.speak(1);
  const first = o.current();
  o.cmd('pause'); await settle();
  o.speak(2);
  first.onplaying?.(); first.onended?.();  // anything late of the first sound
  const b = o.current();
  b.sound(); await settle();
  b.ended = true; b.onended();
  assert.deepEqual(o.evts('start'), [2]);
  assert.deepEqual(o.evts('end'), [2]);
  o.cmd('stop');
});

// ---------- 13 Nov 2026: the second try of the Natural voice (owner's yes) ----------
// Before, one failed Sentence made the page read with the Mac voice for 5 s or more: another voice, another speed.
const speaks = (b) => b.broadcasts.filter((m) => m.to === 'offscreen' && m.cmd === 'speak');
const errorsTo = (b, tab) => b.sentToTabs.filter(([t, m]) => t === tab && m.evt === 'error');

test('second try: a Natural voice Sentence that does not sound is asked 3 times, then the tab gets one error', async () => {
  const b = loadBackground({ fast: true, offscreen: (m) => (m.cmd === 'speak' ? Promise.resolve(false) : Promise.resolve(true)) });
  b.send({ to: 'bg', cmd: 'speak', engine: 'kokoro', id: 3, text: 'Hello.', voice: 'af', rate: 1 }, b.webTab(7));
  await settle();
  assert.equal(errorsTo(b, 7).length, 0, 'no error after the first failure');
  await wait(60);
  assert.equal(speaks(b).length, 3, 'the first ask and 2 more tries');
  assert.equal(errorsTo(b, 7).length, 1);
});

test('second try: when the second ask sounds, the tab hears of no error', async () => {
  let n = 0;
  const b = loadBackground({ fast: true, offscreen: (m) => (m.cmd === 'speak' ? Promise.resolve(++n > 1) : Promise.resolve(true)) });
  b.send({ to: 'bg', cmd: 'speak', engine: 'kokoro', id: 3, text: 'Hello.', voice: 'af', rate: 1 }, b.webTab(7));
  await wait(60);
  assert.equal(speaks(b).length, 2);
  assert.equal(errorsTo(b, 7).length, 0);
});

test('second try: an error of the sound page before the start is tried again; an error after the start goes to the tab', async () => {
  const b = loadBackground({ fast: true });
  b.send({ to: 'bg', cmd: 'speak', engine: 'kokoro', id: 3, text: 'Hello.', voice: 'af', rate: 1 }, b.webTab(7));
  await settle();
  b.send({ to: 'bg-evt', tab: 7, id: 3, evt: 'error', why: 'The voice server on this Mac did not answer.' }, b.offscreenSender);
  await wait(30);
  assert.equal(speaks(b).length, 2, 'asked again');
  assert.equal(errorsTo(b, 7).length, 0);
  b.send({ to: 'bg-evt', tab: 7, id: 3, evt: 'start', d: 2 }, b.offscreenSender);
  b.send({ to: 'bg-evt', tab: 7, id: 3, evt: 'error', why: 'The voice could not play.' }, b.offscreenSender);
  await wait(30);
  assert.equal(speaks(b).length, 2, 'a Sentence that was heard in part is not said again from its start');
  assert.equal(errorsTo(b, 7).length, 1);
});

test('second try: a newer Sentence stops the tries of the older one', async () => {
  const b = loadBackground({ fast: true, offscreen: (m) => (m.cmd === 'speak' ? Promise.resolve(m.id !== 3) : Promise.resolve(true)) });
  b.send({ to: 'bg', cmd: 'speak', engine: 'kokoro', id: 3, text: 'One.', voice: 'af', rate: 1 }, b.webTab(7));
  await settle(2);
  b.send({ to: 'bg', cmd: 'speak', engine: 'kokoro', id: 4, text: 'Two.', voice: 'af', rate: 1 }, b.webTab(7));
  const asked = speaks(b).filter((m) => m.id === 3).length;  // the asks for the older Sentence up to now
  await wait(60);
  assert.equal(speaks(b).filter((m) => m.id === 3).length, asked, 'no more ask for the older Sentence');
  assert.equal(speaks(b).filter((m) => m.id === 4).length, 1);
  assert.equal(errorsTo(b, 7).length, 0);
});

test('second try: the Mac voice is not tried again (its error goes to the tab at once)', async () => {
  const b = loadBackground({ fast: true });
  let onEvent; b.chrome.tts.speak = (text, o) => { onEvent = o.onEvent; };
  b.send({ to: 'bg', cmd: 'speak', engine: 'system', id: 1, text: 'A.', rate: 1 }, b.webTab(1));
  onEvent({ type: 'error', errorMessage: 'no voice' });
  await settle();
  assert.equal(errorsTo(b, 1).length, 1);
});

// ---------- 13 Nov 2026: the report (owner's yes) ----------
// The lines go to the voice server (POST /log). `posts` holds what the fake server got.
function withReport(opts = {}) {
  const posts = []; let up = opts.up !== false;
  const fetch = async (url, o = {}) => {
    if (String(url).endsWith('/log')) { if (!up) throw new Error('refused'); posts.push(...JSON.parse(o.body)); return { ok: true }; }
    if (String(url).endsWith('/voices')) { if (!up) throw new Error('refused'); return { ok: true, json: async () => ({ voices: [], speed: { methods: ['A', 'B'] } }) }; }
    throw new Error('no network in tests');
  };
  const b = loadBackground({ fast: true, fetch, ...opts });
  return { b, posts, setUp: (v) => { up = v; } };
}

test('report: a Sentence that was read gives one line with its wait, its time and its speed, and no text', async () => {
  const { b, posts } = withReport();
  b.send({ to: 'bg', cmd: 'speak', engine: 'kokoro', id: 3, text: 'Hello there, this is a sentence.', voice: 'af_heart', rate: 1.2 }, b.webTab(7));
  await settle();
  b.send({ to: 'bg-evt', tab: 7, id: 3, evt: 'start', d: 2.4 }, b.offscreenSender);
  await wait(20);
  b.send({ to: 'bg-evt', tab: 7, id: 3, evt: 'end' }, b.offscreenSender);
  await wait(40);
  const say = posts.filter((x) => x.evt === 'say' || x.evt === 'speed-off');
  assert.equal(say.length, 1);
  assert.equal(say[0].engine, 'natural'); assert.equal(say[0].voice, 'af_heart'); assert.equal(say[0].chars, 32);
  assert.equal(say[0].rate, 1.2); assert.equal(say[0].play, 1.2); assert.equal(say[0].method, 'B'); assert.equal(say[0].tries, 1);
  assert.ok(say[0].wait >= 0 && say[0].ms >= 15);
  assert.ok(!JSON.stringify(posts).includes('Hello'), 'no text of the page is in the report');
  assert.equal(b.sentToTabs.filter(([t, m]) => t === 7 && m.evt === 'end').length, 1, 'the tab still gets its end');
});

test('report: a Sentence that sounded far from the asked speed is marked speed-off; a paused one is not', async () => {
  const { b, posts } = withReport();
  const read = async (id, d, pause) => {
    b.send({ to: 'bg', cmd: 'speak', engine: 'kokoro', id, text: 'A sentence.', voice: 'af_heart', rate: 1 }, b.webTab(7));
    await settle();
    b.send({ to: 'bg-evt', tab: 7, id, evt: 'start', d }, b.offscreenSender);
    if (pause) { b.send({ to: 'bg', cmd: 'pause' }, b.webTab(7)); await wait(60); b.send({ to: 'bg', cmd: 'resume', id }, b.webTab(7)); await settle(); }
    await wait(50);
    b.send({ to: 'bg-evt', tab: 7, id, evt: 'end' }, b.offscreenSender);
    await wait(30);
  };
  await read(1, 3);          // 3 s of sound in about 0.05 s: far too fast
  await read(2, 0.05);       // about right
  await read(3, 0.05, true); // a pause of 0.06 s is not counted in the time
  const by = (id) => posts.filter((x) => (x.evt === 'say' || x.evt === 'speed-off'))[id - 1];
  assert.equal(by(1).evt, 'speed-off');
  assert.equal(by(2).evt, 'say');
  assert.equal(by(3).evt, 'say');
  assert.ok(by(3).ms < 100, 'the pause is not in the time: ' + by(3).ms);
});

test('report: a failed Sentence, its tries, and the change to the Mac voice are in the report', async () => {
  const { b, posts } = withReport({ offscreen: (m) => (m.cmd === 'speak' ? Promise.resolve(false) : Promise.resolve(true)) });
  b.send({ to: 'bg', cmd: 'speak', engine: 'kokoro', id: 3, text: 'Hello.', voice: 'af_heart', rate: 1 }, b.webTab(7));
  await wait(60);
  b.send({ to: 'bg', cmd: 'speak', engine: 'system', id: 4, text: 'Hello.', voice: 'Samantha', rate: 1, fb: 1 }, b.webTab(7));
  b.send({ to: 'bg', cmd: 'speak', engine: 'system', id: 5, text: 'Again.', voice: 'Samantha', rate: 1, fb: 1 }, b.webTab(7));
  await wait(40);
  assert.deepEqual(posts.filter((x) => x.evt === 'voice-error').map((x) => x.try), [1, 2, 3]);
  assert.equal(posts.filter((x) => x.evt === 'mac-voice').length, 1, 'one line for the change, not one for each Sentence');
});

test('report: "Report a problem" writes a mark with the state and sends it at once', async () => {
  const { b, posts } = withReport();
  b.chrome.tabs.query = async () => [{ id: 7 }];
  b.chrome.tabs.sendMessage = (t, m) => { b.sentToTabs.push([t, m]); return Promise.resolve(m.cmd === 'state' ? { playing: true, paused: false, natOff: false, i: 4, n: 20, voice: 'kokoro:af_heart' } : undefined); };
  b.send({ to: 'bg', cmd: 'speak', engine: 'kokoro', id: 3, text: 'Hello.', voice: 'af_heart', rate: 1.5 }, b.webTab(7));
  await settle();
  const r = b.send({ to: 'bg', cmd: 'problem', where: 'popup' }, {});
  assert.equal(r.kept, true, 'the answer comes later');
  await wait(40);
  const mark = posts.find((x) => x.evt === 'problem');
  assert.ok(mark, 'the mark is in the report');
  assert.equal(mark.where, 'popup'); assert.equal(mark.server, 1); assert.equal(mark.reading, 1); assert.equal(mark.voice, 'af_heart');
  assert.equal(mark.asked, 1.5); assert.equal(mark.playing, 1); assert.equal(mark.sentence, 4); assert.equal(mark.sentences, 20);
  assert.equal(JSON.stringify(r.answer()), '{"saved":true,"sent":true}');
});

test('report: while the voice server does not answer, the lines wait; they go when it answers again', async () => {
  const { b, posts, setUp } = withReport({ up: false });
  const r = b.send({ to: 'bg', cmd: 'problem', where: 'popup' }, {});
  await wait(40);
  assert.equal(posts.length, 0);
  assert.equal(JSON.stringify(r.answer()), '{"saved":true,"sent":false}');
  setUp(true);
  b.send({ to: 'bg', cmd: 'note', evt: 'test-line', now: true }, b.webTab(7));
  await wait(40);
  assert.ok(posts.some((x) => x.evt === 'problem' && x.server === 0), 'the mark of before arrived');
  assert.ok(posts.some((x) => x.evt === 'test-line'));
});
