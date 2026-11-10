// Ticket 32: Italian reading. The language check of a text (extension/pdf/language.js and its copy in content.js),
// the choice of the voice in the reader, in the web player and in the Mac voice fallback, the Italian Speech
// rewrite, the language of a Book in buildDocument, and the second Italian voice (Nicola).
// All Italian and English sentences here are made for the test.
// Run: node --test --test-timeout=120000 tests/node/italian-reading.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import * as lexicon from '../../extension/pdf/lexicon.js';
import { textLanguage, voiceForLanguage, isItalianVoice } from '../../extension/pdf/language.js';
import { normalizeForSpeech } from '../../extension/pdf/speech.js';
import { buildDocument } from '../../extension/pdf/extract.js';
import { loadLexiconFromFile } from '../pdf-text/extract-text.mjs';

await loadLexiconFromFile(lexicon);

const CONTENT_JS = fileURLToPath(new URL('../../extension/content.js', import.meta.url));
const TTS_JS = fileURLToPath(new URL('../../extension/pdf/tts.js', import.meta.url));
const SERVER_PY = fileURLToPath(new URL('../../voice-server.py', import.meta.url));

const IT = 'Il dente è stato pulito con cura. La radice della cura si vede nella lastra, e il paziente non sente dolore. ' +
  'Questo metodo è più semplice di quello che si usa di solito, ma richiede anche un controllo dopo una settimana.';
const EN = 'The tooth was cleaned with care. The root of the canal can be seen on the film, and the patient has no pain. ' +
  'This method is simpler than the one that is used most of the time, but it needs a check after one week.';

// ---------- the language check ----------
test('an Italian text is "it", an English text is "en"', () => {
  assert.equal(textLanguage(IT), 'it');
  assert.equal(textLanguage(EN), 'en');
});

test('a short or mixed text, or a text in another language, is "" (not sure)', () => {
  assert.equal(textLanguage(''), '');
  assert.equal(textLanguage('Ciao'), '');
  assert.equal(textLanguage('Molar 36, 2 mm.'), '');
  assert.equal(textLanguage('Der Zahn wurde gereinigt und die Wurzel ist gut.'), '');
  assert.equal(textLanguage('Il dente e la radice. The tooth and the root of it.'), '');
});

test('an Italian text with a few English words in it is still Italian', () => {
  assert.equal(textLanguage(IT + ' See the guide of the society.'), 'it');
});

// content.js cannot import: it has its own copy. It must be the same function.
function contentTextLanguage() {
  const src = readFileSync(CONTENT_JS, 'utf8');
  const fn = src.match(/\n  function textLanguage\(text\) \{[\s\S]*?\n  \}\n/);
  assert.ok(fn, 'content.js has textLanguage(text)');
  return { src: fn[0].replace(/\n  /g, '\n').trim(), run: vm.runInNewContext(`(${fn[0].trim()})`, { String, Set }) };
}
test('the copy of textLanguage in content.js is the same as the one in language.js', () => {
  const mine = readFileSync(fileURLToPath(new URL('../../extension/pdf/language.js', import.meta.url)), 'utf8')
    .match(/export function textLanguage\(text\) \{[\s\S]*?\n\}\n/)[0].replace(/^export /, '').trim();
  const copy = contentTextLanguage();
  assert.equal(copy.src, mine);
  for (const t of [IT, EN, '', 'Ciao', IT + EN, EN + ' il la di']) assert.equal(copy.run(t), textLanguage(t));
});

