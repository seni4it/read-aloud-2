// Tests for the sentences of a web page (extension/content.js): how the add-on cuts the text of a page into sentences.
// content.js is loaded as it is, in a node:vm context with a small fake page and a fake `chrome`, the way Chrome loads it.
// A test builds a page, asks the add-on to read it (the same message the context menu sends), and then plays
// each sentence to its end. The test keeps the text of each sentence that the add-on sends to the voice.
// Run: node --test tests/node/web-sentences.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const CONTENT_JS = fileURLToPath(new URL('../../extension/content.js', import.meta.url));
const INLINE = new Set(['SPAN', 'A', 'B', 'I', 'EM', 'STRONG', 'CODE', 'BR', 'SUP', 'SUB', 'SMALL']);

// ---------- a small fake page ----------
// One simple selector (no spaces): tag, .class, #id, [attr], [attr=v], [attr="v"], [attr*="v"]. This covers every
// selector of the real skip list. A selector that the fake does not understand is an error, so that a test never
// passes because of the fake.
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
const matches = (el, list) => list.split(',').map((s) => matchesOne(el, s)).some(Boolean);  // each selector is read

const before = (n) => { const s = n.parentNode && n.parentNode.childNodes; return s ? s[s.indexOf(n) - 1] || null : null; };
function text(data) { return { nodeType: 3, nodeName: '#text', data, parentElement: null, parentNode: null, get previousSibling() { return before(this); } }; }
function el(tag, attrs = {}, kids = []) {
  const e = {
    nodeType: 1, tagName: tag.toUpperCase(), nodeName: tag.toUpperCase(), attrs: { ...attrs }, childNodes: [],
    parentElement: null, parentNode: null, dataset: {}, style: {},
    get id() { return this.attrs.id || ''; },
    get className() { return this.attrs.class || ''; },
    set className(v) { this.attrs.class = v; },
    get previousSibling() { return before(this); },
    get innerText() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.innerText)).join(''); },
    getAttribute(k) { return k in this.attrs ? String(this.attrs[k]) : null; },
    matches(s) { return matches(this, s); },
    closest(s) { for (let x = this; x; x = x.parentElement) if (matches(x, s)) return x; return null; },
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; },
    appendChild(c) { c.parentNode = this; c.parentElement = this; this.childNodes.push(c); return c; },
    checkVisibility() { return true; },
    attachShadow() { return { set innerHTML(_) {}, getElementById: (id) => (ids[id] ||= el('div')) }; },
    addEventListener() {}, setAttribute(k, v) { this.attrs[k] = String(v); },
    classList: { add() {}, remove() {}, toggle() {} },
  };
  const ids = {};
  for (const k of kids) e.appendChild(typeof k === 'string' ? text(k) : k);
  return e;
}
function textNodes(top, out = []) {
  for (const c of top.childNodes) if (c.nodeType === 3) out.push(c); else textNodes(c, out);
  return out;
}
// A selection over whole text nodes, from the first to the last.
function selection(first, last = first) {
  const all = textNodes(first.parentElement.closest('body'));
  const inside = all.slice(all.indexOf(first), all.indexOf(last) + 1);
  const range = {
    startContainer: first, startOffset: 0, endContainer: last, endOffset: last.data.length,
    commonAncestorContainer: first === last ? first : (() => { let a = first.parentElement; while (!a.contains(last)) a = a.parentElement; return a; })(),
    intersectsNode: (n) => inside.includes(n),
    getBoundingClientRect: () => ({ top: 100, bottom: 120, left: 0, right: 50, width: 50, height: 20 }),
  };
  return { rangeCount: 1, getRangeAt: () => range, toString: () => inside.map((n) => n.data).join('') };
}

