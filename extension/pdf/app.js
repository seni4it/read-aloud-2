import * as pdfjsLib from './vendor/pdf.mjs';
import { buildDocument } from './extract.js';
import { PdfViewer } from './viewer.js';
import { SystemEngine, ServerEngine } from './tts.js';
import { loadLexicon, repairStats } from './lexicon.js';
import { withOcr } from './ocr.js';
import { setupNotes } from './notes.js';
import { setupAsk } from './ask.js';
import { newerPosition } from './position.js';

// Hand pdf.js an explicit module worker. Left to its own auto-setup it was
// silently falling back to a main-thread "fake worker", where render() never
// settles — the page just stays blank with no error anywhere.
const workerUrl = new URL('./vendor/pdf.worker.mjs', import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
try {
  pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(workerUrl, { type: 'module' });
} catch (err) {
  console.warn('module worker unavailable, falling back to workerSrc', err);
}

const $ = id => document.getElementById(id);
const NARROW = 900;  // px: up to this width the side bar and the page do not both fit (styles.css: max-width 900px)
// Read Aloud 2: tell the add-on this page is open, so it does not reload itself under the page (that cuts the
// page off: no underlines, no copy, no voice until the page is reloaded).
try { if (globalThis.chrome?.runtime?.id) chrome.runtime.connect({ name: 'reader' }); } catch { /* not in the add-on */ }
const LIB_ID = (new URLSearchParams(location.search).get('lib') || '').replace(/[^0-9a-f]/g, '');  // opened from the desktop library
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';

const els = {
  openBtn: $('openBtn'), sampleBtn: $('sampleBtn'), fileInput: $('fileInput'),
  docTitle: $('docTitle'), pages: $('pages'), scroller: $('scroller'), empty: $('empty'),
  player: $('player'), playBtn: $('playBtn'), playIcon: $('playIcon'),
  prevBtn: $('prevBtn'), nextBtn: $('nextBtn'), seek: $('seek'), pos: $('pos'),
  voiceSel: $('voiceSel'), rateSel: $('rateSel'), nowReading: $('nowReading'),
  toc: $('toc'), sidebar: $('sidebar'), tocBtn: $('tocBtn'), closeSidebar: $('closeSidebar'),
  parseBar: $('parseBar'), parseFill: $('parseFill'), parseText: $('parseText'),
  optCitations: $('optCitations'), optCaptions: $('optCaptions'), optRefs: $('optRefs'),
  optFrontMatter: $('optFrontMatter'), optInsets: $('optInsets'), optTables: $('optTables'), optParens: $('optParens'), timeLeft: $('timeLeft'), exportBtn: $('exportBtn'), exportStatus: $('exportStatus'),
  reparseBtn: $('reparseBtn'), dropVeil: $('dropVeil'),
  engineSel: $('engineSel'), engineStatus: $('engineStatus'), previewBtn: $('previewBtn'),
  zoomIn: $('zoomIn'), zoomOut: $('zoomOut'), zoomLevel: $('zoomLevel')
};

const viewer = window.__viewer = new PdfViewer(pdfjsLib, els.pages);
let notesUI = { reload() {}, reset() {}, markAt: () => null };  // Read Aloud 2: highlights, set up below once the page is ready
let askUI = { reload() {}, highlightsChanged() {}, stopReading() {} };  // Read Aloud 2: Ask Claude about the book

// Exposed for debugging in the console: window.__pr.sentences etc.
const state = window.__pr = {
  doc: null,
  docKey: null,
  libBook: false,  // Read Aloud 2: the open document is the library Book of this page (?lib=), not a PDF opened after it
  fileName: '',
  buffer: null,
  sentences: [],
  sections: [],
  index: 0,
  playing: false,
  parseToken: 0,
  pauseTimer: null,
  itemToSentence: new Map() // "page:item" -> sentence index, for click-to-read
};

/* ------------------------------------------------------------------ speech */

const engines = {
  system: new SystemEngine(),
  kokoro: new ServerEngine()  // Read Aloud 2: the natural voice comes from this Mac's voice server
};

let engine = engines.system;

let announced = '';
function setStatus(text) {
  text = text || '';
  els.engineStatus.textContent = text;
  // Ticket 21 review: a fault stays in sight also on a small window (styles.css hides a normal status below 480 px)
  els.engineStatus.classList.toggle('fault', /not answer|did not|could not|cannot|not available|^Mac voice|slow here/i.test(text));
  // A screen reader hears a real change of state only: not "Making the voice…" and "ready" again for each sentence.
  if (text && text !== 'Making the voice…' && !/\d%$/.test(text) && text !== announced) {
    announced = text;
    const say = $('voiceAnnounce');
    if (say) say.textContent = text;
  }
}

// Ticket 21: the play button shows a spinner while the voice server makes the sentence, until its first word sounds.
function setWaiting(on) {
  els.playBtn.classList.toggle('waiting', on);
  els.playBtn.setAttribute('aria-busy', on ? 'true' : 'false');
}

// Ticket 21: the settings button names the voice that reads ("Heart" of "Heart — US female (A) · American").
function showVoiceName() {
  const opt = els.voiceSel.selectedOptions && els.voiceSel.selectedOptions[0];
  const name = $('settingsVoice');
  if (name) name.textContent = opt ? opt.textContent.split(/ — | \(| · /)[0].trim() : '';
}

function fillVoiceSelect() {
  const list = engine.listVoices();
  const saved = localStorage.getItem('pr.voice.' + engine.id);
  els.voiceSel.innerHTML = '';
  for (const v of list) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.label;
    els.voiceSel.appendChild(opt);
  }
  if (saved && list.some(v => v.id === saved)) els.voiceSel.value = saved;
  els.voiceSel.disabled = !list.length;
  showVoiceName();
}

async function selectEngine(id) {
  const wasPlaying = state.playing;
  stop();
  const next = engines[id];
  if (!next || !next.available) { setStatus('not available in this browser'); return; }


  // Switch identity first: the voice list must show this engine's voices
  // right away, otherwise you sit looking at system voices while the model
  // downloads and pressing play gets you the wrong voice entirely.
  engine = next;
  els.engineSel.value = id;
  localStorage.setItem('pr.engine', id);
  fillVoiceSelect();

  if (id === 'kokoro' && !next.ready) {
    setBusy(true, 'Starting the natural voice…');
    try {
      await next.init(info => {
        setStatus(info.pct != null ? `${info.stage} ${info.pct}%` : info.stage + '…');
      });
      setStatus(engineLabel(next));
    } catch (err) {
      // Read Aloud 2: the voice server is down for a moment. Use the Mac voices meanwhile, but do not remember
      // that as your choice, and switch back by itself when the natural voices answer again.
      setStatus('The natural voice does not answer. The Mac voice reads for now.');
      engine = engines.system;
      els.engineSel.value = 'system';
      fillVoiceSelect();
      setBusy(false);
      clearTimeout(state.retryNatural);
      state.retryNatural = setTimeout(function retry() {
        if (localStorage.getItem('pr.engine') !== 'kokoro' || engine.id === 'kokoro') return;
        next.init().then(() => { if (!state.playing && engine.id === 'system') selectEngine('kokoro'); })
          .catch(() => { state.retryNatural = setTimeout(retry, 5000); });
      }, 5000);
      return;
    }
    setBusy(false);
    fillVoiceSelect();
  } else if (id === 'system') {
    setStatus('');
  }

  if (wasPlaying) play();
}

/** Blocks transport controls while an engine is loading. */
function setBusy(busy, message) {
  els.playBtn.disabled = busy;
  els.prevBtn.disabled = busy;
  els.nextBtn.disabled = busy;
  els.previewBtn.disabled = busy;
  els.engineSel.disabled = busy;
  if (message) setStatus(message);
}

/**
 * What the reader needs to know about where the model is running.
 *
 * "wasm" is accurate and useless. What matters is that the CPU path takes
 * about a minute per paragraph, and that the fix is one control away.
 */
function engineLabel(eng) {
  if (!eng || eng.id === 'system') return '';
  // Ticket 21: the words of the glossary, not model names
  if (eng.id !== 'kokoro') return 'Voice ready';
  if (String(eng.device).startsWith('Mac voice')) return eng.device;  // the voice server fell: tts.js reads with the Mac voice
  if (eng.device === 'wasm') {
    return 'The natural voice is slow here (about 1 minute for each paragraph). Choose the Mac voice to read now.';
  }
  return 'Natural voice ready';
}

function speakCurrent() {
  const full = state.sentences[state.index];
  if (!full) { stop(); return; }
  // Read Aloud 2: a click on a word starts there, not at the top of its paragraph
  const from = state.from || 0;
  state.from = 0;
  const sentence = from ? { ...full, text: full.text.slice(from) } : full;

  if (engine.id !== 'system') { setStatus('Making the voice…'); setWaiting(true); }
  let spoke = false;

  state.at = from;
  engine.speak(sentence, {
    voiceId: els.voiceSel.value,
    rate: Number(els.rateSel.value),
    onWord: (charIndex, charLength) => {
      if (!state.playing) return;
      if (!spoke) { spoke = true; setWaiting(false); setStatus(engineLabel(engine)); }  // now: the voice server may have fallen in this sentence
      state.at = charIndex + from;  // Read Aloud 2: the word being read, so Pause then Play goes on from here
      const parts = wordPartsAt(full, charIndex + from, charLength);
      if (parts.length) viewer.highlightWord(parts);
    },
    onEnd: () => {
      if (!state.playing) return;
      state.retried = false;  // this sentence played: a later failure gets its own new try
      if (state.index + 1 >= state.sentences.length) { stop(); return; }
      // Rest before the next block. Without this the whole document runs
      // together as one breathless stream.
      const gap = (sentence.pauseAfter ?? 300) / Number(els.rateSel.value);
      clearTimeout(state.pauseTimer);
      state.pauseTimer = setTimeout(() => {
        if (!state.playing) return;
        state.index++;
        state.retried = false;
        queuePosition();  // ticket 27: the voice server gets the place at most once in POSITION_WAIT ms
        render();
        speakCurrent();
      }, gap);
    },
    onError: err => {
      console.warn('speech error', err);
      if (!state.playing) return;
      // Read Aloud 2: one failed sentence does not stop the book. Try it once more after 1 second, then stop and say so.
      if (!state.retried) {
        state.retried = true;
        setStatus('The voice did not answer. Trying again…');
        clearTimeout(state.pauseTimer);
        state.pauseTimer = setTimeout(() => {
          if (!state.playing) return;
          state.from = state.at;  // go on from the word that was read last
          speakCurrent();
        }, 1000);
        return;
      }
      stop();
      setStatus('The voice did not answer. Press Play to try again.');
    }
  });

  // Render the next couple of sentences ahead so Kokoro doesn't leave gaps.
  engine.prefetch?.(state.sentences[state.index + 1], els.voiceSel.value);
  engine.prefetch?.(state.sentences[state.index + 2], els.voiceSel.value);
}

/**
 * Turn a character index inside a block into the glyph ranges that make up
 * that word, grouped by the PDF text item they live in.
 */
window.__wordPartsAt = wordPartsAt;
function wordPartsAt(sentence, charIndex, charLength) {
  const owners = sentence.charOwners;
  if (!owners || !owners.length) return [];

  let start = Math.max(0, Math.min(charIndex, sentence.text.length - 1));
  // Some engines report the index of the space before the word.
  while (start < sentence.text.length && /\s/.test(sentence.text[start])) start++;

  let end;
  if (charLength && charLength > 0) {
    end = Math.min(sentence.text.length, start + charLength);
  } else {
    end = start;
    while (end < sentence.text.length && !/\s/.test(sentence.text[end])) end++;
  }
  if (end <= start) return [];

  const parts = [];
  let run = null;
  for (let i = start; i < end; i++) {
    const o = owners[i];
    if (!o) continue;
    if (run && run.page === o.page && run.item === o.item && o.offset === run.end) {
      run.end = o.offset + 1;
      continue;
    }
    if (run) parts.push(run);
    run = { page: o.page, item: o.item, start: o.offset, end: o.offset + 1 };
  }
  if (run) parts.push(run);
  return parts;
}

function play() {
  if (!state.sentences.length) return;
  viewer.follow = true; document.getElementById('findBtn')?.classList.remove('away');  // Read Aloud 2: Play follows the voice
  // Read Aloud 2: after a pause, go on from the word you paused on, not from the top of the paragraph
  if (state.resumeAt && state.resumeAt.index === state.index && !state.from) {
    const text = state.sentences[state.index].text;
    let at = state.resumeAt.at;
    while (at > 0 && !/\s/.test(text[at - 1])) at--;
    state.from = at;
  }
  state.resumeAt = null;
  state.playing = true;
  state.retried = false;
  els.previewBtn.disabled = false;  // a preview that was playing is silent now, and its end never comes
  els.playIcon.innerHTML = ICON_PAUSE;  // Read Aloud 2: the same icons as the web player
  els.playBtn.setAttribute('aria-label', 'Pause');
  speakCurrent();
}

function stop() {
  clearTimeout(state.pauseTimer);
  els.previewBtn.disabled = false;  // a preview that was playing is silent now, and its end never comes
  if (state.playing && state.at > 0) state.resumeAt = { index: state.index, at: state.at };
  state.playing = false;
  setWaiting(false);
  els.playIcon.innerHTML = ICON_PLAY;
  els.playBtn.setAttribute('aria-label', 'Play');
  engine.stop();
  viewer.clearWord();
  saveProgress(true);  // ticket 27: a pause sends the place to the voice server at once
  // Clear any "generating…" left over from a synthesis we just abandoned.
  if (engine.id !== 'system') {
    setStatus(engine.ready === false ? '' : engineLabel(engine));
  }
}

function toggle() {
  state.playing ? stop() : play();
}

/**
 * Synthesise the block under the cursor before it's asked for. Without this,
 * every play from a standstill pays full generation latency — seconds of a
 * dead-looking button, and on WASM it blocks the main thread outright.
 */
let warmTimer = null;
function warmCurrent() {
  clearTimeout(warmTimer);
  if (state.playing || !state.sentences.length) return;
  if (!engine.prefetch || engine.id === 'system') return;
  warmTimer = setTimeout(() => {
    const voice = els.voiceSel.value;
    engine.prefetch(state.sentences[state.index], voice);
    engine.prefetch(state.sentences[state.index + 1], voice);
  }, 350);
}

function jumpTo(i, { resume = state.playing } = {}) {
  const wasPlaying = state.playing;
  state.resumeAt = null;  // moving on: the next Play starts at the top of that paragraph
  clearTimeout(state.pauseTimer);
  engine.stop();
  els.previewBtn.disabled = false;  // a preview that was playing is silent now
  state.retried = false;            // a new sentence gets its own new try
  state.jumped = true;              // the end of a read-in keeps this place
  state.index = Math.max(0, Math.min(i, Math.max(0, state.sentences.length - 1)));
  // Read Aloud 2: a jump you ask for (a highlight, Contents, a page in an answer, the keys) always shows that place,
  // also after you scrolled away yourself
  viewer.follow = true; document.getElementById('findBtn')?.classList.remove('away');
  render();
  if (resume && wasPlaying) {
    state.playing = true;
    speakCurrent();
  } else if (!resume) {
    state.playing = false;
    setWaiting(false);
    els.playIcon.innerHTML = ICON_PLAY;
    els.playBtn.setAttribute('aria-label', 'Play');
    saveProgress();
    warmCurrent();
  }
}

/* ------------------------------------------------------------------- render */

function render() {
  renderCounter();
  const sentence = state.sentences[state.index];
  if (sentence) {
    els.nowReading.innerHTML = '';
    const b = document.createElement('b');
    b.textContent = sentence.text;
    els.nowReading.appendChild(b);
    viewer.highlight(sentence.spans, { follow: true });
    markActiveSection(sentence.sectionIndex);
  }
}

/** The seek bar, the counter and the time left: it does not move the page. */
function renderCounter() {
  const total = state.sentences.length;
  els.seek.max = String(Math.max(0, total - 1));
  els.seek.value = String(state.index);
  els.pos.textContent = `${total ? state.index + 1 : 0} / ${total}`;
  els.timeLeft.textContent = timeLeftText();  // Read Aloud 2
}

function markActiveSection(idx) {
  [...els.toc.children].forEach((btn, i) => btn.classList.toggle('active', i === idx));
}

/**
 * Read Aloud 2: the PDF's own chapter list (its bookmarks), when it has one. Published books do, and it is exact,
 * where chapters guessed from the size of the type pick up figure labels and contents-page lines.
 */
async function outlineSections(sentences) {
  const outline = await state.doc.getOutline().catch(() => null);
  if (!outline || outline.length < 2) return null;
  const pageOf = (s) => { const o = s.charOwners && s.charOwners.find(Boolean); return o ? o.page : s.page || 0; };
  const firstOnOrAfter = (page) => { const i = sentences.findIndex((s) => pageOf(s) >= page); return i; };
  const out = [];
  const walk = async (items, level) => {
    for (const it of items) {
      let page = null;
      try {
        const dest = typeof it.dest === 'string' ? await state.doc.getDestination(it.dest) : it.dest;
        if (dest) page = (await state.doc.getPageIndex(dest[0])) + 1;
      } catch { /* a bookmark without a page */ }
      const start = page ? firstOnOrAfter(page) : -1;
      if (start >= 0 && it.title.trim()) out.push({ title: it.title.trim(), startSentence: start, page, level });
      if (it.items && it.items.length && level < 1) await walk(it.items, level + 1);
    }
  };
  await walk(outline, 0);
  return out.length >= 2 ? out : null;
}

function renderToc() {
  els.toc.innerHTML = '';
  state.sections.forEach((section, i) => {
    const btn = document.createElement('button');
    btn.textContent = section.title;
    btn.title = `${section.title} — page ${section.page}`;
    // Chapters are the spine; everything under them is indented.
    btn.classList.add(section.level === 0 ? 'chapter' : 'subsection');
    btn.addEventListener('click', () => jumpTo(section.startSentence));
    els.toc.appendChild(btn);
  });
}

/* ---------------------------------------------------------------- progress */

/**
 * Remember the place by what it SAYS, not by its number.
 *
 * The position used to be stored as an index into state.sentences. Every
 * improvement to extraction changes how the text divides into blocks — one
 * change moved a 506-page book from 830 blocks to 828 — and every saved
 * bookmark then pointed at different text, silently. The reader comes back to
 * the wrong paragraph and has no idea why.
 *
 * Store a fingerprint of the block's opening words alongside the index. On
 * load, find that text; fall back to the index only if the text is gone.
 */
function fingerprint(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().slice(0, 60);
}

let storageWarned = false;

// Read Aloud 2: how long the rest takes at this speed. The natural voice reads about 160 words a minute at 1x.
const WPM = 160;
function wordsLeft(from = state.index) {
  let n = 0;
  for (let i = from; i < state.sentences.length; i++) n += (state.sentences[i].words ??= (state.sentences[i].text.match(/\S+/g) || []).length);
  return n;
}
function minutesText(min) {
  if (!Number.isFinite(min)) return '';
  const m = Math.round(min);
  return m < 60 ? `${Math.max(1, m)} min left` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min left`;
}
function timeLeftText() {
  if (!state.sentences.length) return '';
  const min = wordsLeft() / (WPM * Number(els.rateSel.value || 1));
  state.leftAt = { min, t: Date.now() };  // the live counter below counts on from here
  return minutesText(min);
}
// While the voice reads, the time left counts down each second (the estimate is re-based at every sentence).
function secondsText(min) {
  const s = Math.max(0, Math.round(min * 60)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? `${h} h ${String(m).padStart(2, '0')} min ` : `${m} min `) + `${String(r).padStart(2, '0')} s left`;
}
setInterval(() => {
  if (!state.playing || !state.leftAt) return;
  els.timeLeft.textContent = secondsText(state.leftAt.min - (Date.now() - state.leftAt.t) / 60000);
}, 1000);

/* Ticket 27: the Reading position of a library Book also goes to the voice server (/library/<id>/position), so the
 * library and a page of another origin know it. The own copy in the browser stays.
 * - Nothing goes before the place of the open Book is loaded: a page that closes during the read-in must not send
 *   sentence 0 over the true place.
 * - Sends also wait for the voice server's answer about the open Book (or its failure). The read-in waits 3 s at
 *   most; a later answer that is newer is used when the owner has not moved yet.
 * - A place that did not change since the last send is not sent again: a second tab left open on an old place does
 *   not write it over the place of the tab where the owner reads now.
 * - The voice server answers each send with the record it keeps. When that is another place (another tab saved
 *   later), the reader takes it if the owner has not moved, and never sends its older place again.
 * - t is the time this tab's place changed, not the time of a save: the own copies are written only when the place
 *   of this tab changed since its last write or since the load, so a tab in the background never writes its old
 *   place with a new time. (Second review.) */
const SERVER = /^https?:/.test(String(location.protocol || location.href || '')) ? '' : 'http://127.0.0.1:8793';
const POSITION_WAIT = 5000;   // ms: at most one send in this time while the voice reads
const POSITION_ASK = 3000;    // ms: the read-in waits this long at most for the voice server's copy
const POSITION_GIVE_UP = 10000;  // ms: after this the voice server's copy counts as no answer, and held sends go
let positionOpen = 0;         // one number for each open; an answer for an older open is dropped
let positionLoaded = false;   // the place of the open Book is loaded (end of the read-in)
let positionAnswered = true;  // the voice server answered (or failed) about the open Book
let positionUsed = null;      // { rec, index }: the copy that the read-in used, and the sentence it gave
let positionSent = null;      // { i, at }: the place that the voice server has now, as far as this page knows
let positionSending = null;   // { i, at }: the place of a send that has no answer yet (not sent twice meanwhile)
let positionWritten = null;   // { i, at, t }: this tab's place at its last own write (or at the load); t = when it changed
let positionQueued = null, positionTimer = null;
let serverPosition = Promise.resolve(null);  // the voice server's copy for the Book being opened (3 s at most)
function sentencePage(s) {
  const o = s && s.charOwners && s.charOwners.find(Boolean);
  return (o && o.page) || (s && s.page) || 0;
}
function positionRecord(t = Date.now()) {
  const sentence = state.sentences[state.index];
  const rec = { i: state.index, total: state.sentences.length, page: sentencePage(sentence), pages: (state.doc && state.doc.numPages) || 0,
    at: fingerprint(sentence && sentence.text), t };
  const minLeft = wordsLeft() / (WPM * Number(els.rateSel.value || 1));
  if (Number.isFinite(minLeft)) rec.minLeft = minLeft;  // JSON writes NaN and Infinity as null: left out instead
  return rec;
}
const samePlace = (a, b) => Boolean(a && b) && a.i === b.i && (a.at || '') === (b.at || '');
function sendPosition() {
  clearTimeout(positionTimer);
  positionTimer = null;
  const rec = positionQueued;
  positionQueued = null;
  if (!rec || samePlace(rec, positionSent) || samePlace(rec, positionSending)) return;
  const open = positionOpen;
  const sending = positionSending = { i: rec.i, at: rec.at };
  const done = () => { if (positionSending === sending) positionSending = null; };
  // keepalive: the send still goes when the page closes. No answer: no message, the own copy works, and the next
  // save tries again (positionSent changes only when the voice server took the place).
  try {
    fetch(`${SERVER}/library/${LIB_ID}/position`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec), keepalive: true })
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((kept) => {
        done();
        if (open !== positionOpen || !kept) return;
        if (samePlace(kept, rec)) { positionSent = { i: rec.i, at: rec.at }; return; }
        // the voice server keeps a newer place (another tab): take it when the owner is still where this send was
        positionSent = { i: kept.i, at: kept.at };
        if (!state.playing && !positionQueued && state.index === rec.i) adoptPosition(kept);
      })
      .catch((err) => { done(); console.warn('Reading position: the voice server did not take it', err); });
  } catch { /* no voice server */ }
}
function queuePosition(now = false, rec = null) {
  if (!LIB_ID || !state.libBook || !positionLoaded || !state.sentences.length) return;
  if (!rec) {  // the voice moved on: the time of the change is now (the own copy is written at the next save)
    rec = positionRecord(Date.now());
    if (samePlace(rec, positionWritten)) rec.t = positionWritten.t;
  }
  if (!(rec.t > 0)) return;  // a place that no owner chose (a new Book that was only opened) is not sent
  positionQueued = rec;
  if (!positionAnswered) return;  // held: positionAnswer() sends it
  if (now) sendPosition();
  else if (!positionTimer) positionTimer = setTimeout(sendPosition, POSITION_WAIT);
}
// The voice server's copy: { answer } with no time limit (null on a failure), and { wait }, POSITION_ASK ms at most.
function positionFromServer(id) {
  if (!id) return { answer: Promise.resolve(null), wait: Promise.resolve(null) };
  // a voice server that never answers must not hold the sends for the life of the Book: abort after POSITION_GIVE_UP
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  let stopTimer = null;
  const giveUp = new Promise((done) => {
    stopTimer = setTimeout(() => { ctl?.abort(); done('gave up'); }, POSITION_GIVE_UP);
  });
  const asked = fetch(`${SERVER}/library/${id}/position`, { cache: 'no-store', signal: ctl?.signal })
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  const answer = Promise.race([asked, giveUp.then(() => { throw new Error('no answer in 10 s'); })])
    .catch((err) => { console.warn('Reading position: the voice server did not answer; the own copy is used', err); return null; })
    .finally(() => clearTimeout(stopTimer));
  let timer = null;
  const late = new Promise((done) => {
    timer = setTimeout(() => { console.warn('Reading position: the voice server did not answer in 3 s; the own copy is used'); done(null); }, POSITION_ASK);
  });
  answer.then(() => clearTimeout(timer));
  return { answer, wait: Promise.race([answer, late]) };
}
// The answer came: held sends may go. An answer after the read-in that is newer is used if the owner has not moved.
function positionAnswer(open, rec) {
  if (open !== positionOpen) return;
  positionAnswered = true;
  if (!positionLoaded) return;  // the read-in uses it
  const used = positionUsed || {};
  if (rec && rec !== used.rec && !state.playing && state.index === used.index
      && newerPosition(used.rec, rec, { now: Date.now(), count: state.sentences.length }) === rec) {
    positionQueued = null;
    clearTimeout(positionTimer);
    positionTimer = null;
    adoptPosition(rec);
    return;
  }
  if (positionQueued) sendPosition();
}
// Go to a place that the voice server keeps, with no send back; the own copies follow.
function adoptPosition(rec) {
  state.index = placeOf(rec);
  state.resumeAt = null;
  positionSent = { i: rec.i, at: rec.at };
  positionWritten = { i: state.index, at: rec.at, t: Number(rec.t) || Date.now() };
  try {
    localStorage.setItem('pr.pos.' + state.docKey, JSON.stringify({ i: state.index, at: rec.at, t: Number(rec.t) || Date.now() }));
    localStorage.setItem('ra2.lib.' + LIB_ID, JSON.stringify({ i: rec.i, total: rec.total, page: rec.page, pages: rec.pages, t: rec.t, minLeft: rec.minLeft }));
  } catch { /* storage blocked: saveProgress says it */ }
  render();
}

function saveProgress(now = false) {
  // ticket 27: nothing before the place of the open Book is loaded (no sentence 0 of a read-in over the true place)
  if (!state.docKey || !positionLoaded || !state.sentences.length) return;
  const sentence = state.sentences[state.index];
  const at = fingerprint(sentence && sentence.text);
  try {
    // ticket 27: the own copies are written only when this tab's place changed; t is the time of that change. A tab
    // that did not move writes nothing, so it never puts its old place with a new time over another tab's place.
    const moved = !samePlace({ i: state.index, at }, positionWritten);
    if (moved) {
      positionWritten = { i: state.index, at, t: Date.now() };
      localStorage.setItem('pr.pos.' + state.docKey, JSON.stringify({ i: state.index, at, t: positionWritten.t }));
    }
    // Read Aloud 2 desktop library: how far you are, for the progress bar on the book's card
    if (LIB_ID && state.libBook) {
      const rec = positionRecord(positionWritten.t);
      if (moved) localStorage.setItem('ra2.lib.' + LIB_ID, JSON.stringify({ i: rec.i, total: rec.total, page: rec.page, pages: rec.pages, t: rec.t, minLeft: rec.minLeft }));
      queuePosition(now, rec);  // a place that the voice server has already is not sent (sendPosition)
    }
    storageWarned = false;
  } catch (err) {
    // Not silent. A full or blocked store means the reader loses their place
    // on every document from here on, and they should hear it once.
    if (!storageWarned) {
      storageWarned = true;
      setStatus('Cannot save your place — browser storage is full or blocked');
      console.warn('saveProgress failed', err);
    }
  }
}

function loadProgress(remote = null) {
  if (!state.docKey) return 0;
  const raw = localStorage.getItem('pr.pos.' + state.docKey);
  let saved = null;
  if (raw && /^\d+$/.test(raw)) saved = { i: Number(raw) };  // Older saves were a bare number.
  else if (raw) {
    try { saved = JSON.parse(raw); } catch { saved = null; }
  }
  // ticket 27: a library Book also has the voice server's copy; the newer one is used (position.js says how)
  if (remote) saved = newerPosition(saved, remote, { now: Date.now(), count: state.sentences.length });
  positionUsed = { rec: saved, index: 0 };
  return placeOf(saved);
}

// The sentence of a saved place: found again by its first words, else by its number.
function placeOf(saved) {
  if (!saved || typeof saved !== 'object') return 0;
  if (!saved.at) {
    const n = Number(saved.i);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  const index = Number.isFinite(saved.i) && saved.i > 0 ? saved.i : 0;
  if (!saved.at) return index;

  // Exactly where it was, most of the time.
  if (fingerprint(state.sentences[index] && state.sentences[index].text) === saved.at) {
    return index;
  }

  // The blocks moved. Search outward from the old index so a document that
  // repeats a phrase resolves to the nearest match, not the first one.
  for (let step = 1; step < state.sentences.length; step++) {
    for (const at of [index - step, index + step]) {
      if (at < 0 || at >= state.sentences.length) continue;
      if (fingerprint(state.sentences[at].text) === saved.at) return at;
    }
  }
  return Math.min(index, Math.max(0, state.sentences.length - 1));
}

async function keyFor(file, buffer) {
  const digest = await crypto.subtle.digest('SHA-256', buffer.slice(0, 65536));
  const hex = [...new Uint8Array(digest)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${hex}-${buffer.byteLength}`;
}

/* -------------------------------------------------------------- open + parse */

/** Opens a PDF. Gives true when it opened, false when it could not (a message then shows).
 *  library: this is the library book of the page (?lib=), so its highlights are kept with that book.
 *  restoring: this open brings back the last shown document after a failed open; it does not try again. */
let shown = null;  // Read Aloud 2: the file of the document on the screen, to open it again when the next open fails
async function openFile(file, { library = false, restoring = false } = {}) {
  stop();
  let doc, old = null;
  try {
    const buffer = await file.arrayBuffer();
    // pdf.js takes ownership of the buffer, so hand it a copy each time.
    // pdf.js needs these to rasterise Type-1 and CID text. Without them the
    // render promise never settles — it waits forever on a fetch that can't
    // happen, and the page stays blank with no error.
    doc = await pdfjsLib.getDocument({
      data: buffer.slice(0),
      standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href,
      cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href,
      cMapPacked: true
    }).promise;
    // Read Aloud 2: from here the old document is gone. Its read-in stops, and none of its sentences show.
    state.parseToken++;
    notesUI.reset(library ? LIB_ID : '');  // the old book's highlights go; a PDF that is not the library book keeps its own
    // a PDF opened on a library Book page is not that Book: no "last read" of the Book, no audio export of it,
    // and Ask Claude uses the PDF's own key
    state.libBook = Boolean(LIB_ID && library);
    els.exportBtn.hidden = !state.libBook;
    // ticket 27: the voice server's copy of the Reading position is asked now; the read-in waits for it at its end
    const open = ++positionOpen;
    positionLoaded = false;
    positionAnswered = !state.libBook;
    positionQueued = null;
    clearTimeout(positionTimer);
    positionTimer = null;
    const asked = positionFromServer(state.libBook ? LIB_ID : '');
    serverPosition = asked.wait;
    asked.answer.then((rec) => positionAnswer(open, rec));
    old = state.doc;
    state.doc = doc;
    state.sentences = [];
    state.sections = [];
    state.itemToSentence.clear();
    state.index = 0;
    state.resumeAt = null;  // the place inside a sentence of the old document
    state.at = 0;
    state.from = 0;
    state.openMessage = '';
    els.nowReading.innerHTML = '';
    renderToc();
    renderCounter();
    state.buffer = buffer;
    state.fileName = file.name;
    state.docKey = await keyFor(file, buffer);
    els.docTitle.textContent = file.name;
    els.empty.hidden = true;
    els.player.hidden = false;
    state.doc = await withOcr(state.doc, setStatus);  // Read Aloud 2: scanned pages are read with Vision
    await viewer.load(state.doc);
    old?.destroy();  // the old document leaves the pdf.js worker
    old = null;
    shown = { file, library };
  } catch (err) {
    console.warn('could not open', file.name, err);
    if (!doc) {
      // Read Aloud 2: the message shows on the start screen too (the player bar is hidden there)
      const message = `Could not open "${file.name}": it is not a PDF, or it is damaged.`;
      state.openMessage = message;  // the read-in of the open book does not write over it
      els.parseBar.hidden = false;
      els.parseText.textContent = message;
      els.parseFill.style.width = '0%';
      setStatus(message);
      return false;
    }
    const why = `Could not show "${file.name}" (${err.message}).`;
    old?.destroy();  // the old book's text is gone already (above); its file opens again below
    // Read Aloud 2: the old book comes back, read in again from its file. When that fails too, no book is open.
    const back = !restoring && shown && shown.file !== file ? shown : null;
    shown = null;
    if (back && await openFile(back.file, { library: back.library, restoring: true })) {
      state.openMessage = `${why} "${back.file.name}" is open again.`;
      setStatus(state.openMessage);
      return false;
    }
    setStatus(why);
    // no book is open: not the library Book either, so no "last read", no audio export and no Ask Claude of it
    state.libBook = false;
    els.exportBtn.hidden = true;
    // no book can be read or marked: say so in the Highlights tab
    notesUI.reset('', 'No book is open. Open a PDF to see its highlights.');
    return false;
  }

  await parseDocument();
  return true;
}

async function parseDocument() {
  const token = ++state.parseToken;

  // The repair lexicon must be in memory before extraction runs; without it
  // ligature-damaged words pass through untouched.
  try {
    await loadLexicon(new URL('./vendor/lexicon.txt', import.meta.url).href);
  } catch (err) {
    console.warn('lexicon unavailable — ligature repair disabled', err);
    // Loud, not silent: without this the app quietly stops repairing broken
    // ligatures and words like "emotions" come out as "emoons" again.
    els.parseBar.hidden = false;
    els.parseText.textContent =
      'Ligature repair OFF — vendor/lexicon.txt is missing. Restart serve.py to fetch it.';
    els.parseFill.style.width = '100%';
  }
  if (token !== state.parseToken) return;
  state.sentences = [];
  state.sections = [];
  state.itemToSentence.clear();
  state.index = 0;
  state.jumped = false;
  els.parseBar.hidden = false;

  // One pipeline, shared with test/run.html. A suite that reimplements this
  // can pass while the app is broken.
  // Read Aloud 2: a read-in that a newer document cancelled ends quietly (its document may be released already)
  const builder = await buildDocument(
    state.doc,
    {
      stripCitations: els.optCitations.checked,
      stripCaptions: els.optCaptions.checked,
      skipInsets: els.optInsets.checked,  // Read Aloud 2
      skipTables: els.optTables.checked,
      skipParens: els.optParens.checked,
      stopAtReferences: els.optRefs.checked
    },
    async (n, total, b) => {
      if (token !== state.parseToken) return false;   // superseded

      els.parseFill.style.width = Math.round((n / total) * 100) + '%';
      els.parseText.textContent = state.openMessage ||
        `Reading text — page ${n} of ${total} · ${b.sentences.length} sentences`;

      // Publish what we have so playback can start on page one.
      if (n % 3 === 0 || n === total || state.doc.__scanned) {
        state.sentences = b.sentences;
        state.sections = b.sections;
        renderToc();
        // Read Aloud 2: while nothing plays, the read-in does not pull the page back to the first sentence
        if (state.playing) render(); else renderCounter();
        await new Promise(r => setTimeout(r, 0));   // let the UI breathe
      }
      return true;
    }
  ).catch(err => { if (token === state.parseToken) throw err; return null; });

  if (!builder) return;   // cancelled by a newer parse

  // buildDocument already finalized. Do not call it again — it is idempotent
  // today, and relying on that is how it stops being idempotent tomorrow.
  if (token !== state.parseToken) return;

  const sections = await outlineSections(builder.sentences).catch(() => null);
  if (token !== state.parseToken) return;  // Read Aloud 2: a newer document came while the contents list was read
  state.sentences = builder.sentences;
  state.sections = sections || builder.sections;
  buildClickIndex();
  notesUI.reload();  // Read Aloud 2: this document's highlights
  askUI.reload();
  renderToc();

  // Skip the title/author front matter on first open: start at the Abstract
  // (or the first real section) rather than reading a list of names aloud.
  let startAt = 0;
  if (els.optFrontMatter.checked) {
    const first = state.sections.findIndex(sec =>
      /^(?:\d+(?:\.\d+)*\.?\s*)?(abstract|introduction|summary)\b/i.test(sec.title));
    if (first > 0) startAt = state.sections[first].startSentence;
  }

  const remotePosition = await serverPosition;  // ticket 27: null when the voice server does not answer (3 s at most)
  if (token !== state.parseToken) return;
  const resumeAt = loadProgress(remotePosition);
  // Read Aloud 2: Play or a jump during the read-in: the place stays where the voice or the owner is
  if (!state.playing && !state.jumped) {
    state.index = resumeAt > 0
      ? Math.min(resumeAt, Math.max(0, state.sentences.length - 1))
      : startAt;
  }
  positionUsed.index = state.index;  // ticket 27: to see later whether the owner moved
  {
    const at = fingerprint(state.sentences[state.index] && state.sentences[state.index].text);
    const used = positionUsed.rec && placeOf(positionUsed.rec) === state.index ? positionUsed.rec : null;
    // the voice server has this place when its copy was used; else the first save sends it
    positionSent = used && used === remotePosition ? { i: state.index, at } : null;
    // the load is no change of place; with no saved copy at all, the first save writes one
    positionWritten = positionUsed.rec ? { i: state.index, at, t: (used && Number(used.t)) || 0 } : null;
  }
  positionLoaded = true;
  render();

  warmCurrent();
  const fixes = repairStats();
  els.parseText.textContent = state.openMessage ||
    `${state.sentences.length} sentences · ${state.sections.length} sections` +
    (fixes.repaired ? ` · ${fixes.repaired} ligature words repaired` : '') +
    (resumeAt ? ` · resumed at ${resumeAt + 1}` : '');
  els.parseFill.style.width = '100%';
  setTimeout(() => { if (token === state.parseToken && !state.openMessage) els.parseBar.hidden = true; }, 2500);
}

function buildClickIndex() {
  state.itemToSentence.clear();
  state.sentences.forEach((sentence, i) => {
    for (const span of sentence.spans) {
      const key = `${span.page}:${span.item}`;
      if (!state.itemToSentence.has(key)) state.itemToSentence.set(key, i);
    }
  });
}

/* --------------------------------------------------------------- interaction */

els.openBtn.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) openFile(file);
});

