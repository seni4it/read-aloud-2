// Tests for the highlights of the reader (extension/pdf/notes.js) and the reader's calls to them (extension/pdf/app.js):
// a click on a saved highlight, the mark button with the keyboard, the delete control with Tab, the save sequence,
// the Markdown export, a new book that is read in, and the status label after the voice server falls.
// notes.js is imported as it is, with a small fake page. app.js runs in a node:vm context, as in reader-transport.test.mjs.
// All text is invented.
// Run: node --test --test-timeout=120000 tests/node/highlights.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { setupNotes } from '../../extension/pdf/notes.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(cond, what) {
  for (let i = 0; i < 500; i++) { if (cond()) return; await tick(); }
  throw new Error('waited too long for: ' + what);
}

// ---- one fake element of the page --------------------------------------------------------------------------------
function element(id, tag = 'div') {
  const listeners = {};
  const attrs = {};
  let html = '';
  const el = {
    id, tagName: tag.toUpperCase(), value: '', textContent: '', hidden: false, disabled: false, checked: false, title: '', max: '',
    style: {}, dataset: {}, children: [], files: [], className: '', offsetWidth: 100,
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return attrs[k] ?? null; },
    hasAttribute(k) { return k in attrs; },
    set innerHTML(v) { html = String(v); this.children = []; },
    get innerHTML() { return html; },
    insertAdjacentHTML(_, h) { html += h; },
    appendChild(c) { this.children.push(c); return c; },
    remove() {},
    contains(x) { return x === el; },
    querySelectorAll() { return []; },
    matches() { return false; },
    closest() { return null; },
    click() { el.fire('click', { detail: 1 }); },
    focus() { globalThis.document.activeElement = el; },
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    // fire an event; it gives the event back, so a test can see a preventDefault
    fire(t, e = {}) {
      const ev = { target: el, defaultPrevented: false, preventDefault() { ev.defaultPrevented = true; }, stopPropagation() {}, ...e };
      for (const f of listeners[t] || []) f(ev);
      return ev;
    },
  };
  return el;
}

// ---- notes.js with a fake page -----------------------------------------------------------------------------------
// Three invented sentences. The reader is at sentence 1, word "green".
const text3 = () => [
  { text: 'The first line of the test.', charOwners: [] },
  { text: 'Small green boxes sit here.', charOwners: [] },
  { text: 'The last line is short.', charOwners: [] },
];

// The 30-second time limits of notes.js are kept here; the test runs them with fire(). Shorter timers run as usual.
function slowClock() {
  const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
  const long = [];
  globalThis.setTimeout = (fn, ms, ...a) => { if (ms >= 30000) { const t = { fn, live: true }; long.push(t); return t; } return realSet(fn, ms, ...a); };
  globalThis.clearTimeout = (t) => { if (t && typeof t === 'object' && 'live' in t) t.live = false; else realClear(t); };
  return {
    fire() { for (const t of long.splice(0)) if (t.live) { t.live = false; t.fn(); } },
    end() { globalThis.setTimeout = realSet; globalThis.clearTimeout = realClear; },
  };
}

