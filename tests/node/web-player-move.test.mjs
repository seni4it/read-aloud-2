// Tests for ticket 25: the owner can move the web-page player (extension/content.js). A drag snaps it to the left,
// right, top or bottom edge; the place is kept in chrome.storage.local for all sites; the keyboard can move it too.
// content.js is loaded as it is in a node:vm context with a fake page and a fake `chrome` (the method of
// web-follow-player.test.mjs). The fake bar gets pointer events as Chrome gives them to it. A real drag in Chrome is a
// manual step (ticket 25, Work report).
// Run: node --test --test-timeout=120000 tests/node/web-player-move.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const CONTENT_JS = fileURLToPath(new URL('../../extension/content.js', import.meta.url));
const INLINE = new Set(['SPAN', 'A', 'B', 'I', 'EM', 'STRONG', 'CODE', 'BR']);
const box = (top, height = 20, left = 100, width = 600) => ({ top, bottom: top + height, left, right: left + width, width, height });

function listeners() {
  const on = {};
  return {
    count: () => Object.values(on).reduce((a, l) => a + l.length, 0),
    has: (type) => !!(on[type] && on[type].length),
    addEventListener(type, f) { (on[type] ||= []).push(f); },
    removeEventListener(type, f) { on[type] = (on[type] || []).filter((g) => g !== f); },
    // a pointer event has the left button down (buttons: 1) unless the test says otherwise
    fire(type, e = {}) { for (const f of [...(on[type] || [])]) f({ type, detail: 1, button: 0, buttons: 1, isPrimary: true, pointerId: 1, stopPropagation() {}, preventDefault() {}, ...e }); },
  };
}
const text = (data) => ({ nodeType: 3, nodeName: '#text', data, parentElement: null, parentNode: null, previousSibling: null });
function el(tag, attrs = {}, kids = []) {
  const ev = listeners(), cls = new Set();
  const e = {
    nodeType: 1, tagName: tag.toUpperCase(), nodeName: tag.toUpperCase(), attrs: { ...attrs }, childNodes: [],
    parentElement: null, parentNode: null, previousSibling: null, dataset: {}, style: {}, hidden: false, rect: null,
    scrollHeight: 0, clientHeight: 0, captured: null, animations: [], focused: 0, textContent: '',
    get id() { return this.attrs.id || ''; },
    get className() { return this.attrs.class || ''; },
    set className(v) { this.attrs.class = v; },
    get innerText() { return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.innerText)).join('\n'); },
    getAttribute(k) { return k in this.attrs ? String(this.attrs[k]) : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    matches(s) { return s.split(',').some((x) => x.trim().toUpperCase() === this.tagName); },
    closest(s) { for (let x = this; x; x = x.parentElement) if (x.matches(s)) return x; return null; },
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; },
    appendChild(c) { c.parentNode = c.parentElement = this; this.childNodes.push(c); return c; },
    append(...cs) { cs.forEach((c) => this.appendChild(c)); },
    replaceChildren(...cs) { this.childNodes = []; this.append(...cs); },
    removeChild(c) { this.childNodes.splice(this.childNodes.indexOf(c), 1); c.parentNode = c.parentElement = null; return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    checkVisibility() { return true; },
    getBoundingClientRect() { return this.rect || box(0, 800, 0, 1200); },
    setPointerCapture(id) { this.captured = id; },
    releasePointerCapture() { this.captured = null; },
    hasPointerCapture(id) { return this.captured === id; },
    animate(frames, opts) { this.animations.push({ frames, opts }); return {}; },
    focus() { this.focused++; },
    attachShadow() {
      const ids = {};
      return this.shadow = { set innerHTML(_) {}, getElementById: (id) => (ids[id] ||= el('div', { id })), querySelector: () => null, querySelectorAll: () => [] };
    },
    addEventListener: ev.addEventListener, fire: ev.fire, has: ev.has,
    classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: (c, on) => (on ?? !cls.has(c) ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) },
  };
  for (const k of kids) e.appendChild(typeof k === 'string' ? text(k) : k);
  return e;
}
function textNodes(top, out = []) {
  for (const c of top.childNodes) if (c.nodeType === 3) out.push(c); else textNodes(c, out);
  return out;
}