els.sampleBtn.addEventListener('click', async () => {
  try {
    const res = await fetch('./samples/sample-paper.pdf');
    if (!res.ok) throw new Error(res.status);
    const blob = await res.blob();
    await openFile(new File([blob], 'sample-paper.pdf', { type: 'application/pdf' }));
  } catch (err) {
    els.parseBar.hidden = false;
    els.parseText.textContent = 'Could not open the sample PDF (' + err.message + ').';
  }
});

els.playBtn.addEventListener('click', toggle);
els.prevBtn.addEventListener('click', () => jumpTo(state.index - 1));
els.nextBtn.addEventListener('click', () => jumpTo(state.index + 1));
// Read Aloud 2: a drag stops the voice; at the end of the drag it goes on from the new place if it was reading
els.seek.addEventListener('input', () => { state.scrubPlay ||= state.playing; jumpTo(Number(els.seek.value), { resume: false }); });
els.seek.addEventListener('change', () => { if (state.scrubPlay) { state.scrubPlay = false; play(); } });

els.rateSel.addEventListener('change', () => {
  els.timeLeft.textContent = timeLeftText();  // Read Aloud 2
  localStorage.setItem('pr.rate', els.rateSel.value);
  if (state.playing) { stop(); play(); }  // Read Aloud 2: go on from the present word, not from the top of the paragraph
});

