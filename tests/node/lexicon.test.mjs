// Ligature repair (extension/pdf/lexicon.js): words that lost letters
// because the PDF drew two letters as one sign.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lexicon from '../../extension/pdf/lexicon.js';
import { loadLexiconFromFile } from '../pdf-text/extract-text.mjs';

test('without the lexicon nothing is changed', () => {
  assert.equal(lexicon.lexiconReady(), false);
  assert.equal(lexicon.repairWord('emoons'), null);
  assert.equal(lexicon.repairText('the emoons'), 'the emoons');
});

test('the lexicon loads from vendor/lexicon.txt', async () => {
  await loadLexiconFromFile(lexicon);
  assert.equal(lexicon.lexiconReady(), true);
});

test('a word that lost "ti" is repaired, with its capitals', () => {
  assert.equal(lexicon.repairWord('emoons'), 'emotions');
  assert.equal(lexicon.repairWord('uncondional'), 'unconditional');
  assert.equal(lexicon.repairWord('Emoons'), 'Emotions');
  assert.equal(lexicon.repairWord('EMOONS'), 'EMOTIONS');
});

test('a ligature drawn as a private-use character is repaired', () => {
  assert.equal(lexicon.repairWord('condion'), 'condition');
});

test('a real word and a short word are left alone', () => {
  assert.equal(lexicon.repairWord('station'), null);
  assert.equal(lexicon.repairWord('the'), null);
});

test('repairText repairs every word in a string and keeps the punctuation', () => {
  assert.equal(lexicon.repairText('Strong emoons, (uncondional) love.'),
    'Strong emotions, (unconditional) love.');
});

test('a word split in two at a lost ligature is joined again', () => {
  assert.equal(lexicon.repairSplit('bene', 'cial'), 'beneficial');
  assert.equal(lexicon.repairSplit('emo', 'ons'), 'emotions');
});

test('two real words side by side are not joined', () => {
  assert.equal(lexicon.repairSplit('Once', 'a'), null);
  assert.equal(lexicon.repairSplit('to', 'be'), null);
});

test('"A" + "er" is joined only when the document shows that its font drops "ft"', async () => {
  // A fresh copy of the module, so that the repairs of the tests above cast no votes here.
  const fresh = await import('../../extension/pdf/lexicon.js?a-er');
  await loadLexiconFromFile(fresh);
  // "er" is in the word list, but a piece that short is a word only when it is a common one.
  // "A" + "er" can be "After" or "Aster": with no record of the document's repairs it is left alone.
  assert.equal(fresh.repairSplit('A', 'er'), null);
  for (let k = 0; k < 10; k++) assert.equal(fresh.repairSplit('o', 'en'), 'often');
  assert.equal(fresh.repairSplit('A', 'er'), 'After');
});

test('two short words are not joined by a ligature the document does not drop', async () => {
  const fresh = await import('../../extension/pdf/lexicon.js?short-words');
  await loadLexiconFromFile(fresh);
  for (let k = 0; k < 10; k++) assert.equal(fresh.repairSplit('o', 'en'), 'often');
  // "a" + "si" + "de" is a word, but this document drops "ft", not "si": "a de facto rule" stays.
  assert.equal(fresh.repairSplit('a', 'de'), null);
});

test('stripUnmapped turns a leftover unmapped glyph into a space and keeps µ', () => {
  assert.equal(lexicon.stripUnmapped('15YEAROLD'), '15 YEAR OLD');
  assert.equal(lexicon.stripUnmapped('5 µm'), '5 µm');
});
