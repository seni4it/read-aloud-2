// PDF text: characters, units and hyphens said correctly (extension/pdf/extract.js, lexicon.js).
// The speech text keeps every character that has a meaning, says degrees and the
// micro sign correctly, joins a word cut at a line end, keeps a real compound,
// keeps mathematical letters, breaks a sentence after a number, and keeps the
// ligature repair record of one document only. All lines here are made for the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as lexicon from '../../extension/pdf/lexicon.js';
import { buildDocument } from '../../extension/pdf/extract.js';
import { loadLexiconFromFile, DEFAULT_OPTIONS, PDF_DIR } from '../pdf-text/extract-text.mjs';

await loadLexiconFromFile(lexicon);

// A made PDF page: one text item for each line, in one column.
const item = ({ text, y, size = 10, x = 72 }) =>
  ({ str: text, transform: [size, 0, 0, size, x, y], width: text.length * size * 0.5, hasEOL: false });

const fakeDoc = pages => ({
  numPages: pages.length,
  async getPage(n) {
    const lines = pages[n - 1];
    return {
      async getTextContent() { return { items: lines.map(item) }; },
      getViewport: () => ({ width: 612, height: 792 })
    };
  }
});

// Body lines at the normal line spacing (14pt), from the top of the text block down.
const column = texts => texts.map((text, k) => ({ text, y: 700 - k * 14 }));

