// Read Aloud 2, offscreen page: plays the natural voice. Each piece of text is one WAV from voice-server.py;
// the next pieces are asked for while this one plays, so there is no gap between sentences.
const SERVER = 'http://127.0.0.1:8793';
// One audio element for each sentence, and each event says the id of its own sentence (as the reader does with its
// sound sources). With one shared element, an 'ended' or 'error' of a stopped sentence that Chrome handed out after
// the switch was sent with the id of the new sentence: the page took it as the end of the new sentence and moved on
// once more (Chrome check of 10 Nov 2026: Previous went to the next sentence, Next moved 2 or 3).
let snd = null, cur = null, timer = null, begin = null;  // snd: the sound of the sentence of now; begin(): its start, one time

// Ticket 06: the speed and method of the sound (the background's plan); speed 1 asks the plain sound (one for all methods).
const sp = (speed, method) => (speed && speed !== 1 ? `&speed=${speed}&method=${method}` : '');
const url = (text, voice, speed, method, ahead = '') => `${SERVER}/speak?voice=${encodeURIComponent(voice)}&text=${encodeURIComponent(text)}${sp(speed, method)}${ahead}`;
// Read-ahead waits in its own line: 3 = next sentences while reading, 2 = where the mouse rests (newest first),
// 1 = what is on screen (top first; an older screen is dropped). Two at a time, sent to "localhost" so they never
// hold up the sentence you are waiting for, which goes to "127.0.0.1" (Chrome allows 6 requests per address).
const AHEAD = 'http://localhost:8793';
let line = [], busy = 0, seq = 0, screen = 0;
function early(texts, voice, prio = 3, batch = 0, speed = 1, method = '') {
  if (prio === 1) { screen = Math.max(screen, batch); line = line.filter((x) => x.prio !== 1); }
  line = line.filter((x) => x.speed === speed && x.method === method);  // ticket 06: Read-ahead of an old speed is not wanted now
  for (const text of texts) line.push({ text, voice, prio, batch, speed, method, n: prio === 1 ? -seq++ : seq++ });
  pump();
}
function pump() {
  while (busy < 2 && line.length) {
    line.sort((a, b) => b.prio - a.prio || b.n - a.n);
    const x = line.shift();
    if (x.prio === 1 && x.batch < screen) continue;
    busy++;
    fetch(`${AHEAD}/speak?voice=${encodeURIComponent(x.voice)}&text=${encodeURIComponent(x.text)}${sp(x.speed, x.method)}&ahead=${x.prio}&batch=${x.batch}`)
      .catch(() => {}).finally(() => { busy--; pump(); });
  }
}
// only for the sentence that sounds now: an event of a stopped sentence is dropped here
const send = (m, evt, extra) => cur === m && chrome.runtime.sendMessage({ to: 'bg-evt', tab: m.tab, id: m.id, evt, ...extra }).catch(() => {});
// a line for the Report that belongs to no Sentence of the page
const note = (name, data) => chrome.runtime.sendMessage({ to: 'bg-evt', evt: 'note', name, data }).catch(() => {});

