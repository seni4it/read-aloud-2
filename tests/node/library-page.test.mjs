// Tests for the library page (app/library-model.js and app/library.js), the shelf of Books that the voice server
// serves at /app/. The scripts are loaded as they are, in a node:vm context with a small fake page, fake fetch and
// fake timers. All titles here are invented.
// Run: ./run-tests.sh
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const APP = fileURLToPath(new URL('../../app/', import.meta.url));
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async (n = 10) => { for (let i = 0; i < n; i++) await tick(); };

// ---------- a small fake page: elements with children, classes, attributes and events ----------

function makeDoc() {
  const doc = { activeElement: null };
  const matchOne = (el, sel) => {
    const m = /^([a-z0-9]*)((?:\.[\w-]+)*)(?:#([\w-]+))?$/i.exec(sel.trim());
    if (!m) throw new Error('fake selector not supported: ' + sel);
    const [, tag, classes, id] = m;
    if (tag && el.tagName !== tag.toUpperCase()) return false;
    if (id && el.id !== id) return false;
    return classes.split('.').filter(Boolean).every((c) => el.classList.contains(c));
  };
  const matches = (el, sel) => sel.split(',').some((s) => matchOne(el, s));
  function element(tag = 'div', id = '') {
    const listeners = {};
    const attrs = {};
    let own = '';
    const el = {
      tagName: tag.toUpperCase(), id, className: '', hidden: false, disabled: false, title: '', href: '',
      style: {}, dataset: {}, children: [], parent: null, root: false, files: [], value: '', type: '',
      get tabIndex() { return attrs.tabindex !== undefined ? +attrs.tabindex : (['A', 'BUTTON', 'INPUT', 'SELECT'].includes(this.tagName) ? 0 : -1); },
      set tabIndex(v) { attrs.tabindex = String(v); },
      classList: {
        contains: (c) => el.className.split(/\s+/).includes(c),
        add: (...c) => { el.className = [...new Set([...el.className.split(/\s+/).filter(Boolean), ...c])].join(' '); },
        remove: (...c) => { el.className = el.className.split(/\s+/).filter((k) => k && !c.includes(k)).join(' '); },
        toggle: (c, on) => { (on ?? !el.classList.contains(c)) ? el.classList.add(c) : el.classList.remove(c); },
      },
      get isConnected() { return this.parent ? this.parent.isConnected : this.root; },
      get textContent() { return own + this.children.map((k) => k.textContent).join(''); },
      set textContent(v) { this.children.forEach((k) => { k.parent = null; }); this.children = []; own = String(v); },
      setAttribute(k, v) { attrs[k] = String(v); if (k === 'class') this.className = String(v); },
      getAttribute(k) { return k in attrs ? attrs[k] : null; },
      removeAttribute(k) { delete attrs[k]; },
      append(...c) {
        for (const k of c) {
          const n = typeof k === 'string' ? Object.assign(element('#text'), { textContent: k }) : k;
          if (n.parent) n.parent.children = n.parent.children.filter((x) => x !== n);
          n.parent = this; this.children.push(n);
        }
      },
      replaceChildren(...c) { this.children.forEach((k) => { k.parent = null; }); this.children = []; own = ''; this.append(...c); },
      all() { return this.children.flatMap((k) => [k, ...k.all()]); },
      querySelectorAll(sel) { return this.all().filter((k) => matches(k, sel)); },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      closest(sel) { for (let n = this; n; n = n.parent) if (n.tagName !== '#TEXT' && matches(n, sel)) return n; return null; },
      contains(n) { for (; n; n = n.parent) if (n === this) return true; return false; },
      addEventListener(t, f) { (listeners[t] ||= []).push(f); },
      fire(t, e = {}) {
        const ev = { type: t, target: el, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...e };
        return Promise.all((listeners[t] || []).map((f) => f(ev)));
      },
      focus() { doc.activeElement = el; },
      click() { return el.fire('click'); },
      scrollIntoView() {},
    };
    return el;
  }
  return { doc, element };
}

function loadPage(opts = {}) {
  const { doc, element } = makeDoc();
  const ids = {};
  const byId = (id) => {
    if (!ids[id]) {
      const tag = { search: 'input', sort: 'select', file: 'input', ytSecret: 'input', ytAuto: 'input', add: 'button', moreBtn: 'button',
        restartBtn: 'button', ytBtn: 'button', emptyAdd: 'button', retry: 'button', ytClose: 'button' }[id] || 'div';
      ids[id] = element(tag, id); ids[id].root = true;
    }
    return ids[id];
  };
  byId('sort').value = 'opened';
  byId('moreMenu').hidden = true;
  // as in index.html: the More button and the menu are in .more (#moreWrap); the items are in the menu
  byId('moreWrap').append(byId('moreBtn'), byId('moreMenu'));
  byId('moreMenu').append(byId('restartBtn'), byId('ytBtn'));
  byId('restartBtn').textContent = 'Restart the voice server';
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
  const fetch = opts.fetch || (async (url) => {
    if (url === '/library.json') return reply(books);
    if (/\/export$/.test(url)) return reply({ state: 'none' });
    return reply({});
  });
  const store = { ...(opts.storage || {}) };
  const win = {};
  const confirms = [];
  const ctx = vm.createContext({
    document: { getElementById: byId, createElement: (t) => element(t), get activeElement() { return doc.activeElement; } },
    fetch: (...a) => { requests.push([String(a[0]), a[1]]); return fetch(...a); },
    setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; },
    setInterval: () => 0, clearTimeout() {},
    Image, Intl, Date, Math, Number, String, JSON, Promise, console,
    localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    location: {}, confirm: (t) => { confirms.push(t); return opts.confirm ?? true; },
    addEventListener: (t, f) => { (win[t] ||= []).push(f); },
    window: { open() {} },
  });
  vm.runInContext(readFileSync(APP + 'library-model.js', 'utf8'), ctx, { filename: 'library-model.js' });
  vm.runInContext(readFileSync(APP + 'library.js', 'utf8'), ctx, { filename: 'library.js' });
  // run the timers that are due now; a timer set while running waits for the next call
  const runTimers = () => { const due = timers.splice(0); due.forEach((t) => t.f()); return due.length; };
  const cards = () => byId('grid').querySelectorAll('.book');
  const fireWin = (t, e) => Promise.all((win[t] || []).map((f) => f(e)));
  return { byId, requests, timers, images, runTimers, win, fireWin, cards, doc, confirms, model: ctx.LibraryModel };
}

