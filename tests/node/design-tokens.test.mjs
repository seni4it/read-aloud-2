// Tests for the design tokens, ticket 20: one token file (extension/pdf/tokens.css) for the reader, the library,
// the popup and the paste page.
// Node has no browser, so these tests read the CSS as text. They check what a person sees: enough contrast in light
// and dark mode, no colour outside the token file, one type scale, orange only on play, word and progress, and
// no motion when the system asks for reduced motion.
// The web-page player (content.js, content.css) is ticket 24 and is not checked here.
// Run: ./run-tests.sh
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const TOKENS_PATH = 'extension/pdf/tokens.css';
const TOKENS = read(TOKENS_PATH);

// The style files and the pages with a <style> block of the four screens. The token file is not in this list.
// Allowed exception: extension/content.css and the styles in extension/content.js belong to the web-page player,
// which ticket 24 moves to the tokens.
const STYLE_FILES = ['extension/pdf/styles.css', 'extension/pdf/ra2-theme.css', 'app/library.css'];
const PAGES = ['extension/popup.html', 'extension/paste.html', 'extension/pdf/index.html', 'app/index.html', 'app/youtube-setup.html'];
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const styleBlocks = (html) => [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
const SOURCES = [
  ...STYLE_FILES.map((p) => ({ path: p, css: strip(read(p)) })),
  ...PAGES.map((p) => ({ path: p, css: strip(styleBlocks(read(p))) })),
];

// ---------- the token file: light values, dark values, var() resolved ----------

function declarations(block) {
  const out = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}
// The block of a media query: the text between its { and the matching }.
function mediaBlock(css, query) {
  const at = css.indexOf(query);
  if (at < 0) return '';
  let i = css.indexOf('{', at), depth = 0, start = i;
  for (; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) break;
  }
  return css.slice(start + 1, i);
}
const TOK = strip(TOKENS);
const firstRoot = /^:root\s*\{([\s\S]*?)\n\}/m.exec(TOK)[1];
const LIGHT = declarations(firstRoot);
const DARK = { ...LIGHT, ...declarations(mediaBlock(TOK, 'prefers-color-scheme: dark')) };
const MOTION = declarations(mediaBlock(TOK, 'prefers-reduced-motion: reduce'));

function resolve(mode, value, seen = new Set()) {
  return value.replace(/var\((--[\w-]+)\)/g, (_, name) => {
    assert.ok(!seen.has(name), `the token ${name} does not refer to itself`);
    assert.ok(name in mode, `the token ${name} is defined`);
    return resolve(mode, mode[name], new Set([...seen, name]));
  });
}

// ---------- colour and contrast (WCAG 2 relative luminance) ----------