// ---------- An output with a delay: the sound of the next Sentence starts early (19 Nov 2026, owner's yes) ----------
// A Bluetooth headset sounds 0.15 to 0.35 s after the browser gave it the sound, and the browser tells the end of a
// sound that much later. The page asks for the next Sentence at that end, so there was a silence as long as the delay
// after each Sentence (the Report of 19 Nov 2026: 0.3 s for each Sentence, against 0.04 s on a fast output).
// This page measures the delay while a Sentence sounds: the clock of a sound runs behind its start by the delay.
// It starts the sound of the next Sentence (the first Read-ahead text) that much before the end, less JOIN. When the
// page asks for that Sentence, its sound is taken as it is: the page gets the same events as before, at the true times.
// A fast output (the Mac speakers, a USB headset) gets no early start: nothing changes there.
// The Report of 19 to 23 Nov 2026: a sound that starts after silence sounds 0.04 to 0.10 s later on the Mac speakers,
// (one 0.16 s at the start of the add-on)
// and 0.24 to 0.8 s later on the Bluetooth headset (0.14 to 0.2 s for a few). PROBE_FROM is between the two.
// Two delays (the test browser on a Bluetooth headset, 19 Nov 2026): a sound that starts after silence, also after
// the 0.03 s between two Sentences, sounds 0.36 s later; a sound that starts while another one sounds, 0.18 s later.
// An early start is of the second kind, so only an early sound tells the delay to use. Before one was measured, the
// early start is small (PROBE): it can not make two Sentences sound together, and its sound tells the delay.
const JOIN = 60;        // ms of silence between two Sentences that an early start aims at (a fast output gave about this)
const LEAD_MIN = 30;    // ms; a shorter early start is not made
const LEAD_MAX = 600;   // ms; a measured delay above this is not used in full
const PROBE = 30;       // ms; the early start while the delay of an early sound is not measured yet
// ms; a sound that starts after silence with this delay or more gets the small early start (PROBE). The delay while
// another sound sounds is about half of it (0.18 s against 0.36 s): below this, the early start would be below LEAD_MIN.
const PROBE_FROM = 2 * (JOIN + LEAD_MIN);
const PREPARE = 400;    // ms before its start, the sound of the next Sentence is made, so that it is loaded in time
const LOOK = 25;        // ms between two looks at the sound
const AWAKE = 500;      // ms; a Sentence that starts this soon after another one goes on with the same output
const ORPHAN = 1500;    // ms after the end of a Sentence; an early sound that the page did not ask for by then is stopped
const OVERLAP = -40;    // ms; a join below this means that two Sentences sounded together: the delay is measured again
let delay = null;       // the delay in ms of a sound that starts while another one sounds; null: not measured yet
let slow = false;       // the last sound that started after silence had a delay of PROBE_FROM or more
let lastSound = 0;      // when a sound last sounded or ended
let nextSnd = null;     // the sound of the next Sentence, made early; the page did not ask for it yet
let watch = null;       // the clock that measures the delay and looks ahead
const median = (v) => [...v].sort((x, y) => x - y)[Math.floor(v.length / 2)];

// One sound: the audio element of one Sentence, and what the measurement of the delay needs.
function sound(spec) {
  const a = new Audio();
  a.preservesPitch = spec.keepPitch !== false;  // ticket 06: B lets the pitch go up; A and C play at rate 1
  a.src = url(spec.text, spec.voice, spec.speed, spec.method); a.playbackRate = spec.rate;  // the sentence to hear goes first
  return { a, spec, start: null, playAt: 0, endAt: 0, prevEnd: 0, clean: true, lags: [], lag0: null,
    early: false, called: false, armed: false, noLead: false, timer: null, orphan: null };
}
function free(s) {
  clearTimeout(s.timer); clearTimeout(s.orphan);
  const a = s.a;
  a.onended = a.onerror = a.onloadeddata = a.onplaying = null; a.pause(); a.removeAttribute('src'); a.load?.();  // load(): Chrome frees the old sound
}
// why: the page asked for another Sentence ('other'), did not ask in time ('late'), or the sound failed ('error')
function dropNext(why) {
  const n = nextSnd; nextSnd = null;
  if (!n) return;
  if (why && n.called) note('early-start-lost', { why });
  free(n);
}
const sounding = (s) => { if (!s.playAt) s.playAt = Date.now(); };  // the clock of this sound starts here
// A pause or a speed change: the clock of this sound says nothing of the delay from here.
const unclean = (s) => { s.clean = false; s.lags = []; };