// ---------- the voice for a language ----------
test('voiceForLanguage: Italian text goes to Sara, Nicola stays; English text with an Italian voice goes to Heart', () => {
  assert.equal(voiceForLanguage('af_heart', 'it'), 'if_sara');
  assert.equal(voiceForLanguage('am_michael', 'it'), 'if_sara');
  assert.equal(voiceForLanguage('bf_emma', 'it'), 'if_sara');
  assert.equal(voiceForLanguage('im_nicola', 'it'), 'im_nicola');
  assert.equal(voiceForLanguage('if_sara', 'it'), 'if_sara');
  assert.equal(voiceForLanguage('if_sara', 'en'), 'af_heart');
  assert.equal(voiceForLanguage('im_nicola', 'en'), 'af_heart');
  assert.equal(voiceForLanguage('am_michael', 'en'), 'am_michael');
  assert.equal(voiceForLanguage('if_sara', ''), 'if_sara', 'not sure: the chosen voice reads');
  assert.equal(voiceForLanguage('af_heart', ''), 'af_heart');
  assert.ok(isItalianVoice('im_nicola') && isItalianVoice('if_sara') && !isItalianVoice('af_heart'));
});

// ---------- the Speech rewrite ----------
const say = (text, lang) => { const c = [...text]; const r = normalizeForSpeech(c, c.map((_, i) => i), lang); assert.equal(r.chars.length, r.owners.length); return r.chars.join(''); };

test('Italian text: numbers, years, ranges and Roman numerals pass through as printed (no English words)', () => {
  assert.equal(say('Nel 1996 il valore era 1.5 o 2,5 per 50-60 pazienti di Classe II.', 'it'),
    'Nel 1996 il valore era 1.5 o 2,5 per 50-60 pazienti di Classe II.');
});

test('Italian text: units are said in Italian, the number stays', () => {
  assert.equal(say('Un difetto di 1,5 mm e uno di 1 mm, circa 3cm.', 'it'), 'Un difetto di 1,5 millimetri e uno di 1 millimetro, circa 3 centimetri.');
  assert.equal(say('Un taglio di ~5 mm.', 'it'), 'Un taglio di circa 5 millimetri.');
});

test('Italian text: capitals are not spelled with the English word list', () => {
  assert.equal(say('Secondo la OMS e il SSN la cura DOPO il trattamento.', 'it'), 'Secondo la OMS e il SSN la cura DOPO il trattamento.');
});

test('Italian text: the signs ^ ~ | and pH are still not said as signs', () => {
  assert.equal(say('Un valore di 10^3 | pH 7.', 'it'), 'Un valore di 10 alla 3   P H 7.');
});

test('English text keeps the English Speech rewrite', () => {
  assert.equal(say('In 1996 the gap was 1.5 mm in Class II.', 'en'), 'In nineteen ninety-six the gap was one point five millimetres in Class two.');
  assert.equal(say('In 1996 the gap was 1.5 mm.'), 'In nineteen ninety-six the gap was one point five millimetres.');
});

// ---------- the language of a Book ----------
const item = ({ text, y }) => ({ str: text, transform: [10, 0, 0, 10, 72, y], width: text.length * 5, hasEOL: false });
const fakeDoc = (pages) => ({
  numPages: pages.length,
  async getPage(n) {
    const lines = pages[n - 1];
    return { async getTextContent() { return { items: lines.map(item) }; }, getViewport: () => ({ width: 612, height: 792 }) };
  },
});
function wrap(paragraph) {
  const lines = []; let line = '';
  for (const w of paragraph.split(' ')) { if (line && line.length + w.length + 1 > 70) { lines.push(line); line = w; } else line = line ? `${line} ${w}` : w; }
  if (line) lines.push(line);
  return lines.map((text, k) => ({ text, y: 700 - k * 14 }));
}

test('an Italian Book is read as Italian: no English words come into its Sentences', async () => {
  const b = await buildDocument(fakeDoc([wrap(IT + ' Nel 1996 la lesione era di 2 mm.'), wrap(IT)]), {});
  assert.equal(b.lang, 'it');
  const all = b.sentences.map((s) => s.text).join(' ');
  assert.match(all, /Nel 1996 la lesione era di 2 millimetri\./);
  assert.doesNotMatch(all, /nineteen|millimetre/);
});

