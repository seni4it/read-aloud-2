// Tests for Follow and the player bar of the web-page reader (extension/content.js), ticket 14.
// content.js is loaded as it is, in a node:vm context with a small fake page and a fake `chrome`, the way Chrome loads it
// (the same method as web-sentences.test.mjs). This fake also keeps the event listeners, the timers, the scroll calls and
// a screen place for each element, so a test can see where the page scrolls and where the player is.
// These tests cannot prove the real scroll or the sound: the Work report of ticket 14 has the steps for a check in Chrome.
// Run: node --test --test-timeout=120000 tests/node/web-follow-player.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const CONTENT_JS = fileURLToPath(new URL('../../extension/content.js', import.meta.url));
const INLINE = new Set(['SPAN', 'A', 'B', 'I', 'EM', 'STRONG', 'CODE', 'BR', 'SUP', 'SUB', 'SMALL']);
const ZERO = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
const box = (top, height = 20, left = 100, width = 600) => ({ top, bottom: top + height, left, right: left + width, width, height });

// ---------- a small fake page ----------
// One simple selector (no spaces): tag, .class, #id, [attr], [attr=v], [attr="v"], [attr*="v"]. A selector that the fake
// does not understand is an error, so that a test never passes because of the fake.
function matchesOne(el, sel) {
  const m = /^([a-z][a-z0-9-]*|)((?:\.[\w-]+|#[\w-]+|\[[^\]]+\])*)$/i.exec(sel.trim());
  if (!m || !sel.trim()) throw new Error('the fake page does not understand the selector: ' + sel);
  if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
  for (const [part] of m[2].matchAll(/\.[\w-]+|#[\w-]+|\[[^\]]+\]/g)) {
    if (part[0] === '.') { if (!el.className.split(/\s+/).includes(part.slice(1))) return false; continue; }
    if (part[0] === '#') { if (el.id !== part.slice(1)) return false; continue; }
    const a = /^\[([\w-]+)(?:(\*?=)(?:"([^"]*)"|([\w-]+)))?\]$/.exec(part);
    if (!a) throw new Error('the fake page does not understand the selector: ' + sel);
    a[3] ??= a[4];
    const v = el.getAttribute(a[1]);
    if (v === null) return false;
    if (a[2] === '=' && v !== a[3]) return false;
    if (a[2] === '*=' && !v.includes(a[3])) return false;
  }
  return true;
}
const matches = (el, list) => list.split(',').map((s) => matchesOne(el, s)).some(Boolean);

function listeners() {
  const on = {};
  return {
    on,
    addEventListener(type, f) { (on[type] ||= []).push(f); },
    fire(type, e = {}) { for (const f of on[type] || []) f({ type, detail: 1, ...e }); },
  };
}
function text(data) { return { nodeType: 3, nodeName: '#text', data, parentElement: null, parentNode: null, previousSibling: null }; }
function el(tag, attrs = {}, kids = []) {
  const ev = listeners(), cls = new Set();
  const e = {
    nodeType: 1, tagName: tag.toUpperCase(), nodeName: tag.toUpperCase(), attrs: { ...attrs }, childNodes: [],
    parentElement: null, parentNode: null, dataset: {}, style: {}, hidden: false, rect: null,
    scrollHeight: 0, clientHeight: 0, scrolls: [], isContentEditable: false, previousSibling: null,
    get id() { return this.attrs.id || ''; },
    get className() { return this.attrs.class || ''; },
    set className(v) { this.attrs.class = v; },
    get innerText() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.innerText)).join(''); },
    getAttribute(k) { return k in this.attrs ? String(this.attrs[k]) : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    matches(s) { return matches(this, s); },
    closest(s) { for (let x = this; x; x = x.parentElement) if (matches(x, s)) return x; return null; },
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; },
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; c.parentElement = this; this.childNodes.push(c); return c; },
    removeChild(c) { this.childNodes.splice(this.childNodes.indexOf(c), 1); c.parentNode = c.parentElement = null; return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    checkVisibility() { return true; },
    getBoundingClientRect() { return this.rect || box(0, 800, 0, 1200); },
    scrollBy(o) { this.scrolls.push(o); },
    attachShadow() {
      const ids = {}; let html = '';
      return this.shadow = {
        set innerHTML(v) { html = v; }, get innerHTML() { return html; },
        getElementById: (id) => (ids[id] ||= el('div')),
        querySelector: () => null, querySelectorAll: () => [],
      };
    },
    addEventListener: ev.addEventListener, fire: ev.fire,
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) },
  };
  for (const k of kids) e.appendChild(typeof k === 'string' ? text(k) : k);
  return e;
}
function textNodes(top, out = []) {
  for (const c of top.childNodes) if (c.nodeType === 3) out.push(c); else textNodes(c, out);
  return out;
}

