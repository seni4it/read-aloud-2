// Tests for ticket 02 of the spec "Italian voices that the owner can find" (GitHub issue 33): a page that was open
// before a reload of the add-on keeps an old Player bar that cannot work. When the web player finds that its add-on
// connection is gone, it removes the Player bar and the Listen button and shows a small message in their place:
// "Read Aloud 2 was updated. Reload this page to listen.", with a button "Reload this page" and a close button.
// content.js is loaded as it is, in a node:vm context with a small fake page and a fake `chrome` (the method of
// web-follow-player.test.mjs). These tests cannot prove the look on a real site.
// Run: node --test tests/node/old-tab-message.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const CONTENT_JS = fileURLToPath(new URL('../../extension/content.js', import.meta.url));
const TEXT = 'Read Aloud 2 was updated. Reload this page to listen.';

// ---------- a small fake page ----------
function el(tag) {
  const on = {};
  return {
    nodeType: 1, tagName: tag.toUpperCase(), attrs: {}, childNodes: [], parentNode: null, parentElement: null, style: {}, dataset: {}, hidden: false,
    on,
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; },
    appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = c.parentElement = this; this.childNodes.push(c); return c; },
    removeChild(c) { this.childNodes.splice(this.childNodes.indexOf(c), 1); c.parentNode = c.parentElement = null; return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    closest() { return null; },
    getBoundingClientRect() { return { top: 0, bottom: 20, left: 0, right: 100, width: 100, height: 20 }; },
    addEventListener(type, f) { (on[type] ||= []).push(f); },
    fire(type, e = {}) { for (const f of on[type] || []) f({ type, detail: 1, stopPropagation() {}, preventDefault() {}, ...e }); },
    attachShadow() {
      const ids = {}; let html = '';
      return this.shadow = {
        set innerHTML(v) { html = v; }, get innerHTML() { return html; },
        getElementById: (id) => (ids[id] ||= el('div')),
        querySelector: () => null, querySelectorAll: () => [],
      };
    },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  };
}

function loadPage() {
  const body = el('body'), html = el('html');
  html.appendChild(body);
  const sent = [], onMessage = [], timers = new Map(), win = {}, made = [];
  let timerNo = 0, reloads = 0;
  const document = {
    documentElement: html, body, contentType: 'text/html', visibilityState: 'visible',
    querySelector: () => null,
    createElement: (t) => { const e = el(t); made.push(e); return e; },
    addEventListener() {},
    createTreeWalker: () => ({ nextNode: () => null }),
    createRange: () => ({ setStart() {}, setEnd() {}, getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }),
  };
  const chrome = {
    runtime: {
      id: 'test',
      sendMessage: (m) => { sent.push(m); return Promise.resolve(undefined); },
      onMessage: { addListener: (f) => onMessage.push(f) },
    },
    storage: { sync: { get: () => new Promise(() => {}), set: async () => {} }, local: { get: () => new Promise(() => {}), set: async () => {} }, onChanged: { addListener() {} } },
  };
  const ctx = vm.createContext({
    document, chrome, console,
    location: { protocol: 'https:', hostname: 'example.org', reload: () => { reloads++; } },
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
    MutationObserver: class { observe() {} disconnect() {} },
    CSSStyleSheet: class { replaceSync() {} },
    Highlight: class { clear() {} add() {} },
    CSS: { highlights: new Map() },
    getComputedStyle: () => ({ display: 'block', overflowY: 'visible' }),
    getSelection: () => ({ rangeCount: 0, toString: () => '' }),
    matchMedia: () => ({ matches: false }),
    setTimeout: (f) => { timers.set(++timerNo, f); return timerNo; }, clearTimeout: (n) => timers.delete(n),
    addEventListener: (type, f) => { (win[type] ||= []).push(f); }, removeEventListener() {},
    scrollTo() {},
    innerWidth: 1200, innerHeight: 800, scrollY: 0,
  });
  ctx.window = ctx;
  vm.runInContext(readFileSync(CONTENT_JS, 'utf8'), ctx, { filename: 'content.js' });
  const player = made.find((e) => e.tagName === 'RA2-ROOT');
  // the add-on is reloaded: this old tab has no runtime id, and each call to the add-on throws
  const reloadAddon = () => {
    delete chrome.runtime.id;
    const dead = () => { throw new Error('Extension context invalidated.'); };
    chrome.runtime.sendMessage = (m) => { sent.push(m); return dead(); };
    chrome.storage.sync.set = chrome.storage.local.get = chrome.storage.local.set = dead;
  };
  const scroll = () => (win.scroll || []).forEach((f) => f({ type: 'scroll' }));
  // the message: an element on the page (not the old player) with the message text in its shadow root
  const notes = () => html.childNodes.filter((e) => e !== body && e !== player && e.shadow && e.shadow.innerHTML.includes(TEXT));
  return { ctx, html, player, sent, timers, reloadAddon, scroll, notes, reloads: () => reloads, tell: (m) => onMessage.forEach((f) => f({ to: 'page', ...m })) };
}