// A page on `hostname` with the place `saved` in chrome.storage.local (one store for all sites, as in Chrome).
function loadPage(opts = {}) {
  const store = opts.store || {};
  const body = el('body', {}, [Object.assign(el('p', {}, ['A made sentence of the test page. And a second one here.']), { rect: box(100) })]);
  const html = el('html', {}, [body]);
  const spoken = [], onMessage = [], changed = [], writes = [], reads = [];
  let host = null;
  const win = listeners(), doc = listeners();
  const document = {
    documentElement: html, body, contentType: 'text/html', visibilityState: 'visible',
    querySelector: () => null,
    createElement: (t) => { const e = el(t); if (e.tagName === 'RA2-ROOT') host = e; return e; },
    addEventListener: doc.addEventListener,
    createTreeWalker(top, _what, filter) {
      const list = textNodes(top).filter((n) => filter.acceptNode(n) === 1);
      let i = 0;
      return { nextNode: () => list[i++] || null };
    },
    createRange: () => ({ setStart(n) { this.node = n; }, setEnd() {}, getBoundingClientRect() { return box(100); } }),
  };
  const chrome = {
    runtime: {
      id: 'made-up-add-on-id',
      sendMessage: (m) => { if (m.cmd === 'speak') spoken.push(m); return Promise.resolve(m.cmd === 'voices' ? { server: true, natural: [{ id: 'af_heart', label: 'Heart' }], system: [] } : undefined); },
      onMessage: { addListener: (f) => onMessage.push(f) },
    },
    storage: {
      sync: { get: async () => ({}), set: async () => {} },
      local: {
        get: async (k) => { reads.push(k); return k in store ? { [k]: store[k] } : {}; },
        set: async (o) => { writes.push(JSON.parse(JSON.stringify(o))); Object.assign(store, o); },
      },
      onChanged: { addListener: (f) => changed.push(f) },
    },
  };
  const ctx = vm.createContext({
    document, chrome, console, location: { protocol: 'https:', hostname: opts.hostname || 'example.org' },
    NodeFilter: { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 },
    MutationObserver: class { observe() {} disconnect() {} },
    Highlight: class { clear() {} add() {} },
    CSS: { highlights: new Map() },
    getComputedStyle: (e) => ({ display: INLINE.has(e.tagName) ? 'inline' : 'block', overflowY: 'visible' }),
    getSelection: () => ({ rangeCount: 0, toString: () => '' }),
    matchMedia: (q) => ({ matches: /reduce/.test(q) ? !!opts.reduce : false }),
    setTimeout: () => 0, clearTimeout() {},
    addEventListener: win.addEventListener, removeEventListener: win.removeEventListener,
    scrollTo() {},
    innerWidth: opts.width || 1200, innerHeight: opts.height || 800, scrollY: 0,
    ra2Test: {},
  });
  ctx.window = ctx;
  vm.runInContext(readFileSync(CONTENT_JS, 'utf8'), ctx, { filename: 'content.js' });
  const tell = (m) => onMessage.forEach((f) => f({ to: 'page', ...m }));
  const $ = (id) => host.shadow.getElementById(id);
  const bar = $('bar');
  bar.rect = { left: 400, top: 740, right: 800, bottom: 796, width: 400, height: 56 };
  // the pointer goes down at `from`, moves through each point of `path`, and goes up at the last one
  const drag = (target, from, ...path) => {
    bar.fire('pointerdown', { target, clientX: from[0], clientY: from[1] });
    for (const [x, y] of path) bar.fire('pointermove', { target, clientX: x, clientY: y });
    const [x, y] = path.at(-1) || from;
    bar.fire('pointerup', { target, clientX: x, clientY: y });
  };
  const resize = (w, h) => { ctx.innerWidth = w; ctx.innerHeight = h; win.fire('resize'); };
  // the add-on is reloaded: this old tab has no runtime id, and each call to chrome.storage throws
  const invalidate = () => {
    delete chrome.runtime.id;
    const dead = () => { throw new Error('Extension context invalidated.'); };
    chrome.storage.local.get = chrome.storage.local.set = chrome.storage.sync.set = dead;
  };
  return { ctx, $, bar, drag, resize, tell, spoken, store, writes, reads, win, changed, invalidate, place: ctx.ra2Test.place };
}
const flush = () => new Promise((r) => setImmediate(r));
async function listening(opts) {  // a page where the owner pressed play: the bar shows
  const pg = loadPage(opts);
  await flush();
  pg.tell({ cmd: 'readPage' });
  return pg;
}

