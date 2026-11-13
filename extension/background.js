// Read Aloud 2, background: speaks one piece of text at a time for the tab that asked, and tells that tab
// what is happening (start, word, tick, end), so the page can highlight the word being spoken.
// Two engines: "kokoro" = natural voices from voice-server.py on this Mac (played in an offscreen page),
// "system" = the voices built into the Mac and Chrome (chrome.tts).
const SERVER = 'http://127.0.0.1:8793';
let owner = null;  // { tab, id, engine, ext, plan }: who is speaking now; ext = an add-on page (the paste page)

// Ticket 06, the speed method. One stored setting for the web-page player, the paste page and the reader of the
// add-on: chrome.storage.sync 'ra2'.method ('B' when not set; the popup and the reader write it). The same rule as
// speedPlan() in pdf/tts.js (a test keeps them equal): A asks the voice model for the speed and plays at rate 1;
// C asks the voice server to stretch (ffmpeg); B plays the speed-1 sound faster (the method before ticket 06, and the default). The voice server's
// /voices answer says the methods it offers. One rule with the reader (review of ticket 06): C without ffmpeg plays A;
// an old voice server (no "speed" in /voices) or no answer plays B.
const METHODS = ['A', 'B', 'C'];
let offered = null, offeredAt = 0;  // the methods of the voice server; an answer or a failure is kept for a minute
async function serverMethods() {
  if (offered && Date.now() - offeredAt < 60000) return offered;
  try {
    const r = await fetch(SERVER + '/voices', { signal: AbortSignal.timeout(2000) });
    const speed = (await r.json()).speed;
    offered = Array.isArray(speed && speed.methods) ? speed.methods : ['B'];  // an old voice server: speed by the browser
  } catch { offered = ['B']; }  // no answer: B, and not asked again for each Sentence
  offeredAt = Date.now();
  return offered;
}
const setting = () => chrome.storage.sync.get('ra2').then((r) => (r && r.ra2) || {}, () => ({}));
// The same rule as speedPlan() in pdf/tts.js, plus keepPitch: the web player keeps the pitch at each speed, as before ticket 06.
function soundPlan(method, rate, methods) {
  rate = Number(rate) || 1;
  let m = METHODS.includes(method) ? method : 'B';
  if (!methods.includes(m)) m = methods.includes('A') ? 'A' : 'B';
  if (rate === 1 || m === 'B') return { speed: 1, method: '', rate, keepPitch: true };  // as before ticket 06: the browser keeps the pitch
  const speed = Math.min(4, Math.max(0.5, Math.round(rate * 100) / 100));
  return { speed, method: m, rate: rate / speed, keepPitch: true };
}
async function planFor(rate) {
  const method = (await setting()).method || 'B';
  return soundPlan(method, rate, rate === 1 || method === 'B' ? METHODS : await serverMethods());
}
// ---------- the report (owner's yes of 13 Nov 2026) ----------
// What the add-on did and what went wrong, one line for each event: a Sentence that was read (its length, the wait
// before it, how long it sounded, its speed), a Natural voice that failed, a second try, a change to the Mac voice,
// a lost sound page. No text of a page is in it. The lines go to the voice server (POST /log), which writes
// ~/Library/Logs/read-aloud-2-events.log. While the voice server does not answer, the last 300 lines wait here,
// also across a restart of this background. "Report a problem" (the popup and the right-click menu) adds a mark.
const LOG_KEEP = 300;
let logLine = [], logTimer = null, logBusy = false;
const kept = () => { try { return chrome.storage.session.get('ra2log').then((r) => (r && Array.isArray(r.ra2log) ? r.ra2log : []), () => []); } catch { return Promise.resolve([]); } };
const keep = (lines) => { try { Promise.resolve(chrome.storage.session.set({ ra2log: lines })).catch(() => {}); } catch { /* no session storage */ } };
function note(evt, data = {}, now = false) {
  logLine.push({ t: Date.now(), evt, ...data });
  if (logLine.length > LOG_KEEP) logLine.splice(0, logLine.length - LOG_KEEP);
  if (now) sendLog(); else if (!logTimer) logTimer = setTimeout(sendLog, 4000);
}
async function sendLog() {
  clearTimeout(logTimer); logTimer = null;
  if (logBusy || !logLine.length) return;
  logBusy = true;
  const batch = logLine.splice(0, 200);
  try {
    const r = await fetch(SERVER + '/log', { method: 'POST', body: JSON.stringify(batch), signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error('The voice server refused the report');
    keep(logLine);
  } catch {  // the voice server does not answer: the lines wait, and go with the next event
    logLine = batch.concat(logLine).slice(-LOG_KEEP);
    keep(logLine);
  }
  logBusy = false;
}
// One "add-on-start" line for each start of the browser or of the add-on. Chrome stops this background when it is idle
// and starts it again for each alarm (one a minute): those starts get no line.
kept().then(async (old) => {
  if (old.length) logLine = old.concat(logLine).slice(-LOG_KEEP);
  let first = true;
  try { first = !(await chrome.storage.session.get('ra2up')).ra2up; if (first) await chrome.storage.session.set({ ra2up: 1 }); } catch { /* no session storage: say it each time */ }
  if (first) note('add-on-start', { version: chrome.runtime.getManifest().version });
});

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
    .then(() => note('sound-page-made'))
    .catch((e) => { if (!/single offscreen/i.test(String(e && e.message))) throw e; })
    .finally(() => { making = null; });
  await making;
}

// Resume after a pause: when the audio is gone (the offscreen page was closed, or this background was restarted
// and forgot who was speaking), the page says the sentence again from the word it reached.
async function resume(tab, id, ext) {
  const o = owner;
  if (o && o.tab === tab && o.engine === 'kokoro') {
    if (o.pausedAt) { o.pausedMs += Date.now() - o.pausedAt; o.pausedAt = 0; }
    if (o.again) { toSoundPage(o); return; }  // the pause came in the wait before a new try: the try goes now
  }
  const ok = o && o.tab === tab && o.engine === 'kokoro' && await hasOffscreen()
    && await chrome.runtime.sendMessage({ to: 'offscreen', cmd: 'resume' }).catch(() => false);
  if (!ok) { note('sound-lost', { engine: o ? o.engine : '' }); tell(tab, { evt: 'lost', id }, ext); }
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

// One line of the report for a Sentence that was read to its end. heard: the speed that sounded (the length of the
// sound divided by the time it took); a Sentence far from the asked speed is marked "speed-off".
function said(o) {
  const ms = Date.now() - o.startAt - o.pausedMs;
  const line = { engine: o.engine === 'kokoro' ? 'natural' : 'mac', voice: o.m.voice || '', chars: String(o.m.text || '').length,
    wait: o.startAt - o.asked, ms, rate: o.m.rate, tries: o.tries + 1 };
  if (o.m.fb) line.fb = 1;  // the Mac voice reads because the Natural voice did not answer
  let evt = 'say';
  if (o.engine === 'kokoro' && o.plan) {
    Object.assign(line, { play: +o.plan.rate.toFixed(3), speed: o.plan.speed, method: o.plan.method || 'B' });
    if (o.d > 0 && ms > 0) {
      line.d = +o.d.toFixed(2); line.heard = +(o.d * 1000 / ms).toFixed(2);
      if (!o.touched && o.d >= 2 && Math.abs(line.heard / o.plan.rate - 1) > 0.15) evt = 'speed-off';
    }
  }
  note(evt, line, evt !== 'say');
}

// Owner's yes of 13 Nov 2026: a Sentence of the Natural voice that does not sound is tried again 2 times (after
// 0.4 s and 1.2 s) before the page hears of it. Before that, one failed Sentence made the page read with the Mac
// voice for 5 s or more: another voice and another speed.
const TRIES = [400, 1200];
function failed(o, why) {
  if (owner !== o) return;
  note('voice-error', { why: String(why).slice(0, 160), try: o.tries + 1, started: o.startAt ? 1 : 0 }, true);
  if (o.engine === 'kokoro' && !o.startAt && o.tries < TRIES.length) {  // nothing of it was heard: the same Sentence again
    o.again = true;
    setTimeout(() => { if (owner === o && !o.pausedAt) toSoundPage(o); }, TRIES[o.tries++]);
    return;
  }
  tell(o.tab, { evt: 'error', id: o.id, why }, o.ext);
}
async function toSoundPage(o) {
  const mine = () => owner === o;
  o.again = false;
  const plan = await planFor(o.m.rate);
  if (!mine()) return;  // a newer sentence came while the setting was read
  o.plan = plan;
  try { await offscreen(); } catch (e) { if (mine()) failed(o, 'Audio player did not open: ' + (e && e.message)); return; }
  if (!mine()) return;  // a newer sentence came while the sound page opened
  // The sound page answers true when it took the sentence. No answer (it was closing, or not listening yet):
  // the Sentence is tried again, and after the last try the page gets an error, so it does not stay in 'playing' with no sound.
  chrome.runtime.sendMessage({ to: 'offscreen', cmd: 'speak', tab: o.tab, id: o.id, text: o.m.text, voice: o.m.voice, next: o.m.next || [], ...plan })
    .then((took) => { if (took !== true && mine()) failed(o, 'Audio player did not take the sentence.'); },
      (e) => { if (mine()) failed(o, 'Audio player: ' + (e && e.message)); });
}

async function speak(tab, m, ext) {
  if (owner && (owner.tab !== tab || owner.engine !== m.engine)) stopOwner(tab);
  const was = owner;
  const o = owner = { tab, id: m.id, engine: m.engine, ext, m, asked: Date.now(), startAt: 0, d: 0, tries: 0, pausedAt: 0, pausedMs: 0, touched: false, again: false };
  const mine = () => owner === o;
  if (m.fb && !(was && was.m && was.m.fb)) note('mac-voice', { voice: m.voice || '' }, true);  // the Natural voice did not answer: the Mac voice reads from here
  if (m.engine === 'system') {
    chrome.tts.stop();
    chrome.tts.speak(m.text, {
      voiceName: m.voice || undefined, rate: m.rate, enqueue: false,
      onEvent: (e) => {
        if (!mine()) return;  // a late event of a tab that lost the voice (ids are counted per tab and can be equal)
        if (e.type === 'word') tell(tab, { evt: 'word', id: m.id, char: e.charIndex }, ext);
        else if (e.type === 'start') { o.startAt = Date.now(); tell(tab, { evt: 'start', id: m.id }, ext); }
        else if (e.type === 'end') { if (o.startAt) said(o); tell(tab, { evt: 'end', id: m.id }, ext); }
        else if (e.type === 'error') { note('voice-error', { why: String(e.errorMessage || 'voice error').slice(0, 160), engine: 'mac' }, true); tell(tab, { evt: 'error', id: m.id, why: e.errorMessage || 'voice error' }, ext); }
      },
    });
    return;
  }
  toSoundPage(o);
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m.to === 'bg') {
    const tab = sender.tab ? sender.tab.id : m.tab;
    const ext = isAddonPage(sender);
    if (m.cmd === 'speak') speak(tab, m, ext);
    else if (m.cmd === 'stop') { if (owner && owner.tab === tab) stopOwner(tab); }
    else if (m.cmd === 'warm') {  // the screen's Read-ahead: at the speed and method of the setting
      // the tab's present speed first (content.js sends it); the stored speed for an older page
      (m.rate ? Promise.resolve(m.rate) : setting().then((s) => Number(s.rate) || 1)).then(planFor).then((plan) => offscreen().then(() => chrome.runtime.sendMessage({ to: 'offscreen', cmd: 'warm',
        texts: m.texts, voice: m.voice, prio: m.prio, batch: m.batch, speed: plan.speed, method: plan.method }))).catch(() => {});
    }
    else if (m.cmd === 'resume') resume(tab, m.id, ext);
    else if (m.cmd === 'pause' && owner && owner.tab === tab && owner.engine === 'kokoro') {
      if (!owner.pausedAt) owner.pausedAt = Date.now();
      chrome.runtime.sendMessage({ to: 'offscreen', cmd: 'pause' }).catch(() => {});
    } else if (m.cmd === 'rate' && owner && owner.tab === tab && owner.engine === 'kokoro') {
      // Ticket 06: a sound of the same speed (B, or speed 1) only changes its rate. A sound made at another speed
      // (A, C) cannot: the page says the Sentence again from the present word ('lost'), at the new speed.
      const was = owner;
      planFor(m.rate).then((plan) => {
        if (owner !== was) return;
        was.touched = true;  // the speed changed in this Sentence: its heard speed says nothing
        if (was.plan && plan.speed === was.plan.speed && plan.method === was.plan.method) {
          was.plan = plan;
          chrome.runtime.sendMessage({ to: 'offscreen', cmd: 'rate', rate: plan.rate, keepPitch: plan.keepPitch }).catch(() => {});
        } else tell(tab, { evt: 'lost', id: was.id }, was.ext);
      });
    } else if (m.cmd === 'voices') { voices().then(reply); return true; }
    else if (m.cmd === 'myTab') reply(tab);
    else if (m.cmd === 'note' && typeof m.evt === 'string') note(m.evt, { ...(m.data || {}), tab }, !!m.now);  // a line from a page of the add-on
    else if (m.cmd === 'problem') { problem(m.where || 'page', tab).then(reply); return true; }
  } else if (m.to === 'bg-evt') {  // from the offscreen page
    // the tab as well as the id: ids are counted per tab, so tab A's late 'end' can carry tab B's id
    const o = owner;
    if (!o || o.id !== m.id || o.tab !== m.tab) return;
    if (m.evt === 'start') { o.startAt = Date.now(); o.pausedMs = 0; if (o.pausedAt) o.pausedAt = o.startAt; if (m.d > 0) o.d = m.d; }
    else if (m.evt === 'tick' && m.d > 0) o.d = m.d;
    else if (m.evt === 'end') { if (o.startAt) said(o); }
    else if (m.evt === 'error') { failed(o, m.why || 'The voice did not play.'); return; }  // tried again first
    tell(m.tab, { evt: m.evt, id: m.id, t: m.t, d: m.d, why: m.why, starts: m.starts }, o.ext);
  }
});