// Load content.js on a page whose body is `body`. `sendMessage` can be changed later (a reload of the add-on), or given
// at the start with `opts.sendMessage`. `calls` counts the work the script asks of the page.
function loadPage(body, opts = {}) {
  const html = el('html', {}, [body]);
  const spoken = [], scrolls = [], onMessage = [], timers = new Map();
  const calls = { style: 0, range: 0, timer: 0 };
  let host = null, timerNo = 0;
  const win = listeners(), doc = listeners();
  const document = {
    documentElement: html, body, contentType: 'text/html', visibilityState: 'visible',
    querySelector: () => null,
    createElement: (t) => { const e = el(t); if (e.tagName === 'RA2-ROOT') host = e; return e; },
    addEventListener: doc.addEventListener,
    createTreeWalker(top, _what, filter) {
      const list = textNodes(top).filter((n) => filter.acceptNode(n) === 1);
      let i = 0;
      return { nextNode: () => list[i++] || null };
    },
    // As in Chrome: a range on text that is no longer on the page has a box of zeros.
    createRange: () => (calls.range++, {
      setStart(n) { this.node = n; }, setEnd() {},
      getBoundingClientRect() { return this.node && html.contains(this.node) ? this.node.parentElement.getBoundingClientRect() : ZERO; },
    }),
  };
  const chrome = {
    runtime: {
      sendMessage: opts.sendMessage || ((m) => { if (m.cmd === 'speak') spoken.push({ id: m.id, text: m.text }); return Promise.resolve(undefined); }),
      onMessage: { addListener: (f) => onMessage.push(f) },
    },
    storage: { sync: { get: () => new Promise(() => {}), set: async () => {} }, onChanged: { addListener() {} } },
  };
  const ctx = vm.createContext({
    document, chrome, console, location: { protocol: opts.protocol || 'https:', hostname: 'example.org' },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    MutationObserver: class { observe() {} disconnect() {} },
    Highlight: class { constructor() { this.ranges = []; } clear() { this.ranges = []; } add(r) { this.ranges.push(r); } },
    CSS: { highlights: new Map() },
    getComputedStyle: (e) => (calls.style++, { display: INLINE.has(e.tagName) ? 'inline' : 'block', overflowY: e.style.overflowY || 'visible' }),
    getSelection: () => ({ rangeCount: 0, toString: () => '' }),
    matchMedia: () => ({ matches: true }),
    setTimeout: (f) => { calls.timer++; timers.set(++timerNo, f); return timerNo; }, clearTimeout: (n) => timers.delete(n),
    addEventListener: win.addEventListener,
    scrollTo: (o) => scrolls.push(o),
    innerWidth: 1200, innerHeight: 800, scrollY: 0,
  });
  ctx.window = ctx;
  vm.runInContext(readFileSync(CONTENT_JS, 'utf8'), ctx, { filename: 'content.js' });
  const tell = (m) => onMessage.forEach((f) => f({ to: 'page', ...m }));
  const runTimers = () => {
    for (let n = 0; n < 50 && timers.size; n++) { const due = [...timers.values()]; timers.clear(); due.forEach((f) => f()); }
  };
  const last = () => spoken[spoken.length - 1];
  const button = (id) => host.shadow.getElementById(id);
  return { ctx, html, host, button, spoken, scrolls, tell, runTimers, last, win, doc, chrome, calls, timers };
}
const page = (...kids) => el('body', {}, kids);
const para = (words, top) => { const p = el('p', {}, [words]); p.rect = box(top); return p; };
const LINE = 'One two three four five six seven eight nine ten eleven twelve.';  // 12 words: start() cuts it in two pieces