test('an English Book keeps the English Speech rewrite', async () => {
  const b = await buildDocument(fakeDoc([wrap(EN + ' In 1996 the lesion was 2 mm.'), wrap(EN)]), {});
  assert.equal(b.lang, 'en');
  assert.match(b.sentences.map((s) => s.text).join(' '), /In nineteen ninety-six the lesion was two millimetres\./);
});

// ---------- the reader: the voice selector and the voice that reads ----------
test('the reader uses the voice of the Book language at every voice request, and says when it changed the voice', () => {
  const app = readFileSync(fileURLToPath(new URL('../../extension/pdf/app.js', import.meta.url)), 'utf8');
  assert.match(app, /import \{ textLanguage, voiceForLanguage \} from '\.\/language\.js'/);
  // every voice request goes through readingVoice(); only the saved choice and the preview without a Book read the select
  const direct = app.split('\n').filter((l) => /els\.voiceSel\.value/.test(l) && !/readingVoice|localStorage|const chosen|swapped|saved/.test(l));
  assert.deepEqual(direct, []);
  assert.match(app, /voiceId: readingVoice\(\)/);
  assert.match(app, /state\.lang = b\.lang; showVoiceName\(\)/);
  const html = readFileSync(fileURLToPath(new URL('../../extension/pdf/index.html', import.meta.url)), 'utf8');
  assert.match(html, /<p class="status" id="voiceHint" hidden><\/p>/);
});

// ---------- the Mac voice fallback of the reader ----------
function loadServerEngine() {
  const said = [];
  const voices = [
    { voiceURI: 'sam', name: 'Samantha', lang: 'en-US', localService: true },
    { voiceURI: 'alice', name: 'Alice', lang: 'it-IT', localService: true },
  ];
  const speechSynthesis = { getVoices: () => voices, speak(u) { said.push(u); }, cancel() {}, addEventListener() {}, removeEventListener() {} };
  class SpeechSynthesisUtterance { constructor(text) { this.text = text; } }
  const fetch = () => Promise.reject(new TypeError('Failed to fetch'));  // the voice server does not answer
  const context = vm.createContext({
    window: { speechSynthesis }, document: { hidden: false }, console, URL, AbortController, Promise, Error, TypeError,
    Set, Map, Math, Number, fetch, SpeechSynthesisUtterance, setTimeout, clearTimeout, setInterval: () => ({}), clearInterval() {},
    AudioContext: class {}, OfflineAudioContext: class {},
  });
  const source = readFileSync(TTS_JS, 'utf8').replace(/^export /gm, '').replace(/import\.meta\.url/g, "'file:///tts.js'");
  const api = vm.runInContext(source + '\n;({ ServerEngine, SystemEngine })', context, { filename: TTS_JS });
  return { ...api, said };
}

test('voice server down: an Italian voice falls to the Italian Mac voice, an English voice to an English one', async () => {
  for (const [voiceId, want] of [['if_sara', 'Alice'], ['im_nicola', 'Alice'], ['af_heart', 'Samantha']]) {
    const { ServerEngine, said } = loadServerEngine();
    const e = new ServerEngine();
    await e.speak({ text: 'Una frase breve.' }, { voiceId, rate: 1 });
    assert.equal(said.length, 1, voiceId);
    assert.equal(said[0].voice.name, want, voiceId);
  }
});

test('the Mac voice list of the reader also shows the Italian Mac voices', () => {
  const { SystemEngine } = loadServerEngine();
  const s = new SystemEngine();
  s.voices = s.synth.getVoices();
  assert.equal(s.listVoices().map((v) => v.lang).join(' '), 'en it');
  assert.equal(s.voiceOf('it'), 'alice');
});

