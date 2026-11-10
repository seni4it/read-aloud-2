// PDF text: the layout of a page (extension/pdf/extract.js, lexicon.js).
// The size of a line, rotated pages, rows by real distance, the running-head
// sample, and the speed of the gap search, the figure-reference rule and the
// ligature search. All lines here are made for the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as lexicon from '../../extension/pdf/lexicon.js';
import { DocumentBuilder, buildDocument, readPage, learnRepeatedLines } from '../../extension/pdf/extract.js';
import { loadLexiconFromFile, DEFAULT_OPTIONS, sentencesOf as sentencesOfPdf } from '../pdf-text/extract-text.mjs';
import { PUBLIC_SET } from '../pdf-text/compare.mjs';

await loadLexiconFromFile(lexicon);

// A made text item. A line can be given as several items: { parts: [{ text, x, size }, ...], y }.
const item = (text, x, y, size = 10) =>
  ({ str: text, transform: [size, 0, 0, size, x, y], width: text.length * size * 0.5, hasEOL: false });
const itemsOf = line => line.parts
  ? line.parts.map(p => item(p.text, p.x, line.y, p.size ?? 10))
  : [item(line.text, line.x ?? 72, line.y, line.size ?? 10)];

const PORTRAIT = { width: 612, height: 792 };
const fakeDoc = (pages, viewport = PORTRAIT) => ({
  numPages: pages.length,
  async getPage(n) {
    const page = pages[n - 1];
    return {
      async getTextContent() { return { items: Array.isArray(page) ? page.flatMap(itemsOf) : page.items }; },
      getViewport: () => viewport
    };
  }
});

const FILL = [
  'the clinic kept a record of every visit and every treatment that',
  'was given, so that the clinic team could look back at the results',
  'and compare one group of clinic patients with another group that',
  'came to the clinic in the same months of the following year. The',
  'record of the clinic also kept the age of each patient and the',
  'number of visits that each one of them made to the clinic in all.'
];
// Each page gets its own words: a line that comes back on many pages is a running head, not body text.
const fill = place => FILL.map(t => t.replaceAll('clinic', place));
const column = (texts, top = 700) => texts.map((text, k) => ({ text, y: top - k * 14 }));
const pageText = p => [...p.furniture, ...p.lines].sort((a, b) => b.y - a.y).map(l => l.text).join(' ');

const ms = async fn => { const t = performance.now(); await fn(); return performance.now() - t; };

test('a line with a raised drop cap is body text, not a heading', async () => {
  const [first, ...rest] = FILL;
  const page = [
    { y: 700, parts: [{ text: 'T', x: 72, size: 30 }, { text: first.slice(1), x: 87 }] },
    ...column(rest, 686)
  ];
  const builder = await buildDocument(fakeDoc([page, column(fill('school')), column(fill('office'))]), DEFAULT_OPTIONS);
  assert.deepEqual(builder.sections.map(s => s.title), ['Beginning']);
  assert.match(builder.sentences.map(s => s.text).join(' '), /^the clinic kept a record of every visit and every treatment that was given/i);
});

test('the size of a line is the size of most of its characters', async () => {
  const page = [{ y: 700, parts: [{ text: 'T', x: 72, size: 30 }, { text: FILL[0].slice(1), x: 87 }] }, ...column(FILL.slice(1), 686)];
  const { lines } = await readPage(fakeDoc([page]), 1);
  assert.equal(lines[0].size, 10);
});

// A landscape page: the page is turned a quarter (/Rotate 90) and its text is drawn turned the other way, so it
// reads upright on the screen. In PDF space each line runs up the page, and the next line sits to its right.
test('a page with rotation 90 reads its lines in sequence', async () => {
  const items = FILL.flatMap((text, k) => {
    const cut = text.indexOf(' ', 30);
    const a = text.slice(0, cut + 1), b = text.slice(cut + 1);
    const x = 100 + k * 14, w = a.length * 5;
    const turned = (str, y) => ({ str, transform: [0, 10, -10, 0, x, y], width: str.length * 5, hasEOL: false });
    return [turned(a, 72), turned(b, 72 + w)];
  });
  const viewport = { width: 792, height: 612, rotation: 90, viewBox: [0, 0, 612, 792] };
  const p = await readPage(fakeDoc([{ items }], viewport), 1);
  assert.deepEqual(p.lines.map(l => l.text), FILL);
  assert.ok(p.lines.every(l => l.size === 10), 'the size comes from the turned text, not the fallback');
});

