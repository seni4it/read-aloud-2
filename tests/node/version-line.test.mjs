// Ticket 03 of the spec "Italian voices that the owner can find": one line with the version of the add-on and the
// count of the natural voices ("Read Aloud 2, version 2.12.0. 5 natural voices, 2 Italian."), in the add-on popup,
// at the end of the Player bar settings and in the settings panel of the reader.
// One pure function, versionLine() in extension/pdf/language.js. content.js and popup.js cannot import, so each has a
// copy; a test here keeps the copies equal. The version comes from the add-on manifest at run time.
// Run: node --test tests/node/version-line.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { versionLine, voiceGroups } from '../../extension/pdf/language.js';

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
const OLD = SERVER.slice(0, 3);  // an old voice server: no Italian voice
const OLD_LINE = 'The voice server is old and has no Italian voice. Restart it.';

// ---------- the pure function ----------
test('versionLine: five voices, two of them Italian', () => {
  assert.equal(versionLine('2.12.0', SERVER), 'Read Aloud 2, version 2.12.0. 5 natural voices, 2 Italian.');
});
test('versionLine: an old voice server with no Italian voice says: restart it', () => {
  assert.equal(versionLine('2.12.0', OLD), `Read Aloud 2, version 2.12.0. ${OLD_LINE}`);
  assert.equal(versionLine('2.12.0', []), `Read Aloud 2, version 2.12.0. ${OLD_LINE}`);
});
test('versionLine: no voice server (no answer) gives the version only; the "off" message is elsewhere', () => {
  assert.equal(versionLine('2.12.0', null), 'Read Aloud 2, version 2.12.0.');
  assert.equal(versionLine('2.12.0', undefined), 'Read Aloud 2, version 2.12.0.');
});
test('versionLine: no version (the reader opened from the voice server) gives the voice count only', () => {
  assert.equal(versionLine('', SERVER), '5 natural voices, 2 Italian.');
  assert.equal(versionLine(undefined, OLD), OLD_LINE);
  assert.equal(versionLine('', null), '');
});
test('versionLine: one voice is "voice", not "voices"; a voice with no accent counts by its id', () => {
  assert.equal(versionLine('', [{ id: 'if_sara' }]), '1 natural voice, 1 Italian.');
});
test('versionLine: no version number is written in the code', () => {
  for (const f of ['extension/pdf/language.js', 'extension/content.js', 'extension/popup.js', 'extension/pdf/app.js']) {
    assert.doesNotMatch(read(f), /version \d+\.\d+/i, `${f} has no fixed version number`);
  }
});

// ---------- the copies ----------
const MINE = read('extension/pdf/language.js').match(/export function versionLine\(version, voices\) \{[\s\S]*?\n\}\n/)[0]
  .replace(/^export /, '').trim();
for (const [where, re, dedent] of [
  ['extension/content.js', /\n  function versionLine\(version, voices\) \{[\s\S]*?\n  \}\n/, true],
  ['extension/popup.js', /\nfunction versionLine\(version, voices\) \{[\s\S]*?\n\}\n/, false],
]) {
  test(`the copy of versionLine in ${where} is the same as the one in language.js`, () => {
    const fn = read(where).match(re);
    assert.ok(fn, `${where} has versionLine(version, voices)`);
    assert.equal((dedent ? fn[0].replace(/\n  /g, '\n') : fn[0]).trim(), MINE);
    const run = vm.runInNewContext(`(${fn[0].trim()})`, { voiceGroups, Array });
    for (const [ver, list] of [['2.12.0', SERVER], ['2.12.0', OLD], ['2.12.0', null], ['', SERVER], ['', null]]) {
      assert.equal(run(ver, list), versionLine(ver, list));
    }
  });
}