const someBooks = (n) => Array.from({ length: n }, (_, i) => ({ id: 'b' + i, name: 'Book ' + i, added: i, opened: 0, cover: false }));
const progress = (i, total, extra = {}) => JSON.stringify({ i, total, t: 0, minLeft: 40, ...extra });

// ---------- the model: clean titles, status text, the Continue listening choice, the order ----------

const { LibraryModel: M } = (() => { const c = vm.createContext({}); vm.runInContext(readFileSync(APP + 'library-model.js', 'utf8'), c); return c; })();

test('a file name with underscores, a source tag and a file ending shows as a clean title', () => {
  assert.equal(M.cleanTitle('Gentle_Guide_to_Root_Canals_(z-lib.org).pdf'), 'Gentle Guide to Root Canals');
  assert.equal(M.cleanTitle('A Short Book of Teeth -- Jane Example -- 2019 -- 9781234567897 -- 0123456789abcdef0123456789abcdef -- Anna’s Archive'), 'A Short Book of Teeth');
  assert.equal(M.cleanTitle('Invented Atlas of Molars [www.example.com]'), 'Invented Atlas of Molars');
  assert.equal(M.cleanTitle('Invented Handbook - libgen.example'), 'Invented Handbook');
  assert.equal(M.cleanTitle('Dentin and Pulp - Second Edition'), 'Dentin and Pulp - Second Edition', 'a real subtitle stays');
  assert.equal(M.cleanTitle('Notes (2024 draft)'), 'Notes (2024 draft)', 'brackets that are not a source stay');
  assert.equal(M.cleanTitle('___.pdf'), '___', 'a name with no words is not made empty');
});

test('the card status text: New, the part done with the time left, Finished', () => {
  assert.equal(M.statusText(null), 'New');
  assert.equal(M.statusText({ i: 11, total: 100, minLeft: 40 }), '12% done, 40 min left');
  assert.equal(M.statusText({ i: 49, total: 100, minLeft: 125 }), '50% done, 2 h 05 min left');
  assert.equal(M.statusText({ i: 49, total: 100 }), '50% done');
  assert.equal(M.statusText({ i: 99, total: 100, minLeft: 0 }), 'Finished');
});