test('the rotated public sample reads its lines in sequence', async () => {
  const text = (await sentencesOfPdf(path.join(PUBLIC_SET.pdfs, 'rotated.pdf'))).join(' ');
  assert.match(text, /^This page is a landscape page\. Its text is turned a quarter, and the page is turned back/);
  assert.match(text, /the reader must read each line from its start to its end, and the lines from the top down\./);
});

test('two items at y 4.99 and 5.01 are one line', async () => {
  const items = [...column(FILL.slice(0, 3)).flatMap(itemsOf), item('the clinic kept', 72, 4.99), item('a record', 150, 5.01)];
  const p = await readPage(fakeDoc([{ items }]), 1);
  assert.match(pageText(p), /the clinic kept a record/);
  assert.equal([...p.lines, ...p.furniture].filter(l => /clinic kept a record$/.test(l.text)).length, 1);
});

test('items more than a line apart stay two lines', async () => {
  const items = [item('first line of the text', 72, 300), item('second line of the text', 72, 290)];
  const p = await readPage(fakeDoc([{ items }]), 1);
  assert.deepEqual([...p.lines, ...p.furniture].map(l => l.text), ['first line of the text', 'second line of the text']);
});

test('a page with fewer than 6 lines does not make its own lines running heads', () => {
  const page = texts => ({ lines: texts.map(text => ({ text })) });
  const repeated = learnRepeatedLines([
    page(['A short note on one page', 'with a second line here']),
    page(['Another page with its own words', 'and more words of its own']),
    page(['A third page with other words', 'and a last line of its own'])
  ]);
  assert.equal(repeated.size, 0);
});

test('a line at the top of several pages is still a running head', () => {
  const page = (...texts) => ({ lines: ['Chapter Four: The Clinic', ...texts].map(text => ({ text })) });
  const repeated = learnRepeatedLines([page('one'), page('two words'), page('three words'), page('four words')]);
  assert.ok(repeated.has('chapter four: the clinic'));
});

// The paragraph is read once to load the code, then timed.
const cleanTime = async text => {
  const run = () => {
    const b = new DocumentBuilder(DEFAULT_OPTIONS);
    b.addPage({ page: 1, lines: [{ y: 700, size: 10, text, tokens: [{ str: text, page: 1, item: 0 }], x0: 72, x1: 540 }], furniture: [] });
    return b.finalize().sentences.map(s => s.text).join(' ');
  };
  run();
  let out;
  const time = await ms(() => { out = run(); });
  return { time, out };
};

// The timing tests use a work that took seconds with the old code, and a wide limit, so a busy machine does not
// fail them.
test('a figure reference "(Fig. 1-2-3-...-25" with no closing sign is read in less than 1 second', async () => {
  const numbers = Array.from({ length: 25 }, (_, k) => k + 1).join('-');
  const { time, out } = await cleanTime(`The result is shown here (Fig. ${numbers} and the text goes on with no closing sign at all.`);
  assert.ok(time < 1000, `took ${time.toFixed(0)} ms`);
  assert.match(out, /the text goes on/);
});

test('a list of 24 names in a bracket with no year and no closing sign is read in less than 1 second', async () => {
  const names = Array.from({ length: 24 }, () => 'and Jones').join(' ');
  const { time, out } = await cleanTime(`The method came first (Smith ${names} with no closing sign at all.`);
  assert.ok(time < 1000, `took ${time.toFixed(0)} ms`);
  assert.match(out, /with no closing sign/);
});

test('author-year citations are still left out', async () => {
  for (const ref of ['(Smith, 2019)', '(Smith and Jones, 2019)', '(Smith et al., 2019a)', '(see Smith & Jones 2018; Brown, 2020)']) {
    const { out } = await cleanTime(`The canal was clean ${ref} after the rinse.`);
    assert.equal(out, 'The canal was clean after the rinse.', ref);
  }
});

