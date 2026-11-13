// Ticket 04 of the spec "Italian voices that the owner can find": the setting "Voice for Italian" (Sara, the default,
// or Nicola) and the line in the Player bar settings that says which voice reads the page and why.
// The pure functions are in extension/pdf/language.js: voiceForLanguage(voice, lang, italian), italianVoices(voices)
// and voiceReason(chosen, used, lang, place, name). content.js and popup.js cannot import, so they have copies; the
// tests here keep the copies equal. The setting is one stored key, italianVoice in chrome.storage.sync 'ra2' (the
// web player, the popup, the reader of the add-on); the reader served by the voice server keeps it in localStorage.
// Run: node --test tests/node/italian-voice-choice.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { voiceForLanguage, isItalianVoice, italianVoices, voiceReason, voiceGroups, textLanguage } from '../../extension/pdf/language.js';

const file = (p) => fileURLToPath(new URL('../../' + p, import.meta.url));
const read = (p) => readFileSync(file(p), 'utf8');

// The /voices answer of voice-server.py, in its order.
const SERVER = [
  { id: 'af_heart', accent: 'American', label: 'Heart, warm female' },
  { id: 'am_michael', accent: 'American', label: 'Michael, deep male' },
  { id: 'bf_emma', accent: 'British', label: 'Emma, female' },
  { id: 'if_sara', accent: 'Italian', label: 'Sara, Italian female' },
  { id: 'im_nicola', accent: 'Italian', label: 'Nicola, Italian male' },
];
const ONE_ITALIAN = SERVER.slice(0, 4);
const IT = 'Il dente è stato pulito con cura. La radice della cura si vede nella lastra, e il paziente non sente dolore. ' +
  'Questo metodo è più semplice di quello che si usa di solito, ma richiede anche un controllo dopo una settimana.';
const EN = 'The tooth was cleaned with care. The root of the canal can be seen on the film, and the patient has no pain. ' +
  'This method is simpler than the one that is used most of the time, but it needs a check after one week.';

// ---------- the voice rule ----------
test('voiceForLanguage: Italian text with an English main voice goes to the voice for Italian (Sara or Nicola)', () => {
  assert.equal(voiceForLanguage('af_heart', 'it', 'if_sara'), 'if_sara');
  assert.equal(voiceForLanguage('af_heart', 'it', 'im_nicola'), 'im_nicola');
  assert.equal(voiceForLanguage('am_michael', 'it', 'im_nicola'), 'im_nicola');
  assert.equal(voiceForLanguage('bf_emma', 'it', 'im_nicola'), 'im_nicola');
});
test('voiceForLanguage: no setting, or a setting that is no Italian voice, gives Sara', () => {
  assert.equal(voiceForLanguage('af_heart', 'it'), 'if_sara');
  assert.equal(voiceForLanguage('af_heart', 'it', undefined), 'if_sara');
  assert.equal(voiceForLanguage('af_heart', 'it', ''), 'if_sara');
  assert.equal(voiceForLanguage('af_heart', 'it', 'af_heart'), 'if_sara');
});
test('voiceForLanguage: a chosen Italian main voice reads Italian text itself, whatever the setting', () => {
  assert.equal(voiceForLanguage('if_sara', 'it', 'im_nicola'), 'if_sara');
  assert.equal(voiceForLanguage('im_nicola', 'it', 'if_sara'), 'im_nicola');
});
test('voiceForLanguage: English text keeps the English main voice; an Italian main voice goes to Heart', () => {
  assert.equal(voiceForLanguage('am_michael', 'en', 'im_nicola'), 'am_michael');
  assert.equal(voiceForLanguage('if_sara', 'en', 'im_nicola'), 'af_heart');
  assert.equal(voiceForLanguage('im_nicola', 'en', 'if_sara'), 'af_heart');
});
test('voiceForLanguage: text of unknown language keeps the main voice', () => {
  assert.equal(voiceForLanguage('af_heart', '', 'im_nicola'), 'af_heart');
  assert.equal(voiceForLanguage('im_nicola', '', 'if_sara'), 'im_nicola');
  assert.equal(voiceForLanguage('bf_emma', 'de', 'im_nicola'), 'bf_emma');
});

