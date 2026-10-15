import { repairWord, repairText, stripUnmapped, repairSplit, respaceLine } from './lexicon.js';
import { normalizeForSpeech } from './speech.js';

// Turns a PDF into clean, speakable sentences that remember where they came
// from. Every sentence keeps the list of PDF text items it covers, so the
// viewer can underline the exact glyphs on the page while they're spoken.

// A heading is the WHOLE line, not a line that happens to start with
// "Method" — anchoring both ends stops mid-sentence text being promoted.
const HEADING_WORDS = /^(?:\d+(?:\.\d+)*\.?\s*)?(abstract|introduction|background|related\s+work|materials?\s+and\s+methods?|methods?|methodology|results?|results?\s+and\s+discussion|discussion|conclusions?|acknowledg(?:e)?ments?|references|bibliography|literature\s+cited|appendix|supplementary(?:\s+material)?|declarations?|funding|conflicts?\s+of\s+interest)\s*:?\.?\s*$/i;

const STOP_SECTION = /^(references|bibliography|literature\s+cited|works\s+cited)\s*:?\s*$/i;

// Conference/copyright boilerplate that sits in a footnote block on page 1.
const BOILERPLATE = /^(permission to make digital or hard copies|copyright\s*[©c]|acm\s+\d|isbn\b|doi\b|\d{3}-\d|to copy otherwise|this work is licensed|©\s*\d{4})/i;

const CAPTION_START = /^(fig(ure)?\.?|table|chart|scheme|plate|graph)\s*\.?\s*([0-9]+|[ivxlcIVXLC]+)\b/i;

// Runs of affiliation markers left between author names once the symbols are
// dropped: "Orendorff, # # + +# + Jesse". Nothing readable survives in them.
const MARKER_RUN = /(?:^|\s)[#+$@^~|\\/]{1,4}(?=\s|$)/g;

const ABBREV = [
  'al', 'etc', 'vs', 'cf', 'ca', 'approx', 'fig', 'figs', 'tab', 'eq', 'ref',
  'refs', 'no', 'nos', 'vol', 'pp', 'ed', 'eds', 'mr', 'mrs', 'ms', 'dr',
  'prof', 'inc', 'ltd', 'co', 'jr', 'sr', 'min', 'max', 'sec', 'mm', 'cm',
  'ml', 'mg', 'kg', 'hr', 'wt', 'dept', 'univ', 'st', 'p', 'e.g', 'i.e'
];

// Regexes whose matches get spoken as nothing. Order matters a little:
// bracketed numerics first, then author-year, then leftovers.
const NOISE = [
  /\s*\[\s*\d+(\s*[-–,;]\s*\d+)*\s*\]/g,
  /\s*\((?:see\s+|e\.g\.,?\s+|cf\.\s+)?[A-Z][A-Za-z'’-]+(?:\s+(?:et\s+al\.?|and|&|,)\s*[A-Z]?[A-Za-z'’-]*)*,?\s*(?:19|20)\d{2}[a-z]?(?:\s*[;,]\s*[^()]{0,60}?(?:19|20)\d{2}[a-z]?)*\)/g,
  /https?:\/\/\S+/g,
  /\bdoi:\s*\S+/gi,
  MARKER_RUN,
  // Author email blocks: "{gal,brendan,shaver}@mozilla.com"
  /\{[^{}]{0,200}\}@\S+/g,
  /\b[\w.+-]+@[\w-]+\.[\w.]+/g
];

/**
 * Read one page into positioned lines, keeping a reference to every source
 * text item so highlighting can find it again later.
 */