test('figure references in brackets are still left out', async () => {
  for (const ref of ['(Fig. 14)', '(Figs. 12, 13 and 14)', '(see Table 2-1)', '(Fig. 1 - 3)', '(Figs. 1-2-3-4)']) {
    const { out } = await cleanTime(`The canal was clean ${ref} after the rinse.`);
    assert.equal(out, 'The canal was clean after the rinse.', ref);
  }
});

test('a one-column page of 900 short lines is ordered in less than 0.5 second', async () => {
  const long = 'A long line that runs across the whole width of the text block, edge to edge.';
  const lines = Array.from({ length: 900 }, (_, k) =>
    ({ text: k % 5 ? `entry ${k} of the list` : long, y: 2200 - k * 2.4, size: 8, x: 72 + (k % 3) * 4 }));
  const doc = fakeDoc([lines]);
  await readPage(doc, 1);
  const time = await ms(() => readPage(doc, 1));
  assert.ok(time < 500, `took ${time.toFixed(0)} ms`);
});

test('the ligature search of 384 names that are not in the word list takes less than 1 second', () => {
  lexicon.resetRepairs();
  const words = [];
  for (const a of ['Bal', 'Cor', 'Dun', 'Fen', 'Gal', 'Hol', 'Jor', 'Kel'])
    for (const b of ['tra', 'vis', 'men', 'dor', 'lik', 'sun'])
      for (const c of ['berg', 'ford', 'ville', 'stein', 'worth', 'hamley', 'leyton', 'tonbury']) words.push(a + b + c);
  lexicon.repairWord('Warmupname');
  const t = performance.now();
  for (const w of words) lexicon.repairWord(w);
  const time = performance.now() - t;
  assert.ok(time < 1000, `took ${time.toFixed(0)} ms`);
  assert.equal(lexicon.repairWord('emoons'), 'emotions');
  assert.equal(lexicon.repairWord('uncondional'), 'unconditional');
});

test('a made book of 300 pages is read in less than 3 seconds', async () => {
  const pages = Array.from({ length: 300 }, (_, n) =>
    [...column(FILL.map(t => t.replace('clinic', `clinic ${n}`))), ...column(FILL, 600), ...column(FILL, 500)]);
  const time = await ms(() => buildDocument(fakeDoc(pages), DEFAULT_OPTIONS));
  assert.ok(time < 3000, `took ${time.toFixed(0)} ms`);
});

// The repairs below came from the comparison check of this ticket: each keeps a sample from reading worse.

test('a subscript joins its line; a superscript note sign does not', async () => {
  const items = [
    ...column(FILL.slice(0, 3)).flatMap(itemsOf),
    item('the loop L', 72, 500), item('R', 122, 498, 7), item(' is read first', 125.5, 500),
    item('the result', 72, 470), item('1', 122, 473.5, 7)
  ];
  const p = await readPage(fakeDoc([{ items }]), 1);
  const texts = [...p.lines, ...p.furniture].map(l => l.text);
  assert.ok(texts.includes('the loop LR is read first'), texts.join(' | '));
  assert.ok(texts.includes('the result'), texts.join(' | '));
});

test('a line that ends a sentence in body type and goes on in small type does not break the sentence', async () => {
  const page = [
    ...column(FILL.slice(0, 4)),
    { y: 644, parts: [{ text: 'the files were carried to a depth of', x: 72 }] },
    { y: 630, parts: [{ text: '16 mm.', x: 72 }, { text: ' (Note that the depth is the mean of all the visits in the year.)', x: 102, size: 8 }] },
    ...column(FILL.slice(4), 616)
  ];
  const builder = await buildDocument(fakeDoc([page, column(fill('school')), column(fill('office'))]), DEFAULT_OPTIONS);
  assert.ok(builder.sentences.some(s => /carried to a depth of sixteen millimetres\./.test(s.text)),
    builder.sentences.map(s => s.text).join(' | '));
});