// ---------- a small fake DOM ----------
function el(tag) {
  const e = {
    tagName: tag.toUpperCase(), childNodes: [], attrs: {}, className: '', label: '', value: '', disabled: false, hidden: false,
    classList: { add() {}, remove() {} },
    append(...cs) { for (const c of cs) this.childNodes.push(c); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener() {},
  };
  let text = '';
  Object.defineProperty(e, 'textContent', { get: () => text, set: (v) => { text = v; e.childNodes = []; } });
  Object.defineProperty(e, 'innerHTML', { get: () => text, set: (v) => { text = v; } });
  return e;
}

// ---------- the add-on popup ----------
async function popup(answer) {
  const els = {};
  const node = (id) => (els[id] ||= Object.assign(el(id === 'voice' ? 'select' : 'div'), { id, checked: false, querySelector: () => ({ disabled: false }) }));
  const chrome = {
    tabs: { query: async () => [{ id: 1, url: 'https://example.org/' }], sendMessage: async () => {}, create() {} },
    storage: { sync: { get: async () => ({ ra2: {} }), set: async () => {} } },
    runtime: { sendMessage: async () => answer, getManifest: () => ({ version: '9.8.7' }) },
  };
  class Option { constructor(text, value) { this.textContent = text; this.value = value; } }
  vm.runInNewContext(read('extension/popup.js'), { chrome, document: { getElementById: node, createElement: el }, Option, URL, window: {}, Number, String, Map, Array, console });
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  return node;
}
test('popup: the line shows the version from the manifest and the voice count', async () => {
  const $ = await popup({ server: true, natural: SERVER, system: [], methods: ['B'] });
  assert.equal($('version').textContent, 'Read Aloud 2, version 9.8.7. 5 natural voices, 2 Italian.');
  assert.match($('server').innerHTML, /ready/);
});
test('popup: an old voice server says restart it', async () => {
  const $ = await popup({ server: true, natural: OLD, system: [], methods: ['B'] });
  assert.equal($('version').textContent, `Read Aloud 2, version 9.8.7. ${OLD_LINE}`);
});
test('popup: no voice server keeps the "off" message, and the line gives the version only', async () => {
  const $ = await popup({ server: false, natural: [], system: [] });
  assert.equal($('version').textContent, 'Read Aloud 2, version 9.8.7.');
  assert.match($('server').innerHTML, /<b>off<\/b>/);
});
test('popup: the line is a status line in the small text style', () => {
  const html = read('extension/popup.html');
  assert.match(html, /<p id="version" role="status"><\/p>/);
  assert.match(html, /#server, #version \{/);
});

// ---------- the Player bar settings (content.js) ----------
async function playerMenu(answer, chrome) {
  const src = read('extension/content.js');
  const parts = ['voiceGroups(voices)', 'versionLine(version, voices)', 'addonVersion()', 'async menu()']
    .map((sig) => src.match(new RegExp(`\\n  ${sig.startsWith('async') ? 'async function menu\\(\\)' : 'function ' + sig.replace(/[()]/g, '\\$&')} \\{[\\s\\S]*?\\n  \\}\\n`)));
  assert.ok(parts.every(Boolean), 'content.js has voiceGroups, versionLine, addonVersion and menu');
  const box = el('div'), line = el('p');
  const ctx = { document: { createElement: el }, Object, String, Map, Array, chrome, $: (id) => (id === 'verLine' ? line : box),
    ask: async () => answer, dead: false, cfg: { voice: 'kokoro:af_heart' }, save() {}, S: {}, play() {}, showItalian() {} };  // ticket 04: tested in italian-voice-choice.test.mjs
  vm.runInNewContext(`${parts.map((p) => p[0]).join('\n')}\nthis.menu = menu;`, ctx);
  await ctx.menu();
  return { box, line };
}
const RUNTIME = { runtime: { getManifest: () => ({ version: '9.8.7' }) } };
test('Player bar settings: the line at the end shows the version and the voice count', async () => {
  const { line } = await playerMenu({ server: true, natural: SERVER, system: [] }, RUNTIME);
  assert.equal(line.textContent, 'Read Aloud 2, version 9.8.7. 5 natural voices, 2 Italian.');
});
test('Player bar settings: an old voice server says restart it; no voice server keeps the "off" message', async () => {
  assert.equal((await playerMenu({ server: true, natural: OLD, system: [] }, RUNTIME)).line.textContent, `Read Aloud 2, version 9.8.7. ${OLD_LINE}`);
  const off = await playerMenu({ server: false, natural: [], system: [] }, RUNTIME);
  assert.equal(off.line.textContent, 'Read Aloud 2, version 9.8.7.');
  assert.ok(off.box.childNodes.some((c) => /Natural voices are off/.test(c.textContent)));
});
test('Player bar settings: an old tab (no add-on connection, getManifest throws) does not break the settings', async () => {
  const gone = { runtime: { getManifest() { throw new Error('Extension context invalidated.'); } } };
  const { line, box } = await playerMenu({ server: true, natural: SERVER, system: [] }, gone);
  assert.equal(line.textContent, '5 natural voices, 2 Italian.');
  assert.ok(box.childNodes.length > 0, 'the voices still show');
  assert.equal((await playerMenu(undefined, gone)).line.textContent, '');
});
test('Player bar settings: the line is at the end of the settings, with the status role', () => {
  const src = read('extension/content.js');
  assert.match(src, /<p class="ver" id="verLine" role="status"><\/p>\n    <\/div>/);
});

// ---------- the reader settings panel ----------
test('reader: the settings panel ends with a status line; the reader imports versionLine', () => {
  const html = read('extension/pdf/index.html');
  assert.match(html, /<p class="status" id="versionLine" role="status"><\/p>\n  <\/div>/);
  assert.match(read('extension/pdf/app.js'), /import \{[^}]*\bversionLine\b[^}]*\} from '\.\/language\.js';/);
});
async function readerLine({ chrome, ready, down = false, voices, fetchAnswer }) {
  const src = read('extension/pdf/app.js');
  const fns = [/\nfunction addonVersion\(\) \{[\s\S]*?\n\}\n/, /\nasync function showVersionLine\(\) \{[\s\S]*?\n\}\n/].map((re) => src.match(re));
  assert.ok(fns.every(Boolean), 'app.js has addonVersion() and showVersionLine()');
  const line = el('p');
  const ctx = {
    $: (id) => (id === 'versionLine' ? line : null), versionLine, AbortSignal: { timeout: () => undefined },
    engines: { kokoro: { ready, down, listVoices: () => voices } }, ServerEngine: { SERVER: 'http://localhost:8793' },
    fetch: async () => { if (!fetchAnswer) throw new Error('refused'); return { json: async () => fetchAnswer }; },
  };
  if (chrome) ctx.chrome = chrome;
  vm.runInNewContext(`${fns.map((f) => f[0]).join('\n')}\nthis.run = showVersionLine;`, ctx);
  await ctx.run();
  return line.textContent;
}
test('reader in the add-on: the version from the manifest and the voices of the started natural voice', async () => {
  assert.equal(await readerLine({ chrome: RUNTIME, ready: true, voices: SERVER }), 'Read Aloud 2, version 9.8.7. 5 natural voices, 2 Italian.');
});
test('reader from the voice server (no chrome): the voice count without a version', async () => {
  assert.equal(await readerLine({ ready: true, voices: SERVER }), '5 natural voices, 2 Italian.');
  assert.equal(await readerLine({ chrome: {}, ready: true, voices: OLD }), OLD_LINE);
});
test('reader: the natural voice not started (Mac voice) asks the voice server; no answer gives the version only', async () => {
  assert.equal(await readerLine({ chrome: RUNTIME, ready: false, voices: [], fetchAnswer: { voices: SERVER } }),
    'Read Aloud 2, version 9.8.7. 5 natural voices, 2 Italian.');
  assert.equal(await readerLine({ chrome: RUNTIME, ready: false, voices: [] }), 'Read Aloud 2, version 9.8.7.');
  assert.equal(await readerLine({ ready: false, voices: [] }), '');
});
test('reader: a voice server that stopped after its start gives no voice count from the old list', async () => {
  assert.equal(await readerLine({ chrome: RUNTIME, ready: true, down: true, voices: SERVER }), 'Read Aloud 2, version 9.8.7.');
});