function loadNotes({ libId = null, docKey = 'book-a', store = new Map(), server = null, storage = null } = {}) {
  const ids = {};
  const byId = (id) => (ids[id] ||= element(id));
  byId('docTitle').textContent = 'Invented book';
  const docListeners = {};
  const made = [];
  globalThis.document = {
    title: 'Invented book · Read Aloud 2',
    body: element('body'),
    activeElement: null,
    getElementById: byId,
    createElement: (tag) => { const e = element('', tag); made.push(e); return e; },
    addEventListener: (t, f) => { (docListeners[t] ||= []).push(f); },
    dispatchEvent() {},
  };
  globalThis.localStorage = storage || { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  globalThis.location = { origin: 'http://127.0.0.1:8793' };
  globalThis.getSelection = () => ({ rangeCount: 0, isCollapsed: true, toString: () => '', removeAllRanges() {} });
  globalThis.innerWidth = 1400; globalThis.innerHeight = 900;
  globalThis.CustomEvent ||= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };

  // The fake voice server. A POST is held until the test lets it arrive (or it fails, or it never answers).
  // A GET answers at once, or is held when server.holdReads is set. A time limit (abort) rejects a held request.
  const posts = [], gets = [];
  globalThis.fetch = (url, opts = {}) => new Promise((resolve, reject) => {
    if (url.includes('/claude/')) { reject(new Error('no voice server in this test')); return; }
    opts.signal?.addEventListener('abort', () => reject(new Error('aborted: time limit')));
    if (opts.method === 'POST') {
      posts.push({ url, body: opts.body,
        arrive() { server.saved = JSON.parse(this.body); resolve({ ok: true }); },
        fail() { resolve({ ok: false, status: 500 }); } });
      return;
    }
    if (server?.down) { reject(new Error('the voice server does not answer')); return; }
    // server.hangBody: the headers come, the body never comes
    const answer = (list) => resolve({ ok: true, json: server?.hangBody ? () => new Promise(() => {}) : async () => JSON.parse(JSON.stringify(list)) });
    if (server?.holdReads) gets.push({ url, answer });
    else answer(server?.saved || []);
  });

  const marks = [];
  const pages = element('pages');
  pages.boxes = [];
  pages.querySelectorAll = (sel) => (sel === '.mark-box' ? pages.boxes : []);
  pages.querySelector = () => null;   // the jump looks for the underline on the page; here it is not drawn
  const state = { sentences: text3(), index: 1, at: 8, playing: false, docKey, itemToSentence: new Map() };
  const viewer = { setMarks: (m) => marks.push(m), pages: new Map() };
  const jumps = [];
  const els = { pages, toc: element('toc'), sidebar: element('sidebar') };
  const ui = setupNotes({ state, viewer, els, jumpTo: (si, o) => jumps.push([si, o]), wordPartsAt: () => [{}], libId });
  const rows = () => byId('notes').children;
  const mark = () => byId('markBtn').fire('click', { detail: 1 });
  // let the waiting saves arrive, the newest first (the network can change the order)
  const deliver = async () => {
    for (let round = 0; round < 10; round++) {
      await tick();
      for (const p of n.posts.splice(0).reverse()) p.arrive();
    }
  };
  const n = { ui, state, ids, byId, store, posts, gets, server, marks, pages, jumps, rows, made, mark, deliver };
  return n;
}

const saved = (store, key) => JSON.parse(store.get('ra2.notes.' + key) || '[]');
const invented = (si, a, b, color = 'yellow') => ({ id: 'n' + si + a, color, text: 'invented', page: 1, t: 1, segs: [{ si, a, b, fp: text3()[si].text }] });

// ---- 1. a click on a saved highlight ---------------------------------------------------------------------------
test('notes.js tells where a saved highlight is on the page (markAt): the drawn box, 2 px at most around it', async () => {
  const n = loadNotes();
  await n.ui.reload();
  n.pages.boxes = [{ dataset: { id: 'x1' }, getBoundingClientRect: () => ({ left: 100, right: 200, top: 300, bottom: 320 }) }];
  assert.equal(typeof n.ui.markAt, 'function', 'notes.js gives markAt(x, y) to the reader');
  assert.equal(n.ui.markAt(150, 310)?.dataset.id, 'x1', 'a point on the underline');
  assert.equal(n.ui.markAt(202, 322)?.dataset.id, 'x1', 'a point 2 px next to it');
  assert.equal(n.ui.markAt(204, 310), null, 'a near miss (4 px to the right): the click reads the word there');
  assert.equal(n.ui.markAt(150, 325), null, 'a near miss (5 px below)');
  assert.equal(n.ui.markAt(150, 400), null, 'a point away from it');
});

// ---- 2. the mark button with the keyboard -----------------------------------------------------------------------
test('the click that Enter gives (detail 0) on the mark button keeps the present sentence; the play state stays', async () => {
  const n = loadNotes();
  await n.ui.reload();
  n.state.playing = true;
  n.byId('markBtn').fire('click', { detail: 0 });   // Chrome: Enter on a focused button gives a click with detail 0
  const list = saved(n.store, 'book-a');
  assert.equal(list.length, 1, 'one highlight is kept');
  assert.equal(list[0].text, 'Small green boxes sit here.');
  assert.equal(n.state.playing, true, 'the reading goes on');
  n.mark();   // a mouse click on it again takes it off
  assert.equal(saved(n.store, 'book-a').length, 0);
});

test('Space on the mark button never marks: its keyup stops the button\'s own click', async () => {
  const n = loadNotes();
  await n.ui.reload();
  const up = n.byId('markBtn').fire('keyup', { code: 'Space', key: ' ' });
  assert.equal(up.defaultPrevented, true);
  assert.equal(n.byId('markBtn').fire('keyup', { code: 'Enter', key: 'Enter' }).defaultPrevented, false, 'other keys are not touched');
  assert.equal(saved(n.store, 'book-a').length, 0);
});