// ---------- finding 2: the site replaced its content while it reads ----------
test('when the site replaces the text being read, a word move does not scroll the page', () => {
  const p = para(LINE, 100);
  const pg = loadPage(page(p));
  pg.tell({ cmd: 'readPage' });
  const id = pg.last().id;
  pg.tell({ evt: 'times', id, starts: [0, 0.2, 0.4, 0.6, 0.8] });
  p.remove(); pg.ctx.document.body.appendChild(para('New content of the site.', 100));  // the old words are now detached
  pg.scrolls.length = 0;
  pg.tell({ evt: 'tick', id, t: 0.4 });
  assert.deepEqual(pg.scrolls, [], 'the page did not move');
});

// ---------- finding 12: text that scrolls inside a box ----------
function boxPage() {
  const scroller = el('div', { class: 'content' });
  Object.assign(scroller, { rect: box(0, 800, 0, 1200), scrollHeight: 5000, clientHeight: 800 });
  scroller.style.overflowY = 'auto';
  const first = para('A first short line here.', 100);
  const far = para(LINE, 1500);  // below the bottom of the box
  scroller.appendChild(first); scroller.appendChild(far);
  return { scroller, body: page(scroller) };
}

test('Follow scrolls the box that holds the text, not the window', () => {
  const { scroller, body } = boxPage();
  const pg = loadPage(body);
  pg.tell({ cmd: 'readPage' });
  pg.tell({ evt: 'end', id: pg.last().id });  // the next sentence is below the box
  assert.equal(pg.scrolls.length, 0, 'the window did not scroll');
  assert.equal(scroller.scrolls.length, 1, 'the box scrolled');
  assert.equal(scroller.scrolls[0].top, 1500 - 0 - 800 / 2.5, 'the word comes to 40% of the box height');
});

test('the Go to the word button scrolls the box that holds the text', () => {
  const { scroller, body } = boxPage();
  const pg = loadPage(body);
  pg.tell({ cmd: 'readPage' });
  pg.win.fire('wheel');  // the owner scrolls: Follow stops
  pg.tell({ evt: 'end', id: pg.last().id });
  assert.equal(scroller.scrolls.length, 0, 'no Follow while the owner scrolls');
  assert.ok(pg.button('find').classList.contains('away'), 'the ring shows that the word is out of view');
  pg.button('find').fire('click', { stopPropagation() {} });
  assert.equal(pg.scrolls.length, 0, 'the window did not scroll');
  assert.equal(scroller.scrolls.length, 1, 'the box scrolled to the word');
  assert.ok(!pg.button('find').classList.contains('away'));
});

test('in a box, a word on screen moves nothing', () => {
  const scroller = el('div');
  Object.assign(scroller, { rect: box(0, 800, 0, 1200), scrollHeight: 5000, clientHeight: 800 });
  scroller.style.overflowY = 'auto';
  scroller.appendChild(para(LINE, 300));
  const pg = loadPage(page(scroller));
  pg.tell({ cmd: 'readPage' });
  assert.equal(pg.scrolls.length + scroller.scrolls.length, 0, 'the word is on screen: nothing scrolls');
});

// ---------- finding 11: the player on the root element ----------
test('the player is on the root element, not inside the body', () => {
  const pg = loadPage(page(para(LINE, 100)));
  assert.equal(pg.host.parentNode, pg.html, 'a transform on <body> cannot move it');
});

test('the player is put back when the site removes it', () => {
  const pg = loadPage(page(para(LINE, 100), para('A second line of made text.', 140)));
  pg.host.remove();
  pg.tell({ cmd: 'readPage' });
  assert.equal(pg.host.parentNode, pg.html);
});

// ---------- finding 13: an old tab after a reload of the add-on ----------
function reloadAddon(pg) {
  const gone = () => { throw new Error('Extension context invalidated.'); };
  pg.chrome.runtime.sendMessage = gone;
  pg.chrome.storage.sync.set = gone;
  delete pg.chrome.runtime.id;
}

test('after a reload of the add-on, scroll and hover in an old tab throw no error', async () => {
  const p = para(LINE, 100);
  const pg = loadPage(page(p));
  pg.runTimers();  // the first warm-up, while the add-on is there
  reloadAddon(pg);
  const errors = [];
  const onErr = (e) => errors.push(e);
  process.on('unhandledRejection', onErr);
  try {
    assert.doesNotThrow(() => { pg.win.fire('scroll'); pg.runTimers(); }, 'scroll stop');
    assert.doesNotThrow(() => { pg.doc.fire('mouseover', { target: p }); pg.runTimers(); }, 'hover');
    assert.doesNotThrow(() => pg.tell({ cmd: 'readPage' }), 'play');
    await new Promise((r) => setImmediate(r));
  } finally { process.off('unhandledRejection', onErr); }
  assert.deepEqual(errors, []);
});

