// Helpers for the reader look tests (tickets 08, 21, 22). Not a test file: the test files import it.
// Node has no browser, so the tests read the reader's HTML and CSS as text, resolve the design tokens of
// extension/pdf/tokens.css in light and dark mode, and run app.js on a small fake page.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import vm from 'node:vm';
import * as language from '../../extension/pdf/language.js';  // ticket 32: app.js imports it

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const read = (p) => readFileSync(join(ROOT, p), 'utf8');
export const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
export const HTML = read('extension/pdf/index.html');
// The reader loads styles.css, then ra2-theme.css: that is the cascade order.
export const CSS_FILES = ['extension/pdf/styles.css', 'extension/pdf/ra2-theme.css'];

// ---------- a small CSS reader: rules with their media query, in source order ----------
function blockEnd(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return i;
  }
  return css.length;
}
// A selector list split at its top-level commas (not the commas inside :is(...)).
function splitTop(list) {
  const out = []; let depth = 0, from = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') depth++;
    else if (list[i] === ')') depth--;
    else if (list[i] === ',' && depth === 0) { out.push(list.slice(from, i)); from = i + 1; }
  }
  out.push(list.slice(from));
  return out;
}
function parseRules(css, media = '', file = '', out = []) {
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const head = css.slice(i, open).replace(/@import[^;]*;/g, '').trim();
    const close = blockEnd(css, open);
    const body = css.slice(open + 1, close);
    if (head.startsWith('@media')) parseRules(body, head.slice(6).trim(), file, out);
    else if (!head.startsWith('@')) {
      const decls = {};
      for (const m of body.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) decls[m[1]] = m[2].trim();
      out.push({ file, media, selectors: splitTop(head).map((s) => s.trim().replace(/\s+/g, ' ')), decls });
    }
    i = close + 1;
  }
  return out;
}
export const RULES = CSS_FILES.flatMap((f) => parseRules(strip(read(f)), '', f));

// Specificity [ids, classes + attributes + pseudo-classes, elements] of one selector (enough for these files).
export function specificity(sel) {
  let s = sel.replace(/::[\w-]+/g, ' x');            // a pseudo-element counts as an element
  let a = 0, b = 0, c = 0;
  s = s.replace(/:(?:is|not|has)\(([^()]*)\)/g, (_, inner) => {  // :is/:not/:has count as their most specific argument
    const best = inner.split(',').map((x) => specificity(x.trim())).sort(cmp).at(-1);
    a += best[0]; b += best[1]; c += best[2];
    return ' ';
  });
  s = s.replace(/:where\([^()]*\)/g, ' ');
  a += (s.match(/#[\w-]+/g) || []).length;
  b += (s.match(/\.[\w-]+|\[[^\]]*\]|:[\w-]+/g) || []).length;
  c += (s.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|:[\w-]+(\([^)]*\))?/g, ' ').match(/(^|[\s>+~])[a-z][\w-]*/gi) || []).length;
  return [a, b, c];
}
export const cmp = (x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2];

// All declarations for one exact selector (as written in a rule's selector list), in cascade order.
// media: '' = rules outside a media query only; a function = also the rules whose media text passes it.
export function declsFor(selector, media = (m) => m === '') {
  const out = {};
  for (const r of RULES) if (media(r.media) && r.selectors.includes(selector)) Object.assign(out, r.decls);
  return out;
}
export const rulesWith = (pred) => RULES.filter(pred);

// ---------- the tokens, light and dark ----------
const TOK = strip(read('extension/pdf/tokens.css'));
const declarations = (block) => Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const darkBlock = (() => { const at = TOK.indexOf('prefers-color-scheme: dark'); const open = TOK.indexOf('{', at); return TOK.slice(open + 1, blockEnd(TOK, open)); })();
export const LIGHT = declarations(/^:root\s*\{([\s\S]*?)\n\}/m.exec(TOK)[1]);
export const DARK = { ...LIGHT, ...declarations(darkBlock) };
export function resolve(mode, value) {
  return String(value).replace(/var\((--[\w-]+)\)/g, (_, n) => { assert.ok(n in mode, `token ${n} is defined`); return resolve(mode, mode[n]); });
}
export const px = (mode, value) => parseFloat(resolve(mode, value));