test('while the add-on is there, no message shows', () => {
  const pg = loadPage();
  pg.scroll();
  assert.equal(pg.notes().length, 0);
  assert.equal(pg.player.parentNode, pg.html);
});

test('connection gone: the Player bar and the Listen button leave, and the message shows in their place', () => {
  const pg = loadPage();
  pg.reloadAddon();
  pg.scroll();
  assert.equal(pg.player.parentNode, null, 'the old Player bar and the Listen button are gone');
  const [note] = pg.notes();
  assert.ok(note, 'the message is on the page');
  const h = note.shadow.innerHTML;
  assert.match(h, /role="status"/, 'the message has the status role');
  assert.match(h, />Reload this page</, 'the reload button');
  assert.match(h, /aria-label="Close"/, 'the close button');
});

test('the message has the look of the Player bar: the same style and the bar class', () => {
  const pg = loadPage();
  pg.reloadAddon();
  pg.scroll();
  const h = pg.notes()[0].shadow.innerHTML;
  const style = /^<style>[\s\S]*?<\/style>/.exec(pg.player.shadow.innerHTML)[0];
  assert.ok(h.startsWith(style), 'the style of the Player bar, with its tokens');
  assert.match(h, /class="bar [^"]*"/);
  const own = h.slice(style.length);
  assert.doesNotMatch(own, /#[0-9a-f]{3,8}\b|rgba?\(|<style/i, 'no new colour and no new style block');
});

test('the reload button reloads the page and makes no add-on call', () => {
  const pg = loadPage();
  pg.reloadAddon();
  pg.scroll();
  const n = pg.sent.length;
  pg.notes()[0].shadow.getElementById('ra2Reload').fire('click');
  assert.equal(pg.reloads(), 1);
  assert.equal(pg.sent.length, n, 'no add-on call');
});

test('the close button removes the message, with no add-on call', () => {
  const pg = loadPage();
  pg.reloadAddon();
  pg.scroll();
  const note = pg.notes()[0], n = pg.sent.length;
  note.shadow.getElementById('ra2NoteClose').fire('click');
  assert.equal(note.parentNode, null, 'the message is gone');
  assert.equal(pg.notes().length, 0);
  assert.equal(pg.reloads(), 0, 'close does not reload');
  assert.equal(pg.sent.length, n, 'no add-on call');
});

test('the message shows one time only for a page, and leaves no timer behind', () => {
  const pg = loadPage();
  pg.reloadAddon();
  pg.scroll(); pg.scroll();
  pg.tell({ cmd: 'readPage' });
  assert.equal(pg.notes().length, 1, 'one message');
  pg.notes()[0].shadow.getElementById('ra2NoteClose').fire('click');
  pg.scroll();
  pg.tell({ cmd: 'readPage' });
  assert.equal(pg.notes().length, 0, 'a closed message does not come back');
  assert.equal(pg.timers.size, 0, 'no timer waits');
});
