// Three speech engines behind one interface.
//   system — the browser's built-in speechSynthesis. Instant, offline, free,
//            always available. The voices are what they are.
//   kokoro — Kokoro-82M (Apache-2.0), running in a Web Worker via ONNX.
//            ~90 MB once, then offline forever. Free.
//            about a cent a page.
// All three report word boundaries so the page can highlight the word being
// said. speechSynthesis gives real boundary events; the two buffer engines
// return a finished waveform, so word timings are estimated from its length.

/** Split a sentence into word ranges: [{start, end, weight}] */
function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 1;
  // Rough but effective: count vowel groups, drop silent trailing "e",
  // and never go below one.
  const groups = w.replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups ? groups.length : 1);
}

function wordRanges(text) {
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const word = m[0];
    // Syllables track spoken duration much more closely than characters do.
    let weight = syllables(word) * 2.6 + 1;
    if (/[,;:]$/.test(word)) weight += 2.5;
    if (/[.!?]["')\]]?$/.test(word)) weight += 5;
    out.push({ start: m.index, end: m.index + word.length, weight });
  }
  return out;
}

/**
 * Generated clips open and close with a little silence. Measuring it removes
 * a constant offset between the audio and the moving highlight.
 */
function voicedSpan(buffer) {
  const data = buffer.getChannelData(0);
  const threshold = 0.012;
  const step = Math.max(1, Math.floor(buffer.sampleRate / 400));
  let first = 0;
  let last = data.length - 1;
  for (let i = 0; i < data.length; i += step) {
    if (Math.abs(data[i]) > threshold) { first = i; break; }
  }
  for (let i = data.length - 1; i >= 0; i -= step) {
    if (Math.abs(data[i]) > threshold) { last = i; break; }
  }
  return {
    start: first / buffer.sampleRate,
    duration: Math.max(0.1, (last - first) / buffer.sampleRate)
  };
}

/* ------------------------------------------------------------------ system */

export class SystemEngine {
  constructor() {
    this.id = 'system';
    this.label = 'System voices';
    this.synth = window.speechSynthesis;
    this.voices = [];
    this.current = null;
    this.keepAlive = null;
  }

  get available() {
    return !!this.synth;
  }

  async init() {
    this.voices = await this.#loadVoices();
    return true;
  }

  #loadVoices() {
    return new Promise(resolve => {
      const read = () => this.synth.getVoices();
      let list = read();
      if (list.length) return resolve(list);
      const onChange = () => {
        list = read();
        if (list.length) {
          this.synth.removeEventListener('voiceschanged', onChange);
          resolve(list);
        }
      };
      this.synth.addEventListener('voiceschanged', onChange);
      setTimeout(() => resolve(read()), 1500);
    });
  }

  listVoices() {
    // Rank the good ones first: enhanced/premium system voices are a large
    // step up from the default compact ones and users rarely find them.
    const score = v => {
      let s = 0;
      if (/premium|enhanced|neural|natural/i.test(v.name)) s += 10;
      if (/siri/i.test(v.name)) s += 8;
      if (v.lang.toLowerCase().startsWith('en')) s += 5;
      if (v.localService) s += 2;
      return s;
    };
    // macOS exposes ~180 voices, most of them novelty ("Bubbles", "Zarvox")
    // or other languages. Show only the handful worth reading a paper in.
    const novelty = /bad news|good news|bahh|bells|boing|bubbles|cellos|jester|organ|superstar|trinoids|whisper|wobble|zarvox|albert|fred|junior|kathy|ralph|grandma|grandpa|eddy|flo|reed|rocko|sandy|shelley/i;

    return [...this.voices]
      .filter(v => v.lang.toLowerCase().startsWith('en') && !novelty.test(v.name))
      .sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name))
      .slice(0, 6)
      .map(v => ({
        id: v.voiceURI,
        label: `${v.name} (${v.lang})${/premium|enhanced/i.test(v.name) ? ' ★' : ''}`
      }));
  }

  async speak(sentence, { voiceId, rate, onWord, onEnd, onError }) {
    this.stop();
    const u = new SpeechSynthesisUtterance(sentence.text);
    const voice = this.voices.find(v => v.voiceURI === voiceId);
    if (voice) u.voice = voice;
    u.rate = rate;

    u.onboundary = e => {
      if (e.name && e.name !== 'word') return;
      onWord?.(e.charIndex, e.charLength || 0);
    };
    u.onend = () => { this.#stopKeepAlive(); onEnd?.(); };
    u.onerror = e => {
      this.#stopKeepAlive();
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      onError?.(e.error);
    };

    this.current = u;
    this.synth.speak(u);

    // Chrome stops speaking after ~15 s unless nudged.
    this.#stopKeepAlive();
    this.keepAlive = setInterval(() => {
      if (this.synth.speaking && !this.synth.paused) {
        this.synth.pause();
        this.synth.resume();
      }
    }, 9000);
  }

  #stopKeepAlive() {
    clearInterval(this.keepAlive);
    this.keepAlive = null;
  }

  stop() {
    this.#stopKeepAlive();
    if (this.current) this.current.onend = null;
    this.current = null;
    this.synth.cancel();
  }

  prefetch() { /* nothing to do */ }
}

