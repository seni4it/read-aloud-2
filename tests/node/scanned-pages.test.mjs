// Tests for scanned pages (extension/pdf/ocr.js): the reader gets the text of a scanned page from the voice server.
// The real ocr.js is imported. The page, the canvas and fetch() are fakes; no voice server is asked.
// Run: node --test --test-timeout=120000 tests/node/scanned-pages.test.mjs
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { withOcr } from '../../extension/pdf/ocr.js';

const flush = async (n = 50) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

// A fake canvas: the test can see if its picture is released after it is sent.
const canvases = [];
globalThis.document = {
  createElement() {
    const ctx = { fillRect() {} };
    const c = { width: 0, height: 0, getContext: () => ctx, toBlob(ok) { ok({ page: ctx.page }); } };
    canvases.push(c);
    return c;
  },
};

// A scanned book: every page is a picture with no text of its own.
// render: what page.render() does (default: it ends at once). loadingTask.destroyed is the pdf.js sign of a closed book.
function scannedBook(pages, render = () => Promise.resolve()) {
  const page = (n) => ({
    n,
    getTextContent: async () => ({ items: [], styles: {} }),
    getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale, convertToPdfPoint: (x, y) => [x, y] }),
    render: ({ canvasContext }) => { canvasContext.page = n; return { promise: render(n), cancel() {} }; },
  });
  return { numPages: pages, loadingTask: { destroyed: false }, getPage: async (n) => page(n) };
}
const close = (doc) => { doc.loadingTask.destroyed = true; };

// The voice server: `answer` decides what each POST /ocr gives.
function fakeServer(answer) {
  const asked = [];
  let open = 0, most = 0;
  globalThis.fetch = (url, opts = {}) => {
    asked.push(opts.body?.page);
    open++; most = Math.max(most, open);
    const done = (v) => { open--; return v; };
    return new Promise((ok, fail) => {
      opts.signal?.addEventListener('abort', () => fail(done(opts.signal.reason)));
      answer(asked.length, (v) => ok(done(v)), (e) => fail(done(e)), opts.body?.page);
    });
  };
  return { asked, most: () => most };
}
const oneLine = (word) => ({ ok: true, json: async () => ({ lines: [{ box: [0.1, 0.5, 0.5, 0.02], words: [{ text: word, box: [0.1, 0.5, 0.2, 0.02] }] }] }) });

test('a scanned book of 300 pages: in the first 10 seconds at most 3 recognitions are asked', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const server = fakeServer((k, ok) => ok(oneLine('word' + k)));
  const doc = await withOcr(scannedBook(300));
  assert.equal(doc.__scanned, true);
  const text = await (await doc.getPage(1)).getTextContent();
  assert.equal(text.items[0].str, 'word1');
  for (let ms = 0; ms < 10000; ms += 500) { mock.timers.tick(500); await flush(); }
  assert.ok(server.asked.length <= 3, 'recognitions asked: ' + server.asked.length);
  assert.deepEqual(server.asked, [1, 2, 3]);
  close(doc);
});

test('scanned pages are recognised one page at a time', async () => {
  const waiting = [];
  const server = fakeServer((k, ok) => waiting.push(() => ok(oneLine('w'))));
  const doc = await withOcr(scannedBook(300));
  (await doc.getPage(1)).getTextContent();
  await flush();
  for (let i = 0; i < 5 && waiting.length; i++) { waiting.shift()(); await flush(); }
  assert.equal(server.most(), 1);
  assert.equal(server.asked.length, 3);
  close(doc);
});

test('the page picture is released after it is sent', async () => {
  fakeServer((k, ok) => ok(oneLine('w')));
  canvases.length = 0;
  const doc = await withOcr(scannedBook(1));
  await (await doc.getPage(1)).getTextContent();
  assert.ok(canvases.length >= 1);
  for (const c of canvases) assert.equal(c.width * c.height, 0, 'canvas still holds its picture');
});

test('a voice server that does not answer gives a message after at most 60 seconds', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  fakeServer(() => {});  // never answers
  const notes = [];
  const doc = await withOcr(scannedBook(300), (m) => notes.push(m));
  const read = (await doc.getPage(1)).getTextContent();
  await flush();
  mock.timers.tick(60000);
  await flush();
  const text = await read;
  assert.deepEqual(text.items, []);
  assert.ok(notes.some((m) => /Page 1: no text found .*60 seconds/.test(m)), 'messages: ' + notes.join(' | '));
  close(doc);
});

test('a voice server that does not answer: a page in the queue also gives its message within 60 seconds', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  fakeServer(() => {});
  const notes = [];
  const doc = await withOcr(scannedBook(300), (m) => notes.push(m));
  (await doc.getPage(1)).getTextContent();
  await flush();
  mock.timers.tick(60000);
  await flush();
  // Page 3 never went to the voice server: its message says that it waited, not that the server did not answer.
  assert.ok(notes.some((m) => /Page 3: no text found \(it waited 60 seconds behind other pages\)/.test(m)), 'messages: ' + notes.join(' | '));
  close(doc);
});

test('a page that failed one time is tried again when it is wanted again', async () => {
  const server = fakeServer((k, ok, fail) => (k === 1 ? fail(new TypeError('Failed to fetch')) : ok(oneLine('again'))));
  const doc = await withOcr(scannedBook(1));
  const page = await doc.getPage(1);
  assert.deepEqual((await page.getTextContent()).items, []);
  const again = await page.getTextContent();
  assert.equal(again.items[0].str, 'again');
  assert.equal(server.asked.length, 2);
});

