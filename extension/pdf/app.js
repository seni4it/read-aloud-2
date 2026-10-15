import * as pdfjsLib from './vendor/pdf.mjs';
import { buildDocument } from './extract.js';
import { PdfViewer } from './viewer.js';
import { SystemEngine, ServerEngine } from './tts.js';
import { loadLexicon, repairStats } from './lexicon.js';
import { withOcr } from './ocr.js';
import { setupNotes } from './notes.js';

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
const LIB_ID = (new URLSearchParams(location.search).get('lib') || '').replace(/[^0-9a-f]/g, '');  // opened from the desktop library
const ICON_PLAY = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';

const els = {
  openBtn: $('openBtn'), sampleBtn: $('sampleBtn'), fileInput: $('fileInput'),
  docTitle: $('docTitle'), pages: $('pages'), scroller: $('scroller'), empty: $('empty'),
  player: $('player'), playBtn: $('playBtn'), playIcon: $('playIcon'),
  prevBtn: $('prevBtn'), nextBtn: $('nextBtn'), seek: $('seek'), pos: $('pos'),
  voiceSel: $('voiceSel'), rateSel: $('rateSel'), nowReading: $('nowReading'),
  toc: $('toc'), sidebar: $('sidebar'), tocBtn: $('tocBtn'), closeSidebar: $('closeSidebar'),
  parseBar: $('parseBar'), parseFill: $('parseFill'), parseText: $('parseText'),
  optCitations: $('optCitations'), optCaptions: $('optCaptions'), optRefs: $('optRefs'),
  optFrontMatter: $('optFrontMatter'),
  reparseBtn: $('reparseBtn'), dropVeil: $('dropVeil'),
  engineSel: $('engineSel'), engineStatus: $('engineStatus'), previewBtn: $('previewBtn'),
  zoomIn: $('zoomIn'), zoomOut: $('zoomOut'), zoomLevel: $('zoomLevel')
};

const viewer = window.__viewer = new PdfViewer(pdfjsLib, els.pages);
let notesUI = { reload() {} };  // Read Aloud 2: highlights, set up below once the page is ready

