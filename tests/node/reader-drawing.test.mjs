// Tests for the page drawing of the reader (extension/pdf/viewer.js): the sentence mark after a zoom, the release of
// pages that left the screen, a render that ends after a zoom, the state of the last book, the word highlight retry,
// and the layout work of the text layer.
// The real viewer.js is imported. The page (DOM), the canvas, the IntersectionObserver and pdf.js are small fakes.
// The fake DOM counts layout passes: a read of a size after a write costs one pass.
// Run: node --test --test-timeout=120000 tests/node/reader-drawing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PdfViewer } from '../../extension/pdf/viewer.js';

const flush = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

// ---- fake DOM ---------------------------------------------------------------------------------------------------
const layout = { dirty: false, passes: 0 };
const write = () => { layout.dirty = true; };
const read = () => { if (layout.dirty) { layout.passes++; layout.dirty = false; } };
const styleObj = () => new Proxy({}, { set(o, k, v) { o[k] = v; write(); return true; } });

class Text {
  constructor(s) { this.textContent = s; this.parent = null; }
}
class El {
  constructor(tag) {
    this.tagName = tag; this.children = []; this.parent = null; this.style = styleObj(); this.dataset = {};
    this.className = ''; const cls = new Set(); this.classList = { add: (c) => cls.add(c), remove: (c) => cls.delete(c), contains: (c) => cls.has(c) };
  }
  appendChild(c) {
    const list = c.fragment ? c.children.splice(0) : [c];
    for (const x of list) { if (x.parent) x.remove(); x.parent = this; this.children.push(x); }
    write(); return c;
  }
  remove() { if (!this.parent) return; this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; write(); }
  get firstChild() { return this.children[0] || null; }
  get textContent() { return this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { for (const c of this.children) c.parent = null; this.children = v === '' ? [] : [new Text(String(v))]; this.children.forEach((c) => { c.parent = this; }); write(); }
  get isConnected() { let e = this; while (e.parent) e = e.parent; return e.root === true; }
  all() { return this.children.flatMap((c) => (c instanceof El ? [c, ...c.all()] : [])); }
  querySelectorAll(sel) { const c = sel.replace(/^\./, ''); return this.all().filter((e) => e.className.split(' ').includes(c)); }
  // Page n is at left 50, top 1000 * n (not at 0, so a box position is a real check). A span is at its style.left.
  getBoundingClientRect() {
    read();
    const page = pageOf(this);
    const left = page ? 50 : 0, top = page ? 1000 * Number(page.dataset.page) : 0;
    if (this.tagName !== 'span') return { left, top, right: left + 600, bottom: top + 800, width: 600, height: 800 };
    const x = left + parseFloat(this.style.left || 0), w = this.textContent.length * 5;
    return { left: x, top, right: x + w, bottom: top + 10, width: w, height: 10 };
  }
}
const pageOf = (e) => { while (e && !e.dataset?.page) e = e.parent; return e; };

const canvases = [];
globalThis.document = {
  hidden: false,
  addEventListener() {},
  createElement(tag) {
    const e = new El(tag);
    if (tag === 'canvas') { e.width = 0; e.height = 0; e.getContext = () => ({ scale() {} }); canvases.push(e); }
    return e;
  },
  createDocumentFragment() { const f = new El('#fragment'); f.fragment = true; return f; },
  createRange() {
    return {
      setStart(node, s) { this.node = node; this.s = s; }, setEnd(node, e) { this.e = e; }, detach() {},
      getClientRects() { const r = this.node.parent.getBoundingClientRect(); return [{ left: r.left + this.s * 5, top: r.top, width: (this.e - this.s) * 5, height: 10 }]; },
    };
  },
};
globalThis.window = { devicePixelRatio: 1 };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.requestAnimationFrame = (f) => setImmediate(f);

let observer = null;
globalThis.IntersectionObserver = class { constructor(cb) { this.cb = cb; observer = this; } observe() {} disconnect() {} };
const show = (viewer, visible) => observer.cb([...viewer.pages.values()].map(({ el }) => ({ target: el, isIntersecting: visible.includes(Number(el.dataset.page)) })));

// Live page pictures: canvases that still hold pixels. A released canvas has width 0.
const live = () => canvases.filter((c) => c.width > 0 && c.height > 0);
const bytes = () => live().reduce((s, c) => s + c.width * c.height * 4, 0);

// ---- fake pdf.js --------------------------------------------------------------------------------------------------
const pdfjsLib = { Util: { transform: (m, t) => [t[0] * m[0], 0, 0, t[3] * m[0], t[4] * m[0], t[5] * m[0]] } };

// A made book. Each page has `lines` made lines of text. mode 'now': a render ends at once; 'wait': the test ends it.
// cleanup() works like pdf.js 4.10 (vendor/pdf.mjs, #tryCleanup): it gives false while the page is busy, and frees
// nothing then. This fake does not try again later by itself, so the reader must call it when the page is idle.
function makeBook(pages, { lines = 3, mode = 'now', fail = () => false } = {}) {
  const stats = { renders: 0, cancels: 0, cleanups: 0, getPage: 0, waiting: [], cleaned: new Set(), busy: new Map() };
  const busy = (n, d) => stats.busy.set(n, (stats.busy.get(n) || 0) + d);
  const work = (n, promise) => { busy(n, 1); promise.then(() => busy(n, -1), () => busy(n, -1)); return promise; };
  const cache = new Map();
  const page = (n) => cache.get(n) || cache.set(n, {
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale, scale, transform: [scale, 0, 0, -scale, 0, 800 * scale] }),
    render: ({ viewport }) => {
      stats.renders++;
      let ok, no;
      const promise = work(n, new Promise((a, b) => { ok = a; no = b; }));
      const task = { promise, scale: viewport.scale, page: n, cancel() { stats.cancels++; no(new Error('cancelled')); } };
      if (mode === 'now') ok(); else stats.waiting.push({ task, end: ok });
      return task;
    },
    getTextContent: () => work(n, Promise.resolve({
      styles: {},
      items: Array.from({ length: lines }, (_, i) => ({ str: `made line ${i} of page ${n}`, width: 100, fontName: 'f', transform: [10, 0, 0, 10, 20, 700 - i * 20] })),
    })),
    cleanup() { stats.cleanups++; if (stats.busy.get(n)) return false; stats.cleaned.add(n); return true; },
  }).get(n);
  const doc = {
    numPages: pages,
    getPage: async (n) => { stats.getPage++; if (fail(n)) throw new Error('page cannot draw'); return page(n); },
  };
  return { doc, stats };
}

