// Ligature repair.
//
// Many PDFs draw "ti", "fi", "ff" and friends as a single glyph. When the font
// has no ToUnicode entry for that glyph, the characters are simply not in the
// file — copy-paste in any reader loses them too. You get "emoons" for
// "emotions", "uncondional" for "unconditional", or a stray unmapped character
// sitting where the ligature should be.
//
// We cannot recover what is not there, so we reconstruct it: try the small set
// of Latin ligatures at the damaged position and keep the repair only when
// exactly one candidate produces a real English word. Ambiguity means we leave
// the word alone.

// 'ft' belongs here: this PDF drops it in "After" and "left", which came out
// as "A er" and "le". The f-ligatures are the common ones, but a font that
// draws ft as one glyph is not unusual and the damage is invisible until you
// hear it.
const CANDIDATES = ['ti', 'fi', 'fl', 'ff', 'ft', 'ffi', 'ffl', 'tt', 'ct', 'st', 'si', 'sp', 'th'];

// A character sitting inside a word that cannot be part of an English word.
// Private-use codepoints are the usual shape of an unmapped ligature glyph.
const ALIEN = /[^A-Za-z'’\-]/;

let lexicon = null;
let loading = null;

export function lexiconReady() {
  return lexicon !== null;
}

export async function loadLexicon(url) {
  if (lexicon) return lexicon;
  if (loading) return loading;

  loading = (async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('lexicon ' + res.status);
    const text = await res.text();
    lexicon = new Set(text.split('\n'));
    loading = null;
    return lexicon;
  })();

  return loading;
}

const cache = new Map();

function known(word) {
  return lexicon.has(word);
}

/**
 * Try to rebuild a damaged word.
 * Returns the repaired lowercase word, or null when we can't be sure.
 */

/**
 * Which ligatures does THIS document's font actually drop?
 *
 * "A er" can be read as "after" (ft) or "aster" (st), and a rule that only
 * accepts a single reading refuses both — so the word is spoken as two pieces
 * of nonsense. But a PDF is not ambiguous about its own font: whatever glyph
 * it failed to map, it failed to map everywhere. So count the repairs that
 * were never in doubt, and let that count settle the ones that are.
 *
 * This is per-document and learned from the document, so it works on a book
 * whose font drops "ti" and on one that drops "ft" without either being
 * written down anywhere.
 */
const votes = new Map();

function vote(candidate) {
  votes.set(candidate, (votes.get(candidate) || 0) + 1);
}

function confidence(candidate) {
  return votes.get(candidate) || 0;
}

/**
 * Choose among the readings the lexicon accepted.
 *
 * One reading wins outright and casts a vote. Several readings are settled by
 * the document's own record, and only when that record is decisive — three
 * unambiguous sightings, and at least twice the runner-up. A tie-break never
 * votes, so a guess cannot reinforce itself.
 */
function decide(hits) {
  if (hits.size === 0) return { result: null, ambiguous: false };

  if (hits.size === 1) {
    const [word, cands] = [...hits][0];
    if (cands.size === 1) vote([...cands][0]);
    return { result: word, ambiguous: false };
  }

  // Ranked voting picks a winner out of any field, including one where every
  // candidate is wrong: with ti=139 and tt=4 it read "A er" as "Atter", which
  // is a worse answer than leaving it alone. What the record actually
  // supports is narrower — a font drops one or two ligatures, not a
  // distribution — so trust only a dominant candidate and let the rest go.
  const ranked = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  const next = ranked[1] ? ranked[1][1] : 0;
  const dominant = top && top[1] >= 8 && top[1] >= Math.max(1, next) * 3
    ? top[0]
    : null;

  if (dominant) {
    const supported = [...hits].filter(([, cands]) => cands.has(dominant));
    if (supported.length === 1) return { result: supported[0][0], ambiguous: false };
  }
  return { result: null, ambiguous: true };
}