// ---- 3. the list: two real buttons in each row, and the focus after a delete -----------------------------------
test('each row of the list holds two real buttons: the Highlight text and its delete button (Tab reaches both)', async () => {
  const store = new Map([['ra2.notes.book-a', JSON.stringify([invented(0, 4, 9), invented(2, 0, 8)])]]);
  const n = loadNotes({ store });
  await n.ui.reload();
  assert.equal(n.rows().length, 2);
  for (const row of n.rows()) {
    assert.equal(row.tagName, 'DIV', 'the row is a plain container');
    assert.equal(row.getAttribute('role'), null, 'the row has no role (it is not a button that holds a button)');
    assert.equal(row.tabIndex, undefined, 'the row itself is not a Tab stop');
    const [open, del] = row.children;
    assert.equal(open.tagName, 'BUTTON'); assert.equal(open.type, 'button');
    assert.equal(del.tagName, 'BUTTON'); assert.equal(del.type, 'button'); assert.equal(del.className, 'del');
    assert.equal(del.getAttribute('aria-label'), 'Delete this highlight');
  }
  // the text button opens the highlight (Enter on a button gives this click)
  n.rows()[1].children[0].fire('click', { detail: 0 });
  assert.deepEqual(n.jumps, [[2, { resume: false }]]);
  // the delete button removes the highlight and does not jump
  n.rows()[0].children[1].fire('click', { detail: 0 });
  assert.equal(saved(n.store, 'book-a').length, 1);
  assert.equal(n.jumps.length, 1);
});

test('after a delete from the list, the focus goes to the next row, then the one before, then the mark button', async () => {
  const store = new Map([['ra2.notes.book-a', JSON.stringify([invented(0, 4, 9), invented(1, 0, 5), invented(2, 0, 8)])]]);
  const n = loadNotes({ store });
  await n.ui.reload();
  n.rows()[0].children[1].fire('click', { detail: 0 });            // delete the first
  assert.equal(document.activeElement, n.rows()[0].children[0], 'the next row (now the first) has the focus');
  n.rows()[1].children[1].fire('click', { detail: 0 });            // delete the last
  assert.equal(document.activeElement, n.rows()[0].children[0], 'the row before has the focus');
  n.rows()[0].children[1].fire('click', { detail: 0 });            // delete the only one
  assert.equal(document.activeElement, n.byId('markBtn'), 'an empty list: the mark button has the focus');
});

// ---- 4. the save sequence and the time limits -------------------------------------------------------------------
test('two fast saves that the network delivers in the other order: the voice server holds the second one', async () => {
  const server = { saved: [] };
  const n = loadNotes({ libId: 'lib1', server });
  await n.ui.reload();
  n.mark();                                   // change 1: a highlight is added
  n.state.index = 2; n.state.at = 3;
  n.mark();                                   // change 2, at once: a second highlight
  await n.deliver();
  assert.equal(server.saved.length, 2, 'the server holds both highlights (the second change)');
});

test('a read of the highlights waits for a save that is not finished', async () => {
  const server = { saved: [invented(0, 0, 9)] };
  const n = loadNotes({ libId: 'lib1', server });
  await n.ui.reload();
  n.mark();                                   // a new highlight; its save is not there yet
  const again = n.ui.reload();                // the book is read again (for example with other skip settings)
  await tick(); await tick();
  n.posts.splice(0).forEach((p) => p.arrive());
  await again;
  assert.equal(n.rows().length, 2, 'the new highlight is still in the list');
});

test('a save that never answers stops after 30 s; the next save goes, and the owner sees a message', async () => {
  const clock = slowClock();
  try {
    const server = { saved: [] };
    const n = loadNotes({ libId: 'lib1', server });
    await n.ui.reload();
    n.mark();
    await tick();
    assert.equal(n.posts.length, 1);
    n.posts.length = 0;                       // this save never answers
    n.state.index = 2; n.state.at = 3;
    n.mark();
    await tick();
    assert.equal(n.posts.length, 0, 'the second save waits for the first');
    clock.fire();                             // 30 s later: the time limit
    await tick(); await tick();
    assert.match(n.byId('notes').innerHTML, /A change was not saved: the voice server did not answer\. The next change saves all highlights again\./);
    await n.deliver();
    assert.equal(server.saved.length, 2, 'the second save has the whole list');
    assert.doesNotMatch(n.byId('notes').innerHTML, /was not saved/, 'the message goes when a save works again');
  } finally { clock.end(); }
});