els.voiceSel.addEventListener('change', () => {
  localStorage.setItem('pr.voice.' + engine.id, els.voiceSel.value);
  showVoiceName();
  if (state.playing) { stop(); play(); }  // Read Aloud 2: go on from the present word
});

els.engineSel.addEventListener('change', () => { localStorage.setItem('pr.engine.chosen', els.engineSel.value); selectEngine(els.engineSel.value); });


// Audition the selected voice on a fixed line, without touching playback.
els.previewBtn.addEventListener('click', async () => {
  const wasPlaying = state.playing;
  stop();
  const demo = state.sentences[state.index] || {
    text: 'Deep margin elevation relocates the cervical margin coronally, so the restoration can be bonded under rubber dam.',
    charOwners: []
  };
  els.previewBtn.disabled = true;
  await engine.speak(demo, {
    voiceId: els.voiceSel.value,
    rate: Number(els.rateSel.value),
    onEnd: () => { els.previewBtn.disabled = false; if (wasPlaying) play(); },
    onError: () => { els.previewBtn.disabled = false; }
  });
});

// Each skip setting is kept (ticket 22: the four first ones are kept too now, with their old defaults: on)
for (const [el, key, dflt] of [[els.optCitations, 'ra2.skipCitations', '1'], [els.optCaptions, 'ra2.skipCaptions', '1'],
  [els.optRefs, 'ra2.stopAtRefs', '1'], [els.optFrontMatter, 'ra2.startAtAbstract', '1'],
  [els.optInsets, 'ra2.skipInsets', '0'], [els.optTables, 'ra2.skipTables', '1'], [els.optParens, 'ra2.skipParens', '0']]) {
  try { el.checked = (localStorage.getItem(key) ?? dflt) === '1'; } catch { /* storage blocked */ }
  el.addEventListener('change', () => { try { localStorage.setItem(key, el.checked ? '1' : '0'); } catch {} });
}
for (const el of [els.optCitations, els.optCaptions, els.optRefs, els.optFrontMatter, els.optInsets, els.optTables, els.optParens]) {
  el.addEventListener('change', () => { if (state.doc) parseDocument(); });
}
els.reparseBtn.addEventListener('click', () => { if (state.doc) parseDocument(); });

