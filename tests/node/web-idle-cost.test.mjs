// Tests for the idle cost of the web-page reader (extension/content.js), ticket 15: the work and memory that the add-on
// uses on a page where the owner does not listen, and after the owner stops listening.
// content.js is loaded as it is, in a node:vm context with a fake page and a fake `chrome` (the same method as
// web-sentences.test.mjs and web-follow-player.test.mjs). This fake counts the work: listeners, timers (with a fake
// clock), observers, nodes added to the page, messages to the add-on, style reads, box reads, page scans (tree walkers)
// and reads of the text of the whole page.
// These tests cannot measure real time or memory: the Work report of ticket 15 has the steps for a check in Chrome.
// Run: node --test --test-timeout=120000 tests/node/web-idle-cost.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const CONTENT_JS = fileURLToPath(new URL('../../extension/content.js', import.meta.url));
const INLINE = new Set(['SPAN', 'A', 'B', 'I', 'EM', 'STRONG', 'CODE', 'BR', 'SUP', 'SUB', 'SMALL']);
const ZERO = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
const box = (top, height = 20, left = 100, width = 600) => ({ top, bottom: top + height, left, right: left + width, width, height });

// ---------- a fake page that counts ----------
let calls = null;  // the counters of the page being loaded (one page at a time)
function matchesOne(el, sel) {  // tag, .class, #id, [attr], [attr=v], [attr="v"], [attr*="v"]; anything else is an error
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
    if (v === null || (a[2] === '=' && v !== a[3]) || (a[2] === '*=' && !v.includes(a[3]))) return false;
  }
  return true;
}
const matches = (el, list) => list.split(',').map((s) => matchesOne(el, s)).some(Boolean);
function listeners(count) {
  const on = {};
  return {
    addEventListener(type, f) { if (count) calls.listen++; (on[type] ||= []).push(f); },
    fire(type, e = {}) { for (const f of on[type] || []) f({ type, detail: 1, stopPropagation() {}, ...e }); },
  };
}
const text = (data) => ({ nodeType: 3, nodeName: '#text', data, parentElement: null, parentNode: null, previousSibling: null });
function el(tag, attrs = {}, kids = []) {
  const ev = listeners(false), cls = new Set();
  const e = {
    nodeType: 1, tagName: tag.toUpperCase(), nodeName: tag.toUpperCase(), attrs: { ...attrs }, childNodes: [],
    parentElement: null, parentNode: null, previousSibling: null, dataset: {}, style: {}, hidden: false, rect: null,
    scrollHeight: 0, clientHeight: 0, isContentEditable: false,
    get id() { return this.attrs.id || ''; },
    get className() { return this.attrs.class || ''; },
    get innerText() { if (this.tagName === 'BODY' && calls) calls.pageText++; return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.innerText)).join('\n'); },
    getAttribute(k) { return k in this.attrs ? String(this.attrs[k]) : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    matches(s) { return matches(this, s); },
    closest(s) { for (let x = this; x; x = x.parentElement) if (matches(x, s)) return x; return null; },
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; },
    get isConnected() { let x = this; while (x.parentNode) x = x.parentNode; return x.tagName === 'HTML'; },
    appendChild(c) { if (calls) calls.added++; c.parentNode = c.parentElement = this; this.childNodes.push(c); return c; },
    removeChild(c) { this.childNodes.splice(this.childNodes.indexOf(c), 1); c.parentNode = c.parentElement = null; return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    checkVisibility() { return true; },
    getBoundingClientRect() { calls.rect++; return this.rect || box(0, 800, 0, 1200); },
    attachShadow() {
      const ids = {};
      return this.shadow = { set innerHTML(_) {}, getElementById: (id) => (ids[id] ||= el('div')), querySelector: () => null, querySelectorAll: () => [] };
    },
    addEventListener: ev.addEventListener, fire: ev.fire,
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) },
  };
  for (const k of kids) { const c = typeof k === 'string' ? text(k) : k; c.parentNode = c.parentElement = e; e.childNodes.push(c); }
  return e;
}
const all = (top, out = []) => { for (const c of top.childNodes) { out.push(c); if (c.nodeType === 1) all(c, out); } return out; };

