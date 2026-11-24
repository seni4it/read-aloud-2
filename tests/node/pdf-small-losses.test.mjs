// PDF text: small losses in a book of one column (extension/pdf/extract.js), ticket 34.
// 1. A title in big capitals of two words or more ("MASTERING ROTARY") was dropped as a label on a photograph.
// 2. The second line of a table cell in capitals ("/ IFU]") was dropped as a label on a photograph.
// 3. A table of 3 columns that fills the page was split at a column gap and read column by column.
// All lines here are made for the test.
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
const book = (special) => fakeDoc([
  [...body('school', 740), ...body('office', 656)],
  special,
  [...body('clinic', 740), ...body('garden', 656)],
  [...body('market', 740), ...body('harbour', 656)],
  [...body('bakery', 740), ...body('station', 656)]
]);

test('a title page: the first line of a title in big capitals is read', async () => {
  const doc = book([
    item('A LEARNING RESOURCE FOR THE TEAM', 160, 622, 10),
    item('CARING FOR', 136, 559, 32), item('GARDEN', 191, 521, 32), item('TOOLS', 143, 483, 32),
    item('From the first principles to the present day', 88, 437, 15),
    item('Prepared as a learning resource for the whole team', 150, 335, 12),
    item('Based on the notes of the garden team. Original text and figures.', 80, 236, 9)
  ]);
  const text = textOf(await buildDocument(doc, DEFAULT_OPTIONS));
  assert.match(text, /CARING FOR GARDEN TOOLS/);
});

test('a label on a photograph in capitals, in body type, is still not read', async () => {
  // "PATHOLOGICAL WEAR" over a photograph: short, all capitals, set a little larger than the body (1.4 times).
  const doc = book([...body('museum', 740), item('OLD STONE WALL', 200, 640, 14), ...body('library', 610)]);
  const text = textOf(await buildDocument(doc, DEFAULT_OPTIONS));
  assert.doesNotMatch(text, /OLD STONE WALL/);
  assert.match(text, /the library kept a record/);
});

test('a one-column book: the second line of a label cell in capitals is read with its label', async () => {
  const s = 8.6;
  const rows = [
    ['[Lab evidence]', null, 'the meaning of the first label, in words of its own.'],
    ['[Current advice', '/ IFU]', 'what the maker says, and the advice of the team now.'],
    ['[Unsure / open]', null, 'the meaning of the third label, in words of its own.'],
    ['[Maker data]', null, 'the meaning of the fourth label, in words of its own.']
  ];
  const table = rows.flatMap(([label, second, meaning], k) => [
    item(label, 72, 600 - k * 30, s),
    ...(second ? [item(second, 72, 600 - k * 30 - 11.3, s)] : []),
    item(meaning, 230, 600 - k * 30, s)
  ]);
  const doc = book([...body('museum', 740), ...table, ...body('library', 440)]);
  const text = textOf(await buildDocument(doc, DEFAULT_OPTIONS));
  // the speech rewrite spells the initials: "IFU" is said "I F U"
  assert.match(text, /\[Current advice\W+I F U\]/);
  before(text, 'I F U]', 'what the maker says');
});

