// Read Aloud 2, background: speaks one piece of text at a time for the tab that asked, and tells that tab
// what is happening (start, word, tick, end), so the page can highlight the word being spoken.
// Two engines: "kokoro" = natural voices from voice-server.py on this Mac (played in an offscreen page),
// "system" = the voices built into the Mac and Chrome (chrome.tts).
const SERVER = 'http://127.0.0.1:8793';
let owner = null;  // { tab, id, engine, ext }: who is speaking now; ext = an add-on page (the paste page)
// An add-on page has no content script: it hears events only by a runtime broadcast. A web tab hears them
// by tabs.sendMessage alone, so its 14 ticks a second are not copied to every add-on page.
const isAddonPage = (sender) => !sender.tab || String(sender.url || '').startsWith(chrome.runtime.getURL(''));

// One offscreen page plays the audio. Chrome closes it after 30 s without sound (a long pause), so look each time
// whether it is still there, and make it again when it is not.
let making = null;
const hasOffscreen = () => chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).then((c) => c.length > 0, () => false);
async function offscreen() {
  if (await hasOffscreen()) return;
  making = making || chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['AUDIO_PLAYBACK'], justification: 'Play the natural voice' })
    .catch((e) => { if (!/single offscreen/i.test(String(e && e.message))) throw e; })
    .finally(() => { making = null; });
  await making;
}

// Resume after a pause: when the audio is gone (the offscreen page was closed, or this background was restarted
// and forgot who was speaking), the page says the sentence again from the word it reached.
async function resume(tab, id, ext) {
  const ok = owner && owner.tab === tab && owner.engine === 'kokoro' && await hasOffscreen()
    && await chrome.runtime.sendMessage({ to: 'offscreen', cmd: 'resume' }).catch(() => false);
  if (!ok) tell(tab, { evt: 'lost', id }, ext);
}

async function tell(tab, msg, ext) {
  msg.to = 'page';
  chrome.tabs.sendMessage(tab, msg).catch(() => {});
  if (ext) chrome.runtime.sendMessage({ ...msg, tab }).catch(() => {});  // the paste page is an extension page, not a content script
}

function stopOwner(except) {
  if (!owner) return;
  if (owner.engine === 'system') chrome.tts.stop();
  else chrome.runtime.sendMessage({ to: 'offscreen', cmd: 'stop' }).catch(() => {});
  if (owner.tab !== except) tell(owner.tab, { evt: 'stopped' }, owner.ext);
  owner = null;
}

async function speak(tab, m, ext) {
  if (owner && (owner.tab !== tab || owner.engine !== m.engine)) stopOwner(tab);
  owner = { tab, id: m.id, engine: m.engine, ext };
  const mine = () => owner && owner.tab === tab && owner.id === m.id;
  if (m.engine === 'system') {
    chrome.tts.stop();
    chrome.tts.speak(m.text, {
      voiceName: m.voice || undefined, rate: m.rate, enqueue: false,
      onEvent: (e) => {
        if (!mine()) return;  // a late event of a tab that lost the voice (ids are counted per tab and can be equal)
        if (e.type === 'word') tell(tab, { evt: 'word', id: m.id, char: e.charIndex }, ext);
        else if (e.type === 'start') tell(tab, { evt: 'start', id: m.id }, ext);
        else if (e.type === 'end') tell(tab, { evt: 'end', id: m.id }, ext);
        else if (e.type === 'error') tell(tab, { evt: 'error', id: m.id, why: e.errorMessage || 'voice error' }, ext);
      },
    });
    return;
  }
  try { await offscreen(); } catch (e) { tell(tab, { evt: 'error', id: m.id, why: 'Audio player did not open: ' + (e && e.message) }, ext); return; }
  // The sound page answers true when it took the sentence. No answer (it was closing, or not listening yet):
  // the page gets an error, so it does not stay in 'playing' with no sound.
  chrome.runtime.sendMessage({ to: 'offscreen', cmd: 'speak', tab, id: m.id, text: m.text, voice: m.voice, rate: m.rate, next: m.next || [] })
    .then((took) => { if (took !== true && mine()) tell(tab, { evt: 'error', id: m.id, why: 'Audio player did not take the sentence.' }, ext); },
      (e) => { if (mine()) tell(tab, { evt: 'error', id: m.id, why: 'Audio player: ' + (e && e.message) }, ext); });
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m.to === 'bg') {
    const tab = sender.tab ? sender.tab.id : m.tab;
    const ext = isAddonPage(sender);
    if (m.cmd === 'speak') speak(tab, m, ext);
    else if (m.cmd === 'stop') { if (owner && owner.tab === tab) stopOwner(tab); }
    else if (m.cmd === 'warm') offscreen().then(() => chrome.runtime.sendMessage({ to: 'offscreen', cmd: 'warm', texts: m.texts, voice: m.voice, prio: m.prio, batch: m.batch })).catch(() => {});
    else if (m.cmd === 'resume') resume(tab, m.id, ext);
    else if (['pause', 'rate'].includes(m.cmd) && owner && owner.tab === tab && owner.engine === 'kokoro') {
      chrome.runtime.sendMessage({ to: 'offscreen', cmd: m.cmd, rate: m.rate }).catch(() => {});
    } else if (m.cmd === 'voices') { voices().then(reply); return true; }
    else if (m.cmd === 'myTab') reply(tab);
  } else if (m.to === 'bg-evt') {  // from the offscreen page
    // the tab as well as the id: ids are counted per tab, so tab A's late 'end' can carry tab B's id
    if (owner && owner.id === m.id && owner.tab === m.tab) tell(m.tab, { evt: m.evt, id: m.id, t: m.t, d: m.d, why: m.why, starts: m.starts }, owner.ext);
  }
});

