// Tests for the Reading position of a library Book in the reader (ticket 27): extension/pdf/position.js.
// The reader keeps its own copy in the browser and the voice server keeps one; the reader opens at the newer one.
// Run: node --test --test-timeout=120000 tests/node/reading-position.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newerPosition } from '../../extension/pdf/position.js';

test('the newer of the own copy and the voice server copy wins', () => {
  const local = { i: 10, at: 'ten', t: 2000 };
  const remote = { i: 50, at: 'fifty', t: 3000 };
  assert.equal(newerPosition(local, remote), remote, 'the voice server copy is newer');
  assert.equal(newerPosition({ ...local, t: 4000 }, remote).i, 10, 'the own copy is newer');
  assert.equal(newerPosition({ i: 10, t: 3000 }, { i: 50, t: 3000 }).i, 10, 'the same time: the own copy stays');
});

test('an own copy from before ticket 27 has no time: the voice server copy wins', () => {
  assert.equal(newerPosition({ i: 10, at: 'ten' }, { i: 50, t: 5 }).i, 50);
});

test('no voice server copy (no answer, null, or damaged): the own copy works as before', () => {
  const local = { i: 10, at: 'ten', t: 2000 };
  for (const remote of [null, undefined, {}, { i: -1, t: 9e12 }, { i: '3', t: 9e12 }, 'x']) {
    assert.equal(newerPosition(local, remote), local, JSON.stringify(remote));
  }
});

test('a time in the future is not trusted: a clock that was ahead cannot make a copy win for ever', () => {
  const now = 1_000_000;
  assert.equal(newerPosition({ i: 10, t: 9e12 }, { i: 50, t: now - 5 }, { now }).i, 50, 'own copy far in the future');
  assert.equal(newerPosition({ i: 10, t: now - 5 }, { i: 50, t: 9e12 }, { now }).i, 10, 'voice server copy far in the future');
  assert.equal(newerPosition({ i: 10, t: now - 5 }, { i: 50, t: now + 30000 }, { now }).i, 50, 'a small skew is still a time');
});

test('a voice server copy with no first words is used only when its sentence is inside the Book', () => {
  const local = { i: 10, at: 'ten', t: 1 };
  assert.equal(newerPosition(local, { i: 500, t: 9 }, { now: 10, count: 100 }), local, 'sentence 500 of 100: not used');
  assert.equal(newerPosition(null, { i: 100, t: 9 }, { now: 10, count: 100 }), null);
  assert.equal(newerPosition(local, { i: 99, t: 9 }, { now: 10, count: 100 }).i, 99);
  assert.equal(newerPosition(local, { i: 500, at: 'x', t: 9 }, { now: 10, count: 100 }).i, 500, 'with first words: found by them');
});

test('no own copy: the voice server copy is used; none of both: null', () => {
  const remote = { i: 50, t: 3000 };
  assert.equal(newerPosition(null, remote), remote);
  assert.equal(newerPosition({ i: 'x' }, remote), remote);
  assert.equal(newerPosition(null, null), null);
});


// ---- app.js with a fake page: the open of a library Book and the sends to the voice server ----------------------
// app.js runs in a node:vm context, as in highlights.test.mjs; its import lines take the same names from fakes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const APP_JS = fileURLToPath(new URL('../../extension/pdf/app.js', import.meta.url));
const ID = '0123456789ab';
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(cond, what) {
  for (let i = 0; i < 500; i++) { if (cond()) return; await tick(); }
  throw new Error('waited too long for: ' + what);
}
function element(id) {
  const listeners = {};
  const el = {
    id, value: '', textContent: '', hidden: false, disabled: false, checked: false, title: '', style: {}, dataset: {}, children: [], files: [],
    className: '', offsetWidth: 100, innerHTML: '', classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, getAttribute: () => null, hasAttribute: () => false, insertAdjacentHTML() {},
    appendChild(c) { this.children.push(c); return c; }, remove() {}, contains: (x) => x === el, querySelectorAll: () => [],
    querySelector: () => null, matches: () => false, closest: () => null, focus() {}, scrollIntoView() {},
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    fire(t, e = {}) { for (const f of listeners[t] || []) f({ target: el, preventDefault() {}, stopPropagation() {}, ...e }); },
  };
  return el;
}
const sentence = (i, page = 1) => ({ text: `Invented sentence number ${i}.`, spans: [{ page, item: i }], charOwners: [], page, sectionIndex: 0, pauseAfter: 300 });