function showZoom() {
  els.zoomLevel.textContent = Math.round(viewer.zoom * 100) + '%';
}

els.zoomIn.addEventListener('click', () => { viewer.setZoom(viewer.zoom + 0.15); showZoom(); });
els.zoomOut.addEventListener('click', () => { viewer.setZoom(viewer.zoom - 0.15); showZoom(); });
els.zoomLevel.addEventListener('click', () => { viewer.setZoom(1); showZoom(); });

document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey)) return;
  if (e.key === '=' || e.key === '+') { e.preventDefault(); viewer.setZoom(viewer.zoom + 0.15); showZoom(); }
  if (e.key === '-') { e.preventDefault(); viewer.setZoom(viewer.zoom - 0.15); showZoom(); }
  if (e.key === '0') { e.preventDefault(); viewer.setZoom(1); showZoom(); }
});

// Ticket 22: the words of the read-in are at the foot of the settings panel. While no book is open (the panel is
// not there), a message such as "Could not open …" shows on the start screen too.
if (typeof MutationObserver === 'function') {
  const emptyMsg = $('emptyMsg');
  new MutationObserver(() => { emptyMsg.textContent = els.parseText.textContent; })
    .observe(els.parseText, { childList: true, characterData: true, subtree: true });
}

// Ticket 21: the settings panel. The settings button opens and closes it; Escape, × or a press outside closes it.
// The focus goes into the panel when it opens and back to the settings button when it closes.
const settingsBtn = $('settingsBtn'), settingsPanel = $('settingsPanel');
function openSettings() {
  settingsPanel.hidden = false;
  settingsBtn.setAttribute('aria-expanded', 'true');
  els.engineSel.focus?.();
}
function closeSettings({ focusBack = true } = {}) {
  if (settingsPanel.hidden) return false;
  settingsPanel.hidden = true;
  settingsBtn.setAttribute('aria-expanded', 'false');
  if (focusBack) settingsBtn.focus?.();
  return true;
}
settingsBtn.addEventListener('click', () => { if (!closeSettings()) openSettings(); });
$('settingsClose').addEventListener('click', () => closeSettings());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && closeSettings()) e.preventDefault(); });
document.addEventListener('pointerdown', (e) => {
  if (!settingsPanel.hidden && !settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) closeSettings({ focusBack: false });
});
// Ticket 21 review: Tab out of the open panel closes it (like a press outside). A focus that goes nowhere (a press on
// the panel itself, the window in the background) keeps it open.
settingsPanel.addEventListener('focusout', (e) => {
  const to = e.relatedTarget;
  if (to && !settingsPanel.contains(to) && to !== settingsBtn) closeSettings({ focusBack: false });
});

