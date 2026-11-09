// Ticket 08: the accessibility floor of the reader. A focus mark on every control, contrast of 4.5 to 1 or more,
// controls at least 32 px high, the word highlight and the saved highlights visible in dark mode, and a readable
// page when the Ask pane is open in a window of 821 to 1100 px.
// Node has no browser: these tests read the reader's CSS and HTML as text (tests/node/reader-css.mjs) and run
// app.js on a small fake page. Screenshots in a real browser are a manual step (see the ticket's Work report).
// Run: ./run-tests.sh
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML, RULES, LIGHT, DARK, declsFor, specificity, cmp, contrast, px, resolve, read, loadApp, appWithBook, until } from './reader-css.mjs';

const MODES = [['light', LIGHT], ['dark', DARK]];

// ---------- focus marks ----------
const FOCUS_SELECTOR = 'html body :is(button, a[href], select, input, textarea, summary, [tabindex]):focus-visible';

test('a focus ring rule covers every control of the reader and wins over each rule that resets a control', () => {
  const focus = RULES.filter((r) => r.media === '' && r.selectors.includes(FOCUS_SELECTOR));
  assert.equal(focus.length, 1, 'the reader has one focus rule for all controls');
  assert.equal(focus[0].decls.outline, 'var(--focus-ring)');
  assert.equal(focus[0].decls['outline-offset'], 'var(--focus-offset)');
  assert.equal(focus[0].file, 'extension/pdf/ra2-theme.css', 'it is in the file that is loaded last');
  const mine = specificity(FOCUS_SELECTOR);
  // Each rule that unsets a control (all: unset) or sets its outline must lose against the focus rule.
  const lower = [];
  for (const r of RULES) {
    if (r === focus[0] || !('all' in r.decls || 'outline' in r.decls || 'outline-color' in r.decls)) continue;
    for (const s of r.selectors) {
      if (/:focus/.test(s) && /border-color|box-shadow/.test(Object.keys(r.decls).join(' '))) continue;  // draws its own mark
      if (cmp(specificity(s), mine) >= 0) lower.push(`${r.file}: ${s} ${JSON.stringify(specificity(s))}`);
    }
  }
  assert.deepEqual(lower, [], 'these rules would hide the focus ring:\n' + lower.join('\n'));
});

test('every control in the reader page is a native control that the focus rule covers', () => {
  // A <div> or <span> with a click is not reachable with Tab. The controls of the page are buttons, fields and links.
  const clickable = [...HTML.matchAll(/<(div|span)\b[^>]*\b(onclick|role="button")/g)].map((m) => m[0]);
  assert.deepEqual(clickable, []);
});