// A fake voice server with the rule of voice-server.py: the reader time goes to ct (never later than now), t is the
// time of the save, a save with an older ct is not written, and the answer is the kept record. Tabs can share one.
function fakeServer() {
  const srv = { kept: null, gets: 0, posts: [], hang: false, pending: [] };
  srv.get = () => {
    srv.gets++;
    const body = srv.kept;
    if (srv.hang) return new Promise((resolve) => srv.pending.push(() => resolve({ ok: true, json: async () => srv.kept })));
    return Promise.resolve({ ok: true, json: async () => body });
  };
  srv.post = (rec) => {
    srv.posts.push(rec);
    if (srv.failNext) { srv.failNext--; throw new TypeError('Failed to fetch'); }
    if (srv.refuse) return null;  // HTTP 400
    if (srv.kept && srv.kept.i === rec.i && srv.kept.at === rec.at && !(srv.kept.ct > Math.min(rec.t ?? Date.now(), Date.now()))) {
      srv.kept = { ...rec, ct: Math.min(rec.t ?? Date.now(), Date.now()), t: srv.kept.t };  // the same place keeps its time
      return srv.kept;
    }
    const now = Date.now(), ct = Math.min(rec.t ?? now, now);
    if (!(srv.kept && srv.kept.ct > ct)) srv.kept = { ...rec, ct, t: now };
    return srv.kept;
  };
  return srv;
}