els.tocBtn.addEventListener('click', () => { els.sidebar.hidden = !els.sidebar.hidden; });
els.closeSidebar.addEventListener('click', () => { els.sidebar.hidden = true; });
// Ticket 22 review: up to NARROW px the side bar lies over the page (styles.css). There it closes with Escape or a
// press outside it, so it never stays over the text.
const isNarrow = () => window.innerWidth <= NARROW;
document.addEventListener('keydown', (e) => {
  // an Escape that closed the settings panel does not close the side bar too
  if (e.key === 'Escape' && !e.defaultPrevented && isNarrow() && !els.sidebar.hidden) { els.sidebar.hidden = true; e.preventDefault(); }
});
document.addEventListener('pointerdown', (e) => {
  if (isNarrow() && !els.sidebar.hidden && !els.sidebar.contains?.(e.target) && !els.tocBtn.contains?.(e.target)) els.sidebar.hidden = true;
});

// Click any word on the page to start reading from there.
els.pages.addEventListener('click', e => {
  if (String(getSelection()).trim()) return;  // Read Aloud 2: selecting text (to highlight it) does not start reading
  if (notesUI.markAt(e.clientX, e.clientY)) return;  // a click on a saved highlight opens its menu (notes.js), the reading does not move
  const span = e.target.closest('.text-layer span');
  if (!span) return;
  const pageEl = span.closest('.page');
  const pageNumber = Number(pageEl.dataset.page);
  const entry = viewer.pages.get(pageNumber);
  if (!entry) return;

  // the character under the pointer, inside this span
  const caret = document.caretPositionFromPoint ? document.caretPositionFromPoint(e.clientX, e.clientY) : null;
  const offset = caret && span.contains(caret.offsetNode) ? caret.offset : 0;
  for (const [item, node] of entry.spans) {
    if (node !== span) continue;
    const target = state.itemToSentence.get(`${pageNumber}:${item}`);
    if (target !== undefined) {
      // Read Aloud 2: find that character in the paragraph's text, then step back to the start of its word
      const owners = state.sentences[target].charOwners || [];
      let at = owners.findIndex(o => o && o.page === pageNumber && o.item === item && o.offset >= offset);
      if (at < 0) at = owners.findIndex(o => o && o.page === pageNumber && o.item === item);
      const text = state.sentences[target].text;
      if (at > 0) while (at > 0 && !/\s/.test(text[at - 1])) at--;
      if (state.playing) stop();
      jumpTo(target, { resume: false });
      state.from = Math.max(0, at);
      play();
    }
    break;
  }
});

