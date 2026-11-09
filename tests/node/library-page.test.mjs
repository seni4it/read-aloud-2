// Tests for the library page (app/library.js), the shelf of books that the voice server serves at /app/.
// The script is loaded as it is, in a node:vm context with a small fake page, fake fetch and fake timers.
// Run: node --test tests/node/library-page.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const APP = fileURLToPath(new URL('../../app/', import.meta.url));
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await tick(); };

// One fake element. Children made from innerHTML are found again by their selector.
function element(id) {
  const listeners = {};
  const kids = {};
  const el = {
    id, value: '', textContent: '', hidden: false, disabled: false, title: '', tabIndex: -1,
    style: {}, children: [], parent: null, files: [],
    classList: { add() {}, remove() {} },
    get isConnected() { return this.parent ? this.parent.isConnected : !!this.root; },
    setAttribute() {},
    set innerHTML(_) { /* the card markup: children are made on first ask */ },
    querySelector(sel) { return (kids[sel] ||= element()); },
    querySelectorAll(sel) { return (kids[sel] ||= [element(), element()]); },
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    fire(t, e = {}) { return Promise.all((listeners[t] || []).map((f) => f({ target: el, preventDefault() {}, stopPropagation() {}, ...e }))); },
    replaceChildren(...c) { this.children.forEach((k) => { k.parent = null; }); this.children = c; c.forEach((k) => { k.parent = this; }); },
    click() {},
  };
  return el;
}

function loadPage(opts = {}) {
  const ids = {};
  const byId = (id) => {
    if (!ids[id]) { ids[id] = element(id); ids[id].root = true; }
    return ids[id];
  };
  byId('sort').value = 'opened';
  byId('restartBtn').textContent = '↻ Restart helper';
  const requests = [];
  const timers = [];
  const images = [];
  class Image {
    constructor() { images.push(this); this.tries = []; }
    set src(v) { this._src = v; this.tries.push(v); }
    get src() { return this._src; }
  }
  const books = opts.books || [];
  const reply = (body, ok = true) => ({ ok, json: async () => body, text: async () => JSON.stringify(body) });
  const fetch = opts.fetch || (async (url, init) => {
    requests.push([String(url), init]);
    if (url === '/library.json') return reply(books);
    if (/\/export$/.test(url)) return reply({ state: 'none' });
    if (url === '/youtube/status') return reply({});
    return reply({});
  });
  const win = {};
  const ctx = vm.createContext({
    document: { getElementById: byId, createElement: () => element() },
    fetch: (...a) => { if (opts.fetch) requests.push([String(a[0]), a[1]]); return fetch(...a); },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    setInterval: () => 0, clearTimeout() {},
    Image, Intl, Date, Math, Number, String, JSON, Promise, console,
    localStorage: { getItem: () => null, setItem() {} },
    location: {}, confirm: () => true,
    addEventListener: (t, f) => { (win[t] ||= []).push(f); },
    window: { open() {} },
  });
  vm.runInContext(readFileSync(APP + 'library.js', 'utf8'), ctx, { filename: 'library.js' });
  // run the timers that are due now; a timer set while running waits for the next call
  const runTimers = () => { const due = timers.splice(0); due.forEach((t) => t.f()); return due.length; };
  return { byId, requests, timers, images, runTimers, win };
}

const someBooks = (n) => Array.from({ length: n }, (_, i) => ({ id: 'b' + i, name: 'Book ' + i, added: i, opened: 0, cover: false }));

test('a failing cover is tried at most 5 times', async () => {
  const p = loadPage({ books: someBooks(1) });
  await settle();
  const img = p.images.at(-1);
  for (let i = 0; i < 20; i++) { img.onerror?.(); p.runTimers(); }
  assert.ok(img.tries.length <= 5, `cover tries: ${img.tries.length}`);
});

test('a cover is not tried again after its card is removed', async () => {
  const p = loadPage({ books: someBooks(1) });
  await settle();
  const img = p.images.at(-1);
  img.onerror();                         // the first try fails; a new try waits 4 s
  p.byId('grid').replaceChildren();      // the card is removed (search, remove, reload)
  p.runTimers();
  img.onerror?.(); p.runTimers();
  assert.equal(img.tries.length, 1);
});

