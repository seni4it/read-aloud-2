// PDF text: a lecture of one column with tables, signs and page references (extension/pdf/extract.js and
// extension/pdf/speech.js), ticket 35. One test (or a pair) for each of the 10 items of the ticket:
//  1. A table of 6 columns with narrow gaps, and its end on the next page (2 rows), with "Skip tables" on.
//  2. A table of 4 columns with narrow gaps, with "Skip tables" on.
//  3. A table in small type below the body text is not a footnote, and its cells are not headings.
//  4. A formula: "+" is said, and the line ends its Sentence.
//  5. A number that starts with a point (".04", "25/.06").
//  6. Lines with no end mark (a subtitle, a list) are not one Sentence.
//  7. Page references in square brackets ("[p. 36]") follow "Skip citations" (the owner's answer A, 24 Nov 2026).
//  8. A numbered list is not a heading; a numbered heading in larger type is a heading.
//  9. A part named "Reference" ends the reading, as "References" does.
// 10. A table of short cells, with "Skip tables" off, is read row by row, not as one Sentence.
// All lines here are made for the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lexicon from '../../extension/pdf/lexicon.js';
import { buildDocument } from '../../extension/pdf/extract.js';
import { normalizeForSpeech } from '../../extension/pdf/speech.js';
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
// A book of one column: 3 pages of running text before the pages of the test, 2 after.
const book = (...special) => fakeDoc([
  [...body('school', 740), ...body('office', 656)],
  [...body('bakery', 740), ...body('station', 656)],
  [...body('museum', 740), ...body('church', 656)],
  ...special,
  [...body('market', 740), ...body('harbour', 656)],
  [...body('island', 740), ...body('valley', 656)]
]);

// A table: each row is a list of cells, each cell a list of lines (13pt apart), the rows 21pt apart below the end of
// the row above.
const grid = (xs, rows, top, size = 8.2) => {
  const out = [];
  let y = top;
  for (const row of rows) {
    let depth = 1;
    row.forEach((cell, c) => {
      const lines = [].concat(cell);
      lines.forEach((t, k) => out.push(item(t, xs[c], y - k * 13, size)));
      depth = Math.max(depth, lines.length);
    });
    y -= (depth - 1) * 13 + 21;
  }
  return out;
};

// Item 1: 6 columns in 9.5pt; some gaps between cells are under 2.5 type sizes ("Lemon or lime" to "Needs a warm"),
// so the old cell rule joined 3 cells into one of 40 letters or more.
const SIX_X = [66, 148.5, 220.9, 321.9, 404.9, 458.3];
const SIX = [
  ['Plant', ['Likes sun', 'or shade?'], 'Watering', 'Soil', 'Pruning', 'Pot'],
  ['Tomato', 'Sun', 'Daily, a little more', 'Rich', ['Not', 'needed'], 'Large'],
  ['Basil, the herb', 'Sun all day', ['Often, but not', 'too much water'], 'Light', '-', ['Pinch the top, or', 'it flowers']],
  [['Chili pepper', 'red'], ['Loves heat', 'days'], ['Steady water near', 'the root'], ['Sandy, well', 'drained'], 'Yearly', 'Medium'],
  [['Lemon or lime', 'tree'], ['Needs a warm', 'wall'], 'Deep and slow too', 'Loam', 'Yearly', 'Large'],
  ['Strawberry', 'Full sun', 'Keep it moist', 'Rich', 'Yearly', 'Small']
];
const SIX_END = [
  ['Plant', ['Likes sun', 'or shade?'], 'Watering', 'Soil', 'Pruning', 'Pot'],
  [['Fern, tall', 'kind'], ['Deep shade', 'only'], 'Keep it wet', ['Rich, with', 'leaf mould'], 'Rarely,', 'Medium']
];
const SIX_WORDS = ['Tomato', 'Basil', 'Chili', 'Lemon', 'Strawberry', 'Fern', 'Watering', 'Pruning', 'Yearly', 'Deep shade',
  'Keep it', 'Loves heat', 'Rarely'];

