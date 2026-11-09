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
    chrome, console, setTimeout, clearTimeout, AbortSignal, AbortController, URL,
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

// --- finding 5: the sound page does not take the sentence -> the page gets an error, not a silent 'playing'
test('play with a sound page that does not answer gives an error event to the tab', async () => {
  const b = loadBackground({ offscreen: (m) => (m.cmd === 'speak' ? Promise.reject(new Error('Receiving end does not exist.')) : Promise.resolve(true)) });
  b.send({ to: 'bg', cmd: 'speak', engine: 'kokoro', id: 3, text: 'Hello.', voice: 'af', rate: 1 }, b.webTab(7));
  await settle();
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

test('system voice: a late voice event of tab A is not passed on after tab B reads', async () => {
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