// A table of 3 columns that fills a page of a one-column book: a part, its meaning, its use. The meaning and the
// use take 1 to 3 lines each, so the lines of the 3 columns do not sit on the same heights.
const s = 8.6;
const PARTS = [
  ['Tip', ['The end of the tool that goes first.', 'Its size is the size of the tool'], ['Leads the tool and sets', 'the size of the cut']],
  ['Taper', ['The growth of the width for each', 'step along the working part'], ['Sets the shape of the cut']],
  ['Blade', ['The sharp edge that meets the wood', 'when the tool turns in the hand'], ['Cuts the chips and', 'moves them out']],
  ['Land', ['A flat part between two grooves', 'that holds the blade in place'], ['Keeps the tool on its line']],
  ['Groove', ['The channel in the side of the tool', 'that holds the chips of the wood'], ['Carries the chips', 'out of the cut']],
  ['Core', ['The central part of the tool that', 'is left inside all the grooves'], ['Gives the tool its strength']],
  ['Handle', ['The part that the hand holds when', 'the tool is in use in the garden'], ['Turns the tool']],
  ['Shank', ['The part between the handle and', 'the working part of the tool'], ['Joins the parts']]
];
const fullTable = () => {
  const out = [item('Part', 72, 740, s), item('Meaning', 200, 740, s), item('Use', 400, 740, s)];
  let y = 715;
  for (const [part, meaning, use] of PARTS) {
    out.push(item(part, 72, y, s));
    meaning.forEach((t, k) => out.push(item(t, 200, y - k * 11.3, s)));
    use.forEach((t, k) => out.push(item(t, 400, y - k * 11.3, s)));
    y -= (Math.max(meaning.length, use.length) - 1) * 11.3 + 19.5;
  }
  return out;
};
// The book's title at the top of every page, in small type: the running head.
const HEAD = 'Garden Tools for the Whole Team';
const tableBook = () => fakeDoc([
  [...body('school', 740), ...body('office', 656)],
  fullTable(),
  [...body('clinic', 740), ...body('garden', 656)],
  [...body('market', 740), ...body('harbour', 656)],
  [...body('bakery', 740), ...body('station', 656)]
].map(page => [item(HEAD, 330, 780.5, 8), ...page]));

test('a one-column book: a table of 3 columns that fills the page is read row by row ("Skip tables" off)', async () => {
  const doc = tableBook();
  const text = textOf(await buildDocument(doc, { ...DEFAULT_OPTIONS, skipTables: false }));
  assert.equal(doc.__oneColumn, true, 'the book is one column');
  assert.ok(!text.includes(HEAD), 'the running head above the table is not read');
  for (let k = 0; k < PARTS.length; k++) {
    const [part, meaning, use] = PARTS[k];
    before(text, part, meaning[0]);
    before(text, meaning[0], use[0]);
    if (k + 1 < PARTS.length) before(text, use[0], PARTS[k + 1][1][0]);
  }
  assert.match(text, /The growth of the width for each step along the working part/);
});

test('a one-column book: with "Skip tables" on, a table of 3 columns that fills the page is skipped whole', async () => {
  // Ticket 35: a table of cells that is a table in a quarter of its lines or more is left out whole. Before, some of its
  // lines were read and others were left out.
  const doc = tableBook();
  const text = textOf(await buildDocument(doc, DEFAULT_OPTIONS));
  for (const [part, meaning, use] of PARTS) {
    for (const t of [part, ...meaning, ...use]) assert.ok(!new RegExp(`\\b${t}\\b`).test(text), `"${t}" (a cell of the table) is not read`);
  }
  assert.ok(!text.includes(HEAD), 'the running head above the table is not read');
  assert.match(text, /the school kept a record/);
  assert.match(text, /the clinic kept a record/);
});