test('after a reload of the add-on, the old player leaves the page', () => {
  const pg = loadPage(page(para(LINE, 100)));
  reloadAddon(pg);
  pg.win.fire('scroll'); pg.runTimers();
  assert.equal(pg.host.parentNode, null, 'the dead player is gone; the owner reloads the tab for a new one');
  pg.tell({ cmd: 'readPage' });
  assert.equal(pg.host.parentNode, null, 'it does not come back');
});

// ---------- finding 25: Space in a text field ----------
test('Space in a text field does not stop Follow; Space on the page does', () => {
  const field = el('input');
  const pg = loadPage(page(para(LINE, 100), para('A second made line of text.', 1500), field));
  pg.tell({ cmd: 'readPage' });
  pg.win.fire('keydown', { key: ' ', target: field });
  pg.scrolls.length = 0;
  pg.tell({ evt: 'end', id: pg.last().id });  // the first piece of the long line ends
  pg.tell({ evt: 'end', id: pg.last().id });  // the next sentence is far below
  assert.equal(pg.scrolls.length, 1, 'Follow is still on');

  const pg2 = loadPage(page(para(LINE, 100), para('A second made line of text.', 1500)));
  pg2.tell({ cmd: 'readPage' });
  pg2.win.fire('keydown', { key: ' ', target: pg2.ctx.document.body });
  pg2.tell({ evt: 'end', id: pg2.last().id });
  pg2.tell({ evt: 'end', id: pg2.last().id });
  assert.equal(pg2.scrolls.length, 0, 'Space on the page scrolls it, so Follow stops');
});

test('typing in a contenteditable box does not stop Follow', () => {
  const note = el('div'); note.isContentEditable = true;
  const pg = loadPage(page(para(LINE, 100), para('A second made line of text.', 1500), note));
  pg.tell({ cmd: 'readPage' });
  pg.win.fire('keydown', { key: 'ArrowDown', target: note });
  pg.tell({ evt: 'end', id: pg.last().id });
  pg.tell({ evt: 'end', id: pg.last().id });
  assert.equal(pg.scrolls.length, 1);
});

// ---------- finding 22: controls of 32 px or more ----------
test("the 'Listen from here' button and the speed buttons are 32 px or more", () => {
  const src = readFileSync(CONTENT_JS, 'utf8');
  const hover = /\.hover\s*\{([^}]*)\}/.exec(src)[1];
  assert.ok(Number(/width:\s*(\d+)px/.exec(hover)[1]) >= 32, 'hover width');
  assert.ok(Number(/height:\s*(\d+)px/.exec(hover)[1]) >= 32, 'hover height');
  const rates = /\.rates button\s*\{([^}]*)\}/.exec(src)[1];
  assert.ok(Number((/min-height:\s*(\d+)px/.exec(rates) || [0, 0])[1]) >= 32, 'speed buttons: min-height');
});

test("the 'Listen from here' button does not cover the paragraph", () => {
  const p = para(LINE, 300);
  const pg = loadPage(page(p));
  pg.doc.fire('mouseover', { target: p });
  const hover = pg.button('hover');
  assert.equal(hover.hidden, false);
  assert.ok(parseFloat(hover.style.left) + 32 <= p.rect.left, `left ${hover.style.left}`);
});

// ---------- review round 2 ----------
const invalidated = () => { throw new Error('Extension context invalidated.'); };

test('an add-on page whose add-on is already gone loads with no error and shows no player', () => {
  let pg;
  assert.doesNotThrow(() => { pg = loadPage(page(para(LINE, 100)), { protocol: 'chrome-extension:', sendMessage: invalidated }); });
  assert.equal(pg.host.parentNode, null);
});

