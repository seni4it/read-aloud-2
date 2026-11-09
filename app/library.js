// Read Aloud 2 desktop library: your PDFs as a shelf, like Speechify's library. Books live in
// ~/Documents/Read Aloud Library (voice-server.py); progress comes from the reader (localStorage "ra2.lib.<id>").
(() => {
  const $ = (id) => document.getElementById(id);
  let books = [];
  const store = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
  const status = (t) => { $('status').textContent = t || ''; };
  const day = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
  const when = (s) => {
    if (!s) return 'Not opened yet';
    const d = new Date(s * 1000), today = new Date();
    if (d.toDateString() === today.toDateString()) return 'Read today';
    return 'Read ' + day.format(d);
  };

  async function load() {
    try { books = await (await fetch('/library.json', { cache: 'no-store' })).json(); }
    catch { status('The Read Aloud server is not running. Open the Read Aloud app again.'); return; }
    show();
    // audio export (MP3 files): ask one time per load, not on each search keystroke
    const asked = await Promise.all(books.map(async (b) => {
      try { b.exp = await (await fetch(`/library/${b.id}/export`, { cache: 'no-store' })).json(); return true; }
      catch { return false; }
    }));
    if (asked.some(Boolean)) show();
  }

  function show() {
    const q = $('search').value.trim().toLowerCase();
    const by = $('sort').value;
    const list = books.filter((b) => !q || b.name.toLowerCase().includes(q))
      .sort((a, b) => by === 'name' ? a.name.localeCompare(b.name) : (b[by] || 0) - (a[by] || 0) || (b.added - a.added));
    $('empty').hidden = books.length > 0;
    $('grid').replaceChildren(...list.map(card));
  }

  function card(b) {
    const el = document.createElement('div');
    el.className = 'book'; el.tabIndex = 0; el.setAttribute('role', 'button');
    el.setAttribute('aria-label', 'Open ' + b.name);
    const p = store('ra2.lib.' + b.id);
    const pct = p && p.total ? Math.round(((p.i + 1) / p.total) * 100) : 0;
    el.innerHTML = `<div class="cover"></div><div class="meta"><div class="title"></div>
      <div class="bar"><i style="width:${pct}%"></i></div><div class="sub"><span></span><span></span></div></div>
      <button class="remove" type="button" title="Remove from library" aria-label="Remove from library">×</button>`;
    el.querySelector('.title').textContent = b.name;
    const [left, right] = el.querySelectorAll('.sub span');
    const min = p && Number.isFinite(p.minLeft) ? Math.round(p.minLeft) : null;
    const left0 = min === null ? '' : min < 60 ? `${Math.max(1, min)} min left` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min left`;
    left.textContent = pct ? `${pct}% read · ${left0}` : 'Not started';
    right.textContent = when(b.opened);
    const cover = el.querySelector('.cover');
    const img = new Image();
    img.onload = () => { cover.style.backgroundImage = `url(${img.src})`; };
    // a cover that is not made yet: try again every 4 s, at most 5 tries, and only while the card is on the page
    let tries = 1;
    img.onerror = () => {
      cover.textContent = 'PDF';
      if (b.cover || tries >= 5 || !el.isConnected) return;
      setTimeout(() => { if (el.isConnected) { tries++; img.src = `/library/cover/${b.id}?r=${Date.now()}`; } }, 4000);
    };
    img.src = `/library/cover/${b.id}`;
    const open = () => { location.href = `/reader/index.html?lib=${b.id}&name=${encodeURIComponent(b.name)}&file=${encodeURIComponent('/library/file/' + b.id)}`; };
    el.addEventListener('click', (e) => { if (!e.target.closest('.remove')) open(); });
    // audio export (MP3 files) in progress or ready: a line on the card (the state comes from load())
    const st = b.exp;
    if (st && (st.state === 'running' || st.state === 'starting')) right.textContent = `Making audio ${st.total ? Math.round((st.done / st.total) * 100) : 0}%`;
    else if (st && st.state === 'done' && Array.isArray(st.files)) right.textContent = `Audio: ${st.files.length} MP3s`;
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === el) open(); });
    el.querySelector('.remove').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`Remove “${b.name}” from the library? The file goes to the Trash.`)) return;
      await fetch(`/library/${b.id}/remove`, { method: 'POST' });
      load();
    });
    return el;
  }

  async function add(files) {
    const pdfs = [...files].filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (!pdfs.length) { status('Only PDF files can be added.'); return; }
    const failed = [];
    for (const [k, f] of pdfs.entries()) {
      status(`Adding ${f.name} (${k + 1} of ${pdfs.length})…`);
      let ok = false;
      try { ok = (await fetch('/library/add?name=' + encodeURIComponent(f.name), { method: 'POST', body: f })).ok; }
      catch { status(`Could not add ${f.name}. The Read Aloud server is not running. Open the Read Aloud app again.`); return; }
      if (!ok) failed.push(f.name);
    }
    const added = pdfs.length - failed.length;
    status(failed.length ? `Could not add ${failed.join(', ')}.` + (added ? ` Added ${added} of ${pdfs.length}.` : '')
      : pdfs.length === 1 ? 'Added.' : `Added ${pdfs.length} books.`);
    $('sort').value = 'added';
    load();
  }

  $('add').addEventListener('click', () => $('file').click());
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
  load();
})();

// ---------- YouTube: send the MP3 chapters to a private channel ----------
(() => {
  const $ = (id) => document.getElementById(id);
  const panel = $('yt');
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  async function show() {
    let st; try { st = await (await fetch('/youtube/status', { cache: 'no-store' })).json(); } catch { return; }
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
  $('ytBtn').addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) show(); });
  // the restart button: the voice server (the Claude helper and the natural voices) starts again
  $('restartBtn').addEventListener('click', async () => {
    const b = $('restartBtn'); b.disabled = true;
    try {
      const { restartServer } = await import('/reader/restart.js');
      await restartServer((t) => { b.textContent = t.length > 30 ? '↻ ' + t.replace(/\.$/, '') : t; b.title = t; });
    } catch {
      b.textContent = '↻ Restart failed'; b.title = 'The restart did not work. Press again to try again.';
    } finally {
      setTimeout(() => { b.textContent = '↻ Restart helper'; b.disabled = false; }, 2500);
    }
  });
  $('ytSecret').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    let key;
    try { key = JSON.parse(await f.text()); }
    catch { $('ytState').textContent = 'That is not the key file from Google.'; return; }
    try {
      const r = await post('/youtube/secret', key);
      $('ytState').textContent = r.ok ? 'Key file saved.' : 'That is not the key file from Google.';
    } catch { $('ytState').textContent = 'The Read Aloud server is not running. Open the Read Aloud app again.'; return; }
    show();
  });
  $('ytConnect').addEventListener('click', () => { window.open('/youtube/auth', '_blank'); setTimeout(show, 15000); });
  $('ytDisconnect').addEventListener('click', async () => { if (confirm('Disconnect YouTube?')) { await post('/youtube/disconnect'); show(); } });
  $('ytAuto').addEventListener('change', () => post('/youtube/setting', { auto: $('ytAuto').checked }));
  setInterval(() => { if (!panel.hidden) show(); }, 20000);
})();