// ---------- the Italian voices of a server list ----------
test('italianVoices: the Italian group of the server list, in its order', () => {
  assert.deepEqual(italianVoices(SERVER).map((v) => v.id), ['if_sara', 'im_nicola']);
  assert.deepEqual(italianVoices(ONE_ITALIAN).map((v) => v.id), ['if_sara']);
  assert.deepEqual(italianVoices(SERVER.slice(0, 3)), []);
  assert.deepEqual(italianVoices(null), []);
  assert.deepEqual(italianVoices([{ id: 'im_nicola' }, { id: 'if_sara' }]).map((v) => v.id), ['im_nicola', 'if_sara'], 'no fixed names');
});

// ---------- the reason line ----------
test('voiceReason: the line says the language and the voice that reads', () => {
  assert.equal(voiceReason('kokoro:af_heart', 'kokoro:if_sara', 'it'), 'This page is in Italian, so Sara reads it.');
  assert.equal(voiceReason('kokoro:af_heart', 'kokoro:im_nicola', 'it'), 'This page is in Italian, so Nicola reads it.');
  assert.equal(voiceReason('kokoro:if_sara', 'kokoro:af_heart', 'en'), 'This page is in English, so Heart reads it.');
  assert.equal(voiceReason('kokoro:af_heart', 'system:Milena', 'ru'), 'This page is in Russian, so Milena reads it.');
  assert.equal(voiceReason('system:Milena', 'system:Alice', 'it'), 'This page is in Italian, so Alice reads it.');
});
test('voiceReason: no line when the chosen main voice reads', () => {
  assert.equal(voiceReason('kokoro:af_heart', 'kokoro:af_heart', 'en'), '');
  assert.equal(voiceReason('kokoro:im_nicola', 'kokoro:im_nicola', 'it'), '');
  assert.equal(voiceReason('kokoro:af_heart', '', 'it'), '');
});
test('voiceReason: the voice server does not answer, so a Mac voice reads', () => {
  assert.equal(voiceReason('kokoro:af_heart', 'system:Samantha', 'en'), 'The voice server does not answer, so Samantha reads this page.');
});
test('voiceReason: the reader says "book" and can give the name of the voice', () => {
  assert.equal(voiceReason('af_heart', 'if_sara', 'it', 'book'), 'This book is in Italian, so Sara reads it.');
  assert.equal(voiceReason('af_heart', 'im_nicola', 'it', 'book', 'Nicola'), 'This book is in Italian, so Nicola reads it.');
  assert.equal(voiceReason('a', 'b', '', 'book', 'Bee'), 'Bee reads this book.');
});

// ---------- the copies ----------
const LANG = read('extension/pdf/language.js');
const mine = (name) => LANG.match(new RegExp(`export function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`))[0].replace(/^export /, '').trim();
const contentFn = (name) => {
  const m = read('extension/content.js').match(new RegExp(`\\n  function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}\\n`));
  assert.ok(m, `content.js has ${name}()`);
  return m[0].replace(/\n  /g, '\n').trim();
};
const popupFn = (name) => {
  const m = read('extension/popup.js').match(new RegExp(`\\nfunction ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}\\n`));
  assert.ok(m, `popup.js has ${name}()`);
  return m[0].trim();
};
test('content.js has the same voiceForLanguage, isItalianVoice, italianVoices and voiceReason as language.js', () => {
  for (const n of ['voiceForLanguage', 'italianVoices', 'voiceReason']) assert.equal(contentFn(n), mine(n), n);
  const isIt = LANG.match(/export const isItalianVoice = .*;\n/)[0].replace(/^export /, '').trim();
  assert.ok(read('extension/content.js').includes('\n  ' + isIt + '\n'), 'content.js has the same isItalianVoice');
});
test('popup.js has the same italianVoices as language.js', () => {
  assert.equal(popupFn('italianVoices'), mine('italianVoices'));
});

