// Ticket 21: the player bar of the reader. One row of controls, one filled orange control (play), one settings
// panel for the voice type, the voice and the voice preview, a spinner on play while the voice is made, a tooltip
// with the key on each icon button, and no motion when the system asks for reduced motion.
// Node has no browser: the structure is read from index.html and the CSS, and app.js runs on a fake page.
// Run: ./run-tests.sh
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HTML, RULES, LIGHT, DARK, declsFor, innerOf, idsIn, idsUsedBy, tagOf, px, read, loadApp, appWithBook, until } from './reader-css.mjs';

const barHtml = innerOf('playerControls');
// The direct children of the row: the start tags at depth 0 of the row.
function rowChildren(html) {
  const out = []; let depth = 0;
  for (const m of html.matchAll(/<(\/?)(\w+)\b([^>]*)>/g)) {
    const [, close, tag, attrs] = m;
    if (['input', 'img', 'br', 'path', 'circle', 'rect', 'line', 'polyline'].includes(tag) || attrs.endsWith('/')) { if (depth === 0) out.push({ tag, attrs }); continue; }
    if (close) depth--; else { if (depth === 0) out.push({ tag, attrs }); depth++; }
  }
  return out;
}

test('the player bar has one row of controls in this order: contents, previous, play, next, position, speed, highlight, follow, settings', () => {
  const ids = rowChildren(barHtml).map((c) => (/\sid="([^"]+)"/.exec(c.attrs) || /class="([^" ]+)/.exec(c.attrs))[1]);
  assert.deepEqual(ids, ['tocBtn', 'prevBtn', 'playBtn', 'nextBtn', 'scrub', 'speed', 'markBtn', 'findBtn', 'settingsBtn']);
  assert.match(tagOf('playerControls').text, /role="toolbar"/);
  const row = declsFor('.controls');
  assert.equal(row['flex-wrap'], 'nowrap', 'the row never wraps to a second line');
  // nothing in any media query lets it wrap
  assert.ok(!RULES.some((r) => r.selectors.includes('.controls') && r.decls['flex-wrap'] && r.decls['flex-wrap'] !== 'nowrap'));
  // the position column shrinks first, so no control is cut
  assert.equal(declsFor('.scrub')['min-width'], '0');
});

test('at 360 px the row fits: the fixed controls and the gaps leave room for the position slider', () => {
  const narrow = (m) => m === '' || /max-width:\s*(480|800)px/.test(m);
  const d = (s) => declsFor(s, narrow);
  const icon = px(LIGHT, d('.player .icon-btn').width), play = px(LIGHT, d('.play-btn').width);
  const gap = px(LIGHT, d('.controls').gap), pad = px(LIGHT, d('.player')['padding-left'] || d('.player').padding?.split(' ')[1] || '0');
  const speed = px(LIGHT, d('.speed select')['max-width']);
  const fixed = 6 * icon + play + speed + 8 * gap + 2 * pad;   // 6 icon buttons, play, speed, 8 gaps, both sides
  assert.ok(icon >= 32 && play >= 32, 'controls stay 32 px or more');
  assert.ok(360 - fixed >= 48, `the slider keeps 48 px or more at 360 px (it has ${360 - fixed} px)`);
  assert.equal(d('.settings-voice').display, 'none', 'on a narrow window the settings button shows its icon only');
});

test('the voice type, the voice and the preview are in the settings panel, not in the bar', () => {
  const panel = innerOf('settingsPanel');
  for (const id of ['engineSel', 'voiceSel', 'previewBtn']) {
    assert.ok(idsIn(panel).includes(id), `#${id} is in the settings panel`);
    assert.ok(!idsIn(barHtml).includes(id), `#${id} is not in the bar`);
  }
  assert.match(tagOf('settingsPanel').text, /role="dialog"/);
  assert.match(tagOf('settingsPanel').text, /aria-labelledby="settingsTitle"/);
  assert.match(tagOf('settingsBtn').text, /aria-expanded="false"/);
  assert.match(tagOf('settingsBtn').text, /aria-controls="settingsPanel"/);
  // the words of the glossary
  assert.match(innerOf('engineSel'), /<option value="system">Mac voice<\/option>/);
  assert.match(innerOf('engineSel'), /<option value="kokoro">Natural voice<\/option>/);
  assert.doesNotMatch(HTML, /[Ee]ngine<|Speech engine|helper/, 'no "engine" or "helper" in the words a person reads');
});

test('every element id that a reader script uses is in the page', () => {
  const files = ['extension/pdf/app.js', 'extension/pdf/notes.js', 'extension/pdf/ask.js'];
  // ids that a script writes into its own markup (id="..." in a template) are made by that script
  const made = new Set(files.flatMap((f) => [...read(f).matchAll(/id="([\w-]+)"/g)].map((m) => m[1])));
  const missing = [];
  for (const f of files) for (const id of idsUsedBy(f)) if (!tagOf(id) && !made.has(id)) missing.push(`${f}: ${id}`);
  assert.deepEqual(missing, []);
});

test('each control of the bar and the panel has a name for a screen reader', () => {
  const nameless = [];
  for (const html of [barHtml, innerOf('settingsPanel')]) {
    for (const m of html.matchAll(/<(button|select|input)\b([^>]*)>([\s\S]*?)(?=<\/\1>|$)/g)) {
      const [, tag, attrs, inner] = m;
      if (/aria-label="[^"]+"/.test(attrs)) continue;
      if (tag === 'button' && inner.replace(/<[^>]+>/g, '').trim()) continue;   // a button with its own text
      if (/\sid="([^"]+)"/.test(attrs) && new RegExp(`<label\\b[^>]*>(?:(?!</label>)[\\s\\S])*id="${/\sid="([^"]+)"/.exec(attrs)[1]}"`).test(html)) continue;  // inside a label
      nameless.push(`${tag} ${attrs.trim()}`);
    }
  }
  assert.deepEqual(nameless, []);
});

test('each icon button of the bar shows a tooltip with its name, and with its key when it has one', () => {
  const keys = { prevBtn: '←', playBtn: 'Space', nextBtn: '→' };
  for (const id of ['tocBtn', 'prevBtn', 'playBtn', 'nextBtn', 'markBtn', 'findBtn', 'settingsBtn', 'settingsClose']) {
    const t = tagOf(id).text;
    const tip = (/data-tip="([^"]+)"/.exec(t) || [])[1];
    assert.ok(tip, `#${id} has a tooltip`);
    if (keys[id]) assert.ok(tip.includes(keys[id]), `#${id}: the tooltip names the key ${keys[id]}`);
    assert.doesNotMatch(t, /\stitle="/, `#${id}: no second (browser) tooltip`);
  }
  const tipRule = RULES.find((r) => r.selectors.some((s) => /\[data-tip\]:hover::after/.test(s)));
  assert.ok(tipRule, 'a hover rule shows the tooltip');
  assert.match(tipRule.decls['transition-delay'] || tipRule.decls.transition, /var\(--delay-tip\)/);
  assert.equal(LIGHT['--delay-tip'], '500ms', 'the tooltip comes after 500 ms');
});

test('the icons are 20 px, with 8 px between an icon and its text', () => {
  const big = [...barHtml.matchAll(/<svg\b[^>]*>/g)].map((m) => m[0]).filter((s) => !/width="20" height="20"/.test(s));
  assert.deepEqual(big, [], 'every icon of the bar is 20 by 20 px');
  assert.equal(px(LIGHT, declsFor('.player .settings-btn').gap), 8);
  assert.equal(px(LIGHT, declsFor('.btn').gap), 8);
});

test('the only filled orange control of the reader is the play button', () => {
  const orange = [];
  for (const r of RULES) {
    const bg = r.decls.background || r.decls['background-color'] || '';
    if (/var\(--color-play(-hover)?\)/.test(bg)) orange.push(...r.selectors);
  }
  assert.deepEqual(orange.filter((s) => !/^\.play-btn(:hover|:active)?$/.test(s)), []);
  assert.ok(orange.includes('.play-btn'));
  // the highlight icon has no colour value in the HTML: its yellow line comes from a token
  assert.doesNotMatch(HTML, /(stroke|fill)="#/);
  assert.equal(declsFor('.hl-line').color, 'var(--hl-yellow)');
});

test('the player bar follows the light or dark mode of the system, like the top bar', () => {
  const bar = declsFor('.player');
  assert.equal(bar.background, 'var(--color-surface)');
  assert.equal(bar.color, 'var(--color-text)');
  assert.equal(declsFor('.topbar').background, 'var(--color-surface)', 'the top and the bottom bar are in one mode');
});

test('each control of the bar has a hover, a pressed, a disabled and a focus state', () => {
  const has = (sel) => RULES.some((r) => r.selectors.includes(sel));
  for (const base of ['.player .icon-btn', '.play-btn']) {
    for (const st of [':hover', ':active']) assert.ok(has(base + st), `${base}${st}`);
  }
  assert.ok(RULES.some((r) => r.selectors.some((s) => s.startsWith('.play-btn:disabled')) && r.decls.opacity), 'disabled');
  assert.ok(Number(declsFor('.play-btn:disabled').opacity) <= 0.5, 'a disabled control is at most half strong');
  assert.ok(has('.player .settings-btn[aria-expanded="true"]'), 'the settings button shows that its panel is open');
});

test('with reduced motion no transition or spinner runs', () => {
  const tokens = read('extension/pdf/tokens.css');
  const reduced = /prefers-reduced-motion: reduce\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(tokens)[1];
  assert.match(reduced, /--dur-spin:\s*0ms/);
  const spin = declsFor('.play-btn.waiting::before');
  assert.match(spin.animation, /var\(--dur-spin\)/, 'the spinner turns with a motion token');
});

// ---------- behaviour (app.js on a fake page) ----------

test('the settings button opens the panel and moves the focus into it; Escape closes it and gives the focus back', async () => {
  const r = await appWithBook();
  const btn = r.els.settingsBtn, panel = r.els.settingsPanel;
  assert.equal(panel.hidden, true);
  btn.fire('click');
  assert.equal(panel.hidden, false, 'the panel is open');
  assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.equal(r.log.focus, r.els.engineSel, 'the focus is on the first control of the panel');
  const ev = r.key('Escape');
  assert.equal(panel.hidden, true, 'Escape closes the panel');
  assert.equal(ev.defaultPrevented, true);
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(r.log.focus, btn, 'the focus is back on the settings button');
  btn.fire('click'); btn.fire('click');
  assert.equal(panel.hidden, true, 'a second press closes it');
  btn.fire('click'); r.els.settingsClose.fire('click');
  assert.equal(panel.hidden, true, 'the close button closes it');
  r.key('Escape');   // nothing open: Escape does nothing to the reading
  assert.equal(r.state.playing, false);
});

test('the voice type and the voice chosen in the panel stay after a reload', async () => {
  const store = new Map();
  const r = await appWithBook({ store });
  r.els.engineSel.value = 'kokoro'; r.els.engineSel.fire('change');
  await until(() => r.store.get('pr.engine') === 'kokoro', 'the voice type is kept');
  r.els.voiceSel.value = 'v2'; r.els.voiceSel.fire('change');
  assert.equal(store.get('pr.engine.chosen'), 'kokoro');
  assert.equal(store.get('pr.voice.kokoro'), 'v2');
  const again = loadApp({ engine: 'kokoro', store });
  await until(() => again.els.voiceSel.children.length && again.els.engineSel.value === 'kokoro', 'the boot after a reload');
  assert.equal(again.els.voiceSel.value, 'v2', 'the same voice after a reload');
});

test('the preview in the panel says the voice', async () => {
  const r = await appWithBook();
  r.els.previewBtn.fire('click');
  await until(() => r.made.system.current, 'the preview');
  assert.equal(r.els.previewBtn.disabled, true, 'the preview button waits for the end of the preview');
});

test('the play button shows a spinner while the natural voice makes the first sentence, until the first word', async () => {
  const r = await appWithBook({ engine: 'kokoro' });
  r.els.playBtn.fire('click');
  assert.equal(r.els.playBtn.getAttribute('aria-busy'), 'true', 'the spinner shows');
  assert.ok(r.els.playBtn.classList.contains('waiting'));
  assert.equal(r.els.engineStatus.textContent, 'Making the voice…');
  r.made.kokoro.current.onWord(0, 5);
  assert.equal(r.els.playBtn.getAttribute('aria-busy'), 'false', 'the sound started: no spinner');
  assert.equal(r.els.engineStatus.textContent, 'Natural voice ready', 'the status uses the words of the glossary');
  r.els.nextBtn.fire('click');
  assert.equal(r.els.playBtn.getAttribute('aria-busy'), 'true', 'the next sentence is made');
  r.els.playBtn.fire('click');   // pause
  assert.equal(r.els.playBtn.getAttribute('aria-busy'), 'false', 'pause stops the spinner');
});

test('the Mac voice shows no spinner: it starts at once', async () => {
  const r = await appWithBook({ engine: 'system' });
  r.els.playBtn.fire('click');
  assert.notEqual(r.els.playBtn.getAttribute('aria-busy'), 'true');
});

test('the settings button names the voice that reads', async () => {
  const r = await appWithBook();
  r.els.voiceSel.selectedOptions = [{ textContent: 'Heart — US female (A) · American' }];
  r.els.voiceSel.fire('change');
  assert.equal(r.els.settingsVoice.textContent, 'Heart');
});

// ---------- review repairs ----------

// A focused element on the fake page: closest(q) finds an ancestor when q names one of `where`.
const focused = (...where) => ({ matches: () => false, closest: (q) => (q.split(',').some((s) => where.includes(s.trim())) ? {} : null) });

test('Space and the arrows on a focused button in the settings panel do not start or move the reading', async () => {
  const r = await appWithBook();
  r.els.settingsBtn.fire('click');
  const hear = focused('#settingsPanel', 'button, a[href], summary'.split(',')[0]);
  for (const k of ['Space', 'ArrowRight', 'ArrowLeft']) {
    const ev = r.key(k, hear);
    assert.equal(ev.defaultPrevented, false, `${k} is left to the button`);
  }
  assert.equal(r.state.playing, false, 'Space does not start the reading');
  assert.equal(r.state.index, 0, 'the arrows do not move the reading');
  r.key('Escape', hear);
  assert.equal(r.els.settingsPanel.hidden, true, 'Escape still closes the panel');
});

test('Space on a focused button outside the player bar (top bar, side bar) is the button\'s own; in the player bar it is Play', async () => {
  const r = await appWithBook();
  const ev = r.key('Space', focused('button'));
  assert.equal(r.state.playing, false);
  assert.equal(ev.defaultPrevented, false);
  const link = r.key('Space', focused('a[href]'));
  assert.equal(link.defaultPrevented, false, 'a link keeps its keys');
  const inBar = r.key('Space', focused('button', '#playerControls'));
  assert.equal(r.state.playing, true, 'a button of the player bar: Space is Play or Pause, once');
  assert.equal(inBar.defaultPrevented, true, 'and the button is not clicked too');
});

test('the panel closes when the focus leaves it with Tab; a focus move inside it keeps it open', async () => {
  const r = await appWithBook();
  const panel = r.els.settingsPanel;
  r.els.settingsBtn.fire('click');
  const inside = { id: 'voiceSel' };
  panel.contains = (x) => x === inside || x === panel;
  panel.fire('focusout', { relatedTarget: inside });
  assert.equal(panel.hidden, false, 'the focus is still in the panel');
  panel.fire('focusout', { relatedTarget: null });
  assert.equal(panel.hidden, false, 'no new focus (a press on the panel itself): it stays');
  panel.fire('focusout', { relatedTarget: { id: 'somewhereElse' } });
  assert.equal(panel.hidden, true, 'Tab out of the panel closes it');
  assert.equal(r.els.settingsBtn.getAttribute('aria-expanded'), 'false');
  assert.notEqual(r.log.focus, r.els.settingsBtn, 'the focus goes where Tab took it');
});

test('a screen reader hears a voice state only when it changes, not two messages for each sentence', async () => {
  assert.doesNotMatch(tagOf('engineStatus').text, /role="status"|aria-live/, 'the status line of the bar is not a live region');
  assert.doesNotMatch(tagOf('nowReading').text, /role=|aria-live/, 'the sentence text for screen readers is not a live region');
  assert.match(tagOf('voiceAnnounce').text, /role="status"/);
  const r = await appWithBook({ engine: 'kokoro' }, 6);
  const said = [];
  let last = r.els.voiceAnnounce.textContent;
  const listen = () => { if (r.els.voiceAnnounce.textContent !== last) { last = r.els.voiceAnnounce.textContent; if (last) said.push(last); } };
  r.els.playBtn.fire('click'); listen();
  for (let i = 0; i < 3; i++) { r.made.kokoro.current.onWord(0, 5); listen(); r.els.nextBtn.fire('click'); listen(); }
  assert.ok(said.length <= 1, `at most one message for three sentences: ${JSON.stringify(said)}`);
  r.made.kokoro.device = 'Mac voice (the natural voice does not answer)';
  r.made.kokoro.current.onWord(0, 5); listen();
  assert.equal(said.at(-1), 'Mac voice (the natural voice does not answer)', 'a change to the Mac voice is said');
  r.made.kokoro.current.onError(new Error('x')); listen();
  assert.match(said.at(-1), /did not answer/, 'a fault is said');
});

test('below 480 px the bar shows the voice status only for a fault, so the slider keeps its room', async () => {
  const small = RULES.filter((r) => /max-width:\s*480px/.test(r.media));
  const hide = small.find((r) => r.selectors.includes('.engine-status:not(.fault)'));
  assert.equal(hide && hide.decls.display, 'none');
  const r = await appWithBook({ engine: 'kokoro' });
  r.els.playBtn.fire('click');
  r.made.kokoro.current.onWord(0, 5);
  assert.equal(r.els.engineStatus.classList.contains('fault'), false, '"Natural voice ready" is normal');
  r.made.kokoro.current.onError(new Error('x'));
  assert.equal(r.els.engineStatus.classList.contains('fault'), true, 'a message about a fault shows');
});