function loadReader({ server = fakeServer(), storage = {}, shared = null } = {}) {
  const ids = {};
  const byId = (id) => (ids[id] ||= element(id));
  byId('rateSel').value = '1';
  const store = shared || new Map([['pr.engine.chosen', 'system'], ...Object.entries(storage)]);
  const parses = [], winListeners = {}, docListeners = {}, timers = [], warnings = [];
  const engine = (id) => class { constructor() { this.id = id; this.ready = true; this.available = true; } async init() {} listVoices() { return [{ id: 'v1', label: 'Voice' }]; }
    speak() { return Promise.resolve(); } stop() {} prefetch() {} };
  const modules = {
    pdfjsLib: { GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 240, destroy: async () => {}, getOutline: async () => null }) }) },
    PdfViewer: class { constructor() { this.pages = new Map(); this.follow = true; } async load() {} highlight() {} highlightWord() {} clearWord() {} setZoom() {} relayout() {} },
    buildDocument: () => new Promise((resolve) => parses.push(resolve)),
    SystemEngine: engine('system'), ServerEngine: engine('kokoro'),
    loadLexicon: async () => {}, repairStats: () => ({ repaired: 0 }), withOcr: async (doc) => doc,
    setupNotes: () => ({ reload() {}, markdown() { return ''; }, reset() {}, markAt: () => null }),
    setupAsk: () => ({ reload() {}, highlightsChanged() {}, stopReading() {} }),
    newerPosition,
  };
  let src = readFileSync(APP_JS, 'utf8');
  src = src.replace(/^import \* as (\w+) from [^;]+;$/gm, 'const $1 = __modules.$1;')
    .replace(/^import \{([^}]+)\} from [^;]+;$/gm, 'const {$1} = __modules;')
    .replaceAll('import.meta.url', '"file:///reader/pdf/app.js"');
  const search = `?lib=${ID}&name=Invented&file=` + encodeURIComponent('/library/file/' + ID);
  const ctx = {
    __modules: modules,
    console: { log() {}, info() {}, warn: (...a) => warnings.push(a.join(' ')), error() {} },
    document: { getElementById: byId, createElement: () => element(), addEventListener: (t, f) => (docListeners[t] ||= []).push(f), visibilityState: 'visible' },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    location: { search, protocol: 'http:', href: 'http://127.0.0.1:8793/reader/index.html' + search },
    navigator: {},
    // timers with a time are kept; the test runs them with fire(ms). Timers with no time run as usual.
    setTimeout: (fn, ms) => { if (!ms) return setTimeout(fn, 0); const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t && typeof t === 'object') t.live = false; },
    setInterval: () => 0,
    URL, URLSearchParams, File, TextDecoder, TextEncoder, crypto: globalThis.crypto,
    Worker: class { constructor() { throw new Error('no worker in a test'); } },
    fetch: async (url, init = {}) => {
      url = String(url);
      if (url.startsWith('/library/file/')) return { ok: true, arrayBuffer: async () => new TextEncoder().encode('%PDF-1.7 test').buffer };
      if (url === `/library/${ID}/position` && init.method === 'POST') {
        const kept = server.post(JSON.parse(init.body));
        return kept ? { ok: true, json: async () => kept } : { ok: false, status: 400, json: async () => ({}) };
      }
      if (url === `/library/${ID}/position` && server.get) return server.get();
      throw new Error('no network in a test');
    },
    getSelection: () => '', confirm: () => false,
    addEventListener: (t, f) => (winListeners[t] ||= []).push(f),
    innerWidth: 1400,
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: APP_JS });
  const fire = (ms) => { for (const t of timers.filter((x) => x.ms === ms && x.live)) { t.live = false; t.fn(); } };
  const pause = (at) => { byId('playBtn').fire('click'); ctx.__pr.index = at; byId('playBtn').fire('click'); };
  const hide = () => { for (const f of winListeners.pagehide || []) f(); };
  return { ctx, state: ctx.__pr, byId, parses, server, posts: server.posts, store, winListeners, docListeners, fire, pause, hide, warnings };
}
const book = () => Array.from({ length: 100 }, (_, i) => sentence(i, 1 + Math.floor(i / 10)));
async function endReadIn(r) {
  await until(() => r.parses.length, 'the read-in');
  r.parses[0]({ sentences: book(), sections: [] });
}
async function openWith(opts) {
  const r = loadReader(opts);
  await endReadIn(r);
  await until(() => r.byId('parseFill').style.width === '100%', 'the end of the read-in');
  return r;
}
const withKept = (rec) => { const srv = fakeServer(); srv.kept = rec; return srv; };
const fp = (i) => `invented sentence number ${i}`;

test('the reader opens a library Book at the voice server copy when it is newer', async () => {
  // the own copy is keyed by the document key; the test finds it after the open and writes an older one
  const r = await openWith({ server: withKept({ i: 42, at: fp(42), t: Date.now() }) });
  assert.equal(r.state.index, 42);
});

test('the reader keeps its own copy when it is newer than the voice server copy', async () => {
  const first = await openWith();
  const key = 'pr.pos.' + first.state.docKey;
  const r = await openWith({ storage: { [key]: JSON.stringify({ i: 30, at: fp(30), t: 5000 }) }, server: withKept({ i: 42, at: fp(42), t: 4000 }) });
  assert.equal(r.state.index, 30);
});

test('the voice server does not answer: the reader opens at its own copy, with no message', async () => {
  const first = await openWith();
  const key = 'pr.pos.' + first.state.docKey;
  const r = await openWith({ storage: { [key]: JSON.stringify({ i: 30, at: fp(30) }) }, server: { posts: [], post() {}, get: async () => { throw new TypeError('Failed to fetch'); } } });
  assert.equal(r.state.index, 30);
  assert.doesNotMatch(r.byId('engineStatus').textContent, /position|voice server/i);
});