/* ------------------------------------------------- shared buffer playback */

/**
 * Lay a sentence's words across an audio clip by weight. Neither Kokoro nor
 * Kokoro returns word timings, so we estimate them — it tracks closely
 * enough that the moving highlight reads as in sync.
 */
function scheduleWords(text, duration) {
  const words = wordRanges(text);
  const total = words.reduce((a, w) => a + w.weight, 0) || 1;
  let acc = 0;
  return words.map(w => {
    const at = (acc / total) * duration;
    acc += w.weight;
    return { at, start: w.start, end: w.end };
  });
}

/** rAF is frozen in background tabs, but the audio keeps playing. */
function nextTick(handle, fn) {
  handle.tickIsTimer = document.hidden;
  handle.raf = handle.tickIsTimer ? setTimeout(fn, 120) : requestAnimationFrame(fn);
}

function cancelTick(handle) {
  clearTimeout(handle.tail);
  handle.tail = null;
  if (handle.raf == null) return;
  if (handle.tickIsTimer) clearTimeout(handle.raf);
  else cancelAnimationFrame(handle.raf);
  handle.raf = null;
}

/** Plays an AudioBuffer, firing onWord as the estimated schedule advances. */
function playBuffer(ctx, buffer, sentence, rate, handle, { onWord, onEnd }) {
  // If anything is still sounding, silence it before starting — two overlapping
  // sources is exactly what "it read the paragraph twice" sounds like.
  if (handle.source) {
    const previous = handle.source;
    handle.source = null;
    previous.onended = null;
    try { previous.stop(); } catch { /* already stopped */ }
  }
  cancelTick(handle);

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = rate;
  source.connect(ctx.destination);

  const voiced = voicedSpan(buffer);
  let schedule = scheduleWords(sentence.text, voiced.duration / rate)
    .map(w => ({ ...w, at: w.at + voiced.start / rate }));
  // Read Aloud 2: Kokoro's own word times from the Mac's voice server, when it gave them (English voices)
  const starts = sentence.starts;
  if (Array.isArray(starts) && starts.length === schedule.length && starts.some(s => s !== null)) {
    schedule = schedule.map((w, i) => (starts[i] === null ? null : { ...w, at: starts[i] / rate })).filter(Boolean);
  }
  const startedAt = ctx.currentTime;
  // The ear hears the sound this much later than the clock says (Bluetooth headphones: about 0.2 s).
  const delay = ctx.outputLatency || ctx.baseLatency || 0;
  let cursor = 0;

  const tick = () => {
    const elapsed = ctx.currentTime - startedAt - delay;
    while (cursor < schedule.length && schedule[cursor].at <= elapsed) {
      const s = schedule[cursor++];
      onWord?.(s.start, s.end - s.start);
    }
    if (cursor < schedule.length) nextTick(handle, tick);
  };
  nextTick(handle, tick);

  // The clip ends; the ear hears its end `delay` later. The words go on until then, and then the sentence ends.
  source.onended = () => {
    if (handle.source !== source) return;
    handle.tail = setTimeout(() => {
      handle.tail = null;
      if (handle.source !== source) return;
      tick();
      cancelTick(handle);
      while (cursor < schedule.length) { const s = schedule[cursor++]; onWord?.(s.start, s.end - s.start); }
      handle.source = null;
      onEnd?.();
    }, delay * 1000);
  };

  handle.source = source;
  source.start();
}

