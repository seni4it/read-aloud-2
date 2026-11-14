// Tests for the transport of the reader (extension/pdf/app.js): Play, Pause, the seek bar, speed, voice, Preview,
// opening a file, the read-in of a document and a failed sentence.
// app.js is an ES module. Its import lines are taken out and the same names come from fakes; the rest of the file
// runs as it is, in a node:vm context with a small fake page, a fake voice and fake timers.
// Run: node --test --test-timeout=120000 tests/node/reader-transport.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as language from '../../extension/pdf/language.js';  // ticket 32: app.js imports it

const APP_JS = fileURLToPath(new URL('../../extension/pdf/app.js', import.meta.url));
const tick = () => new Promise((r) => setTimeout(r, 0));
async function until(cond, what) {
  for (let i = 0; i < 500; i++) { if (cond()) return; await tick(); }
  throw new Error('waited too long for: ' + what);
}

// One fake element of the page.
function element(id) {
  const listeners = {};
  const attrs = {};
  const el = {
    id, value: '', textContent: '', hidden: false, disabled: false, checked: false, title: '', max: '',
    style: {}, dataset: {}, children: [], files: [],
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return attrs[k] ?? null; },
    set innerHTML(_) { this.children = []; },
    get innerHTML() { return ''; },
    appendChild(c) { this.children.push(c); return c; },
    matches() { return false; },
    closest() { return null; },
    click() {},
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    fire(t, e = {}) { return (listeners[t] || []).map((f) => f({ target: el, preventDefault() {}, ...e })); },
  };
  return el;
}

// A fake voice. Like the real engines, a new speak() or a stop() makes the old sentence silent: its callbacks never come.
function fakeEngineClass(id, made) {
  return class {
    constructor() { made[id] = this; this.id = id; this.available = true; this.ready = true; this.calls = []; this.current = null; }
    async init() { this.ready = true; }
    listVoices() { return [{ id: 'v1', label: 'Voice one' }, { id: 'v2', label: 'Voice two' }]; }
    speak(sentence, opts) { this.stop(); const call = { sentence, ...opts }; this.current = call; this.calls.push(call); return Promise.resolve(); }
    stop() { this.current = null; }
    prefetch() {}
  };
}

// A paragraph: "Alpha beta gamma delta." The word "gamma" starts at character 11.
const sentence = (i, word = 'Alpha') => ({ text: `${word} beta gamma delta ${i}.`, spans: [{ page: 1, item: i }], charOwners: [], page: 1, sectionIndex: 0, pauseAfter: 300 });
const sentences = (n, word) => Array.from({ length: n }, (_, i) => sentence(i, word));

