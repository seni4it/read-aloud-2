// PDF text: no body line is lost (extension/pdf/extract.js).
// The furniture filters (the copyright block, the page header and footer,
// the contents page) must not take body text, and one damaged page must not
// stop the reading of the book. All lines here are made for the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lexicon from '../../extension/pdf/lexicon.js';
import { DocumentBuilder, buildDocument, readPage } from '../../extension/pdf/extract.js';
import { loadLexiconFromFile, DEFAULT_OPTIONS } from '../pdf-text/extract-text.mjs';

await loadLexiconFromFile(lexicon);

// A made PDF page: one text item for each line, in one column.
const item = ({ text, y, size = 10, x = 72 }) =>
  ({ str: text, transform: [size, 0, 0, size, x, y], width: text.length * size * 0.5, hasEOL: false });

function fakeDoc(pages) {
  return {
    numPages: pages.length,
    asked: [],
    async getPage(n) {
      this.asked.push(n);
      const lines = pages[n - 1];
      if (lines instanceof Error) throw lines;
      return {
        async getTextContent() {
          if (lines === 'damaged') throw new Error('bad font');
          return { items: lines.map(item) };
        },
        getViewport: () => ({ width: 612, height: 792 })
      };
    }
  };
}

// Body lines at the normal line spacing (14pt), from the top of the text block down.
const column = (texts, top = 700, size = 10) => texts.map((text, k) => ({ text, y: top - k * 14, size }));

// Each page gets its own words: a line that comes back on many pages is a running head, not body text.
const fill = place => FILL_OF.map(t => t.replaceAll('PLACE', place));
const FILL_OF = [
  'the PLACE kept a record of every visit and every treatment that',
  'was given, so that the PLACE team could look back at the results',
  'and compare one group of PLACE patients with another group that',
  'came to the PLACE in the same months of the following year. The',
  'record of the PLACE also kept the age of each patient and the',
  'number of visits that each one of them made to the PLACE in all.'
];
const FILL = fill('clinic');

const read = async (pages, options = DEFAULT_OPTIONS) => {
  const builder = await buildDocument(fakeDoc(pages), options);
  return builder.sentences.map(s => s.text).join(' ');
};

test('a body line that starts "150-200 patients were" is read, with the lines after it', async () => {
  const page = column([
    ...FILL,
    '150-200 patients were seen each month in the first year of the study',
    'and the clinic did not change its methods in that time at all, so',
    'the numbers from each month can be compared with the next month.'
  ]);
  const text = await read([page, column(fill('school')), column(fill('office'))]);
  assert.match(text, /patients were seen each month/);
  assert.match(text, /did not change its methods/);
  assert.match(text, /can be compared with the next month/);
});

test('a body line that ends "was 45" at the foot of the page is read', async () => {
  const page = column([...FILL, 'and in the end the mean age of the group was 45']);
  const text = await read([column(fill('school')), page, column(fill('office'))]);
  assert.match(text, /the mean age of the group was 45/);
});

test('a body line that starts "15 patients were" at the top of the page is read', async () => {
  const page = column(['15 patients were treated in the clinic during the first year', ...FILL]);
  const text = await read([column(fill('school')), page, column(fill('office'))]);
  assert.match(text, /patients were treated in the clinic during the first year/);
});

test('a page footer that stands off from the text block is still not read', async () => {
  const page = [...column(FILL), { text: 'Introduction 3', y: 600 }];
  const text = await read([column(fill('school')), page, column(fill('office'))]);
  assert.doesNotMatch(text, /Introduction/);
});

// Lines handed straight to the DocumentBuilder, as readPage gives them.
const line = (text, y, size = 10, extra = {}) =>
  ({ text, y, size, tokens: [{ str: text, page: 1, item: 0 }], ...extra });
const build = (lines, bodySize = 10) => {
  const b = new DocumentBuilder({ ...DEFAULT_OPTIONS, skipTables: true });
  b.setTypography({ bodySize, lineLength: 64 });
  b.addPage({ page: 1, lines, furniture: [] });
  b.finalize();
  return b.sentences.map(s => s.text).join(' ');
};

