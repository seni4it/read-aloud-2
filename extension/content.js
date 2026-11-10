// Read Aloud 2, on every page: find the readable text, speak it sentence by sentence, highlight the word
// being spoken, and show the player. Highlights use the CSS Custom Highlight API, so the page itself is never changed.
(() => {
  'use strict';
  // The reader and the library of the voice server have their own player and say so in a meta tag. The add-on then does
  // nothing there: no Listen button, no Tab stop, no listener, no storage read. The tag, not the address, so a new port
  // or the name "localhost" changes nothing (Chrome check of 10 Nov 2026).
  // Any page may carry this tag and so turn the add-on off for itself: this is accepted (review of 10 Nov 2026).
  if (document.querySelector('meta[name="read-aloud-2"][content="own-player"]')) return;
  if (document.documentElement.dataset.readAloud2) return;
  document.documentElement.dataset.readAloud2 = '1';

  const DEFAULTS = { voice: 'kokoro:af_heart', rate: 1.2, follow: true, launcher: true, hoverPlay: true, clickJump: true, pdf: true, hidden: [] };
  const SKIP = 'script,style,noscript,template,svg,math,canvas,video,audio,iframe,select,option,textarea,input,button,pre,nav,footer,aside,'
    + '[aria-hidden="true"],[hidden],[role=navigation],[role=banner],[role=contentinfo],[role=complementary],[contenteditable=""],[contenteditable=true],ra2-root,'
    // page clutter Speechify also skips: citation numbers, info boxes, edit links, site notices, share and cookie bars
    + 'sup.reference,.mw-editsection,#siteSub,#contentSub,.mw-jump-link,.hatnote,.infobox,.navbox,.sidebar,.toc,#toc,.metadata,.mw-indicators,'
    + '[class*="cookie"],[id*="cookie"],[class*="share"],[class*="breadcrumb"],[class*="advert"],[class*="newsletter"],[class*="related"]';
  // Short forms that do not end a sentence. 'et al.', 'ca.' and 'No.' only as written here, so 'AL.', 'CA.' (state codes)
  // and 'said no.' end a sentence. A month only before a number ('Dec. 5'). An initial only in a name ('J. R. Smith').
  const ABBR = /\b(Dr|Mr|Mrs|Ms|Prof|St|Sr|Jr|vs|etc|e\.g|i\.e|Fig|Vol|approx|cf|pp?|Eq|Ref|Inc|Ltd)\.$/i;
  function isAbbr(t, next) {  // t: the sentence so far; next: the piece that follows it
    if (ABBR.test(t) || /\b(No|al|ca)\.$/.test(t)) return true;
    if (/\b(Jan|Feb|Aug|Sept?|Oct|Nov|Dec)\.$/.test(t)) return /^\d/.test(next);
    return /(^|\s)\p{Lu}\.$/u.test(t) && (/^(\p{Lu}\.\s*)+$/u.test(t) || /\p{Lu}\.\s+\p{Lu}\.$/u.test(t) || /^\p{Lu}\.$/u.test(next));
  }
  const MAX = 280;  // longer sentences are cut at a comma or a space, so the voice starts quickly

  let cfg = { ...DEFAULTS };
  const host = document.createElement('ra2-root');  // the player; made here so that gone() can remove it at any time
  // id: the sentence number, started at a random value made one time for each load of the page (a page token), so a
  // late event of the page before a reload in the same tab (its ids also counted from the start) is never taken as ours
  const S = { segs: [], i: -1, w: 0, playing: false, paused: false, id: Math.floor(Math.random() * 2 ** 32) * 2 ** 20, follow: true, base: 0, words: [], weights: [], total: 0, tab: null, boxes: [] };
  const hasHL = typeof Highlight === 'function' && CSS.highlights;
  // The ::highlight() rules of content.css style the text of the document only. Text in a shadow root takes its style
  // from the style sheets of that root, so the same rules go into each shadow root that is read, as an adopted style
  // sheet (no element is added to the page), and leave it when the reading ends. The values come from the token block
  // below; tests/node/web-player-leftovers.test.mjs checks that this text equals content.css (without its comment).
  const hlCss = (t = TOKENS.root) => `::highlight(ra2-sentence) { background-color: var(--ra2-color-sentence, ${t['--color-sentence']}); }\n`
    + `::highlight(ra2-word) { background-color: var(--ra2-color-word, ${t['--color-word']}); color: var(--ra2-color-on-word, ${t['--color-on-word']}); }\n`;
  let hlSheet = null;
  const dressed = new Set();  // the shadow roots that hold hlSheet now
  function dress(node) {
    const r = hasHL && node.getRootNode?.();
    if (!r || !r.host || dressed.has(r) || !r.adoptedStyleSheets || typeof CSSStyleSheet !== 'function') return;
    try {
      if (!hlSheet) { hlSheet = new CSSStyleSheet(); hlSheet.replaceSync(hlCss()); }
      r.adoptedStyleSheets = [...r.adoptedStyleSheets, hlSheet]; dressed.add(r);
    } catch { /* a page that does not allow it: the marks of that text have no colour */ }
  }
  function undress() {
    for (const r of dressed) try { r.adoptedStyleSheets = [...r.adoptedStyleSheets].filter((x) => x !== hlSheet); } catch { /* the root is gone */ }
    dressed.clear();
  }
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
  // A skip class on <body> or <html> (for example 'cookie-consent-active') does not leave out the whole page.
  // A selection that starts or ends in a skipped area (a code block, a side box) reads it there; a skipped area that
  // the selection only crosses (a nav, a cookie bar) stays out.
  const HARD = 'script,style,noscript,template,ra2-root';
  function skipped(el, sel, range) {
    const c = el.closest(sel);
    if (!c || c === document.body || c === document.documentElement) return false;
    return !(range && !c.matches(HARD) && (c.contains(range.startContainer) || c.contains(range.endContainer)));
  }
  // skipped(), also for text in a shadow root: a nav or a cookie bar of the page around its host leaves it out too
  function skippedDeep(el, sel, range) {
    for (let x = el; x; x = x.getRootNode?.()?.host) if (skipped(x, sel, range)) return true;
    return false;
  }
  // The text nodes under top in the order of the page as it shows (ticket 26, Chrome check). The walk goes into each
  // open shadow root (element.shadowRoot) at the place of its host, and a <slot> gives the nodes it shows; the light
  // children of a host are read through its slots only. A closed shadow root cannot be read; the player's root is closed.
  // The filter is asked in tree order, so it collects the nodes itself and goes into a shadow root at the right place.
  function textsIn(top, range, found, roots) {
    const into = (n) => {
      if (n.shadowRoot) return [n.shadowRoot];
      const a = n.localName === 'slot' && typeof n.assignedNodes === 'function' ? n.assignedNodes({ flatten: true }) : null;
      return a && a.length ? a : null;
    };
    const take = (n) => {
      if (!n.data.trim() || (range && !range.intersectsNode(n))) return;
      const p = n.parentElement;
      if (p && !skippedDeep(p, skip, range) && visible(p)) found.push(n);
    };
    const enter = (n) => {
      if (n.nodeType === 3) { take(n); return; }
      if (n.nodeType === 11) { roots.add(n); textsIn(n, range, found, roots); return; }
      if (n.nodeType !== 1 || n === host) return;
      const inner = into(n);
      if (inner) inner.forEach(enter); else textsIn(n, range, found, roots);
    };
    const walk = document.createTreeWalker(top, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode(n) {
        if (n.nodeType === 3) { take(n); return NodeFilter.FILTER_REJECT; }
        if (n === host) return NodeFilter.FILTER_REJECT;
        const inner = into(n);
        if (!inner) return NodeFilter.FILTER_SKIP;  // go into its children
        inner.forEach(enter);
        return NodeFilter.FILTER_REJECT;  // its light children come through its slots
      },
    });
    while (walk.nextNode());
  }
  function collect(top, range) {
    vis.clear(); blk.clear();
    const out = [], found = [], roots = new Set();
    textsIn(top, range, found, roots);
    out.roots = roots;  // the open shadow roots that were read: pageSegs() watches them
    for (const n of found) {
      let s = 0, e = n.data.length;
      if (range && n === range.startContainer) s = range.startOffset;
      if (range && n === range.endContainer) e = range.endOffset;
      if (s >= e) continue;
      const el = blockOf(n.parentElement);
      let b = out[out.length - 1];
      if (!b || b.el !== el) { b = { el, parts: [], text: '' }; out.push(b); }
      if (b.text && !/\s$/.test(b.text) && afterBreak(n, el)) b.text += ' ';  // 'end.<br>Next': two words, two sentences
      b.parts.push({ node: n, s, e, at: b.text.length });
      b.text += n.data.slice(s, e);
    }
    vis.clear(); blk.clear();  // they hold an entry for each element of the page: keep no memory after a scan
    return out;
  }
  function afterBreak(n, el) {  // a <br> comes just before this text, inside its block (spaces and comments between do not count)
    const prev = (x) => { let p = x.previousSibling; while (p && (p.nodeType === 8 || (p.nodeType === 3 && !p.data.trim()))) p = p.previousSibling; return p; };
    while (n && n !== el && !prev(n)) n = n.parentElement;
    return !!n && n !== el && prev(n).nodeName === 'BR';
  }

  // The page's sentences are found when the owner shows that he wants to listen (the pointer on a listen button, a
  // right-click, play), and kept until the read area changes, so play does not wait for them. Only the read area is
  // watched, and only while the sentences are kept: a page where the owner does not listen costs no work.
  let kept = null, watch = null;
  function release() {  // drop the kept sentences and stop the watch
    kept = null; watch?.disconnect?.();  // ?.(): the fake page of web-sentences.test.mjs has no disconnect()
  }
  function pageSegs(top) {
    if (!kept || kept.top !== top) {
      release();
      const blocks = collect(top);
      kept = { top, segs: segments(blocks), roots: blocks.roots };
      // a change inside the read area or in a shadow root that was read, or the removal of the area itself (a site
      // that replaces its article)
      watch ||= new MutationObserver((list) => {
        if (!kept || !kept.top.isConnected || list.some((m) => kept.top.contains(m.target) || kept.roots.has(m.target.getRootNode?.()))) release();
      });
      watch.observe(top, { childList: true, subtree: true, characterData: true });
      for (const r of blocks.roots) watch.observe(r, { childList: true, subtree: true, characterData: true });
      for (let a = top.parentNode; a; a = a.parentNode) watch.observe(a, { childList: true });  // only its own children: a few calls
    }
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
        if (pend && isAbbr(b.text.slice(pend.start, pend.end).trim(), m[0].trim())) pend.end = piece.end; else { if (pend) cut(b, pend, segs); pend = piece; }
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
        const sp = part.lastIndexOf(' ');  // a long run with no space (a link, a DOI) is cut every MAX characters
        end = start + (k > MAX / 3 ? k + 1 : sp > 0 ? sp : MAX);
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
  // The pieces are for the voice only. For the owner they stay one Sentence (ticket 26): each piece keeps its whole
  // Sentence in `of`, so the shade covers the whole Sentence, the count counts it once, and Previous and Next skip the
  // pieces. Without this, the first Sentence of a page showed as short Sentences (Chrome check of 10 Nov 2026).
  const JOIN = /^(and|or|but|that|which|who|with|without|in|on|of|for|to|from|by|as|at|into|when|while|because|if|the|a|an|is|are|was|were)$/i;
  function quick(seg) {
    const w = seg.words; if (w.length < 8) return [seg];
    const word = (i) => seg.b.text.slice(w[i].start, w[i].end);
    let k = -1;
    for (let i = 2; i <= 5 && k < 0; i++) if (/[,;:]$/.test(word(i))) k = i;  // a comma among the first words
    for (let i = 5; i >= 3 && k < 0; i--) if (JOIN.test(word(i + 1))) k = i;  // or before a joining word
    if (k < 0) k = 4;
    const part = (from, to) => { const words = w.slice(from, to); const s = words[0].start, e = to < w.length ? w[to].start : seg.end;
      return { b: seg.b, start: s, end: e, words, say: seg.b.text.slice(s, e).replace(/\s+/g, ' ').trim(), of: seg }; };
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
  // After a reload of the add-on, a tab that was open keeps this old script, and every call to the add-on throws at
  // once ("Extension context invalidated"). Then the script goes quiet and removes its player: a reload of the tab
  // gives the new one.
  let dead = false;
  function ask(m) {  // a message to the background; resolves to its answer, or to undefined when there is none
    if (dead) return Promise.resolve();
    // Only a lost add-on ends the script. 'Receiving end does not exist' and 'message port closed' come when the
    // background restarts: the add-on is still there, so the reading goes on.
    const lost = (e) => { if (/context invalidated/i.test(e && e.message)) gone(); };
    try { return chrome.runtime.sendMessage({ to: 'bg', ...m }).catch(lost); } catch { gone(); return Promise.resolve(); }
  }
  const timers = new Set();  // every timer that can still run: gone() clears them
  const later = (f, ms) => { const t = setTimeout(() => { timers.delete(t); if (!dead) f(); }, ms); timers.add(t); return t; };
  const cancel = (t) => { clearTimeout(t); timers.delete(t); };
  // a page or window listener that does nothing after gone()
  const on = (target, type, f, opts) => target.addEventListener(type, (e) => { if (!dead) f(e); }, opts);
  function gone() {
    if (dead) return;
    dead = true; S.playing = S.paused = false; S.id++;
    hlWord && hlWord.clear(); hlSent && hlSent.clear(); host.remove(); undress();
    release(); timers.forEach(clearTimeout); timers.clear();
  }
  const send = (m) => { ask(m); };
  // The voice follows the text: Russian (Cyrillic) is read by the Mac's Russian voice, an Italian page by Sara,
  // everything else by the voice you chose.
  const PAGE_IT = /^it/i.test(document.documentElement.lang || '');
  let natOff = false, natTimer = null;  // the voice server failed: the Mac voice reads until it answers again
  function voiceFor(text) {
    if (/[\u0400-\u04FF]/.test(text || '')) return 'system:Milena';
    // English text never goes to the Russian voice (the only Mac voice in the list) or to the
    // Mac default: both give a Russian accent. Samantha is the Mac's own American voice.
    if (cfg.voice.startsWith('system:') || (natOff && cfg.voice.startsWith('kokoro:'))) return 'system:Samantha';
    if (PAGE_IT && /^kokoro:(a|b)/.test(cfg.voice)) return 'kokoro:if_sara';
    return cfg.voice;
  }
  function retryNatural() {  // ask the server every 5 s; the next sentence after it answers is natural again
    cancel(natTimer);
    natTimer = later(() => ask({ cmd: 'voices' }).then((v) => { if (v && v.server) natOff = false; else if (!dead) retryNatural(); }), 5000);
  }
  let cur = cfg.voice;  // the voice of the sentence being read (set by play)
  const engine = () => (cur.startsWith('kokoro:') ? 'kokoro' : 'system');
  const voiceId = () => cur.replace(/^(kokoro|system):/, '');

  function play(i, w = 0) {
    const seg = S.segs[i];
    if (!seg) { finish(); return; }
    S.i = i; S.w = w; S.base = w; S.playing = true; S.paused = false; S.id++; cur = voiceFor(seg.say); S.starts = null; S.wait = true;
    // the boxes that scroll the text: found once for each block (it reads the style of each box around the text), so the
    // pieces of one Sentence and the next Sentences of the same paragraph read no style
    if (S.boxesOf !== seg.b.el) { S.boxes = scrollers(seg.b.el); S.boxesOf = seg.b.el; }
    const words = seg.words.slice(w);
    const text = seg.b.text.slice(words[0].start, seg.end).replace(/\s+/g, ' ').trim();
    // where each word starts in the spoken text, and how long it roughly lasts (for voices without word events)
    S.words = []; let pos = 0;
    for (const x of words) { const t = seg.b.text.slice(x.start, x.end); const k = text.indexOf(t, pos); S.words.push(k < 0 ? pos : k); pos = (k < 0 ? pos : k) + t.length; }
    S.weights = words.map((x) => { const t = seg.b.text.slice(x.start, x.end); return t.length + 2 + (/[.,;:!?]$/.test(t) ? 4 : 0); });
    S.total = S.weights.reduce((a, c) => a + c, 0);
    const whole = seg.of || seg;  // a piece of a Sentence: the shade covers the whole Sentence
    dress(seg.b.parts[0].node);  // text in a shadow root: the highlight style goes into that root
    hlSent && (hlSent.clear(), hlSent.add(rangeOf(seg.b, whole.start, whole.end)));
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
    if (!r.width && !r.height) return;  // the site replaced this text: its place is not known, so the page stays still
    let top = 40, bottom = innerHeight - 110;  // the part of the window that each box around the text also shows
    for (const b of S.boxes) { const v = b.getBoundingClientRect(); top = Math.max(top, v.top); bottom = Math.min(bottom, v.bottom); }
    const out = r.top < top || r.bottom > bottom;
    if (out && S.follow) bringIntoView(r, S.boxes);
    $('find')?.classList.toggle('away', out && !S.follow);
  }
  // Follow moves the boxes that scroll the text: on most pages the window, on some sites (docs, web mail) a box in the
  // page, and on some a box in a box. The way up crosses shadow roots (ticket 26): a text in a <slot> goes to its slot,
  // and the top of a shadow root goes to its host.
  const up = (x) => x.assignedSlot || x.parentElement || x.getRootNode?.()?.host || null;
  function scrollers(el) {  // the boxes around el that scroll, the nearest first; [] when only the window scrolls the text
    const out = [];
    for (let x = el; x && x !== document.body && x !== document.documentElement; x = up(x)) {
      if (/auto|scroll|overlay/.test(getComputedStyle(x).overflowY) && x.scrollHeight > x.clientHeight) out.push(x);
    }
    return out;
  }
  // r: the word's place on the screen. Each box, the nearest first and then the window, that does not show the word
  // moves it to 40% of its height. A box moves only the boxes inside it, so the next box uses the new place of the word.
  // force: the target button; the nearest box (or the window) moves also when it shows the word.
  function bringIntoView(r, boxes, force) {
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    let t = r.top, b = r.bottom;
    boxes.forEach((box, k) => {
      const v = box.getBoundingClientRect();
      if (!(force && k === 0) && t >= v.top && b <= v.bottom) return;
      // a box at its scroll limit moves less: only that part moves the word, and the next box or the window does the rest
      const at = box.scrollTop || 0, max = Math.max(0, box.scrollHeight - box.clientHeight);
      const d = clamp(t - v.top - box.clientHeight / 2.5, -at, max - at);
      if (!d) return;
      box.scrollBy({ top: d, behavior }); t -= d; b -= d;
    });
    if ((force && !boxes.length) || t < 40 || b > innerHeight - 110) scrollTo({ top: scrollY + t - innerHeight / 2.5, behavior });
  }
  function pause() {
    if (!S.playing || S.paused) return;
    S.paused = true;
    if (engine() === 'kokoro') send({ cmd: 'pause' }); else send({ cmd: 'stop' });
    ui();
  }
  function resume() {
    if (!S.paused) return;
    if (engine() === 'kokoro') { S.paused = false; send({ cmd: 'resume', id: S.id }); ui(); } else play(S.i, S.w);
  }
  function stop() {
    S.id++; S.playing = false; S.paused = false; send({ cmd: 'stop' });
    idle(); ui();
  }
  function finish() { S.playing = false; S.paused = false; idle(); ui('Finished.'); }
  function idle() {  // the reading ended: clear the marks and go back to the cost of a page where nobody listens
    hlWord && hlWord.clear(); hlSent && hlSent.clear(); undress();
    release(); S.segs = []; S.boxes = []; S.boxesOf = null;
    cancel(natTimer); natOff = false;  // no voice server retry while nobody listens; the next play tries the natural voice
    cancel(noteTimer); note = '';
  }

  function onEvent(m) {
    if (m.evt === 'stopped') { S.id++; if (S.playing) { S.playing = false; S.paused = false; idle(); ui(); } return; }
    if (m.id !== S.id) return;
    if (S.wait && (m.evt === 'tick' || m.evt === 'word')) { S.wait = false; $('pp').classList.remove('waiting'); }  // the voice is heard
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
    else if (m.evt === 'lost') { if (!S.paused) play(S.i, S.w); }  // the audio was gone after a long pause: say it again from this word
    else if (m.evt === 'error') {
      if (engine() === 'kokoro') { ui('The natural voice is not answering. Using the Mac voice for now.'); natOff = true; retryNatural(); play(S.i, S.w); }
      else { stop(); ui(m.why || 'The voice stopped.'); }
    }
  }
  chrome.runtime.onMessage.addListener((m) => {
    if (dead || m.to !== 'page' || (m.tab !== undefined && S.tab !== null && m.tab !== S.tab)) return;
    if (m.evt) onEvent(m);
    else if (m.cmd === 'readSelection') readSelection();
    else if (m.cmd === 'readHere') readAt(lastMenu.x, lastMenu.y);
    else if (m.cmd === 'readPage') readPage();
    else if (m.cmd === 'play-pause') (S.playing && !S.paused ? pause() : S.paused ? resume() : readPage());
    else if (m.cmd === 'back') back();
    else if (m.cmd === 'forward') next();
  });
  on(document, 'ra2-read', (e) => readBlock(e.detail));  // the paste page asks to read its text
  if (location.protocol === 'chrome-extension:') ask({ cmd: 'myTab' }).then((t) => { S.tab = t; });

  // ---------- where to start ----------
  function start(blocks, at, segs) {
    S.segs = segs || segments(blocks); S.follow = true;
    if (!S.segs.length) { ui('No text to read here.'); return; }
    const i = Math.max(0, at(S.segs));
    const first = quick(S.segs[i]); S.segs.splice(i, 1, ...first);
    if (first.length === 1 && first[0].words.length < 6 && S.segs[i + 1]) S.segs.splice(i + 1, 1, ...quick(S.segs[i + 1]));  // a short title: keep the next sentence short too
    play(i, 0);
  }
  // the pointer is on a listen button or a selection: prepare the first sentence, so reading starts at once
  function warm(blocks, at, given, prio = 2) {
    if (S.playing || hiddenHere() || !voiceFor('').startsWith('kokoro:')) return;
    const segs = given || segments(blocks); const i = segs.length ? Math.max(0, at(segs)) : -1;
    if (i < 0) return;
    const v = voiceFor(segs[i].say);  // the voice that play() will choose for this sentence; never into cur: Pause must keep the voice being read
    if (!v.startsWith('kokoro:')) return;
    const first = quick(segs[i]);
    const next = first.length === 1 && first[0].words.length < 6 && segs[i + 1] ? quick(segs[i + 1]) : [segs[i + 1]];
    send({ cmd: 'warm', voice: v.slice(7), prio, texts: [...first, ...next].filter(Boolean).map((x) => x.say).slice(0, 2) });
  }
  const onScreen = (segs) => segs.findIndex((s) => { const r = rangeOf(s.b, s.start, s.end).getBoundingClientRect(); return r.bottom > 60 && r.height > 0; });
  function readPage() {  // from the first sentence on screen, or the top of the article
    start(null, onScreen, pageSegs(root()));
  }
  const inBlock = (el) => (segs) => segs.findIndex((s) => el.contains(s.b.parts[0].node));
  const segsFor = (el) => { const r = root(); return pageSegs(r.contains(el) ? r : document.body); };
  function readBlock(el) { start(null, inBlock(el), segsFor(el)); }
  function readSelection() {
    const sel = getSelection(); if (!sel.rangeCount || !String(sel).trim()) return;
    start(collect(sel.getRangeAt(0).commonAncestorContainer.parentElement || document.body, sel.getRangeAt(0)), () => 0);
    hideBubble();
  }
  function caretAt(x, y) {
    // the open shadow roots of the reading: without them Chrome gives the host, not the word inside it
    const shadowRoots = [...new Set(S.segs.map((s) => s.b.parts[0].node.getRootNode?.()).filter((r) => r && r.host))];
    const c = document.caretPositionFromPoint ? document.caretPositionFromPoint(x, y, { shadowRoots }) : null;
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
    S.segs = segsFor(el); S.follow = true;
    const hit = locate(x, y); if (hit) play(...hit); else readBlock(blockOf(el));
  }
  // the sentence before, as in the reader (jumpTo(index - 1)); the first sentence starts again. A Sentence in pieces
  // counts as one: Previous goes to its first piece, Next goes past its last piece.
  const same = (i, j) => !!S.segs[i]?.of && S.segs[i].of === S.segs[j]?.of;
  const headOf = (i) => { while (i > 0 && same(i, i - 1)) i--; return i; };
  function back() { if (!S.playing) return; play(headOf(Math.max(0, headOf(S.i) - 1))); }
  function next() { if (!S.playing) return; let j = S.i + 1; while (same(j, S.i)) j++; play(j); }

  // ---------- the player (inside a shadow root, so page styles never touch it) ----------
  // The player bar has the look of the reader player bar (ticket 24): previous, play, next, position, speed, follow,
  // settings, and close. A shadow root on another site cannot load the token file of the add-on, so the values that
  // the player uses are copied here, in one block, and set on :host. tests/node/web-player-design.test.mjs fails when
  // a value differs from extension/pdf/tokens.css. No other line of this file holds a colour value.
  // tokens:start
  const TOKENS = {
    root: {
      '--color-surface': '#ffffff', '--color-surface-raised': '#e8eef4', '--color-text': '#0f172a', '--color-text-muted': '#475569',
      '--color-line': '#e2e8f0', '--color-control-border': '#7b8aa0', '--color-hover': 'rgba(15, 23, 42, 0.06)',
      '--color-chrome': '#10233f', '--color-on-chrome': '#ffffff', '--color-chrome-hover': 'rgba(255, 255, 255, 0.14)',
      '--color-play': '#ff8c00', '--color-play-hover': '#ffa033', '--color-on-play': '#0f172a', '--color-progress': '#c25e00',
      '--color-focus': '#3b82f6',
      '--color-word': '#ff8c00', '--color-on-word': '#0f172a', '--color-sentence': 'rgba(255, 140, 0, 0.18)',  // the marks on the page text (content.css)
      '--font-ui': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      '--text-12': '12px', '--leading-12': '16px', '--text-14': '14px', '--leading-14': '20px', '--text-16': '16px', '--leading-16': '24px',
      '--space-1': '4px', '--space-2': '8px', '--space-3': '12px', '--space-4': '16px',
      '--control-s': '32px', '--control-m': '40px', '--control-l': '48px',
      '--radius-1': '8px', '--radius-2': '12px', '--radius-round': '999px',
      '--shadow-3': '0 8px 24px rgba(0, 0, 0, 0.3)',
      '--dur-hover': '100ms', '--dur-move': '200ms', '--dur-spin': '800ms', '--delay-tip': '500ms', '--delay-wait': '300ms',
      '--ease-out': 'cubic-bezier(0.2, 0, 0, 1)',
      '--focus-width': '3px', '--focus-offset': '2px',
    },
    dark: {
      '--color-surface': '#18222d', '--color-surface-raised': '#223140', '--color-text': '#e8eef4', '--color-text-muted': '#a9b8c6',
      '--color-line': '#223140', '--color-control-border': '#5f738a', '--color-hover': 'rgba(255, 255, 255, 0.06)',
      '--color-progress': '#ff8c00', '--color-focus': '#6ea8ff', '--shadow-3': '0 8px 24px rgba(0, 0, 0, 0.5)',
    },
    reduce: { '--dur-hover': '0ms', '--dur-move': '0ms', '--dur-spin': '0ms' },
  };
  // tokens:end
  const vars = (o) => Object.entries(o).map(([k, v]) => `${k}: ${v};`).join(' ');

  // Where the bar is: the owner drags it to the bottom, top, left or right edge of the window (ticket 25). The place is
  // kept in chrome.storage.local, one place for all sites. At the left and right edges the bar is vertical.
  const PLACES = ['bottom', 'top', 'left', 'right'];  // a tie between two edges goes to the first of these
  const PLACE_KEY = 'ra2Place';
  const VERTICAL_MIN = 440;  // a window lower than this (px) has no room for the vertical bar: it shows at the bottom
  const DRAG_START = 6;  // px: a smaller move is a click, so a press on a button still presses it
  function snapPlace(x, y, w, h) {  // the edge of a w × h window that is nearest to the point x, y
    const d = { bottom: h - y, top: y, left: x, right: w - x };
    return PLACES.reduce((a, p) => (d[p] < d[a] ? p : a));
  }
  function fitPlace(place, w, h) {  // the place where the bar shows in a w × h window: the saved place when it fits
    if (!PLACES.includes(place)) return 'bottom';
    return (place === 'left' || place === 'right') && h < VERTICAL_MIN ? 'bottom' : place;
  }
  if (globalThis.ra2Test) globalThis.ra2Test.place = { snapPlace, fitPlace };  // only the Node tests set ra2Test

  const sh = host.attachShadow({ mode: 'closed' });
  const ICON = {
    play: '<path d="M8 5v14l11-7z" fill="currentColor"/>', pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>',
    back: '<path d="M6 6h2v12H6zM9.5 12 18 18V6z" fill="currentColor"/>', fwd: '<path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" fill="currentColor"/>',
    find: '<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="2"/>',
    set: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="2"/>',
    close: '<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    ear: '<path d="M4 14v-2a8 8 0 0 1 16 0v2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="3" y="13" width="5" height="7" rx="2" fill="currentColor"/><rect x="16" y="13" width="5" height="7" rx="2" fill="currentColor"/>',
  };
  const svg = (n) => `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${ICON[n]}</svg>`;
  const RATES = [0.8, 1, 1.2, 1.5, 1.75, 2, 2.5, 3, 3.5, 4];
  const fmtRate = (r) => `${Math.round(r * 100) / 100}×`;
  sh.innerHTML = `<style>
    :host { all: initial; ${vars(TOKENS.root)} }
    @media (prefers-color-scheme: dark) { :host { ${vars(TOKENS.dark)} } }
    @media (prefers-reduced-motion: reduce) { :host { ${vars(TOKENS.reduce)} } }
    * { box-sizing: border-box; font-family: var(--font-ui); }
    button { all: unset; cursor: pointer; display: grid; place-items: center; border-radius: var(--radius-round); color: inherit; transition: background-color var(--dur-hover) var(--ease-out); }
    button:focus-visible, .menu:focus-visible { outline: var(--focus-width) solid var(--color-focus); outline-offset: var(--focus-offset); }
    .bar { position: fixed; left: 50%; bottom: var(--space-4); transform: translateX(-50%); z-index: 2147483647; display: flex; align-items: center; gap: var(--space-2);
           padding: var(--space-1) var(--space-2); background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-line); border-radius: var(--radius-round);
           box-shadow: var(--shadow-3); font-size: var(--text-14); line-height: var(--leading-14); max-width: calc(100vw - 16px);
           cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
    .bar[data-place=top] { top: var(--space-4); bottom: auto; }
    .bar[data-place=left], .bar[data-place=right] { flex-direction: column; top: 50%; bottom: auto; transform: translateY(-50%); padding: var(--space-2) var(--space-1); max-width: none; max-height: calc(100vh - 16px); }
    .bar[data-place=left] { left: var(--space-4); }
    .bar[data-place=right] { left: auto; right: var(--space-4); }
    .bar.dragging { transform: none; right: auto; bottom: auto; cursor: grabbing; }
    .bar[hidden], .launch[hidden], .hover[hidden], .bubble[hidden], .menu[hidden], .rates[hidden] { display: none; }
    .bar button { width: var(--control-m); height: var(--control-m); flex: 0 0 auto; position: relative; }
    .bar button:hover { background: var(--color-hover); }
    .bar button:active { background: var(--color-surface-raised); }
    .bar .pp { width: var(--control-l); height: var(--control-l); background: var(--color-play); color: var(--color-on-play); transition: background-color var(--dur-hover) var(--ease-out), transform var(--dur-hover) var(--ease-out); }
    .bar .pp:hover { background: var(--color-play-hover); }
    .bar .pp:active { background: var(--color-play); transform: scale(0.96); }
    @keyframes ra2-spin { to { transform: rotate(360deg); } }
    .bar .pp::before { content: ""; position: absolute; inset: var(--space-1); border-radius: 50%; border: 3px solid transparent; border-top-color: var(--color-on-play); opacity: 0; pointer-events: none; }
    .bar .pp.waiting::before { opacity: 1; transition: opacity var(--dur-hover) linear var(--delay-wait); animation: ra2-spin var(--dur-spin) linear infinite; }
    @media (prefers-reduced-motion: reduce) { .bar .pp.waiting::before { animation: none; } }
    .bar .find.away { box-shadow: inset 0 0 0 2px var(--color-text); }
    .bar .speed { width: auto; min-width: 56px; padding: 0 var(--space-2); border: 1px solid var(--color-control-border); border-radius: var(--radius-1); font-size: var(--text-14); font-variant-numeric: tabular-nums; }
    .bar .speed[aria-expanded=true], .bar .set[aria-expanded=true] { background: var(--color-surface-raised); }
    .pos { display: flex; flex-direction: column; justify-content: center; gap: var(--space-1); width: 128px; flex: 0 1 auto; min-width: 0; padding: 0 var(--space-1); }
    .prog { height: 4px; border-radius: var(--radius-round); background: var(--color-line); overflow: hidden; }
    .prog i { display: block; height: 100%; width: 0; background: var(--color-progress); }
    .meta { display: flex; gap: var(--space-2); font-size: var(--text-12); line-height: var(--leading-12); color: var(--color-text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; overflow: hidden; }
    .meta span:empty { display: none; }
    .bar[data-place=left] .pos, .bar[data-place=right] .pos { width: auto; padding: 0; align-items: center; }
    .bar[data-place=left] :is(.prog, .left), .bar[data-place=right] :is(.prog, .left) { display: none; }
    .bar [data-tip]::after { content: attr(data-tip); position: absolute; bottom: calc(100% + var(--space-2)); left: 50%; transform: translateX(-50%); padding: var(--space-1) var(--space-2);
           border-radius: var(--radius-1); background: var(--color-chrome); color: var(--color-on-chrome); font-size: var(--text-12); line-height: var(--leading-12); font-weight: 500;
           white-space: nowrap; pointer-events: none; opacity: 0; transition: opacity var(--dur-hover) var(--ease-out); }
    .bar [data-tip]:hover::after, .bar [data-tip]:focus-visible::after { opacity: 1; transition-delay: var(--delay-tip); }
    .bar.dragging [data-tip]::after, .bar:has(.menu:not([hidden]), .rates:not([hidden])) [data-tip]::after { display: none; }
    .bar[data-place=top] [data-tip]::after { bottom: auto; top: calc(100% + var(--space-2)); }
    .bar[data-place=left] [data-tip]::after { bottom: auto; top: 50%; left: calc(100% + var(--space-2)); transform: translateY(-50%); }
    .bar[data-place=right] [data-tip]::after { bottom: auto; top: 50%; left: auto; right: calc(100% + var(--space-2)); transform: translateY(-50%); }
    .msg { position: absolute; bottom: calc(100% + var(--space-2)); left: 50%; transform: translateX(-50%); width: max-content; max-width: min(360px, calc(100vw - 32px));
           background: var(--color-chrome); color: var(--color-on-chrome); padding: var(--space-2) var(--space-3); border-radius: var(--radius-1); font-size: var(--text-14); line-height: var(--leading-14); }
    .msg:empty { display: none; }
    .menu, .rates { position: absolute; bottom: calc(100% + var(--space-2)); right: 0; background: var(--color-surface); color: var(--color-text); border: 1px solid var(--color-line);
           border-radius: var(--radius-2); box-shadow: var(--shadow-3); cursor: auto; z-index: 1; }
    .menu { width: 288px; max-width: calc(100vw - 16px); max-height: 60vh; overflow: auto; padding: var(--space-4); font-size: var(--text-14); line-height: var(--leading-14); }
    .rates { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-1); padding: var(--space-1); }
    .bar[data-place=top] :is(.menu, .rates, .msg) { bottom: auto; top: calc(100% + var(--space-2)); }
    .bar[data-place=left] :is(.menu, .rates, .msg) { bottom: auto; top: 0; right: auto; left: calc(100% + var(--space-2)); transform: none; }
    .bar[data-place=right] :is(.menu, .rates, .msg) { bottom: auto; top: 0; left: auto; right: calc(100% + var(--space-2)); transform: none; }
    .menu h3 { margin: 0 0 var(--space-2); font-size: var(--text-16); line-height: var(--leading-16); }
    .menu h4 { margin: var(--space-3) 0 var(--space-1); font-size: var(--text-12); line-height: var(--leading-12); font-weight: 600; color: var(--color-text-muted); }
    .menu p { margin: 0; color: var(--color-text-muted); }
    .menu button { display: block; width: 100%; height: auto; min-height: var(--control-m); padding: 0 var(--space-3); text-align: left; line-height: var(--control-m); border-radius: var(--radius-1); }
    .menu button.on, .menu button[aria-pressed=true], .rates button[aria-pressed=true] { background: var(--color-surface-raised); font-weight: 700; }
    .places { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-1); }
    .places button { text-align: center; }
    .rates button { min-height: 40px; width: 64px; height: auto; border-radius: var(--radius-1); font-size: var(--text-14); font-variant-numeric: tabular-nums; }
    .launch { position: fixed; right: var(--space-3); top: 50%; z-index: 2147483646; width: var(--control-l); height: var(--control-l); background: var(--color-chrome); color: var(--color-on-chrome); box-shadow: var(--shadow-3); }
    .launch:hover { background: var(--color-play); color: var(--color-on-play); }
    .hover { position: fixed; z-index: 2147483646; width: 32px; height: 32px; background: var(--color-play); color: var(--color-on-play); box-shadow: var(--shadow-3); }
    .hover svg { width: 16px; height: 16px; }
    .bubble { position: fixed; z-index: 2147483647; display: flex; align-items: center; gap: var(--space-2); height: var(--control-m); padding: 0 var(--space-4) 0 var(--space-3);
              background: var(--color-chrome); color: var(--color-on-chrome); font-size: var(--text-14); font-weight: 600; box-shadow: var(--shadow-3); }
    .bubble svg { width: 16px; height: 16px; }
    @media (max-width: 480px) {
      .bar > button { width: var(--control-s); height: var(--control-s); }
      .bar > .pp { width: var(--control-m); height: var(--control-m); }
      .bar { gap: var(--space-1); }
      .pos { width: 64px; }
      .meta .left { display: none; }
    }
    @media print { .bar, .launch, .hover, .bubble { display: none; } }
  </style>
  <div class="bar" id="bar" role="toolbar" aria-label="Read Aloud 2 player" data-place="bottom" hidden>
    <span class="msg" id="msg" role="status"></span>
    <button id="back" aria-label="Previous sentence" data-tip="Previous sentence">${svg('back')}</button>
    <button class="pp" id="pp" aria-label="Pause" data-tip="Play or pause">${svg('pause')}</button>
    <button id="fwd" aria-label="Next sentence" data-tip="Next sentence">${svg('fwd')}</button>
    <div class="pos" id="pos"><div class="prog" aria-hidden="true"><i id="fill"></i></div><div class="meta"><span id="count"></span><span class="left" id="left"></span></div></div>
    <button class="speed" id="speed" aria-label="Speed" aria-haspopup="true" aria-expanded="false" aria-controls="rates" data-tip="Speed">1.2×</button>
    <button class="find" id="find" aria-label="Follow: go to the word being read" data-tip="Follow: go to the word being read">${svg('find')}</button>
    <button class="set" id="set" aria-label="Voice and settings" aria-haspopup="dialog" aria-expanded="false" aria-controls="menu" data-tip="Voice and settings">${svg('set')}</button>
    <button id="close" aria-label="Stop and close" data-tip="Stop and close">${svg('close')}</button>
    <div class="rates" id="rates" role="group" aria-label="Speed" hidden>${RATES.map((r, k) => `<button id="rate-${k}" aria-pressed="false">${fmtRate(r)}</button>`).join('')}</div>
    <div class="menu" id="menu" role="dialog" aria-labelledby="menuTitle" tabindex="-1" hidden>
      <h3 id="menuTitle">Settings</h3>
      <h4>Voice</h4><div id="voices"></div>
      <h4 id="placeHead">Move player</h4>
      <div class="places" role="group" aria-labelledby="placeHead">${['left', 'right', 'top', 'bottom'].map((p) => `<button id="place-${p}" aria-pressed="false">${p[0].toUpperCase() + p.slice(1)}</button>`).join('')}</div>
    </div>
  </div>
  <button class="launch" id="launch" title="Listen to this page (Read Aloud 2)" aria-label="Listen to this page" hidden>${svg('ear')}</button>
  <button class="hover" id="hover" title="Listen from here" aria-label="Listen from here" hidden>${svg('play')}</button>
  <button class="bubble" id="bubble" hidden>${svg('play')}Listen</button>`;
  const $ = (id) => sh.getElementById(id);
  // On <html>, not <body>: a transform or filter on <body> would move the fixed player off the window.
  const attach = () => { if (!dead && !document.documentElement.contains(host)) document.documentElement.appendChild(host); };
  attach();

  let note = '', noteTimer = null;
  function ui(msg) {
    if (msg !== undefined) { note = msg; cancel(noteTimer); noteTimer = later(() => { note = ''; $('msg').textContent = ''; }, 4000); }
    attach();  // a site that rebuilds its page can remove the player
    const active = S.playing || S.paused;
    $('bar').hidden = !active && !note;
    shown($('bar').hidden ? false : true);
    const reading = S.playing && !S.paused;
    $('pp').innerHTML = svg(reading ? 'pause' : 'play'); $('pp').setAttribute('aria-label', reading ? 'Pause' : 'Play');
    $('pp').classList.toggle('waiting', !!S.wait && reading);
    $('speed').textContent = fmtRate(cfg.rate);
    // the count is of Sentences: the pieces of one Sentence count once
    let n = 0, at = 1;
    for (let k = 0; k < S.segs.length; k++) if (!same(k, k - 1)) { n++; if (k <= S.i) at = n; }
    $('count').textContent = n ? `${at} / ${n}` : '';
    $('fill').style.width = n ? `${((at / n) * 100).toFixed(1)}%` : '0%';
    $('left').textContent = n ? timeLeft(Math.max(0, S.i)) : '';
    $('msg').textContent = note;
    $('launch').hidden = active || !cfg.launcher || hiddenHere();
  }
  function timeLeft(at) {  // about 160 words a minute at speed 1
    let words = 0; for (let k = at; k < S.segs.length; k++) words += S.segs[k].words.length;
    const min = words / (160 * cfg.rate);
    return min < 1 ? '< 1 min left' : `${Math.round(min)} min left`;
  }
  const hiddenHere = () => cfg.hidden.includes(location.hostname);
  // mouse only: a key press on a focused player button never starts reading (detail is 0 for keys)
  const click = (id, fn) => $(id).addEventListener('click', (e) => { e.stopPropagation(); if (e.detail && !dragged) fn(e); });
  // a button that opens a list or a panel, or a choice in it: the keyboard can press it too
  const press = (id, fn) => $(id).addEventListener('click', (e) => { e.stopPropagation(); if (!dragged) fn(e); });
  click('pp', () => (S.playing && !S.paused ? pause() : S.paused ? resume() : readPage()));
  click('back', back);
  click('fwd', next);
  click('close', () => { stop(); closePops(); });
  click('launch', readPage);
  // Nothing is prepared before the owner shows that he wants to listen: the pointer on this button is the first sign.
  $('launch').addEventListener('mouseenter', () => warm(null, onScreen, pageSegs(root())));
  click('find', () => {
    S.follow = true; const seg = S.segs[S.i]; const x = seg && seg.words[S.w];
    if (x) { const r = rangeOf(seg.b, x.start, x.end).getBoundingClientRect(); if (r.width || r.height) bringIntoView(r, S.boxes, true); }
    $('find').classList.remove('away');
  });

  // the speed list and the settings panel: one is open at a time; Escape or a press outside closes them
  function openPop(id, btn, e) {
    const open = $(id).hidden;
    closePops();
    if (!open) return;
    $(id).hidden = false; $(btn).setAttribute('aria-expanded', 'true');
    return !e.detail;  // opened with the keyboard: the caller puts the focus in it
  }
  function closePops(focusBack) {
    for (const [id, btn] of [['rates', 'speed'], ['menu', 'set']]) {
      if (!$(id).hidden && focusBack) $(btn).focus?.();
      $(id).hidden = true; $(btn).setAttribute('aria-expanded', 'false');
    }
  }
  press('speed', (e) => {
    const keys = openPop('rates', 'speed', e);
    RATES.forEach((r, k) => $('rate-' + k).setAttribute('aria-pressed', String(Math.abs(r - cfg.rate) < 0.01)));
    if (keys) $('rate-' + Math.max(0, RATES.findIndex((r) => Math.abs(r - cfg.rate) < 0.01))).focus?.();
  });
  closePops();  // both start closed
  RATES.forEach((r, k) => press('rate-' + k, () => { setRate(r); closePops(true); }));
  function setRate(r) {
    cfg.rate = Math.round(r * 100) / 100; save(); ui();
    if (S.playing && !S.paused) { if (engine() === 'kokoro') send({ cmd: 'rate', rate: cfg.rate }); else play(S.i, S.w); }
  }
  press('set', (e) => {
    const keys = openPop('menu', 'set', e);
    if ($('menu').hidden) return;
    menu();
    if (keys) $('menu').focus?.();
  });
  for (const p of PLACES) press('place-' + p, () => setPlace(p, true));

  async function menu() {
    const box = $('voices');
    box.textContent = 'Loading voices…';
    const v = await ask({ cmd: 'voices' });
    if (dead) return;
    box.textContent = '';
    const add = (title, list, prefix) => {
      if (!list.length) return;
      if (title) box.append(Object.assign(document.createElement('h4'), { textContent: title }));
      for (const x of list) {
        const b = document.createElement('button'); const id = prefix + x.id;
        b.textContent = x.label; b.className = cfg.voice === id ? 'on' : '';
        b.addEventListener('click', (e) => {
          e.stopPropagation(); cfg.voice = id; save();
          for (const q of box.childNodes) q.classList?.remove('on');
          b.classList.add('on'); if (S.playing && !S.paused) play(S.i, S.w);
        });
        box.append(b);
      }
    };
    if (!v) { box.textContent = 'The voices did not load. Close and open the settings again.'; return; }
    add('', v.natural, 'kokoro:');
    if (!v.server) box.append(Object.assign(document.createElement('p'), { textContent: 'Natural voices are off: the voice server is not running.' }));
    add('Russian', v.system, 'system:');
  }

  // ---------- moving the player (ticket 25): platform pointer events, no library ----------
  let place = 'bottom', drag = null, dragged = false, showing = false;
  const bar = $('bar');
  function showPlace() {  // the saved place, or the bottom when the window has no room for it
    bar.dataset.place = fitPlace(place, innerWidth, innerHeight);
    for (const p of PLACES) $('place-' + p).setAttribute('aria-pressed', String(p === place));
  }
  // chrome.storage of an old tab after a reload of the add-on: no runtime id, and each call throws. Nothing reaches the page.
  const live = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  function setPlace(p, keep) {
    place = PLACES.includes(p) ? p : 'bottom';
    showPlace();
    if (keep && live()) try { chrome.storage.local.set({ [PLACE_KEY]: place }).catch(() => {}); } catch { /* the add-on is gone */ }
  }
  function readPlace() {
    if (!live()) return;
    try { chrome.storage.local.get(PLACE_KEY).then((r) => { if (!drag && showing) setPlace(r && r[PLACE_KEY], false); }, () => {}); } catch { /* the add-on is gone */ }
  }
  // The place is read and the window is watched only while the bar shows: a page where nobody listens does neither.
  const onResize = () => { if (!dead && !drag) showPlace(); };
  function shown(on) {
    if (on === showing) return;
    showing = on;
    if (on) { showPlace(); readPlace(); addEventListener('resize', onResize, { passive: true }); }
    else { endDrag(); globalThis.removeEventListener?.('resize', onResize); }
  }
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  bar.addEventListener('pointerdown', (e) => {
    dragged = false; drag = null;
    if (dead || e.button !== 0 || e.isPrimary === false || $('menu').contains(e.target) || $('rates').contains(e.target)
      || e.target?.closest?.('input,select,textarea')) return;  // a slider or a field keeps its own drag
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, on: false };
  });
  bar.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!(e.buttons & 1)) { endDrag(); return; }  // the button went up outside the bar: this is a hover, not a drag
    if (!drag.on) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_START) return;
      const r = bar.getBoundingClientRect();
      Object.assign(drag, { on: true, dx: drag.x - r.left, dy: drag.y - r.top, w: r.width, h: r.height });
      try { bar.setPointerCapture(e.pointerId); } catch { /* the pointer is already up */ }
      bar.classList.add('dragging'); closePops();
    }
    bar.style.left = clamp(e.clientX - drag.dx, 0, innerWidth - drag.w) + 'px';
    bar.style.top = clamp(e.clientY - drag.dy, 0, innerHeight - drag.h) + 'px';
  });
  // The end of a press: a drop snaps to an edge and saves the place once; any other end leaves the bar at its old place.
  function endDrag(e, keep) {
    if (!drag || (e && e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    const d = drag; drag = null;
    if (!d.on) return;
    dragged = true; later(() => { dragged = false; }, 0);  // the click that follows the pointerup presses nothing
    const from = bar.getBoundingClientRect();
    bar.classList.remove('dragging'); bar.style.left = ''; bar.style.top = '';
    try { if (bar.hasPointerCapture?.(d.id)) bar.releasePointerCapture(d.id); } catch { /* already released */ }
    if (keep) { setPlace(snapPlace(e.clientX, e.clientY, innerWidth, innerHeight), true); glide(from); } else showPlace();
  }
  bar.addEventListener('pointerup', (e) => endDrag(e, true));
  bar.addEventListener('pointercancel', (e) => endDrag(e, false));
  bar.addEventListener('lostpointercapture', (e) => endDrag(e, false));  // also when the bar hides during a drag
  function glide(from) {  // the bar slides from where it was let go to its edge; no motion when the system asks for none
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !bar.animate) return;
    const to = bar.getBoundingClientRect();
    bar.animate([{ translate: `${from.left - to.left}px ${from.top - to.top}px` }, { translate: '0px 0px' }],
      { duration: parseInt(TOKENS.root['--dur-move'], 10), easing: TOKENS.root['--ease-out'] });
  }

  // play button beside the paragraph under the mouse
  let hoverEl = null;
  on(document, 'mouseover', (e) => {
    if (!cfg.hoverPlay || hiddenHere() || e.target === host) return;
    const t = e.target.closest && e.target.closest('p,li,h1,h2,h3,h4,h5,h6,blockquote,dd,td,figcaption');
    if (!t || (t === hoverEl && !$('hover').hidden)) return;  // a move inside the same paragraph costs nothing
    if (skipped(t, SKIP) || (t.innerText || '').trim().length < 25) return;
    hoverEl = t; const r = t.getBoundingClientRect();
    Object.assign($('hover').style, { left: Math.max(4, r.left - 38) + 'px', top: Math.max(4, r.top + 2) + 'px' });
    $('hover').hidden = false;
  }, { passive: true });
  // An old tab after a reload of the add-on has no runtime id: the call throws at once and gone() removes the player.
  on(globalThis, 'scroll', () => { $('hover').hidden = true; if (!chrome.runtime.id) ask({ cmd: 'ping' }); }, { passive: true });
  $('hover').addEventListener('mouseenter', () => { if (hoverEl) warm(null, inBlock(hoverEl), segsFor(hoverEl)); });
  click('hover', () => { if (hoverEl) readBlock(hoverEl); $('hover').hidden = true; });

  // "Listen" bubble for selected text
  on(document, 'mouseup', (e) => {
    if (e.target === host) return;
    later(() => {
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
  on(document, 'click', (e) => {
    if (e.target !== host) closePops();  // a press outside the player closes its list or panel
    if (!cfg.clickJump || !(S.playing || S.paused) || e.target === host || !e.detail) return;
    const tgt = e.composedPath?.()[0] || e.target;  // in a shadow root: the element clicked, not its host
    if (tgt.closest?.('a,button,input,select,textarea,label,[role=button],[contenteditable]') || String(getSelection()).trim()) return;
    const hit = locate(e.clientX, e.clientY); if (hit) play(...hit);
  }, true);

  // you scroll yourself: the page stops following the voice until you press the target button
  const leave = () => { if (S.playing) S.follow = false; };
  on(globalThis, 'wheel', leave, { passive: true });
  on(globalThis, 'touchmove', leave, { passive: true });
  const typing = (t) => t && (t.isContentEditable || !!t.closest?.('input,textarea,select'));
  on(globalThis, 'keydown', (e) => { if (!typing(e.target) && ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(e.key)) leave(); if (e.key === 'Escape') closePops(true); });
  let lastMenu = { x: innerWidth / 2, y: 80 };
  on(document, 'contextmenu', (e) => {
    lastMenu = { x: e.clientX, y: e.clientY };
    const sel = getSelection();
    if (String(sel).trim() && sel.rangeCount) warm(collect(sel.getRangeAt(0).commonAncestorContainer.parentElement || document.body, sel.getRangeAt(0)), () => 0);
    else { const el = document.elementFromPoint(e.clientX, e.clientY); const b = el && blockOf(el); if (b) warm(null, inBlock(b), segsFor(b)); }
  }, true);

  // settings, shared with the popup
  const save = () => { try { chrome.storage.sync.set({ ra2: cfg }).catch(() => {}); } catch { gone(); } };
  const KNOWN = /^kokoro:(af_heart|am_michael|bf_emma|if_sara)$|^system:/;  // a voice removed from the list falls back to Heart
  chrome.storage.sync.get('ra2').then((r) => { cfg = { ...DEFAULTS, ...(r.ra2 || {}) }; if (!KNOWN.test(cfg.voice)) cfg.voice = DEFAULTS.voice; cur = cfg.voice; ui(); }).catch(() => ui());
  chrome.storage.onChanged.addListener((c) => {
    if (dead) return;
    if (c.ra2) { cfg = { ...DEFAULTS, ...c.ra2.newValue }; ui(); }
    if (c[PLACE_KEY] && showing && !drag) setPlace(c[PLACE_KEY].newValue, false);  // moved in another tab; a hidden bar reads it at its next show
  });
})();