// ---------- the snap decision ----------
test('snap: the place is the edge of the window nearest to the point where the pointer lets go', () => {
  const { snapPlace } = loadPage().place;
  assert.equal(snapPlace(20, 400, 1200, 800), 'left');
  assert.equal(snapPlace(1180, 400, 1200, 800), 'right');
  assert.equal(snapPlace(600, 30, 1200, 800), 'top');
  assert.equal(snapPlace(600, 770, 1200, 800), 'bottom');
  assert.equal(snapPlace(600, 400, 1200, 800), 'bottom', 'the middle of a wide window: bottom (a tie goes to bottom)');
  assert.equal(snapPlace(300, 400, 1200, 800), 'left', 'nearer the left edge than the top or the bottom');
  assert.equal(snapPlace(-40, 300, 1200, 800), 'left', 'a pointer outside the window');
  assert.equal(snapPlace(1300, 850, 1200, 800), 'right', 'outside at the bottom right: the edge it is farther past');
});

test('fit: a side place needs a window high enough for the vertical bar; else the bar shows at the bottom', () => {
  const { fitPlace } = loadPage().place;
  assert.equal(fitPlace('left', 1200, 800), 'left');
  assert.equal(fitPlace('right', 400, 800), 'right');
  assert.equal(fitPlace('left', 1200, 300), 'bottom');
  assert.equal(fitPlace('top', 400, 300), 'top');
  assert.equal(fitPlace('nowhere', 1200, 800), 'bottom', 'an unknown saved value');
  assert.equal(fitPlace(undefined, 1200, 800), 'bottom');
});

// ---------- the drag ----------
test('a drag moves the bar with the pointer and snaps it to the nearest edge; the place is saved for all sites', async () => {
  const pg = await listening();
  assert.equal(pg.bar.dataset.place, 'bottom', 'the first place is the bottom');
  pg.bar.fire('pointerdown', { target: pg.bar, clientX: 410, clientY: 760 });
  pg.bar.fire('pointermove', { target: pg.bar, clientX: 200, clientY: 500 });
  assert.equal(pg.bar.captured, 1, 'the bar captures the pointer when the drag starts');
  assert.ok(pg.bar.classList.contains('dragging'));
  assert.equal(pg.bar.style.left, '190px', 'the bar follows the pointer');
  assert.equal(pg.bar.style.top, '480px');
  pg.bar.fire('pointermove', { target: pg.bar, clientX: -100, clientY: 2000 });
  assert.equal(pg.bar.style.left, '0px', 'never off the window');
  assert.equal(pg.bar.style.top, String(800 - 56) + 'px');
  pg.bar.fire('pointermove', { target: pg.bar, clientX: 30, clientY: 400 });
  pg.bar.fire('pointerup', { target: pg.bar, clientX: 30, clientY: 400 });
  assert.equal(pg.bar.dataset.place, 'left');
  assert.ok(!pg.bar.classList.contains('dragging'));
  assert.equal(pg.bar.style.left, '', 'the edge place comes from the style again');
  assert.deepEqual(pg.writes, [{ ra2Place: 'left' }], 'saved in chrome.storage.local');
});

test('each of the four places can be reached by a drag', async () => {
  const pg = await listening();
  for (const [x, y, p] of [[1190, 400, 'right'], [600, 10, 'top'], [10, 400, 'left'], [600, 795, 'bottom']]) {
    pg.drag(pg.bar, [500, 760], [x, y]);
    assert.equal(pg.bar.dataset.place, p);
  }
});

test('a click on play still plays: a move of less than 6 px is not a drag', async () => {
  const pg = await listening();
  pg.tell({ cmd: 'play-pause' });  // pause
  const n = pg.spoken.length;
  pg.drag(pg.$('pp'), [500, 760], [503, 763]);
  assert.equal(pg.bar.captured, null, 'no capture');
  assert.deepEqual(pg.writes, [], 'no place saved');
  pg.$('pp').fire('click', { target: pg.$('pp') });
  assert.equal(pg.$('pp').getAttribute('aria-label'), 'Pause', 'play pressed: it reads again');
  assert.ok(pg.spoken.length >= n);
});