// ---------- the web player: the voice that reads ----------
const CONTENT = read('extension/content.js');
const part = (re, what) => { const m = CONTENT.match(re); assert.ok(m, `content.js has ${what}`); return m[0]; };
const fnRe = (sig) => new RegExp(`\\n  ${sig.replace(/[()]/g, '\\$&')} \\{[\\s\\S]*?\\n  \\}\\n`);
const playerParts = () => [
  part(fnRe('function textLanguage(text)'), 'textLanguage'), part(fnRe('function voiceGroups(voices)'), 'voiceGroups'),
  part(fnRe('function versionLine(version, voices)'), 'versionLine'), part(fnRe('function addonVersion()'), 'addonVersion'),
  part(/\n  const isItalianVoice = .*;\n/, 'isItalianVoice'), part(fnRe("function voiceForLanguage(voice, lang, italian = 'if_sara')"), 'voiceForLanguage'),
  part(fnRe('function italianVoices(voices)'), 'italianVoices'), part(fnRe("function voiceReason(chosen, used, lang, place = 'page', name = '')"), 'voiceReason'),
  part(fnRe('function pageLang(segs)'), 'pageLang'), part(/\n  let natVoices = [^\n]*\n/, 'natVoices'),
  part(fnRe('function knowVoices(v)'), 'knowVoices'), part(fnRe('function italianFor()'), 'italianFor'),
  part(fnRe('function voiceFor(text, segs = S.segs, off = natOff)'), 'voiceFor'),
  part(fnRe('async function menu()'), 'menu'), part(fnRe('function showItalian(v)'), 'showItalian'), part(fnRe('function showWhy()'), 'showWhy'),
].join('\n');