function solve(lower) {
  // Case A: an unmapped glyph is still sitting in the word. We know exactly
  // where the damage is, so only the identity has to be guessed.
  const alienAt = [];
  for (let i = 0; i < lower.length; i++) {
    if (ALIEN.test(lower[i])) alienAt.push(i);
  }

  if (alienAt.length > 0) {
    if (alienAt.length > 2) return { result: null, ambiguous: false };
    const hits = new Map();
    const tryReplace = (text, slots, depth, used) => {
      if (depth === slots.length) {
        if (known(text)) {
          if (!hits.has(text)) hits.set(text, new Set());
          for (const c of used) hits.get(text).add(c);
        }
        return;
      }
      // Replacing shifts later indices, so work right-to-left.
      const at = slots[depth];
      for (const c of CANDIDATES) {
        tryReplace(text.slice(0, at) + c + text.slice(at + 1), slots, depth + 1, [...used, c]);
      }
    };
    // Right-to-left keeps earlier indices valid.
    const slots = [...alienAt].sort((a, b) => b - a);
    tryReplace(lower, slots, 0, []);
    return decide(hits);
  }

  // Case B: the glyph produced nothing at all, so the word silently fused.
  // The position is unknown; try every interior split.
  if (lower.length < 4 || lower.length > 18) return { result: null, ambiguous: false };

  // One insertion covers most damage and is cheap. Only pay for the quadratic
  // two-insertion search when one fails, and only on shorter words.
  const search = maxDepth => {
    const hits = new Map();
    const insert = (text, depth, used) => {
      if (depth > 0 && known(text) && text !== lower) {
        if (!hits.has(text)) hits.set(text, new Set());
        for (const c of used) hits.get(text).add(c);
      }
      if (depth >= maxDepth) return;
      for (let i = 1; i < text.length; i++) {
        for (const c of CANDIDATES) {
          insert(text.slice(0, i) + c + text.slice(i), depth + 1, [...used, c]);
        }
      }
    };
    insert(lower, 0, []);
    return hits;
  };

  let hits = search(1);
  if (hits.size === 0 && lower.length <= 14) hits = search(2);
  return decide(hits);
}

/**
 * Repair one word, preserving its original capitalisation.
 * Returns null when the word is fine or the repair is ambiguous.
 */