function loadReader() {
  const ids = {};
  const byId = (id) => (ids[id] ||= element(id));
  byId('empty').hidden = false;
  byId('player').hidden = true;
  byId('parseBar').hidden = true;
  byId('rateSel').value = '1';

  const timers = [];
  const fakeSetTimeout = (fn, ms = 0) => {
    if (!ms) return setTimeout(fn, 0);   // "let the UI breathe": a real turn of the event loop
    const t = { fn, ms, live: true };
    timers.push(t);
    return t;
  };
  const fakeClearTimeout = (t) => { if (t && typeof t === 'object' && 'live' in t) t.live = false; else clearTimeout(t); };
  const runTimers = (maxMs) => { for (const t of timers.splice(0)) { if (t.live && t.ms <= maxMs) { t.live = false; t.fn(); } else if (t.live) timers.push(t); } };

  const store = new Map([['pr.engine.chosen', 'system']]);
  const docs = [];
  const parses = [];
  const highlights = [];
  const fakes = { lexiconGate: null, outlineGate: null, blockPositions: false };
  const made = {};

  const pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument({ data }) {
      const head = new TextDecoder().decode(new Uint8Array(data).slice(0, 5));
      if (head !== '%PDF-') return { promise: Promise.reject(new Error('Invalid PDF structure.')) };
      const doc = { numPages: 9, destroyed: false, destroy() { this.destroyed = true; return Promise.resolve(); }, getOutline: async () => { if (fakes.outlineGate) await fakes.outlineGate; return null; } };
      docs.push(doc);
      return { promise: Promise.resolve(doc) };
    },
  };
  class PdfViewer {
    constructor() { this.pages = new Map(); this.zoom = 1; this.follow = true; this.loaded = []; }
    async load(doc) { this.loaded.push(doc); }
    highlight(spans, opts) { highlights.push({ spans, opts }); }
    highlightWord() {}
    clearWord() {}
    setZoom(z) { this.zoom = z; }
    relayout() {}
  }
  const modules = {
    pdfjsLib, PdfViewer,
    buildDocument: (doc, opts, progress) => new Promise((resolve, reject) => parses.push({ doc, progress, finish: resolve, fail: reject })),
    SystemEngine: fakeEngineClass('system', made),
    ServerEngine: fakeEngineClass('kokoro', made),
    loadLexicon: async () => { if (fakes.lexiconGate) await fakes.lexiconGate; },
    repairStats: () => ({ repaired: 0 }),
    withOcr: async (doc) => doc,
    setupNotes: () => ({ reload() {}, markdown() { return ''; }, reset() {}, markAt: () => null }),
    setupAsk: () => ({ reload() {}, highlightsChanged() {}, stopReading() {} }),
    ...language,  // ticket 32
  };

  // The import lines become one line that takes the same names from the fakes.
  let src = readFileSync(APP_JS, 'utf8');
  src = src.replace(/^import \* as (\w+) from [^;]+;$/gm, 'const $1 = __modules.$1;')
    .replace(/^import \{([^}]+)\} from [^;]+;$/gm, 'const {$1} = __modules;')
    .replaceAll('import.meta.url', '"file:///reader/pdf/app.js"');
  assert.doesNotMatch(src, /^import /m, 'every import line of app.js is replaced');

  const errors = [];
  const ctx = {
    __modules: modules,
    console: { log() {}, info() {}, warn() {}, error: (...a) => errors.push(a) },
    document: {
      getElementById: byId,
      createElement: () => element(),
      addEventListener() {},
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { if (fakes.blockPositions && k.startsWith('pr.pos.')) throw new Error('storage full'); store.set(k, String(v)); },
    },
    location: { search: '', href: 'file:///reader/pdf/index.html' },
    navigator: {},
    setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout, setInterval: () => 0,
    URL, URLSearchParams, File, TextDecoder, crypto: globalThis.crypto,
    Worker: class { constructor() { throw new Error('no worker in a test'); } },
    fetch: async () => { throw new Error('no network in a test'); },
    getSelection: () => '',
    confirm: () => false,
    addEventListener() {},
    innerWidth: 1400,
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: APP_JS });

  const state = ctx.__pr;
  const reader = {
    voice: made.system,   // the reader uses the Mac voice, because the test chose it (pr.engine.chosen)
    speaking: () => made.system.current,
    ctx, state, els: ids, docs, parses, highlights, timers, runTimers, fakes, errors, store, viewer: ctx.__viewer,
    async open(name, bytes = '%PDF-1.7 test') {
      const before = parses.length;
      const loadsBefore = this.viewer.loaded.length;
      byId('fileInput').files = [new File([bytes], name)];
      byId('fileInput').fire('change');
      return { before, loadsBefore };
    },
    async openAndWait(name, bytes) {
      const { before } = await this.open(name, bytes);
      await until(() => parses.length > before, 'the read-in of ' + name);
      return parses[parses.length - 1];
    },
    // Publish the first sentences (page 3 of 9) and then end the read-in.
    async readIn(list) {
      const parse = parses[parses.length - 1];
      await parse.progress(3, 9, { sentences: list.slice(0, 3), sections: [] });
      parse.finish({ sentences: list, sections: [] });
      await until(() => state.sentences === list && els().parseText.textContent.includes('sentences ·'), 'the end of the read-in');
    },
  };
  const els = () => ({ parseText: byId('parseText') });
  return reader;
}

async function readerWithBook(n = 10) {
  const r = loadReader();
  await until(() => r.els.voiceSel.children.length, 'the boot');
  await r.openAndWait('book.pdf');
  const list = sentences(n);
  await r.readIn(list);
  return { r, list };
}

const play = (r) => r.els.playBtn.fire('click');