// Load content.js on a page whose body is `body`. Returns the voice requests and a way to play to the end.
function loadPage(body, sel = null) {
  const html = el('html', {}, [body]);
  const spoken = [];   // every 'speak' request to the background: { id, text }
  const listeners = [];
  const document = {
    documentElement: html, body, contentType: 'text/html', visibilityState: 'hidden',
    querySelector: () => null,
    createElement: (t) => el(t),
    addEventListener() {},
    createTreeWalker(top, _what, filter) {
      const list = textNodes(top).filter((n) => filter.acceptNode(n) === 1);
      let i = 0;
      return { nextNode: () => list[i++] || null };
    },
    createRange: () => ({ setStart(n, o) { this.start = [n, o]; }, setEnd(n, o) { this.end = [n, o]; }, getBoundingClientRect: () => ({ top: 100, bottom: 120, left: 0, right: 50, width: 50, height: 20 }) }),
  };
  const chrome = {
    runtime: {
      sendMessage: (m) => { if (m.cmd === 'speak') spoken.push({ id: m.id, text: m.text }); return Promise.resolve(undefined); },
      onMessage: { addListener: (f) => listeners.push(f) },
    },
    storage: { sync: { get: () => new Promise(() => {}), set: async () => {} }, onChanged: { addListener() {} } },
  };
  const ctx = vm.createContext({
    document, chrome, console, location: { protocol: 'https:', hostname: 'example.org' },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    MutationObserver: class { observe() {} },
    Highlight: class { constructor() { this.ranges = []; } clear() { this.ranges = []; } add(r) { this.ranges.push(r); } },
    CSS: { highlights: new Map() },
    getComputedStyle: (e) => ({ display: INLINE.has(e.tagName) ? 'inline' : 'block' }),
    getSelection: () => sel || { rangeCount: 0, toString: () => '' },
    matchMedia: () => ({ matches: true }),
    setTimeout: () => 0, clearTimeout() {}, addEventListener() {}, scrollTo() {},
    innerWidth: 1200, innerHeight: 800, scrollY: 0,
  });
  vm.runInContext(readFileSync(CONTENT_JS, 'utf8'), ctx, { filename: 'content.js' });
  const tell = (m) => listeners.forEach((f) => f({ to: 'page', ...m }));
  // Ask for a reading, then end each sentence until no new sentence comes. Returns the text of each sentence.
  const readAll = (cmd) => {
    tell({ cmd });
    for (let n = 0; n < 2000 && spoken.length; n++) {
      const before = spoken.length;
      tell({ evt: 'end', id: spoken[spoken.length - 1].id });
      if (spoken.length === before) break;
    }
    return spoken.map((s) => s.text);
  };
  // The text that the word highlight and the sentence shade cover now.
  const shown = (name) => {
    const r = ctx.CSS.highlights.get(name).ranges[0];
    if (!r) return null;
    const [a, ao] = r.start, [b, bo] = r.end;
    if (a === b) return a.data.slice(ao, bo);
    const all = textNodes(body);
    return a.data.slice(ao) + all.slice(all.indexOf(a) + 1, all.indexOf(b)).map((n) => n.data).join('') + b.data.slice(0, bo);
  };
  return { readAll, spoken, tell, shown };
}
const page = (...kids) => el('body', {}, kids);

// ---------- finding 1: a long run with no space ----------
test('a run of 600 characters with no space gives at most 3 sentences, not 600', () => {
  const run = 'x'.repeat(600);
  const said = loadPage(page(el('p', {}, [run]))).readAll('readPage');
  assert.ok(said.length <= 3, `${said.length} sentences`);
  assert.equal(said.join(''), run, 'no letter is lost');
});

test('a long run after a few words is cut at the space, then in pieces of the longest length', () => {
  const run = 'y'.repeat(600);
  const said = loadPage(page(el('p', {}, ['See this: ' + run]))).readAll('readPage');
  assert.ok(said.length <= 4, `${said.length} sentences`);
  assert.equal(said.join(' ').replace(/\s/g, ''), ('See this: ' + run).replace(/\s/g, ''));
});

// ---------- finding 7: short forms and initials ----------
test("'Smith et al. reported that' is one sentence", () => {
  const said = loadPage(page(el('p', {}, ['Smith et al. reported that it works. It is new.']))).readAll('readPage');
  assert.deepEqual(said, ['Smith et al. reported that it works.', 'It is new.']);
});