// ---------- the web player (content.js) ----------
const before = (n) => { const s = n.parentNode && n.parentNode.childNodes; return s ? s[s.indexOf(n) - 1] || null : null; };
function text(data) { return { nodeType: 3, nodeName: '#text', data, parentElement: null, parentNode: null, get previousSibling() { return before(this); } }; }
const INLINE = new Set(['SPAN', 'A', 'B', 'I', 'EM', 'STRONG']);
function el(tag, attrs = {}, kids = []) {
  const e = {
    nodeType: 1, tagName: tag.toUpperCase(), nodeName: tag.toUpperCase(), attrs: { ...attrs }, childNodes: [],
    parentElement: null, parentNode: null, dataset: {}, style: {},
    get id() { return this.attrs.id || ''; },
    get className() { return this.attrs.class || ''; },
    set className(v) { this.attrs.class = v; },
    get lang() { return this.attrs.lang || ''; },
    get previousSibling() { return before(this); },
    get innerText() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.innerText)).join(''); },
    getAttribute(k) { return k in this.attrs ? String(this.attrs[k]) : null; },
    matches: () => false, closest: () => null,
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
function textNodes(top, out = []) { for (const c of top.childNodes) if (c.nodeType === 3) out.push(c); else textNodes(c, out); return out; }

// Load content.js on a page with <html lang> and the paragraphs paras; voice: the voice the owner chose.
// Returns the voice of the first sentence that the page asks for.
async function firstVoice({ lang = '', paras, voice }) {
  const body = el('body', {}, paras.map((p) => el('p', {}, [p])));
  const html = el('html', lang ? { lang } : {}, [body]);
  const spoken = [];
  const listeners = [];
  const document = {
    documentElement: html, body, contentType: 'text/html', visibilityState: 'hidden',
    querySelector: () => null, createElement: (t) => el(t), addEventListener() {},
    createTreeWalker(top, _what, filter) { const list = textNodes(top).filter((n) => filter.acceptNode(n) === 1); let i = 0; return { nextNode: () => list[i++] || null }; },
    createRange: () => ({ setStart() {}, setEnd() {}, getBoundingClientRect: () => ({ top: 100, bottom: 120, left: 0, right: 50, width: 50, height: 20 }) }),
  };
  const chrome = {
    runtime: { sendMessage: (m) => { if (m.cmd === 'speak') spoken.push(m); return Promise.resolve(undefined); }, onMessage: { addListener: (f) => listeners.push(f) } },
    storage: { sync: { get: async () => ({ ra2: { voice } }), set: async () => {} }, local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } },
  };
  const ctx = vm.createContext({
    document, chrome, console, location: { protocol: 'https:', hostname: 'example.org' },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    MutationObserver: class { observe() {} },
    Highlight: class { clear() {} add() {} }, CSS: { highlights: new Map() },
    getComputedStyle: (e) => ({ display: INLINE.has(e.tagName) ? 'inline' : 'block' }),
    getSelection: () => ({ rangeCount: 0, toString: () => '' }),
    matchMedia: () => ({ matches: true }),
    setTimeout: () => 0, clearTimeout() {}, addEventListener() {}, scrollTo() {},
    innerWidth: 1200, innerHeight: 800, scrollY: 0,
  });
  vm.runInContext(readFileSync(CONTENT_JS, 'utf8'), ctx, { filename: 'content.js' });
  await new Promise((r) => setImmediate(r));  // the stored voice is read
  listeners.forEach((f) => f({ to: 'page', cmd: 'readPage' }));
  assert.ok(spoken.length, 'the page asked for a sentence');
  return `${spoken[0].engine}:${spoken[0].voice}`;
}

test('web player: an Italian page without lang is read by Sara when an English voice is chosen', async () => {
  assert.equal(await firstVoice({ paras: [IT, IT], voice: 'kokoro:af_heart' }), 'kokoro:if_sara');
});

test('web player: an Italian page with a wrong lang="en" is still read in Italian; Nicola stays Nicola', async () => {
  assert.equal(await firstVoice({ lang: 'en', paras: [IT, IT], voice: 'kokoro:am_michael' }), 'kokoro:if_sara');
  assert.equal(await firstVoice({ lang: 'en', paras: [IT, IT], voice: 'kokoro:im_nicola' }), 'kokoro:im_nicola');
});