test('a drag of the seek bar while it reads goes on reading from the new place', async () => {
  const { r, list } = await readerWithBook();
  play(r);
  assert.equal(r.state.playing, true);
  r.els.seek.value = '5'; r.els.seek.fire('input');
  assert.equal(r.els.playBtn.getAttribute('aria-label'), 'Play', 'during the drag the button says Play');
  r.els.seek.value = '6'; r.els.seek.fire('input');
  r.els.seek.fire('change');
  assert.equal(r.state.playing, true, 'the reading goes on after the drag');
  assert.equal(r.state.index, 6);
  assert.equal(r.speaking().sentence.text, list[6].text);
});

test('a drag of the seek bar while it does not read stays stopped', async () => {
  const { r } = await readerWithBook();
  r.els.seek.value = '4'; r.els.seek.fire('input'); r.els.seek.fire('change');
  assert.equal(r.state.playing, false);
  assert.equal(r.state.index, 4);
});

for (const [name, sel, value] of [['speed', 'rateSel', '1.5'], ['voice', 'voiceSel', 'v2']]) {
  test(`a change of the ${name} in a paragraph continues from the present word`, async () => {
    const { r } = await readerWithBook();
    play(r);
    r.speaking().onWord(11, 5);   // the voice reads "gamma"
    r.els[sel].value = value;
    r.els[sel].fire('change');
    assert.equal(r.state.playing, true);
    assert.equal(r.speaking().sentence.text, 'gamma delta 0.', 'it goes on from the present word, not from the top');
    if (name === 'speed') assert.equal(r.speaking().rate, 1.5);
    else assert.equal(r.speaking().voiceId, 'v2');
  });
}

test('Preview, then Play before the preview ends: Preview can be pressed again', async () => {
  const { r } = await readerWithBook();
  r.els.previewBtn.fire('click');
  await tick();
  assert.equal(r.els.previewBtn.disabled, true, 'Preview is off while the preview plays');
  play(r);   // the preview is now silent: its end never comes
  assert.equal(r.state.playing, true);
  assert.equal(r.els.previewBtn.disabled, false);
});

test('a file that is not a PDF shows a message and the start screen stays', async () => {
  const r = loadReader();
  await until(() => r.els.voiceSel.children.length, 'the boot');
  await r.open('notes.txt', 'plain text, not a PDF');
  await until(() => r.els.parseText.textContent.includes('Could not open'), 'the message');
  assert.equal(r.els.empty.hidden, false, 'the start screen stays');
  assert.equal(r.els.player.hidden, true, 'the player bar stays hidden');
  assert.equal(r.els.parseBar.hidden, false, 'the message is in view');
  assert.match(r.els.parseText.textContent, /notes\.txt/);
  assert.equal(r.parses.length, 0, 'no read-in starts');
});

test('a second PDF releases the first document and none of its sentences show', async () => {
  const r = loadReader();
  await until(() => r.els.voiceSel.children.length, 'the boot');
  const first = await r.openAndWait('first.pdf');
  await first.progress(3, 9, { sentences: sentences(3, 'Old'), sections: [] });
  assert.equal(r.state.sentences.length, 3);

  let releaseLexicon;
  r.fakes.lexiconGate = new Promise((res) => { releaseLexicon = res; });   // the second read-in waits here
  const { loadsBefore } = await r.open('second.pdf');
  await until(() => r.viewer.loaded.length > loadsBefore, 'the second document in the viewer');
  await tick();
  assert.equal(r.docs[0].destroyed, true, 'the first document is released');
  assert.equal(r.docs[1].destroyed, false);
  assert.equal(r.state.sentences.length, 0, 'the old sentences are gone');
  assert.equal(r.els.nowReading.children.length, 0, 'the old sentence does not show');

  const goOn = await first.progress(6, 9, { sentences: sentences(6, 'Old'), sections: [] });
  assert.equal(goOn, false, 'the old read-in stops');
  assert.equal(r.state.sentences.length, 0, 'the old read-in publishes nothing');

  releaseLexicon();
  await until(() => r.parses.length === 2, 'the second read-in');
  const list = sentences(4, 'New');
  await r.readIn(list);
  assert.ok(r.state.sentences.every((s) => s.text.startsWith('New')));
});