test('a pause and a page that closes send the place to the voice server; the read-in sends nothing', async () => {
  const r = loadReader();
  await until(() => r.parses.length, 'the read-in');
  r.hide();
  assert.equal(r.posts.length, 0, 'nothing is sent before the place is loaded');
  await endReadIn(r);
  await until(() => r.byId('parseFill').style.width === '100%', 'the end of the read-in');
  r.pause(25);
  assert.equal(r.posts.length, 1, 'the pause sends at once');
  const p = r.posts[0];
  assert.deepEqual([p.i, p.total, p.page, p.pages, p.at], [25, 100, 3, 240, fp(25)]);
  assert.ok(p.t > 0 && Number.isFinite(p.minLeft));
  r.state.index = 26;
  r.hide();
  assert.equal(r.posts.length, 2, 'the page hide sends at once');
  r.hide();
  assert.equal(r.posts.length, 2, 'the same place is not sent again');
  const lib = JSON.parse(r.store.get('ra2.lib.' + ID));
  assert.deepEqual([lib.i, lib.page, lib.pages], [26, 3, 240], 'the own copy for the library stays');
});

test('the voice server hangs: the read-in uses the own copy after 3 s, sends wait, a late newer answer is used', async () => {
  const first = await openWith();
  const key = 'pr.pos.' + first.state.docKey;
  const srv = fakeServer();
  srv.hang = true;
  srv.kept = { i: 70, at: fp(70), t: Date.now() + 5, ct: Date.now() };
  const r = loadReader({ server: srv, storage: { [key]: JSON.stringify({ i: 30, at: fp(30), t: Date.now() - 1000 }) } });
  await endReadIn(r);
  for (let k = 0; k < 20; k++) await tick();
  assert.notEqual(r.byId('parseFill').style.width, '100%', 'the read-in waits for the answer');
  r.fire(3000);
  await until(() => r.byId('parseFill').style.width === '100%', 'the end of the read-in after 3 s');
  assert.equal(r.state.index, 30, 'the own copy');
  assert.ok(r.warnings.some((w) => /did not answer in 3 s/.test(w)), 'a console warning, no message for the owner');
  r.hide(); r.state.index = 30;
  assert.equal(r.posts.length, 0, 'no send before the answer');
  srv.pending.shift()();
  await until(() => r.state.index === 70, 'the late, newer answer is used');
  assert.equal(r.posts.length, 0, 'the old place is not sent');
});

test('a late answer is not used when the owner moved; the held place then goes', async () => {
  const srv = fakeServer();
  srv.hang = true;
  srv.kept = { i: 70, at: fp(70), t: Date.now() - 50000, ct: Date.now() - 50000 };
  const r = loadReader({ server: srv });
  await endReadIn(r);
  r.fire(3000);
  await until(() => r.byId('parseFill').style.width === '100%', 'the end of the read-in after 3 s');
  r.pause(40);
  assert.equal(r.posts.length, 0, 'held');
  srv.pending.shift()();
  await until(() => r.posts.length === 1, 'the held place goes after the answer');
  assert.equal(r.state.index, 40, 'the owner stays where he went');
  assert.equal(srv.kept.i, 40);
});

test('a voice server copy with a sentence beyond the end and no first words is not used', async () => {
  const first = await openWith();
  const key = 'pr.pos.' + first.state.docKey;
  const r = await openWith({ storage: { [key]: JSON.stringify({ i: 30, at: fp(30), t: 1000 }) }, server: withKept({ i: 500, t: Date.now() }) });
  assert.equal(r.state.index, 30);
});

test('two tabs in turn: each opens at the place of the other; an old tab does not send its old place again', async () => {
  const srv = fakeServer();
  const a = await openWith({ server: srv });
  a.pause(25);
  assert.equal(srv.kept.i, 25);
  const b = await openWith({ server: srv });
  assert.equal(b.state.index, 25, 'tab B opens where tab A stopped');
  b.pause(60);
  assert.equal(srv.kept.i, 60);
  a.hide();
  assert.equal(srv.kept.i, 60, 'tab A closes on its old place: it does not write it over the place of tab B');
  const c = await openWith({ server: srv, storage: Object.fromEntries(a.store) });
  assert.equal(c.state.index, 60, 'a new tab with the browser copy of A opens at the newer place of B');
});

