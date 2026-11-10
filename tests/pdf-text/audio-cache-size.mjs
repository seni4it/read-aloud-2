// How much memory the audio cache of the reader holds. No voice server is needed. Only numbers are printed:
// no text and no file names.
//
// Where the numbers come from (read from the source files below, so they cannot drift; the script stops when one
// is not found):
//  - CACHE, the sentences kept: extension/pdf/tts.js, `this.cache.size > 60` in KokoroEngine.render() and in
//    ServerEngine.render() (a number inside a method, not exported).
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
const CACHE = one(TTS, /this\.cache\.size > (\d+)/g, 'the cache size in tts.js');
const RATE = one(TTS, /new OfflineAudioContext\(1, 1, (\d+)\)/g, 'the sample rate in tts.js');
const WPM = one(source('app.js'), /const WPM = (\d+);/g, 'WPM in app.js');
const BYTES = 4;  // Float32Array
const words = (s) => s.split(/\s+/).filter(Boolean).length;
const seconds = (s) => (words(s) / WPM) * 60;
const mb = (b) => (b / 1e6).toFixed(1) + ' MB';

const sets = [PUBLIC_SET, ...(process.argv.includes('--private') ? [privateSet()] : [])];
for (const set of sets) {
  const lengths = [];
  for (const pdf of await listPdfs(set.pdfs)) lengths.push(...(await sentencesOf(path.join(set.pdfs, pdf))).map(seconds));
  if (!lengths.length) { console.log(`${set.name}: no PDF`); continue; }
  lengths.sort((a, b) => a - b);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  const at = (q) => lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * q))];
  // the 60 longest sentences together: the most the cache can hold for these books
  const n = Math.min(CACHE, lengths.length);
  const worst = lengths.slice(-n).reduce((a, b) => a + b, 0);
  console.log(`${set.name}: ${lengths.length} sentences; seconds of speech a sentence: mean ${mean.toFixed(1)}, ` +
    `median ${at(0.5).toFixed(1)}, 95% ${at(0.95).toFixed(1)}, longest ${lengths.at(-1).toFixed(1)}`);
  console.log(`  one sentence: mean ${mb(mean * RATE * BYTES)}; cache of ${n}: usual ${mb(n * mean * RATE * BYTES)}, ` +
    `at most ${mb(worst * RATE * BYTES)} (the ${n} longest sentences)`);
}