test('a save that the voice server refuses does not stop the next save', async () => {
  const server = { saved: [] };
  const n = loadNotes({ libId: 'lib1', server });
  await n.ui.reload();
  n.mark();
  await tick();
  n.posts.shift().fail();                     // 500
  n.state.index = 2; n.state.at = 3;
  n.mark();
  await n.deliver();
  assert.equal(server.saved.length, 2);
});

test('when the saved highlights cannot be read, a change does not write over them, and starts a new read', async () => {
  const server = { saved: [invented(0, 0, 9), invented(2, 0, 8)], down: true };
  const n = loadNotes({ libId: 'lib1', server });
  await n.ui.reload();
  assert.match(n.byId('notes').innerHTML, /The highlights could not be read \(the voice server did not answer\)\. Mark again in a moment/);
  server.down = false;
  n.mark();                                   // refused, and the read starts again
  await tick(); await tick(); await tick();
  assert.equal(n.posts.length, 0, 'no save is sent');
  assert.equal(server.saved.length, 2, 'the two saved highlights are kept');
  assert.equal(n.rows().length, 2, 'the new read shows the saved highlights');
  n.mark();                                   // now the change is kept
  await n.deliver();
  assert.equal(server.saved.length, 3);
});

test('a read that never answers stops after 30 s; the next change reads again', async () => {
  const clock = slowClock();
  try {
    const server = { saved: [invented(0, 0, 9)], holdReads: true };
    const n = loadNotes({ libId: 'lib1', server });
    const first = n.ui.reload();
    await tick(); await tick();
    assert.equal(n.gets.length, 1);
    clock.fire();
    await first;
    assert.match(n.byId('notes').innerHTML, /could not be read/);
    n.mark();
    await tick(); await tick();
    assert.equal(n.gets.length, 2, 'the change started a new read');
    n.gets[1].answer(server.saved);
    await tick(); await tick(); await tick();
    assert.equal(n.rows().length, 1);
    assert.equal(n.posts.length, 0, 'the refused change wrote nothing');
  } finally { clock.end(); }
});

test('a read whose body never comes stops after 30 s; the next change reads again', async () => {
  const clock = slowClock();
  try {
    const server = { saved: [invented(0, 0, 9)], hangBody: true };
    const n = loadNotes({ libId: 'lib1', server });
    const first = n.ui.reload();
    for (let i = 0; i < 5; i++) await tick();
    clock.fire();                             // 30 s: the time limit covers the body too
    await first;
    assert.match(n.byId('notes').innerHTML, /could not be read/);
    server.hangBody = false;
    n.mark();                                 // refused, and a new read starts
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(n.rows().length, 1, 'the new read shows the saved highlight');
    assert.equal(n.posts.length, 0);
  } finally { clock.end(); }
});

for (const [name, storage] of [
  ['a damaged value', (store) => ({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) })],
  ['a storage error', (store) => ({ getItem: () => { throw new Error('storage blocked'); }, setItem: (k, v) => store.set(k, String(v)) })],
]) {
  test(`${name} in the browser storage: a change does not write over the stored list`, async () => {
    const store = new Map([['ra2.notes.book-a', '[{"id":"n00", "damaged']]);
    const n = loadNotes({ store, storage: storage(store) });
    await n.ui.reload();
    n.mark();
    assert.equal(store.get('ra2.notes.book-a'), '[{"id":"n00", "damaged', 'the stored value is not changed');
    assert.match(n.byId('notes').innerHTML, /could not be read \(the browser storage did not answer\)/);
  });
}

test('no value in the browser storage is a good empty list: a change is kept', async () => {
  const n = loadNotes();
  await n.ui.reload();
  n.mark();
  assert.equal(saved(n.store, 'book-a').length, 1);
});

// ---- 5. the Markdown export -------------------------------------------------------------------------------------
test('the Markdown export releases its temporary address', async () => {
  const n = loadNotes();
  await n.ui.reload();
  const made = [], freed = [];
  const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => { const u = 'blob:test-' + made.length; made.push(u); return u; };
  URL.revokeObjectURL = (u) => freed.push(u);
  try {
    n.byId('notes').fire('click', { target: { id: 'exportMd', closest: () => null } });
    assert.equal(made.length, 1);
    await new Promise((r) => setTimeout(r, 1200));
    assert.deepEqual(freed, made, 'the address is released after the download starts');
  } finally { URL.createObjectURL = realCreate; URL.revokeObjectURL = realRevoke; }
});