/* ------------------------------------------------------------ sound memory */

/**
 * The most sound the reader keeps, in MB (1 MB = 1024 * 1024 bytes). The voice server sends 24 kHz samples and the
 * reader keeps them as Float32 (4 bytes), so 64 MB is about 11 minutes of speech: many Sentences, also when a
 * Sentence is a long paragraph. Before (ticket 28) the reader kept 60 Sentences: about 96 MB, and up to 234 MB.
 */
export const SOUND_MEMORY_MB = 64;

/** The bytes that one kept sound holds: its samples (Float32Array, 4 bytes a sample, one channel). */
function soundBytes(data) {
  const a = data?.audio;
  if (!a) return 0;
  // A view on a larger buffer keeps the whole buffer: count what is held, never less than the samples.
  return Math.max(a.byteLength || 0, a.buffer?.byteLength || 0);
}

/**
 * The sound of Sentences that the reader keeps, so that a Sentence read again or made as Read-ahead does not wait
 * for the voice. A Map with a limit in bytes: when the memory is over the limit (after a new sound, or when a new
 * Sentence starts), the least recently used sounds go out first. The sounds of the Sentence that plays now (need) and
 * of the Read-ahead (alsoNeed) never go out, so no silence comes between Sentences; when they alone are over the limit
 * they all stay, and they go out later, when they are no longer needed. So one Sentence larger than the limit plays.
 * There is no limit by count: the bytes are what costs, and a count limit could only take out needed Read-ahead.
 */
export class SoundMemory {
  static AHEAD = 2;  // the reader asks Read-ahead for the next 2 Sentences (app.js speakCurrent and warmCurrent)

  constructor(limit = SOUND_MEMORY_MB * 1024 * 1024) {
    this.limit = limit;
    this.bytes = 0;
    this.map = new Map();  // key -> sound; the oldest use first
    this.playing = new Set();
    this.ahead = [];       // the keys of the last AHEAD Read-ahead calls, the newest last
  }

  get size() { return this.map.size; }
  has(key) { return this.map.has(key); }
  keys() { return this.map.keys(); }
  values() { return this.map.values(); }

  /** The sound of key; a found sound counts as the newest use. */
  get(key) {
    const data = this.map.get(key);
    if (data !== undefined) { this.map.delete(key); this.map.set(key, data); }
    return data;
  }

  set(key, data) {
    this.delete(key);
    this.map.set(key, data);
    this.bytes += soundBytes(data);
    this.#trim();
    return this;
  }

  delete(key) {
    if (!this.map.has(key)) return false;
    this.bytes -= soundBytes(this.map.get(key));
    return this.map.delete(key);
  }

  /**
   * A new Sentence starts: its keys are needed now, and the Sentence that played before is no longer needed.
   * The Read-ahead stays needed: the reader can ask it before speak() (app.js warmCurrent while paused, then Play).
   * A Read-ahead entry that is now the Sentence that plays is taken off the Read-ahead list.
   */
  need(keys) {
    this.playing = new Set(keys);
    this.ahead = this.ahead.filter((ks) => !ks.every((k) => this.playing.has(k)));
    this.#trim();
  }

