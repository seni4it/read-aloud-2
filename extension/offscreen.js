// Read Aloud 2, offscreen page: plays the natural voice. Each piece of text is one WAV from voice-server.py;
// the next pieces are asked for while this one plays, so there is no gap between sentences.
const SERVER = 'http://127.0.0.1:8793';
const audio = new Audio();
audio.preservesPitch = true;  // faster speech keeps the same voice pitch
let cur = null, timer = null;

const url = (text, voice, ahead = '') => `${SERVER}/speak?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text)}${ahead}`;
// Read-ahead waits in its own line: 3 = next sentences while reading, 2 = where the mouse rests (newest first),
// 1 = what is on screen (top first; an older screen is dropped). Two at a time, sent to "localhost" so they never
// hold up the sentence you are waiting for, which goes to "127.0.0.1" (Chrome allows 6 requests per address).
const AHEAD = 'http://localhost:8793';
let line = [], busy = 0, seq = 0, screen = 0;
function early(texts, voice, prio = 3, batch = 0) {
  if (prio === 1) { screen = Math.max(screen, batch); line = line.filter((x) => x.prio !== 1); }
  for (const text of texts) line.push({ text, voice, prio, batch, n: prio === 1 ? -seq++ : seq++ });
  pump();
}
function pump() {
  while (busy < 2 && line.length) {
    line.sort((a, b) => b.prio - a.prio || b.n - a.n);
    const x = line.shift();
    if (x.prio === 1 && x.batch < screen) continue;
    busy++;
    fetch(`${AHEAD}/speak?voice=${encodeURIComponent(x.voice)}&text=${encodeURIComponent(x.text)}&ahead=${x.prio}&batch=${x.batch}`)
      .catch(() => {}).finally(() => { busy--; pump(); });
  }
}
const send = (evt, extra) => cur && chrome.runtime.sendMessage({ to: 'bg-evt', tab: cur.tab, id: cur.id, evt, ...extra }).catch(() => {});

function stop() { clearInterval(timer); audio.onended = audio.onerror = null; audio.pause(); audio.removeAttribute('src'); cur = null; }

chrome.runtime.onMessage.addListener((m) => {
  if (m.to !== 'offscreen') return;
  if (m.cmd === 'speak') {
    stop(); cur = m;
    audio.src = url(m.text, m.voice); audio.playbackRate = m.rate;  // the sentence to hear goes first
    audio.onloadeddata = () => early(m.next, m.voice);  // then the next ones are prepared while this one plays
    fetch(url(m.text, m.voice).replace('/speak?', '/times?')).then((r) => r.json())  // when each word starts (Kokoro's own timings)
      .then(({ starts }) => { if (cur === m) send('times', { starts }); }).catch(() => {});
    audio.onended = () => { clearInterval(timer); send('end'); };
    audio.onerror = () => { clearInterval(timer); send('error', { why: 'The voice server on this Mac did not answer.' }); };
    audio.play().then(() => {
      if (cur !== m) return;
      audio.playbackRate = m.rate;
      send('start', { d: audio.duration });
      timer = setInterval(() => send('tick', { t: audio.currentTime, d: audio.duration }), 70);
    }).catch((e) => { if (cur === m && e.name !== 'AbortError') send('error', { why: 'The voice could not play: ' + e.message }); });
  } else if (m.cmd === 'warm') early(m.texts, m.voice, m.prio, m.batch);
  else if (m.cmd === 'stop') stop();
  else if (m.cmd === 'pause') audio.pause();
  else if (m.cmd === 'resume') audio.play().catch(() => {});
  else if (m.cmd === 'rate') audio.playbackRate = m.rate;
});