test('the scrolling box is found once for each sentence, not for each word', () => {
  const scroller = el('div');
  Object.assign(scroller, { rect: box(0, 800, 0, 1200), scrollHeight: 5000, clientHeight: 800 });
  scroller.style.overflowY = 'auto';
  scroller.appendChild(para('Alpha beta gamma delta epsilon.', 100));  // 5 words: one piece
  const pg = loadPage(page(scroller));
  pg.tell({ cmd: 'readPage' });
  const id = pg.last().id;
  pg.tell({ evt: 'times', id, starts: [0, 0.2, 0.4, 0.6, 0.8] });
  const n = pg.calls.style;
  for (const t of [0.2, 0.4, 0.6, 0.8]) pg.tell({ evt: 'tick', id, t });
  assert.equal(pg.calls.style, n, 'no style read for a word move');
});

test('after the add-on is gone, scroll, hover, wheel, keys and timers do no work', () => {
  const p = para(LINE, 100);
  const pg = loadPage(page(p));
  pg.tell({ cmd: 'readPage' });
  reloadAddon(pg);
  pg.tell({ evt: 'end', id: pg.last().id });  // the next sentence: the first call to the add-on finds it gone
  pg.runTimers();
  assert.equal(pg.host.parentNode, null);
  const before = { ...pg.calls };
  pg.win.fire('scroll'); pg.win.fire('wheel'); pg.win.fire('touchmove'); pg.win.fire('keydown', { key: ' ', target: p });
  pg.doc.fire('mouseover', { target: p }); pg.doc.fire('mouseup', { target: p }); pg.doc.fire('visibilitychange');
  pg.doc.fire('contextmenu', { target: p, clientX: 10, clientY: 10 }); pg.doc.fire('click', { target: p, clientX: 10, clientY: 10 });
  pg.runTimers();
  assert.deepEqual(pg.calls, before, 'no style read, no range and no timer');
  assert.equal(pg.timers.size, 0, 'no timer waits');
});

test('a rejection "Extension context invalidated" also removes the player, with no unhandled rejection', async () => {
  const pg = loadPage(page(para(LINE, 100)));
  pg.chrome.runtime.sendMessage = () => Promise.reject(new Error('Extension context invalidated.'));
  const errors = [], onErr = (e) => errors.push(e);
  process.on('unhandledRejection', onErr);
  try {
    pg.tell({ cmd: 'readPage' });
    await new Promise((r) => setImmediate(r));
  } finally { process.off('unhandledRejection', onErr); }
  assert.deepEqual(errors, []);
  assert.equal(pg.host.parentNode, null);
});

test('a rejection "Receiving end does not exist" or "message port closed" keeps the player and the reading', async () => {
  for (const why of ['Could not establish connection. Receiving end does not exist.',
    'The message port closed before a response was received.']) {
    const pg = loadPage(page(para('First made line.', 100), para('Second made line.', 140)));
    const spoken = [];
    pg.chrome.runtime.sendMessage = (m) => { if (m.cmd === 'speak') spoken.push(m.id); return Promise.reject(new Error(why)); };
    pg.tell({ cmd: 'readPage' });
    await new Promise((r) => setImmediate(r));
    assert.equal(pg.host.parentNode, pg.html, why);
    pg.tell({ evt: 'end', id: spoken[0] });
    assert.equal(spoken.length, 2, 'the next sentence is sent: ' + why);
  }
});

// ---------- web finding 6 (content.js half, from ticket 16): a late event after 'stopped' ----------
test("after 'stopped', a late 'end' of the stopped sentence does not take the voice back", () => {
  const pg = loadPage(page(para('First made line.', 100), para('Second made line.', 140)));
  pg.tell({ cmd: 'readPage' });
  const id = pg.last().id, n = pg.spoken.length;
  pg.tell({ evt: 'stopped' });  // another tab took the voice
  pg.tell({ evt: 'end', id });  // an event of the old sentence that was already on its way
  assert.equal(pg.spoken.length, n, 'no new sentence was sent');
});

// ---------- Chrome check of 10 Nov 2026, FAIL 3: Previous and Next sentence ----------
// The reader (extension/pdf/app.js) goes to index - 1 on Previous and to index + 1 on Next. The web player does the same.
// A late event of the sentence that was skipped (its 'end', a 'tick') must not move the reading on.
const SIX = () => page(...['one', 'two', 'three', 'four', 'five', 'six'].map((n, k) => para(`Made line number ${n} here.`, 100 + k * 40)));
function readTo(pg, k) {  // read on until sentence k sounds, 3 of its 5 words said
  pg.tell({ cmd: 'readPage' });
  for (let i = 0; i < k; i++) { const id = pg.last().id; pg.tell({ evt: 'start', id }); pg.tell({ evt: 'end', id }); }
  const id = pg.last().id;
  pg.tell({ evt: 'start', id });
  pg.tell({ evt: 'times', id, starts: [0, 0.2, 0.4, 0.6, 0.8] });
  pg.tell({ evt: 'tick', id, t: 0.65, d: 1 });
  return id;
}
const press = (pg, id) => pg.button(id).fire('click', { stopPropagation() {} });
const said = (pg) => pg.last().text.match(/number (\w+)/)[1];