test('while a document is read in and nothing plays, the page does not jump back to the first sentence', async () => {
  const r = loadReader();
  await until(() => r.els.voiceSel.children.length, 'the boot');
  const parse = await r.openAndWait('book.pdf');
  await parse.progress(3, 9, { sentences: sentences(6), sections: [] });
  assert.equal(r.els.seek.max, '5', 'the seek bar knows the new sentences');
  assert.equal(r.els.pos.textContent, '1 / 6');
  r.els.seek.value = '4'; r.els.seek.fire('input'); r.els.seek.fire('change');   // the owner goes to sentence 5
  const before = r.highlights.length;
  await parse.progress(6, 9, { sentences: sentences(8), sections: [] });
  assert.equal(r.highlights.length, before, 'no highlight moves the page');
  assert.equal(r.state.index, 4);
  assert.equal(r.els.pos.textContent, '5 / 8');
});

test('Play during the read-in: the end of the read-in keeps the sentence that is read', async () => {
  const r = loadReader();
  await until(() => r.els.voiceSel.children.length, 'the boot');
  const parse = await r.openAndWait('book.pdf');
  const list = sentences(8);
  await parse.progress(3, 9, { sentences: list.slice(0, 6), sections: [] });
  play(r);
  r.els.nextBtn.fire('click'); r.els.nextBtn.fire('click');
  assert.equal(r.state.index, 2);
  parse.finish({ sentences: list, sections: [] });
  await until(() => r.state.sentences === list && r.els.parseText.textContent.includes('sentences ·'), 'the end of the read-in');
  assert.equal(r.state.index, 2, 'the place stays with the voice');
  assert.equal(r.state.playing, true);
});

test('one failed sentence: a message, one new try after 1 second, then a stop with a message', async () => {
  const { r, list } = await readerWithBook();
  play(r);
  const calls = r.voice.calls.length;
  r.speaking().onError('HTTP 500');
  assert.match(r.els.engineStatus.textContent, /did not answer/, 'a message shows');
  assert.equal(r.state.playing, true, 'it does not stop at the first failure');
  assert.equal(r.voice.calls.length, calls, 'no new try at once');
  const retry = r.timers.find((t) => t.live && t.ms === 1000);
  assert.ok(retry, 'a new try waits 1 second');
  r.runTimers(1000);
  assert.equal(r.voice.calls.length, calls + 1, 'one new try');
  assert.equal(r.speaking().sentence.text, list[0].text, 'the new try is the same sentence');
  r.speaking().onError('HTTP 500');
  assert.equal(r.state.playing, false, 'the second failure stops the reading');
  assert.match(r.els.engineStatus.textContent, /did not answer.*Play/, 'a message tells what to do');
  r.runTimers(5000);
  assert.equal(r.voice.calls.length, calls + 1, 'no more tries');
});

test('a failure after a good sentence gets its own new try', async () => {
  const { r } = await readerWithBook();
  play(r);
  r.speaking().onError('HTTP 500');
  r.runTimers(1000);
  r.speaking().onEnd();      // the new try played to its end
  r.runTimers(1000);         // the pause between sentences
  assert.equal(r.state.index, 1);
  r.speaking().onError('HTTP 500');
  assert.equal(r.state.playing, true, 'one failure after a good sentence does not stop');
});

// An unhandled rejection anywhere in the reader fails the test that made it.
const unhandled = [];
process.on('unhandledRejection', (err) => unhandled.push(err));

test('a bad file while a book reads in: the message stays and the book stays usable', async () => {
  const r = loadReader();
  await until(() => r.els.voiceSel.children.length, 'the boot');
  const parse = await r.openAndWait('book.pdf');
  await parse.progress(3, 9, { sentences: sentences(3), sections: [] });
  await r.open('notes.txt', 'plain text, not a PDF');
  await until(() => r.els.parseText.textContent.includes('Could not open'), 'the message');
  const goOn = await parse.progress(6, 9, { sentences: sentences(6), sections: [] });
  assert.equal(goOn, true, 'the read-in of the open book goes on');
  assert.match(r.els.parseText.textContent, /Could not open "notes\.txt"/, 'the next progress tick keeps the message');
  const list = sentences(8);
  parse.finish({ sentences: list, sections: [] });
  await until(() => r.state.sentences === list && r.state.itemToSentence.size, 'the end of the read-in');
  await tick();
  assert.match(r.els.parseText.textContent, /Could not open/, 'the end of the read-in keeps the message');
  r.runTimers(2500);
  assert.equal(r.els.parseBar.hidden, false, 'the message stays in view');
  assert.equal(r.state.doc, r.docs[0]);
  assert.equal(r.els.empty.hidden, true);
  play(r);
  assert.equal(r.speaking().sentence.text, list[0].text, 'the book reads');
});

