// Turning printed text into text a voice can read.
//
// A page and a voice want different things from the same sentence. The page
// writes "1996", "USA", "1.5 mm", "ACE Class II" because that is what a reader
// scans fastest. Handed to a speech engine those come out as "one thousand
// nine hundred ninety six", "oosa", "one point five em em" and "ACE Class
// eye" — and a book of dental classifications is nothing but Class I to
// Class VI.
//
// So rewrite them before synthesis. Every rewrite carries its glyph owners
// with it, so the word being spoken still underlines the glyphs it came from:
// "nineteen ninety-six" highlights the "1996" printed on the page.

import { isWord } from './lexicon.js';

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven',
  'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen',
  'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy',
  'eighty', 'ninety'];

const ROMAN = {
  i: 'one', ii: 'two', iii: 'three', iv: 'four', v: 'five', vi: 'six',
  vii: 'seven', viii: 'eight', ix: 'nine', x: 'ten'
};

// Only where the abbreviation is unambiguous read aloud. "m" alone is left
// as-is: in this book it is as often "molar" as "metre".
const UNITS = {
  mm: 'millimetre', cm: 'centimetre', µm: 'micrometre', um: 'micrometre',
  ml: 'millilitre', kg: 'kilogram', hz: 'hertz'
};

function under100(n) {
  if (n < 20) return ONES[n];
  const t = TENS[Math.floor(n / 10)];
  const o = n % 10;
  return o ? `${t}-${ONES[o]}` : t;
}

/** Say a whole number the way a person says it, up to 9999. */
export function sayNumber(n) {
  if (n < 100) return under100(n);
  if (n < 1000) {
    const rest = n % 100;
    return `${ONES[Math.floor(n / 100)]} hundred${rest ? ' ' + under100(rest) : ''}`;
  }
  const th = Math.floor(n / 1000);
  const rest = n % 1000;
  const head = `${under100(th)} thousand`;
  if (!rest) return head;
  return rest < 100 ? `${head} ${under100(rest)}` : `${head} ${sayNumber(rest)}`;
}

/**
 * Say a year: 1996 is "nineteen ninety-six", not "one thousand nine hundred
 * ninety-six"; 2020 is "twenty twenty"; 2003 is "two thousand three".
 */
export function sayYear(n) {
  if (n < 1000 || n > 2099) return sayNumber(n);
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  if (lo === 0) return `${under100(hi)} hundred`;
  // 2000-2009 are said in full: "two thousand three", never "twenty oh three".
  if (n >= 2000 && lo < 10) return `two thousand ${ONES[lo]}`;
  return `${under100(hi)} ${lo < 10 ? 'oh ' + ONES[lo] : under100(lo)}`;
}

function sayDecimal(whole, frac) {
  const digits = [...frac].map(d => ONES[Number(d)]).join(' ');
  return `${sayNumber(Number(whole))} point ${digits}`;
}

// Ordered. Each rule gets the match and returns what should be said instead,
// or null to leave it alone.
const RULES = [
  // pH is a word to a reader and a mystery to a voice.
  [/\bpH\b/g, () => 'P H'],

  // Class II, Type IV, Stage III, Grade VI.
  [/\b(Class|Type|Stage|Grade|Phase)\s+([IVX]{1,4})\b/g,
    (m, word, num) => ROMAN[num.toLowerCase()] ? `${word} ${ROMAN[num.toLowerCase()]}` : null],

  // A year, alone: 1996, 2020. Not 1234 pages or a 2000 mg dose — a bare
  // four-digit number in running text is overwhelmingly a year.
  [/\b(1[0-9]{3}|20[0-9]{2})\b/g, (m, n) => sayYear(Number(n))],

  // 50-60 years, 2-4 mm: a voice reads the hyphen as a minus sign.
  [/\b(\d{1,3})-(\d{1,3})\b/g, (m, a, b) => `${sayNumber(Number(a))} to ${sayNumber(Number(b))}`],

  // "1.5 mm" is one thing to say, so it has to be matched before the decimal
  // rule claims the "1.5" and leaves "mm" behind as "em em".
  [/\b(\d+(?:\.\d+)?)\s?(mm|cm|µm|um|ml|kg|Hz)\b/g, (m, n, unit) => {
    const u = UNITS[unit.toLowerCase()];
    if (!u) return null;
    const value = n.includes('.') ? sayDecimal(...n.split('.')) : sayNumber(Number(n));
    return `${value} ${u}${Number(n) === 1 ? '' : 's'}`;
  }],

  // 1.5, 5.2, 0.75
  [/\b(\d+)\.(\d+)\b/g, (m, w, f) => sayDecimal(w, f)],

  // An all-capitals token that is not an English word is an initialism.
  // USA -> U S A, VDO -> V D O. ACE and STEP are words, and stay.
  [/\b[A-Z]{2,5}\b/g, m => (isWord(m) ? null : [...m].join(' '))]
];

/**
 * Rewrite text for speech, keeping the owner of every character.
 *
 * Characters introduced by a rewrite inherit the owner of the first character
 * of the text they replaced, so the highlight lands on the printed glyphs.
 */
export function normalizeForSpeech(chars, owners) {
  const text = chars.join('');

  // Collect the edits first so the rules all see the original offsets.
  const edits = [];
  const taken = new Uint8Array(text.length);
  for (const [re, replace] of RULES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (!m[0]) { re.lastIndex++; continue; }
      let clash = false;
      for (let i = m.index; i < m.index + m[0].length; i++) if (taken[i]) clash = true;
      if (clash) continue;                       // an earlier rule owns this span
      const out = replace(...m);
      if (out == null || out === m[0]) continue;
      for (let i = m.index; i < m.index + m[0].length; i++) taken[i] = 1;
      edits.push({ at: m.index, len: m[0].length, out });
    }
  }
  if (!edits.length) return { chars, owners };

  edits.sort((a, b) => a.at - b.at);
  const outChars = [];
  const outOwners = [];
  let cursor = 0;
  for (const edit of edits) {
    for (let i = cursor; i < edit.at; i++) { outChars.push(chars[i]); outOwners.push(owners[i]); }
    // Spread the spoken form across the glyphs it replaces, so underlining
    // "nineteen ninety-six" draws a box over the whole printed "1996"
    // rather than stacking every letter on its first digit.
    for (let k = 0; k < edit.out.length; k++) {
      const src = edit.at + Math.min(edit.len - 1,
        Math.floor((k * edit.len) / edit.out.length));
      outChars.push(edit.out[k]);
      outOwners.push(owners[src]);
    }
    cursor = edit.at + edit.len;
  }
  for (let i = cursor; i < chars.length; i++) { outChars.push(chars[i]); outOwners.push(owners[i]); }
  return { chars: outChars, owners: outOwners };
}
