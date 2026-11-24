// The cross-out pen of the PDF reader (owner's choice of 24 Nov 2026: prototype variant C).
// Crossed-out text has a line through it on the page, and the reader leaves it out when "Skip crossed-out text" is on.
// extension/pdf/crossout.js gives the text that the voice says; notes.js keeps the crossed-out parts with the highlights.
// All text is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spokenText } from '../../extension/pdf/crossout.js';
import { setupNotes } from '../../extension/pdf/notes.js';

test('a crossed-out part of a sentence is not said, and each said letter knows its place in the sentence', () => {
  const t = 'The file goes deeper, with irrigation after each step.';
  const a = t.indexOf(', with'), b = t.indexOf('.');
  const s = spokenText(t, [{ a, b }]);
  assert.equal(s.text, 'The file goes deeper.');
  assert.equal(s.map.length, s.text.length);
  assert.equal(t[s.map[s.text.length - 1]], '.');
  assert.equal(s.map[s.text.indexOf('deeper')], t.indexOf('deeper'));
});

test('a part in the middle leaves one space, not two', () => {
  const t = 'A small hand file opens the way.';
  const s = spokenText(t, [{ a: t.indexOf('hand'), b: t.indexOf('hand') + 5 }]);
  assert.equal(s.text, 'A small file opens the way.');
});

test('a sentence crossed out whole, or all but its full stop, is not said at all', () => {
  const t = 'The author thanks the colleagues.';
  assert.equal(spokenText(t, [{ a: 0, b: t.length }]).text, '');
  assert.equal(spokenText(t, [{ a: 0, b: t.length - 1 }]).text, '');
});

test('the start point of a click on a word and a crossed-out part work together', () => {
  const t = 'One two three four five.';
  const s = spokenText(t, [{ a: 8, b: 14 }], 4);  // from "two", without "three "
  assert.equal(s.text, 'two four five.');
  assert.equal(s.map[0], 4);
});

test('no crossed-out part: the text is said as it is', () => {
  const t = 'Shaping starts with the coronal third.';
  const s = spokenText(t, []);
  assert.equal(s.text, t);
  assert.deepEqual(s.map, [...t].map((_, i) => i));
});

// ---- notes.js: crossed-out parts are kept with the highlights, but they are not highlights ----
function el(id) {
  const ls = {};
  let html = '';
  const e = { id, hidden: false, textContent: '', title: '', style: {}, dataset: {}, children: [], className: '', offsetWidth: 100,
    classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, getAttribute: () => null,
    set innerHTML(v) { html = String(v); this.children = []; }, get innerHTML() { return html; },
    insertAdjacentHTML(_, h) { html += h; }, appendChild(c) { this.children.push(c); return c; }, remove() {},
    contains: (x) => x === e, querySelectorAll: () => [], closest: () => null, focus() {},
    addEventListener(t, f) { (ls[t] ||= []).push(f); },
    fire(t, ev = {}) { const x = { target: e, preventDefault() {}, ...ev }; for (const f of ls[t] || []) f(x); return x; } };
  return e;
}
async function loadWith(saved) {
  const ids = {};
  const byId = (id) => (ids[id] ||= el(id));
  globalThis.document = { title: 'Invented', body: el('body'), getElementById: byId, createElement: () => el(''), addEventListener() {}, dispatchEvent() {} };
  const store = new Map([['ra2.notes.book-a', JSON.stringify(saved)]]);
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  globalThis.location = { origin: 'http://127.0.0.1:8793' };
  globalThis.getSelection = () => ({ rangeCount: 0, isCollapsed: true, toString: () => '', removeAllRanges() {} });
  globalThis.innerWidth = 1400;
  globalThis.fetch = () => Promise.reject(new Error('no voice server in this test'));
  const sentences = [{ text: 'The first line of the test.', charOwners: [] }, { text: 'Small green boxes sit here.', charOwners: [] }];
  const marks = [];
  const pages = el('pages'); pages.querySelectorAll = () => [];
  const ui = setupNotes({ state: { sentences, index: 0, at: 0, docKey: 'book-a', itemToSentence: new Map() },
    viewer: { setMarks: (m) => marks.push(m), pages: new Map() }, els: { pages, toc: el('toc'), sidebar: el('sidebar') },
    jumpTo() {}, wordPartsAt: () => [{}], libId: '' });
  ui.reload();
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  return { ui, byId, marks, store };
}
const note = (si, a, b, color, fp) => ({ id: 'n' + si + a + color, color, text: 'invented', page: 1, t: 1, segs: [{ si, a, b, fp }] });

test('notes.js gives the crossed-out parts of a sentence; they are not counted, listed or exported as highlights', async () => {
  const { ui, byId, marks } = await loadWith([
    note(1, 6, 12, 'cut', 'Small green boxes sit here.'),
    note(0, 0, 9, 'yellow', 'The first line of the test.'),
  ]);
  assert.deepEqual(ui.cutsOf(1), [{ a: 6, b: 12 }]);
  assert.deepEqual(ui.cutsOf(0), []);
  assert.equal(byId('notesTab').textContent, 'Highlights (1)');
  assert.equal(byId('notes').children.length, 1);
  assert.match(ui.markdown(), /1 highlights/);
  assert.doesNotMatch(ui.markdown(), /cut/);
  assert.ok(marks.at(-1).some((m) => m.color === 'cut'), 'the crossed-out part is drawn on the page');
  assert.match(byId('cutCount').textContent, /1 part crossed out/);
});

test('crossed-out parts stay on the page when "Show highlights on the page" is off', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  const { ui, byId, marks } = await loadWith([note(1, 6, 12, 'cut', 'Small green boxes sit here.'), note(0, 0, 9, 'yellow', 'The first line of the test.')]);
  byId('notes').fire('change', { target: { id: 'showMarks', checked: false } });
  assert.deepEqual(marks.at(-1).map((m) => m.color), ['cut']);
  assert.ok(ui);
});