function el(tag) {
  const listeners = {};
  const e = {
    tagName: tag.toUpperCase(), childNodes: [], attrs: {}, className: '', hidden: false,
    classList: { add() {}, remove() {} },
    append(...cs) { for (const c of cs) this.childNodes.push(c); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    click() { for (const f of listeners.click || []) f({ stopPropagation() {} }); },
  };
  let text = '';
  Object.defineProperty(e, 'textContent', { get: () => text, set: (v) => { text = v; e.childNodes = []; } });
  return e;
}

// The web player with the stored settings cfg, the page language pageLangAttr and the Sentences of the page.
function player({ cfg, lang = '', says = [IT], answer = { server: true, natural: SERVER, system: [{ id: 'Milena', label: 'Milena, Russian' }] }, natOff = false }) {
  const ids = {};
  const asked = [];
  const saved = [];
  const played = [];
  const ctx = {
    document: { createElement: el }, chrome: { runtime: { getManifest: () => ({ version: '1' }) } },
    $: (id) => (ids[id] ||= Object.assign(el('div'), { id })),
    ask: async (m) => { asked.push(JSON.parse(JSON.stringify(m))); return answer; }, dead: false, DEFAULTS: { italianVoice: 'if_sara' }, cfg: { voice: 'kokoro:af_heart', italianVoice: 'if_sara', ...cfg },
    save() { saved.push({ ...ctx.cfg }); },
    S: { segs: says.map((say) => ({ say })), i: 0, w: 0, playing: true, paused: false },
    play(i, w) { played.push([i, w]); },
    cur: 'kokoro:if_sara',  // the voice of the Sentence that reads now
    PAGE_LANG: lang, langOf: { segs: null, lang: '' }, natOff,
  };
  vm.runInNewContext(`${playerParts()}\nthis.menu = menu; this.voiceFor = voiceFor; this.knowVoices = knowVoices;`, ctx);
  return { ctx, ids, saved, played, asked };
}

const knowing = (opts, list = SERVER) => { const p = player(opts); p.ctx.knowVoices({ server: true, natural: list }); return p; };
test('web player: an Italian page with an English main voice is read by the stored voice for Italian', () => {
  assert.equal(knowing({ cfg: { italianVoice: 'im_nicola' } }).ctx.voiceFor(IT), 'kokoro:im_nicola');
  assert.equal(knowing({ cfg: { italianVoice: 'if_sara' } }).ctx.voiceFor(IT), 'kokoro:if_sara');
  assert.equal(knowing({ cfg: { italianVoice: undefined } }).ctx.voiceFor(IT), 'kokoro:if_sara', 'not set: Sara');
  assert.equal(knowing({ cfg: { voice: 'kokoro:if_sara', italianVoice: 'im_nicola' } }).ctx.voiceFor(IT), 'kokoro:if_sara', 'a chosen Italian voice stays');
});
test('web player: a stored voice for Italian that the voice server does not offer gives Sara', () => {
  assert.equal(knowing({ cfg: { italianVoice: 'im_nicola' } }, ONE_ITALIAN).ctx.voiceFor(IT), 'kokoro:if_sara');
});
test('web player: no voice list known yet: Sara reads, and the list is asked once; then the stored voice reads', async () => {
  const p = player({ cfg: { italianVoice: 'im_nicola' } });
  assert.equal(p.ctx.voiceFor(IT), 'kokoro:if_sara');
  assert.equal(p.ctx.voiceFor(IT), 'kokoro:if_sara');
  assert.deepEqual(p.asked, [{ cmd: 'voices' }], 'one question only');
  await new Promise((r) => setImmediate(r));
  assert.equal(p.ctx.voiceFor(IT), 'kokoro:im_nicola');
  const en = player({ cfg: { italianVoice: 'im_nicola' }, says: [EN] });
  en.ctx.voiceFor(EN);
  assert.deepEqual(en.asked, [], 'English text asks nothing');
  const sara = player({ cfg: {} });
  sara.ctx.voiceFor(IT);
  assert.deepEqual(sara.asked, [], 'Sara needs no list');
});
test('web player: English text keeps the main voice; an unknown language keeps the main voice', () => {
  assert.equal(player({ cfg: { voice: 'kokoro:am_michael', italianVoice: 'im_nicola' }, says: [EN] }).ctx.voiceFor(EN), 'kokoro:am_michael');
  assert.equal(player({ cfg: { voice: 'kokoro:im_nicola' }, says: [EN] }).ctx.voiceFor(EN), 'kokoro:af_heart');
  assert.equal(player({ cfg: { italianVoice: 'im_nicola' }, says: ['Ciao.'] }).ctx.voiceFor('Ciao.'), 'kokoro:af_heart');
  assert.equal(player({ cfg: { voice: 'system:Milena' } }).ctx.voiceFor(IT), 'system:Alice', 'the Mac voice is not changed');
});

// ---------- the Player bar settings ----------
test('Player bar settings: "Voice for Italian" shows Sara and Nicola from the server list, the stored one pressed', async () => {
  const { ctx, ids } = player({ cfg: { italianVoice: 'im_nicola' } });
  await ctx.menu();
  assert.equal(ids.itBox.hidden, false);
  assert.deepEqual(ids.itVoices.childNodes.map((b) => [b.textContent, b.attrs['aria-pressed']]), [['Sara', 'false'], ['Nicola', 'true']]);
});
test('Player bar settings: "Voice for Italian" is hidden with one Italian voice, none, or no voice server', async () => {
  for (const answer of [{ server: true, natural: ONE_ITALIAN, system: [] }, { server: true, natural: SERVER.slice(0, 3), system: [] },
    { server: false, natural: [], system: [] }, null]) {  // null: no answer (undefined would take the default answer)
    const { ctx, ids } = player({ cfg: {}, answer });
    await ctx.menu();
    assert.equal(ids.itBox.hidden, true, String(JSON.stringify(answer)));
    assert.equal(ids.itVoices.childNodes.length, 0);
  }
});
test('Player bar settings: a press on Nicola stores it, says it in the reason line, and reads on with Nicola', async () => {
  const { ctx, ids, saved, played } = player({ cfg: {} });
  await ctx.menu();
  assert.equal(ids.voiceWhy.textContent, 'This page is in Italian, so Sara reads it.');
  ids.itVoices.childNodes[1].click();
  assert.equal(saved.at(-1).italianVoice, 'im_nicola');
  assert.deepEqual(ids.itVoices.childNodes.map((b) => b.attrs['aria-pressed']), ['false', 'true']);
  assert.equal(ids.voiceWhy.textContent, 'This page is in Italian, so Nicola reads it.');
  assert.deepEqual(played, [[0, 0]], 'the present Sentence is read again with the new voice');
});
test('Player bar settings: no reason line when the main voice reads', async () => {
  const { ctx, ids } = player({ cfg: { voice: 'kokoro:am_michael' }, says: [EN] });
  await ctx.menu();
  assert.equal(ids.voiceWhy.textContent, '');
  const it = player({ cfg: { voice: 'kokoro:if_sara' }, says: [EN] });
  await it.ctx.menu();
  assert.equal(it.ids.voiceWhy.textContent, 'This page is in English, so Heart reads it.');
});
test('Player bar settings: a Russian Sentence and a voice server that does not answer have their own reason', async () => {
  const ru = player({ cfg: {}, says: ['Привет, как дела?'] });
  await ru.ctx.menu();
  assert.equal(ru.ids.voiceWhy.textContent, 'This page is in Russian, so Milena reads it.');
  const off = player({ cfg: {}, says: [EN], natOff: true });
  await off.ctx.menu();
  assert.equal(off.ids.voiceWhy.textContent, 'The voice server does not answer, so Samantha reads this page.');
});
test('Player bar settings: a voice list that says the voice server is off gives no "Sara reads it" line', async () => {
  for (const answer of [{ server: false, natural: [], system: [] }, null]) {
    const p = player({ cfg: {}, answer });
    await p.ctx.menu();
    assert.equal(p.ids.voiceWhy.textContent, 'The voice server does not answer, so Alice reads this page.');
    assert.equal(p.ctx.natOff, false, 'natOff is not set by the line');
  }
});
test('Player bar settings: the reason line has the status role; the Italian choice is a labelled group', () => {
  assert.match(CONTENT, /<p class="ver" id="voiceWhy" role="status"><\/p>/);
  assert.match(CONTENT, /<div id="itBox" hidden><h4 id="itHead">Voice for Italian<\/h4><div class="places" id="itVoices" role="group" aria-labelledby="itHead"><\/div><\/div>/);
  assert.match(CONTENT, /const DEFAULTS = \{[^}]*italianVoice: 'if_sara'/);
});

// ---------- the add-on popup ----------
function popupEl(tag) {
  const e = el(tag);
  e.value = '';
  return e;
}
async function popup(answer, stored = {}) {
  const els = {};
  let store = { ra2: { ...stored } };
  const node = (id) => (els[id] ||= Object.assign(popupEl(id === 'voice' || id === 'italian' || id === 'method' ? 'select' : 'div'), { id, checked: false, querySelector: () => ({ disabled: false }) }));
  const chrome = {
    tabs: { query: async () => [{ id: 1, url: 'https://example.org/' }], sendMessage: async () => {}, create() {} },
    storage: { sync: { get: async () => JSON.parse(JSON.stringify(store)), set: async (o) => { store = JSON.parse(JSON.stringify(o)); } } },
    runtime: { sendMessage: async () => answer, getManifest: () => ({ version: '1' }) },
  };
  class Option { constructor(text, value) { this.tagName = 'OPTION'; this.textContent = text; this.value = value; } }
  vm.runInNewContext(read('extension/popup.js'), { chrome, document: { getElementById: node, createElement: popupEl }, Option, URL, window: {}, Number, String, Map, Array, JSON, console });
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  return { $: node, store: () => store, setStore: (s) => { store = s; } };
}
test('popup: "Voice for Italian" shows the Italian voices of the server list, with the stored one chosen', async () => {
  const { $ } = await popup({ server: true, natural: SERVER, system: [], methods: ['B'] }, { italianVoice: 'im_nicola' });
  assert.equal($('italianRow').hidden, false);
  assert.deepEqual($('italian').childNodes.map((o) => [o.textContent, o.value]), [['Sara', 'if_sara'], ['Nicola', 'im_nicola']]);
  assert.equal($('italian').value, 'im_nicola');
  const fresh = await popup({ server: true, natural: SERVER, system: [], methods: ['B'] });
  assert.equal(fresh.$('italian').value, 'if_sara', 'Sara is the default');
});
test('popup: "Voice for Italian" is hidden with fewer than two Italian voices or no voice server', async () => {
  for (const answer of [{ server: true, natural: ONE_ITALIAN, system: [] }, { server: false, natural: [], system: [] }]) {
    const { $ } = await popup(answer);
    assert.equal($('italianRow').hidden, true);
  }
});
test('popup: a change stores only the italianVoice key, read fresh (a voice that another tab saved is kept)', async () => {
  const p = await popup({ server: true, natural: SERVER, system: [], methods: ['B'] });
  p.setStore({ ra2: { voice: 'kokoro:bf_emma', rate: 1.5 } });
  p.$('italian').value = 'im_nicola';
  await p.$('italian').onchange();
  assert.deepEqual(p.store().ra2, { voice: 'kokoro:bf_emma', rate: 1.5, italianVoice: 'im_nicola' });
});
test('popup: the setting has a label for a screen reader and hides with the hidden attribute', () => {
  const html = read('extension/popup.html');
  assert.match(html, /<label class="f" id="italianRow" hidden>Voice for Italian <select id="italian"><\/select><\/label>/);
  assert.match(html, /label\.f\[hidden\] \{ display: none; \}/);
  assert.match(read('extension/popup.js'), /const DEFAULTS = \{[^}]*italianVoice: 'if_sara'/);
});

// ---------- the reader ----------
const APP = read('extension/pdf/app.js');
const appFn = (re, what) => { const m = APP.match(re); assert.ok(m, `app.js has ${what}`); return m[0]; };
function reader({ voices, engineId = 'kokoro', stored = null, chosen = 'af_heart', lang = 'it', sync, onChanged, options = [], playing = false }) {
  const restarts = [];
  const ids = {};
  const store = new Map(stored ? [['ra2.italianVoice', stored]] : []);
  const $ = (id) => (ids[id] ||= { id, hidden: false, value: '', children: [], set innerHTML(_) { this.children = []; },
    appendChild(c) { this.children.push(c); return c; }, addEventListener(t, f) { this['on' + t] = f; } });
  ids.voiceSel = { value: chosen, options, selectedOptions: [{ textContent: 'Heart, warm female · American' }] };
  const src = [
    appFn(/\nconst ITALIAN_KEY = [^\n]*\n/, 'ITALIAN_KEY'), appFn(/\nlet italianVoice = [^\n]*\n/, 'italianVoice'), appFn(/\nlet italianChosen = [^\n]*\n/, 'italianChosen'),
    appFn(/\nfunction italianFor\(\) \{[\s\S]*?\n\}\n/, 'italianFor()'), appFn(/\nfunction readingVoice\(lang = state\.lang\) \{[\s\S]*?\n\}\n/, 'readingVoice()'),
    appFn(/\nfunction showVoiceName\(\) \{[\s\S]*?\n\}\n/, 'showVoiceName()'), appFn(/\nfunction fillItalianSelect\(\) \{[\s\S]*?\n\}\n/, 'fillItalianSelect()'),
    appFn(/\nfunction setItalianVoice\(id, \{ store = true \} = \{\}\) \{[\s\S]*?\n\}\n/, 'setItalianVoice()'),
    appFn(/\nfunction watchItalianVoice\(\) \{[\s\S]*?\n\}\n/, 'watchItalianVoice()'),
  ].join('');
  const ctx = {
    $, els: { voiceSel: ids.voiceSel }, state: { lang, playing }, engine: { id: engineId, listVoices: () => voices },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    document: { createElement: () => ({}) }, voiceForLanguage, italianVoices, voiceReason, String, Array,
    stop() {}, play() { restarts.push(ctx.readingVoice()); },
  };
  if (sync || onChanged) ctx.chrome = { storage: { sync, onChanged } };
  vm.runInNewContext(`${src}\nthis.readingVoice = readingVoice; this.fill = fillItalianSelect; this.showVoiceName = showVoiceName; this.setItalianVoice = setItalianVoice; this.watch = watchItalianVoice;`, ctx);
  return { ctx, ids, store, restarts };
}
const READER_VOICES = SERVER.map((v) => ({ id: v.id, label: `${v.label} · ${v.accent}`, accent: v.accent }));
test('reader: an Italian Book with an English voice is read by the stored voice for Italian; Sara by default', () => {
  assert.equal(reader({ voices: READER_VOICES, stored: 'im_nicola' }).ctx.readingVoice(), 'im_nicola');
  assert.equal(reader({ voices: READER_VOICES }).ctx.readingVoice(), 'if_sara');
  assert.equal(reader({ voices: READER_VOICES, stored: 'im_nicola', lang: 'en' }).ctx.readingVoice(), 'af_heart');
  assert.equal(reader({ voices: READER_VOICES, stored: 'im_nicola', lang: '' }).ctx.readingVoice(), 'af_heart');
  assert.equal(reader({ voices: READER_VOICES, stored: 'im_nicola', chosen: 'if_sara' }).ctx.readingVoice(), 'if_sara');
});
test('reader: a stored voice that the voice server does not offer falls back to Sara', () => {
  assert.equal(reader({ voices: READER_VOICES.slice(0, 4), stored: 'im_nicola' }).ctx.readingVoice(), 'if_sara');
});
test('reader: the select "Voice for Italian" shows with two Italian voices, with the names and the stored choice', () => {
  const r = reader({ voices: READER_VOICES, stored: 'im_nicola' });
  r.ctx.fill();
  assert.equal(r.ids.italianRow.hidden, false);
  assert.deepEqual(r.ids.italianSel.children.map((o) => [o.textContent, o.value]), [['Sara', 'if_sara'], ['Nicola', 'im_nicola']]);
  assert.equal(r.ids.italianSel.value, 'im_nicola');
});
test('reader: the select is hidden with one Italian voice, and with the Mac voice', () => {
  const one = reader({ voices: READER_VOICES.slice(0, 4) });
  one.ctx.fill();
  assert.equal(one.ids.italianRow.hidden, true);
  const mac = reader({ voices: [{ id: 'alice', label: 'Alice', lang: 'it' }, { id: 'x', label: 'X', lang: 'it' }], engineId: 'system' });
  mac.ctx.fill();
  assert.equal(mac.ids.italianRow.hidden, true);
});
test('reader: a change keeps the choice in localStorage and in the add-on storage (only its key), and says it', async () => {
  let ra2 = { voice: 'kokoro:bf_emma', method: 'C' };
  const sync = { get: async () => ({ ra2: { ...ra2 } }), set: async (o) => { ra2 = o.ra2; } };
  const r = reader({ voices: READER_VOICES, sync });
  r.ctx.setItalianVoice('im_nicola');
  for (let i = 0; i < 5; i++) await new Promise((res) => setImmediate(res));
  assert.equal(r.store.get('ra2.italianVoice'), 'im_nicola');
  assert.deepEqual(JSON.parse(JSON.stringify(ra2)), { voice: 'kokoro:bf_emma', method: 'C', italianVoice: 'im_nicola' });
  assert.equal(r.ctx.readingVoice(), 'im_nicola');
  assert.equal(r.ids.voiceHint.textContent, 'This book is in Italian, so Nicola reads it.');
  const plain = reader({ voices: READER_VOICES });  // the reader from the voice server: no chrome.storage
  plain.ctx.setItalianVoice('im_nicola');
  assert.equal(plain.store.get('ra2.italianVoice'), 'im_nicola');
});
test('reader: index.html has the labelled select; app.js reads the add-on storage at the start', () => {
  const html = read('extension/pdf/index.html');
  assert.match(html, /<label class="field" id="italianRow" hidden><span>Voice for Italian<\/span><select id="italianSel"><\/select><\/label>/);
  assert.match(APP, /import \{[^}]*\bitalianVoices\b[^}]*\bvoiceReason\b[^}]*\} from '\.\/language\.js';/);
  assert.match(APP, /\?\.get\('ra2'\)\.then\(\(r\) => \{ const v = r\?\.ra2\?\.italianVoice;/);
});