test('a drag that starts on a button does not press it', async () => {
  const pg = await listening();
  const n = pg.spoken.length;
  pg.drag(pg.$('fwd'), [500, 760], [520, 700], [600, 20]);
  pg.$('fwd').fire('click', { target: pg.$('fwd') });  // the click that may follow the pointerup
  assert.equal(pg.spoken.length, n, 'next sentence was not pressed');
  assert.equal(pg.bar.dataset.place, 'top');
  pg.drag(pg.$('close'), [500, 30], [520, 90], [600, 790]);
  pg.$('close').fire('click', { target: pg.$('close') });
  assert.equal(pg.bar.hidden, false, 'close was not pressed: the bar is still there');
  pg.bar.fire('pointerdown', { target: pg.$('fwd'), clientX: 500, clientY: 760 });
  pg.bar.fire('pointerup', { target: pg.$('fwd'), clientX: 500, clientY: 760 });
  pg.$('fwd').fire('click', { target: pg.$('fwd') });
  assert.equal(pg.spoken.length, n + 1, 'the next click on the button works');
});

test('a cancelled drag goes back to the old place and saves nothing', async () => {
  const pg = await listening();
  pg.bar.fire('pointerdown', { target: pg.bar, clientX: 500, clientY: 760 });
  pg.bar.fire('pointermove', { target: pg.bar, clientX: 20, clientY: 400 });
  pg.bar.fire('pointercancel', { target: pg.bar, clientX: 20, clientY: 400 });
  assert.equal(pg.bar.dataset.place, 'bottom');
  assert.deepEqual(pg.writes, []);
});

test('a right button press or a drag in the settings panel does not move the bar', async () => {
  const pg = await listening();
  pg.bar.fire('pointerdown', { target: pg.bar, button: 2, clientX: 500, clientY: 760 });
  pg.bar.fire('pointermove', { target: pg.bar, clientX: 20, clientY: 400 });
  assert.equal(pg.bar.captured, null);
  pg.$('menu').appendChild(pg.$('voices'));
  pg.bar.appendChild(pg.$('menu'));
  pg.drag(pg.$('voices'), [500, 500], [20, 400]);
  assert.equal(pg.bar.dataset.place, 'bottom');
});

// ---------- the saved place ----------
test('after a reload and on another site, the bar is at the saved place', async () => {
  const store = {};
  const a = await listening({ store });
  a.drag(a.bar, [500, 760], [1190, 400]);
  assert.equal(store.ra2Place, 'right');
  const b = await listening({ store });
  assert.equal(b.bar.dataset.place, 'right', 'reload');
  const c = await listening({ store, hostname: 'another-site.example' });
  assert.equal(c.bar.dataset.place, 'right', 'another site');
});

test('a place saved in another tab moves the bar here too; a bad saved value gives the bottom', async () => {
  const pg = await listening();
  pg.changed.forEach((f) => f({ ra2Place: { newValue: 'top' } }, 'local'));
  assert.equal(pg.bar.dataset.place, 'top');
  const bad = await listening({ store: { ra2Place: 'middle' } });
  assert.equal(bad.bar.dataset.place, 'bottom');
});

test('the load reads and saves nothing; the place is read and the resize listener added when the bar shows', async () => {
  const pg = loadPage({ store: { ra2Place: 'left' } });
  await flush();
  assert.deepEqual(pg.reads, [], 'no storage read at page load');
  assert.deepEqual(pg.writes, []);
  assert.equal(pg.win.has('resize'), false, 'no resize listener on a page where the owner does not listen');
  pg.tell({ cmd: 'readPage' });
  await flush();
  assert.deepEqual(pg.reads, ['ra2Place'], 'one read when the bar shows');
  assert.equal(pg.bar.dataset.place, 'left');
  assert.equal(pg.win.has('resize'), true);
  pg.tell({ cmd: 'forward' }); await flush();
  assert.equal(pg.reads.length, 1, 'no new read while the bar stays');
});

test('after close the resize listener is gone and a resize does no work; it comes back on the next show', async () => {
  const pg = await listening({ store: { ra2Place: 'left' } });
  await flush();
  pg.$('close').fire('click', { target: pg.$('close') });
  assert.equal(pg.bar.hidden, true);
  assert.equal(pg.win.has('resize'), false, 'no resize listener after close');
  pg.resize(1200, 300);
  assert.equal(pg.bar.dataset.place, 'left', 'the resize did nothing');
  pg.tell({ cmd: 'readPage' }); await flush();
  assert.equal(pg.win.has('resize'), true);
  assert.equal(pg.bar.dataset.place, 'bottom', 'on show the bar fits the low window');
});