// One measurement: how far the clock of the sound is behind its start.
function measure(s) {
  const a = s.a;
  if (!s.clean || !s.playAt || a.paused || a.ended) return;
  lastSound = Date.now();
  if (!(a.currentTime > 0.05)) return;
  s.lags.push(lastSound - s.playAt - a.currentTime / a.playbackRate * 1000);
  if (s.lags.length > 9) s.lags.shift();
  if (s.lags.length < 4) return;
  const lag = Math.max(0, median(s.lags));
  if (s.lag0 === null) { s.lag0 = Math.round(lag); if (!s.early) slow = lag >= PROBE_FROM; }  // the delay at the start of this sound
  if (s.early) delay = lag;  // only a sound that started while another one sounded tells the delay of an early start
}
// How long until the sound of the next Sentence must start, in ms. null: no early start (or not known yet).
// The clock of the sound must run: it stands still for the delay after a start, and its end is not known then.
function untilEarlyStart(s) {
  const a = s.a;
  if (s.noLead || a.paused || a.ended || !(a.duration > 0) || !(a.currentTime > 0.05)) return null;
  let lead = PROBE;
  if (delay !== null) { lead = Math.min(delay, LEAD_MAX) - JOIN; if (lead < LEAD_MIN) return null; }  // a fast output
  // A sound that started after silence tells by its own delay whether a small early start is worth it; not known yet:
  // no early start (the verdict of an older sound can be of another output, or of the time before a pause).
  // An early sound that is not measured yet goes on with the verdict of the sound that started it.
  else if (s.early ? !slow : !(s.lag0 >= PROBE_FROM)) return null;
  return (a.duration - a.currentTime) / a.playbackRate * 1000 - lead;
}
// 40 times a second while a Sentence sounds: measure, make the sound of the next Sentence when its time is near, and
// set its start at the last look before that time, with the newest measurement.
function look() {
  const s = snd, m = cur;
  if (!s || !m) return;
  measure(s);
  let n = nextSnd;
  if (n && n.called) { measure(n); return; }
  const text = m.next && m.next[0];
  if (s.armed || !text) return;
  const t = untilEarlyStart(s);
  if (t === null) { if (n) dropNext(); return; }  // the newest measurement says a fast output: no early start
  if (t > PREPARE) return;
  // an early sound tells its own delay a moment after its start: wait for it, so that no sound is made for nothing
  if (delay === null && s.early && s.clean && s.lags.length < 4 && t > 2 * LOOK) return;
  if (!n) {
    n = nextSnd = sound({ text, voice: m.voice, speed: m.speed, method: m.method, rate: s.a.playbackRate, keepPitch: m.keepPitch });
    n.a.onplaying = () => sounding(n);
    n.a.onended = () => { n.endAt = lastSound = Date.now(); };
    n.a.onerror = () => { if (nextSnd === n) dropNext('error'); };
  }
  if (t > 2 * LOOK) return;
  s.armed = true;  // one early start for each Sentence
  const e = n;
  e.timer = setTimeout(() => {
    e.timer = null;
    if (nextSnd !== e) return;
    e.called = e.early = true;
    e.a.play().then(() => { sounding(e); e.start?.(); }).catch((err) => {
      if (nextSnd === e) dropNext('error');
      else if (snd === e && e.m && cur === e.m && err.name !== 'AbortError') send(e.m, 'error', { why: 'The voice could not play: ' + err.message });
    });
  }, Math.max(0, t));
}
// What the Report gets with the end of a Sentence: the delay of the output, the time that the sound took in the ear,
// the silence before it, and whether it started early. A paused Sentence gives none of these.
function heardOf(s) {
  const out = s.early ? { pre: 1 } : {};
  if (!s.clean || s.lag0 === null || !s.playAt || !s.endAt) return out;
  out.lag = s.lag0;
  out.heardMs = Math.round(s.endAt - s.playAt - s.lag0);
  const join = s.prevEnd ? Math.round(s.playAt + s.lag0 - s.prevEnd) : null;
  if (join !== null && join < 3000) out.join = join;
  return out;
}

// where the audio is, 14 times a second, while it plays (not while paused: nothing moves then)
function ticking(on) {
  clearInterval(timer); clearInterval(watch); watch = null;
  const m = cur, s = snd;
  if (on && m && s) {
    timer = setInterval(() => send(m, 'tick', { t: s.a.currentTime, d: s.a.duration }), 70);
    watch = setInterval(look, LOOK);
  }
}
function stop() {
  ticking(false); cur = null; begin = null;
  dropNext();
  if (!snd) return;
  const s = snd; snd = null;
  free(s);
}