test('item 1: a table of 6 columns with narrow gaps, and its end of 2 rows on the next page, is skipped ("Skip tables" on)', async () => {
  const doc = book(
    [...body('clinic', 740), ...body('office', 656), ...grid(SIX_X, SIX, 520, 9.5), ...body('garden', 250)],
    [...grid(SIX_X, SIX_END, 740, 9.5), ...body('forest', 640)]
  );
  const text = textOf(await buildDocument(doc, DEFAULT_OPTIONS));
  assert.equal(doc.__oneColumn, true, 'the book is one column');
  for (const w of SIX_WORDS) assert.ok(!text.includes(w), `"${w}" (a cell of the table) is not read: ${text}`);
  before(text, 'the office kept a record', 'the garden kept a record');
  before(text, 'the garden kept a record', 'the forest kept a record');
});

// Item 2: 4 columns in 9.5pt; the first column is narrow ("Step" to "Main danger" is under 2.5 type sizes), and the
// old cell rule joined the first 3 cells of the rows "Feed" and "Pick" into one of 40 letters or more.
const FOUR_X = [66, 105, 217, 378];
const FOUR = [
  ['Step', 'Main danger', 'Tool to use', 'Tool to avoid'],
  ['Dig', 'Roots of trees', ['Spade, sharp enough, with a long', 'handle of ash'], ['A fork with bent tines that are wider', 'than the bed']],
  ['Sow', 'Seeds too deep', 'Rake, small seed drill, a board', 'Big, heavy rollers'],
  ['Feed', ['Leaves burn; rot', 'wet soil'], 'Slow feed, liquid, a little', 'Strong salts in a dry week'],
  ['Pick', 'Bruises; mould in', 'Soft gloves, a basket, shade', ['Sharp knives near the stem, left in', 'sun']]
];

test('item 2: a table of 4 columns with a narrow first column is skipped ("Skip tables" on)', async () => {
  const doc = book([...body('clinic', 740), ...body('office', 656), ...grid(FOUR_X, FOUR, 540, 9.5), ...body('garden', 330)]);
  const text = textOf(await buildDocument(doc, DEFAULT_OPTIONS));
  for (const w of ['Roots of trees', 'Seeds too deep', 'Leaves burn', 'Slow feed', 'Bruises', 'Soft gloves', 'Sharp knives',
    'Strong salts', 'Main danger']) assert.ok(!text.includes(w), `"${w}" (a cell of the table) is not read: ${text}`);
  before(text, 'the office kept a record', 'the garden kept a record');
});

// Item 3: 3 columns in small type (8.2pt under 10pt) below all the body text of its page.
const THREE_X = [66, 176, 339];
const THREE = [
  ['Question', 'Plant features', 'What it decides in the bed'],
  [['1. How tall is it, and', 'how wide?'], ['Height, spread, roots, leaf size,', 'colour'], ['Light and space in a row; shade for', 'the next row; water used']],
  ['2. How does it grow?', ['Climbing habit, runners, side shoots,', 'root depth'], ['Support and number of ties needed;', 'side or upward growth']],
  [['3. What keeps it', 'healthy?'], ['Good air, sun, or a cover of', 'netting, mulch, compost'], 'Disease']
];
const threeBook = () => book([...body('clinic', 740), ...body('office', 656), ...grid(THREE_X, THREE, 540)]);

test('item 3: a table in small type below the body text is read ("Skip tables" off, "Skip citations" on)', async () => {
  const text = textOf(await buildDocument(threeBook(), { ...DEFAULT_OPTIONS, skipTables: false }));
  before(text, 'the office kept a record', 'How tall is it');
  before(text, 'How tall is it', 'Height, spread');
  before(text, 'Height, spread', 'How does it grow');
  before(text, 'How does it grow', 'Good air');
});

test('item 3: a cell of a table is not a heading in the contents list ("Skip citations" off)', async () => {
  const b = await buildDocument(threeBook(), { ...DEFAULT_OPTIONS, skipTables: false, stripCitations: false });
  const titles = b.sections.map(s => s.title);
  assert.ok(!titles.some(t => /How tall|How does it grow|What keeps it/.test(t)), `no cell is a section: ${titles.join(' / ')}`);
  assert.match(textOf(b), /How does it grow/);
});

test('item 3: with "Skip tables" on, the table in small type is skipped and the text above it is read', async () => {
  const text = textOf(await buildDocument(threeBook(), DEFAULT_OPTIONS));
  for (const w of ['How tall', 'How does it grow', 'Good air', 'Plant features']) assert.ok(!text.includes(w), `"${w}" is not read: ${text}`);
  assert.match(text, /the office kept a record/);
});