test('Continue listening is the Book read last that is not finished; none when no Book was started', () => {
  const books = [
    { id: 'a', name: 'Alpha', added: 1, opened: 100 },
    { id: 'b', name: 'Beta', added: 2, opened: 300 },
    { id: 'c', name: 'Gamma', added: 3, opened: 0 },
  ];
  const prog = { a: { i: 5, total: 10 }, b: { i: 9, total: 10 }, c: { i: 1, total: 10, t: 200 * 1000 } };
  assert.equal(M.pickContinue(books, (b) => prog[b.id]).id, 'c', 'b is finished; c was read at 200 s by the reader');
  assert.equal(M.pickContinue(books.map((b) => ({ ...b, opened: 0 })), () => null), null);
});

test('the order of Books: read last first, added last first, title A to Z', () => {
  const books = [
    { id: 'a', name: 'Charlie_(z-lib.org)', added: 1, opened: 50 },
    { id: 'b', name: 'alpha', added: 2, opened: 0 },
    { id: 'c', name: 'Bravo', added: 3, opened: 90 },
  ];
  const ids = (by) => M.sortBooks(books, by, () => null).map((b) => b.id).join('');
  assert.equal(ids('opened'), 'cab');
  assert.equal(ids('added'), 'cba');
  assert.equal(ids('name'), 'bca');
});

// ---------- the page ----------

test('with a started Book the page opens on Continue listening, and its button opens that Book', async () => {
  const books = [
    { id: 'aa11', name: 'First_Invented_Book', added: 1, opened: 100, cover: false },
    { id: 'bb22', name: 'Second Invented Book', added: 2, opened: 500, cover: false },
    { id: 'cc33', name: 'Third Invented Book', added: 3, opened: 0, cover: false },
  ];
  const p = loadPage({ books, storage: { 'ra2.lib.bb22': progress(11, 100) } });
  await settle();
  const block = p.byId('continue');
  assert.equal(block.hidden, false);
  assert.match(block.textContent, /Second Invented Book/);
  assert.match(block.textContent, /12% done, 40 min left/);
  const go = block.querySelector('a.btn');
  assert.equal(go.textContent, 'Continue listening');
  assert.match(go.href, /^\/reader\/index\.html\?lib=bb22&/);
  // the other Books are below it, not the same Book again
  const titles = p.cards().map((c) => c.querySelector('.title').textContent);
  assert.deepEqual(titles, ['First Invented Book', 'Third Invented Book']);
});

test('with no started Book there is no Continue listening block', async () => {
  const p = loadPage({ books: someBooks(3) });
  await settle();
  assert.equal(p.byId('continue').hidden, true);
  assert.equal(p.cards().length, 3);
});

test('a search shows every matching Book and hides Continue listening', async () => {
  const books = [{ id: 'aa', name: 'Molar Story', added: 1, opened: 9 }, { id: 'bb', name: 'Incisor Story', added: 2, opened: 0 }];
  const p = loadPage({ books });
  await settle();
  p.byId('search').value = 'molar';
  await p.byId('search').fire('input');
  assert.equal(p.byId('continue').hidden, true);
  assert.deepEqual(p.cards().map((c) => c.querySelector('.title').textContent), ['Molar Story']);
  p.byId('search').value = 'nothing like this';
  await p.byId('search').fire('input');
  assert.equal(p.cards().length, 0);
  assert.equal(p.byId('noMatch').hidden, false);
  assert.match(p.byId('noMatch').textContent, /nothing like this/);
});

test('a card shows the clean title, the full file name as its tooltip, one status text and opens the Book', async () => {
  const p = loadPage({ books: [{ id: 'ab12', name: 'Invented_Pulp_Book_(z-lib.org)', file: 'Invented_Pulp_Book_(z-lib.org).pdf', added: 1, opened: 0 }] });
  await settle();
  const card = p.cards()[0];
  const open = card.querySelector('a.open');
  assert.equal(card.querySelector('.title').textContent, 'Invented Pulp Book');
  assert.equal(open.title, 'Invented_Pulp_Book_(z-lib.org).pdf');
  assert.equal(card.querySelector('.sub').textContent, 'New');
  assert.match(open.href, /^\/reader\/index\.html\?lib=ab12&name=Invented_Pulp_Book_\(z-lib\.org\)&file=/);
});