  /** The keys of one Read-ahead Sentence are needed next. Only the last AHEAD calls count. */
  alsoNeed(keys) {
    this.ahead.push([...keys]);
    if (this.ahead.length > SoundMemory.AHEAD) this.ahead.shift();
  }

  #needed(key) {
    return this.playing.has(key) || this.ahead.some((keys) => keys.includes(key));
  }

  // Takes the oldest sounds that are not needed out, until the memory is under the limit. It runs after set() and
  // need(). need() keeps the Read-ahead, so the next Sentences are still there when the reader asks them again just
  // after speak(). alsoNeed() takes nothing out: a Read-ahead entry that it replaces goes at the next set() or need().
  #trim() {
    for (const [key, data] of this.map) {
      if (this.bytes <= this.limit) return;
      if (this.#needed(key)) continue;
      this.map.delete(key);
      this.bytes -= soundBytes(data);
    }
  }
}

/** The key of the sound of text in voiceId (the sound memory and the open requests). */
const soundKey = (voiceId, text) => voiceId + '\u0000' + text;

export class KokoroEngine {
  // Kokoro ships 50-odd voices at wildly varying quality. These are the three
  // the model card grades highest for English; the rest are graded C or below
  // and aren't worth the menu space.
  static VOICES = [
    { id: 'af_heart', label: 'Heart — US female (A)' },
    { id: 'af_bella', label: 'Bella — US female (A-)' },
    { id: 'bf_emma', label: 'Emma — UK female (B-)' }
  ];

  constructor() {
    this.id = 'kokoro';
    this.label = 'Kokoro (natural, on-device)';
    this.worker = null;
    this.ctx = null;
    this.handle = { source: null, raf: null, tickIsTimer: false };
    this.cache = new SoundMemory();  // the sound of Sentences, limited by bytes (ticket 28)
    this.inflight = new Map();
    this.available_voices = null;
    this.ready = false;
    this.device = null;
    this.token = 0;
    this.nextId = 1;
    this.pending = new Map();
  }

  get available() {
    return typeof Worker !== 'undefined' && typeof WebAssembly === 'object';
  }

  /**
   * Boot the worker and load the model inside it. Nothing here touches the
   * main thread beyond message passing.
   */
  init(onProgress) {
    if (this.ready) return Promise.resolve(true);
    if (this.booting) return this.booting;

    this.booting = new Promise((resolve, reject) => {
      const url = new URL('./kokoro-worker.js', import.meta.url);
      this.worker = new Worker(url, { type: 'module' });

      this.worker.onmessage = event => {
        const msg = event.data;

        if (msg.type === 'progress') {
          onProgress?.({ stage: msg.stage, pct: msg.pct });
          return;
        }

        if (msg.type === 'ready') {
          this.ready = true;
          this.device = msg.device;
          if (msg.voices?.length) this.available_voices = new Set(msg.voices);
          onProgress?.({ stage: 'ready', device: msg.device });
          resolve(true);
          return;
        }

        if (msg.type === 'error') {
          this.booting = null;
          reject(new Error(msg.message));
          return;
        }

        if (msg.type === 'generated') {
          const waiter = this.pending.get(msg.id);
          if (!waiter) return;
          this.pending.delete(msg.id);
          if (msg.error) waiter.reject(new Error(msg.error));
          else waiter.resolve({ audio: msg.audio, sampleRate: msg.sampleRate });
        }
      };

      this.worker.onerror = err => {
        this.booting = null;
        reject(new Error(err.message || 'worker failed'));
      };

      this.worker.postMessage({ type: 'init' });
    });

    return this.booting;
  }

  listVoices() {
    if (!this.available_voices) return KokoroEngine.VOICES;
    const list = KokoroEngine.VOICES.filter(v => this.available_voices.has(v.id));
    return list.length ? list : KokoroEngine.VOICES;
  }

