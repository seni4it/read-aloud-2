// Tests for ticket 26 (web-page player leftovers) in extension/content.js and extension/content.css:
// 1. the first Sentence of a web reading is one Sentence for the owner (shade, count, Previous, Next), also when the
//    voice gets it in two pieces for a fast start;
// 2. Follow moves the nearest scrolling box around the text, also a box in a shadow root, a box that a <slot> puts the
//    text in, and each box of nested scrolling boxes;
// 3. the Word highlight and its Sentence shade in content.css use the design tokens, with the token values as fallback.
// content.js is loaded as it is, in a node:vm context with a small fake page and a fake `chrome` (the method of
// web-follow-player.test.mjs). These tests cannot prove the real scroll or the colours on a real site: the Work report
// of ticket 26 has the steps for a check in Chrome.
// Run: node --test --test-timeout=120000 tests/node/web-player-leftovers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const CONTENT_JS = fileURLToPath(new URL('../../extension/content.js', import.meta.url));
const CONTENT_CSS = fileURLToPath(new URL('../../extension/content.css', import.meta.url));
const TOKENS_CSS = fileURLToPath(new URL('../../extension/pdf/tokens.css', import.meta.url));
const INLINE = new Set(['SPAN', 'A', 'B', 'I', 'EM', 'STRONG', 'CODE', 'BR', 'SUP', 'SUB', 'SMALL', 'SLOT']);
const ZERO = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
const box = (top, height = 20, left = 100, width = 600) => ({ top, bottom: top + height, left, right: left + width, width, height });