test('item 4: a formula line: "+" is said as "plus", and the formula ends its Sentence', async () => {
  const doc = book([
    ...body('clinic', 740),
    item('So the habit I want you to take home is a small sum:', 72, 640),
    item('Spread of the bed = plant width + (gap × number of plants in the row)', 85, 600),
    item('As a rough guide, once a bed is about two metres wide at its middle, it is', 72, 558),
    item('in the zone where weeds become a real risk.', 72, 544),
    ...body('garden', 500)
  ]);
  const b = await buildDocument(doc, DEFAULT_OPTIONS);
  const text = textOf(b);
  assert.match(text, /plant width plus \(gap by number of plants in the row\)/);
  const formula = b.sentences.find(s => s.text.includes('Spread of the bed'));
  assert.ok(formula.text.endsWith('in the row)'), `the formula ends its Sentence: "${formula.text}"`);
  assert.ok(b.sentences.some(s => s.text.startsWith('As a rough guide')), 'the next line starts a Sentence');
});

test('item 4: a run of affiliation marks between names is still not said', async () => {
  const chars = [...'Gal, # # + +# + Jesse'];
  // the marks are dropped by the noise rules of extract.js: a made line goes through the whole builder
  const doc = book([...body('clinic', 740), item('Gal, # # + +# + Jesse Ruderman wrote the first report on the', 72, 640),
    item('plants of the clinic, and the team of the clinic read it in the same year.', 72, 626)]);
  const text = textOf(await buildDocument(doc, DEFAULT_OPTIONS));
  assert.match(text, /Gal, Jesse Ruderman/);
  assert.ok(!/plus|\+/.test(text), `no "+" and no "plus": ${text}`);
  assert.equal(normalizeForSpeech(chars, chars.map(() => null)).chars.join(''), 'Gal, # # + +# + Jesse', 'the speech rewrite says no mark of a mark run');
});

test('item 5: a number that starts with a point is said as "point" and its digits', async () => {
  const doc = book([
    ...body('clinic', 740),
    item('In tests, the opposite was seen above a .04 slope: a steep slope dries the soil.', 72, 640),
    item('A pipe marked 25/.06 has a bore of 0.25 mm, and a 25/.08 is wider still.', 72, 626),
    ...body('garden', 590)
  ]);
  const text = textOf(await buildDocument(doc, DEFAULT_OPTIONS));
  assert.match(text, /above a point zero four slope/);
  assert.match(text, /marked twenty-five, point zero six has/);
  assert.match(text, /a twenty-five, point zero eight is wider/);
  const say = (t) => { const c = [...t]; return normalizeForSpeech(c, c.map(() => null)).chars.join(''); };
  assert.equal(say('above about .04 slope'), 'above about point zero four slope');
  assert.equal(say('a slope of .04.'), 'a slope of point zero four.', 'at the end of a sentence');
  assert.equal(say('a 25-.02 pipe'), 'a twenty-five, point zero two pipe');
  assert.equal(say('a .25/.04 pipe'), 'a point two five, point zero four pipe');
  assert.equal(say('a bore of .27 mm'), 'a bore of point two seven millimetres');
  assert.equal(say('it costs $.99 now'), 'it costs $.99 now', 'a price is left to the voice');
  assert.equal(say('1.5 mm and 0.75'), 'one point five millimetres and zero point seven five', 'a decimal is said as before');
  assert.equal(say('Fig.3 and e.g.5'), 'Fig.3 and e.g.5', 'a point inside a word is not a number');
});

// Item 6 and item 8: a numbered list after a lead-in line, at body size and set in a little.
const LIST = [
  item('The talk has four parts:', 72, 640),
  item('1. What we ask a garden to do, and why the demands conflict', 85, 620),
  item('2. Five questions to ask about the plan of any garden', 85, 606),
  item('3. Which plant for which season of the garden year', 85, 592),
  item('4. Which plant for which soil', 85, 578)
];

