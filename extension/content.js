// Read Aloud 2, on every page: find the readable text, speak it sentence by sentence, highlight the word
// being spoken, and show the player. Highlights use the CSS Custom Highlight API, so the page itself is never changed.
(() => {
  'use strict';
  if (document.documentElement.dataset.readAloud2) return;
  document.documentElement.dataset.readAloud2 = '1';

  const DEFAULTS = { voice: 'kokoro:af_heart', rate: 1.2, follow: true, launcher: true, hoverPlay: true, clickJump: true, pdf: true, hidden: [] };
  const SKIP = 'script,style,noscript,template,svg,math,canvas,video,audio,iframe,select,option,textarea,input,button,pre,nav,footer,aside,'
    + '[aria-hidden="true"],[hidden],[role=navigation],[role=banner],[role=contentinfo],[role=complementary],[contenteditable=""],[contenteditable=true],ra2-root,'
    // page clutter Speechify also skips: citation numbers, info boxes, edit links, site notices, share and cookie bars
    + 'sup.reference,.mw-editsection,#siteSub,#contentSub,.mw-jump-link,.hatnote,.infobox,.navbox,.sidebar,.toc,#toc,.metadata,.mw-indicators,'
    + '[class*="cookie"],[id*="cookie"],[class*="share"],[class*="breadcrumb"],[class*="advert"],[class*="newsletter"],[class*="related"]';
  const ABBR = /\b(Dr|Mr|Mrs|Ms|Prof|St|Sr|Jr|vs|etc|e\.g|i\.e|Fig|No|Vol|approx|ca)\.$/i;
  const MAX = 280;  // longer sentences are cut at a comma or a space, so the voice starts quickly

  let cfg = { ...DEFAULTS };
  const S = { segs: [], i: -1, w: 0, playing: false, paused: false, id: 0, follow: true, base: 0, words: [], weights: [], total: 0, tab: null };
  const hasHL = typeof Highlight === 'function' && CSS.highlights;
  const hlWord = hasHL ? new Highlight() : null, hlSent = hasHL ? new Highlight() : null;
  if (hasHL) { CSS.highlights.set('ra2-word', hlWord); CSS.highlights.set('ra2-sentence', hlSent); }

  // ---------- finding the text ----------
  const vis = new Map(), blk = new Map();
  function visible(el) {
    if (!vis.has(el)) vis.set(el, el.checkVisibility ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : el.offsetParent !== null);
    return vis.get(el);
  }
  function blockOf(el) {  // the nearest element that starts a new line: a paragraph, list item, heading, table cell...
    const start = el;
    if (blk.has(start)) return blk.get(start);
    while (el.parentElement && el !== document.body) {
      const d = getComputedStyle(el).display;
      if (d !== 'contents' && !d.startsWith('inline')) break;
      el = el.parentElement;
    }
    blk.set(start, el);
    return el;
  }
  function root() {  // the main article when the page has one, otherwise the whole page
    const m = document.querySelector('article, main, [role=main]');
    return m && m.innerText.length > 400 ? m : document.body;
  }

  // Blocks of text in reading order: [{ el, parts: [{ node, s, e }], text }]; with a range, only the text inside it.
  const PLAIN = document.contentType === 'text/plain';  // a .txt file: Chrome shows it in <pre>, read it
  const skip = PLAIN ? SKIP.replace('pre,', '') : SKIP;
  function collect(top, range) {
    vis.clear(); blk.clear();
    const out = [];
    const walk = document.createTreeWalker(top, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        if (!n.data.trim() || (range && !range.intersectsNode(n))) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        return p && !p.closest(skip) && visible(p) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    for (let n; (n = walk.nextNode());) {
      let s = 0, e = n.data.length;
      if (range && n === range.startContainer) s = range.startOffset;
      if (range && n === range.endContainer) e = range.endOffset;
      if (s >= e) continue;
      const el = blockOf(n.parentElement);
      let b = out[out.length - 1];
      if (!b || b.el !== el) { b = { el, parts: [], text: '' }; out.push(b); }
      b.parts.push({ node: n, s, e, at: b.text.length });
      b.text += n.data.slice(s, e);
    }
    return out;
  }

  // The whole page's sentences are found once and kept until the page changes, so pressing play does not wait for it.
  let kept = null;
  new MutationObserver((list) => { if (list.some((m) => !host.contains(m.target))) kept = null; })
    .observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  function pageSegs(top) {
    if (!kept || kept.top !== top) kept = { top, segs: segments(collect(top)) };
    return kept.segs.slice();
  }

  // Sentences of each block: [{ b, start, end, say, words: [{ start, end }] }] (offsets in the block's text)
  function segments(blocks) {
    const segs = [];
    for (const b of blocks) {
      const re = /[\s\S]*?(?:[.!?;:…]+["'”’)\]]*(?=\s|$)\s*|$)/g;  // a stop only when a space follows: 3.5 and 10:30 stay whole
      let pend = null;
      for (let m; (m = re.exec(b.text)) && m[0];) {
        const piece = { start: m.index, end: m.index + m[0].length };
        if (pend && ABBR.test(b.text.slice(pend.start, pend.end).trim())) pend.end = piece.end; else { if (pend) cut(b, pend, segs); pend = piece; }
      }
      if (pend) cut(b, pend, segs);
    }
    return segs;
  }
  function cut(b, p, segs) {
    let { start } = p;
    while (start < p.end) {
      let end = p.end;
      if (end - start > MAX) {
        const part = b.text.slice(start, start + MAX);
        const k = Math.max(part.lastIndexOf(', '), part.lastIndexOf('; '), part.lastIndexOf(' — '));
        end = start + (k > MAX / 3 ? k + 1 : Math.max(part.lastIndexOf(' '), 1));
      }
      const words = [];
      const re = /\S+/g; const txt = b.text.slice(start, end);
      for (let m; (m = re.exec(txt));) words.push({ start: start + m.index, end: start + m.index + m[0].length });
      if (words.length && /[\p{L}\p{N}]/u.test(txt)) segs.push({ b, start, end, words, say: txt.replace(/\s+/g, ' ').trim() });
      start = end;
    }
  }

  // The first piece read is about 4 words, so the voice starts within half a second (each request costs about
  // 0.2 s plus 0.06 s a word); the rest of the sentence is made while those words play. The cut is at a comma, or
  // before a small joining word, so it sounds like a natural pause.
  const JOIN = /^(and|or|but|that|which|who|with|without|in|on|of|for|to|from|by|as|at|into|when|while|because|if|the|a|an|is|are|was|were)$/i;
  function quick(seg) {
    const w = seg.words; if (w.length < 8) return [seg];
    const word = (i) => seg.b.text.slice(w[i].start, w[i].end);
    let k = -1;
    for (let i = 2; i <= 5 && k < 0; i++) if (/[,;:]$/.test(word(i))) k = i;  // a comma among the first words
    for (let i = 5; i >= 3 && k < 0; i--) if (JOIN.test(word(i + 1))) k = i;  // or before a joining word
    if (k < 0) k = 4;
    const part = (from, to) => { const words = w.slice(from, to); const s = words[0].start, e = to < w.length ? w[to].start : seg.end;
      return { b: seg.b, start: s, end: e, words, say: seg.b.text.slice(s, e).replace(/\s+/g, ' ').trim() }; };
    return [part(0, k + 1), part(k + 1, w.length)];
  }

  function rangeOf(b, from, to) {  // block text offsets -> DOM Range
    const at = (off, isEnd) => {
      for (const p of b.parts) {
        const len = p.e - p.s;
        if (off < p.at + len || (isEnd && off === p.at + len)) return [p.node, p.s + Math.max(0, off - p.at)];
      }
      const last = b.parts[b.parts.length - 1]; return [last.node, last.e];
    };
    const r = document.createRange();
    try { r.setStart(...at(from, false)); r.setEnd(...at(to, true)); } catch { /* the page changed under us */ }
    return r;
  }

  // ---------- speaking ----------
  const send = (m) => chrome.runtime.sendMessage({ to: 'bg', ...m }).catch(() => {});
  // The voice follows the text: Russian (Cyrillic) is read by the Mac's Russian voice, an Italian page by Sara,
  // everything else by the voice you chose.
  const PAGE_IT = /^it/i.test(document.documentElement.lang || '');
  function voiceFor(text) {
    if (/[\u0400-\u04FF]/.test(text || '')) return 'system:Milena';
    if (PAGE_IT && /^kokoro:(a|b)/.test(cfg.voice)) return 'kokoro:if_sara';
    return cfg.voice;
  }
  let cur = cfg.voice;  // the voice of the sentence being read
  const engine = () => (cur.startsWith('kokoro:') ? 'kokoro' : 'system');
  const voiceId = () => cur.replace(/^(kokoro|system):/, '');

  function play(i, w = 0) {
    const seg = S.segs[i];
    if (!seg) { finish(); return; }
    S.i = i; S.w = w; S.base = w; S.playing = true; S.paused = false; S.id++; cur = voiceFor(seg.say); S.starts = null;
    const words = seg.words.slice(w);
    const text = seg.b.text.slice(words[0].start, seg.end).replace(/\s+/g, ' ').trim();
    // where each word starts in the spoken text, and how long it roughly lasts (for voices without word events)
    S.words = []; let pos = 0;
    for (const x of words) { const t = seg.b.text.slice(x.start, x.end); const k = text.indexOf(t, pos); S.words.push(k < 0 ? pos : k); pos = (k < 0 ? pos : k) + t.length; }
    S.weights = words.map((x) => { const t = seg.b.text.slice(x.start, x.end); return t.length + 2 + (/[.,;:!?]$/.test(t) ? 4 : 0); });
    S.total = S.weights.reduce((a, c) => a + c, 0);
    hlSent && (hlSent.clear(), hlSent.add(rangeOf(seg.b, seg.start, seg.end)));
    mark(w);
    send({ cmd: 'speak', id: S.id, engine: engine(), voice: voiceId(), rate: cfg.rate, text,
      next: S.segs.slice(i + 1, i + 3).map((s) => s.say) });
    ui();
  }
  function mark(w) {
    const seg = S.segs[S.i]; const x = seg && seg.words[w]; if (!x) return;
    S.w = w;
    if (hlWord) { hlWord.clear(); hlWord.add(rangeOf(seg.b, x.start, x.end)); }
    const r = rangeOf(seg.b, x.start, x.end).getBoundingClientRect();
    const out = r.top < 40 || r.bottom > innerHeight - 110;
    if (out && S.follow) scrollTo({ top: scrollY + r.top - innerHeight / 2.5, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    $('find')?.classList.toggle('away', out && !S.follow);
  }
  function pause() {
    if (!S.playing || S.paused) return;
    S.paused = true;
    if (engine() === 'kokoro') send({ cmd: 'pause' }); else send({ cmd: 'stop' });
    ui();
  }
  function resume() {
    if (!S.paused) return;
    if (engine() === 'kokoro') { S.paused = false; send({ cmd: 'resume' }); ui(); } else play(S.i, S.w);
  }
  function stop() {
    S.id++; S.playing = false; S.paused = false; send({ cmd: 'stop' });
    hlWord && hlWord.clear(); hlSent && hlSent.clear(); ui();
  }
  function finish() { S.playing = false; S.paused = false; hlWord && hlWord.clear(); hlSent && hlSent.clear(); ui('Finished.'); }

  function onEvent(m) {
    if (m.evt === 'stopped') { if (S.playing) { S.playing = false; S.paused = false; hlWord && hlWord.clear(); hlSent && hlSent.clear(); ui(); } return; }
    if (m.id !== S.id) return;
    if (m.evt === 'times') { S.starts = Array.isArray(m.starts) && m.starts.length === S.weights.length ? m.starts : null; return; }
    if (m.evt === 'tick' && S.starts && !S.paused) {  // natural voice with Kokoro's own word times: exact
      let k = 0;
      for (let j = 0; j < S.starts.length; j++) if (S.starts[j] !== null && S.starts[j] <= m.t + 0.04) k = j;
      if (S.base + k !== S.w) mark(S.base + k);
    } else if (m.evt === 'tick' && m.d > 0 && !S.paused) {  // no times (Italian): move the highlight by how far the audio has played
      let goal = (m.t / m.d) * S.total, k = 0;
      while (k < S.weights.length - 1 && goal > S.weights[k]) goal -= S.weights[k++];
      if (S.base + k !== S.w) mark(S.base + k);
    } else if (m.evt === 'word') {  // system voice: it says which character it reached
      let k = 0; while (k < S.words.length - 1 && S.words[k + 1] <= m.char) k++;
      mark(S.base + k);
    } else if (m.evt === 'end') play(S.i + 1);
    else if (m.evt === 'error') {
      if (engine() === 'kokoro') { ui('The natural voice is off. Using the Mac voice.'); cfg.voice = 'system:'; cur = 'system:'; play(S.i, S.w); }
      else { stop(); ui(m.why || 'The voice stopped.'); }
    }
  }
  chrome.runtime.onMessage.addListener((m) => {
    if (m.to !== 'page' || (m.tab !== undefined && S.tab !== null && m.tab !== S.tab)) return;
    if (m.evt) onEvent(m);
    else if (m.cmd === 'readSelection') readSelection();
    else if (m.cmd === 'readHere') readAt(lastMenu.x, lastMenu.y);
    else if (m.cmd === 'readPage') readPage();
    else if (m.cmd === 'play-pause') (S.playing && !S.paused ? pause() : S.paused ? resume() : readPage());
    else if (m.cmd === 'back') back();
    else if (m.cmd === 'forward') S.playing && play(S.i + 1);
  });
  document.addEventListener('ra2-read', (e) => readBlock(e.detail));  // the paste page asks to read its text
  if (location.protocol === 'chrome-extension:') chrome.runtime.sendMessage({ to: 'bg', cmd: 'myTab' }).then((t) => { S.tab = t; }).catch(() => {});

  // ---------- where to start ----------
  function start(blocks, at, segs) {
    S.segs = segs || segments(blocks); S.follow = true;
    if (!S.segs.length) { ui('No text to read here.'); return; }
    const i = Math.max(0, at(S.segs));
    const first = quick(S.segs[i]); S.segs.splice(i, 1, ...first);
    if (first.length === 1 && first[0].words.length < 6 && S.segs[i + 1]) S.segs.splice(i + 1, 1, ...quick(S.segs[i + 1]));  // a short title: keep the next sentence short too
    play(i, 0);
  }
  // the mouse rests on a paragraph or the listen button: prepare its first sentence, so reading starts at once
  function warm(blocks, at, given, prio = 2) {
    cur = voiceFor(document.body ? document.body.innerText.slice(0, 400) : '');
    if (engine() !== 'kokoro' || S.playing || hiddenHere()) return;
    const segs = given || segments(blocks); const i = segs.length ? Math.max(0, at(segs)) : -1;
    if (i < 0) return;
    const first = quick(segs[i]);
    const next = first.length === 1 && first[0].words.length < 6 && segs[i + 1] ? quick(segs[i + 1]) : [segs[i + 1]];
    send({ cmd: 'warm', voice: voiceId(), prio, texts: [...first, ...next].filter(Boolean).map((x) => x.say).slice(0, 2) });
  }
  const onScreen = (segs) => segs.findIndex((s) => { const r = rangeOf(s.b, s.start, s.end).getBoundingClientRect(); return r.bottom > 60 && r.height > 0; });
  function readPage() {  // from the first sentence on screen, or the top of the article
    start(null, onScreen, pageSegs(root()));
  }
  function readBlock(el) { start(null, (segs) => segs.findIndex((s) => el.contains(s.b.parts[0].node)), pageSegs(root().contains(el) ? root() : document.body)); }
  function readSelection() {
    const sel = getSelection(); if (!sel.rangeCount || !String(sel).trim()) return;
    start(collect(sel.getRangeAt(0).commonAncestorContainer.parentElement || document.body, sel.getRangeAt(0)), () => 0);
    hideBubble();
  }
  function caretAt(x, y) {
    const c = document.caretPositionFromPoint ? document.caretPositionFromPoint(x, y) : null;
    if (c) return [c.offsetNode, c.offset];
    const r = document.caretRangeFromPoint && document.caretRangeFromPoint(x, y);
    return r ? [r.startContainer, r.startOffset] : [null, 0];
  }
  function locate(x, y) {  // the sentence and word under a point, in S.segs
    const [node, off] = caretAt(x, y); if (!node || node.nodeType !== 3) return null;
    for (let i = 0; i < S.segs.length; i++) {
      const seg = S.segs[i]; const p = seg.b.parts.find((q) => q.node === node); if (!p) continue;
      const o = p.at + off - p.s; if (o < seg.start || o > seg.end) continue;
      let w = seg.words.findIndex((x) => o < x.end); if (w < 0) w = seg.words.length - 1;
      return [i, w];
    }
    return null;
  }
  function readAt(x, y) {
    const el = document.elementFromPoint(x, y); if (!el) { readPage(); return; }
    S.segs = pageSegs(root().contains(el) ? root() : document.body); S.follow = true;
    const hit = locate(x, y); if (hit) play(...hit); else readBlock(blockOf(el));
  }
  function back() { if (!S.playing) return; play(S.w - S.base > 1 || S.i === 0 ? S.i : S.i - 1); }

  // ---------- the player (inside a shadow root, so page styles never touch it) ----------
  const host = document.createElement('ra2-root');
  const sh = host.attachShadow({ mode: 'closed' });
  const ICON = {
    play: '<path d="M8 5v14l11-7z" fill="currentColor"/>', pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>',
    back: '<path d="M6 6h2v12H6zM9.5 12 18 18V6z" fill="currentColor"/>', fwd: '<path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" fill="currentColor"/>',
    find: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="2"/>',
    close: '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    ear: '<path d="M4 14v-2a8 8 0 0 1 16 0v2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="3" y="13" width="5" height="7" rx="2" fill="currentColor"/><rect x="16" y="13" width="5" height="7" rx="2" fill="currentColor"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">${ICON[n]}</svg>`;
  sh.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; }
    button { all: unset; cursor: pointer; display: grid; place-items: center; border-radius: 999px; color: inherit; }
    button:focus-visible { outline: 3px solid #6ea8ff; outline-offset: 2px; }
    .bar { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 2147483647; display: flex; align-items: center; gap: 4px;
           padding: 6px 8px; background: #10233f; color: #fff; border-radius: 999px; box-shadow: 0 8px 30px rgba(0,0,0,.35); font-size: 14px; max-width: calc(100vw - 24px); }
    .bar[hidden], .launch[hidden], .hover[hidden], .bubble[hidden], .menu[hidden] { display: none; }
    .bar button { width: 40px; height: 40px; } .bar button:hover { background: rgba(255,255,255,.14); }
    .bar .pp { width: 48px; height: 48px; background: #FF8C00; color: #111; } .bar .pp:hover { background: #ffa033; }
    .bar .find.away { color: #FF8C00; box-shadow: inset 0 0 0 2px #FF8C00; }
    .bar .txt { width: auto; padding: 0 12px; font-weight: 600; white-space: nowrap; max-width: 150px; overflow: hidden; text-overflow: ellipsis; display: block; line-height: 40px; }
    .msg { position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%); background: #10233f; color: #fff; padding: 6px 12px; border-radius: 8px; white-space: nowrap; font-size: 13px; }
    .msg:empty { display: none; }
    .menu { position: absolute; bottom: 58px; right: 0; width: 290px; max-height: 60vh; overflow: auto; background: #fff; color: #0f172a; border-radius: 12px;
            box-shadow: 0 10px 40px rgba(0,0,0,.3); padding: 12px; font-size: 14px; }
    .menu h4 { margin: 10px 0 4px; font-size: 12px; color: #475569; text-transform: uppercase; letter-spacing: .04em; }
    .menu button { display: block; width: 100%; text-align: left; padding: 8px 10px; border-radius: 8px; }
    .menu button:hover, .menu button.on { background: #fff3e0; } .menu button.on { font-weight: 700; }
    .menu input { width: 100%; accent-color: #FF8C00; }
    .menu .rates { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; } .menu .rates button { width: auto; padding: 4px 10px; border: 1px solid #e2e8f0; }
    .launch { position: fixed; right: 14px; top: 50%; z-index: 2147483646; width: 48px; height: 48px; background: #10233f; color: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.3); }
    .launch:hover { background: #FF8C00; color: #111; }
    .hover { position: fixed; z-index: 2147483646; width: 28px; height: 28px; background: #FF8C00; color: #111; box-shadow: 0 2px 8px rgba(0,0,0,.25); }
    .hover svg { width: 16px; height: 16px; }
    .bubble { position: fixed; z-index: 2147483647; display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 14px 0 10px; background: #10233f; color: #fff; font-size: 14px; font-weight: 600; box-shadow: 0 6px 20px rgba(0,0,0,.3); }
    .bubble svg { width: 18px; height: 18px; }
    @media print { .bar, .launch, .hover, .bubble { display: none; } }
  </style>
  <div class="bar" id="bar" role="toolbar" aria-label="Read Aloud 2" hidden>
    <span class="msg" id="msg" role="status"></span>
    <button id="back" title="Previous sentence" aria-label="Previous sentence">${svg('back')}</button>
    <button class="pp" id="pp" title="Play or pause" aria-label="Pause">${svg('pause')}</button>
    <button id="fwd" title="Next sentence" aria-label="Next sentence">${svg('fwd')}</button>
    <button class="txt" id="speed" title="Speed and voice" aria-haspopup="true">1.2×</button>
    <button class="find" id="find" title="Go to the word being read" aria-label="Go to the word being read">${svg('find')}</button>
    <button id="close" title="Stop and close" aria-label="Stop and close">${svg('close')}</button>
    <div class="menu" id="menu" hidden></div>
  </div>
  <button class="launch" id="launch" title="Listen to this page (Read Aloud 2)" aria-label="Listen to this page" hidden>${svg('ear')}</button>
  <button class="hover" id="hover" title="Listen from here" aria-label="Listen from here" hidden>${svg('play')}</button>
  <button class="bubble" id="bubble" hidden>${svg('play')}Listen</button>`;
  const $ = (id) => sh.getElementById(id);
  (document.body || document.documentElement).appendChild(host);

  let note = '', noteTimer = null;
  function ui(msg) {
    if (msg !== undefined) { note = msg; clearTimeout(noteTimer); noteTimer = setTimeout(() => { note = ''; $('msg').textContent = ''; }, 4000); }
    const active = S.playing || S.paused;
    $('bar').hidden = !active && !note;
    const reading = S.playing && !S.paused;
    $('pp').innerHTML = svg(reading ? 'pause' : 'play'); $('pp').setAttribute('aria-label', reading ? 'Pause' : 'Play');
    $('speed').textContent = cfg.rate.toFixed(1) + '×';
    $('msg').textContent = note;
    $('launch').hidden = active || !cfg.launcher || hiddenHere();
  }
  const hiddenHere = () => cfg.hidden.includes(location.hostname);
  // mouse only: a key press on a focused player button never starts reading (detail is 0 for keys)
  const click = (id, fn) => $(id).addEventListener('click', (e) => { e.stopPropagation(); if (e.detail) fn(e); });
  click('pp', () => (S.playing && !S.paused ? pause() : S.paused ? resume() : readPage()));
  click('back', back);
  click('fwd', () => S.playing && play(S.i + 1));
  click('close', () => { stop(); $('menu').hidden = true; });
  click('launch', readPage);
  $('launch').addEventListener('mouseenter', () => warm(null, onScreen, pageSegs(root())));
  // prepare the first sentence on screen when the page opens and whenever you stop scrolling
  let scrollTimer = null;
  // everything on screen, top first: each paragraph's opening is cut short the same way a start would cut it
  let screenNo = 0;
  function warmScreen() {
    cur = voiceFor('');
    if (document.visibilityState !== 'visible' || engine() !== 'kokoro' || S.playing || hiddenHere()) return;
    const texts = [];
    for (const s of pageSegs(root())) {
      const r = rangeOf(s.b, s.start, s.end).getBoundingClientRect();
      if (r.bottom < 0 || r.height === 0) continue;
      if (r.top > innerHeight || texts.length >= 30) break;
      texts.push(...(s.start === firstOf(s.b) || !texts.length ? quick(s) : [s]).map((x) => x.say));
    }
    if (texts.length) send({ cmd: 'warm', voice: voiceId(), prio: 1, batch: Date.now() + ++screenNo, texts });
  }
  const firstOf = (b) => { const m = /\S/.exec(b.text); return m ? m.index : 0; };
  setTimeout(() => (window.requestIdleCallback || setTimeout)(warmScreen), 1200);
  addEventListener('scroll', () => { clearTimeout(scrollTimer); scrollTimer = setTimeout(warmScreen, 700); }, { passive: true });
  document.addEventListener('visibilitychange', warmScreen);
  click('find', () => { S.follow = true; const seg = S.segs[S.i]; const x = seg && seg.words[S.w]; if (x) { const r = rangeOf(seg.b, x.start, x.end).getBoundingClientRect(); scrollTo({ top: scrollY + r.top - innerHeight / 2.5, behavior: 'smooth' }); } $('find').classList.remove('away'); });
  click('speed', () => { $('menu').hidden = !$('menu').hidden; if (!$('menu').hidden) menu(); });

  async function menu() {
    const m = $('menu');
    m.innerHTML = `<h4>Speed <b id="rv">${cfg.rate.toFixed(1)}×</b></h4><input id="rate" type="range" min="0.5" max="4" step="0.1" value="${cfg.rate}">
      <div class="rates">${[0.8, 1, 1.2, 1.5, 2, 2.5, 3].map((r) => `<button data-r="${r}">${r}×</button>`).join('')}</div><h4>Voice</h4><p>Loading voices…</p>`;
    const setRate = (r) => {
      cfg.rate = Math.round(r * 10) / 10; save(); m.querySelector('#rv').textContent = cfg.rate.toFixed(1) + '×'; m.querySelector('#rate').value = cfg.rate; ui();
      if (S.playing && !S.paused) { if (engine() === 'kokoro') send({ cmd: 'rate', rate: cfg.rate }); else play(S.i, S.w); }
    };
    m.querySelector('#rate').addEventListener('change', (e) => setRate(Number(e.target.value)));
    m.querySelector('#rate').addEventListener('input', (e) => { m.querySelector('#rv').textContent = Number(e.target.value).toFixed(1) + '×'; });
    m.querySelectorAll('[data-r]').forEach((b) => b.addEventListener('click', () => setRate(Number(b.dataset.r))));
    const v = await chrome.runtime.sendMessage({ to: 'bg', cmd: 'voices' }).catch(() => null);
    m.querySelector('p')?.remove();
    const add = (title, list, prefix) => {
      if (!list.length) return;
      m.append(Object.assign(document.createElement('h4'), { textContent: title }));
      for (const x of list) {
        const b = document.createElement('button'); const id = prefix + x.id;
        b.textContent = x.label; b.className = cfg.voice === id ? 'on' : '';
        b.addEventListener('click', () => { cfg.voice = id; save(); m.querySelectorAll('button.on').forEach((q) => q.classList.remove('on')); b.classList.add('on'); if (S.playing && !S.paused) play(S.i, S.w); });
        m.append(b);
      }
    };
    if (v) {
      add('Voices', v.natural, 'kokoro:');
      if (!v.server) m.append(Object.assign(document.createElement('p'), { textContent: 'Natural voices are off: the voice server is not running.' }));
      add('Russian', v.system, 'system:');
    }
  }

  // play button beside the paragraph under the mouse
  let hoverEl = null, warmTimer = null;
  document.addEventListener('mouseover', (e) => {
    if (!cfg.hoverPlay || hiddenHere() || e.target === host) return;
    const t = e.target.closest && e.target.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,dd,td,figcaption');
    if (!t || t.closest(SKIP) || (t.innerText || '').trim().length < 25) return;
    if (hoverEl !== t) { clearTimeout(warmTimer); warmTimer = setTimeout(() => warm(collect(t), () => 0), 200); }
    hoverEl = t; const r = t.getBoundingClientRect();
    Object.assign($('hover').style, { left: Math.max(4, r.left - 34) + 'px', top: Math.max(4, r.top + 2) + 'px' });
    $('hover').hidden = false;
  }, { passive: true });
  addEventListener('scroll', () => { $('hover').hidden = true; }, { passive: true });
  click('hover', () => { if (hoverEl) readBlock(hoverEl); $('hover').hidden = true; });

  // "Listen" bubble for selected text
  document.addEventListener('mouseup', (e) => {
    if (e.target === host) return;
    setTimeout(() => {
      const sel = getSelection(); const txt = String(sel).trim();
      if (!txt || txt.length < 3 || !sel.rangeCount || hiddenHere()) { hideBubble(); return; }
      const r = sel.getRangeAt(0).getBoundingClientRect();
      Object.assign($('bubble').style, { left: Math.min(innerWidth - 110, Math.max(4, r.right - 50)) + 'px', top: Math.min(innerHeight - 44, r.bottom + 8) + 'px' });
      $('bubble').hidden = false;
      warm(collect(sel.getRangeAt(0).commonAncestorContainer.parentElement || document.body, sel.getRangeAt(0)), () => 0);
    }, 10);
  });
  function hideBubble() { $('bubble').hidden = true; }
  click('bubble', readSelection);

  // while reading, a click on a word jumps there (links, buttons and fields keep working as usual)
  document.addEventListener('click', (e) => {
    if (!cfg.clickJump || !(S.playing || S.paused) || e.target === host || !e.detail) return;
    if (e.target.closest('a,button,input,select,textarea,label,[role=button],[contenteditable]') || String(getSelection()).trim()) return;
    const hit = locate(e.clientX, e.clientY); if (hit) play(...hit);
  }, true);

  // you scroll yourself: the page stops following the voice until you press the target button
  const leave = () => { if (S.playing) S.follow = false; };
  addEventListener('wheel', leave, { passive: true });
  addEventListener('touchmove', leave, { passive: true });
  addEventListener('keydown', (e) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) leave(); if (e.key === 'Escape' && !$('menu').hidden) $('menu').hidden = true; });
  let lastMenu = { x: innerWidth / 2, y: 80 };
  document.addEventListener('contextmenu', (e) => {
    lastMenu = { x: e.clientX, y: e.clientY };
    const sel = getSelection();
    if (String(sel).trim() && sel.rangeCount) warm(collect(sel.getRangeAt(0).commonAncestorContainer.parentElement || document.body, sel.getRangeAt(0)), () => 0);
    else { const el = document.elementFromPoint(e.clientX, e.clientY); const b = el && blockOf(el); if (b) warm(null, (segs) => segs.findIndex((x) => b.contains(x.b.parts[0].node)), pageSegs(root().contains(b) ? root() : document.body)); }
  }, true);

  // settings, shared with the popup
  const save = () => chrome.storage.sync.set({ ra2: cfg }).catch(() => {});
  const KNOWN = /^kokoro:(af_heart|am_michael|bf_emma|if_sara)$|^system:/;  // a voice removed from the list falls back to Heart
  chrome.storage.sync.get('ra2').then((r) => { cfg = { ...DEFAULTS, ...(r.ra2 || {}) }; if (!KNOWN.test(cfg.voice)) cfg.voice = DEFAULTS.voice; cur = cfg.voice; ui(); }).catch(() => ui());
  chrome.storage.onChanged.addListener((c) => { if (c.ra2) { cfg = { ...DEFAULTS, ...c.ra2.newValue }; ui(); } });
})();