// "Report a problem": a mark in the report with the state of the add-on at that moment, sent at once.
async function problem(where, tab) {
  const o = owner;
  let server = 0;
  try { server = (await fetch(SERVER + '/voices', { signal: AbortSignal.timeout(2000) })).ok ? 1 : 0; } catch { server = 0; }
  let page = null;
  try { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); if (t) page = await chrome.tabs.sendMessage(t.id, { to: 'page', cmd: 'state' }); } catch { page = null; }
  const st = await setting();
  note('problem', { where, version: chrome.runtime.getManifest().version, server, soundPage: (await hasOffscreen()) ? 1 : 0,
    reading: o ? 1 : 0, engine: o ? o.engine : '', voice: o && o.m ? o.m.voice || '' : '', asked: o && o.m ? o.m.rate : 0,
    play: o && o.plan ? o.plan.rate : 0, speed: o && o.plan ? o.plan.speed : 0, method: st.method || 'B', setRate: Number(st.rate) || 0,
    tries: o ? o.tries + 1 : 0, started: o && o.startAt ? 1 : 0, waiting: logLine.length,
    ...(page && typeof page === 'object' ? { playing: page.playing ? 1 : 0, paused: page.paused ? 1 : 0, macNow: page.natOff ? 1 : 0, sentence: page.i, sentences: page.n, pageVoice: String(page.voice || '').slice(0, 40) } : {}) });
  await sendLog();
  return { saved: true, sent: logLine.length === 0 };
}

async function voices() {
  const out = { natural: [], system: [], server: false };
  try {
    // a time limit: a server that accepts and then waits (the model still loading) must not hold the voice list
    const r = await fetch(SERVER + '/voices', { signal: AbortSignal.timeout(2000) });
    const j = await r.json();
    out.natural = j.voices; out.server = true;
    offered = Array.isArray(j.speed && j.speed.methods) ? j.speed.methods : ['B']; offeredAt = Date.now();  // ticket 06
    out.methods = offered;
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
  chrome.contextMenus.create({ id: 'problem', title: 'Report a problem with the reading', contexts: ['page', 'selection', 'link'] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'img') { pictureText(info.srcUrl, tab); return; }
  if (info.menuItemId === 'problem') { problem('menu', tab && tab.id); return; }
  chrome.tabs.sendMessage(tab.id, { to: 'page', cmd: info.menuItemId === 'sel' ? 'readSelection' : 'readHere' }).catch(() => {});
});
chrome.commands.onCommand.addListener(async (cmd) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { to: 'page', cmd }).catch(() => {});
});