function makeViewer() {
  const scroller = new El('div');
  scroller.root = true;
  Object.assign(scroller, { scrollTop: 0, scrollHeight: 1000, scrollBy() {} });
  const container = new El('div');
  container.clientWidth = 632; // fit-to-width scale 1
  scroller.appendChild(container);
  Object.defineProperty(container, 'parentElement', { get: () => scroller });
  return new PdfViewer(pdfjsLib, container);
}

const speaking = (viewer, page, item) => viewer.pages.get(page).spans.get(item)?.classList.contains('speaking');

// ---- tests --------------------------------------------------------------------------------------------------------

test('zoom while it reads: the sentence mark stays (audit 4)', async () => {
  const v = makeViewer();
  const { doc } = makeBook(5);
  await v.load(doc);
  show(v, [1, 2]);
  await flush();
  const sentence = [{ page: 1, item: 0 }, { page: 1, item: 1 }];
  await v.highlight(sentence, { follow: false });
  v.follow = false;
  v.highlightWord([{ page: 1, item: 0, start: 2, end: 6 }]);
  assert.ok(speaking(v, 1, 0));
  assert.equal(v.wordBoxes.length, 1);
  assert.equal(v.wordBoxes[0].style.left, (20 + 2 * 5) + 'px', 'the word box sits on its glyphs (span at 20 px)');

  v.setZoom(2);
  await flush();
  assert.equal(v.scale, 2);
  assert.equal(v.highlighted.length, 2, 'the sentence is still known after the zoom');
  assert.ok(speaking(v, 1, 0) && speaking(v, 1, 1), 'the new spans carry the sentence mark');
  assert.equal(v.wordBoxes.length, 1, 'the word box is drawn again after the zoom');
  assert.ok(v.wordBoxes[0].isConnected, 'the word box is on the page');
  assert.equal(v.wordBoxes[0].style.left, (20 * 2 + 2 * 5) + 'px', 'the word box is at the new scale (span at 40 px)');
  assert.equal(v.lastWordBox, v.wordBoxes[0]);

  // The guard "do not release the page that is read" still works.
  show(v, [4, 5]);
  await flush();
  assert.ok(v.pages.get(1).rendered, 'the page that is read stays drawn');
});

