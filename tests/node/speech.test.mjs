// Speech rewrite (extension/pdf/speech.js): printed text into what a voice says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as lexicon from '../../extension/pdf/lexicon.js';
import { normalizeForSpeech, sayNumber, sayYear } from '../../extension/pdf/speech.js';
import { loadLexiconFromFile } from '../pdf-text/extract-text.mjs';

await loadLexiconFromFile(lexicon);

/** Rewrite a string; every character's owner is its index in the input. */
function say(text) {
  const chars = [...text];
  return normalizeForSpeech(chars, chars.map((_, i) => i));
}

test('years, units, decimals and Roman class numbers are said in words', () => {
  const { chars } = say('In 1996 the gap was 1.5 mm, then 2003 brought Class II.');
  assert.equal(chars.join(''),
    'In nineteen ninety-six the gap was one point five millimetres, then two thousand three brought Class two.');
});

test('a range and pH are said the way a person says them', () => {
  assert.equal(say('Patients aged 50-60 had a pH of 7.').chars.join(''),
    'Patients aged fifty to sixty had a P H of 7.');
});

test('an initialism that is not a word is spelled; a word in capitals stays', () => {
  assert.equal(say('The VDO and the ACE rule.').chars.join(''), 'The V D O and the ACE rule.');
});

test('each spoken character keeps an owner inside the printed text it replaced', () => {
  const { chars, owners } = say('Year 1996 ok');
  assert.equal(chars.length, owners.length);
  const spoken = chars.join('');
  const from = spoken.indexOf('nineteen');
  const to = spoken.indexOf(' ok');
  for (let i = from; i < to; i++) assert.ok(owners[i] >= 5 && owners[i] <= 8, `owner ${owners[i]} at ${i}`);
  // The highlight spreads over the whole printed year, not only its first digit.
  assert.equal(new Set(owners.slice(from, to)).size, 4);
});

test('text with nothing to rewrite comes back unchanged', () => {
  const chars = [...'Nothing to change here.'];
  const owners = chars.map((_, i) => i);
  const out = normalizeForSpeech(chars, owners);
  assert.equal(out.chars, chars);
  assert.equal(out.owners, owners);
});

test('sayNumber and sayYear', () => {
  assert.equal(sayNumber(0), 'zero');
  assert.equal(sayNumber(42), 'forty-two');
  assert.equal(sayNumber(340), 'three hundred forty');
  assert.equal(sayNumber(1205), 'one thousand two hundred five');
  assert.equal(sayYear(2020), 'twenty twenty');
  assert.equal(sayYear(1905), 'nineteen oh five');
  assert.equal(sayYear(1900), 'nineteen hundred');
});