test('a place saved in another tab while the bar is hidden is used at the next show', async () => {
  const pg = loadPage();
  await flush();
  pg.store.ra2Place = 'right';
  pg.changed.forEach((f) => f({ ra2Place: { newValue: 'right' } }, 'local'));
  pg.tell({ cmd: 'readPage' }); await flush();
  assert.equal(pg.bar.dataset.place, 'right');
});

// ---------- review repairs ----------
test('a press let go outside the bar, then a hover with no button down: no drag', async () => {
  const pg = await listening();
  pg.bar.fire('pointerdown', { target: pg.$('pp'), clientX: 500, clientY: 760 });
  // the pointer leaves the bar and the button goes up outside it: the bar gets no pointerup
  pg.bar.fire('pointermove', { target: pg.bar, clientX: 520, clientY: 700, buttons: 0 });
  pg.bar.fire('pointermove', { target: pg.bar, clientX: 300, clientY: 400, buttons: 0 });
  assert.equal(pg.bar.captured, null, 'no capture');
  assert.ok(!pg.bar.classList.contains('dragging'));
  assert.equal(pg.bar.style.left, undefined, 'the bar did not move');
  pg.bar.fire('pointerup', { target: pg.bar, clientX: 300, clientY: 400, buttons: 0 });
  assert.deepEqual(pg.writes, []);
  pg.$('pp').fire('click', { target: pg.$('pp') });
  assert.equal(pg.$('pp').getAttribute('aria-label'), 'Play', 'a later click still presses play');
});

test('a lost pointer capture ends the drag cleanly, at the old place, and saves nothing', async () => {
  const pg = await listening();
  pg.bar.fire('pointerdown', { target: pg.bar, clientX: 500, clientY: 760 });
  pg.bar.fire('pointermove', { target: pg.bar, clientX: 20, clientY: 400 });
  pg.bar.fire('lostpointercapture', { target: pg.bar });
  assert.ok(!pg.bar.classList.contains('dragging'));
  assert.equal(pg.bar.style.left, '');
  assert.equal(pg.bar.style.top, '');
  assert.equal(pg.bar.dataset.place, 'bottom');
  assert.deepEqual(pg.writes, []);
  pg.changed.forEach((f) => f({ ra2Place: { newValue: 'top' } }, 'local'));
  assert.equal(pg.bar.dataset.place, 'top', 'a change from another tab works again');
  pg.resize(1200, 300); pg.resize(1200, 800);
  assert.equal(pg.bar.dataset.place, 'top');
});

test('the bar hides during a drag (the reading stops): the drag ends cleanly', async () => {
  const pg = await listening();
  pg.bar.fire('pointerdown', { target: pg.bar, clientX: 500, clientY: 760 });
  pg.bar.fire('pointermove', { target: pg.bar, clientX: 20, clientY: 400 });
  pg.tell({ evt: 'stopped' });
  assert.equal(pg.bar.hidden, true);
  assert.ok(!pg.bar.classList.contains('dragging'));
  assert.equal(pg.bar.style.left, '');
  pg.bar.fire('pointerup', { target: pg.bar, clientX: 20, clientY: 400 });
  assert.deepEqual(pg.writes, [], 'the late pointerup saves nothing');
  pg.tell({ cmd: 'readPage' }); await flush();
  assert.equal(pg.bar.dataset.place, 'bottom');
});

test('one write to storage for each drop, none during the move', async () => {
  const pg = await listening();
  pg.bar.fire('pointerdown', { target: pg.bar, clientX: 500, clientY: 760 });
  for (let i = 0; i < 30; i++) pg.bar.fire('pointermove', { target: pg.bar, clientX: 500 - i * 15, clientY: 760 - i * 10 });
  assert.deepEqual(pg.writes, [], 'nothing saved while the bar moves');
  pg.bar.fire('pointerup', { target: pg.bar, clientX: 50, clientY: 460 });
  assert.equal(pg.writes.length, 1);
});

test('a drag that starts on a slider or a field in the bar does not move the bar', async () => {
  const pg = await listening();
  const slider = el('input', { type: 'range' });
  pg.bar.appendChild(slider);
  pg.drag(slider, [500, 760], [400, 760], [20, 400]);
  assert.equal(pg.bar.captured, null);
  assert.equal(pg.bar.dataset.place, 'bottom');
  assert.deepEqual(pg.writes, []);
});

