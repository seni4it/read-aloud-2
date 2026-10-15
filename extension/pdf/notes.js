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
  let showMarks = load('ra2.showMarks') !== false;  // the switch in the Highlights tab
  const $ = (id) => document.getElementById(id);
  // Key points: highlights in one group go to a Claude conversation's folder (key-points/<book>.md) through the
  // voice server, as they are made or on request, and can be copied as a message. The server keeps the choice.
  const SERVER = location.origin.startsWith('http') ? '' : 'http://127.0.0.1:8793';
  let kp = { sessions: [], setting: { session: '', title: '', cwd: '', group: 'yellow', auto: false }, ok: false, note: '' };
  const bookName = () => (document.getElementById('docTitle')?.textContent || document.title.replace(/ · Read Aloud 2$/, '')).trim();
  async function kpLoad() {
    try {
      const r = await (await fetch(SERVER + '/claude/sessions', { cache: 'no-store' })).json();
      kp.sessions = r.sessions || []; kp.setting = { ...kp.setting, ...(r.setting || {}) }; kp.ok = true;
    } catch { kp.ok = false; }
  }
  async function kpSave(patch) {
    kp.setting = { ...kp.setting, ...patch };
    try { await fetch(SERVER + '/claude/setting', { method: 'POST', body: JSON.stringify(patch), headers: { 'Content-Type': 'application/json' } }); } catch { /* server off */ }
  }
  const unsent = () => notes.filter((n) => n.color === kp.setting.group && !n.sent);
  async function kpSend(list) {
    if (!list.length) { kp.note = 'Nothing new to send.'; return list; }
    try {
      const r = await (await fetch(SERVER + '/claude/send', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: list.map((n) => ({ book: bookName(), page: n.page, text: n.text, id: n.id })) }) })).json();
      if (r.error) { kp.note = 'Not sent: ' + r.error; return []; }
      for (const n of list) n.sent = Date.now();
      kp.note = `${list.length} key point${list.length === 1 ? '' : 's'} saved to ${(r.files || [])[0] || 'the folder'}.`;
      write(); return list;
    } catch { kp.note = 'Not sent: the voice server did not answer.'; return []; }
  }

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
    viewer.setMarks(showMarks ? marks : []);
    list();
  }

  function add(segs, color) {
    if (!segs.length) return;
    const text = segs.map((g) => state.sentences[g.si].text.slice(g.a, g.b)).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) return;
    // the same text saved twice (the marker pressed twice on one sentence) is kept once
    if (notes.some((n) => n.segs.length === segs.length && n.segs.every((g, i) => g.si === segs[i].si && g.a === segs[i].a && g.b === segs[i].b))) return;
    const first = state.sentences[segs[0].si];
    const own = first.charOwners && first.charOwners[segs[0].a];
    notes.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), color, text, page: own ? own.page : 0, t: Date.now(),
      segs: segs.map((g) => ({ ...g, fp: fp(state.sentences[g.si].text) })) });
    notes.sort((x, y) => (x.segs[0].si - y.segs[0].si) || (x.segs[0].a - y.segs[0].a));
    lastColor = color; keep('ra2.lastColor', color);
    write(); draw();
    const made = notes.find((n) => n.text === text && n.color === color && !n.sent);
    if (made && kp.ok && kp.setting.auto && kp.setting.cwd && color === kp.setting.group) kpSend([made]).then(list);
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
    const same = notes.find((n) => n.segs.length === 1 && n.segs[0].si === state.index && n.segs[0].a === a && n.segs[0].b === b);
    if (same) { remove(same); flash('Highlight removed'); return; }  // pressed again: take it off
    add([{ si: state.index, a, b }], lastColor);
    flash('Highlighted');
  }

  function remove(n) { notes = notes.filter((x) => x !== n); write(); draw(); }

  // ---------- a click on an underline: a small bar to remove it or move it to another group ----------
  const markBar = document.createElement('div');
  markBar.className = 'selbar'; markBar.hidden = true;
  document.body.appendChild(markBar);
  let markHide = null;
  els.pages.addEventListener('click', (e) => {
    if (String(getSelection()).trim()) return;
    const hit = [...els.pages.querySelectorAll('.mark-box')].find((b) => {
      const r = b.getBoundingClientRect();
      return e.clientX >= r.left - 6 && e.clientX <= r.right + 6 && e.clientY >= r.top - 6 && e.clientY <= r.bottom + 6;  // a generous target
    });
    if (!hit) { markBar.hidden = true; return; }
    const n = notes.find((x) => x.id === hit.dataset.id);
    if (!n) return;
    markBar.innerHTML = `<button type="button" data-act="remove">✕ Remove underline</button>` +
      COLORS.filter((c) => c !== n.color).map((c) => `<button type="button" data-act="${c}"><span class="dot ${c}"></span>${esc(names[c])}</button>`).join('');
    markBar.dataset.id = n.id;
    markBar.hidden = false;
    const r = hit.getBoundingClientRect();
    markBar.style.left = Math.max(8, Math.min(innerWidth - markBar.offsetWidth - 8, r.left)) + 'px';
    markBar.style.top = Math.max(8, r.top - 50) + 'px';
    clearTimeout(markHide); markHide = setTimeout(() => { markBar.hidden = true; }, 6000);
  });
  markBar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const n = notes.find((x) => x.id === markBar.dataset.id);
    if (n && b.dataset.act === 'remove') remove(n);
    else if (n) { n.color = b.dataset.act; write(); draw(); }
    markBar.hidden = true;
  });
  document.addEventListener('mousedown', (e) => { if (!markBar.contains(e.target) && !els.pages.contains(e.target)) markBar.hidden = true; });

  // ---------- 2. text selected with the mouse: a small bar with the groups ----------
  const bar = document.createElement('div');
  bar.className = 'selbar'; bar.hidden = true;
  document.body.appendChild(bar);
  function paintBar() {
    bar.innerHTML = COLORS.map((c) => `<button type="button" data-c="${c}"><span class="dot ${c}"></span>${esc(names[c])}</button>`).join('')
      + '<button type="button" data-c="remove">✕ Remove underlines</button>';
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
  // Copy (Cmd+C) gives the reader's own text, not the PDF's raw text layer: the raw layer has no space at the end of a
  // line ("filecannot"), a fake-bold word drawn twice ("OOnnccee aa ffiillee") and words run together. The reader's
  // sentences have those repaired. Where the selection has no sentence (a caption that is skipped), the raw text is
  // cleaned as far as it can be.
  function undouble(t) {
    return t.replace(/\S{4,}/g, (w) => {
      if (w.length % 2) return w;
      for (let i = 0; i < w.length; i += 2) if (w[i] !== w[i + 1]) return w;
      let out = ''; for (let i = 0; i < w.length; i += 2) out += w[i];
      return out;
    });
  }
  document.addEventListener('copy', (e) => {
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    if (!els.pages.contains(r.commonAncestorContainer)) return;  // text in the side bar copies as it is
    const segs = selectionSegs();
    let text = segs.map((g) => state.sentences[g.si].text.slice(g.a, g.b)).join(' ').replace(/\s+/g, ' ').trim();
    if (!text) text = undouble(String(sel)).replace(/-\n(?=[a-z])/g, '').replace(/\s*\n\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) return;
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  });
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
    if (b.dataset.c === 'remove') {  // every underline that touches the selected text goes, however roughly it was selected
      const sel = selectionSegs();
      const touches = (n) => n.segs.some((g) => { const si = where(g); return sel.some((s) => s.si === si && s.a < g.b && g.a < s.b); });
      const before = notes.length;
      notes = notes.filter((n) => !touches(n));
      if (notes.length !== before) { write(); draw(); }
    } else add(selectionSegs(), b.dataset.c);
    getSelection().removeAllRanges(); bar.hidden = true;
  });
  document.addEventListener('mousedown', (e) => { if (!bar.contains(e.target)) bar.hidden = true; });

  // ---------- 3. the Highlights list in the side bar ----------
  function list() {
    const box = $('notes');
    const shown = notes.filter((n) => filter === 'all' || n.color === filter);
    $('notesTab').textContent = `Highlights (${notes.length})`;
    box.innerHTML = `<label class="show-marks"><input type="checkbox" id="showMarks" ${showMarks ? 'checked' : ''}> Show highlights on the page</label><div class="note-filter"><button type="button" data-f="all" class="${filter === 'all' ? 'on' : ''}">All</button>${
      COLORS.map((c) => `<button type="button" data-f="${c}" class="${filter === c ? 'on' : ''}"><span class="dot ${c}"></span>${esc(names[c])}</button>`).join('')
    }</div>`;
    if (!shown.length) {
      box.insertAdjacentHTML('beforeend', `<p class="notes-empty">${notes.length ? 'No highlights in this group.'
        : 'No highlights yet. Select text on the page and choose a group, or press the marker button while it reads.'}</p>`);
    }
    for (const n of shown) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'note'; b.dataset.color = n.color;
      b.innerHTML = `${esc(n.text.length > 220 ? n.text.slice(0, 220) + '…' : n.text)}<small>${esc(names[n.color])} · page ${n.page}${n.sent ? ' · ✓ sent' : ''}</small><span class="del" role="button" title="Delete this highlight" aria-label="Delete this highlight">×</span>`;
      b.addEventListener('click', (e) => {
        if (e.target.closest('.del')) { remove(n); return; }
        const si = where(n.segs[0]);
        if (si < 0) return;
        jumpTo(si, { resume: false });
        const t = state.sentences[si].text; let a = n.segs[0].a;
        while (a > 0 && !/\s/.test(t[a - 1])) a--;
        state.from = a;  // Play starts at the highlight, not at the top of its paragraph
      });
      box.appendChild(b);
    }
    box.insertAdjacentHTML('beforeend', '<div class="note-tools"><button type="button" class="rename" id="exportMd">Export as Markdown (.md)</button> · <button type="button" class="rename" id="copyMd">Copy for Claude</button> · <button type="button" class="rename" id="renameGroups">Rename groups</button></div>');
    if (kp.ok) {
      const st = kp.setting, n = unsent().length;
      const opts = kp.sessions.map((x) => `<option value="${esc(x.id)}" ${x.id === st.session ? 'selected' : ''}>${esc(x.title)}</option>`).join('');
      box.insertAdjacentHTML('beforeend', `<details class="keypts" ${st.cwd ? 'open' : ''}><summary>Key points to Claude${n ? ` (${n} new)` : ''}</summary>
        <label>Conversation <select id="kpSession"><option value="">(choose)</option>${opts}</select></label>
        <label>Group <select id="kpGroup">${COLORS.map((c) => `<option value="${c}" ${c === st.group ? 'selected' : ''}>${esc(names[c])}</option>`).join('')}</select></label>
        <label><input type="checkbox" id="kpAuto" ${st.auto ? 'checked' : ''}> Send each one as I mark it</label>
        <div class="note-tools"><button type="button" class="rename" id="kpSend">Send new now</button> · <button type="button" class="rename" id="kpCopy">Copy new as a message</button></div>
        <p class="kp-note">${esc(kp.note || (st.cwd ? `They go to key-points/ in ${st.cwd}. In that conversation, say: read the key-points folder.` : 'Choose the conversation that works on the lecture.'))}</p></details>`);
    }
  }
  $('notes').addEventListener('change', (e) => {
    if (e.target.id === 'showMarks') { showMarks = e.target.checked; keep('ra2.showMarks', showMarks); draw(); }
    if (e.target.id === 'kpSession') {
      const x = kp.sessions.find((y) => y.id === e.target.value);
      kpSave(x ? { session: x.id, title: x.title, cwd: x.cwd } : { session: '', title: '', cwd: '' }).then(list);
    }
    if (e.target.id === 'kpGroup') kpSave({ group: e.target.value }).then(list);
    if (e.target.id === 'kpAuto') kpSave({ auto: e.target.checked }).then(list);
  });
  // the highlights as Markdown: by group, in book order, with page numbers; good to hand to Claude
  function markdown() {
    const book = (document.getElementById('docTitle')?.textContent || document.title.replace(/ · Read Aloud 2$/, '')).trim();
    const lines = [`# Highlights from “${book}”`, '', `${notes.length} highlights, exported ${new Date().toLocaleDateString()} with Read Aloud 2.`, ''];
    for (const c of COLORS) {
      const group = notes.filter((n) => n.color === c);
      if (!group.length) continue;
      lines.push(`## ${names[c]} (${group.length})`, '');
      for (const n of group) lines.push(`- ${n.text.replace(/\s+/g, ' ').trim()} *(p. ${n.page})*`);
      lines.push('');
    }
    return lines.join('\n');
  }
  $('notes').addEventListener('click', (e) => {
    if (e.target.id === 'exportMd') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([markdown()], { type: 'text/markdown' }));
      a.download = (document.getElementById('docTitle')?.textContent || 'book').trim().replace(/[\\/:*?"<>|]/g, ' ').slice(0, 80) + ' - highlights.md';
      document.body.appendChild(a); a.click(); a.remove(); return;
    }
    if (e.target.id === 'kpSend') { kpSend(unsent()).then(list); return; }
    if (e.target.id === 'kpCopy') {  // the new key points as one message to paste into the conversation
      const list_ = unsent();
      if (!list_.length) { kp.note = 'Nothing new to copy.'; list(); return; }
      const msg = [`Key points I marked as important in "${bookName()}" (Read Aloud 2). Add each one where it fits and say what you did with it.`, '',
        ...list_.map((n) => `- ${n.text.replace(/\s+/g, ' ').trim()}${n.page ? ` (p. ${n.page})` : ''}`)].join('\n');
      navigator.clipboard.writeText(msg).then(() => { for (const n of list_) n.sent = Date.now(); write(); kp.note = `${list_.length} copied. Paste into the conversation.`; list(); },
        () => { kp.note = 'Could not copy.'; list(); });
      return;
    }
    if (e.target.id === 'copyMd') {
      navigator.clipboard.writeText(markdown()).then(() => flash('Copied'), () => alert('Could not copy.'));
      e.target.textContent = 'Copied'; setTimeout(() => { e.target.textContent = 'Copy for Claude'; }, 1500); return;
    }
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
    async reload() {  // after a document is read (or read again); exact duplicates are kept once
      if (!kp.ok) await kpLoad();
      const seen = new Set(), all = await read();
      notes = all.filter((n) => { const k = JSON.stringify(n.segs.map((g) => [g.si, g.a, g.b])); return !seen.has(k) && seen.add(k); });
      if (notes.length !== all.length) write();
      draw();
    },
  };
}
