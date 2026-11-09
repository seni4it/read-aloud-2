// PDF text: each public sample PDF still reads as its kept reference.
// The full check, with the difference and the private samples, is
// `node tests/pdf-text/compare.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sentencesOf } from '../pdf-text/extract-text.mjs';
import { PUBLIC_SET, listPdfs, toText } from '../pdf-text/compare.mjs';

const pdfs = await listPdfs(PUBLIC_SET.pdfs);

test('there are public sample PDFs', () => {
  assert.ok(pdfs.length >= 4, `found ${pdfs.length}`);
});

for (const pdf of pdfs) {
  test(`${pdf} reads as its reference`, async () => {
    const ref = await readFile(path.join(PUBLIC_SET.reference, pdf.replace(/\.pdf$/, '.txt')), 'utf8');
    const text = toText(await sentencesOf(path.join(PUBLIC_SET.pdfs, pdf)));
    assert.equal(text, ref, 'run node tests/pdf-text/compare.mjs to see the difference');
  });
}

test('the sample PDFs show the cases they were made for', async () => {
  const say = async name => toText(await sentencesOf(path.join(PUBLIC_SET.pdfs, name)));
  const lig = await say('ligature.pdf');
  assert.match(lig, /emotions and condition lost/);          // private-use ligature glyph repaired
  assert.match(lig, /emotions and unconditional lost/);      // missing letters repaired
  assert.match(await say('hyphen.pdf'), /representation is cut here/);
  assert.match(await say('number-start.pdf'), /from nineteen ninety-six to two thousand four/);
  // The left column ends mid-sentence and goes on at the top of the right one.
  assert.match(await say('two-columns.pdf'), /join the two halves into one sentence without a break/);
});