// ---------- a small fake page ----------
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
// A shadow root of the page (not the closed root of the player): its children have no parentElement, and
// getRootNode() of each node inside gives this root, whose `host` is the element that holds it.
function shadowOf(host) { return { nodeType: 11, host, childNodes: [], appendChild(c) { c.parentNode = this; c.parentElement = null; this.childNodes.push(c); return c; } }; }
function el(tag, attrs = {}, kids = []) {
  const ev = listeners(), cls = new Set();
  const e = {
    nodeType: 1, tagName: tag.toUpperCase(), nodeName: tag.toUpperCase(), attrs: { ...attrs }, childNodes: [],
    parentElement: null, parentNode: null, dataset: {}, style: {}, hidden: false, rect: null, assignedSlot: null,
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
    getRootNode() { let x = this; while (x.parentNode) x = x.parentNode; return x; },
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
const onPage = (html, n) => { for (let x = n; x; x = x.parentNode || x.host) if (x === html) return true; return false; };

function loadPage(body, opts = {}) {
  const html = el('html', {}, [body]);
  const spoken = [], sent = [], scrolls = [], onMessage = [];
  const calls = { style: 0 };
  let host = null;
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
    createRange: () => ({
      setStart(n, o) { this.start = [n, o]; }, setEnd(n, o) { this.end = [n, o]; },
      getBoundingClientRect() { const n = this.start && this.start[0]; return n && onPage(html, n) ? n.parentElement.getBoundingClientRect() : ZERO; },
    }),
  };
  const chrome = {
    runtime: {
      id: 'test',
      sendMessage: (m) => { sent.push(m); if (m.cmd === 'speak') spoken.push({ id: m.id, text: m.text }); return Promise.resolve(undefined); },
      onMessage: { addListener: (f) => onMessage.push(f) },
    },
    storage: { sync: { get: () => (opts.voice ? Promise.resolve({ ra2: { voice: opts.voice } }) : new Promise(() => {})), set: async () => {} }, local: { get: () => new Promise(() => {}), set: async () => {} }, onChanged: { addListener() {} } },
  };
  const ctx = vm.createContext({
    document, chrome, console, location: { protocol: 'https:', hostname: 'example.org' },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    MutationObserver: class { observe() {} disconnect() {} },
    Highlight: class { constructor() { this.ranges = []; } clear() { this.ranges = []; } add(r) { this.ranges.push(r); } },
    CSS: { highlights: new Map() },
    getComputedStyle: (e) => (calls.style++, { display: INLINE.has(e.tagName) ? 'inline' : 'block', overflowY: e.style.overflowY || 'visible' }),
    getSelection: () => opts.selection || ({ rangeCount: 0, toString: () => '' }),
    matchMedia: () => ({ matches: true }),
    setTimeout: () => 0, clearTimeout() {},
    addEventListener: win.addEventListener, removeEventListener() {},
    scrollTo: (o) => scrolls.push(o),
    innerWidth: 1200, innerHeight: 800, scrollY: 0,
  });
  ctx.window = ctx;
  vm.runInContext(readFileSync(CONTENT_JS, 'utf8'), ctx, { filename: 'content.js' });
  const tell = (m) => onMessage.forEach((f) => f({ to: 'page', ...m }));
  const last = () => spoken[spoken.length - 1];
  const button = (id) => host.shadow.getElementById(id);
  // the text that the sentence shade covers now (block text offsets are in one text node in these pages)
  const shade = () => {
    const r = ctx.CSS.highlights.get('ra2-sentence').ranges[0];
    if (!r) return null;
    const [a, ao] = r.start, [b, bo] = r.end;
    if (a === b) return a.data.slice(ao, bo);
    const all = textNodes(body);
    return a.data.slice(ao) + all.slice(all.indexOf(a) + 1, all.indexOf(b)).map((n) => n.data).join('') + b.data.slice(0, bo);
  };
  return { ctx, html, host, button, spoken, sent, scrolls, tell, last, shade, calls };
}
const page = (...kids) => el('body', {}, kids);
const para = (words, top) => { const p = el('p', {}, [words]); p.rect = box(top); return p; };
const press = (pg, id) => pg.button(id).fire('click', { stopPropagation() {} });
const end = (pg) => { const id = pg.last().id; pg.tell({ evt: 'start', id }); pg.tell({ evt: 'end', id }); };

// ---------- fault 1: the first Sentence of a web reading ----------
// The Chrome check of 10 Nov 2026 saw the first Sentence of a page as short pieces: start() gives the voice the first
// 4 or so words of the first Sentence alone, so that the voice starts at once (and the next Sentence too, after a short
// title). The voice may keep the pieces. The owner must see one Sentence: one shade, one count, Previous and Next.
const LONG1 = 'The first long sentence of this made page has twelve words in it.';
const LONG2 = 'The second long sentence of this made page also has many words.';
const SHORT3 = 'A short third one.';
const article = () => page(para(LONG1, 100), para(LONG2, 140), para(SHORT3, 180));

test('the voice still gets the first Sentence in two pieces, for a fast start', () => {
  const pg = loadPage(article());
  pg.tell({ cmd: 'readPage' });
  end(pg);
  assert.deepEqual(pg.spoken.map((s) => s.text), ['The first long sentence', 'of this made page has twelve words in it.']);
});

test('the shade covers the whole first Sentence while each of its pieces is read', () => {
  const pg = loadPage(article());
  pg.tell({ cmd: 'readPage' });
  assert.equal(pg.shade().trim(), LONG1, 'first piece');
  end(pg);
  assert.equal(pg.shade().trim(), LONG1, 'second piece');
  end(pg);
  assert.equal(pg.shade().trim(), LONG2);
});

test('the count shows Sentences, not pieces: 1 / 3 for both pieces of the first Sentence', () => {
  const pg = loadPage(article());
  pg.tell({ cmd: 'readPage' });
  assert.equal(pg.button('count').textContent, '1 / 3');
  end(pg);
  assert.equal(pg.button('count').textContent, '1 / 3');
  end(pg);
  assert.equal(pg.button('count').textContent, '2 / 3');
});

test('Previous during the second Sentence goes to the start of the first Sentence, not to its last piece', () => {
  const pg = loadPage(article());
  pg.tell({ cmd: 'readPage' });
  end(pg); end(pg);
  assert.equal(pg.last().text, LONG2);
  press(pg, 'back');
  assert.equal(pg.last().text, 'The first long sentence');
  assert.equal(pg.shade().trim(), LONG1);
});

test('Previous in the second piece of the first Sentence starts that Sentence again', () => {
  const pg = loadPage(article());
  pg.tell({ cmd: 'readPage' });
  end(pg);
  press(pg, 'back');
  assert.equal(pg.last().text, 'The first long sentence');
});

test('Next in the first piece goes to the next Sentence, not to the second piece', () => {
  const pg = loadPage(article());
  pg.tell({ cmd: 'readPage' });
  press(pg, 'fwd');
  assert.equal(pg.last().text, LONG2);
  assert.equal(pg.button('count').textContent, '2 / 3');
});

test('after a short title, the next Sentence is in pieces for the voice, and one Sentence for the owner', () => {
  const pg = loadPage(page(el('h1', {}, ['Made title']), para(LONG1, 140), para(SHORT3, 180)));
  pg.tell({ cmd: 'readPage' });
  assert.equal(pg.last().text, 'Made title');
  end(pg);
  assert.equal(pg.last().text, 'The first long sentence');
  assert.equal(pg.shade().trim(), LONG1);
  assert.equal(pg.button('count').textContent, '2 / 3');
  end(pg);
  assert.equal(pg.shade().trim(), LONG1);
  assert.equal(pg.button('count').textContent, '2 / 3');
  press(pg, 'fwd');
  assert.equal(pg.last().text, SHORT3);
  press(pg, 'back');
  assert.equal(pg.last().text, 'The first long sentence');
});

test('pause in the first piece, then resume with the Mac voice: only the rest of that piece is said; one shade, count 1 / 3', async () => {
  const pg = loadPage(article(), { voice: 'system:Samantha' });
  await new Promise((r) => setImmediate(r));  // the saved settings are read
  pg.tell({ cmd: 'readPage' });
  assert.equal(pg.last().text, 'The first long sentence');
  pg.tell({ evt: 'word', id: pg.last().id, char: 10 });  // the voice reached "long"
  press(pg, 'pp');  // pause
  press(pg, 'pp');  // resume: the Mac voice says it again from the word reached
  assert.equal(pg.last().text, 'long sentence', 'only the rest of the first piece');
  assert.equal(pg.shade().trim(), LONG1);
  assert.equal(pg.button('count').textContent, '1 / 3');
  end(pg);
  assert.equal(pg.last().text, 'of this made page has twelve words in it.', 'then the second piece');
  assert.equal(pg.button('count').textContent, '1 / 3');
});

test('pause in the first piece, then resume with the natural voice: the voice goes on, nothing new is said; one shade, count 1 / 3', () => {
  const pg = loadPage(article());
  pg.tell({ cmd: 'readPage' });
  const id = pg.last().id, n = pg.spoken.length;
  press(pg, 'pp'); press(pg, 'pp');
  assert.equal(pg.spoken.length, n, 'no new text');
  assert.deepEqual(pg.sent.slice(-2).map((m) => m.cmd), ['pause', 'resume']);
  assert.equal(pg.sent[pg.sent.length - 1].id, id, 'the same piece goes on');
  assert.equal(pg.shade().trim(), LONG1);
  assert.equal(pg.button('count').textContent, '1 / 3');
});

// ---------- fault 2: Follow in a shadow root and in nested scrolling boxes ----------
function scrollBox(rect, scrollHeight = 5000, scrollTop = 0) {
  const b = el('div');
  Object.assign(b, { rect, scrollHeight, clientHeight: rect.height, scrollTop });
  b.style.overflowY = 'auto';
  return b;
}

test('text in a shadow root: Follow scrolls the scrolling box in the shadow root, not the window', () => {
  const hostEl = el('div', { class: 'widget' });
  const root = hostEl.shadowRoot = shadowOf(hostEl);
  const sb = scrollBox(box(0, 800, 0, 1200));
  root.appendChild(sb);
  const first = para('A first short line here.', 100), far = para('A far line in the box.', 1500);
  sb.appendChild(first); sb.appendChild(far);
  const body = page(hostEl);
  // the owner selects the text in the shadow root and asks to listen (the context menu)
  const t1 = first.childNodes[0], t2 = far.childNodes[0];
  const range = { startContainer: t1, startOffset: 0, endContainer: t2, endOffset: t2.data.length,
    commonAncestorContainer: { parentElement: sb }, intersectsNode: (n) => n === t1 || n === t2 };
  const selection = { rangeCount: 1, getRangeAt: () => range, toString: () => t1.data + t2.data };
  const pg = loadPage(body, { selection });
  pg.tell({ cmd: 'readSelection' });
  assert.equal(pg.last().text, 'A first short line here.');
  end(pg);
  assert.equal(pg.last().text, 'A far line in the box.');
  assert.equal(pg.scrolls.length, 0, 'the window did not scroll');
  assert.equal(sb.scrolls.length, 1, 'the box in the shadow root scrolled');
  assert.equal(sb.scrolls[0].top, 1500 - 0 - 800 / 2.5);
});

test('text in a shadow root of a part of the page that sits in a scrolling box of the page: Follow scrolls that box', () => {
  const sb = scrollBox(box(0, 800, 0, 1200));
  const hostEl = el('div', { class: 'card' });
  const root = hostEl.shadowRoot = shadowOf(hostEl);
  const inner = el('div');
  root.appendChild(inner);
  const first = para('A first short line here.', 100), far = para('A far line in the card.', 1500);
  inner.appendChild(first); inner.appendChild(far);
  sb.appendChild(hostEl);
  const t1 = first.childNodes[0], t2 = far.childNodes[0];
  const range = { startContainer: t1, startOffset: 0, endContainer: t2, endOffset: t2.data.length,
    commonAncestorContainer: { parentElement: inner }, intersectsNode: (n) => n === t1 || n === t2 };
  const selection = { rangeCount: 1, getRangeAt: () => range, toString: () => t1.data + t2.data };
  const pg = loadPage(page(sb), { selection });
  pg.tell({ cmd: 'readSelection' });
  end(pg);
  assert.equal(pg.last().text, 'A far line in the card.');
  assert.equal(pg.scrolls.length, 0, 'the window did not scroll');
  assert.equal(sb.scrolls.length, 1, 'the box around the shadow host scrolled');
});

test('a scrolling box in a shadow root that holds the page text in a <slot>: Follow scrolls that box', () => {
  const hostEl = el('div', { class: 'reader-box' });
  const root = hostEl.shadowRoot = shadowOf(hostEl);
  const sb = scrollBox(box(0, 800, 0, 1200));
  const slot = el('slot');
  root.appendChild(sb); sb.appendChild(slot);
  const first = para('A first short line here.', 100), far = para('A far line in the box.', 1500);
  hostEl.appendChild(first); hostEl.appendChild(far);  // light DOM children of the host, shown in the slot
  first.assignedSlot = slot; far.assignedSlot = slot;
  const pg = loadPage(page(hostEl));
  pg.tell({ cmd: 'readPage' });
  end(pg);
  assert.equal(pg.last().text, 'A far line in the box.');
  assert.equal(pg.scrolls.length, 0, 'the window did not scroll');
  assert.equal(sb.scrolls.length, 1, 'the box of the slot scrolled');
});

test('nested scrolling boxes: the inner box shows the word, and the outer box brings the inner box into view', () => {
  const outer = scrollBox(box(0, 800, 0, 1200));
  const inner = scrollBox(box(1200, 400, 0, 1200), 3000);  // below the view of the outer box
  outer.appendChild(para('A first short line here.', 100));
  outer.appendChild(inner);
  inner.appendChild(para('A line inside the inner box.', 1300));  // inside the view of the inner box
  const pg = loadPage(page(outer));
  pg.tell({ cmd: 'readPage' });
  end(pg);
  assert.equal(pg.last().text, 'A line inside the inner box.');
  assert.equal(inner.scrolls.length, 0, 'the word is in the view of the inner box: it does not move');
  assert.equal(outer.scrolls.length, 1, 'the outer box scrolled');
  assert.equal(outer.scrolls[0].top, 1300 - 0 - 800 / 2.5, 'the word comes to 40% of the outer box');
  assert.equal(pg.scrolls.length, 0, 'the window did not scroll');
});

test('nested scrolling boxes: a word out of the inner box moves the inner box, then the outer box', () => {
  const outer = scrollBox(box(0, 800, 0, 1200));
  const inner = scrollBox(box(1200, 400, 0, 1200), 3000);
  outer.appendChild(para('A first short line here.', 100));
  outer.appendChild(inner);
  inner.appendChild(para('A line far down in the inner box.', 2000));
  const pg = loadPage(page(outer));
  pg.tell({ cmd: 'readPage' });
  end(pg);
  assert.equal(inner.scrolls.length, 1);
  const d1 = 2000 - 1200 - 400 / 2.5;
  assert.equal(inner.scrolls[0].top, d1, 'the word comes to 40% of the inner box');
  assert.equal(outer.scrolls.length, 1);
  assert.equal(outer.scrolls[0].top, 2000 - d1 - 800 / 2.5, 'then to 40% of the outer box');
  assert.equal(pg.scrolls.length, 0);
});

test('a scrolling box below the window: the box shows the word, then the window shows the box', () => {
  const sb = scrollBox(box(1000, 400, 0, 1200));
  sb.appendChild(para('A line in a box under the fold.', 1100));
  const pg = loadPage(page(para('A first short line here.', 100), sb));
  pg.tell({ cmd: 'readPage' });
  end(pg);
  assert.equal(sb.scrolls.length, 0, 'the word is in the view of the box');
  assert.equal(pg.scrolls.length, 1, 'the window scrolled');
  assert.equal(pg.scrolls[0].top, 1100 - 800 / 2.5);
});

test('a box at its scroll limit moves only what it can; the window then brings the word into view', () => {
  const sb = scrollBox(box(0, 800, 0, 1200), 1000, 0);  // it can move 200 px down, no more
  sb.appendChild(para('A first short line here.', 100));
  sb.appendChild(para('A line near the end of the box.', 900));
  const pg = loadPage(page(sb));
  pg.tell({ cmd: 'readPage' });
  end(pg);
  assert.equal(sb.scrolls.length, 1);
  assert.equal(sb.scrolls[0].top, 200, 'the box moves to its end, not 580 px');
  assert.equal(pg.scrolls.length, 1, 'the word is then at 700 px, under the player: the window moves');
  assert.equal(pg.scrolls[0].top, 700 - 800 / 2.5);
});

test('a box that is scrolled to its end does not move up past its start', () => {
  const sb = scrollBox(box(200, 400, 0, 1200), 3000, 30);  // 30 px from its start
  sb.appendChild(para('A first short line here.', 300));
  sb.appendChild(para('A line above the view of the box.', 100));
  const pg = loadPage(page(sb));
  pg.tell({ cmd: 'readPage' });
  end(pg);
  assert.equal(sb.scrolls.length, 1);
  assert.equal(sb.scrolls[0].top, -30, 'the box moves up only 30 px');
});

test('a box with overflow hidden is not scrolled: the window moves', () => {
  const hid = el('div');
  Object.assign(hid, { rect: box(0, 800, 0, 1200), scrollHeight: 5000, clientHeight: 800, scrollTop: 0 });
  hid.style.overflowY = 'hidden';
  hid.appendChild(para('A first short line here.', 100));
  hid.appendChild(para('A far line in the box.', 1500));
  const pg = loadPage(page(hid));
  pg.tell({ cmd: 'readPage' });
  end(pg);
  assert.equal(hid.scrolls.length, 0, 'the hidden box did not scroll');
  assert.equal(pg.scrolls.length, 1, 'the window scrolled');
});

test('the target button with nested boxes and the word in view: the nearest box moves the word to its 40% line; the outer box and the window stay', () => {
  const outer = scrollBox(box(0, 800, 0, 1200));
  const inner = scrollBox(box(100, 400, 0, 1200), 3000);
  outer.appendChild(inner);
  inner.appendChild(para('A line in the view of both boxes.', 300));
  const pg = loadPage(page(outer));
  pg.tell({ cmd: 'readPage' });
  assert.equal(inner.scrolls.length + outer.scrolls.length + pg.scrolls.length, 0, 'the word is in view: Follow moves nothing');
  press(pg, 'find');
  assert.equal(inner.scrolls.length, 1);
  assert.equal(inner.scrolls[0].top, 300 - 100 - 400 / 2.5, 'the word goes to 40% of the inner box');
  assert.equal(outer.scrolls.length, 0, 'the outer box stays');
  assert.equal(pg.scrolls.length, 0, 'the window stays');
});

test('the boxes are found once for a block: the second piece of a Sentence reads no style', () => {
  const sb = scrollBox(box(0, 800, 0, 1200));
  sb.appendChild(para(LONG1, 100));
  sb.appendChild(para(SHORT3, 140));
  const pg = loadPage(page(sb));
  pg.tell({ cmd: 'readPage' });
  const n = pg.calls.style;
  end(pg);  // the second piece of the first Sentence: the same block
  assert.equal(pg.last().text, 'of this made page has twelve words in it.');
  assert.equal(pg.calls.style, n, 'no style read');
  end(pg);  // a new block: its boxes are found again
  assert.equal(pg.last().text, SHORT3);
  assert.ok(pg.calls.style > n, 'the style of the new block is read');
});

// ---------- fault 3: the colours of the Word highlight and its Sentence shade ----------
function tokenValues() {  // the light-mode :root values of tokens.css, with var() resolved
  const css = readFileSync(TOKENS_CSS, 'utf8');
  const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(css)[1];
  const raw = {};
  for (const [, k, v] of rootBlock.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) raw[k] = v.trim();
  const resolve = (v) => v.replace(/var\((--[\w-]+)\)/g, (_, k) => resolve(raw[k]));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, resolve(v)]));
}
const norm = (v) => v.replace(/\s+/g, '').toLowerCase();