// ---------- contrast (WCAG 2) ----------
export function parseColour(t) {
  t = t.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(t);
  if (m) return { r: parseInt(t.slice(1, 3), 16), g: parseInt(t.slice(3, 5), 16), b: parseInt(t.slice(5, 7), 16), a: 1 };
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(t);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  throw new Error('not a colour: ' + t);
}
const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
const lum = ({ r, g, b }) => [r, g, b].map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
// The contrast of a text value on a stack of background values (top first, the last one opaque).
export function contrast(mode, fg, ...bgs) {
  let bg = parseColour(resolve(mode, bgs.at(-1)));
  for (const v of bgs.slice(0, -1).reverse()) bg = over(parseColour(resolve(mode, v)), bg);
  let top = parseColour(resolve(mode, fg));
  if (top.a < 1) top = over(top, bg);
  const [x, y] = [lum(top), lum(bg)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

// ---------- the page: elements of index.html ----------
// Each element with an id: its tag and the text of its start tag.
export function tagOf(id) {
  const m = new RegExp(`<(\\w+)\\b[^>]*\\sid="${id}"[^>]*>`).exec(HTML);
  return m ? { tag: m[1], text: m[0], at: m.index } : null;
}
// The HTML between the start tag of the element with this id and its matching end tag.
export function innerOf(id) {
  const t = tagOf(id);
  assert.ok(t, `#${id} is in index.html`);
  const re = new RegExp(`<(/?)${t.tag}\\b[^>]*>`, 'g');
  re.lastIndex = t.at;
  let depth = 0, m;
  while ((m = re.exec(HTML))) {
    if (!m[1]) depth++; else if (--depth === 0) return HTML.slice(t.at + t.text.length, m.index);
  }
  throw new Error('no end tag for #' + id);
}
export const idsIn = (html) => [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
// The ids that a reader script looks up with $('...') or getElementById('...').
export function idsUsedBy(file) {
  const src = read(file);
  return [...new Set([...src.matchAll(/(?:\$|getElementById)\(\s*'([\w-]+)'\s*\)/g)].map((m) => m[1]))];
}

// ---------- app.js on a fake page ----------
function element(id, log) {
  const listeners = {};
  const attrs = {};
  const classes = new Set();
  const el = {
    id, value: '', textContent: '', hidden: false, disabled: false, checked: false, title: '', max: '',
    style: {}, dataset: {}, children: [], files: [],
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), toggle: (c, on = !classes.has(c)) => (on ? classes.add(c) : classes.delete(c), on), contains: (c) => classes.has(c) },
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return attrs[k] ?? null; },
    set innerHTML(_) { this.children = []; },
    get innerHTML() { return ''; },
    appendChild(c) { this.children.push(c); return c; },
    matches() { return false; },
    closest() { return null; },
    contains(x) { return x === el; },
    focus() { log.focus = el; },
    click() {},
    addEventListener(t, f) { (listeners[t] ||= []).push(f); },
    fire(t, e = {}) { return (listeners[t] || []).map((f) => f({ target: el, preventDefault() {}, ...e })); },
  };
  return el;
}

