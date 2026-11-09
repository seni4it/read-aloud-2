// Ticket 22: the top bar and the side bar of the reader. The side bar shows only its three tabs and the list of the
// open tab; the skip settings, Re-read and Export move to the settings panel under "What to read"; the read-in summary
// moves to the foot of the panel; the top bar has 5 controls or fewer and no filled button.
// Node has no browser: the structure is read from index.html and the CSS, and app.js runs on a fake page.
// Run: ./run-tests.sh
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML, RULES, LIGHT, declsFor, innerOf, idsIn, tagOf, px, read, loadApp, appWithBook, until } from './reader-css.mjs';

const OPTS = ['optCitations', 'optCaptions', 'optRefs', 'optFrontMatter', 'optInsets', 'optTables', 'optParens'];

test('the side bar holds only the three tabs, the close button and the lists of the tabs', () => {
  const side = innerOf('sidebar');
  assert.deepEqual(idsIn(side), ['contentsTab', 'notesTab', 'askTab', 'closeSidebar', 'toc', 'notes']);
  assert.doesNotMatch(side, /type="checkbox"|class="opts"/, 'no setting in the side bar');
  const tabs = declsFor('.side-tabs button');
  assert.equal(tabs['font-size'], 'var(--text-14)', 'tabs are 14 px');
  assert.ok(!tabs['text-transform'] || tabs['text-transform'] === 'none', 'tabs are in sentence case');
  assert.match(innerOf('contentsTab'), /^Contents$/);
  assert.match(innerOf('notesTab'), /^Highlights \(0\)$/);
});

test('the three tabs fit in the side bar: no tab is cut at the right edge', () => {
  // A 14 px system font is about 7 px a letter. Each tab has 8 px padding on each side; the close button is 32 px.
  const width = px(LIGHT, declsFor('.sidebar').width);
  const head = declsFor('.sidebar-head');
  const pad = px(LIGHT, 'var(--space-3)') + px(LIGHT, 'var(--space-2)');
  const tabPad = 2 * px(LIGHT, 'var(--space-2)');
  const text = ['Contents', 'Highlights (123)', 'Ask'].reduce((n, t) => n + t.length * 7 + tabPad, 0);
  const need = pad + text + 2 * 4 + px(LIGHT, 'var(--space-2)') + px(LIGHT, 'var(--control-s)');
  assert.ok(head.padding, 'the head has its padding');
  assert.ok(width >= need, `the side bar (${width} px) is wide enough for the tabs (${need} px)`);
});

test('the skip settings, Re-read and Export are in the settings panel under "What to read"', () => {
  const panel = innerOf('settingsPanel');
  assert.match(panel, /<h3 id="readHead">What to read<\/h3>/);
  const group = innerOf('readGroup');
  for (const id of [...OPTS, 'reparseBtn', 'exportBtn', 'exportStatus']) assert.ok(idsIn(group).includes(id), `#${id} is under "What to read"`);
  assert.equal(OPTS.length, 7, 'seven skip settings');
});

test('the read-in summary is at the foot of the settings panel; the strip above the page is a thin progress line', () => {
  const panel = innerOf('settingsPanel');
  const foot = panel.lastIndexOf('id="parseText"');
  assert.ok(foot > panel.lastIndexOf('id="exportStatus"'), 'the summary comes after the settings');
  assert.ok(!idsIn(innerOf('parseBar')).includes('parseText'), 'no text in the strip');
  assert.equal(px(LIGHT, declsFor('.parse-bar').height), 4, 'the strip is a 4 px line');
  assert.equal(declsFor('.parse-fill').background, 'var(--color-progress)');
});

test('a file that cannot open shows its message on the start screen', async () => {
  const r = loadApp({ withMutationObserver: true });
  await until(() => r.els.voiceSel.children.length, 'the boot');
  r.byId('fileInput').files = [new File(['plain text'], 'notes.txt')];
  r.byId('fileInput').fire('change');
  await until(() => r.els.parseText.textContent.includes('Could not open'), 'the message');
  r.flushMutations();
  assert.match(r.els.emptyMsg.textContent, /Could not open "notes\.txt"/);
  assert.ok(idsIn(innerOf('empty')).includes('emptyMsg'), 'the message line is in the start screen');
});

