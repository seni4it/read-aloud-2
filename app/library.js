// Read Aloud 2 desktop library: the owner's Books as a shelf. Books live in ~/Documents/Read Aloud Library
// (voice-server.py); the reading position comes from the reader (localStorage "ra2.lib.<id>").
// Ticket 23: the page opens on "Continue listening" (the Book read last), then the other Books. The rules (clean
// title, status text, order, the Continue choice) are in library-model.js, which the page loads first.
(() => {
  const M = globalThis.LibraryModel;
  const $ = (id) => document.getElementById(id);
  const OFFLINE = 'The voice server is not running. Open the Read Aloud app again.';
  let books = null;          // null until the first answer of the voice server
  let offline = false;
  let loads = 0;             // each load has a number; an answer of an older load is dropped
  const store = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const progressOf = (b) => store('ra2.lib.' + b.id);
  const status = (t) => { $('status').textContent = t || ''; };
  const readerUrl = (b) => `/reader/index.html?lib=${b.id}&name=${encodeURIComponent(b.name)}&file=${encodeURIComponent('/library/file/' + b.id)}`;

  // a small element maker: h('div', { className: 'x' }, child, 'text')
  function h(tag, props = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k.startsWith('aria-') || k === 'role') el.setAttribute(k, v); else el[k] = v;
    }
    el.append(...kids.filter((k) => k !== null && k !== undefined));
    return el;
  }

  async function load() {
    const mine = ++loads;
    if (!books) placeholders();
    let list;
    try {
      const r = await fetch('/library.json', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      list = await r.json();
    } catch {
      if (mine !== loads) return;
      offline = true; show(); return;
    }
    if (mine !== loads) return;  // a newer load started: this answer can be old (a removed Book can be in it)
    offline = false; books = Array.isArray(list) ? list : [];
    show();
    // audio export (MP3 files): ask one time per load, not on each search keystroke
    const shown = books;
    const asked = await Promise.all(shown.map(async (b) => {
      try { b.exp = await (await fetch(`/library/${b.id}/export`, { cache: 'no-store' })).json(); return true; }
      catch { return false; }
    }));
    if (mine === loads && asked.some(Boolean)) show();
  }

  // While the list loads: six grey cards in the place of the Books.
  function placeholders() {
    for (const id of ['empty', 'offline', 'continue', 'noMatch', 'shelfHead']) $(id).hidden = true;
    $('grid').setAttribute('aria-busy', 'true');
    $('grid').replaceChildren(...Array.from({ length: 6 }, () => h('div', { className: 'book skeleton', 'aria-hidden': 'true' },
      h('div', { className: 'card' }, h('div', { className: 'cover' }), h('div', { className: 'meta' }, h('div', { className: 'line' }), h('div', { className: 'line short' }))))));
  }

  function show() {
    const q = $('search').value.trim();
    $('offline').hidden = !offline;
    $('grid').setAttribute('aria-busy', 'false');
    if (offline) {
      $('continue').hidden = true; $('empty').hidden = true; $('noMatch').hidden = true; $('shelfHead').hidden = true;
      $('grid').replaceChildren();
      return;
    }
    const all = books || [];
    $('empty').hidden = all.length > 0;
    const cont = q ? null : M.pickContinue(all, progressOf);
    $('continue').hidden = !cont;
    if (cont) $('continue').replaceChildren(...continueBlock(cont));
    else $('continue').replaceChildren();
    const list = M.sortBooks(all.filter((b) => b !== cont && M.matches(b, q)), $('sort').value, progressOf);
    $('shelfHead').hidden = !list.length;
    $('shelfTitle').textContent = cont ? 'Other books' : 'Your books';
    $('noMatch').hidden = !(q && all.length && !list.length);
    $('noMatch').textContent = `No book matches “${q}”.`;
    $('grid').replaceChildren(...list.map(card));
  }

  // A cover picture; a cover that is not made yet is tried again every 4 s, at most 5 tries, only while it is on the page.
  function coverOf(b) {
    const cover = h('div', { className: 'cover' }, 'PDF');
    const img = new Image();
    img.onload = () => { cover.textContent = ''; cover.style.backgroundImage = `url(${img.src})`; };
    let tries = 1;
    img.onerror = () => {
      if (b.cover || tries >= 5 || !cover.isConnected) return;
      setTimeout(() => { if (cover.isConnected) { tries++; img.src = `/library/cover/${b.id}?r=${Date.now()}`; } }, 4000);
    };
    img.src = `/library/cover/${b.id}`;
    return cover;
  }

  const bar = (p) => { const i = h('i'); i.style.width = M.percent(p) + '%'; return h('div', { className: 'bar', 'aria-hidden': 'true' }, i); };

  function continueBlock(b) {
    const p = progressOf(b), title = M.cleanTitle(b.name);
    const cover = h('a', { className: 'cover-link', href: readerUrl(b), tabIndex: -1, 'aria-hidden': 'true' }, coverOf(b));
    return [
      cover,
      h('div', { className: 'info' },
        h('p', { className: 'kicker' }, 'Where you stopped'),
        h('h2', { className: 'big-title', title: b.file || b.name }, title),
        bar(p),
        h('p', { className: 'sub' }, M.statusText(p)),
        h('a', { className: 'btn large', href: readerUrl(b) }, 'Continue listening')),
    ];
  }

  function card(b) {
    const p = progressOf(b), title = M.cleanTitle(b.name);
    const audio = h('p', { className: 'audio', hidden: true });
    const st = b.exp;
    if (st && (st.state === 'running' || st.state === 'starting')) { audio.textContent = `Making audio ${st.total ? Math.round((st.done / st.total) * 100) : 0}%`; audio.hidden = false; }
    else if (st && st.state === 'done' && Array.isArray(st.files)) { audio.textContent = `Audio: ${st.files.length} MP3s`; audio.hidden = false; }
    const open = h('a', { className: 'open card', href: readerUrl(b), title: b.file || b.name },
      coverOf(b),
      h('div', { className: 'meta' }, h('div', { className: 'title' }, title), bar(p), h('p', { className: 'sub' }, M.statusText(p)), audio));
    const rm = h('button', { className: 'remove', type: 'button', title: 'Remove from the library', 'aria-label': `Remove “${title}” from the library` }, '×');
    rm.addEventListener('click', () => remove(b, title));
    return h('article', { className: 'book' }, open, rm);
  }

  async function remove(b, title) {
    if (!confirm(`Remove “${title}” from the library? The book goes to the Trash.`)) return;
    let ok = false;
    try { ok = (await fetch(`/library/${b.id}/remove`, { method: 'POST' })).ok; }
    catch { status(`Could not remove “${title}”. ${OFFLINE}`); return; }
    status(ok ? `Removed “${title}”.` : `Could not remove “${title}”.`);
    load();
  }

  async function add(files) {
    const pdfs = [...files].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (!pdfs.length) { status('Only PDFs can be added.'); return; }
    const failed = [];
    for (const [k, f] of pdfs.entries()) {
      status(`Adding ${f.name} (${k + 1} of ${pdfs.length})…`);
      let ok = false;
      try { ok = (await fetch('/library/add?name=' + encodeURIComponent(f.name), { method: 'POST', body: f })).ok; }
      catch { status(`Could not add ${f.name}. ${OFFLINE}`); return; }
      if (!ok) failed.push(f.name);
    }
    const added = pdfs.length - failed.length;
    status(failed.length ? `Could not add ${failed.join(', ')}.` + (added ? ` Added ${added} of ${pdfs.length}.` : '')
      : pdfs.length === 1 ? 'Added.' : `Added ${pdfs.length} books.`);
    $('sort').value = 'added';
    load();
  }

  const pick = () => $('file').click();
  $('add').addEventListener('click', pick);
  $('emptyAdd').addEventListener('click', pick);
  $('retry').addEventListener('click', () => load());
  $('file').addEventListener('change', (e) => { add(e.target.files); e.target.value = ''; });
  $('search').addEventListener('input', show);
  $('sort').addEventListener('change', () => { try { localStorage.setItem('ra2.sort', $('sort').value); } catch {} show(); });
  try { $('sort').value = localStorage.getItem('ra2.sort') || 'opened'; } catch {}
  let depth = 0;
  addEventListener('dragenter', (e) => { e.preventDefault(); if (++depth === 1) $('veil').classList.add('on'); });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('veil').classList.remove('on'); } });
  addEventListener('drop', (e) => { e.preventDefault(); depth = 0; $('veil').classList.remove('on'); add(e.dataTransfer.files); });
  addEventListener('focus', load);  // back from the reader, or a PDF added in Finder
  globalThis.RA2LibraryReload = load;
  load();
})();