test('a resize while it reads also keeps the sentence mark', async () => {
  const v = makeViewer();
  const { doc } = makeBook(3);
  await v.load(doc);
  show(v, [1]);
  await flush();
  await v.highlight([{ page: 1, item: 2 }], { follow: false });
  v.container.clientWidth = 900;
  await v.relayout();
  await flush();
  assert.ok(speaking(v, 1, 2));
});

test('fast scroll through 300 pages: few live page pictures, renders that left the screen are cancelled (audit 5)', async () => {
  canvases.length = 0;
  const v = makeViewer();
  const { doc, stats } = makeBook(300, { mode: 'wait' });
  await v.load(doc);
  // The scroll bar is dragged: each step shows 3 pages, and the renders do not end before the next step.
  for (let top = 1; top <= 298; top++) { show(v, [top, top + 1, top + 2]); await flush(2); }
  await flush();
  // Now all renders that are still waiting end (a cancelled one ended already with an error).
  for (const w of stats.waiting.splice(0)) w.end();
  await flush();
  for (const w of stats.waiting.splice(0)) w.end();
  await flush();

  const drawn = [...v.pages.values()].filter((e) => e.rendered).length;
  assert.ok(drawn <= 3, 'drawn pages: ' + drawn);
  assert.ok(live().length <= 3, 'live page pictures: ' + live().length);
  assert.ok(bytes() <= 3 * 600 * 800 * 4, 'bytes of canvas kept: ' + bytes());
  assert.ok(stats.cancels >= 290, 'renders cancelled: ' + stats.cancels);
  assert.ok(stats.cleaned.size >= 290, 'pages that gave their pdf.js memory back: ' + stats.cleaned.size);

  // A second pass over the book does not keep more.
  for (let top = 1; top <= 298; top += 1) { show(v, [top, top + 1, top + 2]); await flush(2); }
  for (const w of stats.waiting.splice(0)) w.end();
  await flush();
  assert.ok(live().length <= 3, 'live page pictures after a second pass: ' + live().length);
});

test('a drawn page that leaves the screen gives its canvas back', async () => {
  canvases.length = 0;
  const v = makeViewer();
  const { doc } = makeBook(10);
  await v.load(doc);
  show(v, [1, 2]);
  await flush();
  assert.equal(live().length, 2);
  show(v, [9]);
  await flush();
  assert.equal(live().length, 1, 'only the page on screen keeps a picture');
});

test('zoom while pages draw: each page shows at the new scale only (audit 17)', async () => {
  const v = makeViewer();
  const { doc, stats } = makeBook(4, { mode: 'wait' });
  await v.load(doc);
  show(v, [1, 2]);
  await flush();
  assert.equal(stats.waiting.length, 2);
  const old = stats.waiting.splice(0);

  v.setZoom(2);
  await flush();
  const fresh = stats.waiting.splice(0);
  assert.equal(fresh.length, 2, 'the pages that were drawing are drawn again at the new scale');
  // The new renders end first, then the old ones end late.
  for (const w of fresh) w.end();
  await flush();
  for (const w of old) w.end();
  await flush();

  for (const n of [1, 2]) {
    const e = v.pages.get(n);
    assert.ok(e.rendered);
    const canvases = e.el.children.filter((c) => c.tagName === 'canvas');
    assert.equal(canvases.length, 1, 'one picture on page ' + n);
    assert.equal(canvases[0], e.canvas);
    assert.equal(e.el.style.width, Math.floor(600 * v.scale) + 'px', 'page ' + n + ' has the new size');
    assert.equal(canvases[0].width, Math.floor(600 * v.scale), 'page ' + n + ' picture is at the new scale');
  }
});

test('open a second PDF: nothing of the first PDF shows (audit 16)', async () => {
  const v = makeViewer();
  const a = makeBook(5);
  await v.load(a.doc);
  show(v, [1]);
  await flush();
  v.setMarks([{ id: 'm1', color: 'yellow', parts: [{ page: 1, item: 0, start: 0, end: 4 }] }]);
  await v.highlight([{ page: 1, item: 1 }], { follow: false });
  v.highlightWord([{ page: 1, item: 1, start: 0, end: 4 }]);
  assert.equal(v.pages.get(1).el.querySelectorAll('.mark-box').length, 1);

  const b = makeBook(5);
  await v.load(b.doc);
  show(v, [1]);
  await flush();
  assert.equal(v.pages.get(1).el.querySelectorAll('.mark-box').length, 0, 'no saved highlight of the first PDF');
  assert.deepEqual(v.highlighted, []);
  assert.deepEqual(v.wordBoxes, []);
  assert.equal(v.lastWordBox, null);
  assert.ok(!speaking(v, 1, 1));
});