test('the voice server keeps a newer place than the one sent: the reader takes it and does not send its old place again', async () => {
  const srv = fakeServer();
  const r = await openWith({ server: srv });
  srv.kept = { i: 80, at: fp(80), t: Date.now(), ct: Date.now() + 50000 };  // another tab saved later
  r.pause(25);
  assert.equal(r.posts.length, 1);
  await until(() => r.state.index === 80, 'the kept place is taken');
  r.hide();
  assert.equal(r.posts.length, 1, 'the old place is not sent again');
  assert.equal(JSON.parse(r.store.get('ra2.lib.' + ID)).i, 80, 'the own copy follows');
});

// ---- second review ---------------------------------------------------------------------------------------------
test('a background tab that did not move writes nothing on hide; the other tab\'s newer place wins on reopen', async () => {
  const srv = fakeServer();
  const shared = new Map([['pr.engine.chosen', 'system']]);
  const a = await openWith({ server: srv, shared });
  a.pause(25);
  const b = await openWith({ server: srv, shared });
  assert.equal(b.state.index, 25);
  b.pause(60);
  const before = shared.get('pr.pos.' + a.state.docKey);
  a.hide();                                          // tab A goes to the background, still at 25
  a.byId('playBtn').fire('click'); a.byId('playBtn').fire('click');   // and a pause there with no move
  assert.equal(shared.get('pr.pos.' + a.state.docKey), before, 'tab A does not write its old place with a new time');
  srv.get = () => Promise.resolve({ ok: true, json: async () => null });  // the voice server does not help here
  const c = await openWith({ server: srv, shared });
  assert.equal(c.state.index, 60);
});

test('a page hide before the read-in ends writes no own copy', async () => {
  const r = loadReader({ storage: { 'pr.pos.x': 'kept' } });
  await until(() => r.parses.length, 'the read-in');
  r.hide();
  for (const [k, v] of r.store) assert.ok(!k.startsWith('pr.pos.') || v === 'kept', 'no new own copy: ' + k);
  assert.ok(!r.store.has('ra2.lib.' + ID));
});

test('a failed send is tried again at the next save', async () => {
  const srv = fakeServer();
  const r = await openWith({ server: srv });
  srv.failNext = 1;
  r.pause(25);
  await tick(); await tick();
  assert.equal(srv.kept, null, 'the first send failed');
  r.hide();
  await until(() => srv.kept && srv.kept.i === 25, 'the second send');
});

test('a GET that never answers holds the sends only until the time limit', async () => {
  const srv = fakeServer();
  srv.hang = true;
  const r = loadReader({ server: srv });
  await endReadIn(r);
  r.fire(3000);
  await until(() => r.byId('parseFill').style.width === '100%', 'the end of the read-in');
  r.pause(40);
  assert.equal(r.posts.length, 0, 'held');
  r.fire(10000);
  await until(() => r.posts.length === 1, 'the held place goes after the time limit');
  assert.ok(r.warnings.some((w) => /did not answer/.test(w)));
});

test('t is the time the place changed: the library copy and a send of the same place keep it', async () => {
  const srv = fakeServer();
  const r = await openWith({ server: srv });
  r.pause(25);
  const t1 = JSON.parse(r.store.get('ra2.lib.' + ID)).t;
  assert.equal(r.posts[0].t, t1);
  await new Promise((done) => setTimeout(done, 5));
  r.byId('playBtn').fire('click'); r.byId('playBtn').fire('click');   // play and pause with no move
  r.hide();
  assert.equal(JSON.parse(r.store.get('ra2.lib.' + ID)).t, t1, 'the library "last read" does not move on a close');
  assert.equal(r.posts.length, 1, 'the same place is not sent again');
});

test('a minutes-left that is not a number is left out, and a refused send gives a console warning', async () => {
  const srv = fakeServer();
  const r = await openWith({ server: srv });
  r.byId('rateSel').value = 'not a speed';
  r.pause(25);
  assert.equal(r.posts.length, 1);
  assert.equal('minLeft' in r.posts[0], false, 'no minLeft: JSON would make it null');
  srv.refuse = true;
  r.state.index = 26; r.hide();
  await until(() => r.warnings.some((w) => /did not take it/.test(w)), 'the warning');
});