document.addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea')) return;
  // Ticket 21 review: a focused button or link keeps its own Space and arrows (Space must not click it AND play), and
  // so does each control of the settings panel. In the player bar Space stays Play or Pause (the mark button too).
  const t = e.target;
  if (t.closest?.('#settingsPanel') || (t.closest?.('button, a[href], summary') && !t.closest?.('#playerControls'))) return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  if (e.code === 'ArrowRight') { e.preventDefault(); jumpTo(state.index + 1); }
  if (e.code === 'ArrowLeft') { e.preventDefault(); jumpTo(state.index - 1); }
});

let dragDepth = 0;
window.addEventListener('dragenter', e => {
  e.preventDefault();
  if (++dragDepth === 1) els.dropVeil.classList.add('on');
});
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; els.dropVeil.classList.remove('on'); } });
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  els.dropVeil.classList.remove('on');
  const file = [...e.dataTransfer.files].find(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (file) openFile(file);
});

// One redraw path for every width change of the page column (ticket 08, review): a window resize, the Ask pane, the
// side bar. It waits 250 ms after the last change, redraws only when the column width really changed, and keeps the
// place in the book. rescale() of the viewer stretches the picture on screen by the right ratio until the new
// render is ready, so all pages end at one scale (relayout() measured the new scale first and stretched by 1).
let redrawTimer = null, drawnWidth = null;
function scheduleRedraw() {
  clearTimeout(redrawTimer);
  redrawTimer = setTimeout(() => {
    const w = els.scroller.clientWidth;
    if (w === drawnWidth) return;
    drawnWidth = w;
    const sc = els.scroller;
    const anchor = sc.scrollHeight ? sc.scrollTop / sc.scrollHeight : 0;
    viewer.rescale();
    // the word highlight and the sentence mark come back on the new pages (the viewer keeps them); the place stays
    requestAnimationFrame(() => { if (sc.scrollHeight) sc.scrollTop = Math.round(anchor * sc.scrollHeight); });
  }, 250);
}