function loadPage(body, opts = {}) {
  calls = { listen: 0, timer: 0, observer: 0, observe: 0, added: 0, sent: 0, style: 0, rect: 0, walker: 0, pageText: 0 };
  const html = el('html', {}, [body]);
  const sent = [], onMessage = [], timers = new Map(), observers = [], scrolls = [];
  let now = 0, timerNo = 0, host = null;
  const win = listeners(true), doc = listeners(true);
  const document = {
    documentElement: html, body, contentType: 'text/html', visibilityState: 'visible',
    querySelector: (s) => all(body).find((n) => n.nodeType === 1 && n.matches(s)) || null,
    createElement: (t) => { const e = el(t); if (e.tagName === 'RA2-ROOT') host = e; return e; },
    addEventListener: doc.addEventListener,
    createTreeWalker(top, _what, filter) {
      calls.walker++;
      const list = all(top).filter((n) => n.nodeType === 3 && filter.acceptNode(n) === 1);
      let i = 0;
      return { nextNode: () => list[i++] || null };
    },
    createRange: () => ({
      setStart(n) { this.node = n; }, setEnd() {},
      getBoundingClientRect() { calls.rect++; return this.node && html.contains(this.node) ? this.node.parentElement.rect || box(0) : ZERO; },
    }),
  };
  const chrome = {
    runtime: {
      id: 'made-up-add-on-id',
      sendMessage: (m) => { calls.sent++; sent.push(m); return Promise.resolve(opts.answer ? opts.answer(m) : undefined); },
      onMessage: { addListener: (f) => onMessage.push(f) },
    },
    storage: { sync: { get: async () => (opts.settings ? { ra2: opts.settings } : {}), set: async () => {} }, onChanged: { addListener() {} } },
  };
  class MutationObserver {
    constructor(f) { calls.observer++; this.f = f; this.on = []; observers.push(this); }
    observe(target, o) { calls.observe++; this.on.push({ target, subtree: !!o.subtree }); }
    disconnect() { this.on = []; }
  }
  const ctx = vm.createContext({
    document, chrome, console, location: { protocol: 'https:', hostname: 'example.org' },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    MutationObserver,
    Highlight: class { clear() {} add() {} },
    CSS: { highlights: new Map() },
    getComputedStyle: (e) => (calls.style++, { display: INLINE.has(e.tagName) ? 'inline' : 'block', overflowY: 'visible' }),
    getSelection: () => ({ rangeCount: 0, toString: () => '' }),
    matchMedia: () => ({ matches: true }),
    setTimeout: (f, ms = 0) => { calls.timer++; timers.set(++timerNo, { due: now + ms, f }); return timerNo; },
    clearTimeout: (n) => timers.delete(n),
    addEventListener: win.addEventListener,
    scrollTo: (o) => scrolls.push(o),
    innerWidth: 1200, innerHeight: 800, scrollY: 0,
  });
  ctx.window = ctx;
  vm.runInContext(readFileSync(CONTENT_JS, 'utf8'), ctx, { filename: 'content.js' });
  const wait = (ms) => {  // the fake clock moves on by ms; each timer runs at its time
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      timers.delete(next[0]); now = Math.max(now, next[1].due); next[1].f();
    }
    now = end;
  };
  // the site changes a node (or the list of children of a node): each observer that watches it is told
  const mutate = (node) => observers.filter((o) => o.on.some((w) => (w.subtree ? w.target.contains(node) : w.target === node)))
    .forEach((o) => o.f([{ target: node }], o));
  const tell = (m) => onMessage.forEach((f) => f({ to: 'page', ...m }));
  const button = (id) => host.shadow.getElementById(id);
  const watching = () => observers.flatMap((o) => o.on.filter((w) => w.subtree).map((w) => w.target));  // the boxes watched with their content
  return { ctx, html, body, host, button, sent, tell, wait, mutate, win, doc, timers, watching, scrolls };
}
const page = (...kids) => el('body', {}, kids);
const para = (words, top) => { const p = el('p', {}, [words]); p.rect = box(top); return p; };
const LINE = 'One two three four five six seven eight nine ten eleven twelve.';
const flush = () => new Promise((r) => setImmediate(r));
const snap = () => ({ ...calls });
const diff = (a) => Object.fromEntries(Object.keys(calls).map((k) => [k, calls[k] - a[k]]));
const IDLE = { listen: 0, timer: 0, observer: 0, observe: 0, added: 0, sent: 0, style: 0, rect: 0, walker: 0, pageText: 0 };