test('Previous goes to the sentence before (as in the reader), also after some words were said; a late end of the old sentence does not move it on', () => {
  const pg = loadPage(SIX());
  const old = readTo(pg, 3);
  assert.equal(said(pg), 'four');
  press(pg, 'back');
  assert.equal(said(pg), 'three', 'Previous: the sentence before');
  const n = pg.spoken.length;
  pg.tell({ evt: 'tick', id: old, t: 0.9, d: 1 });
  pg.tell({ evt: 'end', id: old });  // the end of the skipped sentence, already on its way
  assert.equal(pg.spoken.length, n, 'no new sentence after the late end');
  const now = pg.last().id;
  pg.tell({ evt: 'start', id: now }); pg.tell({ evt: 'end', id: now });
  assert.equal(said(pg), 'four', 'after its own end the reading goes on to the next sentence');
});

test('Next goes exactly one sentence on; a late end of the old sentence does not move it on', () => {
  const pg = loadPage(SIX());
  const old = readTo(pg, 2);
  press(pg, 'fwd');
  assert.equal(said(pg), 'four');
  const n = pg.spoken.length;
  pg.tell({ evt: 'end', id: old });
  assert.equal(pg.spoken.length, n);
  assert.equal(said(pg), 'four');
});

test('two quick presses: Next Next gives k + 2, Previous Previous gives k - 2, and the late ends move nothing', () => {
  const pg = loadPage(SIX());
  const old = readTo(pg, 1);
  const ids = [old];
  press(pg, 'fwd'); ids.push(pg.last().id);
  press(pg, 'fwd');
  assert.equal(said(pg), 'four', 'k + 2');
  const n = pg.spoken.length;
  for (const id of ids) pg.tell({ evt: 'end', id });
  assert.equal(pg.spoken.length, n, 'the ends of the skipped sentences move nothing');
  press(pg, 'back'); press(pg, 'back');
  assert.equal(said(pg), 'two', 'k - 2');
  press(pg, 'back'); press(pg, 'back');
  assert.equal(said(pg), 'one', 'Previous stops at the first sentence');
});

// Review of 10 Nov 2026: the ids of the sentences are counted by each load of the page. After a reload in the same tab
// the new page must not take a late event (for example of the Mac voice) of the old page as its own.
test('after a reload of the page, a late end of the old page does not move the new page on', () => {
  const before = loadPage(SIX());
  before.tell({ cmd: 'readPage' });
  const oldId = before.last().id;
  const after = loadPage(SIX());  // the same tab, loaded again
  after.tell({ cmd: 'readPage' });
  const n = after.spoken.length;
  after.tell({ evt: 'end', id: oldId });  // the end of the old page's first sentence comes late
  assert.equal(after.spoken.length, n, 'no new sentence on the new page');
  assert.notEqual(after.last().id, oldId, 'the two loads give different ids');
});

// Review of 10 Nov 2026, point 3: one mouse click on Next reaches the page's click listener (capture, target = the
// player root) and the button. Only the button moves the reading, and by one sentence; pointerdown and pointerup on
// the bar (the drag code) move nothing.
test('one click on Next: the page listener, the drag listeners and the button together send exactly one sentence', () => {
  const pg = loadPage(SIX());
  readTo(pg, 1);
  const n = pg.spoken.length;
  const bar = pg.button('bar');
  bar.fire('pointerdown', { button: 0, pointerId: 1, clientX: 600, clientY: 760, target: pg.button('fwd') });
  bar.fire('pointerup', { button: 0, pointerId: 1, clientX: 600, clientY: 760 });
  pg.doc.fire('click', { target: pg.host, clientX: 600, clientY: 760 });
  press(pg, 'fwd');
  assert.equal(pg.spoken.length, n + 1, 'one new sentence');
  assert.equal(said(pg), 'three');
});