test('the top bar has 5 controls or fewer, no filled button, and the book title is its heading', () => {
  const top = HTML.slice(HTML.indexOf('<header class="topbar">'), HTML.indexOf('</header>'));
  const visible = [...top.matchAll(/<(button|select|input)\b[^>]*>/g)].map((m) => m[0]).filter((t) => !/\shidden[\s>]/.test(t));
  // the Library button shows only in the desktop app: count it
  const library = /id="libraryBtn"/.test(top) ? 1 : 0;
  assert.ok(visible.length + library <= 5, `top bar controls: ${visible.length + library}`);
  for (const m of top.matchAll(/class="(btn(?:\s[^"]*)?)"/g)) assert.match(m[1], /\bghost\b/, `a quiet button: ${m[1]}`);
  assert.match(tagOf('docTitle').text, /^<h1\b/, 'the title is the heading of the page');
  assert.doesNotMatch(top, /\stitle="/, 'tooltips are the 500 ms labels, not the browser ones');
});

test('a contents entry is at least 40 px high, wraps to more lines and is never cut', () => {
  const entry = declsFor('.toc button');
  assert.equal(entry['min-height'], 'var(--control-m)');
  assert.ok(!entry.height, 'no fixed height');
  for (const k of ['-webkit-line-clamp', 'line-clamp', 'text-overflow']) assert.ok(!entry[k], `no ${k}`);
  assert.notEqual(entry.overflow, 'hidden');
  assert.notEqual(entry['white-space'], 'nowrap');
  assert.equal(entry['overflow-wrap'], 'break-word', 'a long word breaks only when it must');
});

test('a nested contents entry lines up with the text of its parent', () => {
  const parent = declsFor('.toc button'), child = declsFor('.toc button.subsection');
  const left = (d) => d['padding-left'] || d.padding.split(' ')[1];
  assert.equal(left({ ...parent, ...child }), left(parent), 'the same left edge of the text');
  assert.equal(child['font-size'] || parent['font-size'], 'var(--text-14)', 'nested entries are 14 px, set apart by weight and colour');
});

test('the entry of the part that is read now has a clear mark', () => {
  const a = declsFor('.toc button.active');
  assert.equal(a.background, 'var(--color-surface-raised)');
  assert.match(a['box-shadow'], /inset 4px 0 0 var\(--color-progress\)/);
  assert.ok(Number(a['font-weight']) >= 600);
});

test('with 30 contents entries in a window 768 px high the list shows 10 entries or more', () => {
  const top = px(LIGHT, declsFor('.topbar').height);
  const bar = 2 * px(LIGHT, 'var(--space-2)') + px(LIGHT, 'var(--control-l)') + 1;
  const head = px(LIGHT, 'var(--space-3)') + px(LIGHT, 'var(--control-s)') + px(LIGHT, 'var(--space-2)');
  const entry = px(LIGHT, 'var(--control-m)') + px(LIGHT, declsFor('.toc button.chapter')['margin-top'] || '0');
  const shown = Math.floor((768 - top - bar - head) / entry);
  assert.ok(shown >= 10, `${shown} entries show`);
  assert.equal(declsFor('.toc').flex, '1 1 auto', 'the list takes the full height');
});

test('each skip setting keeps its state after a reload, and a change reads the book again', async () => {
  const store = new Map();
  const r = await appWithBook({ store });
  for (const id of OPTS) { r.els[id].checked = !r.els[id].checked; r.els[id].fire('change'); }
  await until(() => r.parses.length >= 2, 'a read-in again');
  const again = loadApp({ store });
  for (const id of OPTS) assert.equal(again.els[id].checked, r.els[id].checked, `#${id} is the same after a reload`);
  const before = r.parses.length;
  r.els.reparseBtn.fire('click');
  await until(() => r.parses.length > before, 'Re-read document reads the book again');
});

test('the side bar opens and closes with the same button as before', async () => {
  const r = await appWithBook();
  r.els.sidebar.hidden = false;
  r.els.tocBtn.fire('click');
  assert.equal(r.els.sidebar.hidden, true);
  r.els.tocBtn.fire('click');
  assert.equal(r.els.sidebar.hidden, false);
  r.els.closeSidebar.fire('click');
  assert.equal(r.els.sidebar.hidden, true);
});

test('no control is lost: every control of the reader before tickets 21 and 22 is still in the page', () => {
  const before = ['zoomOut', 'zoomLevel', 'zoomIn', 'libraryBtn', 'openBtn', 'sampleBtn', 'fileInput', 'contentsTab', 'notesTab', 'askTab',
    'closeSidebar', ...OPTS, 'reparseBtn', 'exportBtn', 'askRestart', 'askClose', 'tocBtn', 'prevBtn', 'playBtn', 'nextBtn', 'markBtn', 'findBtn',
    'seek', 'engineSel', 'voiceSel', 'previewBtn', 'rateSel'];
  assert.deepEqual(before.filter((id) => !tagOf(id)), []);
  assert.ok(RULES.some((r) => r.selectors.includes('.settings[hidden]')), 'the panel is only hidden until the settings button opens it');
});