export async function readPage(doc, pageNumber) {
  const page = await doc.getPage(pageNumber);
  const content = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1 });
  const pageWidth = viewport.width;
  const items = content.items.filter(i => typeof i.str === 'string');

  const rows = new Map();
  items.forEach((item, index) => {
    if (!item.str.trim()) return;
    const y = Math.round(item.transform[5] / 2) * 2;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push({ item, index, x: item.transform[4], w: item.width || 0 });
  });

  const ordered = [...rows.entries()].sort((a, b) => b[0] - a[0]);
  for (const [, entries] of ordered) entries.sort((a, b) => a.x - b.x);

  // Read Aloud 2: look for the gap between columns in the middle of the TEXT AREA, not of the sheet. A book's
  // text block is often narrower than the page and off-centre; measured on the sheet, the index of a 6x9 book
  // found a "gap" inside its right column and read both columns as one.
  // The gap's exact place: slide it, within 40pt, to where the fewest lines cross it. One long entry
  // ("Artificial Intelligence") reaching past the first guess made its whole row read across all columns.
  const settle = (rows, g) => {
    if (g === null) return null;
    let best = g, fewest = Infinity;
    for (let x = g - 40; x <= g + 40; x++) {
      const n = rows.reduce((c, [, es]) => c + (es.some(e => e.x < x && e.x + e.w > x) ? 1 : 0), 0);
      if (n < fewest || (n === fewest && Math.abs(x - g) < Math.abs(best - g))) { fewest = n; best = x; }
    }
    return best;
  };
  const gutterIn = (rows, x0, x1) => {
    const shifted = rows.map(([y, es]) => [y, es.map(e => ({ ...e, x: e.x - x0 }))]);
    const g = findGutter(shifted, x1 - x0);
    return g === null ? null : settle(rows, g + x0);
  };
  const lefts = ordered.flatMap(([, es]) => es.map(e => e.x)).sort((a, b) => a - b);
  const rights = ordered.flatMap(([, es]) => es.map(e => e.x + e.w)).sort((a, b) => a - b);
  const pick = (arr, q) => arr.length ? arr[Math.min(arr.length - 1, Math.floor(arr.length * q))] : 0;
  const blockX0 = Math.max(0, pick(lefts, 0.02) - 2), blockX1 = Math.min(pageWidth, pick(rights, 0.98) + 2);
  let gutter = blockX1 - blockX0 > pageWidth * 0.3 ? gutterIn(ordered, blockX0, blockX1) : null;
  if (gutter === null) gutter = settle(ordered, findGutter(ordered, pageWidth));
  // Read Aloud 2: a page whose own evidence is too thin (a chapter opener with a title and a quote across the
  // middle, columns on their own line grids) borrows the gap the book's other pages use, when this page has
  // plenty of lines wholly on each side of it.
  const known = doc.__gutters || (doc.__gutters = new Map());
  if (gutter === null && known.size) {
    const usual = [...known.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const side = (fits) => ordered.filter(([, es]) => es.every(fits) && es.map(e => e.item.str).join('').trim().length >= 10).length;
    if (side(e => e.x + e.w <= usual + 2) >= 5 && side(e => e.x >= usual - 2) >= 5) gutter = settle(ordered, usual);
  }
  if (gutter === null) {
    // Read Aloud 2: a paper's first page opens with a centred title, author and address block that runs across
    // the middle, and that hides the two columns below it. Look again from the first real line that stays on
    // one side of the middle: all its words left of it, or all right (the block above is then read first).
    const mid = (blockX0 + blockX1) / 2;
    // A scanned page may break that block into pieces that sit on one side, so try each such line in turn.
    const oneSide = ([, es]) => es.map(e => e.item.str).join('').trim().length >= 15
      && (es.every(e => e.x + e.w <= mid) || es.every(e => e.x >= mid));
    for (let k = 1; k < ordered.length * 0.6 && gutter === null; k++) {
      if (oneSide(ordered[k])) gutter = gutterIn(ordered.slice(k), blockX0, blockX1) ?? findGutter(ordered.slice(k), pageWidth);
    }
  }

  const makeLine = (y, entries) => {
    const tokens = [];
    // A PDF fakes bold by drawing the same text twice, a hair apart. Both
    // draws reach us as separate items on the same row, and joining them
    // gives "ACEACE CLASSCLASS IIIIII". Keep the first of any pair that
    // starts at the same place and says the same thing.
    entries = entries.filter((e, i) => {
      if (i === 0) return true;
      const prev = entries[i - 1];
      return !(e.item.str === prev.item.str && Math.abs(e.x - prev.x) < 1);
    });
    entries.forEach((e, i) => {
      // A font change mid-word ends one text item and starts another with no
      // space between them. If the glyphs are actually separated on the page,
      // put the space back — otherwise you get "languagessuch".
      if (i > 0) {
        const prev = entries[i - 1];
        const gap = e.x - (prev.x + prev.w);
        const size = Math.abs(prev.item.transform[0]) || 10;
        const joined = !/\s$/.test(prev.item.str) && !/^\s/.test(e.item.str);
        if (joined && gap > size * 0.16) {
          tokens.push({
            str: ' ',
            page: pageNumber,
            item: prev.index,
            offsetBase: prev.item.str.length
          });
        }
      }
      tokens.push({ str: e.item.str, page: pageNumber, item: e.index });
    });
    return {
      y,
      text: tokens.map(t => t.str).join('').replace(/\s+/g, ' ').trim(),
      tokens,
      size: Math.abs(entries[0].item.transform[0]) || 10
    };
  };

  // Real papers mix full-width blocks (title, author list, wide figures) with columns. Split the page into
  // bands separated by the full-width rows, and read each band left column then right column. Read Aloud 2:
  // each side is split again when it has a gap of its own, so a three-column table reads column by column.
  const order = (rows, x0, x1, depth) => {
    const g = depth === 0 ? gutter : gutterIn(rows, x0, x1);
    if (g === null || depth > 2) return rows.map(([y, entries]) => makeLine(y, entries));
    const out = [];
    let left = [];
    let right = [];
    let inset = [];  // a box across both columns (a pulled quote) that the columns run past
    const flushBand = () => {
      out.push(...order(left, x0, g, depth + 1), ...order(right, g, x1, depth + 1), ...inset);
      left = [];
      right = [];
      inset = [];
    };
    // Read Aloud 2: the left column stops mid-sentence above a full-width block ("Consequently, endodontists" /
    // quote / "often needlessly spend"): the columns carry on below it, so read each column whole and the block
    // after them. A column that ends a sentence there meets a real break (a heading, a new section).
    const midSentence = () => {
      if (!left.length || !right.length) return false;
      const t = makeLine(...left[left.length - 1]).text.trim();
      return t.length > 0 && !/[.!?:]["'”’)\]]?$/.test(t);
    };
    for (const [y, entries] of rows) {
      const crosses = entries.some(e => e.x < g && e.x + e.w > g);
      const l = entries.filter(e => e.x + e.w / 2 < g);
      const r = entries.filter(e => e.x + e.w / 2 >= g);
      if (crosses || (l.length && r.length && !hasGutterGap(entries, g))) {
        if (inset.length || midSentence()) { inset.push(makeLine(y, entries)); continue; }
        flushBand();
        out.push(makeLine(y, entries));
        continue;
      }
      if (l.length) left.push([y, l]);
      if (r.length) right.push([y, r]);
    }
    flushBand();
    return out;
  };
  if (gutter !== null) known.set(Math.round(gutter), (known.get(Math.round(gutter)) || 0) + 1);
  const lines = order(ordered, 0, pageWidth, 0);

  // Deliberately NOT calling page.cleanup(): pdf.js hands the same page proxy
  // to the viewer, and cleaning it up mid-render makes render() hang forever.
  const split = dropPageFurniture(lines.filter(l => l.text));
  return { page: pageNumber, lines: split.lines, furniture: split.furniture };
}

/**
 * Drop the running head and the foot line by how they are SET, not by whether
 * we happened to see them twice.
 *
 * Repetition alone is not enough. This book's running head is set at 4.9pt at
 * x=306 — inside the right column's x range — so it became that column's
 * first line, and since a sentence routinely runs from the foot of the left
 * column into the head of the right one, the head was spliced into the middle
 * of it: "his fractured incisal ANTERIOR CLINICAL EROSIVE (ACE)
 * CLASSIFICATION and see". Learning it from a sample of pages could never fix
 * that, because a per-chapter head does not appear often enough in a sample
 * spread across five hundred pages.
 *
 * What it does do is sit above the first line of body text, below the last,
 * and in a smaller size than either. That is enough, and it is per-page.
 */
function dropPageFurniture(lines) {
  if (lines.length < 3) return { lines, furniture: [] };

  // Body size = the size that sets the most characters on the page.
  const weight = new Map();
  for (const l of lines) {
    const size = Math.round(l.size * 2) / 2;
    weight.set(size, (weight.get(size) || 0) + l.text.length);
  }
  let bodySize = 0;
  let best = -1;
  for (const [size, w] of weight) if (w > best) { best = w; bodySize = size; }
  if (!bodySize) return lines;

  const byY = [...lines].sort((a, b) => b.y - a.y);

  // Typical leading, from the gaps between consecutive rows. A running head
  // stands off from the text block by several times this.
  const gaps = [];
  for (let i = 1; i < byY.length; i++) gaps.push(byY[i - 1].y - byY[i].y);
  gaps.sort((a, b) => a - b);
  const leading = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;

  const isBody = l => l.size >= bodySize * 0.85;

  // Size is not always enough. A chapter opener whose only prose is the
  // running head elects the head as the body size — 4.9pt against a 49pt
  // display title — and a page quoting a journal abstract sets the abstract
  // in the head's own size. What still separates them is that the head sits
  // alone above the text block. Never applied to anything set larger than the
  // body, so a chapter title stays.
  // Read Aloud 2: a line that carries on a sentence (starts in lower case) or ends one is body text, wherever it
  // sits. A page with a table has tiny gaps between its rows, so "stranded" alone took a paragraph's last line.
  const prose = l => /^[a-z]/.test(l.text) || (/[.!?]["'”’)]?$/.test(l.text) && l.text.length > 20);
  const strandedAtTop = l =>
    !prose(l) && leading > 0 && l === byY[0] && byY.length > 1 &&
    l.size <= bodySize * 1.05 &&
    (byY[0].y - byY[1].y) > leading * 2.5;

  const strandedAtFoot = l =>
    !prose(l) && leading > 0 && l === byY[byY.length - 1] && byY.length > 1 &&
    l.size <= bodySize * 1.05 &&
    (byY[byY.length - 2].y - l.y) > leading * 2.5;

  const furniture = new Set();

  // Everything above the first body line, and below the last, that is small
  // and short. A section heading survives: headings are set LARGER, not
  // smaller, so isBody() is true for them.
  for (const l of byY) {
    if (isBody(l) && !strandedAtTop(l)) break;
    if (l.text.length <= 90) furniture.add(l);
  }
  for (let i = byY.length - 1; i >= 0; i--) {
    const l = byY[i];
    if (isBody(l) && !strandedAtFoot(l)) break;
    if (l.text.length <= 90) furniture.add(l);
  }

  // The running head is not just noise to discard. A book prints the chapter
  // it is in at the top of every page, which is the chapter list the reader
  // actually wants — so hand it back rather than dropping it.
  return {
    lines: furniture.size ? lines.filter(l => !furniture.has(l)) : lines,
    furniture: [...furniture].sort((a, b) => b.y - a.y)
  };
}

/**
 * True when the row genuinely leaves the gutter empty — i.e. it really is two
 * separate columns rather than one wide line that happens to straddle it.
 */
function hasGutterGap(entries, gutter) {
  for (let i = 0; i < entries.length - 1; i++) {
    const end = entries[i].x + entries[i].w;
    const next = entries[i + 1].x;
    if (end <= gutter && next >= gutter) return true;
  }
  return false;
}

/**
 * Find the column gutter by looking for a vertical channel the text never
 * crosses.
 *
 * The previous approach voted per row: count rows with a big horizontal gap
 * near the middle and require a ratio. That is fragile — it depends on how
 * wide the gutter happens to be relative to the page, and on how many short
 * rows dilute the count. Books with a tight gutter fell under the threshold
 * and both columns got read as one line.
 *
 * This instead paints every text item onto an occupancy histogram across the
 * page width and looks for the widest column of bins that nothing ever touches.
 * A real gutter is empty by construction, however narrow it is.
 */
export function findGutter(orderedRows, pageWidth) {
  // Fine bins: a book gutter can be as narrow as 10pt, which is only four
  // bins at 240 across an A4 page — too coarse to survive rounding.
  const BINS = 600;
  const binWidth = pageWidth / BINS;

  // Two views of the page, both counted once per ROW (never once per text
  // item — pdf.js splits a heading into as many items as it likes, and the
  // thresholds below are all fractions of the row count):
  //   ink[b]     rows that put ink in bin b
  //   channel[b] rows that leave a real horizontal gap over bin b, with text
  //              on both sides of it
  const ink = new Float64Array(BINS);
  const channel = new Float64Array(BINS);
  const inkMask = new Uint8Array(BINS);
  const gapMask = new Uint8Array(BINS);
  let rowsCounted = 0;

  // Wider than a stretched word space in justified text, narrower than any
  // real gutter. 1.5% of a 437pt book page is 6.6pt; its gutter is 9.9pt.
  const minGap = Math.max(3, pageWidth * 0.015);

  for (const [, entries] of orderedRows) {
    if (!entries.length) continue;
    rowsCounted++;
    inkMask.fill(0);
    gapMask.fill(0);

    let reach = -Infinity; // running right edge: text items may overlap
    for (const e of entries) {
      const left = e.x;
      const right = e.x + Math.max(e.w, 1);
      // Paint only the bins the item actually overlaps. Rounding outward
      // (floor..ceil) inflated every run of text by a bin on each side, which
      // ate a narrow gutter from both directions.
      const from = Math.max(0, Math.floor(left / binWidth));
      const to = Math.min(BINS - 1, Math.floor((right - 0.01) / binWidth));
      for (let b = from; b <= to; b++) inkMask[b] = 1;

      if (reach > -Infinity && left - reach >= minGap) {
        const a = Math.max(0, Math.ceil(reach / binWidth));
        const z = Math.min(BINS - 1, Math.floor(left / binWidth) - 1);
        for (let b = a; b <= z; b++) gapMask[b] = 1;
      }
      if (right > reach) reach = right;
    }

    for (let b = 0; b < BINS; b++) {
      ink[b] += inkMask[b];
      channel[b] += gapMask[b];
    }
  }

  if (rowsCounted < 6) return null;

  // Only consider channels whose centre sits in the middle third of the page.
  const lo = Math.floor(BINS * 0.3);
  const hi = Math.ceil(BINS * 0.7);

  // A gutter is not "the quietest strip on the page" — a printed book puts
  // display headings, full-width captions and opening paragraphs straight
  // across it, and an emptiness test loses the columns on those pages. What
  // makes a gutter a gutter is that line after line leaves the SAME gap at
  // the SAME x, with text on both sides of it. So vote on that directly, and
  // require the gap to outnumber the ink.
  const need = Math.max(4, rowsCounted * 0.25);

  // The vote only fires when both columns share a baseline, which is how this
  // book is typeset but not how every document is. When the columns run on
  // their own grids each row holds one column and there is no gap to vote on,
  // so keep the original test too: a strip almost no row puts ink in.
  // Two crossing rows, not one: a page of twenty lines that carries a display
  // heading AND a caption across the gutter is ordinary book typography, and
  // a floor of one row makes that page unreadable when the columns sit on
  // their own baselines and have no shared row to vote with.
  const allow = Math.max(2, rowsCounted * 0.06);

  let best = null;
  let runStart = -1;
  let runVoted = false;
  for (let b = lo; b <= hi + 1; b++) {
    const voted = b <= hi && channel[b] >= need && channel[b] > ink[b];
    const good = b <= hi && (voted || ink[b] <= allow);
    if (good) {
      if (runStart === -1) { runStart = b; runVoted = false; }
      if (voted) runVoted = true;
      continue;
    }
    if (runStart !== -1) {
      const runEnd = b - 1;
      const width = runEnd - runStart + 1;
      if (!best || width > best.width) {
        best = { width, voted: runVoted, centre: ((runStart + runEnd) / 2) * binWidth };
      }
      runStart = -1;
    }
  }

  findGutter.trace = { rowsCounted, need, allow, best };

  if (!best) return null;

  // The channel has to be a real gap, not inter-word spacing.
  // 1% of an A4 page is 6pt — narrower than any real gutter, wide enough to
  // reject ordinary inter-word spacing.
  if (best.width * binWidth < pageWidth * 0.01) return null;

  // And both sides must actually carry text, or this is just a ragged margin.
  const gutterBin = Math.floor(best.centre / binWidth);
  let left = 0;
  let right = 0;
  for (let b = 0; b < gutterBin; b++) left += ink[b];
  for (let b = gutterBin + 1; b < BINS; b++) right += ink[b];
  if (left < rowsCounted * 0.5 || right < rowsCounted * 0.5) return null;

  return best.centre;
}

/**
 * Running heads and folios repeat near the top or bottom of most pages.
 * Learn them from a sample so we can drop them everywhere.
 */
/**
 * The type size the document sets its body text in.
 *
 * Chapter titles cannot be found by what they say. This book's are "TRAIN
 * YOUR EYES" and "DENTAL WEAR AND AGEING" — no keyword list reaches them, and
 * the pattern that was reaching for them (a number followed by a capital)
 * matched every line of the table of contents instead, which is how the
 * sidebar ended up with sixty entries like "102 Extra photos 170".
 *
 * What a chapter title actually is, is the biggest type in the book. So
 * measure the body first, from the same spread of sample pages the running
 * heads are learned from, and judge headings against it.
 */
export function learnTypography(samplePages) {
  const weight = new Map();
  const lengths = [];
  for (const p of samplePages) {
    for (const line of p.lines) {
      const size = Math.round(line.size * 2) / 2;
      weight.set(size, (weight.get(size) || 0) + line.text.length);
      if (line.text.length > 3) lengths.push(line.text.length);
    }
  }
  let bodySize = 0;
  let best = -1;
  for (const [size, w] of weight) if (w > best) { best = w; bodySize = size; }

  // How long a full line of this document runs. A numbered heading is short
  // against the measure; a numbered LIST ITEM fills it. Without this the
  // book's "1. Dentinal scooping (the reverse cusps) and" became a chapter.
  lengths.sort((a, b) => a - b);
  const lineLength = lengths.length ? lengths[Math.floor(lengths.length / 2)] : 0;

  return { bodySize: bodySize || 0, lineLength };
}

/**
 * Is this page the table of contents?
 *
 * Its lines end in the page number they point at. It is furniture — nobody
 * wants it read aloud — and in a two-column book its columns fuse into
 * unreadable strings like "Who we areIVCHEWING PATTERNS AND Gtest87".
 */
/**
 * The chapter this page belongs to, read off its running head.
 *
 * Books print "3 | HOW TO DO: FUNCTIONAL AND ESTHETIC STABILIZATION" at the
 * top of every page of chapter three. That is the chapter list, stated by the
 * book itself on five hundred pages, and the previous sidebar ignored it in
 * favour of every large-type line it could find — which is how a five-chapter
 * book got a sixty-entry contents list of its own sub-headings.
 *
 * Only the numbered form counts. This book sets the chapter on the verso and
 * the current section on the recto, and only the verso carries the number.
 */
export function chapterFromHead(furniture) {
  for (const line of furniture || []) {
    const m = /^(\d+)\s*\|\s*(.+)$/.exec(line.text.trim());
    if (m && m[2].length > 4) return { number: m[1], title: m[2].trim() };
  }
  return null;
}

/**
 * Same chapter?
 *
 * Neither the spacing nor the hyphens in a tracked running head survive
 * extraction intact — chapter five came out as both FULL-MOUTH and FULLMOUTH
 * and appeared three times in the contents. Compare on letters and digits
 * only.
 */
function sameChapter(a, b) {
  if (!a || !b) return a === b;
  const key = c => c.number + '|' + c.title.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return key(a) === key(b);
}

export function isContentsPage(lines) {
  const real = lines.filter(l => l.text.length > 3);
  if (real.length < 8) return false;
  const pointers = real.filter(l => /\s\d{1,4}$/.test(l.text)).length;
  return pointers >= real.length * 0.5;
}

export function learnRepeatedLines(samplePages) {
  if (samplePages.length < 3) return new Set();
  const counts = new Map();

  for (const p of samplePages) {
    if (!p.lines.length) continue;
    for (const line of [...p.lines.slice(0, 3), ...p.lines.slice(-3)]) {
      // Running heads and folios are short. A long line is body copy, and
      // eating it as furniture silently deletes a sentence.
      if (line.text.length > 90) continue;
      const key = line.text.replace(/\d+/g, '#').toLowerCase().trim();
      if (key.length < 4) continue;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  const threshold = Math.max(2, Math.floor(samplePages.length * 0.25));
  const repeated = new Set();
  for (const [key, n] of counts) if (n >= threshold) repeated.add(key);
  return repeated;
}

// PDFs are full of characters that speech engines mangle or skip: typographic
// ligatures, soft hyphens, zero-width joiners, smart quotes. Map them to what
// they should actually sound like.
const LIGATURES = {
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi',
  'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st',
  'Œ': 'OE', 'œ': 'oe', 'Æ': 'AE', 'æ': 'ae',
  '‘': "'", '’': "'", '“': '"', '”': '"',
  '–': '-', '—': '-', '−': '-', ' ': ' ',
  '…': '...', '´': "'", 'ʼ': "'"
};

// Dropped entirely — invisible on the page, noise in the mouth.
const INVISIBLE = /[­​‌‍﻿⁠]/;

// Older PDFs draw accented letters as two glyphs — a floating accent then a
// dotless base — so "naïve" arrives as "na" + "¨" + "ı" + "ve". Speech engines
// read that as a symbol and a stray letter. These map the standalone accent
// onto its combining form so the pair can be recomposed into one character.
const SPACING_ACCENTS = {
  '¨': '̈', // diaeresis
  '´': '́', // acute
  '`': '̀', // grave
  'ˆ': '̂', // circumflex
  '˜': '̃', // tilde
  '¯': '̄', // macron
  '˚': '̊', // ring
  '¸': '̧', // cedilla
  '˝': '̋', // double acute
  'ˇ': '̌', // caron
  '˘': '̆'  // breve
};

const DOTLESS = { 'ı': 'i', 'ȷ': 'j' };

// Symbols a narrator would simply not say.
const UNSPOKEN = /[•·▪●∗*†‡§¶\u2460-\u2473\u24EA\u2776-\u2793]/;

// Spelling these out beats hearing silence in a methods section.
const GREEK = {
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon',
  'θ': 'theta', 'λ': 'lambda', 'μ': 'mu', 'π': 'pi', 'ρ': 'rho',
  'σ': 'sigma', 'τ': 'tau', 'φ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega',
  'Δ': 'delta', 'Σ': 'sum', 'Ω': 'omega', '°': ' degrees', '±': ' plus or minus ',
  '×': ' by ', '≈': ' approximately ', '≤': ' at most ', '≥': ' at least ',
  '→': ' to ', '™': '', '®': '', '©': ''
};

/**
 * Join floating accents onto the letter they belong to, in either order.
 * Returns fresh chars/owners arrays that stay index-aligned.
 */
function recomposeAccents(chars, owners) {
  const outChars = [];
  const outOwners = [];

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const combining = SPACING_ACCENTS[ch];

    // accent followed by its base letter: "¨" + "ı"
    if (combining && i + 1 < chars.length) {
      const raw = chars[i + 1];
      const base = DOTLESS[raw] || raw;
      if (/[a-zA-Z]/.test(base)) {
        const joined = (base + combining).normalize('NFC');
        outChars.push(joined.length === 1 ? joined : base);
        outOwners.push(owners[i + 1]);
        i++;
        continue;
      }
    }

    // base letter followed by a floating accent: "a" + "´"
    // Only when the accent isn't itself followed by a letter — in "na¨ıve" the
    // diaeresis belongs to the ı that follows it, not to the a before it.
    if (i + 1 < chars.length && SPACING_ACCENTS[chars[i + 1]]) {
      const after = chars[i + 2];
      const afterBase = after ? (DOTLESS[after] || after) : '';
      const accentLooksForward = /[a-zA-Z]/.test(afterBase);
      const base = DOTLESS[ch] || ch;
      if (!accentLooksForward && /[a-zA-Z]/.test(base)) {
        const joined = (base + SPACING_ACCENTS[chars[i + 1]]).normalize('NFC');
        outChars.push(joined.length === 1 ? joined : base);
        outOwners.push(owners[i]);
        i++;
        continue;
      }
    }

    // a dotless letter with no accent is just the plain letter
    if (DOTLESS[ch]) {
      outChars.push(DOTLESS[ch]);
      outOwners.push(owners[i]);
      continue;
    }

    outChars.push(ch);
    outOwners.push(owners[i]);
  }

  return { chars: outChars, owners: outOwners };
}

function speakable(ch) {
  if (UNSPOKEN.test(ch)) return ' ';
  if (GREEK[ch] !== undefined) return GREEK[ch];
  if (INVISIBLE.test(ch)) return '';
  const mapped = LIGATURES[ch];
  if (mapped !== undefined) return mapped;
  // Anything else exotic gets decomposed if that yields plain letters.
  if (ch.charCodeAt(0) > 0x2000) {
    const norm = ch.normalize('NFKC');
    if (norm !== ch) return norm;
  }
  return ch;
}

/**
 * Short all-caps fragments with no sentence punctuation, sitting alone on a
 * line. In an illustrated book these are labels printed over photographs
 * ("15-YEAR-OLD", "PATHOLOGICAL WEAR") — they read as shouted noise between
 * sentences. Real headings are caught by the heading rules before this.
 */
function isImageLabel(text) {
  if (text.length > 34) return false;
  if (/[.!?,;:]$/.test(text)) return false;
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  // Must be entirely upper case, and more than one word or a hyphenated tag.
  if (letters !== letters.toUpperCase()) return false;
  return /\s|-/.test(text.trim());
}

// Clinical photographs in this book carry a follow-up tag in the corner —
// "11Y", "6Y", "18M". Alone on a line it is a caption on an image, not a
// sentence, and read aloud mid-paragraph it is gibberish.
const isPhotoTag = t => /^\d{1,3}\s?(Y|YR|YRS|M|MO|MOS)$/i.test(t.trim());

const isPageNumber = t =>
  /^[\[\(]?\s*(page\s*)?\d{1,4}\s*(of\s*\d{1,4})?\s*[\]\)]?$/i.test(t);

/**
 * Build a character-addressable buffer that remembers, for every character,
 * which PDF text item produced it. Strip noise by deleting character ranges
 * rather than rewriting strings, so the mapping survives.
 */
class TracedText {
  constructor() {
    this.chars = [];
    this.owners = [];
  }

  push(tokens) {
    for (const token of tokens) {
      // Record the offset inside the item too, so a highlight can cover a
      // single word rather than the whole text run.
      const base = token.offsetBase || 0;
      for (let i = 0; i < token.str.length; i++) {
        const owner = { page: token.page, item: token.item, offset: base + i };
        // One source character can expand to several spoken ones (the "ﬃ" in
        // "association" is a single glyph in the PDF). Every expanded
        // character keeps pointing at the glyph it came from.
        for (const ch of speakable(token.str[i])) {
          this.chars.push(ch);
          this.owners.push(owner);
        }
      }
    }
  }

  space() {
    if (!this.chars.length) return;
    if (this.chars[this.chars.length - 1] === ' ') return;
    const last = this.owners[this.owners.length - 1];
    this.chars.push(' ');
    this.owners.push({ page: last.page, item: last.item, offset: last.offset + 1 });
  }

  /** Drop the final `n` characters (used to undo a trailing hyphen). */
  trimEnd(n) {
    this.chars.length = Math.max(0, this.chars.length - n);
    this.owners.length = this.chars.length;
  }

  isEmpty() {
    return !this.chars.some(c => c.trim());
  }

  /** Apply the noise regexes, then collapse whitespace, keeping owners aligned. */
  finish(stripCitations) {
    // Rejoin split accents before anything else looks at the text.
    const fixed = recomposeAccents(this.chars, this.owners);
    this.chars = fixed.chars;
    this.owners = fixed.owners;

    // Rebuild words the PDF's broken ligature glyphs destroyed.
    const repaired = repairLigatures(this.chars, this.owners);
    this.chars = repaired.chars;
    this.owners = repaired.owners;

    let text = this.chars.join('');
    const dead = new Uint8Array(text.length);

    const patterns = stripCitations ? NOISE : NOISE.slice(2);
    for (const re of patterns) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        for (let i = m.index; i < m.index + m[0].length; i++) dead[i] = 1;
        if (m[0].length === 0) re.lastIndex++;
      }
    }

    const outChars = [];
    const outOwners = [];
    for (let i = 0; i < text.length; i++) {
      if (dead[i]) continue;
      const ch = text[i];
      // Collapse runs of whitespace as we go.
      if (/\s/.test(ch)) {
        if (!outChars.length || outChars[outChars.length - 1] === ' ') continue;
        outChars.push(' ');
        outOwners.push(this.owners[i]);
        continue;
      }
      // Drop punctuation orphaned by a strip: " ," -> ","
      if (/[,.;:]/.test(ch) && outChars[outChars.length - 1] === ' ') {
        outChars.pop();
        outOwners.pop();
      }
      outChars.push(ch);
      outOwners.push(this.owners[i]);
    }

    // Rejoin words the PDF broke in half where a ligature used to be.
    const joined = repairSplitWords(outChars, outOwners);

    // Last: rewrite what the page prints into what a voice should say —
    // years, decimals, units, Roman numerals, initialisms. Owners come along,
    // so "nineteen ninety-six" still underlines the "1996" on the page.
    const said = normalizeForSpeech(joined.chars, joined.owners);

    return { text: said.chars.join('').trim(), owners: said.owners, raw: said.chars };
  }
}

/**
 * Walk the character buffer word by word and repair ligature damage.
 * Characters we invent inherit the owner of the glyph at the damage site, so
 * highlighting still lands on the right part of the page.
 */
function repairLigatures(chars, owners) {
  const outChars = [];
  const outOwners = [];
  let i = 0;

  const isWordChar = c => /[^\s]/.test(c) && !/[.,;:!?()\[\]{}"“”]/.test(c);

  while (i < chars.length) {
    if (!isWordChar(chars[i])) {
      outChars.push(chars[i]);
      outOwners.push(owners[i]);
      i++;
      continue;
    }

    let j = i;
    while (j < chars.length && isWordChar(chars[j])) j++;

    const word = chars.slice(i, j).join('');
    const fix = repairWord(word);

    if (!fix || fix === word) {
      for (let k = i; k < j; k++) {
        outChars.push(chars[k]);
        outOwners.push(owners[k]);
      }
    } else {
      // Spread the repaired spelling across the original owners: each new
      // character takes the owner at the same proportional position.
      const span = j - i;
      for (let k = 0; k < fix.length; k++) {
        const src = i + Math.min(span - 1, Math.floor((k * span) / fix.length));
        outChars.push(fix[k]);
        outOwners.push(owners[src]);
      }
    }
    i = j;
    continue;
  }

  // Anything still unmapped after repair is a glyph we could not identify.
  // Substituting in place keeps chars and owners index-aligned.
  for (let k = 0; k < outChars.length; k++) {
    const cleaned = stripUnmapped(outChars[k]);
    if (cleaned !== outChars[k]) outChars[k] = cleaned || ' ';
  }

  return { chars: outChars, owners: outOwners };
}

/**
 * Split a traced paragraph into sentences, each carrying the set of PDF text
 * items it covers.
 */
function traceToSentences(traced, sectionIndex) {
  const { text, owners } = traced;
  if (!text) return [];

  const abbrevRe = new RegExp(`\\b(${ABBREV.join('|').replace(/\./g, '\\.')})\\.$`, 'i');
  const bounds = [];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    if (!/[.!?]/.test(text[i])) continue;
    let end = i + 1;
    while (end < text.length && /["')\]]/.test(text[end])) end++;
    if (end < text.length && text[end] !== ' ') continue;

    const candidate = text.slice(start, end);
    // Don't break on "et al." or a decimal like "0.5"
    if (abbrevRe.test(candidate.trim()) || /\d\.$/.test(candidate.trim())) continue;

    bounds.push([start, end]);
    start = end;
    while (start < text.length && text[start] === ' ') start++;
    i = start - 1;
  }
  if (start < text.length) bounds.push([start, text.length]);

  // Speak whole paragraphs, not single sentences. A TTS model plans its
  // intonation across everything you hand it — give it one sentence at a time
  // and every sentence restarts at neutral pitch, which is exactly what makes
  // it sound like a robot reading a list. Merge adjacent sentences up to a
  // comfortable block size, always breaking on a sentence boundary.
  const MAX_BLOCK = 600;
  const merged = [];
  for (const [a, b] of bounds) {
    const last = merged[merged.length - 1];
    if (last && b - last[0] <= MAX_BLOCK) last[1] = b;
    else merged.push([a, b]);
  }

  const sentences = [];
  for (const [a, b] of merged) {
    // Only a single sentence longer than the cap gets split, and then at a
    // clause boundary with its punctuation kept so the engine still pauses.
    let from = a;
    while (from < b) {
      let to = b;
      if (b - from > MAX_BLOCK * 1.6) {
        const limit = from + MAX_BLOCK;
        let cut = -1;
        for (const mark of ['; ', ' — ', ', ']) {
          const found = text.lastIndexOf(mark, limit);
          if (found > from + 120) { cut = found + mark.length; break; }
        }
        if (cut === -1) cut = text.lastIndexOf(' ', limit);
        if (cut > from + 120) to = cut;
      }
      const raw = text.slice(from, to);
      const lead = raw.length - raw.trimStart().length;
      const slice = raw.trim();

      if (/[a-zA-Z]/.test(slice)) {
        const spans = new Map();
        for (let i = from; i < to; i++) {
          const o = owners[i];
          if (!o) continue;
          spans.set(`${o.page}:${o.item}`, { page: o.page, item: o.item });
        }
        // owners for this sentence, indexed by character position within
        // `slice` — this is what turns a speech boundary event into a word box.
        const charOwners = owners.slice(from + lead, from + lead + slice.length);
        sentences.push({
          text: slice,
          spans: [...spans.values()],
          charOwners,
          sectionIndex,
          // Silence after this block, in ms. Kept short because the generated
          // clip already ends with its own sentence-final silence — adding a
          // long gap on top of that is what made the pauses drag.
          pauseAfter: to >= b ? 260 : /[.!?]["')\]]?$/.test(slice) ? 110 : 50
        });
      }
      from = to;
      while (from < b && text[from] === ' ') from++;
    }
  }

  return sentences;
}

/**
 * Streamed document builder. Feed it pages as they're read; it appends
 * sentences and sections so playback can start before parsing finishes.
 */
export class DocumentBuilder {
  constructor(options = {}) {
    this.options = {
      stripCitations: true,
      stripCaptions: true,
      stopAtReferences: true,
      ...options
    };
    this.repeated = new Set();
    this.sections = [{ title: 'Beginning', startSentence: 0, page: 1 }];
    this.sentences = [];
    this.buffer = new TracedText();
    this.stopped = false;
    this.lastSize = 0;   // type size of the last line taken into the buffer
    this.bodySize = 0;   // the document's body type size, 0 until learned
    this.lineLength = 0; // median full line length, for the heading test
    this.chapter = null; // the chapter the running head last named
    this.totalPages = 0; // set by buildDocument; 0 means unknown
    this.skippingRefs = false;
  }

  setTotalPages(n) {
    this.totalPages = n || 0;
  }

  setTypography({ bodySize, lineLength } = {}) {
    this.bodySize = bodySize || 0;
    this.lineLength = lineLength || 0;
  }

  setRepeatedLines(set) {
    this.repeated = set;
  }

  flush() {
    if (this.buffer.isEmpty()) {
      this.buffer = new TracedText();
      return;
    }
    const traced = this.buffer.finish(this.options.stripCitations);
    const made = traceToSentences(traced, this.sections.length - 1);
    this.sentences.push(...made);
    this.buffer = new TracedText();
  }

  addPage(pageData) {
    if (this.stopped) return;
    const { page } = pageData;
    let { lines } = pageData;
    // Read Aloud 2: the page's header and footer: the top or bottom line, short, with the page number at one end
    if (lines.length >= 2) {
      const ys = lines.map(l => l.y), top = Math.max(...ys), bottom = Math.min(...ys);
      const RUNNING = /^\d{1,4}\s+\D.{0,70}$|^.{1,70}\D\s+\d{1,4}$|^\d{1,4}$/;
      lines = lines.filter(l => !((l.y >= top - 6 || l.y <= bottom + 6) && l.text.length < 80 && RUNNING.test(l.text.trim())));
    }
    // Read Aloud 2: footnotes and figure sources (small print under all the body text) are citations
    if (this.options.stripCitations && this.bodySize > 0) {
      const body = lines.filter(l => l.size >= this.bodySize * 0.95 && l.text.length > 20);
      if (body.length) {
        const lowest = Math.min(...body.map(l => l.y));
        lines = lines.filter(l => !(l.size <= this.bodySize * 0.85 && l.y < lowest));
      }
    }

    // The contents page is a map of the book, not part of it. Read Aloud 2: so is its last, shorter page,
    // which follows a contents page and still lists titles with page numbers ("Develop a Product Plan 253").
    const numbered = lines.filter(l => /\s(\d{1,4}|[ivxlc]{1,6})$/i.test(l.text)).length;
    if (isContentsPage(lines) || (this.inContents && numbered >= Math.max(2, lines.length * 0.25))) {
      this.inContents = true; this.flush(); return;
    }
    this.inContents = false;

    // The book names its own chapter at the top of every page. When that name
    // changes, a chapter starts — this is the structure the reader recognises,
    // and it is stated five hundred times rather than inferred once.
    const chapter = chapterFromHead(pageData.furniture);
    if (chapter && !sameChapter(chapter, this.chapter)) {
      this.chapter = chapter;
      this.skippingRefs = false;
      this.flush();
      this.sections.push({
        title: `${chapter.number}. ${respaceLine(chapter.title)}`,
        startSentence: this.sentences.length,
        page,
        level: 0
      });
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const text = line.text;
      const key = text.replace(/\d+/g, '#').toLowerCase().trim();

      if (this.repeated.has(key)) continue;
      if (isPageNumber(text)) continue;
      if (isPhotoTag(text)) continue;

      // A change of type size ends the paragraph. Page 63 of the test book
      // sets the body at 7pt, its captions at 6pt, the figure number at
      // 5.6pt and the photo tag at 9.8pt — all interleaved with the body in
      // reading order, because a caption sitting at the head of the right
      // column lands exactly where a sentence crosses over from the left.
      // Without this the caption is spoken inside the sentence: "Adopting
      // the 'wait This ACE Class II patient left untreated his fractured
      // incisal and see' strategy". Nothing about the words says they do not
      // belong together; the typography says it plainly.
      if (this.lastSize && Math.abs(this.lastSize - line.size) >
          Math.max(this.lastSize, line.size) * 0.08) {
        this.flush();
      }
      this.lastSize = line.size;

      if (this.options.stripCaptions && isImageLabel(text)) {
        this.flush();
        continue;
      }

      if (BOILERPLATE.test(text)) {
        // Skip the whole footnote block, not just its first line.
        this.flush();
        while (i < lines.length && lines[i].size <= line.size + 0.5 &&
               !/^\d+(\.\d+)*\.?\s*[A-Z]/.test(lines[i].text)) i++;
        i--;
        continue;
      }

      if (this.options.stopAtReferences && STOP_SECTION.test(text)) {
        this.flush();

        // A paper has one reference list, at the end. A book has one at the
        // end of every chapter, and stopping at the first one threw away 73%
        // of a 506-page book — parsing halted on page 135 and only the first
        // chapter existed. So only a list near the end of the document ends
        // the document; anywhere else it is a section to skip past.
        const nearEnd = !this.totalPages || page >= this.totalPages * 0.8;
        if (nearEnd) {
          this.stopped = true;
          return;
        }
        this.skippingRefs = true;
        continue;
      }

      // Skipping a mid-book reference list: resume at the next real heading.
      if (this.skippingRefs) {
        const resumes = this.bodySize > 0 && line.size >= this.bodySize * 1.6;
        if (!resumes) continue;
        this.skippingRefs = false;
      }

      if (this.options.stripCaptions && CAPTION_START.test(text)) {
        this.flush();
        while (i < lines.length && !/[.!?]["')\]]?$/.test(lines[i].text)) i++;
        continue;
      }

      // A heading is set larger than the body. When we know the body size,
      // that is the test — it finds "TRAIN YOUR EYES" and "PATHOLOGICAL WEAR"
      // which no keyword list reaches, and it does not mistake a contents
      // line for a chapter. The old numbered-line pattern stays only as a
      // fallback for documents with flat typography, where every line is the
      // same size and the keyword list is all there is.
      const short = text.length < 80 && !/[.,;:]$/.test(text);
      // 1.6x, not 1.3x. This book prints its photo labels ("11Y", "70 YEAR
      // OLD") at 1.4x the body, and they are not chapters. Its real headings
      // run 1.7x and its display titles 7x.
      const bigType = this.bodySize > 0 && line.size >= this.bodySize * 1.6;
      // "2. Background" is a heading in a paper that sets every heading at
      // body size. This pattern used to swallow the table of contents, where
      // every line starts with a number too — but the contents page is now
      // skipped whole, so the only guard still needed is the trailing page
      // number that a stray contents line would carry.
      const shortForMeasure = this.lineLength === 0 ||
        text.length < this.lineLength * 0.6;
      const looksNumbered = /^\d+(\.\d+)*\.?\s*[A-Z][A-Za-z]/.test(text) &&
        !/\s\d{1,4}$/.test(text) && shortForMeasure;
      const isHeading = short &&
        (bigType || HEADING_WORDS.test(text) || looksNumbered);

      // Read Aloud 2: a page header or footer ("Introduction 3", "4 Disciplined Entrepreneurship") is not a heading
      if (isHeading && (i === 0 || i === lines.length - 1) && /^\d{1,4}\s+\D|\D\s+\d{1,4}$/.test(text)) continue;
      if (isHeading) {
        this.flush();

        // A display title is set across as many lines as it needs. "TRAIN
        // YOUR EYES" is two lines of 49pt type and one chapter, not two.
        // Absorb the lines that follow at the same size.
        let title = text;
        const headLines = [line];  // Read Aloud 2: the heading is read aloud too, as its own short paragraph
        while (i + 1 < lines.length) {
          const next = lines[i + 1];
          if (Math.abs(next.size - line.size) > 0.5) break;
          if (next.text.length >= 80 || /[.,;:]$/.test(next.text)) break;
          // Read Aloud 2: a full-width line, or one ending in a hyphen, is body text. Scanned pages (text from
          // Vision) set the heading and the body at one size, and "Abstract" swallowed the whole abstract.
          if (/-$/.test(next.text) || (this.lineLength && next.text.length >= this.lineLength * 0.75)) break;
          title += ' ' + next.text;
          headLines.push(next);
          i++;
        }

        this.sections.push({
          title: repairText(title.replace(/\s*:$/, '')),
          startSentence: this.sentences.length,
          page,
          level: 1
        });
        for (const hl of headLines) { this.buffer.push(hl.tokens); this.buffer.space(); }
        this.flush();
        continue;
      }

      // De-hyphenate across a line break by dropping the hyphen and gluing.
      // Only when the next line really is the continuation: a lowercase start,
      // and not a line we are about to skip. Otherwise "den-" fuses with
      // whatever survives the skip and you get "den- sues in the".
      if (/[a-z]-$/.test(text) && i + 1 < lines.length) {
        const next = lines[i + 1].text;
        const nextKey = next.replace(/\d+/g, '#').toLowerCase().trim();
        const nextSkipped = this.repeated.has(nextKey) || isPageNumber(next) ||
          isPhotoTag(next) || BOILERPLATE.test(next) ||
          (this.options.stripCaptions && CAPTION_START.test(next));

        if (/^[a-z]/.test(next) && !nextSkipped) {
          this.buffer.push(line.tokens);
          this.buffer.trimEnd(1);
          continue;
        }
        // Not a real continuation: keep the hyphen and treat it as a line end.
      }

      this.buffer.push(line.tokens);
      this.buffer.space();

      if (/[.!?]["')\]]?$/.test(text) && text.length < 60) this.flush();
    }
  }

  finalize() {
    this.flush();
    this.sections = this.sections.filter((s, idx) => {
      // A chapter stays even when a sub-heading starts at the same block —
      // it is the spine of the contents list, not a heading that happened to
      // catch nothing.
      if (s.level === 0) return true;
      const next = this.sections[idx + 1];
      const end = next ? next.startSentence : this.sentences.length;
      return end > s.startSentence;
    });
    return { sentences: this.sentences, sections: this.sections };
  }
}

/**
 * Delete the spaces that are really missing ligature glyphs.
 *
 * The gap a dropped "ft" leaves on the page is wide enough that the line
 * builder reads it as a word space, so "After" arrives as "A er" and "left"
 * as "le ". Walk adjacent word pairs and join the ones the lexicon says can
 * only be one word. Owners are preserved: the joined word still points at the
 * glyphs that drew it.
 */
function repairSplitWords(chars, owners) {
  const text = chars.join('');
  const re = /([A-Za-z]+) ([A-Za-z]+)/g;
  const edits = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const fixed = repairSplit(m[1], m[2]);
    if (!fixed) continue;
    edits.push({ at: m.index, len: m[0].length, out: fixed });
    // Let the next match start after this pair so a three-way split does not
    // cascade into a guess.
    re.lastIndex = m.index + m[0].length;
  }
  if (!edits.length) return { chars, owners };

  const outChars = [];
  const outOwners = [];
  let cursor = 0;
  for (const edit of edits) {
    for (let i = cursor; i < edit.at; i++) { outChars.push(chars[i]); outOwners.push(owners[i]); }
    // Keep each surviving character pointing at its own glyph; the bridging
    // letters inherit the owner of the character before the gap.
    for (let k = 0; k < edit.out.length; k++) {
      const src = k < edit.len ? owners[edit.at + Math.min(k, edit.len - 1)] : owners[edit.at + edit.len - 1];
      outChars.push(edit.out[k]);
      outOwners.push(src);
    }
    cursor = edit.at + edit.len;
  }
  for (let i = cursor; i < chars.length; i++) { outChars.push(chars[i]); outOwners.push(owners[i]); }
  return { chars: outChars, owners: outOwners };
}


/**
 * Sample, learn, then build — the whole extraction pipeline in one call.
 *
 * Lives here so the test harness runs the same code the app runs. A test that
 * reimplements the pipeline can pass while the app is broken, which is the
 * one thing a regression suite must never do.
 *
 * `onPage(n, total, builder)` is called after each page so a caller with a UI
 * can publish partial results; the tests pass nothing.
 */
export async function buildDocument(doc, options = {}, onPage = null) {
  const builder = new DocumentBuilder(options);
  const total = doc.numPages;
  builder.setTotalPages(total);

  // Learn the running heads and the typography from pages spread across the
  // whole document. Sampling the first N only sees front matter, which
  // carries no running heads.
  const wanted = Math.min(total, doc.__scanned ? 2 : 14);  // Read Aloud 2: scanned pages are slow to read; learn from fewer
  const want = [];
  for (let k = 0; k < wanted; k++) {
    want.push(1 + Math.floor((k * (total - 1)) / Math.max(1, wanted - 1)));
  }

  const cached = new Map();
  for (const n of [...new Set(want)]) cached.set(n, await readPage(doc, n));

  const sample = [...cached.values()];
  builder.setRepeatedLines(learnRepeatedLines(sample));
  builder.setTypography(learnTypography(sample));

  for (let n = 1; n <= total; n++) {
    builder.addPage(cached.get(n) || await readPage(doc, n));
    if (onPage && (await onPage(n, total, builder)) === false) return null;
    if (builder.stopped) break;
  }

  builder.finalize();
  return builder;
}
