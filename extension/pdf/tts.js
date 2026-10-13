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
  let cursor = 0;

  const tick = () => {
    const elapsed = ctx.currentTime - startedAt;
    while (cursor < schedule.length && schedule[cursor].at <= elapsed) {
      const s = schedule[cursor++];
      onWord?.(s.start, s.end - s.start);
    }
    if (cursor < schedule.length) nextTick(handle, tick);
  };
  nextTick(handle, tick);

  source.onended = () => {
    cancelTick(handle);
    if (handle.source === source) { handle.source = null; onEnd?.(); }
  };

  handle.source = source;
  source.start();
}

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
    this.cache = new Map();
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
    const key = voiceId + '\u0000' + sentence.text;
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.inflight.has(key)) return this.inflight.get(key);

    const id = this.nextId++;
    const job = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'generate', id, text: sentence.text, voice: voiceId });
    }).then(data => {
      this.cache.set(key, data);
      // Keep the cache from growing without bound on a long book.
      if (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value);
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
    this.render(sentence, voiceId).catch(() => {});
  }

  async speak(sentence, { voiceId, rate, onWord, onEnd, onError }) {
    this.stop();
    const token = this.token;
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

/**
 * Kokoro running natively on this Mac (voice-server.py, port 8793) instead of in the browser:
 * no 312 MB download, and several times faster. Same playback and word timing as KokoroEngine.
 */
export class ServerEngine extends KokoroEngine {
  static SERVER = 'http://127.0.0.1:8793';

  constructor() {
    super();
    this.label = 'Natural voice (on your Mac)';
    this.voices = KokoroEngine.VOICES;
  }

  get available() { return true; }

  init() {
    if (this.ready) return Promise.resolve(true);
    return fetch(ServerEngine.SERVER + '/voices').then(r => r.json()).then(({ voices }) => {
      this.voices = voices.map(v => ({ id: v.id, label: `${v.label} · ${v.accent}` }));
      this.ready = true;
      return true;
    }).catch(() => { throw new Error('the voice server on this Mac is not running'); });
  }

  listVoices() { return this.voices; }

  async render(sentence, voiceId, ahead = false) {
    const key = voiceId + '\u0000' + sentence.text;
    if (this.cache.has(key)) return this.cache.get(key);
    if (this.inflight.has(key)) return this.inflight.get(key);
    const url = `${ServerEngine.SERVER}/speak?voice=${encodeURIComponent(voiceId)}&text=${encodeURIComponent(sentence.text)}${ahead ? '&ahead=3' : ''}`;
    const job = fetch(url).then(r => { if (!r.ok) throw new Error('voice server: ' + r.status); return r.arrayBuffer(); })
      .then(buf => Promise.all([new OfflineAudioContext(1, 1, 24000).decodeAudioData(buf),
        fetch(url.replace('/speak?', '/times?')).then(r => r.json()).catch(() => ({}))]))
      .then(([b, t]) => {
        const data = { audio: b.getChannelData(0), sampleRate: b.sampleRate, starts: t.starts || null };
        this.cache.set(key, data);
        if (this.cache.size > 60) this.cache.delete(this.cache.keys().next().value);
        this.inflight.delete(key);
        return data;
      })
      .catch(err => { this.inflight.delete(key); throw err; });
    this.inflight.set(key, job);
    return job;
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
    if (sentence) for (const p of ServerEngine.parts(sentence.text)) this.render(p, voiceId, true).catch(() => {});
  }

  async speak(sentence, { voiceId, rate, onWord, onEnd, onError }) {
    this.stop();
    const token = this.token;
    const parts = ServerEngine.parts(sentence.text);
    const jobs = parts.map((p) => this.render(p, voiceId));  // the first is asked for first
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    try {
      for (let k = 0; k < parts.length; k++) {
        const { audio, sampleRate, starts } = await jobs[k];
        if (token !== this.token) return;
        const buffer = this.ctx.createBuffer(1, audio.length, sampleRate);
        buffer.copyToChannel(audio, 0);
        const at = parts[k].at;
        await new Promise((done) => playBuffer(this.ctx, buffer, { ...parts[k], starts }, rate, this.handle,
          { onWord: (start, len) => onWord?.(start + at, len), onEnd: done }));
        if (token !== this.token) return;
      }
      onEnd?.();
    } catch (err) {
      if (token === this.token) onError?.(err.message || String(err));
    }
  }
}
