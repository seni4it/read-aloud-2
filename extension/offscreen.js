// Read Aloud 2, offscreen page: plays the natural voice. Each piece of text is one WAV from voice-server.py;
// the next pieces are asked for while this one plays, so there is no gap between sentences.
const SERVER = 'http://127.0.0.1:8793';
// One audio element for each sentence, and each event says the id of its own sentence (as the reader does with its
// sound sources). With one shared element, an 'ended' or 'error' of a stopped sentence that Chrome handed out after
// the switch was sent with the id of the new sentence: the page took it as the end of the new sentence and moved on
// once more (Chrome check of 10 Nov 2026: Previous went to the next sentence, Next moved 2 or 3).
let audio = null, cur = null, timer = null, begin = null;  // begin(): the start of the sentence of now, one time

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
// only for the sentence that sounds now: an event of a stopped sentence is dropped here
const send = (m, evt, extra) => cur === m && chrome.runtime.sendMessage({ to: 'bg-evt', tab: m.tab, id: m.id, evt, ...extra }).catch(() => {});

// where the audio is, 14 times a second, while it plays (not while paused: nothing moves then)
function ticking(on) {
  clearInterval(timer);
  const m = cur, a = audio;
  if (on && m) timer = setInterval(() => send(m, 'tick', { t: a.currentTime, d: a.duration }), 70);
}
function stop() {
  ticking(false); cur = null; begin = null;
  if (!audio) return;
  const a = audio; audio = null;
  a.onended = a.onerror = a.onloadeddata = a.onplaying = null; a.pause(); a.removeAttribute('src'); a.load?.();  // load(): Chrome frees the old sound
}

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m.to !== 'offscreen') return;
  if (m.cmd === 'speak') {
    stop(); cur = m;
    const a = audio = new Audio();
    a.preservesPitch = true;  // faster speech keeps the same voice pitch
    let started = false, ended = false;
    // The end only after the start, and once: the page goes on to the next sentence only when this one was heard.
    const end = () => { if (cur !== m || !started || ended) return; ended = true; ticking(false); send(m, 'end'); };
    a.src = url(m.text, m.voice); a.playbackRate = m.rate;  // the sentence to hear goes first
    a.onloadeddata = () => { if (cur === m) early(m.next, m.voice); };  // then the next ones are prepared while this one plays
    fetch(url(m.text, m.voice).replace('/speak?', '/times?'), { signal: AbortSignal.timeout(5000) }).then((r) => r.json())  // when each word starts (Kokoro's own timings)
      .then(({ starts }) => send(m, 'times', { starts })).catch(() => {});
    a.onended = end;
    a.onerror = () => { if (cur !== m) return; ticking(false); send(m, 'error', { why: 'The voice server on this Mac did not answer.' }); };
    // The start comes from the sound itself ('playing'), from play(), or from a resume: a pause while the sound loads
    // rejects this play() with an AbortError, and the start then comes when the owner resumes.
    begin = () => {
      if (cur !== m || started) return;
      a.playbackRate = m.rate;
      started = true;
      send(m, 'start', { d: a.duration });
      if (a.ended) end(); else if (!a.paused) ticking(true);
    };
    a.onplaying = begin;
    a.play().then(begin).catch((e) => { if (cur === m && e.name !== 'AbortError') send(m, 'error', { why: 'The voice could not play: ' + e.message }); });
    reply(true);  // tells the background that the sentence was taken
  } else if (m.cmd === 'warm') early(m.texts, m.voice, m.prio, m.batch);
  else if (m.cmd === 'stop') stop();
  else if (m.cmd === 'pause') { if (audio) audio.pause(); ticking(false); }
  else if (m.cmd === 'resume') {  // answers whether there was audio to go on with
    if (!cur || !audio || !audio.src) { reply(false); return; }
    const was = cur, first = begin;
    audio.play().then(() => { if (cur !== was) return; first?.(); ticking(true); }).catch(() => {});
    reply(true);
  }
  else if (m.cmd === 'rate') { if (audio) audio.playbackRate = m.rate; }
});
