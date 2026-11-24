// PDF text: tables in a book of one column (extension/pdf/extract.js).
// A book of one column with tables of two columns ("[Lab evidence]" beside its meaning) was split at the table's
// gap: all the labels were read, then all the meanings, and the text below the table came out of order. A table in
// small type at the top of a page was dropped as a running head. All lines here are made for the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lexicon from '../../extension/pdf/lexicon.js';
import { buildDocument } from '../../extension/pdf/extract.js';
import { loadLexiconFromFile, DEFAULT_OPTIONS } from '../pdf-text/extract-text.mjs';

await loadLexiconFromFile(lexicon);

// A made text item: 0.5 of the type size for each letter.
const item = (text, x, y, size = 10) =>
  ({ str: text, transform: [size, 0, 0, size, x, y], width: text.length * size * 0.5, hasEOL: false });
const fakeDoc = (pages) => ({
  numPages: pages.length,
  async getPage(n) {
    return {
      async getTextContent() { return { items: pages[n - 1] }; },
      getViewport: () => ({ width: 612, height: 792 })
    };
  }
});

// Lines of running text, one column, 10pt. Each page gets its own words, so no line is a running head.
const FILL = [
  'the clinic kept a record of every visit and every treatment that',
  'was given, so that the clinic team could look back at the results',
  'and compare one group of clinic patients with another group that',
  'came to the clinic in the same months of the following year. The',
  'record of the clinic also kept the age of each patient and the',
  'number of visits that each one of them made to the clinic in all.'
];
const body = (place, top, x = 72) => FILL.map((t, k) => item(t.replaceAll('clinic', place), x, top - k * 14));
const textOf = (b) => b.sentences.map(s => s.text).join(' | ');
const before = (text, a, b) => {
  const i = text.indexOf(a), j = text.indexOf(b);
  assert.ok(i >= 0, `"${a}" is read`);
  assert.ok(j >= 0, `"${b}" is read`);
  assert.ok(i < j, `"${a}" is read before "${b}"`);
};

test('a one-column book: a table of labels and meanings reads each label with its meaning', async () => {
  const labels = ['[Lab evidence]', '[Clinical evidence]', '[Maker data]', '[Expert view]', '[Old data]', '[New data]',
    '[Guideline]', '[Unsure]'];
  const table = labels.flatMap((label, k) => [
    item(label, 72, 600 - k * 18, 8.6),
    item(`the meaning of label number ${k + 1} in words of its own.`, 230, 600 - k * 18, 8.6)
  ]);
  const doc = fakeDoc([
    [...body('school', 740), ...body('office', 656)],
    [...body('clinic', 740), ...table, ...body('garden', 440)],
    [...body('market', 740), ...body('harbour', 656)]
  ]);
  const b = await buildDocument(doc, DEFAULT_OPTIONS);
  const text = textOf(b);
  assert.equal(doc.__oneColumn, true, 'the book is one column');
  before(text, 'the clinic kept a record', 'Lab evidence');
  before(text, 'Lab evidence', 'the meaning of label number 1 in');
  before(text, 'the meaning of label number 1 in', 'Clinical evidence');
  before(text, 'Clinical evidence', 'the meaning of label number 2 in');
  before(text, 'the meaning of label number 8 in', 'the garden kept a record');
});

test('a table in small type at the top of a page is read, each cell whole', async () => {
  const s = 8.6;
  const table = [
    item('Pressure from goal one (biology)', 72, 740, s), item('Pressure from goal two (sealing and survival)', 270, 740, s),
    item('Larger and more tapered preparations let', 72, 720, s), item('Every extra step of taper removes dentine along', 270, 720, s),
    item('irrigant needles go deeper and exchange', 72, 709, s), item('the whole root and lowers the resistance of the', 270, 709, s),
    item('more irrigant along the wall.', 72, 698, s), item('root to fracture.', 270, 698, s),
    item('A bigger apical size removes more infected', 72, 670, s), item('A bigger apical size in a curved canal raises the', 270, 670, s),
    item('dentine.', 72, 659, s), item('stress on the file.', 270, 659, s)
  ];
  const doc = fakeDoc([
    [...body('school', 740), ...body('office', 656)],
    [...table, ...body('clinic', 630), ...body('garden', 546)],
    [...body('market', 740), ...body('harbour', 656)]
  ]);
  const text = textOf(await buildDocument(doc, DEFAULT_OPTIONS));
  assert.match(text, /Larger and more tapered preparations let irrigant needles go deeper and exchange more irrigant along the wall\./);
  assert.match(text, /Every extra step of taper removes dentine along the whole root and lowers the resistance of the root to fracture\./);
  before(text, 'Pressure from goal one', 'Pressure from goal two');
  before(text, 'Pressure from goal two', 'Larger and more tapered');
  before(text, 'more irrigant along the wall.', 'Every extra step of taper');
  before(text, 'root to fracture.', 'A bigger apical size removes');
  before(text, 'A bigger apical size removes more infected dentine.', 'A bigger apical size in a curved canal');
  before(text, 'stress on the file.', 'the clinic kept a record');
});

test('a two-column book stays two columns: the left column is read, then the right column', async () => {
  // Two columns on the same baselines, each about 200pt wide: 40 letters at 10pt.
  const half = (place) => FILL.map(t => t.replaceAll('clinic', place).slice(0, 40));
  const page = (a, b) => [
    ...half(a).flatMap((t, k) => [item(t, 72, 700 - k * 14), item(half(b)[k], 320, 700 - k * 14)]),
    ...half(a + 's').flatMap((t, k) => [item(t, 72, 600 - k * 14), item(half(b + 's')[k], 320, 600 - k * 14)])
  ];
  const doc = fakeDoc([page('school', 'office'), page('clinic', 'garden'), page('market', 'harbour')]);
  const text = textOf(await buildDocument(doc, DEFAULT_OPTIONS));
  assert.notEqual(doc.__oneColumn, true, 'the book is not one column');
  before(text, 'the clinic kept a record', 'the garden kept a record');
});