// ---------- the More menu: Restart the voice server, YouTube uploads ----------
(() => {
  const $ = (id) => document.getElementById(id);
  const more = $('moreBtn'), menu = $('moreMenu'), wrap = $('moreWrap');
  const items = () => [$('restartBtn'), $('ytBtn')];
  const setOpen = (on, { focus = false } = {}) => {
    menu.hidden = !on;
    more.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on && focus) items()[0].focus();
    if (!on && focus) more.focus();
  };
  more.addEventListener('click', () => setOpen(menu.hidden));
  more.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true, { focus: true }); }
    else if (e.key === 'Escape' && !menu.hidden) { e.preventDefault(); setOpen(false, { focus: true }); }
  });
  // Tab, or a click on another control: the focus leaves the menu and its button, so the menu closes
  wrap.addEventListener('focusout', (e) => { if (!menu.hidden && !(e.relatedTarget && wrap.contains(e.relatedTarget))) setOpen(false); });
  menu.addEventListener('keydown', (e) => {
    const list = items(), at = list.indexOf(e.target);
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false, { focus: true }); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(at + 1) % list.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(at - 1 + list.length) % list.length].focus(); }
  });
  addEventListener('click', (e) => { if (!menu.hidden && e.target && e.target.closest && !e.target.closest('.more')) setOpen(false); });

  // Restart the voice server, then wait for it. The messages go to the status line, so they stay when the menu closes.
  const LABEL = 'Restart the voice server';
  const status = (t) => { $('status').textContent = t; };
  $('restartBtn').addEventListener('click', async () => {
    const b = $('restartBtn'); setOpen(false, { focus: true }); b.disabled = true;
    status('Restarting the voice server…'); b.textContent = 'Restarting…';
    try {
      const { restartServer } = await import('/reader/restart.js');
      const ok = await restartServer(() => {});
      status(ok ? 'The voice server is running again.' : 'The voice server did not start again. Quit Read Aloud and open it again.');
      if (ok && globalThis.RA2LibraryReload) globalThis.RA2LibraryReload();
    } catch {
      status('The restart of the voice server did not work. Press More, then Restart the voice server, to try again.');
    } finally {
      setTimeout(() => { b.textContent = LABEL; b.disabled = false; }, 2500);
    }
  });

  // ---------- YouTube: send the MP3 chapters to a private channel ----------
  const panel = $('yt');
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  async function show() {
    let st; try { st = await (await fetch('/youtube/status', { cache: 'no-store' })).json(); } catch { $('ytState').textContent = 'The voice server is not running. Open the Read Aloud app again.'; return; }
    $('ytState').textContent = st.connected ? `Connected to channel “${st.channel}”. ${st.pending} chapter(s) waiting, ${st.done} sent.${st.paused_until > Date.now() / 1000 ? ' Google’s daily limit is reached; uploads continue later by themselves.' : ''}`
      : st.secret ? 'The key file is in place. Now press “Connect to YouTube”.' : 'Not set up yet. Read “How to set it up”, then choose the key file.';
    $('ytConnect').hidden = !st.secret || st.connected; $('ytDisconnect').hidden = !st.connected; $('ytAuto').checked = st.auto !== false;
    $('ytQueue').replaceChildren(...(st.items || []).slice().reverse().map((i) => {
      const li = document.createElement('li');
      li.textContent = `${i.book} · ${String(i.k).padStart(2, '0')} ${i.title} · ${i.state}${i.error ? ' (' + i.error + ')' : ''} `;
      if (i.video) { const a = document.createElement('a'); a.href = 'https://youtu.be/' + i.video; a.target = '_blank'; a.textContent = 'open'; li.append(a); }
      return li;
    }));
  }
  $('ytBtn').addEventListener('click', () => {
    setOpen(false);
    panel.hidden = false; show();
    if (panel.scrollIntoView) panel.scrollIntoView({ block: 'nearest' });
    $('ytClose').focus();
  });
  $('ytClose').addEventListener('click', () => { panel.hidden = true; more.focus(); });
  $('ytSecret').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    let key;
    try { key = JSON.parse(await f.text()); }
    catch { $('ytState').textContent = 'That is not the key file from Google.'; return; }
    try {
      const r = await post('/youtube/secret', key);
      $('ytState').textContent = r.ok ? 'Key file saved.' : 'That is not the key file from Google.';
    } catch { $('ytState').textContent = 'The voice server is not running. Open the Read Aloud app again.'; return; }
    show();
  });
  $('ytConnect').addEventListener('click', () => { window.open('/youtube/auth', '_blank'); setTimeout(show, 15000); });
  $('ytDisconnect').addEventListener('click', async () => { if (confirm('Disconnect YouTube?')) { await post('/youtube/disconnect'); show(); } });
  $('ytAuto').addEventListener('change', () => post('/youtube/setting', { auto: $('ytAuto').checked }));
  setInterval(() => { if (!panel.hidden) show(); }, 20000);
})();