function parseColour(text) {
  const t = text.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(t);
  if (m) return { r: parseInt(t.slice(1, 3), 16), g: parseInt(t.slice(3, 5), 16), b: parseInt(t.slice(5, 7), 16), a: 1 };
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(t);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  throw new Error('not a colour: ' + text);
}
const over = (top, under) => ({
  r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1,
});
const lum = ({ r, g, b }) => [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// One colour of a mode; a colour with alpha is put over the layers that are under it (last item = the bottom).
function colour(mode, ...stack) {
  let c = parseColour(resolve(mode, `var(${stack.at(-1)})`));
  assert.equal(c.a, 1, `${stack.at(-1)} is an opaque bottom layer`);
  for (const name of stack.slice(0, -1).reverse()) c = over(parseColour(resolve(mode, `var(${name})`)), c);
  return c;
}

// [what, text or control token, background tokens from top to bottom, minimum]
const TEXT = 4.5, LARGE = 3, CONTROL = 3;
const PAIRS = [
  ['body text on the page', ['--color-text'], ['--color-bg'], TEXT],
  ['body text on a card', ['--color-text'], ['--color-surface'], TEXT],
  ['text on a selected row', ['--color-text'], ['--color-surface-raised'], TEXT],
  ['text on a hovered card', ['--color-text'], ['--color-hover', '--color-surface'], TEXT],
  ['muted text on the page', ['--color-text-muted'], ['--color-bg'], TEXT],
  ['muted text on a card', ['--color-text-muted'], ['--color-surface'], TEXT],
  ['muted text on a selected row', ['--color-text-muted'], ['--color-surface-raised'], TEXT],
  ['large placeholder letters on the cover', ['--color-text-faint'], ['--color-surface-raised'], LARGE],
  ['page label on the PDF paper', ['--color-on-page'], ['--color-page'], TEXT],
  ['main button text', ['--color-on-action'], ['--color-action'], TEXT],
  ['play button icon and text', ['--color-on-play'], ['--color-play'], TEXT],
  ['play button on hover', ['--color-on-play'], ['--color-play-hover'], TEXT],
  ['text on the word highlight', ['--color-on-word'], ['--color-word'], TEXT],
  ['text on the navy bar', ['--color-on-chrome'], ['--color-chrome'], TEXT],
  ['muted text on the navy bar', ['--color-on-chrome-muted'], ['--color-chrome'], TEXT],
  ['text in a field on the navy bar', ['--color-on-chrome'], ['--color-chrome-field', '--color-chrome'], TEXT],
  ['text on a hovered button of the navy bar', ['--color-on-chrome'], ['--color-chrome-hover', '--color-chrome'], TEXT],
  ['warning text on a card', ['--color-danger'], ['--color-surface'], TEXT],
  ['warning text in its box', ['--color-danger'], ['--color-danger-soft', '--color-surface'], TEXT],
  ['notice text in its box', ['--color-notice-text'], ['--color-notice-bg'], TEXT],
  ['text on a scrim over the page', ['--color-on-chrome'], ['--color-scrim', '--color-bg'], TEXT],
  ['the edge of a field on a card', ['--color-control-border'], ['--color-surface'], CONTROL],
  ['the edge of a field on the page', ['--color-control-border'], ['--color-bg'], CONTROL],
  ['the focus ring on the page', ['--color-focus'], ['--color-bg'], CONTROL],
  ['the focus ring on a card', ['--color-focus'], ['--color-surface'], CONTROL],
  ['the focus ring on the navy bar', ['--color-focus'], ['--color-chrome'], CONTROL],
  ['the progress mark on its track', ['--color-progress'], ['--color-line'], CONTROL],
  ['the progress mark on a card', ['--color-progress'], ['--color-surface'], CONTROL],
  ['the play button on the navy bar', ['--color-play'], ['--color-chrome'], CONTROL],
  ['the main button on the page', ['--color-action'], ['--color-bg'], CONTROL],
];

for (const [modeName, mode] of [['light', LIGHT], ['dark', DARK]]) {
  test(`contrast in ${modeName} mode: each text pair is 4.5 to 1 or more, large text and controls 3 to 1 or more`, () => {
    const low = [];
    for (const [what, [fg], bgs, min] of PAIRS) {
      const bg = colour(mode, ...bgs);
      const top = parseColour(resolve(mode, `var(${fg})`));
      const r = ratio(top.a < 1 ? over(top, bg) : top, bg);
      if (r < min) low.push(`${what}: ${fg} on ${bgs.join(' over ')} = ${r.toFixed(2)} (needs ${min})`);
    }
    assert.deepEqual(low, [], low.join('\n'));
  });
}

test('dark mode: no light surface, the background is the darkest, cards are lighter', () => {
  const [bg, surface, raised] = ['--color-bg', '--color-surface', '--color-surface-raised'].map((n) => lum(colour(DARK, n)));
  for (const [n, l] of [['bg', bg], ['surface', surface], ['raised', raised], ['chrome', lum(colour(DARK, '--color-chrome'))]]) {
    assert.ok(l < 0.05, `dark ${n} is a dark tone (luminance ${l.toFixed(3)})`);
  }
  assert.ok(bg > 0, 'dark background is not pure black');
  assert.ok(bg < surface && surface < raised, 'background < cards < raised rows');
});

// ---------- one token file, used by every screen ----------

function filesNamed(dir, name, out = []) {
  for (const e of readdirSync(join(ROOT, dir))) {
    if (e === 'node_modules' || e.startsWith('.')) continue;
    const p = join(dir, e);
    if (statSync(join(ROOT, p)).isDirectory()) filesNamed(p, name, out);
    else if (e === name) out.push(p);
  }
  return out;
}

test('the token file has one copy only: the add-on and the voice server serve the same file', () => {
  assert.deepEqual([...filesNamed('extension', 'tokens.css'), ...filesNamed('app', 'tokens.css')], [TOKENS_PATH]);
  // The voice server serves extension/pdf at /reader/, so /reader/tokens.css is this same file.
  assert.match(read('voice-server.py'), /'\/reader\/':\s*os\.path\.join\(HERE,\s*'extension',\s*'pdf'\)/);
});

test('each screen loads the token file first', () => {
  const firstRule = (css) => strip(css).trim().split(/;|\{/)[0].trim();
  assert.equal(firstRule(read('extension/pdf/styles.css')), '@import url("tokens.css")', 'reader');
  assert.equal(firstRule(read('app/library.css')), '@import url("/reader/tokens.css")', 'library and YouTube setup');
  assert.equal(firstRule(styleBlocks(read('extension/popup.html'))), '@import url("pdf/tokens.css")', 'popup');
  assert.equal(firstRule(styleBlocks(read('extension/paste.html'))), '@import url("pdf/tokens.css")', 'paste page');
  assert.match(read('extension/pdf/index.html'), /<link rel="stylesheet" href="styles\.css">/, 'the reader page loads styles.css');
  assert.match(read('app/youtube-setup.html'), /<link rel="stylesheet" href="library\.css">/, 'the YouTube page loads library.css');
});

test('no style file or <style> block holds a colour value: only the token file does', () => {
  const NAMED = /\b(white|black|red|green|blue|yellow|orange|pink|purple|gray|grey|navy|silver|gold|teal|cyan|magenta)\b/i;
  const found = [];
  for (const { path, css } of SOURCES) {
    for (const m of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
      const [, prop, value] = m;
      if (prop.startsWith('--')) found.push(`${path}: a token is defined outside the token file: ${prop}`);
      if (/#[0-9a-f]{3,8}\b|\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i.test(value) || NAMED.test(value.replace(/var\([^)]*\)/g, ''))) {
        found.push(`${path}: ${prop}: ${value.trim()}`);
      }
    }
  }
  assert.deepEqual(found, [], found.join('\n'));
});

test('each token that a screen uses is defined in the token file', () => {
  const missing = [];
  for (const { path, css } of SOURCES) {
    for (const m of css.matchAll(/var\((--[\w-]+)/g)) if (!(m[1] in LIGHT)) missing.push(`${path}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('font sizes in use are only 12, 14, 16, 20 and 28 px, and line heights are steps of 4 px', () => {
  const SCALE = ['12', '14', '16', '20', '28'];
  for (const n of SCALE) assert.equal(LIGHT[`--text-${n}`], `${n}px`, `the token --text-${n}`);
  for (const [k, v] of Object.entries(LIGHT).filter(([k]) => k.startsWith('--leading-'))) {
    assert.equal(parseInt(v, 10) % 4, 0, `${k} is a step of 4 px`);
  }
  const bad = [];
  for (const { path, css } of SOURCES) {
    for (const m of css.matchAll(/(?:^|[;{\s])(font-size|font|line-height)\s*:\s*([^;{}]+)/g)) {
      const [, prop, value] = m;
      if (prop === 'font' && /^(inherit|unset|initial)$/.test(value.trim())) continue;
      const sizes = prop === 'line-height' ? [] : [...value.matchAll(/var\(--text-(\d+)\)|(\d+(?:\.\d+)?)(px|rem|em|pt)\b/g)];
      if (prop === 'font-size' && !/var\(--text-/.test(value)) bad.push(`${path}: font-size: ${value}`);
      for (const s of sizes) if (s[1] && !SCALE.includes(s[1])) bad.push(`${path}: ${prop}: ${value}`);
      if (prop === 'font' && !/var\(--text-/.test(value)) bad.push(`${path}: font: ${value}`);
      const lh = prop === 'line-height' ? value : (/\/\s*(\S+)/.exec(value) || [])[1];
      if (lh && !/^var\(--(leading-[\w-]+|control-[sml])\)$|^1$|^normal$/.test(lh.trim())) bad.push(`${path}: line height ${lh}`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('spacing and sizes in px are steps of 4 px', () => {
  // Allowed: 0, borders of 1 to 4 px, and the small pad of the word box around a glyph.
  const bad = [];
  for (const { path, css } of SOURCES) {
    for (const m of css.matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)) {
      const [, prop, value] = m;
      if (!/^(padding|margin|gap|row-gap|column-gap|width|height|min-width|max-width|min-height|max-height|top|right|bottom|left|inset)(-|$)/.test(prop)) continue;
      for (const px of value.matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
        const n = Math.abs(+px[1]);
        if (n % 4 !== 0 && n > 2) bad.push(`${path}: ${prop}: ${value.trim()}`);
      }
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('orange is used only by the play button, the word highlight and progress marks', () => {
  // The orange primitives appear only in the orange semantic tokens.
  const ORANGE_TOKENS = ['--color-play', '--color-play-hover', '--color-progress', '--color-word', '--color-sentence'];
  for (const mode of [LIGHT, DARK]) {
    for (const [name, value] of Object.entries(mode)) {
      if (name.startsWith('--orange-')) continue;
      const c = /^#|^rgba?\(/.test(value) ? parseColour(value) : null;
      const isOrange = /var\(--orange-/.test(value) || (c && c.r > 180 && c.g > 70 && c.g < 170 && c.b < 60);
      if (isOrange) assert.ok(ORANGE_TOKENS.includes(name), `${name} is orange, but it is not a play, word or progress token`);
    }
  }
  // Each use of an orange token is on a play control, a word or sentence mark, or a progress mark.
  const ALLOWED = {
    '--color-play': /play|\.big|^button$|ap-pp/,
    '--color-play-hover': /play|\.big|^button:hover$|ap-pp/,
    '--color-progress': /seek|scrub|range|\.bar i|parse-fill|toc button\.active/,
    '--color-word': /word|ask-word/,
    '--color-sentence': /speaking|sentence/,
  };
  const wrong = [];
  for (const { path, css } of SOURCES) {
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim().replace(/^@media[^{]*$/, '');
      for (const [token, ok] of Object.entries(ALLOWED)) {
        if (new RegExp(`var\\(${token}\\)`).test(m[2]) && !selector.split(',').every((s) => ok.test(s.trim()))) {
          wrong.push(`${path}: ${selector} uses ${token}`);
        }
      }
    }
  }
  assert.deepEqual(wrong, [], wrong.join('\n'));
});

test('motion: each transition and animation uses a motion token, and reduced motion sets each to 0', () => {
  const durations = Object.keys(LIGHT).filter((k) => k.startsWith('--dur-'));
  assert.ok(durations.length >= 3, 'the token file has motion times');
  for (const d of durations) assert.equal(MOTION[d], '0ms', `${d} is 0 with reduced motion`);
  const raw = [];
  for (const { path, css } of SOURCES) {
    for (const m of css.matchAll(/(transition|animation)(?:-duration)?\s*:\s*([^;{}]+)/g)) {
      if (/\b\d*\.?\d+m?s\b/.test(m[2].replace(/var\([^)]*\)/g, ''))) raw.push(`${path}: ${m[1]}: ${m[2]}`);
    }
  }
  assert.deepEqual(raw, [], raw.join('\n'));
});

test('a visible focus ring for every screen comes from the token file', () => {
  assert.match(TOK, /:focus-visible\s*\{[^}]*outline:\s*var\(--focus-ring\)[^}]*outline-offset:\s*var\(--focus-offset\)/);
  // A screen may draw its own ring, but never removes one without a replacement.
  for (const { path, css } of SOURCES) {
    for (const m of css.matchAll(/([^{}]*:focus(?:-visible)?[^{}]*)\{([^{}]*)\}/g)) {
      if (/outline:\s*(none|0)\b/.test(m[2])) {
        assert.match(m[2], /border-color|box-shadow/, `${path}: ${m[1].trim()} removes the ring and shows another mark`);
      }
    }
  }
});

test('the reader, library, popup and paste page do not lose a token name that the JS sets', () => {
  // No .js file sets a CSS custom property, so a renamed token cannot break a script.
  const JS = ['extension/pdf/app.js', 'extension/pdf/notes.js', 'extension/pdf/ask.js', 'extension/pdf/viewer.js', 'app/library.js', 'extension/popup.js', 'extension/paste.js'];
  for (const p of JS) assert.doesNotMatch(read(p), /setProperty\(\s*['"]--|var\(--/, `${relative('.', p)} uses no CSS token`);
});
