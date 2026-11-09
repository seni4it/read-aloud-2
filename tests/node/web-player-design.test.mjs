// Tests for ticket 24: the web-page player (extension/content.js) has the look of the reader player bar, and the add-on
// window (extension/popup.html) and the paste page (extension/paste.html) use the token file.
// The player lives in a shadow root on other sites, so it cannot load extension/pdf/tokens.css: content.js keeps a copy
// of the token values that it uses, in one block (TOKENS). These tests fail when a value of that copy differs from
// tokens.css, when the player uses a token that the copy does not set (a site could then give its value), and when a
// colour value is written anywhere else.
// Node has no browser: these tests read the files as text. The screenshots are a manual step (ticket 24, Work report).
// Run: node --test --test-timeout=120000 tests/node/web-player-design.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name) => readFileSync(fileURLToPath(new URL('../../extension/' + name, import.meta.url)), 'utf8');
const CONTENT = read('content.js');
const TOKENS_CSS = read('pdf/tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
const POPUP = read('popup.html');
const PASTE = read('paste.html');
const COLOUR = /#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|(?<![\w-])(white|black|red|orange|navy|gray|grey|blue|green|yellow)(?![\w-])/i;

// ---------- the token file ----------
const decls = (block) => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const ROOT = decls(/^:root\s*\{([^}]*)\}/m.exec(TOKENS_CSS)[1]);
const DARK = decls(/prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(TOKENS_CSS)[1]);
const REDUCE = decls(/prefers-reduced-motion:\s*reduce\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(TOKENS_CSS)[1]);
const norm = (v) => v.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').replace(/\(\s*/g, '(').replace(/\s*\)/g, ')').trim().toLowerCase();
function resolve(name, ...maps) {  // the value of a token, with each var() replaced (the first map that has a name wins)
  const raw = maps.find((m) => name in m)?.[name];
  assert.ok(raw !== undefined, `tokens.css defines ${name}`);
  return norm(raw.replace(/var\((--[\w-]+)\)/g, (_, n) => resolve(n, ...maps)));
}

// ---------- the copy in content.js ----------
const block = /\/\/ tokens:start([\s\S]*?)\/\/ tokens:end/.exec(CONTENT);
const COPY = block && new Function(`${block[1]}; return TOKENS;`)();
const STYLE = /sh\.innerHTML = `<style>([\s\S]*?)<\/style>/.exec(CONTENT)?.[1] || '';
const MARKUP = /<\/style>([\s\S]*?)`;/.exec(CONTENT.slice(CONTENT.indexOf('sh.innerHTML')))?.[1] || '';

test('content.js has one block of token values: root, dark and reduced motion', () => {
  assert.ok(block, 'a "// tokens:start" ... "// tokens:end" block');
  assert.equal((CONTENT.match(/tokens:start/g) || []).length, 1, 'one block only');
  for (const k of ['root', 'dark', 'reduce']) assert.equal(typeof COPY[k], 'object', `TOKENS.${k}`);
});

test('each value of the copy in content.js is the value of tokens.css, in light mode, dark mode and reduced motion', () => {
  for (const [k, v] of Object.entries(COPY.root)) assert.equal(norm(v), resolve(k, ROOT), `light ${k}`);
  // in dark mode the player shows root + dark: each token must have the value that tokens.css gives in dark mode
  for (const k of Object.keys(COPY.root)) {
    assert.equal(norm(COPY.dark[k] ?? COPY.root[k]), resolve(k, DARK, ROOT), `dark ${k}`);
  }
  for (const k of Object.keys(COPY.root)) {
    assert.equal(norm(COPY.reduce[k] ?? COPY.root[k]), resolve(k, REDUCE, ROOT), `reduced motion ${k}`);
  }
  for (const k of [...Object.keys(COPY.dark), ...Object.keys(COPY.reduce)]) assert.ok(k in COPY.root, `${k} also has a light value`);
});