test('a copyright block in small type is still not read', () => {
  const text = build([
    ...FILL.map((t, k) => line(t, 700 - k * 14)),
    line('Copyright © 2024 the authors of this made sample text.', 100, 7),
    line('All rights kept by the people who made this sample.', 92, 7)
  ]);
  assert.match(text, /also kept the age of each patient/);
  assert.doesNotMatch(text, /Copyright|rights kept/);
});

test('a page with a number table is not removed as a contents page', () => {
  // Most lines of the page are table rows that end in a number, as the lines of a contents page do.
  const rows = [];
  for (let k = 0; k < 14; k++) rows.push(line(`Group ${'ABCDEFGHIJKLMN'[k]} ${10 + k} ${20 + k} ${30 + k}`, 500 - k * 14, 10, { table: true }));
  const text = build([...FILL.map((t, k) => line(t, 700 - k * 14)), ...rows]);
  assert.match(text, /also kept the age of each patient/);
  // With the table switch off, the rows are read too.
  const b = new DocumentBuilder({ ...DEFAULT_OPTIONS, skipTables: false });
  b.setTypography({ bodySize: 10, lineLength: 64 });
  b.addPage({ page: 1, lines: [...FILL.map((t, k) => line(t, 700 - k * 14)), ...rows], furniture: [] });
  b.finalize();
  assert.match(b.sentences.map(s => s.text).join(' '), /also kept the age of each patient/);
});

test('a contents page is still not read, also when its rows look like a table', () => {
  const titles = ['Beginning', 'The first visit', 'Records', 'The clinic', 'Results', 'Groups', 'Methods', 'Later years', 'Notes', 'Index'];
  const plain = build(titles.map((t, k) => line(`${t} ${3 + k * 20}`, 700 - k * 14)));
  assert.equal(plain, '');
  const tabled = build(titles.map((t, k) => line(`${k + 1} ${t} ${3 + k * 20}`, 700 - k * 14, 10, { table: true })));
  assert.equal(tabled, '');
});

test('a document with one damaged page reads its other pages', async () => {
  const text = await read([
    column(['The first page tells of the first visit to the clinic.', ...fill('school')]),
    'damaged',
    column(['The third page tells of the last visit to the clinic.', ...fill('office')])
  ]);
  assert.match(text, /The first page tells of the first visit/);
  assert.match(text, /The third page tells of the last visit/);
});

test('a page where no line has a body size gives lines and furniture', async () => {
  const tiny = column(FILL.slice(0, 3), 700, 0.1);
  const pd = await readPage(fakeDoc([tiny]), 1);
  assert.ok(Array.isArray(pd.lines));
  assert.equal(pd.lines.length, 3);
  assert.deepEqual(pd.furniture, []);
});

test('split-word repair: "the A er" is repaired to "the After"', () => {
  // The font of this document drops "ft": these splits have one reading only,
  // and they teach the repair which ligature the font drops.
  for (let k = 0; k < 10; k++) {
    assert.equal(lexicon.repairSplit('o', 'en'), 'often');
    assert.equal(lexicon.repairSplit('a', 'ernoon'), 'afternoon');
  }
  // "the" + "A" is tested first and is not joined; the pair "A" + "er" must still be tested.
  const text = build([line('the A er part of the visit was short.', 700)]);
  assert.match(text, /the After part of the visit/);
});

test('a read-in that is cancelled stops; it does not run through the rest of the book', async () => {
  // pdf.js rejects the pending page requests with an AbortException when the document is closed.
  const cancel = Object.assign(new Error('Worker was terminated.'), { name: 'AbortException' });
  const doc = fakeDoc([column(fill('school')), cancel, column(fill('office')), column(fill('studio'))]);
  await assert.rejects(buildDocument(doc, DEFAULT_OPTIONS), /terminated/);
  assert.deepEqual(doc.asked, [1, 2]);
  const closed = fakeDoc([column(fill('school')), new Error('Transport destroyed'), column(fill('office'))]);
  await assert.rejects(buildDocument(closed, DEFAULT_OPTIONS), /destroyed/);
});

