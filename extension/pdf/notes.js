// Read Aloud 2: highlights. Underline what matters while you listen, sort it into groups, and jump back to it.
// A highlight is a piece of the reader's own text ({ si: sentence, a..b: characters }), so it is drawn exactly
// where those characters sit on the page, and it survives zoom. A library book keeps its highlights in a file
// next to it (Documents/Read Aloud Library/.notes/<id>.json); a PDF opened in Chrome keeps them in the browser.
const COLORS = ['yellow', 'green', 'blue', 'pink'];
const DEFAULT_NAMES = { yellow: 'Important', green: 'Idea', blue: 'Question', pink: 'Review' };

export function setupNotes({ state, viewer, els, jumpTo, wordPartsAt, libId }) {
  let notes = [];
  let filter = 'all';
  let names = { ...DEFAULT_NAMES, ...(load('ra2.groups') || {}) };
  let lastColor = load('ra2.lastColor') || 'yellow';
  const $ = (id) => document.getElementById(id);

  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
  function keep(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked */ } }
  const fp = (t) => (t || '').replace(/\s+/g, ' ').trim().slice(0, 60);

  // ---------- storage ----------
  async function read() {
    if (libId) {
      try { return await (await fetch(`/library/${libId}/notes`, { cache: 'no-store' })).json(); } catch { return []; }
    }
    return load('ra2.notes.' + state.docKey) || [];
  }
  function write() {
    const data = JSON.stringify(notes);
    if (libId) fetch(`/library/${libId}/notes`, { method: 'POST', body: data, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
    else keep('ra2.notes.' + state.docKey, notes);
  }

  // A highlight remembers its sentence's first words: if the document is read again with other options
  // (citations kept, captions read), the sentence numbers move and the words find it again.
  function where(n) {
    const s = state.sentences[n.si];
    if (s && fp(s.text) === n.fp) return n.si;
    for (let step = 1; step < state.sentences.length; step++) {
      for (const k of [n.si - step, n.si + step]) if (state.sentences[k] && fp(state.sentences[k].text) === n.fp) return k;
    }
    return -1;
  }

  function draw() {
    const marks = [];
    for (const n of notes) {
      const parts = [];
      for (const seg of n.segs) {
        const si = where({ si: seg.si, fp: seg.fp });
        if (si >= 0) parts.push(...wordPartsAt(state.sentences[si], seg.a, seg.b - seg.a));
      }
      marks.push({ id: n.id, color: n.color, parts });
    }
    viewer.setMarks(marks);
    list();
  }

  function add(segs, color) {
    if (!segs.length) return;
    const text = segs.map((g) => state.sentences[g.si].text.slice(g.a, g.b)).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) return;
    const first = state.sentences[segs[0].si];
    const own = first.charOwners && first.charOwners[segs[0].a];
    notes.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), color, text, page: own ? own.page : 0, t: Date.now(),
      segs: segs.map((g) => ({ ...g, fp: fp(state.sentences[g.si].text) })) });
    notes.sort((x, y) => (x.segs[0].si - y.segs[0].si) || (x.segs[0].a - y.segs[0].a));
    lastColor = color; keep('ra2.lastColor', color);
    write(); draw();
  }

  // ---------- 1. the sentence being read: the marker button in the player bar ----------
  function markReading() {
    const s = state.sentences[state.index];
    if (!s) return;
    const at = Math.max(0, Math.min(state.at || 0, s.text.length - 1));
    const t = s.text;
    let a = 0;
    for (const m of t.slice(0, at).matchAll(/[.!?]["'”’)]?\s+/g)) a = m.index + m[0].length;
    const m = /[.!?]["'”’)]?(\s|$)/.exec(t.slice(at));
    const b = m ? at + m.index + m[0].trimEnd().length : t.length;
    add([{ si: state.index, a, b }], lastColor);
    flash('Highlighted');
  }

  // ---------- 2. text selected with the mouse: a small bar with the groups ----------
  const bar = document.createElement('div');
  bar.className = 'selbar'; bar.hidden = true;
  document.body.appendChild(bar);
  function paintBar() {
    bar.innerHTML = COLORS.map((c) => `<button type="button" data-c="${c}"><span class="dot ${c}"></span>${esc(names[c])}</button>`).join('');
  }
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function locate(node, offset, isEnd) {  // a point in the page's text -> { si, c } in the reader's text
    const el = node.nodeType === 3 ? node.parentElement : node;
    const span = el && el.closest('.text-layer span');
    if (!span) return null;
    const n = Number(span.closest('.page').dataset.page);
    const entry = viewer.pages.get(n);
    let item = null;
    for (const [k, s] of entry.spans) if (s === span) { item = k; break; }
    if (item === null) return null;
    const si0 = state.itemToSentence.get(`${n}:${item}`);
    if (si0 === undefined) return null;
    for (let k = si0; k < Math.min(state.sentences.length, si0 + 6); k++) {
      const ow = state.sentences[k].charOwners || [];
      const c = isEnd ? ow.findLastIndex((o) => o && o.page === n && o.item === item && o.offset < offset)
                      : ow.findIndex((o) => o && o.page === n && o.item === item && o.offset >= offset);
      if (c >= 0) return { si: k, c };
    }
    return null;
  }
  function selectionSegs() {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return [];
    const r = sel.getRangeAt(0);
    const s = locate(r.startContainer, r.startOffset, false), e = locate(r.endContainer, r.endOffset, true);
    if (!s || !e || e.si < s.si) return [];
    const segs = [];
    for (let k = s.si; k <= e.si; k++) {
      const len = state.sentences[k].text.length;
      segs.push({ si: k, a: k === s.si ? s.c : 0, b: k === e.si ? e.c + 1 : len });
    }
    return segs.filter((g) => g.b > g.a);
  }
  els.pages.addEventListener('mouseup', () => setTimeout(() => {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed || !String(sel).trim()) { bar.hidden = true; return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    paintBar();
    bar.hidden = false;
    bar.style.left = Math.max(8, Math.min(innerWidth - bar.offsetWidth - 8, r.left + r.width / 2 - bar.offsetWidth / 2)) + 'px';
    bar.style.top = Math.max(8, r.top - 50) + 'px';
  }, 10));
  bar.addEventListener('mousedown', (e) => e.preventDefault());  // keep the selection while clicking the bar
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-c]'); if (!b) return;
    add(selectionSegs(), b.dataset.c);
    getSelection().removeAllRanges(); bar.hidden = true;
  });
  document.addEventListener('mousedown', (e) => { if (!bar.contains(e.target)) bar.hidden = true; });

  // ---------- 3. the Highlights list in the side bar ----------
  function list() {
    const box = $('notes');
    const shown = notes.filter((n) => filter === 'all' || n.color === filter);
    $('notesTab').textContent = `Highlights (${notes.length})`;
    box.innerHTML = `<div class="note-filter"><button type="button" data-f="all" class="${filter === 'all' ? 'on' : ''}">All</button>${
      COLORS.map((c) => `<button type="button" data-f="${c}" class="${filter === c ? 'on' : ''}"><span class="dot ${c}"></span>${esc(names[c])}</button>`).join('')
    }</div>`;
    if (!shown.length) {
      box.insertAdjacentHTML('beforeend', `<p class="notes-empty">${notes.length ? 'No highlights in this group.'
        : 'No highlights yet. Select text on the page and choose a group, or press the marker button while it reads.'}</p>`);
    }
    for (const n of shown) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'note'; b.dataset.color = n.color;
      b.innerHTML = `${esc(n.text.length > 220 ? n.text.slice(0, 220) + '…' : n.text)}<small>${esc(names[n.color])} · page ${n.page}</small><span class="del" role="button" title="Delete this highlight" aria-label="Delete this highlight">×</span>`;
      b.addEventListener('click', (e) => {
        if (e.target.closest('.del')) {
          notes = notes.filter((x) => x !== n); write(); draw(); return;
        }
        const si = where(n.segs[0]);
        if (si < 0) return;
        jumpTo(si, { resume: false });
        const t = state.sentences[si].text; let a = n.segs[0].a;
        while (a > 0 && !/\s/.test(t[a - 1])) a--;
        state.from = a;  // Play starts at the highlight, not at the top of its paragraph
      });
      box.appendChild(b);
    }
    box.insertAdjacentHTML('beforeend', '<button type="button" class="rename" id="renameGroups">Rename groups</button>');
  }
  $('notes').addEventListener('click', (e) => {
    const f = e.target.closest('[data-f]');
    if (f) { filter = f.dataset.f; list(); return; }
    if (e.target.id === 'renameGroups') {
      for (const c of COLORS) {
        const v = prompt(`Name for the ${c} group:`, names[c]);
        if (v && v.trim()) names[c] = v.trim().slice(0, 24);
      }
      keep('ra2.groups', names); list();
    }
  });
  const tab = (which) => {
    $('contentsTab').classList.toggle('on', which === 'toc'); $('notesTab').classList.toggle('on', which === 'notes');
    els.toc.hidden = which !== 'toc'; $('notes').hidden = which !== 'notes';
  };
  $('contentsTab').addEventListener('click', () => tab('toc'));
  $('notesTab').addEventListener('click', () => { tab('notes'); els.sidebar.hidden = false; });
  $('markBtn').addEventListener('click', (e) => { if (e.detail) markReading(); });

  function flash(t) {
    const b = $('markBtn'); const old = b.title; b.title = t; b.classList.add('flash');
    setTimeout(() => { b.classList.remove('flash'); b.title = old; }, 700);
  }

  return {
    async reload() { notes = await read(); draw(); },  // after a document is read (or read again)
  };
}
