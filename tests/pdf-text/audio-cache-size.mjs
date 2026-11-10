// How much sound the sound memory of the reader holds, and how many Sentences fit in it. No voice server is needed.
// Only numbers are printed: no text and no file names.
//
// Where the numbers come from (read from the source files below, so they cannot drift; the script stops when one
// is not found):
//  - LIMIT, the bytes kept: extension/pdf/tts.js, `export const SOUND_MEMORY_MB = 64;` (1 MB = 1024 * 1024 bytes).
//    The memory takes the least recently used Sentence out first. The Sentence that plays and the Read-ahead never
//    go out, so the memory can be over the limit by at most those three Sentences (ticket 28).
//  - RATE, the samples a second: extension/pdf/tts.js, ServerEngine decodes the WAV of the voice server with
//    `new OfflineAudioContext(1, 1, 24000)`. The cache keeps `b.getChannelData(0)`: a Float32Array, 4 bytes a sample.
//    (KokoroEngine, the voice model in the page, keeps the sample rate its worker gives; the voice is the same model
//    at 24 kHz.)
//  - WPM, the words a minute at speed 1: extension/pdf/app.js, `const WPM = 160` (not exported; app.js cannot be
//    imported in Node, it needs the page).
// The sentences are the reader's own sentences of each PDF: tests/pdf-text/extract-text.mjs runs extract.js with
// the vendored pdf.js, as compare.mjs does. A sentence of the reader is often a whole paragraph.
//   node tests/pdf-text/audio-cache-size.mjs            the public samples
//   node tests/pdf-text/audio-cache-size.mjs --private  also the private books (see docs/testing.md)
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PUBLIC_SET, privateSet, listPdfs } from './compare.mjs';
import { sentencesOf } from './extract-text.mjs';

const source = (file) => readFileSync(fileURLToPath(new URL('../../extension/pdf/' + file, import.meta.url)), 'utf8');
function one(text, re, what) {
  const found = [...new Set([...text.matchAll(re)].map((m) => Number(m[1])))];
  if (found.length !== 1) throw new Error(`${what}: expected one value, found ${found.length ? found.join(', ') : 'none'}`);
  return found[0];
}
const TTS = source('tts.js');
const LIMIT = one(TTS, /export const SOUND_MEMORY_MB = (\d+);/g, 'SOUND_MEMORY_MB in tts.js') * 1024 * 1024;
const RATE = one(TTS, /new OfflineAudioContext\(1, 1, (\d+)\)/g, 'the sample rate in tts.js');
const WPM = one(source('app.js'), /const WPM = (\d+);/g, 'WPM in app.js');
const BYTES = 4;  // Float32Array
const words = (s) => s.split(/\s+/).filter(Boolean).length;
const seconds = (s) => (words(s) / WPM) * 60;
const mb = (b) => (b / 1024 / 1024).toFixed(1) + ' MB';  // 1 MB = 1024 * 1024 bytes, as SOUND_MEMORY_MB

console.log(`limit of the sound memory: ${mb(LIMIT)} (${(LIMIT / (RATE * BYTES) / 60).toFixed(1)} minutes of speech)`);
const sets = [PUBLIC_SET, ...(process.argv.includes('--private') ? [privateSet()] : [])];
for (const set of sets) {
  const lengths = [];
  for (const pdf of await listPdfs(set.pdfs)) lengths.push(...(await sentencesOf(path.join(set.pdfs, pdf))).map(seconds));
  if (!lengths.length) { console.log(`${set.name}: no PDF`); continue; }
  lengths.sort((a, b) => a - b);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const at = (q) => lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * q))];
  const bytes = (s) => s * RATE * BYTES;
  // How many Sentences fit: of the usual length, and of the longest (the fewest that fit).
  const usual = Math.floor(LIMIT / bytes(mean));
  let fewest = 0;
  for (let used = 0, i = lengths.length - 1; i >= 0 && used + bytes(lengths[i]) <= LIMIT; i--) { used += bytes(lengths[i]); fewest++; }
  // Most held, an estimate: the limit, plus the three longest Sentences when they are the one that plays and the
  // Read-ahead. The voice server engine splits a Sentence of 12 words or more in two pieces (ServerEngine.parts), and
  // a Sentence that is started at a clicked word is a new, shorter text, so the true figure can differ a little.
  const most = LIMIT + bytes(lengths.slice(-3).reduce((a, b) => a + b, 0));
  console.log(`${set.name}: ${lengths.length} sentences; seconds of speech a sentence: mean ${mean.toFixed(1)}, ` +
    `median ${at(0.5).toFixed(1)}, 95% ${at(0.95).toFixed(1)}, longest ${lengths.at(-1).toFixed(1)}`);
  console.log(`  one sentence: mean ${mb(bytes(mean))}, longest ${mb(bytes(lengths.at(-1)))}; ` +
    `the memory holds about ${usual} usual sentences, at least ${fewest} (the longest); at most about ${mb(most)} ` +
    `(an estimate: the limit and the 3 longest sentences, when they play and are read ahead)`);
}