test('item 6: a subtitle, an audience line and a note with no end marks are separate Sentences', async () => {
  const doc = fakeDoc([
    [
      item('Picking the Plant', 72, 624, 30),
      item('How the shape of a garden decides the work, and how to match the plants to', 72, 580),
      item('the soil', 72, 566),
      item('A talk for people who grow food in small gardens', 72, 534),
      item('Notes in square brackets are to a book about gardens, by printed page number; in the copy', 72, 506),
      item('of the book, add 9. The care of the tools is covered in a separate talk.', 72, 492)
    ],
    [...body('school', 740), ...body('office', 656)],
    [...body('clinic', 740), ...LIST, ...body('garden', 540)],
    [...body('market', 740), ...body('harbour', 656)],
    [...body('island', 740), ...body('valley', 656)]
  ]);
  const b = await buildDocument(doc, DEFAULT_OPTIONS);
  const together = (a, c) => b.sentences.some(s => s.text.includes(a) && s.text.includes(c));
  assert.ok(!together('the soil', 'A talk for people'), 'the subtitle and the audience line are 2 Sentences');
  assert.ok(!together('A talk for people', 'Notes in square'), 'the audience line and the note are 2 Sentences');
  assert.ok(!together('demands conflict', 'Five questions'), 'list item 1 and list item 2 are 2 Sentences');
  assert.ok(!together('Five questions', 'Which plant for which season'), 'list item 2 and list item 3 are 2 Sentences');
  before(textOf(b), 'demands conflict', 'Which plant for which soil');
});

// Item 6, the review of 24 Nov 2026: the rule must not cut a real sentence.
const oneSentence = async (lines, a, c) => {
  const b = await buildDocument(book([...body('clinic', 740), ...lines, ...body('garden', 540)]), DEFAULT_OPTIONS);
  assert.ok(b.sentences.some(s => s.text.includes(a) && s.text.includes(c)), `"${a}" and "${c}" are one Sentence: ${textOf(b)}`);
};

test('item 6: a chapter number that wraps to the start of a line does not cut the sentence', async () => {
  await oneSentence([
    item('The care of the beds is in the chapters on soil, see Ch. 7, 8, 10 and', 72, 640),
    item('21. The early list of the beds is short.', 72, 626)
  ], 'Ch. 7, 8, 10 and', '21. The early list');
});

test('item 6: a lone figure letter after a gap does not cut the sentence', async () => {
  await oneSentence([
    item('The roots of the plants in the garden can be put in the smaller', 72, 640),
    // the label "A" of a picture below the line, then the sentence goes on
    item('A', 72, 610), item('box of the shed for the winter.', 72, 596)
  ], 'in the smaller', 'box of the shed');
  await oneSentence([
    item('Of the steps that the team took to keep the beds wet, the first', 72, 640),
    item('(1.) was to water them each morning before the sun was high.', 72, 610)
  ], 'the first', 'was to water them');
});

test('item 6: a line that ends with a comma or a small word does not end its Sentence at a gap', async () => {
  await oneSentence([
    item('The closest area of', 72, 640),
    item('General work in the garden is the soil of the beds.', 72, 610)
  ], 'The closest area of', 'General work');
  await oneSentence([
    item('The long bed is two metres longer than the usual length,', 72, 640),
    item('But the short bed is the same as the others.', 72, 610)
  ], 'usual length,', 'But the short bed');
});