test('a page that cannot draw does not start a loop without end (audit 15)', async () => {
  const v = makeViewer();
  const { doc, stats } = makeBook(5, { fail: (n) => n === 3 });
  const errors = console.error;
  console.error = () => {};
  try {
    await v.load(doc);
    v.highlightWord([{ page: 3, item: 0, start: 0, end: 4 }]);
    await flush(200);
    assert.ok(stats.getPage <= 3, 'tries to draw the broken page: ' + stats.getPage);
  } finally { console.error = errors; }
});

test('a late word highlight does not cover a newer word', async () => {
  const v = makeViewer();
  const { doc, stats } = makeBook(5, { mode: 'wait' });
  await v.load(doc);
  v.highlightWord([{ page: 4, item: 0, start: 0, end: 4 }]); // page 4 is not drawn yet
  await flush();
  v.clearWord(); // the reading stops
  for (const w of stats.waiting.splice(0)) w.end();
  await flush();
  assert.equal(v.wordBoxes.length, 0, 'the old word does not come back');
});

test('the text layer is built with one read pass and one write pass (audit 13)', async () => {
  const v = makeViewer();
  const { doc } = makeBook(1, { lines: 200 });
  await v.load(doc);
  const page = await doc.getPage(1);
  const host = document.createElement('div');
  v.container.appendChild(host);
  layout.passes = 0; layout.dirty = true;
  const spans = v.buildTextLayer(await page.getTextContent(), page.getViewport({ scale: 1 }), host);
  assert.equal(spans.size, 200);
  assert.ok(layout.passes <= 1, 'layout passes for 200 spans: ' + layout.passes);
  assert.match(spans.get(0).style.transform, /^scaleX\(/);
});

test('saved highlights and the word box are drawn with one layout pass', async () => {
  const v = makeViewer();
  const { doc } = makeBook(1, { lines: 20 });
  await v.load(doc);
  show(v, [1]);
  await flush();
  const marks = Array.from({ length: 10 }, (_, i) => ({ id: 'm' + i, color: 'yellow', parts: [{ page: 1, item: i, start: 0, end: 4 }] }));
  layout.passes = 0;
  v.setMarks(marks);
  assert.equal(v.pages.get(1).el.querySelectorAll('.mark-box').length, 10);
  assert.ok(layout.passes <= 1, 'layout passes for 10 saved highlights: ' + layout.passes);

  v.follow = false; // keepInView must read the new box after it is drawn: that read is needed and not counted here
  layout.passes = 0;
  v.highlightWord([1, 2, 3, 4, 5].map((i) => ({ page: 1, item: i, start: 0, end: 4 })));
  assert.equal(v.wordBoxes.length, 5);
  assert.ok(layout.passes <= 1, 'layout passes for a word in 5 parts: ' + layout.passes);
});

test('zoom: a page on screen never goes white; the old picture stays until the new one is ready (review 2)', async () => {
  canvases.length = 0;
  const v = makeViewer();
  const { doc, stats } = makeBook(4, { mode: 'wait' });
  await v.load(doc);
  show(v, [1, 2]);
  await flush();
  for (const w of stats.waiting.splice(0)) w.end();
  await flush();
  const shows = (n) => v.pages.get(n).el.children.some((c) => c.tagName === 'canvas' && c.width > 0);
  assert.ok(shows(1) && shows(2));

  v.setZoom(1.5);
  for (let i = 0; i < 20; i++) { assert.ok(shows(1) && shows(2), 'a picture on each page, step ' + i); await flush(1); }
  v.setZoom(2); // a second zoom before the first new pictures are ready
  for (let i = 0; i < 20; i++) { assert.ok(shows(1) && shows(2), 'a picture on each page after the second zoom, step ' + i); await flush(1); }
  const old = v.pages.get(1).el.children.find((c) => c.tagName === 'canvas');
  assert.equal(old.style.width, Math.floor(600 * 2) + 'px', 'the old picture is stretched to the new size');

  for (const w of stats.waiting.splice(0)) w.end();
  await flush();
  for (const n of [1, 2]) {
    const pics = v.pages.get(n).el.children.filter((c) => c.tagName === 'canvas');
    assert.equal(pics.length, 1, 'only the new picture on page ' + n);
    assert.equal(pics[0].width, 1200);
  }
  assert.equal(live().length, 2, 'the old pictures gave their memory back');
});

test('a page that left the screen while it was read is released when the reading moves on (review 3)', async () => {
  canvases.length = 0;
  const v = makeViewer();
  const { doc } = makeBook(10);
  await v.load(doc);
  show(v, [1]);
  await flush();
  await v.highlight([{ page: 1, item: 0 }], { follow: false });
  show(v, [5]); // you scroll away; page 1 stays, because it is read
  await flush();
  assert.ok(v.pages.get(1).rendered);
  await v.highlight([{ page: 5, item: 0 }], { follow: false });
  assert.ok(!v.pages.get(1).rendered, 'page 1 is released when the next sentence is on page 5');
  assert.equal(live().length, 1);

  show(v, [8]);
  await flush();
  assert.ok(v.pages.get(5).rendered, 'page 5 is read: it stays');
  v.clearHighlight();
  assert.ok(!v.pages.get(5).rendered, 'page 5 is released when the reading stops');
  assert.equal(live().length, 1);
});

test('a page that is read off screen is not drawn again for each sentence', async () => {
  const v = makeViewer();
  const { doc, stats } = makeBook(10);
  await v.load(doc);
  show(v, [1]);
  await flush();
  await v.highlight([{ page: 1, item: 0 }], { follow: false });
  show(v, [5]);
  await flush();
  const before = stats.renders;
  await v.highlight([{ page: 1, item: 1 }], { follow: false });
  await v.highlight([{ page: 1, item: 2 }], { follow: false });
  assert.equal(stats.renders, before, 'no new render of page 1');
  assert.ok(speaking(v, 1, 2));
});

test('pdf.js memory of a page is freed after its busy render ends (review 4)', async () => {
  const v = makeViewer();
  const { doc, stats } = makeBook(10, { mode: 'wait' });
  await v.load(doc);
  show(v, [1]);
  await flush();
  show(v, [9]); // page 1 leaves while it draws: its render is cancelled, and cleanup gives false at this moment
  assert.ok(stats.cleanups >= 1 && !stats.cleaned.has(1), 'the fake refuses while the page is busy');
  await flush(); // the cancelled render ends
  for (const w of stats.waiting.splice(0)) w.end();
  await flush();
  assert.ok(stats.cleaned.has(1), 'page 1 is cleaned in the end');
});

test('saved highlights set before a new book loads do not show; the next setMarks shows them (review 5)', async () => {
  const v = makeViewer();
  await v.load(makeBook(3).doc);
  v.setMarks([{ id: 'old', color: 'yellow', parts: [{ page: 1, item: 0, start: 0, end: 4 }] }]);
  await v.load(makeBook(3).doc);
  show(v, [1]);
  await flush();
  assert.equal(v.pages.get(1).el.querySelectorAll('.mark-box').length, 0);
  v.setMarks([{ id: 'new', color: 'blue', parts: [{ page: 1, item: 1, start: 0, end: 4 }] }]);
  const boxes = v.pages.get(1).el.querySelectorAll('.mark-box');
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].dataset.id, 'new');
});

test('saved highlights and the word box come back when a released page is drawn again (review 6)', async () => {
  const v = makeViewer();
  const { doc } = makeBook(10);
  await v.load(doc);
  v.follow = false;
  show(v, [3]);
  await flush();
  v.setMarks([{ id: 'm', color: 'yellow', parts: [{ page: 3, item: 1, start: 5, end: 9 }] }]);
  v.highlightWord([{ page: 3, item: 2, start: 3, end: 7 }]);
  const where = () => {
    const el = v.pages.get(3).el;
    const mark = el.querySelectorAll('.mark-box')[0], word = el.querySelectorAll('.word-box')[0];
    return mark && word && [mark.style.left, mark.style.top, mark.style.width, word.style.left, word.style.width];
  };
  // The page is at left 50, top 3000; the spans at left 20; a box is placed from the page corner.
  const expected = ['45px', '0px', '20px', '35px', '20px'];
  assert.deepEqual(where(), expected);

  show(v, [8]);
  await flush();
  assert.ok(!v.pages.get(3).rendered, 'page 3 is released');
  assert.equal(where(), undefined);
  show(v, [3]);
  await flush();
  assert.deepEqual(where(), expected, 'both boxes are back at the same place');
  assert.equal(v.wordBoxes.length, 1);
});