  #context() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  async render(sentence, voiceId) {
    if (!this.ready) throw new Error('voice model is still loading');
    const key = soundKey(voiceId, sentence.text);
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.inflight.has(key)) return this.inflight.get(key);

    const id = this.nextId++;
    const job = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'generate', id, text: sentence.text, voice: voiceId });
    }).then(data => {
      this.cache.set(key, data);  // the sound memory keeps it within its limit in bytes
      this.inflight.delete(key);
      return data;
    }).catch(err => {
      this.inflight.delete(key);
      throw err;
    });

    this.inflight.set(key, job);
    return job;
  }

  /** Warm the next block so playback doesn't gap between paragraphs. */
  prefetch(sentence, voiceId) {
    if (!this.ready || !sentence) return;
    this.cache.alsoNeed([soundKey(voiceId, sentence.text)]);
    this.render(sentence, voiceId).catch(() => {});
  }

  async speak(sentence, { voiceId, rate, onWord, onEnd, onError }) {
    this.stop();
    const token = this.token;
    this.cache.need([soundKey(voiceId, sentence.text)]);
    if (!this.ready) { onError?.('voice model is still loading'); return; }

    try {
      const { audio, sampleRate } = await this.render(sentence, voiceId);
      if (token !== this.token) return; // superseded while we were generating

      const ctx = this.#context();
      const buffer = ctx.createBuffer(1, audio.length, sampleRate);
      buffer.copyToChannel(audio, 0);

      playBuffer(ctx, buffer, sentence, rate, this.handle, { onWord, onEnd });
    } catch (err) {
      if (token !== this.token) return;
      console.error('kokoro speak', err);
      onError?.(err.message || String(err));
    }
  }

  stop() {
    this.token = (this.token || 0) + 1;
    cancelTick(this.handle);
    if (this.handle.source) {
      const s = this.handle.source;
      this.handle.source = null;
      s.onended = null;
      try { s.stop(); } catch { /* already stopped */ }
    }
  }
}

/* ------------------------------------------- Read Aloud 2: voices from this Mac */

/** An error that means: the voice server does not answer (connection refused, or no answer in the time limit). */
function notAnswering(message) {
  const err = new Error('the voice server does not answer: ' + message);
  err.down = true;
  return err;
}

/**
 * Kokoro running natively on this Mac (voice-server.py, port 8793) instead of in the browser:
 * no 312 MB download, and several times faster. Same playback and word timing as KokoroEngine.
 * When the server stops answering in the middle of a book, the Mac voice reads on; the natural voice comes back
 * at the start of a sentence when the server answers again.
 */
export class ServerEngine extends KokoroEngine {
  static SERVER = 'http://127.0.0.1:8793';
  static WAIT_MS = 30000;    // time limit for a sentence someone waits to hear
  static AHEAD_MS = 120000;  // time limit for read-ahead (the server makes it only when nobody waits)
  static INIT_MS = 3000;     // time limit for the voice list
  static RETRY_MS = 5000;    // while the server is down, ask it again at most this often, at a sentence start
  static MAC_LABEL = 'Mac voice (the natural voice does not answer)';

  constructor() {
    super();
    this.label = 'Natural voice (on your Mac)';
    this.voices = KokoroEngine.VOICES;
    this.requests = new Map();  // key -> { job, ac, ahead }: the voice requests that are open now
    this.down = false;          // true: the server did not answer, the Mac voice reads
    this.mac = null;
    this.wake = null;           // ends the wait of speak() for the sound that plays now
    this.asking = false;        // a question "are you back?" to the server is open or was asked a moment ago
  }

  get available() { return true; }