// A table that is a table in less than a quarter of its lines: 2 rows of short cells, and 6 rows whose meaning is a
// long sentence over 3 lines. "Skip tables" leaves out the 2 short rows; the other rows are read.
const MIXED = [
  ['Tip', ['Leads the tool'], ['Sets the cut']],
  ['Taper', ['Grows the width'], ['Sets the shape']],
  ['Blade', ['The sharp edge of the tool that meets the wood when the tool', 'turns in the hand of the worker, so that the chips come away', 'from the wall of the hole in long thin curls of wood.'], ['Cuts the chips']],
  ['Land', ['A flat part between two of the grooves of the tool, which holds', 'the blade in its place and keeps it on the line that the hand', 'gives it, also in hard wood with many knots in it.'], ['Keeps the line']],
  ['Groove', ['The channel in the side of the tool that takes the chips of the', 'wood away from the blade, so that they do not block the cut', 'and make the tool hot in the hole.'], ['Carries the chips']],
  ['Core', ['The central part of the tool that is left inside all the grooves,', 'and that gives the tool the strength to turn in the hole', 'without a break when the wood is hard.'], ['Gives strength']],
  ['Handle', ['The part that the hand holds when the tool is in use, made of', 'wood or of plastic, and long enough for a full hand of a', 'worker in the garden or the shop.'], ['Turns the tool']],
  ['Shank', ['The part between the handle and the working part of the tool,', 'which is round and smooth so that it turns well in the', 'hole without a mark on the wall.'], ['Joins the parts']]
];
const mixedTable = () => {
  const out = [item('Part', 72, 740, s), item('Meaning', 160, 740, s), item('Use', 470, 740, s)];
  let y = 715;
  for (const [part, meaning, use] of MIXED) {
    out.push(item(part, 72, y, s));
    meaning.forEach((t, k) => out.push(item(t, 160, y - k * 11.3, s)));
    use.forEach((t, k) => out.push(item(t, 470, y - k * 11.3, s)));
    y -= (Math.max(meaning.length, use.length) - 1) * 11.3 + 19.5;
  }
  return out;
};

test('a one-column book: with "Skip tables" on, what is read of a table of 3 columns comes row by row', async () => {
  // "Skip tables" leaves out the lines that it takes for a table of short cells; the other lines are read. They must
  // come in the order of the rows, not column by column.
  const doc = fakeDoc([
    [...body('school', 740), ...body('office', 656)],
    mixedTable(),
    [...body('clinic', 740), ...body('garden', 656)],
    [...body('market', 740), ...body('harbour', 656)],
    [...body('bakery', 740), ...body('station', 656)]
  ].map(page => [item(HEAD, 330, 780.5, 8), ...page]));
  const text = textOf(await buildDocument(doc, DEFAULT_OPTIONS));
  const read = MIXED.flatMap(([, meaning, use], row) => [...meaning, ...use].map(t => ({ row, at: text.indexOf(t) })))
    .filter(r => r.at >= 0).sort((a, b) => a.at - b.at);
  assert.ok(read.length >= 3, `lines of the table are read: ${text}`);
  assert.ok(read.length < MIXED.flatMap(([, m, u]) => [...m, ...u]).length, `some lines of the table are left out: ${text}`);
  for (let k = 1; k < read.length; k++) assert.ok(read[k].row >= read[k - 1].row, 'a line of a later row is read after the lines of the rows above it');
  assert.ok(!text.includes(HEAD), 'the running head above the table is not read');
});

test('a one-column book: a word list in two columns on its last page is read column by column', async () => {
  // Two columns of short entries (a glossary, an index): the columns are text, not a table.
  const left = ['apical zone: the end part', 'blade angle: its slope', 'core width: the middle', 'cutting edge: the blade',
    'file tip: the point', 'groove depth: how deep', 'handle colour: its mark', 'land width: the flat part'];
  const right = ['pitch: the step of a turn', 'relief: the cut-back part', 'shank length: how long', 'taper: the growth',
    'torque: the turning force', 'twist angle: the twist', 'wear: the loss of metal', 'zone method: a way of work'];
  const page = [item('Words of the book', 72, 740, 21),
    ...left.flatMap((t, k) => [item(t, 72, 700 - k * 14, s), item(right[k], 330, 700 - k * 14, s)])];
  const doc = fakeDoc([
    [...body('school', 740), ...body('office', 656)],
    [...body('clinic', 740), ...body('garden', 656)],
    [...body('market', 740), ...body('harbour', 656)],
    page
  ]);
  const text = textOf(await buildDocument(doc, { ...DEFAULT_OPTIONS, skipTables: false }));
  assert.equal(doc.__oneColumn, true, 'the book is one column');
  before(text, 'apical zone', 'blade angle');
  before(text, 'land width', 'pitch');
});
