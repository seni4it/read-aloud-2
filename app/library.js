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
    left.textContent = pct ? pct + '% read' : 'Not started';
    right.textContent = when(b.opened);
    const cover = el.querySelector('.cover');
    const img = new Image();
    img.onload = () => { cover.style.backgroundImage = `url(${img.src})`; };
    img.onerror = () => { cover.textContent = 'PDF'; if (!b.cover) setTimeout(() => { img.src = `/library/cover/${b.id}?r=${Date.now()}`; }, 4000); };
    img.src = `/library/cover/${b.id}`;
    const open = () => { location.href = `/reader/index.html?lib=${b.id}&name=${encodeURIComponent(b.name)}&file=${encodeURIComponent('/library/file/' + b.id)}`; };
    el.addEventListener('click', (e) => { if (!e.target.closest('.remove')) open(); });
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
    for (const [k, f] of pdfs.entries()) {
      status(`Adding ${f.name} (${k + 1} of ${pdfs.length})…`);
      const r = await fetch('/library/add?name=' + encodeURIComponent(f.name), { method: 'POST', body: f });
      if (!r.ok) status(`Could not add ${f.name}.`);
    }
    status(pdfs.length === 1 ? 'Added.' : `Added ${pdfs.length} books.`);
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
