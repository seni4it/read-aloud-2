// Ticket 01 of the spec "Italian voices that the owner can find": the voice lists group the natural voices by
// language ("English", then "Italian", then other accents), from the accent that the voice server gives.
// One pure function, voiceGroups() in extension/pdf/language.js. content.js (the web player) and popup.js cannot
// import, so each has a copy; a test here keeps the copies equal (the method of italian-reading.test.mjs).
// The four lists run here on fake pages: the Player bar settings, the add-on popup, the reader and the voice sampler.
// Run: node --test tests/node/voice-groups.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { voiceGroups, voiceGroup } from '../../extension/pdf/language.js';

const file = (p) => fileURLToPath(new URL('../../' + p, import.meta.url));
const read = (p) => readFileSync(file(p), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));  // values from a vm context have other prototypes

// The /voices answer of voice-server.py, in its order.
const SERVER = [
  { id: 'af_heart', accent: 'American', label: 'Heart, warm female' },
  { id: 'am_michael', accent: 'American', label: 'Michael, deep male' },
  { id: 'bf_emma', accent: 'British', label: 'Emma, female' },
  { id: 'if_sara', accent: 'Italian', label: 'Sara, Italian female' },
  { id: 'im_nicola', accent: 'Italian', label: 'Nicola, Italian male' },
];
const names = (groups) => groups.map((g) => [g.name, g.voices.map((v) => v.id)]);

// ---------- the pure function ----------
test('voiceGroups: American and British are "English", Italian is "Italian", English first', () => {
  assert.deepEqual(names(voiceGroups(SERVER)), [
    ['English', ['af_heart', 'am_michael', 'bf_emma']],
    ['Italian', ['if_sara', 'im_nicola']],
  ]);
});

test('voiceGroups: the order inside a group is the order of the voice server; English stays first', () => {
  const list = [SERVER[4], SERVER[2], SERVER[3], SERVER[0]];
  assert.deepEqual(names(voiceGroups(list)), [['English', ['bf_emma', 'af_heart']], ['Italian', ['im_nicola', 'if_sara']]]);
});

test('voiceGroups: an unknown accent is its own group, with the name of the accent, after Italian', () => {
  const list = [{ id: 'ef_dora', accent: 'Spanish', label: 'Dora' }, ...SERVER, { id: 'ff_siwis', accent: 'French', label: 'Siwis' }];
  assert.deepEqual(names(voiceGroups(list)).map((g) => g[0]), ['English', 'Italian', 'Spanish', 'French']);
});

test('voiceGroups: a voice with no accent (an old voice server) takes its group from its id', () => {
  const old = [{ id: 'af_heart', label: 'Heart' }, { id: 'if_sara', label: 'Sara' }, { id: 'zf_xiaobei', label: 'Xiaobei' }];
  assert.deepEqual(names(voiceGroups(old)), [['English', ['af_heart']], ['Italian', ['if_sara']], ['Other', ['zf_xiaobei']]]);
});

test('voiceGroups: no list, or an empty list, gives no group; an empty group is not shown', () => {
  assert.deepEqual(voiceGroups([]), []);
  assert.deepEqual(voiceGroups(undefined), []);
  assert.deepEqual(names(voiceGroups([SERVER[3]])), [['Italian', ['if_sara']]]);
});

test('voiceGroup: the language group of one voice', () => {
  assert.equal(voiceGroup(SERVER[3]), 'Italian');
  assert.equal(voiceGroup(SERVER[2]), 'English');
  assert.equal(voiceGroup({ id: 'im_nicola' }), 'Italian');
  assert.equal(voiceGroup({ id: 'x', accent: 'Spanish' }), 'Spanish');
});

// ---------- the copies ----------
const MINE = read('extension/pdf/language.js').match(/export function voiceGroups\(voices\) \{[\s\S]*?\n\}\n/)[0]
  .replace(/^export /, '').trim();
for (const [where, re, dedent] of [
  ['extension/content.js', /\n  function voiceGroups\(voices\) \{[\s\S]*?\n  \}\n/, true],
  ['extension/popup.js', /\nfunction voiceGroups\(voices\) \{[\s\S]*?\n\}\n/, false],
]) {
  test(`the copy of voiceGroups in ${where} is the same as the one in language.js`, () => {
    const fn = read(where).match(re);
    assert.ok(fn, `${where} has voiceGroups(voices)`);
    assert.equal((dedent ? fn[0].replace(/\n  /g, '\n') : fn[0]).trim(), MINE);
    const run = vm.runInNewContext(`(${fn[0].trim()})`, { String, Map });
    for (const l of [SERVER, [], undefined, [{ id: 'if_sara' }, { id: 'q', accent: 'Spanish' }]]) {
      assert.deepEqual(plain(run(l)), plain(voiceGroups(l)));
    }
  });
}