test('item 7: page references in square brackets are skipped with "Skip citations" on, and read with it off', async () => {
  const special = [
    ...body('clinic', 740),
    item('Almost any garden can give a good crop; what differs is the work it takes [pp. 7, 15].', 72, 640),
    item('That work is what the plan decides [p. 36]. The small bed gave twice the crop of the', 72, 626),
    item('large bed [p. 64, Fig. 67]. A loose seed can roll into a crack [pp. 41–42] and stay there.', 72, 612),
    ...body('garden', 580)
  ];
  const on = textOf(await buildDocument(book(special), DEFAULT_OPTIONS)).replaceAll(' | ', ' ');
  assert.match(on, /the work it takes\. That work is what the plan decides\. The small bed/);
  assert.match(on, /the large bed\. A loose seed can roll into a crack and stay there\./);
  assert.ok(!/\[|\bpp?\./.test(on), `no page reference is read: ${on}`);
  const off = textOf(await buildDocument(book(special), { ...DEFAULT_OPTIONS, stripCitations: false }));
  assert.match(off, /\[pp\. 7, 15\]/);
  assert.match(off, /\[p\. 36\]/);
  assert.match(off, /\[p\. 64, Fig\. 67\]/);
});

test('item 8: a numbered list is not a section, and a numbered heading in larger type is', async () => {
  const doc = book(
    [...body('clinic', 740), ...LIST, ...body('garden', 540)],
    [
      item('4. Which plant for which season of the garden year', 72, 767, 15),
      ...body('forest', 730),
      item('Then ask the plant:', 72, 630),
      item('1. How tall is it at that age?', 85, 610),
      item('2. Does its root spread or dive?', 85, 596),
      item('3. What keeps it healthy?', 85, 582),
      ...body('meadow', 550)
    ]
  );
  const b = await buildDocument(doc, DEFAULT_OPTIONS);
  const titles = b.sections.map(s => s.title);
  assert.ok(titles.includes('4. Which plant for which season of the garden year'), `the heading is a section: ${titles.join(' / ')}`);
  assert.ok(!titles.some(t => /which soil|How tall|root spread|keeps it/.test(t)), `no list item is a section: ${titles.join(' / ')}`);
  before(textOf(b), 'Which plant for which soil', 'How tall is it at that age');
});

test('item 8: a numbered heading in larger type over 2 lines keeps its cut word whole', async () => {
  // a long question heading at 1.5 times the body, cut in a word at the line end: now a heading (item 8), it must take
  // its second line and join the word
  const doc = book([
    item('12. What signs of the soil in the garden of the school indi-', 72, 767, 15),
    item('cate a good place for a bed of roots and of other plants?', 72, 749, 15),
    ...body('forest', 720)
  ]);
  const b = await buildDocument(doc, DEFAULT_OPTIONS);
  assert.match(textOf(b), /school indicate a good place for a bed of roots and of other plants\?/);
  const title = '12. What signs of the soil in the garden of the school indicate a good place for a bed of roots and of other plants?';
  assert.ok(b.sections.some(s => s.title === title), `the heading is one section: ${b.sections.map(s => s.title).join(' / ')}`);
});

test('item 9: a part named "Reference" near the end is not read', async () => {
  const doc = book(
    [...body('clinic', 740), item('Thank you.', 72, 640), item('Reference', 72, 610, 13),
      item('Smith J. A Book About Gardens. Bigtown: Garden Press; 2001. Pages 7-103.', 72, 590),
      item('The numbers cited from this book are tests made by its author in the gardens of the time.', 72, 570)]
  );
  // the page of the test is the last page: the 2 pages after it go
  doc.numPages = 4;
  const text = textOf(await buildDocument(doc, DEFAULT_OPTIONS));
  assert.match(text, /Thank you\./);
  assert.ok(!/Smith J|numbers cited/.test(text), `the reference part is not read: ${text}`);
});

test('item 10: a table of short cells is read row by row with "Skip tables" off', async () => {
  const rows = [
    ['Pipe', 'At the end', '4 m along', '9 m along'],
    ['25/.02', '0.25 mm', '0.32 mm', '0.42 mm'],
    ['25/.04', '0.25 mm', '0.38 mm', '0.56 mm'],
    ['25/.06', '0.25 mm', '0.44 mm', '0.71 mm'],
    ['25/.08', '0.25 mm', '0.52 mm', '0.93 mm']
  ];
  const doc = book([...body('clinic', 740), ...body('office', 656), ...grid([66, 150, 270, 380], rows, 540), ...body('garden', 410)]);
  const b = await buildDocument(doc, { ...DEFAULT_OPTIONS, skipTables: false });
  const text = textOf(b);
  before(text, 'At the end', 'point zero two');
  before(text, 'point zero two', 'zero point four two');
  before(text, 'zero point four two', 'point zero four');
  const head = b.sentences.find(s => s.text.includes('At the end'));
  assert.ok(!head.text.includes('point zero two'), `the head row and the first row are not one Sentence: "${head.text}"`);
  const longest = Math.max(...b.sentences.filter(s => /millimetre/.test(s.text)).map(s => s.text.length));
  assert.ok(longest < 150, `no Sentence holds the whole table (the longest has ${longest} letters)`);
});