test('an empty library shows one message with the Add PDF action', async () => {
  const p = loadPage({ books: [] });
  await settle();
  assert.equal(p.byId('empty').hidden, false);
  assert.equal(p.byId('offline').hidden, true);
  assert.equal(p.byId('continue').hidden, true);
  let opened = 0; p.byId('file').click = () => { opened++; };
  await p.byId('emptyAdd').fire('click');
  assert.equal(opened, 1, 'the empty state button opens the file chooser');
});

test('while the list loads the page shows card placeholders', async () => {
  let release;
  const p = loadPage({ fetch: (url) => (url === '/library.json' ? new Promise((r) => { release = r; }) : Promise.resolve({ ok: true, json: async () => ({}) })) });
  await tick();
  const ph = p.byId('grid').querySelectorAll('.skeleton');
  assert.ok(ph.length >= 3, `placeholders: ${ph.length}`);
  assert.equal(p.byId('empty').hidden, true, 'not "empty" while it loads');
  release({ ok: true, json: async () => someBooks(2) });
  await settle();
  assert.equal(p.byId('grid').querySelectorAll('.skeleton').length, 0);
  assert.equal(p.cards().length, 2);
});

test('a stopped voice server shows its own message and a Try again button', async () => {
  let up = false;
  const p = loadPage({ fetch: async (url) => { if (!up) throw new TypeError('Failed to fetch'); return { ok: true, json: async () => (url === '/library.json' ? someBooks(1) : {}) }; } });
  await settle();
  assert.equal(p.byId('offline').hidden, false);
  assert.equal(p.byId('empty').hidden, true, 'a stopped server is not an empty library');
  assert.equal(p.byId('grid').querySelectorAll('.skeleton').length, 0, 'no placeholders without end');
  up = true;
  await p.byId('retry').fire('click');
  await settle();
  assert.equal(p.byId('offline').hidden, true);
  assert.equal(p.cards().length, 1);
});

test('a remove when the voice server is stopped gives a message', async () => {
  let down = false;
  const p = loadPage({ fetch: async (url) => { if (down) throw new TypeError('Failed to fetch'); return { ok: true, json: async () => (url === '/library.json' ? [{ id: 'ab', name: 'Invented_Book', added: 1, opened: 0 }] : {}) }; } });
  await settle();
  down = true;
  await p.cards()[0].querySelector('.remove').fire('click');
  await settle();
  assert.match(p.confirms[0], /Invented Book/, 'the question uses the clean title');
  assert.match(p.byId('status').textContent, /Could not remove “Invented Book”\. The voice server is not running/);
});

test('two loads that answer in the wrong order: the older answer is dropped', async () => {
  const waiting = [];
  const p = loadPage({ fetch: (url) => (url === '/library.json'
    ? new Promise((r) => waiting.push(r))
    : Promise.resolve({ ok: true, json: async () => ({ state: 'none' }) })) });
  await tick();
  p.fireWin('focus');
  await tick();                             // a second load (back from the reader, a remove, Try again)
  assert.equal(waiting.length, 2);
  const answer = (list) => ({ ok: true, json: async () => list });
  waiting[1](answer([]));                         // the new answer: the Book was removed
  await settle();
  waiting[0](answer(someBooks(1)));               // the old answer comes last
  await settle();
  assert.equal(p.cards().length, 0, 'the removed Book does not come back');
  assert.equal(p.byId('empty').hidden, false);
});

test('the remove question says the book goes to the Trash', async () => {
  const p = loadPage({ books: someBooks(1), confirm: false });
  await settle();
  await p.cards()[0].querySelector('.remove').fire('click');
  assert.equal(p.confirms[0], 'Remove “Book 0” from the library? The book goes to the Trash.');
  assert.ok(!p.requests.some(([u]) => /remove$/.test(u)), 'No in the question removes nothing');
});

test('a remove that the voice server refuses gives a message', async () => {
  const p = loadPage({ fetch: async (url, init) => ({ ok: !(init && init.method === 'POST'), json: async () => (url === '/library.json' ? someBooks(1) : {}) }) });
  await settle();
  await p.cards()[0].querySelector('.remove').fire('click');
  await settle();
  assert.match(p.byId('status').textContent, /Could not remove “Book 0”/);
});