test('each dark and reduced-motion token of tokens.css that the player uses is in the copy, with its value', () => {
  // the tokens of the style, and the ones that the script reads from the copy (the snap time)
  const used = new Set([...STYLE.matchAll(/var\((--[\w-]+)/g), ...CONTENT.matchAll(/TOKENS\.root\['(--[\w-]+)'\]/g)].map((m) => m[1]));
  const darkUsed = Object.keys(DARK).filter((k) => used.has(k));
  const reduceUsed = Object.keys(REDUCE).filter((k) => used.has(k));
  assert.ok(darkUsed.length >= 8 && reduceUsed.length >= 3, 'the player uses dark and motion tokens');
  for (const k of darkUsed) {
    assert.ok(k in COPY.dark, `${k} is in the dark part of the copy`);
    assert.equal(norm(COPY.dark[k]), resolve(k, DARK, ROOT), `dark ${k}`);
  }
  for (const k of reduceUsed) {
    assert.ok(k in COPY.reduce, `${k} is in the reduced-motion part of the copy`);
    assert.equal(norm(COPY.reduce[k]), resolve(k, REDUCE, ROOT), `reduced motion ${k}`);
  }
});

test('the player style uses only tokens that the copy sets, so a site cannot change them', () => {
  const used = new Set([...STYLE.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
  assert.ok(used.size > 10, 'the player uses tokens');
  for (const t of used) assert.ok(t in COPY.root, `${t} is in the copy`);
  assert.match(STYLE, /:host\s*\{\s*all:\s*initial;/, 'the page styles do not reach into the player');
  assert.match(STYLE, /prefers-color-scheme:\s*dark/, 'the player follows the dark mode of the system, as the reader bar');
});

test('no colour value in content.js outside the token block', () => {
  const rest = CONTENT.replace(block[0], '');
  const found = rest.split('\n').filter((l) => !/^\s*\/\//.test(l) && COLOUR.test(l.replace(/currentColor/g, '')));
  assert.deepEqual(found, []);
});

test('no colour value in popup.html and paste.html', () => {
  for (const [name, html] of [['popup.html', POPUP], ['paste.html', PASTE]]) {
    const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n').replace(/var\([^)]*\)/g, '');
    assert.ok(!COLOUR.test(css.replace(/@import[^;]*;/g, '')), `${name}: ${COLOUR.exec(css)?.[0]}`);
    assert.ok(!/\sstyle="[^"]*(#[0-9a-f]{3}|rgb)/i.test(html), `${name}: no colour in a style attribute`);
  }
});

// ---------- the same bar as the reader ----------
const ids = (html, list) => [...html.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]).filter((id) => list.includes(id));
test('the web player has the controls of the reader bar in the same order', () => {
  // reader: previous, play, next, position, speed, (highlight), follow, settings; the web player adds close at the end
  const reader = ids(read('pdf/index.html'), ['prevBtn', 'playBtn', 'nextBtn', 'seek', 'rateSel', 'findBtn', 'settingsBtn']);
  const SAME = { prevBtn: 'back', playBtn: 'pp', nextBtn: 'fwd', seek: 'pos', rateSel: 'speed', findBtn: 'find', settingsBtn: 'set' };
  const web = ids(MARKUP, ['back', 'pp', 'fwd', 'pos', 'speed', 'find', 'set', 'close']);
  assert.deepEqual(web, [...reader.map((r) => SAME[r]), 'close']);
});

const rule = (sel) => { const m = new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.[\]()]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(STYLE); return m ? m[1] : ''; };
test('text check: the sizes are the sizes of the reader bar: 40 px buttons, 48 px play, 32 and 40 px in a narrow window', () => {
  assert.match(rule('.bar button'), /width:\s*var\(--control-m\)/);
  assert.match(rule('.bar button'), /height:\s*var\(--control-m\)/);
  assert.match(rule('.bar .pp'), /width:\s*var\(--control-l\)/);
  assert.match(rule('.bar .pp'), /height:\s*var\(--control-l\)/);
  const narrow = /@media \(max-width:\s*480px\)\s*\{([\s\S]*?)\n\s*\}/.exec(STYLE)?.[1] || '';
  assert.match(narrow, /\.bar > button\s*\{[^}]*var\(--control-s\)/, 'narrow: 32 px buttons');
  assert.match(narrow, /\.bar > \.pp\s*\{[^}]*var\(--control-m\)/, 'narrow: 40 px play');
});

test('orange only for play, the play-from-here buttons and progress', () => {
  for (const m of STYLE.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim();
    if (/var\(--color-play/.test(m[2])) assert.match(sel, /^(\.bar \.pp(:hover|:active)?|\.hover|\.launch:hover)$/, `play colour on ${sel}`);
    if (/var\(--color-progress/.test(m[2])) assert.match(sel, /\.prog/, `progress colour on ${sel}`);
  }
  assert.match(rule('.bar'), /background:\s*var\(--color-surface\)/, 'the bar is the surface colour, as the reader bar');
});

test('every icon button of the bar has a name and a tooltip; the speed and settings buttons say that they open a list', () => {
  for (const id of ['back', 'pp', 'fwd', 'find', 'set', 'close']) {
    const tag = new RegExp(`<button[^>]*id="${id}"[^>]*>`).exec(MARKUP)?.[0] || '';
    assert.match(tag, /aria-label="[^"]+"/, `${id} has a name`);
    assert.match(tag, /data-tip="[^"]+"/, `${id} has a tooltip`);
  }
  assert.match(/<button[^>]*id="speed"[^>]*>/.exec(MARKUP)[0], /aria-expanded/);
  assert.match(/<button[^>]*id="set"[^>]*>/.exec(MARKUP)[0], /aria-expanded/);
});

// ---------- the add-on window and the paste page ----------
const popupCss = /<style>([\s\S]*?)<\/style>/.exec(POPUP)[1];
const popupRule = (sel) => new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(popupCss)?.[1] || '';
test('the add-on window has one filled button: Listen to this page', () => {
  const buttons = [...POPUP.matchAll(/<button\b[^>]*>([^<]*)/g)];
  assert.equal(buttons.length, 1, 'one button');
  assert.match(buttons[0][1], /Listen to this page/);
  assert.match(popupRule('.big'), /background:\s*var\(--color-play\)/);
});

test('the add-on window: main action, then voice and speed, then the switches in one group, then the links', () => {
  const at = (s) => POPUP.indexOf(s);
  assert.ok(at('id="read"') < at('id="voice"') && at('id="voice"') < at('id="rate"'), 'listen, voice, speed');
  const group = /<section class="switches"[^>]*>([\s\S]*?)<\/section>/.exec(POPUP);
  assert.ok(group, 'the switches are in one section');
  assert.equal((POPUP.match(/class="sw"/g) || []).length, (group[1].match(/class="sw"/g) || []).length, 'every switch is in it');
  assert.ok(at('id="rate"') < group.index && group.index < at('class="links"'), 'the switches come after speed, the links last');
});

test('text check: each switch of the add-on window is 32 px high or more, with its words on the left', () => {
  const min = /min-height:\s*var\((--[\w-]+)\)/.exec(popupRule('.sw'));
  assert.ok(min, 'a switch row has a min-height token');
  assert.ok(parseFloat(resolve(min[1], ROOT)) >= 32, `${min[1]} is 32 px or more in tokens.css`);
  for (const m of POPUP.matchAll(/<label class="sw"[^>]*>([\s\S]*?)<\/label>/g)) {
    assert.match(m[1], /^\s*[^<\s][^<]*<input/, `words before the switch: ${m[1].trim().slice(0, 40)}`);
  }
});

test('the links of the add-on window are quiet text', () => {
  const links = popupRule('.links a') || popupRule('a');
  assert.match(links, /color:\s*var\(--color-text-muted\)/);
  assert.doesNotMatch(links, /background/);
});

test('the paste page has one main action and loads the token file', () => {
  assert.equal((PASTE.match(/<button\b/g) || []).length, 1);
  assert.match(PASTE, /@import url\("pdf\/tokens\.css"\)/);
});