// Cut a long paragraph into lines of about 70 characters, at spaces.
function wrap(paragraph) {
  const lines = [];
  let line = '';
  for (const word of paragraph.split(' ')) {
    if (line && line.length + word.length + 1 > 70) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

const OPENING = 'the clinic kept a record of every visit and every treatment that was given to each patient';

const sentencesOf = async (pages, options = DEFAULT_OPTIONS) =>
  (await buildDocument(fakeDoc(pages), options)).sentences.map(s => s.text);
const read = async (pages, options) => (await sentencesOf(pages, options)).join(' ');

test('Cyrillic, Hebrew, Greek letters and £ € ¥ stay in the sentences', async () => {
  const text = await read([column([
    OPENING,
    'and the word привет and the word шалом written as שלום stayed in the',
    'record, with the letters η κ ν Γ Π Φ and the prices £5 and €6 and ¥7 too'
  ])]);
  for (const kept of ['привет', 'שלום', 'η', 'κ', 'ν', 'Γ', 'Π', 'Φ', '£', '€', '¥']) assert.ok(text.includes(kept), `lost ${kept}: ${text}`);
});

test("'37°C' gives 'degrees C' and '5 μm' gives 'micrometres'", async () => {
  const text = await read([column([
    OPENING,
    'and the samples were kept at 37°C in a filter of 5 μm for one day'
  ])]);
  assert.match(text, /37 degrees C\b/);
  assert.match(text, /five micrometres/);
});

test("a Greek mu that is not a unit stays the letter mu: 'μOR', 'the μ value'", async () => {
  const text = await read([column([OPENING, 'and the μOR receptor and the μ value and 2 μg and 3μs were noted for each patient'])]);
  assert.match(text, /the muOR receptor and the mu value/);
  assert.match(text, /2 µg and 3µs/);
});

test('emoji and other pictographs are not read; signs with a meaning stay', async () => {
  const text = await read([column([OPENING, 'and the patients 😀 liked it 👍🏽 and the room ☎ was at 21° with a 🇮🇹 flag ✓ on the wall'])]);
  assert.match(text, /the patients liked it and the room was at 21 degrees with a flag on the wall/);
});

test('mathematical letters stay in the sentences', async () => {
  const text = await read([column([OPENING, 'and the value of 𝑥 and of 𝑦 was the same in each group of patients'])]);
  assert.match(text, /value of x and of y was/);
});

for (const [name, cut] of [['a hyphen', 'exam-'], ['a hyphen and a space', 'exam- '], ['a soft hyphen', 'exam­'], ['a hyphen sign U+2010', 'exam‐']]) {
  test(`'exam' + ${name} + 'ination' gives 'examination'`, async () => {
    const text = await read([column([OPENING, `and each patient had a full ${cut}`, 'ination of the teeth and of the gums at every visit to the clinic'])]);
    assert.match(text, /a full examination of the teeth/);
  });
}

test("a prefix before the same vowel keeps its hyphen: 're-' + 'entry', 'co-' + 'operation', 'pre-' + 'existing'", async () => {
  const text = await read([column([
    OPENING,
    'and the re-',
    'entry of each patient and the co-',
    'operation of the team and the pre-',
    'existing records were all kept in one place at the clinic'
  ])]);
  assert.match(text, /the re-entry of/);
  assert.match(text, /the co-operation of/);
  assert.match(text, /the pre-existing records/);
});

test("a word cut after a prefix is joined: 're-' + 'search', 're-' + 'port', 'infor-' + 'mation'", async () => {
  const text = await read([column([
    OPENING,
    'and the re-',
    'search of the team gave a re-',
    'port with all the infor-',
    'mation that the clinic had kept on each of the patients'
  ])]);
  assert.match(text, /the research of the team gave a report with all the information that/);
});

test("'evidence-' + 'based' gives 'evidence-based'; 'well-' + 'known' gives 'well-known'", async () => {
  const text = await read([column([
    OPENING,
    'and each treatment was evidence-',
    'based and followed the methods that were well-',
    'known to every dentist who worked in the clinic in those years'
  ])]);
  assert.match(text, /was evidence-based and/);
  assert.match(text, /were well-known to every/);
});

const LONG_A = 'The clinic kept a record of every visit and every treatment that was given to each patient, and the record showed the age of the patient, the teeth that were treated, the material that was used, the time that the treatment took and the name of the dentist who did it, so that the team could look back at the results of each method over many years and compare one group of patients with another group that came in the same months of the following year, and the number of patients in the first group was 120.';
const LONG_B = 'The next group was larger than the first group, and its patients came from the town and from the villages around the town, so the team had to plan more visits for each week of the year and more time for each visit.';

test("'…was 120. The next…' is two sentences", async () => {
  const sentences = await sentencesOf([column(wrap(`${LONG_A} ${LONG_B}`))]);
  assert.ok(sentences.some(s => s.endsWith('was 120.')), sentences.join('\n'));
});

// A guard: a year is said in words ("twenty nineteen") before the sentences are cut, so this passed before too.
test("'…in 2019. The next…' is two sentences", async () => {
  const sentences = await sentencesOf([column(wrap(`${LONG_A.replace('was 120.', 'came in 2019.')} ${LONG_B}`))]);
  assert.ok(sentences.some(s => s.endsWith('in twenty nineteen.')), sentences.join('\n'));
});

for (const end of ['on p. 12.', 'in Fig. 2.', 'in the year 2150.']) {
  test(`'…${end} The next…' is two sentences`, async () => {
    const sentences = await sentencesOf([column(wrap(`${LONG_A.replace('was 120.', 'was shown ' + end)} ${LONG_B}`))]);
    assert.ok(sentences.some(s => s.endsWith(end)), sentences.join('\n'));
  });
}

// "1." is cut off as a sentence of its own only when the next sentence is too long to join it in one block,
// and a sentence with no letter is not read: so the next sentence here is long.
test("'1. First item' is not cut after '1.'", async () => {
  const sentences = await sentencesOf([column(wrap(`1. First item: ${LONG_A.toLowerCase()} ${LONG_B.toLowerCase()}`))]);
  assert.ok(sentences[0].startsWith('1. First item'), sentences.join('\n'));
  assert.ok(!sentences.some(s => s.trim() === '1.'), sentences.join('\n'));
});

test("a list marker inside a paragraph stays with its item: '…length 4. 25/.04 to length 5. 25/.06…'", async () => {
  // This sentence fills most of one block (600 characters), so a block ends inside the list.
  const first = `In the first years of the study, and in all the years after it, ${LONG_A[0].toLowerCase()}${LONG_A.slice(1)}`;
  const sentences = await sentencesOf([column(wrap(`${first} 4. 25/.04 to length 5. 25/.06 to length 6. ${LONG_B}`))]);
  sentences.forEach((s, k) => {
    if (/\s\d{1,2}\.$/.test(s) && sentences[k + 1]) assert.match(sentences[k + 1], /^[A-Z]/, sentences.join('\n'));
  });
});

test("a list marker after a sentence end is not cut: 'First item. 2. Second item'", async () => {
  const sentences = await sentencesOf([column(wrap(`1. The first item is short. 2. ${LONG_A}`))]);
  assert.ok(!sentences.some(s => /(^|\s)2\.$/.test(s)), sentences.join('\n'));
  assert.match(sentences.join(' '), /2\. The clinic kept/);
});

// Words that lost "ti" because the PDF drew it as one sign: each one has a single reading, so each casts a vote.
const LOST_TI = 'emoons condional condion staon posion queson attenon soluon relaon funcon secon addion menon';

test('a second document does not use the ligature votes of the first', async () => {
  // "naon" has more than one reading; only a document whose own record shows lost "ti" settles it as "nation".
  const first = await read([column([OPENING, `and the words ${LOST_TI} and the naon were in it`])]);
  assert.match(first, /the nation were/);
  const second = await read([column([OPENING, 'and the word naon was in it'])]);
  assert.match(second, /the word naon was/);
});

test("a code word with a digit is not taken for a lost ligature: 'mul3' stays 'mul3'", async () => {
  // The document's record shows many lost "ti", which settles "mul3" as "multi" if the 3 counts as a lost sign.
  const text = await read([column([OPENING, `and the words ${LOST_TI} were in it, and the code v13 := mul3, 7 was in it`])]);
  assert.match(text, /mul3, 7/);
});

test('the word list is loaded again after a failed load', async () => {
  const fresh = await import('../../extension/pdf/lexicon.js?retry');
  const words = await readFile(`${PDF_DIR}/vendor/lexicon.txt`, 'utf8');
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return { ok: false, status: 503 };
    return { ok: true, text: async () => words };
  };
  try {
    await assert.rejects(fresh.loadLexicon('lexicon.txt'));
    await fresh.loadLexicon('lexicon.txt');
    assert.equal(fresh.lexiconReady(), true);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a paragraph that ends in 'word-' (a break right after the hyphen) does not give the hyphen to the voice", async () => {
  const sentences = await sentencesOf([[
    ...column([OPENING, 'and each patient was part of the long-']),
    { text: 'term study of the clinic, in a smaller type than the text above it was set', y: 660, size: 8 }
  ]]);
  assert.ok(sentences.some(s => /part of the long$/.test(s)), sentences.join(' | '));
  assert.ok(!sentences.some(s => /-$/.test(s)), 'no sentence ends in a hyphen');
});

test("a dash at a paragraph end after a space stays: 'the text -' is not a cut word", async () => {
  const sentences = await sentencesOf([[...column([OPENING, 'and the list ended with x-y and a dash -'])]]);
  assert.ok(sentences.some(s => /x-y and a dash -$/.test(s)), sentences.join(' | '));
});