test('keyboard reach: each card opens with a link and has its own remove button; the bar controls are buttons', async () => {
  const p = loadPage({ books: someBooks(2) });
  await settle();
  for (const card of p.cards()) {
    const open = card.querySelector('a.open');
    assert.ok(open && open.href && open.tabIndex >= 0, 'the card link can take the focus and has an address');
    const rm = card.querySelector('button.remove');
    assert.ok(rm && rm.tabIndex >= 0, 'the remove button can take the focus');
    assert.match(rm.getAttribute('aria-label'), /Remove “Book \d” from the library/);
    assert.ok(!open.contains(rm), 'the remove button is not inside the link');
  }
});

test('the More menu opens with the keyboard, Escape closes it and gives the focus back', async () => {
  const p = loadPage({ books: someBooks(1) });
  await settle();
  const more = p.byId('moreBtn'), menu = p.byId('moreMenu');
  await more.fire('click');
  assert.equal(menu.hidden, false);
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  await more.fire('keydown', { key: 'ArrowDown' });
  assert.equal(p.doc.activeElement, p.byId('restartBtn'), 'Arrow down goes to the first item');
  await menu.fire('keydown', { key: 'ArrowDown', target: p.byId('restartBtn') });
  assert.equal(p.doc.activeElement, p.byId('ytBtn'));
  await menu.fire('keydown', { key: 'Escape' });
  assert.equal(menu.hidden, true);
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  assert.equal(p.doc.activeElement, more);
});

test('Escape on the More button closes the menu and keeps the focus on More', async () => {
  const p = loadPage({ books: someBooks(1) });
  await settle();
  const more = p.byId('moreBtn'), menu = p.byId('moreMenu');
  more.focus();
  await more.fire('click');                       // a click, Enter or Space: the focus stays on the button
  assert.equal(menu.hidden, false);
  await more.fire('keydown', { key: 'Escape' });
  assert.equal(menu.hidden, true);
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  assert.equal(p.doc.activeElement, more);
});

test('the More menu closes when the focus leaves it (Tab from More)', async () => {
  const p = loadPage({ books: someBooks(1) });
  await settle();
  const wrap = p.byId('moreWrap'), menu = p.byId('moreMenu');
  await p.byId('moreBtn').fire('click');
  await wrap.fire('focusout', { relatedTarget: p.byId('restartBtn') });
  assert.equal(menu.hidden, false, 'a move inside the menu keeps it open');
  await wrap.fire('focusout', { relatedTarget: p.byId('add') });
  assert.equal(menu.hidden, true);
});

test('YouTube opens from the More menu', async () => {
  const p = loadPage({ books: someBooks(1) });
  await settle();
  p.byId('yt').hidden = true;
  await p.byId('moreBtn').fire('click');
  await p.byId('ytBtn').fire('click');
  await settle();
  assert.equal(p.byId('yt').hidden, false);
  assert.equal(p.byId('moreMenu').hidden, true, 'the menu closes after a choice');
  assert.ok(p.requests.some(([u]) => u === '/youtube/status'));
  await p.byId('ytClose').fire('click');
  assert.equal(p.byId('yt').hidden, true);
});

test('Restart works from the More menu and says "voice server", not "helper"', async () => {
  const p = loadPage({ books: someBooks(1) });
  await settle();
  const b = p.byId('restartBtn');
  await p.byId('moreBtn').fire('click');
  b.focus();
  // in this test /reader/restart.js cannot be loaded, so the restart fails
  await b.fire('click').catch(() => {});
  await settle();
  assert.equal(p.doc.activeElement, p.byId('moreBtn'), 'the focus goes back to More, not to the page body');
  assert.match(p.byId('status').textContent, /voice server/i);
  assert.doesNotMatch(p.byId('status').textContent + b.textContent, /helper/i);
  p.runTimers();
  assert.equal(b.disabled, false, 'the item can be pressed again after a failed restart');
  assert.equal(b.textContent, 'Restart the voice server');
});

// The text that the owner reads: the text and the title, aria-label and placeholder of index.html, and the string
// literals of library.js that hold a space (a message, a label), with the code inside ${...} taken out.
function ownerText() {
  const html = readFileSync(APP + 'index.html', 'utf8').replace(/<(script|svg|style)\b[\s\S]*?<\/\1>/gi, ' ');
  const attrs = [...html.matchAll(/\b(?:title|aria-label|placeholder)="([^"]*)"/g)].map((m) => m[1]);
  const text = html.replace(/<[^>]*>/g, '\n').split('\n').map((t) => t.trim()).filter(Boolean);
  const js = readFileSync(APP + 'library.js', 'utf8').replace(/(^|\s)\/\/.*$/gm, '$1');
  const lits = [...js.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`]*)`/g)].map((m) => (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, '…'))
    .filter((t) => / /.test(t));
  return [...attrs, ...text, ...lits];
}