test("'J. R. Smith' is not cut", () => {
  const said = loadPage(page(el('p', {}, ['J. R. Smith wrote it. We read it.']))).readAll('readPage');
  assert.deepEqual(said, ['J. R. Smith wrote it.', 'We read it.']);
});

test('cf., pp. and Eq. do not end a sentence', () => {
  const said = loadPage(page(el('p', {}, ['See cf. pp. 4 and Eq. 2. Done.']))).readAll('readPage');
  assert.deepEqual(said, ['See cf. pp. 4 and Eq. 2.', 'Done.']);
});

test("the word 'no' at a sentence end still ends the sentence", () => {
  const said = loadPage(page(el('p', {}, ['He said no. Then he left.']))).readAll('readPage');
  assert.deepEqual(said, ['He said no.', 'Then he left.']);
});

test("'No. 5' and 'Dr. Smith' stay whole", () => {
  const said = loadPage(page(el('p', {}, ['Dr. Smith had case No. 5 today. Next.']))).readAll('readPage');
  assert.deepEqual(said, ['Dr. Smith had case No. 5 today.', 'Next.']);
});

// ---------- finding 8: text divided by line breaks ----------
test("'end.<br>Next' gives 'end.' and 'Next' as separate words", () => {
  const said = loadPage(page(el('p', {}, ['It is the end.', el('br'), 'Next line here.']))).readAll('readPage');
  assert.deepEqual(said, ['It is the end.', 'Next line here.']);
});

test('a line break between two words keeps them apart', () => {
  const said = loadPage(page(el('p', {}, ['First line', el('br'), el('span', {}, ['second line.'])]))).readAll('readPage');
  assert.deepEqual(said, ['First line second line.']);
});

// ---------- finding 9: a selection inside a skipped area ----------
test('Listen on a selection inside a code block reads it', () => {
  const code = el('pre', {}, ['Selected words in a code block.']);
  const said = loadPage(page(el('p', {}, ['Some text before it.']), code), selection(code.childNodes[0])).readAll('readSelection');
  assert.deepEqual(said, ['Selected words in a code block.']);
});

test('Listen on a selection inside a side box reads it', () => {
  const box = el('aside', { class: 'infobox' }, [el('p', {}, ['Selected words in a side box.'])]);
  const t = box.childNodes[0].childNodes[0];
  const said = loadPage(page(el('p', {}, ['Some text before it.']), box), selection(t)).readAll('readSelection');
  assert.deepEqual(said, ['Selected words in a side box.']);
});

test('a page read without a selection still leaves out the code block and the side box', () => {
  const said = loadPage(page(el('p', {}, ['Main text.']), el('pre', {}, ['Code text.']), el('aside', {}, ['Side text.']))).readAll('readPage');
  assert.deepEqual(said, ['Main text.']);
});

// ---------- finding 10: a skip class on the body ----------
test('a page with cookie-consent-active on its body is read', () => {
  const body = page(el('p', {}, ['This page is read aloud.']));
  body.className = 'cookie-consent-active';
  const said = loadPage(body).readAll('readPage');
  assert.deepEqual(said, ['This page is read aloud.']);
});

test('a page with a skip class on its body still leaves out its cookie bar', () => {
  const body = page(el('p', {}, ['This page is read aloud.']), el('div', { class: 'cookie-banner' }, ['Accept all cookies.']));
  body.className = 'cookie-consent-active';
  const said = loadPage(body).readAll('readPage');
  assert.deepEqual(said, ['This page is read aloud.']);
});

// ---------- review of 9 Nov: months, state codes and single capitals ----------
test("a month before a number is a short form; 'Dec.' at the end of a sentence is not", () => {
  assert.deepEqual(loadPage(page(el('p', {}, ['Seen on Dec. 5 at noon. Done.']))).readAll('readPage'), ['Seen on Dec. 5 at noon.', 'Done.']);
  assert.deepEqual(loadPage(page(el('p', {}, ['Born in Dec. Then home.']))).readAll('readPage'), ['Born in Dec.', 'Then home.']);
});

