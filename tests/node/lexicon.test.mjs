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
  // "A" + "er" stays apart: "er" is in the word list, so both parts are words.
  assert.equal(lexicon.repairSplit('A', 'er'), null);
});

test('stripUnmapped turns a leftover unmapped glyph into a space and keeps µ', () => {
  assert.equal(lexicon.stripUnmapped('15YEAROLD'), '15 YEAR OLD');
  assert.equal(lexicon.stripUnmapped('5 µm'), '5 µm');
});