test('the old read-in that ends while a second file loads publishes no old sentence', async () => {
  const r = loadReader();
  await until(() => r.els.voiceSel.children.length, 'the boot');
  const first = await r.openAndWait('first.pdf');
  let releaseOutline;
  r.fakes.outlineGate = new Promise((res) => { releaseOutline = res; });   // the old read-in waits for its contents list
  first.finish({ sentences: sentences(5, 'Old'), sections: [{ title: 'Old chapter', startSentence: 0, page: 1, level: 0 }] });
  await tick(); await tick();
  r.fakes.outlineGate = null;
  const { before } = await r.open('second.pdf', '%PDF-1.7 second');
  await until(() => r.parses.length > before, 'the second read-in');
  releaseOutline();
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(r.state.sentences.length, 0, 'no old sentence after the new document is accepted');
  assert.equal(r.els.nowReading.children.length, 0);
  assert.equal(r.state.sections.length, 0, 'no old chapter in the contents');
  assert.doesNotMatch(r.els.parseText.textContent, /^5 sentences/, 'no old count');
});

test('a second file after Stop in a sentence starts at the top of its first sentence', async () => {
  const { r } = await readerWithBook();
  play(r);
  r.speaking().onWord(11, 5);
  play(r);   // Stop in the middle of the sentence
  assert.equal(r.state.playing, false);
  await r.openAndWait('second.pdf', '%PDF-1.7 second book');
  const list = sentences(4, 'New');
  await r.readIn(list);
  play(r);
  assert.equal(r.speaking().sentence.text, list[0].text, 'it starts at the sentence start');
});

test('a seek during the read-in stays at the end of the read-in, also when the place cannot be saved', async () => {
  const r = loadReader();
  r.fakes.blockPositions = true;
  await until(() => r.els.voiceSel.children.length, 'the boot');
  const parse = await r.openAndWait('book.pdf');
  await parse.progress(3, 9, { sentences: sentences(6), sections: [] });
  r.els.seek.value = '4'; r.els.seek.fire('input'); r.els.seek.fire('change');
  const list = sentences(8);
  parse.finish({ sentences: list, sections: [] });
  await until(() => r.state.sentences === list && r.els.parseText.textContent.includes('sentences ·'), 'the end of the read-in');
  assert.equal(r.state.index, 4, 'the place the owner chose stays');
});

test('Next during a pending new try: the next failed sentence gets its own new try', async () => {
  const { r } = await readerWithBook();
  play(r);
  r.speaking().onError('HTTP 500');
  r.els.nextBtn.fire('click');
  assert.equal(r.state.index, 1);
  r.speaking().onError('HTTP 500');
  assert.equal(r.state.playing, true, 'it does not stop');
  assert.ok(r.timers.find((t) => t.live && t.ms === 1000), 'a new try waits 1 second');
});

test('Stop cancels the new try that waits 1 second', async () => {
  const { r } = await readerWithBook();
  play(r);
  const calls = r.voice.calls.length;
  r.speaking().onError('HTTP 500');
  play(r);   // Stop
  r.runTimers(1000);
  assert.equal(r.state.playing, false);
  assert.equal(r.voice.calls.length, calls, 'no new try after Stop');
});

test('Preview, then Next before the preview ends: Preview can be pressed again', async () => {
  const { r } = await readerWithBook();
  r.els.previewBtn.fire('click');
  await tick();
  assert.equal(r.els.previewBtn.disabled, true);
  r.els.nextBtn.fire('click');
  assert.equal(r.els.previewBtn.disabled, false);
});