test("a printer's slug in the margin is not read", async () => {
  const page = [...column(FILL.slice(0, 3)), { text: 'Book_Section1_15_07.qxp 2/19/2007 10:08 AM Page 95', y: 658, size: 8 }, ...column(FILL.slice(3), 644)];
  const text = (await buildDocument(fakeDoc([page, column(fill('school')), column(fill('office'))]), DEFAULT_OPTIONS))
    .sentences.map(s => s.text).join(' ');
  assert.doesNotMatch(text, /qxp|10:08|Page 95/);
  assert.match(text, /following year\. The record of the clinic/);
});

test('a folio in small Roman numerals at the foot of the page is not read', async () => {
  const page = [...column(FILL), { y: 60, parts: [{ text: 'xiv', x: 72 }, { text: ' Preface', x: 90, size: 8 }] }];
  const text = (await buildDocument(fakeDoc([column(fill('school')), page, column(fill('office'))]), DEFAULT_OPTIONS))
    .sentences.map(s => s.text).join(' ');
  assert.doesNotMatch(text, /Preface|fourteen/i);
});

test('the first page of the index, under its heading "Index", is not read', async () => {
  const index = [{ text: 'Index', y: 740, size: 24 }, ...column([
    'A', 'Acquisition of paying customers, 150–156. See', 'also Cost of Customer Acquisition', '(COCA); Lifetime Value of an',
    'Acquired Customer', 'and budgeting authority, 153', 'mapping the process for, 151–152', 'water filtration example,',
    '154–155', 'time factors in, 153', 'Adidas, 63'
  ], 700)];
  const pages = [column(fill('school')), column(fill('office')), column(fill('clinic')), column(fill('studio')), index];
  const text = (await buildDocument(fakeDoc(pages), DEFAULT_OPTIONS)).sentences.map(s => s.text).join(' ');
  assert.doesNotMatch(text, /Acquisition|Adidas/);
  assert.match(text, /the studio kept a record/);
});

test("a short line inside a table's area is part of the table", async () => {
  const cells = (y, a, b, c) => ({ y, parts: [{ text: a, x: 72 }, { text: b, x: 220 }, { text: c, x: 380 }] });
  const page = [...column(FILL.slice(0, 3)),
    cells(600, 'Industry', 'Medical', 'Toys'), cells(588, 'End user', 'Surgeon', 'Designer'),
    { text: 'Cancer Rsrch', y: 578, x: 220 },
    cells(566, 'Benefit', 'Planning', 'Speed'), cells(554, 'Size', 'X00,000', 'X,000'),
    ...column(FILL.slice(3), 520)];
  const text = (await buildDocument(fakeDoc([page, column(fill('school')), column(fill('office'))]), DEFAULT_OPTIONS))
    .sentences.map(s => s.text).join(' ');
  assert.doesNotMatch(text, /Rsrch|Surgeon/);
  assert.match(text, /following year\. The record of the clinic/);
});

test('a bullet at the start of a table cell starts a cell, so the bullet rows are still a table', async () => {
  const row = (y, a, b, c) => ({ y, parts: [{ text: a, x: 72 }, { text: '•', x: 210, size: 8 }, { text: b, x: 217 },
    { text: '•', x: 262, size: 8 }, { text: c, x: 269 }] });
  const page = [...column(FILL.slice(0, 3)),
    row(600, 'Industry', 'Medical', 'Toys'), row(588, 'End user', 'Surgeon', 'Designer'),
    row(576, 'Benefit', 'Planning', 'Speed'), row(564, 'Size', 'Large', 'Small'),
    ...column(FILL.slice(3), 520)];
  const text = (await buildDocument(fakeDoc([page, column(fill('school')), column(fill('office'))]), DEFAULT_OPTIONS))
    .sentences.map(s => s.text).join(' ');
  assert.doesNotMatch(text, /Surgeon|Planning/);
});

// Review round 1: when in doubt, the text is read. A lost sentence is the worst fault.

const readAll = async (pages, options = DEFAULT_OPTIONS) =>
  (await buildDocument(fakeDoc(pages), options)).sentences.map(s => s.text).join(' ');