// ---------- a small fake DOM ----------
function el(tag) {
  const e = {
    tagName: tag.toUpperCase(), childNodes: [], attrs: {}, textContent: '', className: '', label: '', value: '', disabled: false,
    classList: { add() {}, remove() {} },
    get children() { return this.childNodes; },
    get lastChild() { return this.childNodes.at(-1); },
    append(...cs) { for (const c of cs) this.childNodes.push(typeof c === 'string' ? { text: c } : c); },
    appendChild(c) { this.childNodes.push(c); return c; },
    replaceChildren(...cs) { this.childNodes = []; this.append(...cs); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener() {},
  };
  // a set of textContent or innerHTML empties the element, as in a browser
  let text = '';
  Object.defineProperty(e, 'textContent', { get: () => text, set: (v) => { text = v; e.childNodes = []; } });
  // innerHTML: the voice sampler card writes two spans; the fake makes two empty spans
  Object.defineProperty(e, 'innerHTML', { get: () => '', set: (v) => { e.childNodes = /<span/.test(v) ? [el('span'), el('span')] : []; } });
  return e;
}
const document = { createElement: el };
// [heading, [voice labels]] for each heading of a list of headings and buttons (the Player bar)
function headed(box, headTag, itemTag) {
  const out = [];
  for (const c of box.childNodes) {
    if (c.tagName === headTag) out.push([c.textContent, []]);
    else if (c.tagName === itemTag) out.at(-1)[1].push(c.textContent);
  }
  return out;
}

// ---------- the Player bar settings (content.js) ----------
test('Player bar settings: headings English, Italian, then the Mac voice; Sara and Nicola under Italian', async () => {
  const src = read('extension/content.js');
  const menu = src.match(/\n  async function menu\(\) \{[\s\S]*?\n  \}\n/);
  const groups = src.match(/\n  function voiceGroups\(voices\) \{[\s\S]*?\n  \}\n/);
  assert.ok(menu && groups);
  const box = el('div');
  const answer = { server: true, natural: SERVER, system: [{ id: 'Milena', label: 'Milena, Russian' }] };
  const fns = src.match(/\n  function versionLine\(version, voices\) \{[\s\S]*?\n  \}\n  [\s\S]*?\n  function addonVersion\(\) \{[\s\S]*?\n  \}\n/);  // ticket 03: menu() also writes the version line
  const line = el('p');
  const ctx = { document, Object, String, Map, chrome: { runtime: { getManifest: () => ({ version: '1' }) } }, $: (id) => (id === 'verLine' ? line : box), ask: async () => answer, dead: false, cfg: { voice: 'kokoro:if_sara' }, save() {}, S: {}, play() {}, showItalian() {} };  // ticket 04: tested in italian-voice-choice.test.mjs
  vm.runInNewContext(`${groups[0]}\n${fns[0]}\n${menu[0]}\nthis.menu = menu;`, ctx);
  await ctx.menu();
  assert.deepEqual(headed(box, 'H4', 'BUTTON'), [
    ['English', ['Heart, warm female', 'Michael, deep male', 'Emma, female']],
    ['Italian', ['Sara, Italian female', 'Nicola, Italian male']],
    ['Russian', ['Milena, Russian']],
  ]);
  assert.ok(box.childNodes.filter((c) => c.tagName === 'H4').length === 3, 'each heading is an h4 (heading role)');
  assert.equal(box.childNodes.find((c) => c.textContent === 'Sara, Italian female').className, 'on', 'the chosen voice is marked');
});

// ---------- the add-on popup ----------
async function popupSelect(answer) {
  const els = {};
  const node = (id) => (els[id] ||= Object.assign(el(id === 'voice' ? 'select' : 'div'), { id, checked: false, hidden: false,
    querySelector: () => ({ disabled: false }) }));
  const chrome = {
    tabs: { query: async () => [{ id: 1, url: 'https://example.org/' }], sendMessage: async () => {}, create() {} },
    storage: { sync: { get: async () => ({ ra2: {} }), set: async () => {} } },
    runtime: { sendMessage: async () => answer, getManifest: () => ({ version: '1' }) },
  };
  class Option { constructor(text, value) { this.tagName = 'OPTION'; this.textContent = text; this.value = value; } }
  vm.runInNewContext(read('extension/popup.js'), { chrome, document: { getElementById: node, createElement: el }, Option, URL, window: {}, Number, String, Map, console });
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  return node('voice');
}
test('popup: one optgroup for each language, then the Mac voice; the order of the voice server', async () => {
  const sel = await popupSelect({ server: true, natural: SERVER, system: [{ id: 'Milena', label: 'Milena, Russian' }], methods: ['A', 'B', 'C'] });
  assert.deepEqual(sel.childNodes.map((g) => [g.tagName, g.label, g.childNodes.map((o) => o.value)]), [
    ['OPTGROUP', 'English', ['kokoro:af_heart', 'kokoro:am_michael', 'kokoro:bf_emma']],
    ['OPTGROUP', 'Italian', ['kokoro:if_sara', 'kokoro:im_nicola']],
    ['OPTGROUP', 'Russian', ['system:Milena']],
  ]);
});
test('popup: with the voice server off, only the Mac voice group shows', async () => {
  const sel = await popupSelect({ server: false, natural: [], system: [{ id: 'Milena', label: 'Milena, Russian' }] });
  assert.deepEqual(sel.childNodes.map((g) => g.label), ['Russian']);
});

// ---------- the add-on background passes the accent on ----------
test('background voices(): the accent of each voice reaches the popup and the web player unchanged', () => {
  const src = read('extension/background.js');
  assert.match(src, /out\.natural = j\.voices;/, 'the server list goes on as it is (with its accent)');
});

// ---------- the reader ----------
function readerSelect(engine) {
  const src = read('extension/pdf/app.js');
  const fn = src.match(/\nfunction fillVoiceSelect\(\) \{[\s\S]*?\n\}\n/);
  assert.ok(fn, 'app.js has fillVoiceSelect()');
  assert.match(src, /import \{[^}]*\bvoiceGroups\b[^}]*\} from '\.\/language\.js';/, 'the reader imports voiceGroups');
  const sel = el('select');
  Object.defineProperty(sel, 'options', { get: () => sel.childNodes.flatMap((c) => (c.tagName === 'OPTGROUP' ? c.childNodes : [c])) });
  const ctx = { document, engine, voiceGroups, els: { voiceSel: sel }, localStorage: { getItem: () => null }, showVoiceName() {}, fillItalianSelect() {} };  // ticket 04: tested in italian-voice-choice.test.mjs
  vm.runInNewContext(`${fn[0]}\nfillVoiceSelect();`, ctx);
  return sel;
}
test('reader: the natural voices of the voice server show in optgroups English and Italian', () => {
  const list = SERVER.map((v) => ({ id: v.id, label: `${v.label} · ${v.accent}`, accent: v.accent }));
  const sel = readerSelect({ id: 'kokoro', listVoices: () => list });
  assert.deepEqual(sel.childNodes.map((g) => [g.tagName, g.label, g.childNodes.map((o) => o.value)]), [
    ['OPTGROUP', 'English', ['af_heart', 'am_michael', 'bf_emma']],
    ['OPTGROUP', 'Italian', ['if_sara', 'im_nicola']],
  ]);
});
test('reader: the Mac voices stay a flat list (no language groups)', () => {
  const sel = readerSelect({ id: 'system', listVoices: () => [{ id: 'a', label: 'Samantha (en-US)' }, { id: 'b', label: 'Alice (it-IT)' }] });
  assert.deepEqual(sel.childNodes.map((o) => [o.tagName, o.value]), [['OPTION', 'a'], ['OPTION', 'b']]);
});
test('reader: the voice server engine keeps the accent of each voice', async () => {
  const { ServerEngine } = await import('../../extension/pdf/tts.js');
  const was = globalThis.fetch;
  globalThis.fetch = async () => ({ json: async () => ({ voices: SERVER, speed: { methods: ['A', 'B'] } }) });
  try {
    const e = new ServerEngine();
    await e.init();
    assert.deepEqual(e.listVoices().map((v) => v.accent), SERVER.map((v) => v.accent));
    assert.deepEqual(names(voiceGroups(e.listVoices())), [['English', ['af_heart', 'am_michael', 'bf_emma']], ['Italian', ['if_sara', 'im_nicola']]]);
  } finally { globalThis.fetch = was; }
});