test('in a 400 px window the dragged bar stays fully on the screen', async () => {
  const pg = await listening({ width: 400, height: 800 });
  pg.bar.rect = { left: 20, top: 740, right: 380, bottom: 796, width: 360, height: 56 };
  pg.bar.fire('pointerdown', { target: pg.bar, clientX: 30, clientY: 760 });
  pg.bar.fire('pointermove', { target: pg.bar, clientX: 395, clientY: 790 });
  assert.equal(pg.bar.style.left, '40px', 'right edge at 400 px');
  assert.equal(pg.bar.style.top, '744px', 'bottom edge at 800 px');
  pg.bar.fire('pointermove', { target: pg.bar, clientX: 2, clientY: 3 });
  assert.equal(pg.bar.style.left, '0px');
  assert.equal(pg.bar.style.top, '0px');
});

test('an old tab after a reload of the add-on: show, drag and Move player throw no error into the page', async () => {
  const pg = loadPage();
  await flush();
  pg.invalidate();
  assert.doesNotThrow(() => pg.tell({ cmd: 'readPage' }));
  await flush();
  assert.doesNotThrow(() => pg.drag(pg.bar, [500, 760], [20, 400]));
  assert.doesNotThrow(() => pg.$('place-top').fire('click', { target: pg.$('place-top'), detail: 0 }));
  assert.doesNotThrow(() => pg.resize(800, 600));
  await flush();
});

test('text check: with reduced motion the waiting ring on play does not turn', () => {
  const src = readFileSync(CONTENT_JS, 'utf8');
  assert.match(src, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.bar \.pp\.waiting::before\s*\{[^}]*animation:\s*none/);
});

// ---------- on screen at each window size ----------
test('after a resize the bar is on the screen: a side place in a low window shows at the bottom, and goes back', async () => {
  const pg = await listening({ store: { ra2Place: 'left' } });
  await flush();
  assert.equal(pg.bar.dataset.place, 'left');
  pg.resize(1200, 300);
  assert.equal(pg.bar.dataset.place, 'bottom', 'no room for the vertical bar');
  assert.equal(pg.store.ra2Place, 'left', 'the saved place does not change');
  pg.resize(400, 800);
  assert.equal(pg.bar.dataset.place, 'left');
});

test('text check: the style limits the bar to the window size at each place', () => {
  const src = readFileSync(CONTENT_JS, 'utf8');
  assert.match(src, /\.bar\s*\{[^}]*max-width:\s*calc\(100vw - [^)]+\)/, 'horizontal: never wider than the window');
  assert.match(src, /\.bar\[data-place=left\], \.bar\[data-place=right\]\s*\{[^}]*flex-direction:\s*column/, 'vertical at the sides');
  assert.match(src, /\.bar\[data-place=left\], \.bar\[data-place=right\]\s*\{[^}]*max-height:\s*calc\(100vh - [^)]+\)/);
  assert.match(src, /\.bar\[data-place=top\]\s*\{[^}]*top:/);
});

// ---------- the keyboard ----------
test('the keyboard can move the bar: Settings, then Move player, with the four places', async () => {
  const pg = await listening();
  pg.$('set').fire('click', { target: pg.$('set'), detail: 0 });  // Enter or Space on the settings button
  assert.equal(pg.$('menu').hidden, false, 'the settings panel opens from the keyboard');
  assert.equal(pg.$('set').getAttribute('aria-expanded'), 'true');
  for (const p of ['right', 'top', 'left', 'bottom']) {
    pg.$('place-' + p).fire('click', { target: pg.$('place-' + p), detail: 0 });
    assert.equal(pg.bar.dataset.place, p);
    assert.equal(pg.store.ra2Place, p);
    assert.equal(pg.$('place-' + p).getAttribute('aria-pressed'), 'true');
  }
  assert.equal(pg.$('place-left').getAttribute('aria-pressed'), 'false');
  pg.win.fire('keydown', { key: 'Escape', target: pg.bar });
  assert.equal(pg.$('menu').hidden, true, 'Escape closes the panel');
});

// ---------- motion ----------
test('the snap glides in 200 ms, and not at all when the system asks for reduced motion', async () => {
  const pg = await listening();
  pg.drag(pg.bar, [500, 760], [20, 400]);
  assert.equal(pg.bar.animations.length, 1);
  assert.equal(pg.bar.animations[0].opts.duration, 200);
  const still = await listening({ reduce: true });
  still.drag(still.bar, [500, 760], [20, 400]);
  assert.equal(still.bar.dataset.place, 'left');
  assert.equal(still.bar.animations.length, 0);
});