// Body paragraphs in small type (8pt) below a figure label that stands alone on its line.
const SMALL_BODY = [
  'the small paragraphs under the figure give the steps of the method in',
  'order, and each step is part of the text that the reader must hear.',
  'The second paragraph tells how the team measured the depth of each',
  'canal, and it ends here with a full stop like any other paragraph.'
];
const figurePage = (label) => [
  ...column(FILL.slice(0, 4)),
  { text: label, y: 600, size: 8 },
  ...SMALL_BODY.map((text, k) => ({ text, y: 588 - k * 10, size: 8 })),
  ...column(FILL.slice(4), 530)
];

test('small body paragraphs below a figure label alone on its line are read', async () => {
  const text = await readAll([figurePage('Fig. 70'), column(fill('school')), column(fill('office'))]);
  assert.match(text, /the small paragraphs under the figure give the steps/);
  assert.match(text, /it ends here with a full stop like any other paragraph\./);
  assert.doesNotMatch(text, /Fig\. 70|seventy/);
});

test('a caption in small type ends at the end of its sentence, and the small text after it is read', async () => {
  const page = [
    ...column(FILL.slice(0, 4)),
    { text: 'Fig. 12 The gauge in its holder,', y: 600, size: 8 },
    { text: 'seen from the side.', y: 590, size: 8 },
    ...SMALL_BODY.map((text, k) => ({ text, y: 580 - k * 10, size: 8 })),
    ...column(FILL.slice(4), 520)
  ];
  const text = await readAll([page, column(fill('school')), column(fill('office'))]);
  assert.doesNotMatch(text, /gauge in its holder|seen from the side/);
  assert.match(text, /the small paragraphs under the figure give the steps/);
});

test('with the caption skip off, nothing of a figure page is dropped', async () => {
  const text = await readAll([figurePage('Fig. 70'), column(fill('school')), column(fill('office'))],
    { ...DEFAULT_OPTIONS, stripCaptions: false });
  assert.match(text, /Fig\. (70|seventy)/);
  assert.match(text, /the small paragraphs under the figure give the steps/);
  assert.match(text, /it ends here with a full stop like any other paragraph\./);
});

test('a section named "Index" in the middle of a book keeps its body', async () => {
  const section = [{ text: 'Index', y: 740, size: 24 }, ...column(fill('archive'), 700)];
  const pages = [column(fill('school')), section, column(fill('office')), column(fill('clinic')), column(fill('studio'))];
  const text = await readAll(pages);
  assert.match(text, /the archive kept a record of every visit/);
  assert.match(text, /the office kept a record of every visit/);
});

test('a body page after an index page is read, even when some of its lines end in a number or "i", "v", "x"', async () => {
  const index = [{ text: 'Index', y: 740, size: 24 }, ...column([
    'Acquisition, 150', 'Adidas, 63', 'Advisers, 12', 'Assets, 35', 'Automation, 210', 'Awards, 99',
    'Banks, 41', 'Budget, 77', 'Buyers, 18', 'Capital, 54'
  ], 700)];
  const after = column([
    'the clinic kept a record of every visit made in the year 1996',
    'and of every treatment that was given in the first room or room x',
    'so that the team could look back at the results of the visits',
    'and compare one group of patients with the group in chapter iv',
    'of the report that came out in the spring of the following year.',
    'The record of the clinic also kept the age of each patient.'
  ]);
  const text = await readAll([column(fill('school')), column(fill('office')), column(fill('studio')), index, after]);
  assert.doesNotMatch(text, /Acquisition|Adidas/);
  assert.match(text, /the clinic kept a record of every visit made in the year/);
});

test('a short body line between two tables is read', async () => {
  const cells = (y, a, b, c) => ({ y, parts: [{ text: a, x: 72 }, { text: b, x: 220 }, { text: c, x: 380 }] });
  const page = [...column(FILL.slice(0, 3)),
    cells(600, 'Group', 'Mean', 'Range'), cells(588, 'First', '12.5', '8-17'), cells(576, 'Second', '14.1', '9-19'),
    { text: 'The second table shows the counts.', y: 556 },
    cells(536, 'Group', 'Count', 'Share'), cells(524, 'First', '40', '45%'), cells(512, 'Second', '48', '55%'),
    ...column(FILL.slice(3), 480)];
  const text = await readAll([page, column(fill('school')), column(fill('office'))]);
  assert.match(text, /The second table shows the counts\./);
});