test("a state code such as 'AL.' or 'CA.' ends a sentence; 'et al.' and 'ca.' do not", () => {
  assert.deepEqual(loadPage(page(el('p', {}, ['She lives in Montgomery, AL. Next one.']))).readAll('readPage'), ['She lives in Montgomery, AL.', 'Next one.']);
  assert.deepEqual(loadPage(page(el('p', {}, ['He moved to Fresno, CA. Next one.']))).readAll('readPage'), ['He moved to Fresno, CA.', 'Next one.']);
  assert.deepEqual(loadPage(page(el('p', {}, ['Built ca. 1900 it stood.']))).readAll('readPage'), ['Built ca. 1900 it stood.']);
});

test("one capital letter at a sentence end ends the sentence: 'Grade A. Next', 'vitamin C. Then'", () => {
  assert.deepEqual(loadPage(page(el('p', {}, ['It got Grade A. Next one.']))).readAll('readPage'), ['It got Grade A.', 'Next one.']);
  assert.deepEqual(loadPage(page(el('p', {}, ['We gave vitamin C. Then we waited.']))).readAll('readPage'), ['We gave vitamin C.', 'Then we waited.']);
});

test("a name with initials inside a sentence is not cut: 'by J. R. Smith'", () => {
  assert.deepEqual(loadPage(page(el('p', {}, ['Written by J. R. Smith today. Done.']))).readAll('readPage'), ['Written by J. R. Smith today.', 'Done.']);
});

// ---------- review of 9 Nov: a selection across a skipped area ----------
test('a selection across a nav reads the selected text, but not the nav', () => {
  const a = el('p', {}, ['First selected words.']), b = el('p', {}, ['Last selected words.']);
  const body = page(a, el('nav', {}, ['Home About Contact.']), b);
  const said = loadPage(body, selection(a.childNodes[0], b.childNodes[0])).readAll('readSelection');
  assert.deepEqual(said, ['First selected words.', 'Last selected words.']);
});

test('a selection that starts in a code block and ends after it reads both parts', () => {
  const code = el('pre', {}, ['Code words here.']), b = el('p', {}, ['Text after it.']);
  const said = loadPage(page(code, b), selection(code.childNodes[0], b.childNodes[0])).readAll('readSelection');
  assert.deepEqual(said, ['Code words here.', 'Text after it.']);
});

// ---------- review of 9 Nov: line breaks ----------
test("'end.<br> <span>Next</span>' (a space between) gives two sentences", () => {
  const said = loadPage(page(el('p', {}, ['It is the end.', el('br'), ' ', el('span', {}, ['Next line here.'])]))).readAll('readPage');
  assert.deepEqual(said, ['It is the end.', 'Next line here.']);
});

test('after a <br> the word highlight and the sentence shade are on the right text', () => {
  const p = loadPage(page(el('p', {}, ['It is the end.', el('br'), 'Next line here.'])));
  p.tell({ cmd: 'readPage' });
  assert.equal(p.shown('ra2-word'), 'It');
  assert.equal(p.shown('ra2-sentence').trim(), 'It is the end.');
  p.tell({ evt: 'end', id: p.spoken[0].id });
  assert.equal(p.shown('ra2-word'), 'Next');
  assert.equal(p.shown('ra2-sentence').trim(), 'Next line here.');
});

test('a word after a <br> inside one sentence gets the highlight', () => {
  const p = loadPage(page(el('p', {}, ['First line', el('br'), 'second line.'])));
  p.tell({ cmd: 'readPage' });
  const id = p.spoken[0].id;
  p.tell({ evt: 'times', id, starts: [0, 0.2, 0.4, 0.6] });
  p.tell({ evt: 'tick', id, t: 0.2 });
  assert.equal(p.shown('ra2-word'), 'line');
  p.tell({ evt: 'tick', id, t: 0.4 });
  assert.equal(p.shown('ra2-word'), 'second');
  assert.equal(p.shown('ra2-sentence'), 'First linesecond line.');  // the DOM text: the space exists only in the block text
});