export function repairWord(word) {
  if (!lexicon) return null;
  if (word.length < 4) return null;

  if (cache.has(word)) return cache.get(word);

  const lower = word.toLowerCase();
  const clean = lower.replace(/['’\-]/g, '');

  // Already a real word: nothing to do.
  if (!ALIEN.test(lower) && (known(lower) || known(clean))) {
    cache.set(word, null);
    return null;
  }

  const { result: fixed, ambiguous } = solve(lower);
  if (!fixed) {
    // Cache a definite "nothing to repair". An ambiguous one is left out of
    // the cache on purpose: later pages teach the document's ligature record
    // enough to settle it, and a cached null would freeze the first guess.
    if (!ambiguous) cache.set(word, null);
    return null;
  }

  // Restore capitalisation.
  let result = fixed;
  if (word === word.toUpperCase() && /[A-Z]/.test(word)) {
    result = fixed.toUpperCase();
  } else if (/^[A-Z]/.test(word)) {
    result = fixed[0].toUpperCase() + fixed.slice(1);
  }

  cache.set(word, result);
  return result;
}

// Everything a Latin-script document legitimately contains. Anything outside
// this that survived ligature repair is an unmapped glyph — the tofu box you
// see on the page — and must not reach the speech engine or the UI.
const KEEPABLE = /[A-Za-z0-9\u00C0-\u024F\s.,;:!?'"“”‘’()\[\]{}\-–—/&%$#@+=<>*°²³…]/;

/**
 * Replace leftover unmapped glyphs with a space. A space rather than nothing:
 * "15<tofu>YEAR<tofu>OLD" is a broken hyphen, and "15 YEAR OLD" reads correctly
 * while "15YEAROLD" does not.
 */
export function stripUnmapped(text) {
  let out = '';
  for (const ch of text) out += KEEPABLE.test(ch) ? ch : ' ';
  return out.replace(/ {2,}/g, ' ');
}

/** Repair every word in a plain string. Used for headings, which never pass
 *  through the character-provenance pipeline. */
export function repairText(text) {
  if (!lexicon || !text) return text;
  return text.replace(/[^\s]+/g, word => {
    const stripped = word.replace(/^[^\w'’-]+|[^\w'’-]+$/g, '');
    if (!stripped) return word;
    const fixed = repairWord(stripped);
    return fixed ? word.replace(stripped, fixed) : word;
  }).replace(/[^\s]+/g, w => stripUnmapped(w));
}

export function repairStats() {
  let repaired = 0;
  for (const v of cache.values()) if (v) repaired++;
  const ligatures = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  return { examined: cache.size, repaired, ligatures };
}

/**
 * Is this an ordinary English word?
 *
 * Used to decide whether an all-capitals token is an acronym to spell out or
 * a word to say. "USA" is not a word, so it is read "U S A"; "ACE" is one, so
 * it stays "ACE".
 */
export function isWord(token) {
  if (!lexicon) return true;   // no lexicon: change nothing
  return lexicon.has(token.toLowerCase().replace(/['’\-]/g, ''));
}

/**
 * Repair a word the PDF split in two where a ligature should be.
 *
 * When a font draws "ft" as one glyph and gives it no ToUnicode entry, the
 * characters are absent but the glyph still takes its width on the page — so
 * the extractor sees a gap and puts a space in it. "After" arrives as "A" and
 * "er", which no word-by-word repair can see.
 *
 * Returns the joined word only when exactly one candidate ligature bridges the
 * two fragments into a real word. Ambiguity, or two fragments that are both
 * already words, means we leave them alone.
 */
export function repairSplit(a, b) {
  if (!lexicon) return null;
  if (!/^[A-Za-z]+$/.test(a) || !/^[A-Za-z]+$/.test(b)) return null;
  if (a.length + b.length < 3 || a.length + b.length > 18) return null;

  // Two ordinary words next to each other are just two words. The word list has no "a" and no "I", but
  // they are words: "Once" + "a" was bridged to "Oncetta" (which the list does have).
  const isWord = (w) => lexicon.has(w.toLowerCase()) || /^[aiAI]$/.test(w);
  const aWord = isWord(a);
  const bWord = isWord(b);
  if (aWord && bWord) return null;

  // The join has to be the only reading. "a" + "er" could take several
  // bridges; "A" + "er" takes exactly one.
  const hits = new Map();
  for (const cand of CANDIDATES) {
    const joined = a + cand + b;
    if (lexicon.has(joined.toLowerCase())) {
      if (!hits.has(joined)) hits.set(joined, new Set());
      hits.get(joined).add(cand);
    }
  }
  return decide(hits).result;
}

/**
 * Put the spaces back into a run of glued letters.
 *
 * A running head is set small and tracked, so the gaps between its words are
 * no wider than the gaps between its letters and the line builder cannot tell
 * them apart: "WHAT TO LOOK FOR" arrives as "WHATTOLOOKFOR". Fine to ignore
 * while the head was being thrown away; not fine now that it is the chapter
 * title in the sidebar.
 *
 * Dynamic programming over the lexicon, scoring by the sum of the squares of
 * the word lengths so that long words win. Counting words alone ties too
 * often and loses: "FUNCTIONALAND" splits as "FUNCTION ALAND" on a tie,
 * because a word list of 370k entries contains ALAND. Single letters are
 * penalised so "A" never bridges a bad split. Returns null when the run
 * cannot be segmented, which is the common case for a proper noun and means
 * "leave it alone".
 */
export function segmentWords(run) {
  if (!lexicon || run.length < 6 || run.length > 40) return null;
  if (!/^[A-Za-z]+$/.test(run)) return null;

  const lower = run.toLowerCase();
  const n = lower.length;
  // best[i] = { cost, from } for the prefix of length i.
  const best = new Array(n + 1).fill(null);
  best[0] = { cost: 0, from: -1 };

  for (let i = 1; i <= n; i++) {
    for (let j = Math.max(0, i - 18); j < i; j++) {
      if (!best[j]) continue;
      const word = lower.slice(j, i);
      if (!lexicon.has(word)) continue;
      const cost = best[j].cost - word.length * word.length +
        (word.length === 1 ? 50 : 0);
      if (!best[i] || cost < best[i].cost) best[i] = { cost, from: j };
    }
  }
  if (!best[n]) return null;

  const cuts = [];
  for (let i = n; i > 0; i = best[i].from) cuts.unshift(best[i].from);
  cuts.push(n);
  const parts = [];
  for (let k = 0; k < cuts.length - 1; k++) parts.push(run.slice(cuts[k], cuts[k + 1]));
  return parts.length > 1 ? parts.join(' ') : null;
}

/**
 * Re-space the glued runs in a running head.
 *
 * Only ALL-CAPS runs, which is what a running head is set in. Mixed case is
 * left alone because a name is not segmentable and trying anyway produces
 * "Vai lati" out of "Vailati" — a lexicon of 370k entries will always find
 * some split of a proper noun.
 */
export function respaceLine(text) {
  return text.replace(/[A-Z]{6,}/g, run => segmentWords(run) || run);
}