// ---- 6. a new book while it is read in ---------------------------------------------------------------------------
test('a change during the read-in of a new book does not write the old book under the new key', async () => {
  const store = new Map([
    ['ra2.notes.book-a', JSON.stringify([invented(0, 0, 9)])],
    ['ra2.notes.book-b', JSON.stringify([invented(1, 0, 5, 'green'), invented(2, 0, 4, 'blue')])],
  ]);
  const n = loadNotes({ store });
  await n.ui.reload();
  assert.equal(n.rows().length, 1);
  // app.js openFile: a new book. The key changes, then the read-in starts with partial sentences.
  assert.equal(typeof n.ui.reset, 'function', 'notes.js gives reset() to the reader');
  n.ui.reset('');
  n.state.docKey = 'book-b';
  n.state.sentences = text3().slice(0, 2);
  assert.deepEqual(n.marks.at(-1), [], 'the old marks are gone');
  assert.equal(n.rows().length, 0, 'the old list is gone');
  n.mark();   // the owner marks a sentence during the read-in
  assert.equal(saved(store, 'book-b').length, 2, 'the highlights of the new book are not written over');
  assert.equal(saved(store, 'book-a').length, 1, 'the highlights of the old book are not changed');
  assert.ok(!store.get('ra2.notes.book-b').includes('"n00"'), 'no old highlight under the new key');
  await n.ui.reload();
  assert.equal(n.rows().length, 2, 'after the read-in the new book shows its own highlights');
  n.mark();
  assert.equal(saved(store, 'book-b').length, 3, 'after the read-in a new highlight is kept');
});

test('a read of the old book that answers after a new book is opened is dropped', async () => {
  const oldList = [invented(0, 0, 9)], newList = [invented(1, 0, 5, 'green'), invented(2, 0, 4, 'blue')];
  const server = { saved: [], holdReads: true };
  const n = loadNotes({ libId: 'aaaaaaaaaaaa', server });
  const oldRead = n.ui.reload();               // the old book: its read waits
  await tick(); await tick();
  n.ui.reset('bbbbbbbbbbbb');                   // a new book is opened
  const newRead = n.ui.reload();                // and its read starts
  await tick(); await tick();
  assert.equal(n.gets.length, 2);
  assert.match(n.gets[1].url, /bbbbbbbbbbbb/, 'the new read asks for the new book');
  n.gets[0].answer(oldList);                    // the old answer comes late
  await oldRead;
  assert.equal(n.rows().length, 0, 'the old list does not show');
  n.mark();
  await tick();
  assert.equal(n.posts.length, 0, 'a mark now writes nothing: the new book is not read yet');
  n.gets[1].answer(newList);
  await newRead;
  assert.equal(n.rows().length, 2, 'the new book shows its own highlights');
  n.mark();
  await tick(); await tick();
  assert.equal(n.posts.length, 1);
  assert.match(n.posts[0].url, /bbbbbbbbbbbb/, 'the save goes to the new book');
  assert.equal(JSON.parse(n.posts[0].body).length, 3, 'the new book\'s list and the new highlight, no old one');
});

test('a PDF opened on a library Book page keeps its highlights under its own key, not under the library Book', async () => {
  const server = { saved: [invented(0, 0, 9)] };
  const n = loadNotes({ libId: 'aaaaaaaaaaaa', server });
  await n.ui.reload();
  assert.equal(n.rows().length, 1, 'the library Book shows its highlights');
  n.ui.reset('');                               // app.js: a dropped PDF is not the library Book
  n.state.docKey = 'dropped-key';
  await n.ui.reload();
  assert.equal(n.rows().length, 0, 'the library Book\'s highlights do not show on the other PDF');
  n.mark();
  await tick(); await tick();
  assert.equal(n.posts.length, 0, 'nothing goes to the library Book');
  assert.equal(server.saved.length, 1);
  assert.equal(saved(n.store, 'dropped-key').length, 1, 'the dropped PDF keeps its highlight under its own key');
});

// ---- review round 2: an open that fails, and the saves of an old Book -------------------------------------------
test('reset() with a reason: the list and the mark button say it, and changes stay refused', async () => {
  const n = loadNotes();
  await n.ui.reload();
  n.ui.reset('', 'No book is open. Open a PDF to see its highlights.');
  assert.match(n.byId('notes').innerHTML, /No book is open\. Open a PDF to see its highlights\./);
  assert.doesNotMatch(n.byId('notes').innerHTML, /read in/, 'no false "wait for the read-in" message');
  n.mark();
  assert.equal(n.byId('markBtn').title, 'No book is open. Open a PDF to see its highlights.');
  assert.equal(saved(n.store, 'book-a').length, 0, 'nothing is written');
});