test('the old read-in fails after its document is released: no unhandled error', async () => {
  const r = loadReader();
  await until(() => r.els.voiceSel.children.length, 'the boot');
  const first = await r.openAndWait('first.pdf');
  const n = unhandled.length;
  await r.openAndWait('second.pdf', '%PDF-1.7 second');
  assert.equal(r.docs[0].destroyed, true);
  first.fail(new Error('Transport destroyed'));   // pdf.js: getPage on a destroyed document
  for (let i = 0; i < 10; i++) await tick();
  assert.equal(unhandled.length, n, 'the cancelled read-in ends quietly');
  assert.equal(r.state.doc, r.docs[1]);
});

// ---------- 14 Nov 2026: the Report of the reader (owner's yes on the answer page desktop-app-voice-round-1) ----------
// The add-on wrote a line for each Sentence of a web page; the reader (the desktop app, and PDFs in Chrome) wrote
// none, so its faults left no record. app.js gives its lines to tts.js through ServerEngine.note; here a fake takes them.
function reportOf(r) {
  const lines = [];
  r.ctx.__modules.ServerEngine.note = (evt, data, now) => lines.push({ evt, now, ...data });
  return lines;
}
const pause = (ms) => new Promise((res) => setTimeout(res, ms));

test('report: a Sentence that was read to its end gives one line with its length, its wait, its time and its speed, and no text', async () => {
  const { r, list } = await readerWithBook();
  const lines = reportOf(r);
  play(r);
  const call = r.speaking();
  await pause(6); call.onWord(0, 5);
  await pause(9); call.onEnd();
  const say = lines.filter((x) => x.evt === 'say');
  assert.equal(say.length, 1);
  assert.equal(say[0].engine, 'mac', 'this test reads with the Mac voice');
  assert.equal(say[0].chars, list[0].text.length);
  assert.ok(say[0].wait >= 5, 'the wait before the first word: ' + say[0].wait);
  assert.ok(say[0].ms >= 8, 'the time from the first word to the end: ' + say[0].ms);
  assert.ok(say[0].rate > 0 && say[0].cps > 0);
  assert.ok(!JSON.stringify(lines).includes('Alpha'), 'no text of the book is in the report');
});

test('report: a Sentence that is stopped before its end gives no line', async () => {
  const { r } = await readerWithBook();
  const lines = reportOf(r);
  play(r);
  const call = r.speaking();
  await pause(5); call.onWord(0, 5);
  await pause(5);
  play(r);  // Pause
  call.onEnd();  // a late end of the stopped Sentence
  assert.deepEqual(lines.filter((x) => x.evt === 'say'), []);
});

test('report: a voice that fails gives a line for the fault', async () => {
  const { r } = await readerWithBook();
  const lines = reportOf(r);
  play(r);
  r.speaking().onError('the voice server does not answer: no answer in 30 s');
  const fault = lines.filter((x) => x.evt === 'voice-error');
  assert.equal(fault.length, 1);
  assert.equal(fault[0].try, 1);
  assert.match(fault[0].why, /does not answer/);
});

test('report: "Report a problem" writes a mark with the state of the reader and says that it is saved', async () => {
  const { r, list } = await readerWithBook();
  const lines = reportOf(r);
  play(r);
  r.els.reportBtn.fire('click');
  const mark = lines.find((x) => x.evt === 'problem');
  assert.ok(mark, 'the mark is in the report');
  assert.equal(mark.playing, 1);
  assert.equal(mark.sentences, list.length);
  assert.equal(mark.sentence, 0);
  assert.match(r.els.reportStatus.textContent, /saved in the report/);
  assert.ok(!JSON.stringify(mark).includes('Alpha'), 'no text of the book');
});

test('report: the button is in the settings panel, in its own group', () => {
  const html = readFileSync(new URL('../../extension/pdf/index.html', import.meta.url), 'utf8');
  const panel = html.slice(html.indexOf('id="settingsPanel"'));
  assert.match(panel, /<section class="settings-group" id="problemGroup"[^>]*>\s*<h3 id="problemHead">Something wrong\?<\/h3>[\s\S]*?<button type="button" class="btn ghost" id="reportBtn">Report a problem<\/button>[\s\S]*?<p class="status" id="reportStatus" role="status"><\/p>/);
});