// The page asked for the Sentence of this sound: from here its events go to the page. Gives the start of the Sentence.
function attach(s, m) {
  const a = s.a;
  s.m = m;
  let started = false, ended = false;
  // The end only after the start, and once: the page goes on to the next sentence only when this one was heard.
  const end = () => {
    if (cur !== m || !started || ended) return;
    ended = true; ticking(false);
    const heard = heardOf(s);
    if (heard.join < OVERLAP) { delay = null; note('join-overlap', { join: heard.join, lag: heard.lag }); }
    send(m, 'end', heard);
  };
  a.onloadeddata = () => { if (cur === m) early(m.next, m.voice, 3, 0, m.speed, m.method); };  // then the next ones are prepared while this one plays
  a.onended = () => {
    if (snd === s) {
      s.endAt = lastSound = Date.now();
      const n = nextSnd;
      if (n) {  // the early sound waits for the page; a page that does not ask must not be read to
        n.prevEnd = s.endAt;
        if (!n.orphan) n.orphan = setTimeout(() => { if (nextSnd === n) dropNext('late'); }, ORPHAN);
      }
    }
    end();
  };
  // the early sound of the next Sentence is stopped too: the background tries this Sentence again, or the page stops
  a.onerror = () => { if (cur !== m) return; ticking(false); dropNext('error'); send(m, 'error', { why: 'The voice server on this Mac did not answer.' }); };
  // The start comes from the sound itself ('playing'), from play(), or from a resume: a pause while the sound loads
  // rejects this play() with an AbortError, and the start then comes when the owner resumes.
  const start = () => {
    if (cur !== m || started) return;
    a.playbackRate = m.rate;
    started = true;
    send(m, 'start', { d: a.duration });
    if (a.ended) end(); else if (!a.paused) ticking(true);
  };
  a.onplaying = () => { sounding(s); start(); };
  s.start = begin = start;
  return start;
}
function play(s, m) {
  s.called = true;
  if (Date.now() - lastSound > AWAKE) delay = null;  // a new reading: the output can be another one, so the delay is measured again
  s.a.play().then(() => { sounding(s); s.start(); }).catch((e) => { if (cur === m && e.name !== 'AbortError') send(m, 'error', { why: 'The voice could not play: ' + e.message }); });
}
const times = (m) => fetch(url(m.text, m.voice, m.speed, m.method).replace('/speak?', '/times?'), { signal: AbortSignal.timeout(5000) }).then((r) => r.json())  // when each word starts (Kokoro's own timings)
  .then(({ starts }) => send(m, 'times', { starts })).catch(() => {});
// The early sound is the sound of the Sentence that the page asks for now: the same text, voice, speed and method.
const same = (spec, m) => spec.text === m.text && spec.voice === m.voice && (spec.speed || 1) === (m.speed || 1) && (spec.method || '') === (m.method || '');

chrome.runtime.onMessage.addListener((m, sender, reply) => {
  if (m.to !== 'offscreen') return;
  if (m.cmd === 'speak') {
    const n = nextSnd;
    // the end of the Sentence before, for the join; none when it did not end (Next, Previous, a click in the page)
    const prevEnd = snd && snd.endAt ? snd.endAt : 0;
    if (n && same(n.spec, m)) {  // its sound was made early: it is taken as it is
      nextSnd = null; clearTimeout(n.orphan); n.orphan = null;
      ticking(false);
      if (snd) free(snd);
      cur = m; snd = n;
      n.a.preservesPitch = m.keepPitch !== false;
      if (n.a.playbackRate !== m.rate) { n.a.playbackRate = m.rate; unclean(n); }
      const start = attach(n, m);
      if (n.a.readyState >= 2) early(m.next, m.voice, 3, 0, m.speed, m.method);  // it is loaded: the Read-ahead goes now
      times(m);
      if (n.timer) { clearTimeout(n.timer); n.timer = null; }
      if (!n.called) { n.prevEnd = prevEnd; play(n, m); }  // asked for before its early start (Next): it starts now, as each sound
      else if (n.playAt) start();
    } else {
      if (n) dropNext('other');
      stop(); cur = m;
      const s = snd = sound(m);
      s.prevEnd = prevEnd;
      attach(s, m);
      times(m);
      play(s, m);
    }
    reply(true);  // tells the background that the sentence was taken
  } else if (m.cmd === 'warm') early(m.texts, m.voice, m.prio, m.batch, m.speed, m.method);
  else if (m.cmd === 'stop') stop();
  else if (m.cmd === 'pause') {
    // After a pause the clock of this sound stands still for a time that is not known: no early start after this
    // Sentence. The delay is measured again: the owner can change the output in a pause.
    if (snd) { snd.a.pause(); unclean(snd); snd.noLead = true; }
    ticking(false);
    dropNext(); delay = null;
  }
  else if (m.cmd === 'resume') {  // answers whether there was audio to go on with
    if (!cur || !snd || !snd.a.src) { reply(false); return; }
    const was = cur, first = begin;
    snd.a.play().then(() => { if (cur !== was) return; first?.(); ticking(true); }).catch(() => {});
    reply(true);
  }
  else if (m.cmd === 'rate') {  // only for a sound of the same speed (the background checks); begin() keeps the new rate
    if (cur) cur.rate = m.rate;
    if (nextSnd && !nextSnd.called) { dropNext(); if (snd) snd.armed = false; }  // its start time was for the old speed: it is planned again
    for (const s of [snd, nextSnd]) {
      if (!s) continue;
      s.a.playbackRate = m.rate; if (m.keepPitch !== undefined) s.a.preservesPitch = m.keepPitch !== false;
      unclean(s);
    }
  }
});