let wasNarrow = isNarrow();
window.addEventListener('resize', () => {
  // On a narrow window the sidebar is an overlay. Hiding it only at load
  // meant rotating a phone left it covering the page you're reading.
  const narrow = isNarrow();
  if (narrow && !wasNarrow) els.sidebar.hidden = true;
  wasNarrow = narrow;
  scheduleRedraw();
});

if (typeof ResizeObserver === 'function') {
  let firstSize = true;
  new ResizeObserver(() => {
    if (firstSize) { firstSize = false; drawnWidth = els.scroller.clientWidth; return; }  // the first size: drawn at load
    scheduleRedraw();
  }).observe(els.scroller);
}

window.addEventListener('beforeunload', () => saveProgress());
// ticket 27: the page closes or goes to the background: the place goes to the voice server at once
window.addEventListener('pagehide', () => saveProgress(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveProgress(true); });

const savedRate = localStorage.getItem('pr.rate');
if (savedRate) els.rateSel.value = savedRate;
if (isNarrow()) els.sidebar.hidden = true;  // ticket 22 review: a narrow window starts with the side bar closed

/* --------------------------------------------------------------------- boot */

/**
 * Ask Chrome to stop treating our cached data as evictable. The voice model is
 * the big one — without this it gets cleared under disk pressure and the next
 * start re-downloads it. Must be called from the window, not a worker.
 */