test('a late failed save of the old Book does not show "not saved" on the new Book', async () => {
  const clock = slowClock();
  try {
    const server = { saved: [] };
    const n = loadNotes({ libId: 'aaaaaaaaaaaa', server });
    await n.ui.reload();
    n.mark();
    await tick();
    n.posts.length = 0;                       // the old Book's save never answers
    n.ui.reset('bbbbbbbbbbbb');
    await n.ui.reload();
    clock.fire();                             // 30 s: the old save fails now
    for (let i = 0; i < 5; i++) await tick();
    assert.doesNotMatch(n.byId('notes').innerHTML, /was not saved/, 'the new Book shows no message of the old Book');
  } finally { clock.end(); }
});

test('a late good save of the old Book does not clear the "not saved" message of the new Book', async () => {
  const server = { saved: [] };
  const n = loadNotes({ libId: 'aaaaaaaaaaaa', server });
  await n.ui.reload();
  n.mark();
  await tick();
  const oldSave = n.posts.shift();            // the old Book's save waits
  n.ui.reset('bbbbbbbbbbbb');
  await n.ui.reload();
  n.mark();
  for (let i = 0; i < 3; i++) await tick();
  n.posts.shift().fail();                     // the new Book's save fails
  for (let i = 0; i < 3; i++) await tick();
  assert.match(n.byId('notes').innerHTML, /was not saved/);
  oldSave.arrive();                           // the old Book's save ends well, later
  for (let i = 0; i < 3; i++) await tick();
  assert.match(n.byId('notes').innerHTML, /was not saved/, 'the message of the new Book stays');
});

test('the read of a new Book does not wait for the saves of the old Book; the old saves still end', async () => {
  const server = { saved: [] };
  const n = loadNotes({ libId: 'aaaaaaaaaaaa', server });
  await n.ui.reload();
  n.mark();
  n.state.index = 2; n.state.at = 3;
  n.mark();
  await tick();
  assert.equal(n.posts.length, 1, 'the old Book: one save is sent, one waits');
  n.ui.reset('bbbbbbbbbbbb');
  const reading = n.ui.reload();
  let done = false; reading.then(() => { done = true; });
  for (let i = 0; i < 5; i++) await tick();
  assert.equal(done, true, 'the new Book is read at once');
  await n.deliver();
  assert.equal(server.saved.length, 2, 'both saves of the old Book still reach the voice server');
});

// ---- app.js ------------------------------------------------------------------------------------------------------
const APP_JS = fileURLToPath(new URL('../../extension/pdf/app.js', import.meta.url));

function fakeEngineClass(id, made) {
  return class {
    constructor() { made[id] = this; this.id = id; this.available = true; this.ready = true; this.calls = []; this.current = null; }
    async init() { this.ready = true; }
    listVoices() { return [{ id: 'v1', label: 'Voice one' }]; }
    speak(sentence, opts) { this.stop(); const call = { sentence, ...opts }; this.current = call; this.calls.push(call); return Promise.resolve(); }
    stop() { this.current = null; }
    prefetch() {}
  };
}
const sentence = (i) => ({ text: `Alpha beta gamma delta ${i}.`, spans: [{ page: 1, item: i }], charOwners: [], page: 1, sectionIndex: 0, pauseAfter: 300 });