test('the page text uses no word that the glossary forbids', () => {
  const lines = ownerText();
  assert.ok(lines.some((t) => /Continue listening/.test(t)), 'the owner text is found');
  // Allowed: the Google key file of the YouTube panel (a real file, not a Book) and the folder name in the Finder.
  const allow = (t) => t.replace(/\bkey file\b/gi, '').replace(/Documents › Read Aloud Library/g, '');
  const bad = lines.filter((t) => /\bhelper\b|\bfiles?\b|\bdocuments?\b/i.test(allow(t)));
  assert.deepEqual(bad, []);
});

// ---------- earlier repairs (ticket 17) ----------

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
  const audio = p.cards()[0].querySelector('.audio');
  assert.equal(audio.hidden, false);
  assert.equal(audio.textContent, 'Audio: 3 MP3s');
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

test('the cover placeholder has a contrast of 4.5 to 1 or more, light and dark', () => {
  const css = readFileSync(APP + 'library.css', 'utf8');
  const cover = css.match(/^\.cover \{[^}]*\}/m)[0];
  const fgVar = cover.match(/[^-]color: (var\(--[\w-]+\))/)[1];
  const bgVar = cover.match(/background: (var\(--[\w-]+\))/)[1];
  for (const [name, mode] of [['light', LIGHT], ['dark', DARK]]) {
    const fg = hexOf(mode, fgVar), bg = hexOf(mode, bgVar);
    assert.ok(ratio(fg, bg) >= 4.5, `${name}: ${fg} on ${bg} = ${ratio(fg, bg).toFixed(2)}`);
  }
});

// The colour of a property in the first rule whose selector list holds the selector.
function cssColour(css, selector, prop) {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!m[1].split(',').map((s) => s.trim()).includes(selector)) continue;
    const v = new RegExp(`(?:^|[;\\s])${prop}:\\s*(var\\(--[\\w-]+\\))`).exec(m[2]);
    if (v) return v[1];
  }
  throw new Error(`no ${prop} for ${selector}`);
}

test('muted text has a contrast of 4.5 to 1 or more on its surface, light and dark', () => {
  const css = readFileSync(APP + 'library.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const pairs = [
    ['card status', '.sub', '.card'],
    ['audio line', '.audio', '.card'],
    ['Continue status', '.sub', '.continue'],
    ['Where you stopped', '.kicker', '.continue'],
    ['empty and stopped message', '.state', 'body'],
    ['status line', '.status', 'body'],
  ];
  const low = [];
  for (const [what, fgSel, bgSel] of pairs) {
    const fgVar = cssColour(css, fgSel, 'color'), bgVar = cssColour(css, bgSel, 'background');
    for (const [name, mode] of [['light', LIGHT], ['dark', DARK]]) {
      const r = ratio(hexOf(mode, fgVar), hexOf(mode, bgVar));
      if (r < 4.5) low.push(`${what} (${name}): ${fgVar} on ${bgVar} = ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual(low, [], low.join('\n'));
});

test('the top bar has search, sort, the More menu and one filled button', () => {
  const html = readFileSync(APP + 'index.html', 'utf8');
  const bar = /<header class="top">([\s\S]*?)<\/header>/.exec(html)[1];
  assert.match(bar, /<input id="search" type="search"/);
  assert.match(bar, /<select id="sort"/);
  assert.match(bar, /id="moreBtn"[^>]*aria-haspopup="menu"/);
  const filled = [...bar.matchAll(/class="btn( [\w ]+)?"/g)].filter((m) => !/ghost/.test(m[1] || ''));
  assert.equal(filled.length, 1, 'one filled button');
  assert.match(bar, /class="btn" id="add"[^>]*>\+ Add PDF</);
  const menu = /id="moreMenu"[\s\S]*?<\/div>/.exec(bar)[0];
  assert.match(menu, /id="restartBtn"[^>]*>Restart the voice server</);
  assert.match(menu, /id="ytBtn"/);
  assert.match(html, /<script src="library-model\.js"><\/script>\s*<script src="library\.js"><\/script>/);
});