async function voices() {
  const out = { natural: [], system: [], server: false };
  try {
    // a time limit: a server that accepts and then waits (the model still loading) must not hold the voice list
    const r = await fetch(SERVER + '/voices', { signal: AbortSignal.timeout(2000) });
    out.natural = (await r.json()).voices; out.server = true;
  } catch { /* voice server off: system voices only */ }
  // built-in voices: only Russian (Kokoro has none); Milena, the Mac's own, first
  out.system = (await chrome.tts.getVoices()).filter((v) => /^ru/i.test(v.lang || '') && !v.remote)
    .sort((a, b) => (b.voiceName === 'Milena') - (a.voiceName === 'Milena')).slice(0, 1)
    .map((v) => ({ id: v.voiceName, label: v.voiceName + ', Russian', lang: v.lang }));
  return out;
}

// PDFs open in the add-on's own reader (Chrome's PDF viewer is closed to add-ons), like Speechify does.
// The site's own "this is a PDF" answer catches links without .pdf in the name (journals, arXiv).
const READER = chrome.runtime.getURL('pdf/index.html');
const toReader = (tabId, url) => chrome.storage.sync.get('ra2').then((r) => {
  if ((r.ra2 || {}).pdf === false) return;
  chrome.tabs.update(tabId, { url: `${READER}?file=${encodeURIComponent(url)}` });
});
chrome.webRequest.onHeadersReceived.addListener((d) => {
  if (d.tabId < 0 || d.method !== 'GET') return;
  const h = (n) => (d.responseHeaders || []).find((x) => x.name.toLowerCase() === n)?.value || '';
  if (/application\/pdf/i.test(h('content-type')) && !/attachment/i.test(h('content-disposition'))) toReader(d.tabId, d.url);
}, { urls: ['<all_urls>'], types: ['main_frame'] }, ['responseHeaders']);
chrome.tabs.onUpdated.addListener((tabId, info) => {  // files on this Mac have no headers: go by the name
  if (info.url && /^file:.*\.pdf([?#]|$)/i.test(info.url)) toReader(tabId, info.url);
});

// The text in a picture, by Apple's Vision on this Mac; it opens on the "listen to text" page.
async function pictureText(src, tab) {
  let text = '';
  try {
    const img = await (await fetch(src)).blob();
    const r = await fetch(SERVER + '/ocr', { method: 'POST', body: img });
    // one flowing text: lines are joined, and a word broken with a hyphen at a line end is glued back
    text = (await r.json()).lines.map((l) => l.text).join('\n').replace(/-\n(?=[a-z])/g, '').replace(/\n/g, ' ');
  } catch (e) { text = 'The text in this picture could not be read: ' + e.message; }
  await chrome.storage.session.set({ ra2Paste: text || 'No text was found in this picture.' });
  chrome.tabs.create({ url: chrome.runtime.getURL('paste.html?from=picture'), index: tab.index + 1 });
}

// Installed from the folder (Load unpacked): when the files there change (a new version), reload by itself,
// so a fix reaches Chrome without pressing reload in chrome://extensions. The store version never changes on disk.
// 'A reader is open' is asked of the browser each time: Chrome stops this background when it is idle, and a
// counter in memory then starts again at 0 while reader tabs are still open.
const readerOpen = () => chrome.runtime.getContexts({ contextTypes: ['TAB'] })
  .then((c) => c.some((x) => String(x.documentUrl || '').startsWith(READER)));
chrome.runtime.onConnect.addListener(() => {});  // the reader still connects a port named 'reader'; nothing to count
async function selfUpdate() {
  try {
    const disk = await (await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' })).json();
    if (disk.version === chrome.runtime.getManifest().version) return;
    // A reload cuts every open reader page off from the add-on (no underlines, no copy, no voice) until the
    // page itself is reloaded. Wait until no reader page is open.
    if (await readerOpen()) return;
    chrome.runtime.reload();
  } catch { /* nothing to compare */ }
}
chrome.alarms.create('self-update', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'self-update') selfUpdate(); });

// right-click menu and keyboard shortcuts (no keys are set by default: choose them at chrome://extensions/shortcuts)
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'sel', title: 'Listen to the selected text', contexts: ['selection'] });
  chrome.contextMenus.create({ id: 'here', title: 'Listen from here', contexts: ['page', 'link'] });
  chrome.contextMenus.create({ id: 'img', title: 'Read the text in this picture', contexts: ['image'] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'img') { pictureText(info.srcUrl, tab); return; }
  chrome.tabs.sendMessage(tab.id, { to: 'page', cmd: info.menuItemId === 'sel' ? 'readSelection' : 'readHere' }).catch(() => {});
});
chrome.commands.onCommand.addListener(async (cmd) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { to: 'page', cmd }).catch(() => {});
});