function loadReader({ engine = 'system', search = '' } = {}) {
  const ids = {};
  const byId = (id) => (ids[id] ||= element(id));
  byId('rateSel').value = '1';
  const store = new Map([['pr.engine.chosen', engine]]);
  const parses = [];
  const fakes = { ocrFails: false };
  const made = {};
  const notes = { markHit: null, resets: [], why: [] };
  const docListeners = {};
  class PdfViewer {
    constructor() { this.pages = new Map(); this.zoom = 1; this.follow = true; }
    async load() {}
    highlight() {}
    highlightWord() {}
    clearWord() {}
    setZoom(z) { this.zoom = z; }
    relayout() {}
  }
  const modules = {
    pdfjsLib: { GlobalWorkerOptions: {}, getDocument: ({ data }) => ({ promise: new TextDecoder().decode(new Uint8Array(data).slice(0, 5)) === '%PDF-'
      ? Promise.resolve({ numPages: 1, destroy: async () => {}, getOutline: async () => null }) : Promise.reject(new Error('Invalid PDF structure.')) }) },
    PdfViewer,
    buildDocument: (doc, opts, progress) => new Promise((resolve) => parses.push({ progress, finish: resolve })),
    SystemEngine: fakeEngineClass('system', made),
    ServerEngine: fakeEngineClass('kokoro', made),
    loadLexicon: async () => {},
    repairStats: () => ({ repaired: 0 }),
    withOcr: async (doc) => { if (fakes.ocrFails) throw new Error('scan failed'); return doc; },
    setupNotes: () => ({ reload() {}, markdown() { return ''; }, reset(id, why) { notes.resets.push(id); notes.why.push(why); }, markAt: () => notes.markHit }),
    setupAsk: () => ({ reload() {}, highlightsChanged() {}, stopReading() {} }),
  };
  let src = readFileSync(APP_JS, 'utf8');
  src = src.replace(/^import \* as (\w+) from [^;]+;$/gm, 'const $1 = __modules.$1;')
    .replace(/^import \{([^}]+)\} from [^;]+;$/gm, 'const {$1} = __modules;')
    .replaceAll('import.meta.url', '"file:///reader/pdf/app.js"');
  const ctx = {
    __modules: modules,
    console: { log() {}, info() {}, warn() {}, error() {} },
    document: { getElementById: byId, createElement: () => element(), addEventListener: (t, f, capture) => (docListeners[t] ||= []).push({ f, capture }) },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    location: { search, href: 'http://127.0.0.1:8793/reader/index.html' + search },
    navigator: {},
    setTimeout: (fn, ms) => (ms ? 0 : setTimeout(fn, 0)), clearTimeout() {}, setInterval: () => 0,
    URL, URLSearchParams, File, TextDecoder, TextEncoder, crypto: globalThis.crypto,
    Worker: class { constructor() { throw new Error('no worker in a test'); } },
    fetch: async (url) => {   // only the library Book's file answers
      if (String(url).startsWith('/library/file/')) return { ok: true, arrayBuffer: async () => new TextEncoder().encode('%PDF-1.7 test').buffer };
      throw new Error('no network in a test');
    },
    getSelection: () => '',
    confirm: () => false,
    addEventListener() {},
    innerWidth: 1400,
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: APP_JS });
  // a key press on an element: the document listeners run (capture first, then bubble), as in the page
  const key = (target, code, k) => {
    const ev = { code, key: k, target, defaultPrevented: false, preventDefault() { ev.defaultPrevented = true; }, stopImmediatePropagation() {} };
    const all = docListeners.keydown || [];
    for (const { f } of [...all.filter((l) => l.capture), ...all.filter((l) => !l.capture)]) f(ev);
    return ev;
  };
  return { ctx, state: ctx.__pr, viewer: ctx.__viewer, els: ids, byId, parses, made, notes, key, docListeners, fakes };
}

async function readerWithBook(opts) {
  const r = loadReader(opts);
  await until(() => r.els.voiceSel.children.length, 'the boot');
  r.byId('fileInput').files = [new File(['%PDF-1.7 test'], 'book.pdf')];
  r.byId('fileInput').fire('change');
  await until(() => r.parses.length, 'the read-in');
  const list = Array.from({ length: 8 }, (_, i) => sentence(i));
  r.parses[0].finish({ sentences: list, sections: [] });
  await until(() => r.state.sentences === list, 'the end of the read-in');
  // the text of page 1: one span for each sentence
  const pageEl = { dataset: { page: '1' } };
  const spans = list.map(() => ({ closest: (s) => (s === '.page' ? pageEl : null) }));
  for (const s of spans) s.closest = ((sp) => (s) => (s === '.text-layer span' ? sp : s === '.page' ? pageEl : null))(s);
  r.viewer.pages.set(1, { spans: new Map(spans.map((s, i) => [i, s])) });
  r.clickWord = (i) => r.els.pages.fire('click', { target: spans[i], clientX: 10, clientY: 10 });
  return r;
}

test('a click on a word starts the reading there (the control case)', async () => {
  const r = await readerWithBook();
  r.clickWord(5);
  assert.equal(r.state.playing, true);
  assert.equal(r.state.index, 5);
});