// A news page with a clock that ticks each second, and 40 paragraphs.
function clockPage() {
  const clock = el('span', {}, ['10:00:00']);
  const paras = Array.from({ length: 40 }, (_, i) => para(`Made sentence number ${i} of this test page. It has a second sentence.`, 100 + i * 60));
  return { clock, paras, body: page(el('div', { class: 'top' }, [clock]), ...paras) };
}
// 30 seconds on the page: the clock ticks each second, the owner scrolls every 3 seconds and moves the mouse over text
function idle30s(pg, clock, paras) {
  for (let s = 1; s <= 30; s++) {
    clock.childNodes[0].data = `10:00:${String(s).padStart(2, '0')}`;
    pg.mutate(clock.childNodes[0]);
    if (s % 3 === 0) pg.win.fire('scroll');
    if (s % 5 === 0) pg.doc.fire('mouseover', { target: paras[s] });
    pg.wait(1000);
  }
}

// ---------- findings 3 and 4: the page scan and the voice warm-up before the owner listens ----------
test('a page with a ticking clock: no page scan and no message to the add-on in 30 seconds', async () => {
  const { clock, paras, body } = clockPage();
  const pg = loadPage(body);
  await flush();
  idle30s(pg, clock, paras);
  assert.equal(calls.walker, 0, 'page scans');
  assert.deepEqual(pg.sent, [], 'messages to the add-on (and so to the voice server)');
  assert.equal(calls.style, 0, 'style reads');
});

test('on load: no timer, no observer, one node (the player), at most 9 page listeners, the Listen button shows', async () => {
  const { body } = clockPage();
  const pg = loadPage(body);
  await flush();
  assert.equal(calls.timer, 0, 'timers');
  assert.equal(calls.observer, 0, 'observers');
  assert.equal(calls.added, 1, 'nodes added to the page: the player root');
  assert.ok(calls.listen <= 9, `page and window listeners: ${calls.listen}`);
  assert.equal(pg.button('launch').hidden, false, 'the Listen button shows');
});

test('a page with 5,000 paragraphs: the load does not read the page', async () => {
  const paras = Array.from({ length: 5000 }, (_, i) => para(`Paragraph ${i} of a long made page. It goes on here.`, 100 + i * 40));
  const pg = loadPage(page(...paras));
  assert.equal(calls.added, 1, 'nodes added at load: the player root');
  assert.ok(calls.listen <= 9, `page and window listeners at load: ${calls.listen}`);
  const a = snap();
  await flush();
  pg.wait(5000);
  const d = diff(a);
  for (const k of Object.keys(IDLE)) assert.equal(d[k], 0, `${k} in the 5 s after load`);
});

test('a scroll event costs no style read, no box read and no timer', async () => {
  const { body } = clockPage();
  const pg = loadPage(body);
  await flush(); pg.wait(5000);
  const a = snap();
  pg.win.fire('scroll');
  pg.wait(2000);  // and the scroll stop
  assert.deepEqual(diff(a), IDLE);
});

test('the mouse over a paragraph: one box read, no style read, no timer, no message; again on the same paragraph: nothing', async () => {
  const { paras, body } = clockPage();
  const pg = loadPage(body);
  await flush();
  let a = snap();
  pg.doc.fire('mouseover', { target: paras[3] });
  pg.wait(1000);
  assert.deepEqual(diff(a), { ...IDLE, rect: 1 });
  assert.equal(pg.button('hover').hidden, false, "the 'Listen from here' button shows");
  a = snap();
  pg.doc.fire('mouseover', { target: paras[3] });  // the mouse moves on to a word inside the same paragraph
  pg.wait(1000);
  assert.deepEqual(diff(a), IDLE);
});