  /** fetch() that ac cancels; a refused connection is "does not answer". With ms: its own time limit. */
  static #ask(url, ac, ms = 0) {
    const timer = ms && setTimeout(() => ac.abort(notAnswering(`no answer in ${ms / 1000} s`)), ms);
    return fetch(url, { signal: ac.signal })
      .catch(err => { throw ac.signal.aborted ? ac.signal.reason : notAnswering(err.message); })
      .finally(() => clearTimeout(timer));
  }

  init() {
    if (this.ready) return Promise.resolve(true);
    return ServerEngine.#ask(ServerEngine.SERVER + '/voices', new AbortController(), ServerEngine.INIT_MS).then(r => r.json()).then(({ voices }) => {
      this.voices = voices.map(v => ({ id: v.id, label: `${v.label} · ${v.accent}` }));
      this.ready = true;
      return true;
    }).catch(() => { throw new Error('the voice server on this Mac is not running'); });
  }

  listVoices() { return this.voices; }

  render(sentence, voiceId, ahead = false) {
    const key = soundKey(voiceId, sentence.text);
    if (this.cache.has(key)) return Promise.resolve(this.cache.get(key));
    const open = this.requests.get(key);
    if (open) {
      if (!ahead && open.ahead) this.#want(open);
      return open.job;
    }
    const ac = new AbortController();
    const entry = { ac, ahead, voiceId, text: sentence.text, timer: null, tries: 0 };
    entry.job = new Promise((resolve, reject) => {
      Object.assign(entry, { resolve, reject });
      ac.signal.addEventListener('abort', () => reject(ac.signal.reason));
    }).then(data => {
      this.cache.set(key, data);  // the sound memory keeps it within its limit in bytes
      return data;
    }).catch(err => {
      if (err?.down) this.#fall();
      throw err;
    }).finally(() => {
      clearTimeout(entry.timer);
      if (this.requests.get(key) === entry) this.requests.delete(key);
    });
    this.requests.set(key, entry);
    this.#limit(entry);
    this.#try(entry, ahead);
    return entry.job;
  }

  /**
   * A sentence asked as read-ahead is wanted now. Its request stays open: the server may be making it already, and
   * a started sentence is never stopped. A second request without the read-ahead mark goes before newer read-ahead
   * on the server. The first answer counts; the server makes the sentence only once (it keeps what it made).
   * From now on the time limit of a wanted sentence counts.
   */
  #want(entry) {
    entry.ahead = false;
    this.#limit(entry);
    this.#try(entry, false);
  }

  /** A wanted sentence with no answer in time means the server is down; a late read-ahead only waited its turn. */
  #limit(entry) {
    clearTimeout(entry.timer);
    const ms = entry.ahead ? ServerEngine.AHEAD_MS : ServerEngine.WAIT_MS;
    const ahead = entry.ahead;
    entry.timer = setTimeout(() => entry.ac.abort(ahead ? new Error('read-ahead took too long')
      : notAnswering(`no answer in ${ms / 1000} s`)), ms);
  }

  /** One request for the sound and the word timing of entry; entry ends with the first answer, or the last failure. */
  #try(entry, ahead) {
    const { ac } = entry;
    const query = `voice=${encodeURIComponent(entry.voiceId)}&text=${encodeURIComponent(entry.text)}${ahead ? '&ahead=3' : ''}`;
    const get = path => ServerEngine.#ask(`${ServerEngine.SERVER}/${path}?${query}`, ac);
    entry.tries++;
    get('speak').then(r => { if (!r.ok) throw new Error('voice server: ' + r.status); return r.arrayBuffer(); })
      .then(buf => Promise.all([new OfflineAudioContext(1, 1, 24000).decodeAudioData(buf),
        // No word timing from the server: the timing is estimated. A cancel is not "no word timing".
        get('times').then(r => r.json()).catch(err => { if (ac.signal.aborted) throw ac.signal.reason; return {}; })]))
      .then(([b, t]) => entry.resolve({ audio: b.getChannelData(0), sampleRate: b.sampleRate, starts: t.starts || null }),
        err => { if (--entry.tries === 0) entry.reject(ac.signal.aborted ? ac.signal.reason : err); });
  }

  /** The server did not answer: the Mac voice reads, and the status says so. */
  #fall() {
    if (this.down) return;
    this.down = true;
    this.device = ServerEngine.MAC_LABEL;
    this.#wait();
  }

  #wait() {
    this.asking = true;
    setTimeout(() => { this.asking = false; }, ServerEngine.RETRY_MS);
  }

  /** At a sentence start while the server is down: ask it (at most every RETRY_MS) if it answers again. */
  #askBack() {
    if (this.asking) return;
    this.asking = true;
    ServerEngine.#ask(ServerEngine.SERVER + '/voices', new AbortController(), ServerEngine.INIT_MS)
      .then(r => { if (!r.ok) throw new Error('voice server: ' + r.status); this.down = false; this.device = null; this.asking = false; })
      .catch(() => this.#wait());
  }

  // A paragraph is spoken as its first five words, then the rest: the voice starts after the short piece
  // is made (about half a second) and the rest is made while it plays.
  static parts(text) {
    const words = [...text.matchAll(/\S+\s*/g)];
    if (words.length < 12) return [{ text, at: 0 }];
    const cut = words[5].index;
    return [{ text: text.slice(0, cut).trim(), at: 0 }, { text: text.slice(cut), at: cut }];
  }

  prefetch(sentence, voiceId) {
    if (!sentence || this.down) return;
    const parts = ServerEngine.parts(sentence.text);
    this.cache.alsoNeed(parts.map((p) => soundKey(voiceId, p.text)));
    for (const p of parts) this.render(p, voiceId, true).catch(() => {});
  }

  /** Read text with the Mac voice; `at` is where the text starts in the whole sentence (for the word highlight). */
  #macSpeak(text, at, { rate, onWord, onEnd, onError }) {
    if (!this.mac) this.mac = new SystemEngine();
    if (!this.mac.available) { onError?.('no voice answers'); return; }
    if (!this.mac.voices.length) this.mac.voices = this.mac.synth.getVoices();
    this.mac.speak({ text }, {
      voiceId: this.mac.listVoices()[0]?.id, rate,
      onWord: (start, len) => onWord?.(start + at, len), onEnd, onError
    });
  }

  async speak(sentence, opts) {
    const { voiceId, rate, onWord, onEnd, onError } = opts;
    this.#halt(false);
    const token = this.token;
    const parts = ServerEngine.parts(sentence.text);
    this.cache.need(parts.map((p) => soundKey(voiceId, p.text)));  // its sound never goes out of the memory while it plays
    if (this.down) {
      this.#askBack();  // the answer counts from the next sentence: a sentence is never cut in two voices
      this.#macSpeak(sentence.text, 0, opts);
      return;
    }
    const jobs = parts.map((p) => this.render(p, voiceId));  // the first is asked for first
    for (const j of jobs) j.catch(() => {});  // a failed second piece is handled below, not left unhandled
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    let k = 0;
    try {
      for (; k < parts.length; k++) {
        const { audio, sampleRate, starts } = await jobs[k];
        if (token !== this.token) return;
        const buffer = this.ctx.createBuffer(1, audio.length, sampleRate);
        buffer.copyToChannel(audio, 0);
        const at = parts[k].at;
        await new Promise((done) => {
          this.wake = done;  // stop() ends this wait: the sound's own end never comes then
          playBuffer(this.ctx, buffer, { ...parts[k], starts }, rate, this.handle,
            { onWord: (start, len) => onWord?.(start + at, len), onEnd: done });
        });
        if (token !== this.token) return;
      }
      onEnd?.();
    } catch (err) {
      if (token !== this.token) return;
      if (err?.down) this.#macSpeak(sentence.text.slice(parts[k].at), parts[k].at, opts);
      else onError?.(err.message || String(err));
    }
  }

  /** Silence; cancel the requests nobody wants now. all=false (a new sentence starts): keep the read-ahead. */
  #halt(all) {
    super.stop();
    this.mac?.stop();
    const wake = this.wake;
    this.wake = null;
    wake?.();
    for (const [key, r] of this.requests) {
      if (all || !r.ahead) { this.requests.delete(key); r.ac.abort(new Error('stopped')); }
    }
  }

  stop() { this.#halt(true); }
}