function fakeEngineClass(id, made) {
  return class {
    constructor() { made[id] = this; this.id = id; this.available = true; this.ready = true; this.current = null; }
    async init() { this.ready = true; }
    listVoices() { return [{ id: 'v1', label: 'Voice one' }, { id: 'v2', label: 'Voice two' }]; }
    speak(sentence, opts) { this.stop(); this.current = { sentence, ...opts }; return Promise.resolve(); }
    stop() { this.current = null; }
    prefetch() {}
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
export async function until(cond, what) {
  for (let i = 0; i < 500; i++) { if (cond()) return; await tick(); }
  throw new Error('waited too long for: ' + what);
}

// Runs app.js with fake modules. engine: 'system' or 'kokoro'. Gives the elements by id, the document listeners
// and a way to press a key on the page.
export function loadApp({ engine = 'system', store = new Map(), withResizeObserver = false, withMutationObserver = false, innerWidth = 1400 } = {}) {
  const winListeners = {};
  const log = { focus: null };
  const ids = {};
  const byId = (id) => (ids[id] ||= element(id, log));
  byId('empty').hidden = false;
  byId('player').hidden = true;
  byId('parseBar').hidden = true;
  byId('settingsPanel').hidden = true;
  byId('rateSel').value = '1';
  store.set('pr.engine.chosen', engine);
  const made = {};
  const parses = [];
  const docListeners = {};
  const observers = [];
  const modules = {
    pdfjsLib: { GlobalWorkerOptions: {}, getDocument: ({ data }) => ({ promise: new TextDecoder().decode(new Uint8Array(data).slice(0, 5)) === '%PDF-'
      ? Promise.resolve({ numPages: 1, destroy: async () => {}, getOutline: async () => null }) : Promise.reject(new Error('Invalid PDF structure.')) }) },
    PdfViewer: class { constructor() { this.pages = new Map(); this.zoom = 1; this.follow = true; this.relayouts = 0; this.rescales = 0; } async load() {} rescale() { this.rescales++; } highlight() {} highlightWord() {} clearWord() {} setZoom(z) { this.zoom = z; } relayout() { this.relayouts++; } },
    buildDocument: (doc, opts, progress) => new Promise((resolve) => parses.push({ progress, finish: resolve })),
    SystemEngine: fakeEngineClass('system', made),
    ServerEngine: fakeEngineClass('kokoro', made),
    loadLexicon: async () => {},
    repairStats: () => ({ repaired: 0 }),
    withOcr: async (doc) => doc,
    setupNotes: () => ({ reload() {}, markdown() { return ''; }, reset() {}, markAt: () => null }),
    setupAsk: () => ({ reload() {}, highlightsChanged() {}, stopReading() {} }),
    ...language,  // ticket 32
  };
  let src = read('extension/pdf/app.js');
  src = src.replace(/^import \* as (\w+) from [^;]+;$/gm, 'const $1 = __modules.$1;')
    .replace(/^import \{([^}]+)\} from [^;]+;$/gm, 'const {$1} = __modules;')
    .replaceAll('import.meta.url', '"file:///reader/pdf/app.js"');
  const timers = [];
  const ctx = {
    __modules: modules,
    console: { log() {}, info() {}, warn() {}, error() {} },
    document: { getElementById: byId, createElement: () => element('', log), addEventListener: (t, f) => (docListeners[t] ||= []).push(f) },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    location: { search: '', href: 'file:///reader/pdf/index.html' },
    navigator: {},
    setTimeout: (fn, ms = 0) => { if (!ms) return setTimeout(fn, 0); const t = { fn, ms, live: true }; timers.push(t); return t; },
    clearTimeout: (t) => { if (t && typeof t === 'object' && 'live' in t) t.live = false; else clearTimeout(t); },
    setInterval: () => 0,
    URL, URLSearchParams, File, TextDecoder, TextEncoder, crypto: globalThis.crypto,
    Worker: class { constructor() { throw new Error('no worker in a test'); } },
    fetch: async () => { throw new Error('no network in a test'); },
    getSelection: () => '',
    confirm: () => false,
    addEventListener: (t, f) => (winListeners[t] ||= []).push(f),
    innerWidth,
    requestAnimationFrame: (f) => frames.push(f),
  };
  const mutations = [];
  if (withMutationObserver) ctx.MutationObserver = class { constructor(cb) { this.cb = cb; mutations.push(this); } observe(el) { this.el = el; } };
  if (withResizeObserver) ctx.ResizeObserver = class { constructor(cb) { this.cb = cb; observers.push(this); } observe(el) { this.el = el; } };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'app.js' });
  const runTimers = () => { for (const t of timers.splice(0)) if (t.live) { t.live = false; t.fn(); } };
  const key = (k, target = { matches: () => false }) => {
    const ev = { key: k, code: k, target, defaultPrevented: false, preventDefault() { ev.defaultPrevented = true; } };
    for (const f of docListeners.keydown || []) f(ev);
    return ev;
  };
  const flushMutations = () => { for (const m of mutations) m.cb([]); };
  const frames = [];
  const runFrames = () => { for (const f of frames.splice(0)) f(); };
  const fireWindow = (t, e = {}) => (winListeners[t] || []).forEach((f) => f({ preventDefault() {}, ...e }));
  return { runFrames, fireWindow, flushMutations, ctx, state: ctx.__pr, viewer: ctx.__viewer, els: ids, byId, made, parses, docListeners, observers, log, key, runTimers, store };
}

// The reader with a book of n sentences read in.
export async function appWithBook(opts, n = 6) {
  const r = loadApp(opts);
  await until(() => r.els.voiceSel.children.length, 'the boot');
  r.byId('fileInput').files = [new File(['%PDF-1.7 test'], 'book.pdf')];
  r.byId('fileInput').fire('change');
  await until(() => r.parses.length, 'the read-in');
  const list = Array.from({ length: n }, (_, i) => ({ text: `Alpha beta gamma ${i}.`, spans: [{ page: 1, item: i }], charOwners: [], page: 1, sectionIndex: 0, pauseAfter: 300 }));
  r.parses[0].finish({ sentences: list, sections: [] });
  await until(() => r.state.sentences === list, 'the end of the read-in');
  return r;
}