test('typing 5 letters with 40 books sends 0 export requests', async () => {
  const p = loadPage({ books: someBooks(40) });
  await settle();
  const before = p.requests.filter(([u]) => /\/export$/.test(u)).length;
  assert.ok(before <= 40, `export requests at load: ${before}`);
  for (const q of ['b', 'bo', 'boo', 'book', 'book ']) { p.byId('search').value = q; await p.byId('search').fire('input'); }
  await settle();
  const after = p.requests.filter(([u]) => /\/export$/.test(u)).length;
  assert.equal(after - before, 0);
});

test('the audio export state still shows on the card', async () => {
  const p = loadPage({
    fetch: async (url) => ({
      ok: true,
      json: async () => url === '/library.json' ? someBooks(1) : /\/export$/.test(url) ? { state: 'done', files: [1, 2, 3] } : {},
    }),
  });
  await settle();
  const card = p.byId('grid').children[0];
  const [, right] = card.querySelectorAll('.sub span');
  assert.equal(right.textContent, 'Audio: 3 MP3s');
});

test('adding a book when the voice server is stopped gives a message', async () => {
  const p = loadPage({
    fetch: async (url) => {
      if (url === '/library.json') return { ok: true, json: async () => [] };
      throw new TypeError('Failed to fetch');
    },
  });
  await settle();
  p.byId('file').files = [{ name: 'a.pdf', type: 'application/pdf' }];
  await p.byId('file').fire('change', { target: p.byId('file') });
  await settle();
  const t = p.byId('status').textContent;
  assert.doesNotMatch(t, /Adding/);
  assert.match(t, /Could not add a\.pdf/);
});

test('a failed add is not reported as added', async () => {
  const p = loadPage({
    fetch: async (url) => ({ ok: url === '/library.json', json: async () => [] }),
  });
  await settle();
  p.byId('file').files = [{ name: 'a.pdf', type: 'application/pdf' }];
  await p.byId('file').fire('change', { target: p.byId('file') });
  await settle();
  assert.match(p.byId('status').textContent, /Could not add a\.pdf/);
});

test('a key file that is not JSON gives a message', async () => {
  const p = loadPage();
  await settle();
  const f = { text: async () => 'this is not JSON' };
  await p.byId('ytSecret').fire('change', { target: { files: [f] } });
  await settle();
  assert.match(p.byId('ytState').textContent, /not the key file/);
});

test('a key file sent to a stopped voice server gives a message', async () => {
  const p = loadPage({
    fetch: async (url) => {
      if (url === '/library.json') return { ok: true, json: async () => [] };
      throw new TypeError('Failed to fetch');
    },
  });
  await settle();
  const f = { text: async () => '{"installed":{}}' };
  await p.byId('ytSecret').fire('change', { target: { files: [f] } });
  await settle();
  assert.match(p.byId('ytState').textContent, /not running/);
});

test('the restart button can be pressed again after a failed restart', async () => {
  const p = loadPage();
  await settle();
  const b = p.byId('restartBtn');
  // in this test /reader/restart.js cannot be loaded, so the restart fails
  await p.byId('restartBtn').fire('click').catch(() => {});
  await settle();
  p.runTimers();
  assert.equal(b.disabled, false);
});

// WCAG relative luminance and contrast ratio
const lum = (hex) => {
  const c = hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// Since ticket 20 the colours of library.css are tokens: read their values in extension/pdf/tokens.css.
const TOKENS = readFileSync(fileURLToPath(new URL('../../extension/pdf/tokens.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const tokenMode = (block) => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const LIGHT = tokenMode(/^:root\s*\{([\s\S]*?)\n\}/m.exec(TOKENS)[1]);
const DARK = { ...LIGHT, ...tokenMode(/prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(TOKENS)[1]) };
const hexOf = (mode, v) => (v.startsWith('var(') ? hexOf(mode, mode[/var\((--[\w-]+)\)/.exec(v)[1]]) : v);

test('the cover placeholder has a contrast of 4 to 1 or more, light and dark', () => {
  const css = readFileSync(APP + 'library.css', 'utf8');
  const cover = css.match(/^\.cover \{[^}]*\}/m)[0];
  const fgVar = cover.match(/[^-]color: (var\(--[\w-]+\))/)[1];
  const bgVar = cover.match(/background: (var\(--[\w-]+\))/)[1];
  for (const [name, mode] of [['light', LIGHT], ['dark', DARK]]) {
    const fg = hexOf(mode, fgVar), bg = hexOf(mode, bgVar);
    assert.ok(ratio(fg, bg) >= 4, `${name}: ${fg} on ${bg} = ${ratio(fg, bg).toFixed(2)}`);
  }
});