const tick = async () => { for (let i = 0; i < 5; i++) await new Promise((res) => setImmediate(res)); };
const REAL_OPTIONS = READER_VOICES.map((v) => ({ value: v.id, textContent: v.label }));  // "Sara, Italian female · Italian"
test('reader: the hint names the voice by its name only, with a real option text of the voice server', () => {
  const r = reader({ voices: READER_VOICES, options: REAL_OPTIONS });
  r.ctx.showVoiceName();
  assert.equal(r.ids.voiceHint.textContent, 'This book is in Italian, so Sara reads it.');
  assert.equal(r.ids.settingsVoice.textContent, 'Sara');
});
test('reader: a change while reading an English Book does not break the reading; an Italian Book reads on with the new voice', () => {
  const en = reader({ voices: READER_VOICES, lang: 'en', playing: true });
  en.ctx.setItalianVoice('im_nicola');
  assert.deepEqual(en.restarts, []);
  const it = reader({ voices: READER_VOICES, playing: true });
  it.ctx.setItalianVoice('im_nicola');
  assert.deepEqual(it.restarts, ['im_nicola']);
  it.ctx.setItalianVoice('im_nicola');
  assert.deepEqual(it.restarts, ['im_nicola'], 'the same voice again: no restart');
});
test('reader: the first read of the add-on storage does not write over a choice that the owner made meanwhile', async () => {
  let answer;
  const sync = { get: () => new Promise((res) => { answer = res; }), set: async () => {} };
  const r = reader({ voices: READER_VOICES, sync });
  r.ctx.watch();
  r.ctx.setItalianVoice('im_nicola');
  answer({ ra2: { italianVoice: 'if_sara' } });
  await tick();
  assert.equal(r.ctx.readingVoice(), 'im_nicola');
  const late = reader({ voices: READER_VOICES, sync: { get: async () => ({ ra2: { italianVoice: 'im_nicola' } }), set: async () => {} } });
  late.ctx.watch();
  await tick();
  assert.equal(late.ctx.readingVoice(), 'im_nicola', 'with no choice of the owner the stored value wins');
  assert.equal(late.store.get('ra2.italianVoice'), 'im_nicola');
});
test('reader: a change in the popup or the web player reaches the open reader', async () => {
  let listener = null;
  const onChanged = { addListener: (f) => { listener = f; } };
  const r = reader({ voices: READER_VOICES, onChanged, options: REAL_OPTIONS, playing: true });
  r.ctx.watch();
  listener({ ra2: { newValue: { italianVoice: 'im_nicola' } } });
  assert.equal(r.ctx.readingVoice(), 'im_nicola');
  assert.equal(r.store.get('ra2.italianVoice'), 'im_nicola');
  assert.equal(r.ids.italianSel.value, 'im_nicola');
  assert.equal(r.ids.voiceHint.textContent, 'This book is in Italian, so Nicola reads it.');
  assert.deepEqual(r.restarts, ['im_nicola']);
  listener({ ra2: { newValue: { italianVoice: 'im_nicola', rate: 2 } } });
  listener({ other: { newValue: 1 } });
  assert.deepEqual(r.restarts, ['im_nicola'], 'no restart when the voice did not change');
  const plain = reader({ voices: READER_VOICES });  // no chrome: no throw
  plain.ctx.watch();
});

// ---------- the version ----------
test('the add-on version is 2.12.0 or later (one bump for the spec "Italian voices")', () => {
  // 13 Nov 2026: version 2.13.0 (the report and the second try of the Natural voice); a later bump must not break this test
  const [major, minor] = JSON.parse(read('extension/manifest.json')).version.split('.').map(Number);
  assert.ok(major > 2 || (major === 2 && minor >= 12), 'version ' + JSON.parse(read('extension/manifest.json')).version);
});

// keep the imports used
test('isItalianVoice and textLanguage still agree with the rule', () => {
  assert.ok(isItalianVoice('im_nicola') && textLanguage(IT) === 'it' && voiceGroups(SERVER).length === 2);
});