test('content.css: the marks use our own names --ra2-color-word, --ra2-color-on-word and --ra2-color-sentence, each with the value of its token as fallback', () => {
  const css = readFileSync(CONTENT_CSS, 'utf8');
  const t = tokenValues();
  const rule = (name) => new RegExp(`::highlight\\(${name}\\)\\s*\\{([^}]*)\\}`).exec(css)?.[1] || '';
  const prop = (body, p) => new RegExp(`(?:^|;|\\s)${p}\\s*:\\s*var\\(\\s*(--[\\w-]+)\\s*,\\s*([^;]+?)\\)\\s*(?:;|$)`).exec(body);
  const word = rule('ra2-word'), sent = rule('ra2-sentence');
  const bg = prop(word, 'background-color'), fg = prop(word, 'color'), sh = prop(sent, 'background-color');
  assert.ok(bg && fg && sh, 'each colour is a var() with a fallback');
  assert.deepEqual([bg[1], fg[1], sh[1]], ['--ra2-color-word', '--ra2-color-on-word', '--ra2-color-sentence'], 'a page cannot set these names by chance');
  assert.equal(norm(bg[2]), norm(t['--color-word']), 'the fallback of the Word highlight is the orange accent');
  assert.equal(norm(fg[2]), norm(t['--color-on-word']));
  assert.equal(norm(sh[2]), norm(t['--color-sentence']), 'the Sentence shade is the light shade of the token');
});

test('content.css: no colour value outside a var() fallback, also no named colour', () => {
  const css = readFileSync(CONTENT_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const outside = css.replace(/var\(\s*--[\w-]+\s*,\s*(?:[^()]|\([^()]*\))*\)/g, '');
  assert.doesNotMatch(outside, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  // each value is a var() only: what is left of a value after the var() is taken out must be empty ('orange', 'black' ...)
  for (const [, prop, value] of outside.matchAll(/([\w-]+)\s*:\s*([^;{}]*)/g)) assert.equal(value.trim(), '', `${prop} has a value outside var(): ${value.trim()}`);
});

test('the colour test sees a named colour', () => {
  const outside = '::highlight(ra2-word) { color: black; }'.replace(/var\(\s*--[\w-]+\s*,\s*(?:[^()]|\([^()]*\))*\)/g, '');
  const left = [...outside.matchAll(/([\w-]+)\s*:\s*([^;{}]*)/g)].map((m) => m[2].trim()).filter(Boolean);
  assert.deepEqual(left, ['black']);
});