// ---------- the owner shows that he wants to listen ----------
test("the pointer on 'Listen from here' prepares its sentence; the click then sends it at once, with no new scan", async () => {
  const { paras, body } = clockPage();
  const pg = loadPage(body);
  await flush();
  pg.doc.fire('mouseover', { target: paras[3] });
  pg.wait(1000);
  assert.deepEqual(pg.sent, [], 'no request yet');
  pg.button('hover').fire('mouseenter');
  assert.equal(pg.sent.length, 1);
  assert.equal(pg.sent[0].cmd, 'warm');
  assert.equal(pg.sent[0].texts[0], 'Made sentence number 3');
  const a = snap();
  pg.button('hover').fire('click');
  assert.equal(calls.walker - a.walker, 0, 'no page scan at the click');
  assert.equal(pg.sent.at(-1).cmd, 'speak', 'the sentence goes to the voice in the same moment');
  assert.equal(pg.sent.at(-1).text, 'Made sentence number 3');
});

test('the pointer on the Listen button prepares the first sentence on screen; the click sends it with no new scan', async () => {
  const { body } = clockPage();
  const pg = loadPage(body);
  await flush();
  pg.button('launch').fire('mouseenter');
  assert.equal(pg.sent.length, 1);
  assert.equal(pg.sent[0].cmd, 'warm');
  const a = snap();
  pg.button('launch').fire('click');
  assert.equal(calls.walker - a.walker, 0);
  assert.equal(pg.sent.at(-1).cmd, 'speak');
  assert.equal(pg.sent.at(-1).text, 'Made sentence number 0');
});

// ---------- finding 16: the text of the whole page to find the language ----------
test('a warm-up does not read the text of the whole page', async () => {
  const { paras, body } = clockPage();
  const pg = loadPage(body);
  await flush();
  pg.doc.fire('mouseover', { target: paras[3] });
  pg.button('hover').fire('mouseenter');
  pg.wait(1000);
  assert.equal(calls.pageText, 0, 'reads of document.body.innerText');
  assert.equal(pg.sent.length, 1);
});

test('the voice of a warm-up follows the sentence, not the top of the page', async () => {
  const intro = para('An English heading line that is long enough to fill the start of the page with text. '.repeat(6), 50);
  const ru = para('Это русское предложение для проверки голоса.', 600);
  const pg = loadPage(page(intro, ru));
  await flush();
  pg.doc.fire('mouseover', { target: ru });
  pg.button('hover').fire('mouseenter');
  assert.deepEqual(pg.sent, [], 'a Russian sentence is read by the Mac voice: no natural warm-up');

  const ruTop = para('Это русское предложение в начале страницы, и оно довольно длинное. '.repeat(8), 50);
  const en = para('An English paragraph further down the page.', 600);
  const pg2 = loadPage(page(ruTop, en));
  await flush();
  pg2.doc.fire('mouseover', { target: en });
  pg2.button('hover').fire('mouseenter');
  assert.equal(pg2.sent.length, 1, 'an English sentence gets its warm-up, even on a page that starts in Russian');
  assert.equal(pg2.sent[0].texts[0], 'An English paragraph further down the page.');
});

// ---------- the observer: only while sentences are kept, only inside the read area ----------
test('the page is watched only while sentences are kept, and only inside the article', async () => {
  const clock = el('span', {}, ['10:00:00']);
  const article = el('article', {}, Array.from({ length: 12 }, (_, i) => para(`Made article sentence ${i}. It is part of the text here.`, 100 + i * 60)));
  const pg = loadPage(page(el('header', {}, [clock]), article));
  await flush();
  assert.deepEqual(pg.watching(), [], 'nothing is watched before a listen action');
  pg.button('launch').fire('mouseenter');
  assert.deepEqual(pg.watching(), [article], 'the article is watched, not the whole page');
  const scans = calls.walker;
  pg.mutate(clock.childNodes[0]);
  pg.button('launch').fire('click');
  assert.equal(calls.walker, scans, 'a change outside the article keeps the sentences');
  pg.mutate(article.childNodes[5].childNodes[0]);
  assert.deepEqual(pg.watching(), [], 'a change in the article drops the sentences and stops the watch');
});