// ---------- contrast ----------
test('the active contents entry, the check heading and the page number have a contrast of 4.5 to 1 or more', () => {
  const active = declsFor('.toc button.active');
  const check = declsFor('.ask .check');
  const pairs = [
    ['active contents entry', active.color, active.background, 'var(--color-surface)'],
    ['check heading in its box', declsFor('.ask .check-h').color, check.background, 'var(--color-surface)'],
    ['page number on a page that is not drawn yet', declsFor('.page-label').color, declsFor('.page').background],
    ['contents entry', declsFor('.toc button').color, 'var(--color-surface)'],
    ['nested contents entry', declsFor('.toc button.subsection').color, 'var(--color-surface)'],
  ];
  const low = [];
  for (const [name, mode] of MODES) {
    for (const [what, fg, ...bgs] of pairs) {
      assert.ok(fg && bgs.every(Boolean), `${what}: colour and background are set`);
      const r = contrast(mode, fg, ...bgs);
      if (r < 4.5) low.push(`${name}: ${what} ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual(low, [], low.join('\n'));
});

// ---------- control size ----------
// Each control and the selectors that give its size, in cascade order.
export const CONTROLS = [
  ['.icon-btn'], ['.zoom-level'], ['.btn'], ['.toc button'], ['.side-tabs button'],
  ['.note-filter button'], ['.selbar button'], ['.note .del'], ['.rename'], ['.opt'], ['.show-marks'], ['.note'],
  ['.ask .ask-row select'], ['.ask .ask-top select'], ['.ask .ask-opt select'], ['.askbar .ask-set select'],
  ['.askbar .ask-player button'], ['.ask .ask-player button'], ['.keypts select'], ['.askbar .ask-opt'], ['.ask .ask-opt'],
  ['.play-btn'],
];
export function heightOf(chain, mode = LIGHT) {
  const d = Object.assign({}, ...chain.map((s) => declsFor(s)));
  const h = Math.max(...['height', 'min-height'].filter((k) => d[k]).map((k) => px(mode, d[k])), 0);
  return h;
}

test('no control of the reader is less than 32 px high', () => {
  const small = CONTROLS.filter((c) => !(heightOf(c) >= 32)).map((c) => `${c.at(-1)}: ${heightOf(c)} px`);
  assert.deepEqual(small, [], small.join('\n'));
  assert.equal(px(LIGHT, 'var(--control-s)'), 32, 'the smallest control token is 32 px');
});

test('no rule makes a button, a field or a text button smaller than 32 px', () => {
  const bad = [];
  for (const r of RULES) {
    for (const s of r.selectors) {
      if (!/(button|select|\.btn|\.rename|\.del|textarea)(?![\w-])[^ ]*$/.test(s)) continue;
      for (const k of ['height', 'min-height', 'max-height']) {
        if (r.decls[k] && /px|var/.test(r.decls[k]) && !/vh|%|calc/.test(r.decls[k]) && px(LIGHT, r.decls[k]) < 32) bad.push(`${s} ${k}: ${r.decls[k]}`);
      }
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

// ---------- dark mode: the word highlight and the saved highlights ----------
test('in dark mode the word highlight and the saved highlights stay visible on the white PDF paper', () => {
  // The PDF paper is white in both modes, so a light blend (screen) makes an orange box white: invisible.
  for (const [name, mode] of MODES) {
    assert.equal(resolve(mode, 'var(--color-page)'), '#ffffff', `${name}: the PDF paper is white`);
    for (const sel of ['.word-box', '.mark-box']) {
      const blend = declsFor(sel)['mix-blend-mode'];
      assert.equal(resolve(mode, blend), 'multiply', `${name}: ${sel} darkens the paper (multiply)`);
    }
    assert.ok(Number(resolve(mode, declsFor('.word-box').opacity)) >= 0.5, `${name}: the word box is at least half strong`);
    // a saved highlight: the fill under the text and a 3 px line of the group colour, both visible on white
    for (const c of ['yellow', 'green', 'blue', 'pink']) {
      const d = declsFor(`.mark-box[data-color="${c}"]`);
      assert.match(d['box-shadow'], new RegExp(`var\\(--hl-${c}\\)`), `${c}: a line of the group colour`);
      assert.ok(contrast(mode, `var(--hl-${c})`, 'var(--color-page)') >= 1.5, `${name}: the ${c} line shows on white`);
    }
  }
});

// ---------- a narrow window with the Ask pane open ----------
const mid = (m) => /max-width:\s*1100px/.test(m);
test('from 821 to 1100 px the open Ask pane hides the side bar and takes at most 40 % of the window', () => {
  const hide = RULES.find((r) => mid(r.media) && r.selectors.some((s) => /\.layout:has\(> \.askpane:not\(\[hidden\]\)\) > \.sidebar/.test(s)));
  assert.ok(hide, 'a rule hides the side bar while the Ask pane is open');
  assert.equal(hide.decls.display, 'none');
  const pane = RULES.filter((r) => mid(r.media) && r.selectors.includes('.askpane')).reduce((a, r) => ({ ...a, ...r.decls }), {});
  assert.equal(pane['max-width'], '40vw', 'the pane is at most 40 % of the window');
  // so at 900 px the PDF column is 900 - 360 = 540 px wide, minus the 32 px of page padding: 508 px for the page
  assert.ok(900 * 0.6 - 32 >= 480, 'the page is at least 480 px wide at 900 px');
});

test('the page is drawn again at the new width when the Ask pane opens or closes', async () => {
  const r = loadApp({ withResizeObserver: true });
  await until(() => r.els.voiceSel.children.length, 'the boot');
  const ro = r.observers.find((o) => o.el === r.els.scroller);
  assert.ok(ro, 'app.js watches the size of the page column');
  r.els.scroller.clientWidth = 1000; ro.cb([{ contentRect: { width: 1000 } }]);   // the first size: nothing to do
  r.runTimers();
  assert.equal(r.viewer.rescales, 0);
  r.els.scroller.clientWidth = 540; ro.cb([{ contentRect: { width: 540 } }]);    // the Ask pane opened
  r.runTimers();
  assert.equal(r.viewer.rescales, 1, 'the pages get the new width');
});

// ---------- review repairs ----------

test('one redraw after a window resize and a column change together; a column change after a resize is not skipped', async () => {
  const r = loadApp({ withResizeObserver: true });
  await until(() => r.els.voiceSel.children.length, 'the boot');
  const ro = r.observers.find((o) => o.el === r.els.scroller);
  r.els.scroller.clientWidth = 1000; ro.cb([{ contentRect: { width: 1000 } }]); r.runTimers();
  const base = r.viewer.rescales;
  // the window gets wider, the column too: one redraw, not two
  r.ctx.innerWidth = 1500; r.fireWindow('resize');
  r.els.scroller.clientWidth = 1100; ro.cb([{ contentRect: { width: 1100 } }]);
  r.runTimers();
  assert.equal(r.viewer.rescales, base + 1, 'one redraw');
  // a window resize that leaves the column as it is: no redraw
  r.ctx.innerWidth = 1520; r.fireWindow('resize'); r.runTimers();
  assert.equal(r.viewer.rescales, base + 1, 'the same column width: no redraw');
  // then the Ask pane opens: the column changes, the redraw comes
  r.els.scroller.clientWidth = 600; ro.cb([{ contentRect: { width: 600 } }]); r.runTimers();
  assert.equal(r.viewer.rescales, base + 2, 'the Ask pane change is not skipped');
});

test('a width change draws all pages at one new scale and keeps the reading position', async () => {
  // rescale() of the viewer computes the old and the new scale itself, so the picture that stays until the new
  // render is stretched by the right ratio (relayout() computed the scale first and stretched by 1: a small page 1).
  const src = read('extension/pdf/app.js');
  assert.doesNotMatch(src, /viewer\.relayout\(\)/, 'app.js redraws with rescale(), one path for every width change');
  const r = await appWithBook({ withResizeObserver: true });
  const ro = r.observers.find((o) => o.el === r.els.scroller);
  r.els.scroller.clientWidth = 1000; ro.cb([{ contentRect: { width: 1000 } }]); r.runTimers();
  r.els.scroller.scrollHeight = 10000; r.els.scroller.scrollTop = 2500;
  r.els.scroller.clientWidth = 400; ro.cb([{ contentRect: { width: 400 } }]);
  r.viewer.rescale = function () { this.rescales++; r.els.scroller.scrollHeight = 4000; };  // the pages get smaller
  r.runTimers();
  r.runFrames();
  assert.equal(r.els.scroller.scrollTop, 1000, 'the same place in the book (a quarter down)');
});