test('after a request with no answer the queue goes on: page 2 is asked and its text arrives', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const server = fakeServer((k, ok) => { if (k > 1) ok(oneLine('page' + k)); });  // silent for the first POST only
  const doc = await withOcr(scannedBook(300));
  (await doc.getPage(1)).getTextContent();
  await flush();
  mock.timers.tick(60000);
  await flush();
  const text = await (await doc.getPage(2)).getTextContent();
  assert.equal(text.items[0].str, 'page2');
  assert.ok(server.asked.includes(2));
  close(doc);
});

test('a page picture that is never drawn does not hold the queue: after 60 seconds the next page is read', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const server = fakeServer((k, ok) => ok(oneLine('drawn')));
  const notes = [];
  const doc = await withOcr(scannedBook(300, (n) => (n === 1 ? new Promise(() => {}) : Promise.resolve())), (m) => notes.push(m));
  const first = (await doc.getPage(1)).getTextContent();
  await flush();
  mock.timers.tick(60000);
  await flush();
  assert.deepEqual((await first).items, []);
  assert.ok(notes.some((m) => /Page 1: no text found/.test(m)), 'messages: ' + notes.join(' | '));
  const text = await (await doc.getPage(2)).getTextContent();
  assert.equal(text.items[0].str, 'drawn');
  assert.ok(server.asked.includes(2));
  close(doc);
});

test('a closed book sends no more pages: the pages in the queue of the old book are skipped', async () => {
  const waiting = [];
  const server = fakeServer((k, ok, fail, page) => waiting.push(() => ok(oneLine('p' + page))));
  const notes = [];
  const old = await withOcr(scannedBook(300), (m) => notes.push(m));
  (await old.getPage(1)).getTextContent();
  await flush();
  assert.deepEqual(server.asked, [1]);  // pages 2 and 3 wait in the queue
  close(old);  // app.js: old.destroy() when another file is opened
  const book = await withOcr(scannedBook(300));
  const reading = (await book.getPage(10)).getTextContent();
  await flush();
  while (waiting.length) { waiting.shift()(); await flush(); }
  assert.equal((await reading).items[0].str, 'p10');
  assert.deepEqual(server.asked, [1, 10, 11, 12]);
  assert.ok(!notes.some((m) => /no text found/.test(m)), 'a closed book gives no message: ' + notes.join(' | '));
  close(book);
});

test('a read-ahead page that failed is not asked again by read-ahead, only when the reader wants it', async () => {
  const server = fakeServer((k, ok, fail, page) => (page === 2 && k <= 2 ? fail(new TypeError('Failed to fetch')) : ok(oneLine('p' + page))));
  const doc = await withOcr(scannedBook(300));
  const page1 = await doc.getPage(1);
  await page1.getTextContent();
  await flush();
  assert.deepEqual(server.asked, [1, 2, 3]);  // page 2 failed as a read-ahead page
  await page1.getTextContent();  // the reader asks page 1 again
  await flush();
  assert.deepEqual(server.asked, [1, 2, 3], 'read-ahead asked a failed page again');
  const text = await (await doc.getPage(2)).getTextContent();  // the reader wants page 2 itself
  assert.equal(text.items[0].str, 'p2');
  assert.deepEqual(server.asked.filter((p) => p === 2).length, 2);
  close(doc);
});

// A page set with /Rotate 90 (pdf.js): the viewport is the turned page (800 x 600 here), and a point of the
// viewport goes back to the unturned sheet as (x, y) -> (y, x). The words of the picture run along the viewport.
// An upright page as pdf.js gives it: the viewport y runs down, the PDF y runs up: (x, y) -> (x, 800 - y).
function turnedBook(turned = true) {
  const page = {
    getTextContent: async () => ({ items: [], styles: {} }),
    getViewport: ({ scale }) => (turned ? { width: 800 * scale, height: 600 * scale, rotation: 90, convertToPdfPoint: (x, y) => [y, x] }
      : { width: 600 * scale, height: 800 * scale, rotation: 0, convertToPdfPoint: (x, y) => [x, 800 - y] }),
    render: () => ({ promise: Promise.resolve(), cancel() {} }),
  };
  return { numPages: 1, loadingTask: { destroyed: false }, getPage: async () => page };
}
const twoWords = { ok: true, json: async () => ({ lines: [{ box: [0.1, 0.5, 0.5, 0.02],
  words: [{ text: 'alpha', box: [0.1, 0.5, 0.2, 0.02] }, { text: 'beta', box: [0.35, 0.5, 0.2, 0.02] }] }] }) };

test('the words of a scanned page get the page rotation: on an upright page they run along x', async () => {
  fakeServer((k, ok) => ok(twoWords));
  const doc = await withOcr(turnedBook(false));
  const { items } = await (await doc.getPage(1)).getTextContent();
  const [a, b, c, d] = items[0].transform;
  assert.deepEqual([a, b, c, d].map((v) => Math.round(v * 100) / 100 + 0), [a, 0, 0, a]);
  assert.ok(a > 0);
  close(doc);
});

test('the words of a scanned page get the page rotation: on a page turned 90 degrees they run along the turned line', async () => {
  fakeServer((k, ok) => ok(twoWords));
  const doc = await withOcr(turnedBook());
  const { items } = await (await doc.getPage(1)).getTextContent();
  const [a, b, c, d, e, f] = items[0].transform;
  const size = Math.hypot(a, b);
  assert.ok(size > 0);
  // the text direction on the unturned sheet: one quarter turn (pdf.js items of a /Rotate 90 page look the same)
  assert.deepEqual([a, b, c, d].map((v) => Math.round((v / size) * 100) / 100 + 0), [0, 1, -1, 0]);
  // the second word is further along the line: on the unturned sheet that is further up (y), at the same x
  const [, , , , e2, f2] = items[1].transform;
  assert.ok(f2 > f, 'the next word is further along the line');
  assert.equal(Math.round(e2), Math.round(e));
  close(doc);
});
