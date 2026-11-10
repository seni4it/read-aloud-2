// Read Aloud 2 popup: start reading the page, pick voice and speed, switch the page helpers on or off.
const DEFAULTS = { voice: 'kokoro:af_heart', rate: 1.2, follow: true, launcher: true, hoverPlay: true, clickJump: true, pdf: true, hidden: [] };
const $ = (id) => document.getElementById(id);
let cfg = { ...DEFAULTS }, tab = null, host = '';
const save = () => chrome.storage.sync.set({ ra2: cfg });

// The natural voices in language groups (one optgroup each): English, Italian, then other accents.
// A copy of the one in pdf/language.js (this page is no module); a test keeps them equal.
function voiceGroups(voices) {
  const named = { american: 'English', british: 'English', english: 'English', italian: 'Italian' };
  const byId = { a: 'English', b: 'English', i: 'Italian' };
  const groups = new Map([['English', []], ['Italian', []]]);
  for (const v of voices || []) {
    const accent = String((v && v.accent) || '').trim();
    const name = accent ? named[accent.toLowerCase()] || accent : byId[String((v && v.id) || '').charAt(0)] || 'Other';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(v);
  }
  return [...groups].filter(([, list]) => list.length).map(([name, list]) => ({ name, voices: list }));
}

(async () => {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { host = new URL(tab.url).hostname; } catch { host = ''; }
  cfg = { ...DEFAULTS, ...((await chrome.storage.sync.get('ra2')).ra2 || {}) };
  $('rate').value = cfg.rate; $('rv').textContent = cfg.rate.toFixed(1) + '×';
  for (const k of ['hoverPlay', 'launcher', 'follow', 'clickJump', 'pdf']) { $(k).checked = cfg[k]; $(k).onchange = () => { cfg[k] = $(k).checked; save(); }; }
  $('site').checked = cfg.hidden.includes(host); $('siteRow').hidden = !host;
  $('site').onchange = () => { cfg.hidden = $('site').checked ? [...new Set([...cfg.hidden, host])] : cfg.hidden.filter((h) => h !== host); save(); };
  $('rate').oninput = () => { $('rv').textContent = Number($('rate').value).toFixed(1) + '×'; };
  $('rate').onchange = () => { cfg.rate = Number($('rate').value); save(); };
  // ticket 06: the speed method, one setting for the web-page player and the reader (ra2.method; A when not set)
  $('method').value = ['A', 'B', 'C'].includes(cfg.method) ? cfg.method : 'B';
  $('method').onchange = async () => {  // only the method key, read fresh: a speed or voice that another tab saved is kept
    cfg.method = $('method').value;
    const now = (await chrome.storage.sync.get('ra2')).ra2 || {};
    await chrome.storage.sync.set({ ra2: { ...now, method: cfg.method } });
  };

  const v = await chrome.runtime.sendMessage({ to: 'bg', cmd: 'voices' });
  const group = (label, list, prefix) => {
    if (!list.length) return;
    const g = document.createElement('optgroup'); g.label = label;
    for (const x of list) g.append(new Option(x.label, prefix + x.id));
    $('voice').append(g);
  };
  for (const g of voiceGroups(v.natural)) group(g.name, g.voices, 'kokoro:');  // English, then Italian
  group('Russian', v.system, 'system:');
  if (v.server) $('method').querySelector('option[value="C"]').disabled = !(v.methods || []).includes('C');  // ticket 06: no ffmpeg on this Mac
  $('voice').value = cfg.voice;
  $('voice').onchange = () => { cfg.voice = $('voice').value; save(); };
  $('server').innerHTML = v.server ? 'Natural voices: <b>ready</b>.' : 'Natural voices: <b>off</b>. Start the voice server on your Mac (see README).';
})();

$('read').onclick = () => {
  chrome.tabs.sendMessage(tab.id, { to: 'page', cmd: 'readPage' }).then(() => window.close())
    .catch(() => { $('server').textContent = 'This page cannot be read (Chrome pages, the Web Store and PDFs are closed to add-ons). Reload the page if you just installed the add-on.'; });
};
$('keys').onclick = (e) => { e.preventDefault(); chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); };