test('a DOI line at body size is not read, and the body lines after it are', () => {
  const text = build([
    ...FILL.map((t, k) => line(t, 700 - k * 14)),
    line('doi: 10.0000/made.sample.0000', 616),
    line('The next part of the page tells how the visits were counted', 602),
    line('and how the team kept the record of each visit up to date.', 588)
  ]);
  assert.doesNotMatch(text, /made\.sample/);
  assert.match(text, /The next part of the page tells how the visits were counted/);
  assert.match(text, /kept the record of each visit up to date/);
});

test('a line-end hyphen is not joined to a copyright line that is not read', () => {
  const text = build([
    line('the record was kept by the team of the treat-', 700),
    line('permission to make digital or hard copies of this made text', 600, 7),
    line('ment room at the end of every working day of the year.', 500)
  ]);
  assert.doesNotMatch(text, /permission|treatpermission/);
});

test('a running head at body size that names a heading of the book is not read', () => {
  const b = new DocumentBuilder({ ...DEFAULT_OPTIONS, skipTables: true });
  b.setTypography({ bodySize: 10, lineLength: 64 });
  b.addPage({ page: 1, lines: [line('Growth of the Clinic', 740, 18), ...FILL.map((t, k) => line(t, 700 - k * 14))], furniture: [] });
  // The head sits at the normal line spacing above the text and is not on the sample pages.
  b.addPage({ page: 2, lines: [line('Growth of the Clinic 23', 714), ...fill('school').map((t, k) => line(t, 700 - k * 14))], furniture: [] });
  // A head in the "4 | Title" form in the furniture names the chapter; the same name at body size is not read.
  b.addPage({ page: 3, lines: [line('24 Habits of the Office', 714), ...fill('office').map((t, k) => line(t, 700 - k * 14))],
    furniture: [line('4 | Habits of the Office', 760, 7)] });
  b.finalize();
  const text = b.sentences.map(s => s.text).join(' ');
  assert.equal((text.match(/Growth of the Clinic/g) || []).length, 1);   // the heading itself is read once
  assert.doesNotMatch(text, /Habits of the Office/);
  assert.match(text, /the office kept a record/);
});

test('split-word repair adds no letters the document does not drop: "a de facto rule", "his e-mails"', () => {
  for (let k = 0; k < 10; k++) lexicon.repairSplit('o', 'en');   // the font drops "ft"
  const text = build([line('they made a de facto rule and read his e-mails each day.', 700)]);
  assert.match(text, /made a de facto rule and read his e-mails each day/);
});

test('a copyright page at body size is not read; a body line with a number range is', () => {
  const text = build([
    line('Published by a made press. All rights reserved. No part of this', 700),
    line('made book may be copied in any form without leave of the press.', 686),
    line('Book design by a made studio.', 672),
    line('Printed in a made country', 658),
    line('Library of Congress Control Number: 0000000000', 644)
  ]);
  assert.equal(text, '');
  // A numbered line inside the page (a street address) does not end the skip.
  const page = build([
    line('Copyright © 2000 a made author', 700),
    line('Published by a made press', 686),
    line('For more, write to:', 660),
    line('1428 Made Street', 646),
    line('Made Town', 632),
    line('Book design by: a made studio', 600),
    line('www.made.example', 586),
    line('Printed in Made Land', 560)
  ]);
  assert.equal(page, '');
  const body = build([
    ...FILL.map((t, k) => line(t, 700 - k * 14)),
    line('printed in the made journal of the clinic, where the team wrote', 630),
    line('150-200 patients were seen each month in the first year of the study', 616),
    line('and the clinic did not change its methods in that time at all.', 602)
  ]);
  assert.match(body, /patients were seen each month/);
  assert.match(body, /did not change its methods/);
  assert.match(body, /printed in the made journal/);
});