// ---------- review repairs ----------

// The words a person reads: the text and the labels of index.html, and the string literals of app.js.
function ownerText() {
  const html = HTML.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/g, '');
  const attrs = [...html.matchAll(/\s(?:aria-label|data-tip|title|placeholder|alt)="([^"]*)"/g)].map((m) => m[1]);
  const text = html.replace(/<[^>]+>/g, ' ');
  const js = read('extension/pdf/app.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const strings = [...js.matchAll(/'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`|"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1] ?? m[2] ?? m[3]);
  return [text, ...attrs, ...strings];
}

test('the reader uses the words of the glossary: no "helper", "document" or "Kokoro" for the owner', () => {
  const bad = ownerText().filter((t) => /\bhelper\b|\bdocument\b|Kokoro/i.test(t) && !/^\.\/|^document\.|kokoro$/.test(t));
  assert.deepEqual(bad, []);
  assert.match(innerOf('docTitle'), /^No book open$/);
  assert.match(innerOf('reparseBtn'), /^Re-read book$/);
});

const NARROW = (m) => /max-width:\s*900px/.test(m);

test('up to 900 px the side bar is an overlay that starts closed; the title and the zoom stay in the top bar', async () => {
  const side = RULES.find((r) => NARROW(r.media) && r.selectors.includes('.sidebar'));
  assert.equal(side && side.decls.position, 'absolute', 'the side bar lies over the page, it does not press it');
  assert.ok(!RULES.some((r) => r.media && r.selectors.includes('.doc-title') && r.decls.display === 'none'), 'the title never hides');
  assert.equal(declsFor('.doc-title')['text-overflow'], 'ellipsis', 'a long title ends with …');
  assert.ok(!RULES.some((r) => r.media && r.selectors.includes('.zoom-controls') && r.decls.display === 'none'), 'zoom stays reachable');
  const r = loadApp({ innerWidth: 800 });
  await until(() => r.els.voiceSel.children.length, 'the boot');
  assert.equal(r.els.sidebar.hidden, true, 'at 800 px the side bar starts closed');
  const wide = loadApp({ innerWidth: 1280 });
  await until(() => wide.els.voiceSel.children.length, 'the boot');
  assert.equal(wide.els.sidebar.hidden, false, 'at 1280 px it starts open');
});

test('on a narrow window the open side bar closes with Escape, its × or a press outside it', async () => {
  const r = await appWithBook({ innerWidth: 800 });
  r.els.tocBtn.fire('click');
  assert.equal(r.els.sidebar.hidden, false, 'the contents button opens it');
  r.key('Escape');
  assert.equal(r.els.sidebar.hidden, true, 'Escape closes it');
  r.els.tocBtn.fire('click');
  for (const f of r.docListeners.pointerdown || []) f({ target: { id: 'page' } });
  assert.equal(r.els.sidebar.hidden, true, 'a press on the page closes it');
  r.els.tocBtn.fire('click');
  for (const f of r.docListeners.pointerdown || []) f({ target: r.els.tocBtn });
  r.els.tocBtn.fire('click');
  assert.equal(r.els.sidebar.hidden, true, 'a press on the contents button toggles it once, it is not closed twice');
  const wide = await appWithBook({ innerWidth: 1280 });
  wide.key('Escape');
  for (const f of wide.docListeners.pointerdown || []) f({ target: { id: 'page' } });
  assert.equal(wide.els.sidebar.hidden, false, 'on a wide window the side bar stays open beside the page');
});

test('on a small window the top bar buttons show their icon only, and their names stay for a screen reader', () => {
  for (const id of ['openBtn', 'libraryBtn']) {
    const inner = innerOf(id);
    assert.match(inner, /<svg\b[^>]*width="20" height="20"/, `#${id} has a 20 px icon`);
    assert.match(inner, /<span class="btn-text">[^<]+<\/span>/, `#${id} keeps its words`);
    assert.match(tagOf(id).text, /data-tip="/);
  }
  const small = RULES.find((r) => /max-width:\s*600px/.test(r.media) && r.selectors.includes('.topbar .btn-text'));
  assert.ok(small, 'below 600 px the words are for a screen reader only');
});