// Exposed for debugging in the console: window.__pr.sentences etc.
const state = window.__pr = {
  doc: null,
  docKey: null,
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

function setStatus(text) {
  els.engineStatus.textContent = text || '';
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
    setBusy(true, 'loading voice model…');
    try {
      await next.init(info => {
        setStatus(info.pct != null ? `${info.stage} ${info.pct}%` : info.stage + '…');
      });
      setStatus(engineLabel(next));
    } catch (err) {
      // Read Aloud 2: the voice server is down for a moment. Use the Mac voices meanwhile, but do not remember
      // that as your choice, and switch back by itself when the natural voices answer again.
      setStatus('Natural voices are not answering — using Mac voices for now');
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
  if (eng.id !== 'kokoro') return 'ready · ' + (eng.device || eng.id);
  if (eng.device === 'webgpu') return 'ready · GPU';
  if (eng.device === 'wasm') {
    return 'Kokoro is on the CPU here (~1 min/paragraph) — pick System voices to read now';
  }
  return 'ready · ' + (eng.device || eng.id);
}

function speakCurrent() {
  const full = state.sentences[state.index];
  if (!full) { stop(); return; }
  // Read Aloud 2: a click on a word starts there, not at the top of its paragraph
  const from = state.from || 0;
  state.from = 0;
  const sentence = from ? { ...full, text: full.text.slice(from) } : full;

  const readyLabel = engineLabel(engine);
  if (engine.id !== 'system') setStatus('generating…');
  let spoke = false;

  state.at = from;
  engine.speak(sentence, {
    voiceId: els.voiceSel.value,
    rate: Number(els.rateSel.value),
    onWord: (charIndex, charLength) => {
      if (!state.playing) return;
      if (!spoke) { spoke = true; setStatus(readyLabel); }
      state.at = charIndex + from;  // Read Aloud 2: the word being read, so Pause then Play goes on from here
      const parts = wordPartsAt(full, charIndex + from, charLength);
      if (parts.length) viewer.highlightWord(parts);
    },
    onEnd: () => {
      if (!state.playing) return;
      if (state.index + 1 >= state.sentences.length) { stop(); return; }
      // Rest before the next block. Without this the whole document runs
      // together as one breathless stream.
      const gap = (sentence.pauseAfter ?? 300) / Number(els.rateSel.value);
      clearTimeout(state.pauseTimer);
      state.pauseTimer = setTimeout(() => {
        if (!state.playing) return;
        state.index++;
        render();
        speakCurrent();
      }, gap);
    },
    onError: err => {
      console.warn('speech error', err);
      stop();
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
  // Read Aloud 2: after a pause, go on from the word you paused on, not from the top of the paragraph
  if (state.resumeAt && state.resumeAt.index === state.index && !state.from) {
    const text = state.sentences[state.index].text;
    let at = state.resumeAt.at;
    while (at > 0 && !/\s/.test(text[at - 1])) at--;
    state.from = at;
  }
  state.resumeAt = null;
  state.playing = true;
  els.playIcon.innerHTML = ICON_PAUSE;  // Read Aloud 2: the same icons as the web player
  els.playBtn.setAttribute('aria-label', 'Pause');
  speakCurrent();
}

function stop() {
  clearTimeout(state.pauseTimer);
  if (state.playing && state.at > 0) state.resumeAt = { index: state.index, at: state.at };
  state.playing = false;
  els.playIcon.innerHTML = ICON_PLAY;
  els.playBtn.setAttribute('aria-label', 'Play');
  engine.stop();
  viewer.clearWord();
  saveProgress();
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
  state.index = Math.max(0, Math.min(i, Math.max(0, state.sentences.length - 1)));
  render();
  if (resume && wasPlaying) {
    state.playing = true;
    speakCurrent();
  } else if (!resume) {
    state.playing = false;
    els.playIcon.innerHTML = ICON_PLAY;
    saveProgress();
    warmCurrent();
  }
}

/* ------------------------------------------------------------------- render */

function render() {
  const total = state.sentences.length;
  els.seek.max = String(Math.max(0, total - 1));
  els.seek.value = String(state.index);
  els.pos.textContent = `${total ? state.index + 1 : 0} / ${total}`;

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

function saveProgress() {
  if (!state.docKey) return;
  const sentence = state.sentences[state.index];
  const record = JSON.stringify({
    i: state.index,
    at: fingerprint(sentence && sentence.text)
  });
  try {
    localStorage.setItem('pr.pos.' + state.docKey, record);
    // Read Aloud 2 desktop library: how far you are, for the progress bar on the book's card
    if (LIB_ID) localStorage.setItem('ra2.lib.' + LIB_ID, JSON.stringify({ i: state.index, total: state.sentences.length, t: Date.now() }));
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

function loadProgress() {
  if (!state.docKey) return 0;
  const raw = localStorage.getItem('pr.pos.' + state.docKey);
  if (!raw) return 0;

  // Older saves were a bare number.
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    return 0;
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

async function openFile(file) {
  stop();
  const buffer = await file.arrayBuffer();
  state.buffer = buffer;
  state.fileName = file.name;
  state.docKey = await keyFor(file, buffer);
  els.docTitle.textContent = file.name;
  els.empty.hidden = true;
  els.player.hidden = false;

  // pdf.js takes ownership of the buffer, so hand it a copy each time.
  // pdf.js needs these to rasterise Type-1 and CID text. Without them the
  // render promise never settles — it waits forever on a fetch that can't
  // happen, and the page stays blank with no error.
  state.doc = await pdfjsLib.getDocument({
    data: buffer.slice(0),
    standardFontDataUrl: new URL('./vendor/standard_fonts/', import.meta.url).href,
    cMapUrl: new URL('./vendor/cmaps/', import.meta.url).href,
    cMapPacked: true
  }).promise;
  state.doc = await withOcr(state.doc, setStatus);  // Read Aloud 2: scanned pages are read with Vision
  await viewer.load(state.doc);

  await parseDocument();
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
  state.sentences = [];
  state.sections = [];
  state.itemToSentence.clear();
  state.index = 0;
  els.parseBar.hidden = false;

  // One pipeline, shared with test/run.html. A suite that reimplements this
  // can pass while the app is broken.
  const builder = await buildDocument(
    state.doc,
    {
      stripCitations: els.optCitations.checked,
      stripCaptions: els.optCaptions.checked,
      stopAtReferences: els.optRefs.checked
    },
    async (n, total, b) => {
      if (token !== state.parseToken) return false;   // superseded

      els.parseFill.style.width = Math.round((n / total) * 100) + '%';
      els.parseText.textContent =
        `Reading text — page ${n} of ${total} · ${b.sentences.length} sentences`;

      // Publish what we have so playback can start on page one.
      if (n % 3 === 0 || n === total || state.doc.__scanned) {
        state.sentences = b.sentences;
        state.sections = b.sections;
        renderToc();
        render();
        await new Promise(r => setTimeout(r, 0));   // let the UI breathe
      }
      return true;
    }
  );

  if (!builder) return;   // cancelled by a newer parse

  // buildDocument already finalized. Do not call it again — it is idempotent
  // today, and relying on that is how it stops being idempotent tomorrow.
  if (token !== state.parseToken) return;

  state.sentences = builder.sentences;
  state.sections = (await outlineSections(builder.sentences)) || builder.sections;
  buildClickIndex();
  notesUI.reload();  // Read Aloud 2: this document's highlights
  renderToc();

  // Skip the title/author front matter on first open: start at the Abstract
  // (or the first real section) rather than reading a list of names aloud.
  let startAt = 0;
  if (els.optFrontMatter.checked) {
    const first = state.sections.findIndex(sec =>
      /^(?:\d+(?:\.\d+)*\.?\s*)?(abstract|introduction|summary)\b/i.test(sec.title));
    if (first > 0) startAt = state.sections[first].startSentence;
  }

  const resumeAt = loadProgress();
  state.index = resumeAt > 0
    ? Math.min(resumeAt, Math.max(0, state.sentences.length - 1))
    : startAt;
  render();

  warmCurrent();
  const fixes = repairStats();
  els.parseText.textContent =
    `${state.sentences.length} sentences · ${state.sections.length} sections` +
    (fixes.repaired ? ` · ${fixes.repaired} ligature words repaired` : '') +
    (resumeAt ? ` · resumed at ${resumeAt + 1}` : '');
  els.parseFill.style.width = '100%';
  setTimeout(() => { if (token === state.parseToken) els.parseBar.hidden = true; }, 2500);
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
  const res = await fetch('./samples/sample-paper.pdf');
  const blob = await res.blob();
  openFile(new File([blob], 'sample-paper.pdf', { type: 'application/pdf' }));
});

els.playBtn.addEventListener('click', toggle);
els.prevBtn.addEventListener('click', () => jumpTo(state.index - 1));
els.nextBtn.addEventListener('click', () => jumpTo(state.index + 1));
els.seek.addEventListener('input', () => jumpTo(Number(els.seek.value), { resume: false }));
els.seek.addEventListener('change', () => { if (state.playing) jumpTo(Number(els.seek.value)); });

els.rateSel.addEventListener('change', () => {
  localStorage.setItem('pr.rate', els.rateSel.value);
  if (state.playing) { engine.stop(); speakCurrent(); }
});

els.voiceSel.addEventListener('change', () => {
  localStorage.setItem('pr.voice.' + engine.id, els.voiceSel.value);
  if (state.playing) { engine.stop(); speakCurrent(); }
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

for (const el of [els.optCitations, els.optCaptions, els.optRefs, els.optFrontMatter]) {
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

els.tocBtn.addEventListener('click', () => { els.sidebar.hidden = !els.sidebar.hidden; });
els.closeSidebar.addEventListener('click', () => { els.sidebar.hidden = true; });

// Click any word on the page to start reading from there.
els.pages.addEventListener('click', e => {
  if (String(getSelection()).trim()) return;  // Read Aloud 2: selecting text (to highlight it) does not start reading
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

let resizeTimer = null;
let wasNarrow = window.innerWidth < 820;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    // On a narrow window the sidebar is an overlay. Hiding it only at load
    // meant rotating a phone left it covering the page you're reading.
    const narrow = window.innerWidth < 820;
    if (narrow && !wasNarrow) els.sidebar.hidden = true;
    wasNarrow = narrow;
    viewer.relayout();
  }, 250);
});

window.addEventListener('beforeunload', saveProgress);

const savedRate = localStorage.getItem('pr.rate');
if (savedRate) els.rateSel.value = savedRate;
if (window.innerWidth < 820) els.sidebar.hidden = true;

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

notesUI = setupNotes({ state, viewer, els, jumpTo, wordPartsAt, libId: LIB_ID });

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

  if (LIB_ID) {  // the desktop library: a way back, and the book's "last read" time
    const back = document.getElementById('libraryBtn');
    back.hidden = false;
    back.addEventListener('click', () => { saveProgress(); location.href = '/app/'; });
    fetch('/library/' + LIB_ID + '/opened', { method: 'POST' }).catch(() => {});
  }
  // Read Aloud 2: a PDF link opened in Chrome arrives here as ?file=<address>
  const src = new URLSearchParams(location.search).get('file');
  if (src) {
    try {
      const res = await fetch(src, { credentials: 'include' });
      if (!res.ok) throw new Error(res.status);
      const name = new URLSearchParams(location.search).get('name') || decodeURIComponent(new URL(src, location.href).pathname.split('/').pop() || 'document.pdf');
      await openFile(new File([await res.arrayBuffer()], name, { type: 'application/pdf' }));
      document.title = name + ' · Read Aloud 2';
    } catch (err) {
      setStatus('Could not open this PDF (' + err.message + '). Use "Open PDF" to choose the file.');
    }
  }
})();