test('after listening stops, the cost goes back to the idle level', async () => {
  const { clock, paras, body } = clockPage();
  const pg = loadPage(body);
  await flush();
  pg.button('launch').fire('mouseenter');
  pg.button('launch').fire('click');
  const id = pg.sent.at(-1).id;
  pg.tell({ evt: 'end', id });
  pg.button('close').fire('click');
  assert.deepEqual(pg.watching(), [], 'no watch after stop');
  assert.equal(pg.timers.size, 0, 'no timer waits, directly after stop');
  const a = snap(); const n = pg.sent.length;
  idle30s(pg, clock, paras);
  assert.equal(calls.walker - a.walker, 0, 'page scans');
  assert.equal(calls.style - a.style, 0, 'style reads');
  assert.equal(pg.sent.length - n, 0, 'messages');
  assert.equal(pg.timers.size, 0, 'no timer waits');

  // the same after the end of the text
  const pg2 = loadPage(page(para('A single made sentence.', 100)));
  await flush();
  pg2.button('launch').fire('mouseenter'); pg2.button('launch').fire('click');
  pg2.tell({ evt: 'end', id: pg2.sent.at(-1).id });
  assert.deepEqual(pg2.watching(), [], 'no watch after the end of the text');
});

test('a mouse click with no selection sends nothing and leaves no timer', async () => {
  const { paras, body } = clockPage();
  const pg = loadPage(body);
  await flush();
  pg.doc.fire('mouseup', { target: paras[2] });
  pg.wait(100);
  assert.deepEqual(pg.sent, [], 'a click with no selection sends nothing');
  assert.equal(pg.timers.size, 0);
});

// ---------- review round 1 ----------
// A page with no article: the read area is the body, with a clock in it.
function bodyPage() {
  const clock = el('span', {}, ['10:00:00']);
  const paras = Array.from({ length: 30 }, (_, i) => para(`Made line ${i} of the body page. It has a second sentence.`, 100 + i * 60));
  return { clock, paras, body: page(el('div', {}, [clock]), ...paras) };
}

test('the site removes the read area itself: the kept sentences are dropped and the watch stops', async () => {
  const article = el('article', {}, Array.from({ length: 12 }, (_, i) => para(`Made article sentence ${i}. It is part of the text here.`, 100 + i * 60)));
  const main = el('div', { class: 'app' }, [article]);
  const pg = loadPage(page(main));
  await flush();
  pg.button('launch').fire('mouseenter');
  assert.deepEqual(pg.watching(), [article]);
  article.remove(); pg.mutate(main);  // a single-page app replaces the article: the change is on its parent
  assert.deepEqual(pg.watching(), [], 'no watch on a removed article');
  const next = el('article', {}, Array.from({ length: 12 }, (_, i) => para(`New article sentence ${i}. It is the new text here.`, 100 + i * 60)));
  main.appendChild(next);
  pg.button('launch').fire('click');
  assert.match(pg.sent.at(-1).text, /^New article sentence 0/, 'play reads the new article');
});

test('changes of the player itself never drop the kept sentences', async () => {
  const { body } = bodyPage();
  const pg = loadPage(body);
  await flush();
  pg.button('launch').fire('mouseenter');
  pg.mutate(pg.host); pg.mutate(pg.button('bar'));
  assert.deepEqual(pg.watching(), [body], 'the watch goes on');
  const scans = calls.walker;
  pg.button('launch').fire('click');
  assert.equal(calls.walker, scans, 'no new scan at play');
});

test('listening on a page with no article and a ticking clock: one release, no scan, the reading goes on', async () => {
  const { clock, body } = bodyPage();
  const pg = loadPage(body);
  await flush();
  pg.button('launch').fire('mouseenter'); pg.button('launch').fire('click');
  const a = snap(); const n = pg.sent.length;
  for (let s = 1; s <= 30; s++) { clock.childNodes[0].data = `10:00:${s}`; pg.mutate(clock.childNodes[0]); pg.wait(1000); }
  const d = diff(a);
  assert.equal(d.walker, 0, 'no scan in 30 s');
  assert.equal(d.style, 0, 'no style read in 30 s');
  assert.equal(d.timer, 0, 'no timer in 30 s');
  assert.equal(pg.sent.length, n, 'no message in 30 s');
  assert.deepEqual(pg.watching(), [], 'the first tick released the sentences; later ticks cost nothing');
  pg.tell({ evt: 'end', id: pg.sent.at(-1).id });
  assert.equal(pg.sent.at(-1).cmd, 'speak', 'the reading goes on');
});

