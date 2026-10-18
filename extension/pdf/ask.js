// Read Aloud 2: Ask Claude about the book you are reading. Each book has a folder (Documents/Read Aloud Library/
// Books/<book>/) with its text (book.md), highlights.md and conversation.md, and its own Claude conversation, kept by
// the voice server. A question sends the page you are on and your question; Claude searches book.md for the rest,
// so the whole book is not sent each time. "(p. 23)" in an answer goes to that page. Answers are read aloud with
// Play / Pause, the word being read is underlined, and a click on a word reads from there. A hostile check (a second,
// separate Claude) tries to prove the book parts of an answer wrong.
const SERVER = location.origin.startsWith('http') ? '' : 'http://127.0.0.1:8793';
const MODELS = { normal: 'Normal (Sonnet)', fast: 'Fast (Haiku)', deep: 'Deep (Opus)' };
const SOURCES = { book: 'Only this book', knowledge: 'Book, then my other books and Claude’s knowledge', web: 'Also search the internet' };
const ICON = { play: '▶', pause: '❚❚' };

export function setupAsk({ state, els, libId, jumpTo, highlights, voice }) {
  const $ = (id) => document.getElementById(id);
  const box = $('ask');
  const pref = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } };
  let st = { folder: '', hasBook: false, turns: [], claude: true };
  let busy = false, selection = '', note = '', loadedFor = null;
  const checking = new Set();
  let model = pref('ra2.askModel', 'normal'), sources = pref('ra2.askSources', 'knowledge');
  let autoCheck = pref('ra2.askCheck', '1') === '1';

  const key = () => libId || state.docKey || '';
  const name = () => (els.docTitle.textContent || 'Book').trim();
  const pageOf = (s) => { const o = s && s.charOwners && s.charOwners.find(Boolean); return o ? o.page : (s && s.page) || 0; };
  const chapterAt = (i) => { let t = ''; for (const s of state.sections || []) if (s.startSentence <= i) t = s.title; return t; };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const post = async (path, body) => {
    let r;
    try { r = await fetch(SERVER + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: key(), name: name(), ...body }) }); }
    catch { throw new Error('the voice server did not answer'); }
    if (!r.ok) throw new Error(r.status === 404 ? 'the voice server is an older version: restart it (or the Read Aloud app)' : `the voice server answered ${r.status}`);
    return r.json();
  };

  // An answer as HTML: paragraphs, "- " lists, **bold**, and page references that jump to the page.
  function format(text) {
    return esc(text).split(/\n{2,}/).map((block) => {
      const lines = block.split('\n');
      const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        .replace(/\(pp?\. ?(\d+)([–-]\d+)?\)/g, (m, p) => `<a href="#" class="pg" data-page="${p}">${m}</a>`);
      if (lines.every((l) => /^\s*([-*•]|\d+\.)\s/.test(l))) return '<ul>' + lines.map((l) => `<li>${inline(l.replace(/^\s*([-*•]|\d+\.)\s/, ''))}</li>`).join('') + '</ul>';
      return `<p>${inline(lines.join('<br>'))}</p>`;
    }).join('');
  }

  // ---------- reading an answer aloud ----------
  // The answer's visible text is the source: words are found in it, read in pieces of up to about 900 characters
  // (whole sentences), and underlined with the CSS Highlight API, so the answer's HTML is never changed.
  const hl = typeof Highlight === 'function' && CSS.highlights ? new Highlight() : null;
  if (hl) CSS.highlights.set('ra2-ask-word', hl);
  const rd = { id: '', el: null, nodes: [], text: '', pos: 0, playing: false, token: 0 };
  function mapText(el) {  // the element's text, and where each text node starts in it
    const nodes = []; let text = '';
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let block = null;
    for (let n; (n = w.nextNode());) {
      const b = n.parentElement.closest('p, li, div');
      if (block && b !== block) text += '\n';  // a new paragraph or list item: a break the voice and the splitter see
      block = b; nodes.push({ n, at: text.length }); text += n.data;
    }
    return { nodes, text };
  }
  function rangeAt(a, b) {
    const at = (off) => { let k = rd.nodes.length - 1; while (k > 0 && rd.nodes[k].at > off) k--; const x = rd.nodes[k]; return [x.n, Math.min(off - x.at, x.n.data.length)]; };
    const r = document.createRange();
    try { r.setStart(...at(a)); r.setEnd(...at(b)); } catch { /* the answer was redrawn */ }
    return r;
  }
  function pieceFrom(p) {  // [p, end) of whole sentences, about 900 characters at most
    const t = rd.text; let end = p;
    const re = /[.!?](["')\]]*)(\s+|$)|\n/g; re.lastIndex = p;
    for (let m; (m = re.exec(t));) { const e = m.index + m[0].length; if (e - p > 900 && end > p) break; end = e; if (e - p > 400) break; }
    return end > p ? end : Math.min(t.length, p + 900);
  }
  // what the voice says for a piece: page references read as words; idx maps each spoken character to the answer text
  function spoken(a, b) {
    const src = rd.text.slice(a, b); let say = '', idx = [];
    const re = /\(pp?\. ?(\d+)(?:[–-](\d+))?\)|❚❚|▶/g; let last = 0;
    for (let m; (m = re.exec(src));) {
      for (let k = last; k < m.index; k++) { say += src[k]; idx.push(a + k); }
      const rep = m[1] ? `(page ${m[1]}${m[2] ? ' to ' + m[2] : ''})` : '';
      for (const ch of rep) { say += ch; idx.push(a + m.index); }
      last = m.index + m[0].length;
    }
    for (let k = last; k < src.length; k++) { say += src[k]; idx.push(a + k); }
    return { say, idx };
  }
  function readFrom(p) {
    const token = ++rd.token;
    while (p < rd.text.length && /\s/.test(rd.text[p])) p++;
    if (p >= rd.text.length) { finishReading(); return; }
    const end = pieceFrom(p), { say, idx } = spoken(p, end);
    rd.pos = p; rd.playing = true; buttons();
    voice.say(say, {
      onWord: (c, len) => {
        if (token !== rd.token) return;
        const a = idx[c] ?? p, b = (idx[Math.min(c + Math.max(len, 1), idx.length) - 1] ?? a) + 1;
        rd.pos = a;
        if (hl) { hl.clear(); hl.add(rangeAt(a, b)); }
      },
      onEnd: () => { if (token === rd.token && rd.playing) readFrom(end); },
      onError: () => { if (token === rd.token) { rd.playing = false; buttons(); note = 'The voice could not read the answer.'; } },
    });
  }
  function startReading(id, el, p = 0) {
    if (rd.id !== id || rd.el !== el) { const m = mapText(el); Object.assign(rd, { id, el, nodes: m.nodes, text: m.text, pos: 0 }); }
    readFrom(p);
  }
  function pauseReading() { rd.token++; rd.playing = false; voice.hush(); buttons(); }
  function finishReading() { rd.token++; rd.playing = false; rd.pos = 0; rd.id = ''; if (hl) hl.clear(); buttons(); }
  function buttons() {  // the Play / Pause labels, without redrawing the answers
    const bar = $('askPlayer');
    if (bar) {
      bar.hidden = !rd.id;
      const what = rd.id ? (rd.id[0] === 'c' ? 'Hostile check of answer ' : 'Answer ') + (Number(rd.id.slice(1)) + 1) : '';
      bar.querySelector('.ap-what').textContent = what;
      const pp = bar.querySelector('#apPlay');
      pp.textContent = rd.playing ? ICON.pause : ICON.play;
      pp.setAttribute('aria-label', rd.playing ? 'Pause' : 'Play');
    }
    for (const b of box.querySelectorAll('button.say')) {
      const on = b.dataset.id === rd.id && rd.playing;
      b.textContent = on ? `${ICON.pause} Pause` : (b.dataset.id === rd.id && rd.pos ? `${ICON.play} Go on reading` : `${ICON.play} Read aloud`);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  // ---------- the panel ----------
  // under each answer: Read aloud, the hostile check (button, "checking…", or its result with its own Read aloud)
  const extra = (t, i) => `<div class="note-tools"><button type="button" class="rename say" data-id="a${i}">${ICON.play} Read aloud</button>${t.check || checking.has(i) ? '' : ` · <button type="button" class="rename" data-check="${i}">Hostile check</button>`}</div>
      ${checking.has(i) ? '<p class="ask-busy" role="status">A second Claude is checking this answer against the book…</p>' : ''}
      ${t.check ? `<div class="check"><p class="check-h">Hostile check</p><div class="readable" data-id="c${i}">${format(t.check)}</div>
        <div class="note-tools"><button type="button" class="rename say" data-id="c${i}">${ICON.play} Read aloud</button></div></div>` : ''}`;
  function paintExtra(i) {  // only the part under answer i, so an answer being read is not interrupted
    const el = box.querySelector(`.turn-extra[data-i="${i}"]`);
    if (!el || (rd.el && el.contains(rd.el))) { if (!rd.playing) paint(); return; }
    el.innerHTML = extra(st.turns[i], i); buttons();
  }
  // the question box grows with what you type (up to half the panel), and keeps your words when the panel is redrawn
  let draft = '';
  function grow(q) { q.style.height = 'auto'; q.style.height = Math.max(130, Math.min(q.scrollHeight + 2, box.clientHeight * 0.5)) + 'px'; }
  box.addEventListener('input', (e) => { if (e.target.id === 'askQ') { draft = e.target.value; grow(e.target); } });
  function paint() {
    if (rd.playing) pauseReading();
    rd.id = ''; rd.el = null; if (hl) hl.clear();
    if (!key()) { box.innerHTML = '<p class="notes-empty">Open a book to ask questions about it.</p>'; return; }
    if (!st.claude) { box.innerHTML = '<p class="notes-empty">Claude Code was not found on this Mac. Install it, then open the book again.</p>'; return; }
    const turns = st.turns.map((t, i) => `<div class="turn"><p class="q">${esc(t.q)}<small>page ${esc(t.page)}${t.chapter ? ' · ' + esc(t.chapter) : ''}${t.sources ? ' · ' + esc(SOURCES[t.sources] || '') : ''}</small></p>
      <div class="a readable" data-id="a${i}">${format(t.a)}</div><div class="turn-extra" data-i="${i}">${extra(t, i)}</div></div>`).join('');
    box.innerHTML = `<div class="ask-top">
      <div class="ask-row"><select id="askModel" aria-label="Claude model">${Object.entries(MODELS).map(([k, v]) => `<option value="${k}" ${k === model ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <select id="askSources" aria-label="Sources">${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}" ${k === sources ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <label class="ask-opt"><input type="checkbox" id="askCheck" ${autoCheck ? 'checked' : ''}> Hostile check of every answer (a second Claude tries to prove the book parts wrong)</label>
      <div class="note-tools"><button type="button" class="rename" id="askContinue">Continue in Claude (Terminal)</button> · <button type="button" class="rename" id="askConv">Open the whole conversation</button> · <button type="button" class="rename" id="askOpen">Open the book folder</button> · <button type="button" class="rename" id="askNew">New conversation</button></div></div>
      <div class="turns" id="askTurns">${turns || '<p class="notes-empty">Ask about anything in this book. Claude answers from the book first and gives the pages. Select words on the page and press “Ask Claude” to ask about them. While an answer is read, click any word in it to read from there.</p>'}</div>
      <div class="ask-player" id="askPlayer" hidden><span class="ap-what"></span>
        <button type="button" id="apBack" title="Back to the start of the answer" aria-label="Back to the start">⏮</button>
        <button type="button" id="apPlay" class="ap-pp" aria-label="Play">${ICON.play}</button>
        <button type="button" id="apStop" title="Stop reading" aria-label="Stop reading">■</button></div>
      ${busy ? `<p class="ask-busy" role="status">Claude is reading the book… <span id="askSecs">0</span> s</p>` : ''}
      ${note ? `<p class="kp-note" role="status">${esc(note)}</p>` : ''}
      ${selection ? `<p class="ask-sel">About: “${esc(selection.length > 160 ? selection.slice(0, 160) + '…' : selection)}” <button type="button" class="rename" id="askNoSel">×</button></p>` : ''}
      <textarea id="askQ" rows="5" placeholder="Your question. Type or dictate. Enter to ask, Shift+Enter for a new line." ${busy ? 'disabled' : ''}></textarea>
      <button type="button" class="btn ask-go" id="askGo" ${busy ? 'disabled' : ''}>Ask Claude</button>`;
    const t = $('askTurns'); t.scrollTop = t.scrollHeight;
    const q = $('askQ'); q.value = draft; grow(q);
  }

  async function refresh() {
    if (!key()) { paint(); return; }
    try { st = await (await fetch(`${SERVER}/ask/status?key=${encodeURIComponent(key())}&name=${encodeURIComponent(name())}`, { cache: 'no-store' })).json(); }
    catch { note = 'The voice server does not answer, so questions cannot be asked now.'; }
    loadedFor = key(); paint();
  }

  // The book's text, page by page, sent once; after that Claude reads it from the folder.
  async function sendBook() {
    const pages = new Map();
    for (const s of state.sentences) { const p = pageOf(s); pages.set(p, (pages.get(p) ? pages.get(p) + '\n\n' : '') + s.text); }
    const sections = (state.sections || []).map((s) => ({ title: s.title, page: s.page || pageOf(state.sentences[s.startSentence]) }));
    await post('/ask/book', { sections, pages: [...pages].map(([page, text]) => ({ page, text })) });
    st.hasBook = true;
  }

  async function check(i) {
    if (checking.has(i)) return;
    checking.add(i); paintExtra(i);
    try {
      const r = await post('/ask/check', { i, model });
      if (r.error) note = 'The check did not finish: ' + r.error; else st.turns[i].check = r.check;
    } catch (err) { note = 'The check did not finish: ' + err.message + '.'; }
    checking.delete(i); paintExtra(i);
    if (note) { const n = box.querySelector('.kp-note'); if (!n && !rd.playing) paint(); }
  }

  async function ask(question) {
    question = question.trim();
    if (!question || busy || !state.sentences.length) return;
    busy = true; note = ''; draft = ''; paint();
    const t0 = Date.now(), tick = setInterval(() => { const e = $('askSecs'); if (e) e.textContent = Math.round((Date.now() - t0) / 1000); }, 1000);
    try {
      if (!st.hasBook) await sendBook();
      const i = state.index, cur = state.sentences[i];
      const passage = [state.sentences[i - 1], cur].filter(Boolean).map((s) => s.text).join('\n\n').slice(-3000);
      const r = await post('/ask', { question, page: pageOf(cur), chapter: chapterAt(i), passage, selection, highlights: highlights(), model, sources });
      if (r.error) note = 'No answer: ' + r.error;
      else { st.turns.push(r.turn); st.folder = r.folder; selection = ''; }
    } catch (err) { note = 'No answer: ' + err.message + '.'; }
    clearInterval(tick); busy = false; paint();
    if (note) { draft = question; const q = $('askQ'); q.value = question; grow(q); }
    else if (autoCheck) check(st.turns.length - 1);
  }

  box.addEventListener('keydown', (e) => {
    if (e.target.id === 'askQ' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(e.target.value); }
  });
  // Space plays or pauses the answer being read (not the book) while one is open
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || !rd.id || e.target.matches('input, select, textarea')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (rd.playing) pauseReading(); else readFrom(rd.pos);
  }, true);
  box.addEventListener('change', (e) => {
    if (e.target.id === 'askModel') { model = e.target.value; setPref('ra2.askModel', model); }
    if (e.target.id === 'askSources') { sources = e.target.value; setPref('ra2.askSources', sources); }
    if (e.target.id === 'askCheck') { autoCheck = e.target.checked; setPref('ra2.askCheck', autoCheck ? '1' : '0'); }
  });
  box.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.id === 'askGo') ask($('askQ').value);
    else if (t.id === 'askNoSel') { selection = ''; paint(); }
    else if (t.id === 'askContinue' || t.id === 'askConv') {
      try { await post(t.id === 'askContinue' ? '/ask/continue' : '/ask/conversation', {}); note = t.id === 'askContinue' ? 'Terminal opens this book’s conversation in Claude Code. Type there to go on; the next question here continues the same conversation.' : ''; }
      catch (err) { note = 'Could not open it: ' + err.message + '.'; }
      paint();
    } else if (t.id === 'askOpen') { const r = await post('/ask/open', {}).catch(() => null); if (!r) { note = 'The voice server did not answer.'; paint(); } }
    else if (t.id === 'askNew') { await post('/ask/new', {}).catch(() => {}); note = 'The next question starts a new conversation. The old one stays in conversation.md.'; paint(); }
    else if (t.dataset.check !== undefined) check(Number(t.dataset.check));
    else if (t.id === 'apPlay') { if (rd.playing) pauseReading(); else if (rd.id) readFrom(rd.pos); }
    else if (t.id === 'apBack') { if (rd.id) readFrom(0); }
    else if (t.id === 'apStop') { voice.hush(); finishReading(); }
    else if (t.classList.contains('say')) {
      const el = box.querySelector(`.readable[data-id="${t.dataset.id}"]`);
      if (rd.id === t.dataset.id && rd.playing) pauseReading();
      else if (rd.id === t.dataset.id) readFrom(rd.pos);
      else startReading(t.dataset.id, el, 0);
    } else if (t.classList.contains('pg')) {
      e.preventDefault();
      const i = state.sentences.findIndex((s) => pageOf(s) >= Number(t.dataset.page));
      if (i >= 0) jumpTo(i, { resume: false });
    } else if (t.closest('.readable') && !String(getSelection()).trim()) {  // a click on a word: read from that word
      const el = t.closest('.readable');
      const c = document.caretPositionFromPoint ? document.caretPositionFromPoint(e.clientX, e.clientY) : null;
      const r = !c && document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
      const node = c ? c.offsetNode : r && r.startContainer, off = c ? c.offset : r ? r.startOffset : 0;
      if (rd.el !== el) { const m = mapText(el); Object.assign(rd, { id: el.dataset.id, el, nodes: m.nodes, text: m.text, pos: 0 }); }
      const x = rd.nodes.find((y) => y.n === node);
      if (!x) return;
      let p = x.at + off;
      while (p > 0 && !/\s/.test(rd.text[p - 1])) p--;  // the start of the word
      readFrom(p);
    }
  });

  // the panel on the right side of the page; its width is dragged at its left edge and remembered
  const pane = $('askPane');
  pane.style.width = Math.max(340, Math.min(Number(pref('ra2.askWidth', 520)), innerWidth - 300)) + 'px';
  function show() {
    pane.hidden = false; $('askTab').classList.add('on');
    note = '';
    const focus = () => { const q = $('askQ'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } };
    if (loadedFor !== key()) refresh().then(focus); else { paint(); focus(); }
  }
  function hide() { if (rd.playing) pauseReading(); pane.hidden = true; $('askTab').classList.remove('on'); }
  $('askTab').addEventListener('click', () => (pane.hidden ? show() : hide()));
  $('askClose').addEventListener('click', hide);
  $('askGrip').addEventListener('pointerdown', (e) => {
    e.preventDefault(); $('askGrip').setPointerCapture(e.pointerId);
    const move = (m) => { pane.style.width = Math.max(340, Math.min(innerWidth - m.clientX, innerWidth - 300)) + 'px'; };
    const up = () => { $('askGrip').removeEventListener('pointermove', move); setPref('ra2.askWidth', parseInt(pane.style.width, 10)); };
    $('askGrip').addEventListener('pointermove', move); $('askGrip').addEventListener('pointerup', up, { once: true });
  });
  // "Ask Claude" in the bar that appears over selected text
  document.addEventListener('ra2-ask', (e) => { selection = String(e.detail || '').replace(/\s+/g, ' ').trim().slice(0, 2000); show(); });

  let hlTimer = null;
  return {
    reload() { finishReading(); loadedFor = null; st = { folder: '', hasBook: false, turns: [], claude: true }; if (!pane.hidden) refresh(); },
    stopReading() { if (rd.playing || rd.id) finishReading(); },  // Play in the player goes back to the book
    highlightsChanged() {  // keep highlights.md in the book's folder up to date
      clearTimeout(hlTimer);
      hlTimer = setTimeout(() => { if (st.folder && key()) post('/ask/highlights', { highlights: highlights() }).catch(() => {}); }, 2000);
    },
  };
}