test('a click on a saved highlight opens its menu and the reading does not move', async () => {
  const r = await readerWithBook();
  r.notes.markHit = { dataset: { id: 'x1' } };
  r.clickWord(5);
  assert.equal(r.state.playing, false, 'a stopped reading does not start');
  assert.equal(r.state.index, 0);
  r.byId('playBtn').fire('click');
  const reading = r.made.system.current;
  r.clickWord(6);
  assert.equal(r.state.playing, true, 'a reading goes on');
  assert.equal(r.state.index, 0, 'the reading does not move');
  assert.equal(r.made.system.current, reading, 'the same sentence goes on');
});

test('a new book clears the old highlights before its read-in starts', async () => {
  const r = await readerWithBook();
  const before = r.notes.resets.length;
  r.byId('fileInput').files = [new File(['%PDF-1.7 test'], 'other.pdf')];
  r.byId('fileInput').fire('change');
  await until(() => r.parses.length > 1, 'the second read-in');
  assert.equal(r.notes.resets.length, before + 1, 'notes.js reset() is called once for the new book');
  assert.equal(r.notes.resets.at(-1), '', 'a PDF that is not the library Book gets no library id');
});

test('the status shows the Mac voice from the first word after the voice server falls', async () => {
  const r = await readerWithBook({ engine: 'kokoro' });
  r.byId('playBtn').fire('click');
  const call = r.made.kokoro.current;
  assert.ok(call, 'the natural voice reads');
  r.made.kokoro.device = 'Mac voice (the natural voice does not answer)';   // tts.js: the server fell during this sentence
  call.onWord(0, 5);
  assert.match(r.els.engineStatus.textContent, /^Mac voice \(the natural voice does not answer\)$/);
  // the voice server answers again (tts.js sets device back to null): the next sentence shows the natural voice
  r.made.kokoro.device = null;
  r.byId('nextBtn').fire('click');
  r.made.kokoro.current.onWord(0, 5);
  assert.equal(r.els.engineStatus.textContent, 'Natural voice ready');
});

test('the library Book of the page gets its library id; a PDF opened after it gets none', async () => {
  const r = loadReader({ search: '?lib=0123456789ab&name=Invented&file=' + encodeURIComponent('/library/file/0123456789ab') });
  await until(() => r.parses.length, 'the read-in of the library Book');
  assert.deepEqual(r.notes.resets, ['0123456789ab']);
  r.byId('fileInput').files = [new File(['%PDF-1.7 other'], 'other.pdf')];
  r.byId('fileInput').fire('change');
  await until(() => r.parses.length > 1, 'the second read-in');
  assert.deepEqual(r.notes.resets, ['0123456789ab', ''], 'the other PDF keeps its highlights under its own key');
});

test('keys on the mark button: Space is Play or Pause once (no click), Enter is left to the button (it marks)', async () => {
  const r = await readerWithBook();
  const btn = r.byId('markBtn');
  const space = r.key(btn, 'Space', ' ');
  assert.equal(r.state.playing, true, 'Space starts the reading once');
  assert.equal(space.defaultPrevented, true, 'and stops the button\'s own click (no Highlight from Space)');
  const enter = r.key(btn, 'Enter', 'Enter');
  assert.equal(r.state.playing, true, 'Enter does not change the play state');
  assert.equal(enter.defaultPrevented, false, 'Enter is left to the button: its click marks (notes.js)');
  const keydowns = r.docListeners.keydown.filter((l) => l.capture);
  assert.equal(keydowns.length, 0, 'app.js listens to keys on the document in the bubble phase');
});

test('an open that fails before the PDF is read: the old Book and its highlights stay as they are', async () => {
  const r = await readerWithBook();
  const before = r.notes.resets.length;
  r.byId('fileInput').files = [new File(['plain text, not a PDF'], 'notes.txt')];
  r.byId('fileInput').fire('change');
  await until(() => r.els.parseText.textContent.includes('Could not open'), 'the message');
  assert.equal(r.notes.resets.length, before, 'no reset: the old Book keeps its highlights');
});

test('an open that fails after the old Book is gone: the highlights stay closed, with a true reason', async () => {
  const r = await readerWithBook();
  r.fakes.ocrFails = true;
  r.byId('fileInput').files = [new File(['%PDF-1.7 other'], 'other.pdf')];
  r.byId('fileInput').fire('change');
  await until(() => r.els.engineStatus.textContent.includes('Could not show'), 'the message');
  assert.equal(r.state.sentences.length, 0, 'the old Book\'s text is gone (app.js cleared it before the failure)');
  assert.match(r.notes.why.at(-1) || '', /No book is open/, 'notes.js gets the reason');
  assert.equal(r.notes.resets.at(-1), '', 'no library id');
});
