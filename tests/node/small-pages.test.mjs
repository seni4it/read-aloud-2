// Tests for the small pages of the Add-on, ticket 18: the popup (extension/popup.html) and the paste page
// (extension/paste.html).
// Node has no browser, so these tests read the HTML and its <style> as text and check the rules that Chrome uses:
// a checkbox inside a <label> gets the words of the label as its name, and a click on the words changes it;
// a CSS-wide keyword (inherit, initial, unset, revert) cannot be part of a shorthand, else Chrome drops the whole line.
// The Work report of ticket 18 has the steps for a check in a real Chrome.
// Run: node --test --test-timeout=120000 tests/node/small-pages.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name) => readFileSync(fileURLToPath(new URL('../../extension/' + name, import.meta.url)), 'utf8');
const POPUP = read('popup.html');
const PASTE = read('paste.html');
const SWITCHES = ['hoverPlay', 'launcher', 'follow', 'clickJump', 'pdf', 'site'];

// The open elements around each tag of the page, from a simple walk over the tags (enough for these small pages).
const VOID = new Set(['input', 'meta', 'link', 'br', 'img', 'hr']);
function parents(html) {
  const body = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  const stack = [], found = [];
  for (const m of body.matchAll(/<(\/?)([a-z][a-z0-9]*)\b([^>]*)>|([^<]+)/gi)) {
    if (m[4] !== undefined) { for (const p of stack) p.text += m[4]; continue; }
    const [, close, tag, attrs] = m, name = tag.toLowerCase();
    if (close) { while (stack.length && stack.pop().name !== name); continue; }
    const id = /\bid="([^"]*)"/.exec(attrs)?.[1] || '';
    const item = { name, id, attrs, around: [...stack], text: '' };
    found.push(item);
    if (!VOID.has(name)) stack.push(item);
  }
  return found;
}

// The declarations of the first CSS rule whose selector list is exactly `selector`.
function rule(html, selector) {
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim() !== selector) continue;
    return m[2].split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
      const i = d.indexOf(':');
      return { prop: d.slice(0, i).trim(), value: d.slice(i + 1).trim() };
    });
  }
  return null;
}
const WIDE = /^(inherit|initial|unset|revert|revert-layer)$/i;
const valid = ({ value }) => !value.split(/[\s,/]+/).some((w) => WIDE.test(w)) || WIDE.test(value);

// The font size that the rule gives, as Chrome reads it: valid declarations only, the last one wins.
function fontSize(decls) {
  let size = null;
  for (const d of decls.filter(valid)) {
    if (d.prop === 'font-size') size = d.value;
    if (d.prop === 'font') size = /(\d+(?:\.\d+)?px)/.exec(d.value)?.[1] ?? null;
  }
  return size;
}

test('popup: each of the 6 switches is inside a label, so a click on its words changes it', () => {
  const tags = parents(POPUP);
  for (const id of SWITCHES) {
    const box = tags.find((t) => t.name === 'input' && t.id === id);
    assert.ok(box, `the switch ${id} is on the popup`);
    assert.match(box.attrs, /type="checkbox"/, `${id} is a checkbox`);
    const label = box.around.findLast((p) => p.name === 'label');
    assert.ok(label, `the switch ${id} is inside a <label>`);
    assert.ok(label.text.trim().length > 3, `the label of ${id} has words for a screen reader`);
  }
});

test('popup: the labels of the switches have no other control in them', () => {
  const tags = parents(POPUP);
  for (const label of tags.filter((t) => t.name === 'label' && t.attrs.includes('class="sw"'))) {
    const controls = tags.filter((t) => ['input', 'select', 'button', 'a'].includes(t.name) && t.around.includes(label));
    assert.equal(controls.length, 1, 'one control in each switch label');
  }
});

test('popup: the "Hide on this site" row keeps its id, and the hidden row is not shown', () => {
  const row = parents(POPUP).find((t) => t.id === 'siteRow');
  assert.ok(row, 'the row siteRow is on the popup (popup.js hides it on pages with no site)');
  // `.sw { display: flex }` wins over the browser rule `[hidden] { display: none }`, so the page needs its own rule.
  const hide = rule(POPUP, '.sw[hidden]') || rule(POPUP, '[hidden]');
  assert.ok(hide?.some((d) => d.prop === 'display' && /^none\b/.test(d.value)), 'a rule hides a switch row with the hidden attribute');
});

test('paste page: every CSS line of the text box is valid', () => {
  const decls = rule(PASTE, 'textarea');
  assert.ok(decls, 'the paste page has a textarea rule');
  for (const d of decls) assert.ok(valid(d), `Chrome drops "${d.prop}: ${d.value}"`);
});

test('paste page: the text box shows 16 px text', () => {
  assert.equal(fontSize(rule(PASTE, 'textarea')), '16px');
});