async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return;
    if (await navigator.storage.persisted()) return;
    const granted = await navigator.storage.persist();
    if (!granted) {
      console.info('Storage persistence denied — the voice model may be evicted. '
        + 'Bookmarking this page usually makes Chrome grant it.');
    }
  } catch { /* not supported */ }
}

notesUI = setupNotes({ state, viewer, els, jumpTo, wordPartsAt, libId: LIB_ID, onChange: () => askUI.highlightsChanged() });

// Read Aloud 2: Claude's answers are read with the chosen voice, one piece at a time (ask.js keeps its own place
// and underlines the words); pressing Play goes back to the book.
const voice = {
  say(text, cb) {
    if (state.playing) stop();
    els.previewBtn.disabled = false;  // a preview that was playing is silent now
    engine.speak({ text, charOwners: [] }, { voiceId: els.voiceSel.value, rate: Number(els.rateSel.value), ...cb });
  },
  hush() { engine.stop(); },
};
els.playBtn.addEventListener('click', () => askUI.stopReading(), true);
askUI = setupAsk({ state, els, libId: () => (state.libBook ? LIB_ID : ''), jumpTo, highlights: () => notesUI.markdown(), voice });

// Read Aloud 2: scroll freely while it reads. Scrolling yourself stops the page from following the voice;
// the target button in the player takes you back to the word being read and follows again.
const findBtn = document.getElementById('findBtn');
const leaveVoice = () => { if (state.playing && viewer.follow !== false) { viewer.follow = false; findBtn.classList.add('away'); } };
els.scroller.addEventListener('wheel', leaveVoice, { passive: true });
els.scroller.addEventListener('touchmove', leaveVoice, { passive: true });
els.scroller.addEventListener('pointerdown', (e) => { if (e.offsetX > els.scroller.clientWidth) leaveVoice(); });  // the scroll bar
document.addEventListener('keydown', (e) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key) && !e.target.matches('input, select, textarea')) leaveVoice(); });
function followVoice() {
  viewer.follow = true; findBtn.classList.remove('away');
  if (viewer.lastWordBox && viewer.lastWordBox.isConnected) viewer.lastWordBox.scrollIntoView({ block: 'center', behavior: 'smooth' });
  else render();
}
findBtn.addEventListener('click', followVoice);

// Read Aloud 2: progress of the MP3 export, shown under the button
let exportTimer = null;
async function pollExport() {
  clearTimeout(exportTimer);
  let st; try { st = await (await fetch(`/library/${LIB_ID}/export`, { cache: 'no-store' })).json(); } catch { return; }
  const el = els.exportStatus;
  if (st.state === 'running' || st.state === 'starting') {
    const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    el.innerHTML = `Making audio: chapter ${st.chapter} of ${st.chapters}, ${pct}% · <a href="#" id="exportCancel">stop</a>`;
    el.querySelector('#exportCancel').onclick = (e) => { e.preventDefault(); fetch(`/library/${LIB_ID}/export/cancel`, { method: 'POST' }); };
    exportTimer = setTimeout(pollExport, 2000);
  } else if (st.state === 'done') {
    el.innerHTML = `Audio ready: ${st.files.length} files · <a href="#" id="exportOpen">show folder</a>`;
    el.querySelector('#exportOpen').onclick = (e) => { e.preventDefault(); fetch(`/library/${LIB_ID}/export/open`, { method: 'POST' }); };
  } else if (st.state === 'error') el.textContent = 'Export failed: ' + st.error;
  else if (st.state === 'cancelled') el.textContent = 'Export stopped.';
  else el.textContent = '';
}

(async function boot() {
  requestPersistentStorage();
  showZoom();
  await engines.system.init();
  fillVoiceSelect();

  // Kokoro is the point of this app, so start there unless told otherwise.
  // Read Aloud 2: natural voices unless you picked the Mac voices yourself in the menu
  const savedEngine = localStorage.getItem('pr.engine.chosen') === 'system' ? 'system' : 'kokoro';
  els.engineSel.value = savedEngine;
  if (savedEngine !== 'system') await selectEngine(savedEngine);

  if (LIB_ID) {  // the desktop library: export the book as MP3 files, one per chapter
    els.exportBtn.hidden = false;
    els.exportBtn.addEventListener('click', async () => {
      if (!state.sentences.length || !state.libBook) return;
      if (!confirm('Make MP3 files of this book, one per chapter? It takes about a minute for each ten minutes of audio. The files go to Documents › Read Aloud Library › Audio.')) return;
      const secs = (state.sections || []).filter(s => s.level === 0 || !(state.sections || []).some(x => x.level === 0));
      const starts = secs.map(s => s.startSentence).filter(n => n > 0);
      const bounds = [0, ...new Set(starts)].sort((a, b) => a - b);
      const chapters = bounds.map((b, i) => {
        const end = bounds[i + 1] ?? state.sentences.length;
        const sec = secs.find(s => s.startSentence === b);
        return { title: sec ? sec.title : (i === 0 ? 'Beginning' : `Part ${i + 1}`), text: state.sentences.slice(b, end).map(s => s.text) };
      }).filter(c => c.text.length);
      const r = await fetch(`/library/${LIB_ID}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: document.title.replace(/ · Read Aloud 2$/, ''), voice: els.voiceSel.value, chapters }) });
      els.exportStatus.textContent = r.ok ? 'Export started…' : 'Export is already running.';
      pollExport();
    });
    pollExport();
  }
  if (LIB_ID) {  // the desktop library: a way back, and the book's "last read" time
    const back = document.getElementById('libraryBtn');
    back.hidden = false;
    back.addEventListener('click', () => { saveProgress(true); location.href = '/app/'; });  // ticket 27: sent before the library reads it
    fetch('/library/' + LIB_ID + '/opened', { method: 'POST' }).catch(() => {});
  }
  // Read Aloud 2: a PDF link opened in Chrome arrives here as ?file=<address>
  const src = new URLSearchParams(location.search).get('file');
  if (src) {
    try {
      const res = await fetch(src, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status);
      const name = new URLSearchParams(location.search).get('name') || decodeURIComponent(new URL(src, location.href).pathname.split('/').pop() || 'book.pdf');
      if (await openFile(new File([await res.arrayBuffer()], name, { type: 'application/pdf' }), { library: true })) document.title = name + ' · Read Aloud 2';
    } catch (err) {
      setStatus('Could not open this PDF (' + err.message + '). Use "Open PDF" to choose the file.');
    }
  }
})();