test('Listen pressed, a clock outside the article ticks for 30 s: no scan, the sentences stay; changes inside: one release', async () => {
  const clock = el('span', {}, ['10:00:00']);
  const article = el('article', {}, Array.from({ length: 12 }, (_, i) => para(`Made article sentence ${i}. It is part of the text here.`, 100 + i * 60)));
  const pg = loadPage(page(el('header', {}, [clock]), article));
  await flush();
  pg.button('launch').fire('mouseenter'); pg.button('launch').fire('click');
  const a = snap();
  for (let s = 1; s <= 30; s++) { clock.childNodes[0].data = `10:00:${s}`; pg.mutate(clock.childNodes[0]); pg.wait(1000); }
  assert.equal(diff(a).walker, 0, 'no scan');
  assert.deepEqual(pg.watching(), [article], 'the sentences stay');
  let releases = 0;
  for (let i = 0; i < 5; i++) { if (pg.watching().length) releases++; pg.mutate(article.childNodes[i].childNodes[0]); }
  assert.equal(releases, 1, 'one release for five changes');
  assert.equal(diff(a).walker, 0, 'and no scan: the next scan waits for the next listen sign');
});

test('Stop after a voice server error: no timer waits, and no message comes later', async () => {
  const { body } = clockPage();
  const pg = loadPage(body);
  await flush();
  pg.button('launch').fire('mouseenter'); pg.button('launch').fire('click');
  pg.tell({ evt: 'error', id: pg.sent.at(-1).id, why: 'no server' });  // the Mac voice reads; a retry of the natural voice waits
  pg.button('close').fire('click');
  assert.equal(pg.timers.size, 0, 'no timer waits after stop');
  const n = pg.sent.length;
  assert.doesNotThrow(() => pg.wait(60000));
  assert.equal(pg.sent.length, n, 'no message');
  pg.button('launch').fire('mouseenter');
  assert.equal(pg.sent.at(-1).cmd, 'warm', 'the next listen tries the natural voice again');
});

test('after a scan, Follow and "Listen from here" still work', async () => {
  const paras = Array.from({ length: 30 }, (_, i) => para(`Made line ${i} of the page. It has a second sentence.`, 100 + i * 60));
  const pg = loadPage(page(...paras));
  await flush();
  pg.doc.fire('mouseover', { target: paras[20] });
  pg.button('hover').fire('mouseenter'); pg.button('hover').fire('click');
  assert.match(pg.sent.at(-1).text, /^Made line 20/);
  for (let i = 0; i < 2; i++) pg.tell({ evt: 'end', id: pg.sent.at(-1).id });
  assert.match(pg.sent.at(-1).text, /^Made line 21/);
  assert.ok(pg.scrolls.length > 0, 'Follow scrolls to a line below the window');
  pg.button('close').fire('click');
  pg.doc.fire('mouseover', { target: paras[5] });
  pg.button('hover').fire('mouseenter'); pg.button('hover').fire('click');
  assert.match(pg.sent.at(-1).text, /^Made line 5/, 'a second "Listen from here" after Stop');
});

test('the default voice on an English page warms the natural voice; a Mac voice setting sends no warm-up', async () => {
  const { body } = clockPage();
  const pg = loadPage(body);
  await flush();
  pg.button('launch').fire('mouseenter');
  assert.equal(pg.sent.at(-1).cmd, 'warm');
  assert.equal(pg.sent.at(-1).voice, 'af_heart');
  const pg2 = loadPage(clockPage().body, { settings: { voice: 'system:Samantha' } });
  await flush();
  pg2.button('launch').fire('mouseenter');
  assert.deepEqual(pg2.sent, []);
});