// ---------- the voice sampler (voices.html, a page of the voice server) ----------
test('voice sampler: a heading for each language, with the voices of that language under it', async () => {
  const html = read('voices.html');
  const m = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(m, 'the sampler script is a module');
  // a dynamic import: when the reader's file does not load, the Mac voice list of the page still shows
  assert.match(m[1], /import\('\/reader\/language\.js'\)/, 'it imports the function of the reader');
  assert.doesNotMatch(m[1], /^\s*import\s*\{/m, 'no static import');
  const code = m[1].replace(/import\('\/reader\/language\.js'\)/, '({ voiceGroups })');
  const ids = {};
  const ctx = {
    document: { getElementById: (id) => (ids[id] ||= el('div')), createElement: el }, Object, Number, String, encodeURIComponent, Promise,
    voiceGroups, Audio: class { }, speechSynthesis: { getVoices: () => [], cancel() {} },
    fetch: async () => ({ json: async () => ({ voices: SERVER }) }),
  };
  vm.runInNewContext(code, ctx);
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  const out = ids.natural.childNodes.map((c) => [c.tagName, c.tagName === 'H3' ? c.textContent : c.childNodes.length]);
  assert.deepEqual(out, [['H3', 'English'], ['DIV', 3], ['H3', 'Italian'], ['DIV', 2]]);
});
