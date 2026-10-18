// Read Aloud 2: Ask Claude about the book you are reading. Each book has a folder (Documents/Read Aloud Library/
// Books/<book>/) with its text (book.md), highlights.md and conversation.md, and its own Claude conversation, kept by
// the voice server. A question sends the page you are on and your question; Claude searches book.md for the rest,
// so the whole book is not sent each time. Answers can be read aloud, and "(p. 23)" in an answer goes to that page.
const SERVER = location.origin.startsWith('http') ? '' : 'http://127.0.0.1:8793';
const MODELS = { normal: 'Normal (Sonnet)', fast: 'Fast (Haiku)', deep: 'Deep (Opus)' };

export function setupAsk({ state, els, libId, jumpTo, highlights, speakText }) {
  const $ = (id) => document.getElementById(id);
  const box = $('ask');
  let st = { folder: '', hasBook: false, turns: [], claude: true };
  let busy = false, selection = '', note = '', loadedFor = null;
  let model = (() => { try { return localStorage.getItem('ra2.askModel') || 'normal'; } catch { return 'normal'; } })();

  const key = () => libId || state.docKey || '';
  const name = () => (els.docTitle.textContent || 'Book').trim();
  const pageOf = (s) => { const o = s && s.charOwners && s.charOwners.find(Boolean); return o ? o.page : (s && s.page) || 0; };
  const chapterAt = (i) => { let t = ''; for (const s of state.sections || []) if (s.startSentence <= i) t = s.title; return t; };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const post = async (path, body) => (await fetch(SERVER + path, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: key(), name: name(), ...body }) })).json();

  // An answer as HTML: paragraphs, "- " lists, **bold**, and page references that jump to the page.
  function format(text) {
    return esc(text).split(/\n{2,}/).map((block) => {
      const lines = block.split('\n');
      const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
        .replace(/\(pp?\. ?(\d+)([–-]\d+)?\)/g, (m, p) => `<a href="#" class="pg" data-page="${p}">${m}</a>`);
      if (lines.every((l) => /^\s*([-*•]|\d+\.)\s/.test(l))) return '<ul>' + lines.map((l) => `<li>${inline(l.replace(/^\s*([-*•]|\d+\.)\s/, ''))}</li>`).join('') + '</ul>';
      return `<p>${inline(lines.join('<br>'))}</p>`;
    }).join('');
  }
  const plain = (t) => t.replace(/\*\*/g, '').replace(/^\s*[-*•]\s/gm, '').replace(/\(pp?\. ?(\d+)[–-]?(\d+)?\)/g, (m, a, b) => `(page ${a}${b ? ' to ' + b : ''})`);

  function paint() {
    if (!key()) { box.innerHTML = '<p class="notes-empty">Open a book to ask questions about it.</p>'; return; }
    if (!st.claude) { box.innerHTML = '<p class="notes-empty">Claude Code was not found on this Mac. Install it, then open the book again.</p>'; return; }
    const turns = st.turns.map((t, i) => `<div class="turn"><p class="q">${esc(t.q)}<small>page ${esc(t.page)}${t.chapter ? ' · ' + esc(t.chapter) : ''}</small></p>
      <div class="a">${format(t.a)}</div><button type="button" class="rename say" data-i="${i}">Read this answer aloud</button></div>`).join('');
    box.innerHTML = `<div class="turns" id="askTurns">${turns || '<p class="notes-empty">Ask about anything in this book. Claude answers from the book first and gives the pages. Select words on the page and press “Ask Claude” to ask about them.</p>'}</div>
      ${busy ? `<p class="ask-busy" role="status">Claude is reading the book… <span id="askSecs">0</span> s</p>` : ''}
      ${note ? `<p class="kp-note" role="status">${esc(note)}</p>` : ''}
      ${selection ? `<p class="ask-sel">About: “${esc(selection.length > 160 ? selection.slice(0, 160) + '…' : selection)}” <button type="button" class="rename" id="askNoSel">×</button></p>` : ''}
      <textarea id="askQ" rows="3" placeholder="Your question (Enter to ask, Shift+Enter for a new line)" ${busy ? 'disabled' : ''}></textarea>
      <div class="ask-row"><button type="button" class="btn small" id="askGo" ${busy ? 'disabled' : ''}>Ask Claude</button>
        <select id="askModel" aria-label="Claude model">${Object.entries(MODELS).map(([k, v]) => `<option value="${k}" ${k === model ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div class="note-tools"><button type="button" class="rename" id="askOpen">Open the book folder</button> · <button type="button" class="rename" id="askNew">New conversation</button></div>`;
    const t = $('askTurns'); t.scrollTop = t.scrollHeight;
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

  async function ask(question) {
    question = question.trim();
    if (!question || busy || !state.sentences.length) return;
    busy = true; note = ''; paint();
    const t0 = Date.now(), tick = setInterval(() => { const e = $('askSecs'); if (e) e.textContent = Math.round((Date.now() - t0) / 1000); }, 1000);
    try {
      if (!st.hasBook) await sendBook();
      const i = state.index, cur = state.sentences[i];
      const passage = [state.sentences[i - 1], cur].filter(Boolean).map((s) => s.text).join('\n\n').slice(-3000);
      const r = await post('/ask', { question, page: pageOf(cur), chapter: chapterAt(i), passage, selection, highlights: highlights(), model });
      if (r.error) note = 'No answer: ' + r.error;
      else { st.turns.push(r.turn); st.folder = r.folder; selection = ''; }
    } catch { note = 'No answer: the voice server did not answer.'; }
    clearInterval(tick); busy = false; paint();
    if (note) $('askQ').value = question;
  }

  box.addEventListener('keydown', (e) => {
    if (e.target.id === 'askQ' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(e.target.value); }
  });
  box.addEventListener('change', (e) => {
    if (e.target.id === 'askModel') { model = e.target.value; try { localStorage.setItem('ra2.askModel', model); } catch {} }
  });
  box.addEventListener('click', async (e) => {
    const t = e.target;
    if (t.id === 'askGo') ask($('askQ').value);
    else if (t.id === 'askNoSel') { selection = ''; paint(); }
    else if (t.id === 'askOpen') { const r = await post('/ask/open', {}).catch(() => null); if (!r) { note = 'The voice server did not answer.'; paint(); } }
    else if (t.id === 'askNew') { await post('/ask/new', {}).catch(() => {}); note = 'The next question starts a new conversation. The old one stays in conversation.md.'; paint(); }
    else if (t.classList.contains('say')) speakText(plain(st.turns[Number(t.dataset.i)].a));
    else if (t.classList.contains('pg')) {
      e.preventDefault();
      const i = state.sentences.findIndex((s) => pageOf(s) >= Number(t.dataset.page));
      if (i >= 0) jumpTo(i, { resume: false });
    }
  });

  const tabs = ['contentsTab', 'notesTab', 'askTab'];
  function show() {
    for (const id of tabs) $(id).classList.toggle('on', id === 'askTab');
    els.toc.hidden = true; $('notes').hidden = true; box.hidden = false;
    els.sidebar.hidden = false; els.sidebar.classList.add('asking');
    if (loadedFor !== key()) refresh(); else paint();
    setTimeout(() => $('askQ')?.focus(), 0);
  }
  $('askTab').addEventListener('click', show);
  for (const id of ['contentsTab', 'notesTab']) $(id).addEventListener('click', () => { box.hidden = true; els.sidebar.classList.remove('asking'); $('askTab').classList.remove('on'); });
  // "Ask Claude" in the bar that appears over selected text
  document.addEventListener('ra2-ask', (e) => { selection = String(e.detail || '').replace(/\s+/g, ' ').trim().slice(0, 2000); show(); });

  let hlTimer = null;
  return {
    reload() { loadedFor = null; st = { folder: '', hasBook: false, turns: [], claude: true }; if (!box.hidden) refresh(); },
    highlightsChanged() {  // keep highlights.md in the book's folder up to date
      clearTimeout(hlTimer);
      hlTimer = setTimeout(() => { if (st.folder && key()) post('/ask/highlights', { highlights: highlights() }).catch(() => {}); }, 2000);
    },
  };
}