test('web player: lang="it" says Italian even for a short text', async () => {
  assert.equal(await firstVoice({ lang: 'it-IT', paras: ['Ciao.'], voice: 'kokoro:bf_emma' }), 'kokoro:if_sara');
});

test('web player: an English page with an Italian voice chosen is read by Heart', async () => {
  assert.equal(await firstVoice({ paras: [EN, EN], voice: 'kokoro:if_sara' }), 'kokoro:af_heart');
  assert.equal(await firstVoice({ lang: 'en', paras: ['Hello.'], voice: 'kokoro:im_nicola' }), 'kokoro:af_heart');
});

test('web player: a page of unknown language keeps the chosen voice; Russian stays with the Mac voice', async () => {
  assert.equal(await firstVoice({ paras: ['Ciao.'], voice: 'kokoro:if_sara' }), 'kokoro:if_sara');
  assert.equal(await firstVoice({ paras: ['Привет, как дела?'], voice: 'kokoro:af_heart' }), 'system:Milena');
});

test('web player: the Mac voice reads an Italian page with Alice, an English page with Samantha', async () => {
  assert.equal(await firstVoice({ paras: [IT, IT], voice: 'system:Milena' }), 'system:Alice');
  assert.equal(await firstVoice({ paras: [EN, EN], voice: 'system:Milena' }), 'system:Samantha');
});

// ---------- Nicola in every voice list ----------
test('Nicola is a voice of the voice server and a known voice of the add-on', () => {
  const py = readFileSync(SERVER_PY, 'utf8');
  assert.match(py, /\('im_nicola', 'Italian', 'i', 'Nicola, Italian male'\)/);
  const js = readFileSync(CONTENT_JS, 'utf8');
  assert.match(js, /const KNOWN = \/\^kokoro:\([^)]*\bim_nicola\b[^)]*\)\$/);
});

// ---------- the reader app: the voice that reads an Italian Book ----------
test('reader: an Italian Book chosen with Heart is read by Sara, and the settings say so', async () => {
  const { loadApp, until } = await import('./reader-css.mjs');
  const r = loadApp({ engine: 'kokoro' });
  await until(() => r.els.voiceSel.children.length, 'the boot');
  r.els.voiceSel.options = [{ value: 'af_heart', textContent: 'Heart, warm female · American' }, { value: 'if_sara', textContent: 'Sara · Italian' }];
  r.els.voiceSel.value = 'af_heart';
  r.byId('fileInput').files = [new File(['%PDF-1.7 test'], 'book.pdf')];
  r.byId('fileInput').fire('change');
  await until(() => r.parses.length, 'the read-in');
  const list = Array.from({ length: 3 }, (_, i) => ({ text: `Una frase ${i}.`, spans: [{ page: 1, item: i }], charOwners: [], page: 1, sectionIndex: 0, pauseAfter: 300 }));
  await r.parses[0].progress(1, 1, { lang: 'it', sentences: list, sections: [] });
  r.parses[0].finish({ lang: 'it', sentences: list, sections: [] });
  await until(() => r.state.sentences === list, 'the end of the read-in');
  assert.equal(r.state.lang, 'it');
  assert.equal(r.els.settingsVoice.textContent, 'Sara');
  assert.equal(r.els.voiceHint.hidden, false);
  assert.equal(r.els.voiceHint.textContent, 'This book is in Italian, so Sara reads it.');
  r.els.playBtn.fire('click');
  await until(() => r.made.kokoro.current, 'the first sentence');
  assert.equal(r.made.kokoro.current.voiceId, 'if_sara');
  // the owner chooses Nicola: Nicola reads, and no line says that the voice changed
  r.els.voiceSel.value = 'im_nicola';
  r.els.voiceSel.fire('change');
  await until(() => r.made.kokoro.current?.voiceId === 'im_nicola', 'Nicola reads');
  assert.equal(r.els.voiceHint.hidden, true);
});