test('a note that starts with a single letter at the foot of the page is read', async () => {
  const page = [...column(FILL), { text: 'c Not significant at the five per cent level.', y: 560, size: 8 }];
  const text = await readAll([column(fill('school')), page, column(fill('office'))], { ...DEFAULT_OPTIONS, stripCitations: false });
  assert.match(text, /Not significant at the five per cent level/);
});

test('a body line that names a layout file and a time is read', async () => {
  const page = [...column(FILL.slice(0, 3)),
    { text: 'the file book.indd was saved at 1:25 and sent to the printer', y: 658 }, ...column(FILL.slice(3), 644)];
  const text = await readAll([page, column(fill('school')), column(fill('office'))]);
  assert.match(text, /was saved at/);
});

test('a drop cap beside lines 1 to 3 (its baseline on line 3) starts line 1: "T" + "he clinic" is "The clinic"', async () => {
  const [a, b, c, ...rest] = FILL;
  const page = [
    { y: 672, parts: [{ text: 'T', x: 72, size: 38 }] },
    { text: 'The'.slice(1) + a.slice(3), x: 100, y: 700 },
    { text: b, x: 100, y: 686 },
    { text: c, x: 100, y: 672 },
    ...column(rest, 658)
  ];
  const builder = await buildDocument(fakeDoc([page, column(fill('school')), column(fill('office'))]), DEFAULT_OPTIONS);
  const text = builder.sentences.map(s => s.text).join(' ');
  assert.match(text, /^The clinic kept a record of every visit and every treatment that was given, so that the clinic team could look back at the results and compare one group/);
  assert.doesNotMatch(text, /\bT and compare/);
  assert.deepEqual(builder.sections.map(s => s.title), ['Beginning']);
});

test('a big letter alone that is not beside the start of a paragraph is not moved', async () => {
  const page = [...column(FILL.slice(0, 3)), { y: 600, parts: [{ text: 'A', x: 300, size: 38 }] }, ...column(FILL.slice(3), 560)];
  const builder = await buildDocument(fakeDoc([page, column(fill('school')), column(fill('office'))]), DEFAULT_OPTIONS);
  assert.match(builder.sentences.map(s => s.text).join(' '), /^the clinic kept a record/);
});

// review: the two last checks of moveDropCaps. In both cases the rows above start right of the big letter.
test('a big capital beside rows whose top row starts with a capital is not moved (a figure label, not a drop cap)', async () => {
  const [a, b, c, ...rest] = FILL;
  const page = [
    { y: 672, parts: [{ text: 'B', x: 72, size: 38 }] },
    { text: 'The' + a.slice(3), x: 100, y: 700 },
    { text: b, x: 100, y: 686 },
    { text: c, x: 100, y: 672 },
    ...column(rest, 658)
  ];
  const text = (await buildDocument(fakeDoc([page, column(fill('school')), column(fill('office'))]), DEFAULT_OPTIONS)).sentences.map(s => s.text).join(' ');
  assert.doesNotMatch(text, /BThe/);
  assert.match(text, /^The clinic kept a record/);
});

test('a capital less than twice the text size beside rows whose top row starts with a small letter is not moved', async () => {
  const [a, b, c, ...rest] = FILL;
  const page = [
    { y: 672, parts: [{ text: 'B', x: 72, size: 19 }] },
    { text: a, x: 100, y: 700 },
    { text: b, x: 100, y: 686 },
    { text: c, x: 100, y: 672 },
    ...column(rest, 658)
  ];
  const text = (await buildDocument(fakeDoc([page, column(fill('school')), column(fill('office'))]), DEFAULT_OPTIONS)).sentences.map(s => s.text).join(' ');
  assert.doesNotMatch(text, /B(the|was) /, 'the capital is not put in front of a row above it');
  assert.match(text, /^the clinic kept a record/);
});
