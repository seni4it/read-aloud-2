import { repairWord, repairText, stripUnmapped, repairSplit, respaceLine, resetRepairs, isWord } from './lexicon.js';
import { normalizeForSpeech } from './speech.js';

// Turns a PDF into clean, speakable sentences that remember where they came
// from. Every sentence keeps the list of PDF text items it covers, so the
// viewer can underline the exact glyphs on the page while they're spoken.

// A heading is the WHOLE line, not a line that happens to start with
// "Method" — anchoring both ends stops mid-sentence text being promoted.
const HEADING_WORDS = /^(?:\d+(?:\.\d+)*\.?\s*)?(abstract|introduction|background|related\s+work|materials?\s+and\s+methods?|methods?|methodology|results?|results?\s+and\s+discussion|discussion|conclusions?|acknowledg(?:e)?ments?|references|bibliography|literature\s+cited|appendix|supplementary(?:\s+material)?|declarations?|funding|conflicts?\s+of\s+interest)\s*:?\.?\s*$/i;

const STOP_SECTION = /^(references|bibliography|literature\s+cited|works\s+cited)\s*:?\s*$/i;

// Conference/copyright boilerplate that sits in a footnote block on page 1.
const BOILERPLATE = /^(permission to make digital or hard copies|copyright\s*[©c]|acm\s+\d|isbn\b|doi\b|\d{3}-\d{1,5}-\d|to copy otherwise|this work is licensed|©\s*\d{4})/i;

// Read Aloud 2: a sure sign of a copyright page, which a body line does not carry.
const COPYRIGHT_SIGN = /^(permission to make digital or hard copies|copyright\b|©|isbn\b|this work is licensed|to copy otherwise)|all rights reserved|library of congress/i;
const copyrightSign = text => COPYRIGHT_SIGN.test(text) || /^Printed in [A-Z]/.test(text);

// Read Aloud 2: copyright lines are skipped as a block when they are in small type or carry a sure sign
// (a copyright page is often set at body size). A weaker match at body size skips only its own line: a body
// line can start "DOI" or a number range, and the block skip took the rest of the page.
// Returns 'block', 'line' or null.
function boilerplate(line, bodySize) {
  const sure = copyrightSign(line.text);
  if (!sure && !BOILERPLATE.test(line.text)) return null;
  return sure || !bodySize || line.size < bodySize * 0.95 ? 'block' : 'line';
}

// Read Aloud 2: a printer's slug in the margin: the whole line is the layout file, its date and time
// ("Book_ch1.qxp 2/19/2007 10:08 AM Page 95"). It was learned as a running head only when a short page counted it
// twice. A body line that names such a file is read.
const SLUG = /^\S+\.(?:qxp|qxd|indd)\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}(?:\s*[AP]M)?(?:\s+Page\s+\S+)?$/i;

// Read Aloud 2: a page number in small Roman numerals: two letters or more, a real numeral ("xiv", not "c" or "x").
const ROMAN = '(?=[ivxlc]{2,}\\b)c{0,3}(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3})';

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
  // Read Aloud 2: each name is one pattern with one way to match ("[A-Z]?[A-Za-z]*" had two for each name, and a
  // list of names with no closing bracket took seconds).
  /\s*\((?:see\s+|e\.g\.,?\s+|cf\.\s+)?[A-Z][A-Za-z'’-]+(?:\s+(?:et\s+al\.?|and|&|,)\s*[A-Za-z'’-]*)*,?\s*(?:19|20)\d{2}[a-z]?(?:\s*[;,]\s*[^()]{0,60}?(?:19|20)\d{2}[a-z]?)*\)/g,
  // Read Aloud 2: figure and table references in brackets: "(Fig. 14)", "(Figs. 12, 13 and 14)", "(see Table 2-1)".
  // Each number is taken whole, with no way back ("(?=(...))\1"): a "-" is in the number and is also a separator,
  // and "(Fig. 1-2-3-...-25" with no closing bracket tried every way to cut the numbers, for seconds.
  /\s*\((?:see\s+)?(?:Figs?|Figures?|Tables?|Plates?|Diagrams?)\.?\s*(?=([\w.-]+))\1(?:\s*(?:,|and|&|–|-|to)\s*(?=([\w.-]+))\2)*\)/gi,
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
  const { items, pageWidth } = uprightItems(content.items.filter(i => typeof i.str === 'string'), viewport);

  // Read Aloud 2: rows by the real distance from the row's baseline. Fixed 2pt steps cut one line with items at
  // y 4.99 and 5.01 into two rows, read out of place. An item joins the row within 0.15 of the type size (a
  // bullet sits 1pt above its 8pt text), or, when it is a subscript (smaller type, a little below the baseline,
  // right next to a letter of the row: "L" + "R"), within 0.4 of the row's size. A superscript stays apart.
  const placed = [];
  items.forEach((item, index) => { if (item.str.trim()) placed.push({ item, index, x: item.transform[4], w: item.width || 0 }); });
  placed.sort((a, b) => b.item.transform[5] - a.item.transform[5] || a.index - b.index);
  const ordered = [];
  let base = null;  // the baseline and the size of the last row
  const touches = (es, e) => es.some(r => Math.abs(e.x - (r.x + r.w)) < 2 || Math.abs(r.x - (e.x + e.w)) < 2);
  for (const e of placed) {
    const y = e.item.transform[5], size = Math.abs(e.item.transform[0]) || 10;
    const row = ordered[ordered.length - 1];
    const d = base ? base.y - y : Infinity;
    if (base && (d < Math.max(size, base.size) * 0.15 || (size < base.size * 0.85 && d < base.size * 0.4 && touches(row[1], e)))) row[1].push(e);
    else { ordered.push([y, [e]]); base = { y, size }; }
  }
  for (const row of ordered) row[1].sort((a, b) => a.x - b.x);


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
  // A row with one piece of text across the middle of the block (a one-column preface above the columns, a
  // heading, a centred title) can never be a column row, and it only hides the gap: the finder sees the rows
  // that could be columns. A page that is all one column has few such rows, and they fail the finder's test
  // that both sides carry text.
  const bw = blockX1 - blockX0, cx = (blockX0 + blockX1) / 2;
  const acrossMiddle = ([, es]) => es.some(e => e.x <= cx - bw * 0.15 && e.x + e.w >= cx + bw * 0.15);
  const colRows = ordered.filter(r => !acrossMiddle(r));
  // Every way of finding the gap gives a candidate: the finder on the column rows, on all rows, on the sheet,
  // from the first one-sided row down (a paper's title block hides the columns below it), and the gaps the
  // book's other pages use (left-hand and right-hand pages have mirrored margins, so there are two). Each
  // candidate is scored on this page: the rows it splits cleanly (text on both sides, a gap at it) minus the
  // rows whose text runs across it. The best wins; a page splits only when at least three rows split cleanly
  // and no more than twice that many cross. A vote on the page alone failed on a page with a one-column
  // preface above the columns, and on pages with few column rows and figure captions across the gap.
  const known = doc.__gutters || (doc.__gutters = new Map());
  // The page's own candidates, best first: the finder on the column rows, on all rows, on the sheet, and from
  // the first one-sided row down (a paper's title block hides the columns below it).
  const own = [];
  const consider = (g) => { if (g !== null && g !== undefined && Number.isFinite(g)) own.push(g); };
  if (bw > pageWidth * 0.3) {
    if (colRows.length >= 6 && colRows.length < ordered.length) consider(gutterIn(colRows, blockX0, blockX1));
    consider(gutterIn(ordered, blockX0, blockX1));
  }
  consider(settle(ordered, findGutter(ordered, pageWidth)));
  {
    const mid = (blockX0 + blockX1) / 2;
    const oneSide = ([, es]) => es.map(e => e.item.str).join('').trim().length >= 15
      && (es.every(e => e.x + e.w <= mid) || es.every(e => e.x >= mid));
    // Read Aloud 2: only where a run of one-sided rows starts, and three times at most: a one-column page of
    // short lines (a list, an index) made a gap search from every row, and the work grew with rows x rows.
    for (let k = 1, tries = 0, found = false; k < ordered.length * 0.6 && !found && tries < 3; k++) {
      if (oneSide(ordered[k]) && (k === 1 || !oneSide(ordered[k - 1]))) { tries++; const g = gutterIn(ordered.slice(k), blockX0, blockX1) ?? findGutter(ordered.slice(k), pageWidth); if (g !== null) { consider(g); found = true; } }
    }
  }
  // Rows split by x: text on both sides and a gap at x. In real columns those rows line up: the left column
  // ends at one x in every row, or the right column starts at one x (a justified column does both). Word gaps
  // in one-column text that happen to fall at x do not line up. A candidate passes when at least two split
  // rows line up and they are a fair share of all the split rows.
  const splitRows = (x) => {
    const out = [];
    for (const [, es] of ordered) {
      for (let i = 1; i < es.length; i++) {
        const end = es[i - 1].x + es[i - 1].w, start = es[i].x;
        if (end <= x + 1 && start >= x - 1 && es.slice(0, i).map(q => q.item.str).join('').trim().length >= 3
            && es.slice(i).map(q => q.item.str).join('').trim().length >= 3) { out.push([end, start]); break; }
      }
    }
    return out;
  };
  const aligned = (rows) => {
    if (rows.length < 2) return 0;
    const modal = (vals) => { let best = 0; for (const v of vals) best = Math.max(best, vals.filter(w => Math.abs(w - v) <= 2).length); return best; };
    return Math.max(modal(rows.map(r => r[0])), modal(rows.map(r => r[1])));
  };
  const crossAt = (x) => ordered.filter(([, es]) => es.some(e => e.x < x - 1 && e.x + e.w > x + 1)).length;
  // Word gaps are narrow; a column gap is at least 1.5% of the page wide (the finder's own limit), in most
  // of the split rows. With that, a ragged table (few rows lined up, many split) still passes.
  const minGap = Math.max(3, pageWidth * 0.015);
  // Columns on their own line grids have no row with text on both sides. Then whole lines count: at least five
  // wholly left of x and five wholly right, with a real gap between the left lines' right edge and the right
  // lines' left edge.
  // Read Aloud 2: only lines in the body size count. A small boxed note beside a figure (8pt, starting just past the
  // gap) made the gap between 12pt columns look 3.7pt wide, and a two-column page was read line across line.
  const whole = (x) => {
    const sz = ([, es]) => Math.max(...es.map(e => Math.abs(e.item.transform[0]) || 10));
    const txt0 = ([, es]) => es.map(e => e.item.str).join('').trim().length >= 10;
    const sizes = ordered.filter(txt0).map(sz).sort((a, b) => a - b);
    const body = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
    const txt = txt0;
    const L = ordered.filter(r => txt(r) && r[1].every(e => e.x + e.w <= x + 1));
    const R = ordered.filter(r => txt(r) && r[1].every(e => e.x >= x - 1));
    // the gap is measured on the body-size lines when both sides have some (a caption in small type beside a body
    // column, with no body line on its side, is measured as it is)
    const big = (rows) => rows.filter(r => sz(r) >= body * 0.9);
    const [Lg, Rg] = big(L).length && big(R).length ? [big(L), big(R)] : [L, R];
    const gap = Lg.length && Rg.length ? Math.min(...Rg.map(([, es]) => Math.min(...es.map(e => e.x)))) - Math.max(...Lg.map(([, es]) => Math.max(...es.map(e => e.x + e.w)))) : 0;
    return { l: L.length, r: R.length, gap };
  };
  // Read Aloud 2: a diagram's labels (8pt, "200 cattle" / "Treatment cost") line up in columns of their own, and
  // a one-column page with such a diagram passed as two columns: every body line (10.5pt, the full width) was
  // read across the gap and the labels were read as columns. When the rows that line up are set smaller than
  // the rows that cross, and the crossing rows are many, the "columns" are a figure, not the text.
  const sizeOf = ([, es]) => Math.max(...es.map(e => Math.abs(e.item.transform[0]) || 10));
  const median = (a) => { const b = [...a].sort((p, q) => p - q); return b.length ? b[Math.floor(b.length / 2)] : 0; };
  const figureNot = (x, lined) => {
    const crossing = ordered.filter(([, es]) => es.some(e => e.x < x - 1 && e.x + e.w > x + 1));
    if (crossing.length < 3 || crossing.length * 2 < lined) return false;
    const txt = ([, es]) => es.map(e => e.item.str).join('').trim().length >= 3;
    const sided = ordered.filter(r => txt(r) && !crossing.includes(r) && (r[1].every(e => e.x + e.w <= x + 1) || r[1].every(e => e.x >= x - 1) || hasGutterGap(r[1], x)));
    // Labels are short ("200 cattle", "Treatment cost"); column lines are not. A page with a 12pt one-column
    // preface above 10pt columns must still split: its column lines are long.
    const len = ([, es]) => es.map(e => e.item.str).join(' ').replace(/\s+/g, ' ').trim().length;
    return sided.length > 0 && median(sided.map(sizeOf)) < median(crossing.map(sizeOf)) * 0.9 && median(sided.map(len)) < 24;
  };
  const judge = (g) => {
    const x = settle(ordered, g); const rows = splitRows(x); const lined = aligned(rows);
    const widths = rows.map(r => r[1] - r[0]).sort((a, b) => a - b); const wide = widths.length ? widths[Math.floor(widths.length / 2)] >= minGap : false;
    const w = whole(x);
    const total = lined + Math.min(w.l, w.r);
    const ok = ((lined >= 2 && wide && (lined >= rows.length * 0.4 || rows.length >= 6)) || (w.l >= 5 && w.r >= 5 && w.gap >= minGap)) && !figureNot(x, total);
    if (globalThis.RA2_DEBUG) console.log('judge', Math.round(g), '->', Math.round(x), 'lined', lined, 'rows', rows.length, 'wide', wide, 'whole', JSON.stringify(w), 'minGap', minGap.toFixed(1), 'figureNot', figureNot(x, total));
    return { x, split: rows.length, lined: total, cross: crossAt(x), ok };
  };
  const scores = [];
  let gutter = null;
  for (const g of own) { const j = judge(g); scores.push(['own', Math.round(g), j.split, j.lined, j.cross]); if (j.ok) { gutter = j.x; break; } }
  // The page's own finder found nothing sound: the gaps the book's other pages use are tried (left-hand and
  // right-hand pages have mirrored margins, so there are two), and the one with most lined-up rows is taken.
  if (gutter === null) {
    let best = null;
    for (const [g, count] of known) {
      const j = judge(g); scores.push(['known', g, j.split, j.lined, j.cross]);
      // Read Aloud 2: another page's gap that 3 rows in 4 of this page run across is not a gap here (a
      // one-column page whose header row has the page number and the title far apart split at the title).
      if (!j.ok || j.cross > ordered.length * 0.75) continue;
      if (!best || j.lined > best.lined || (j.lined === best.lined && (j.cross < best.cross || (j.cross === best.cross && count > best.count)))) best = { ...j, count };
    }
    if (best) gutter = best.x;
  }
  if (globalThis.RA2_DEBUG) console.log('gutter', pageNumber, 'block', Math.round(blockX0), Math.round(blockX1), 'colRows', colRows.length, 'of', ordered.length, 'chosen', gutter === null ? 'none' : Math.round(gutter), JSON.stringify(scores));

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
      // Read Aloud 2: the same fake bold, cut into overlapping pieces ("the l" "la" "an" "nd" "d (Figs" for
      // "the land (Figs"): letters that start inside the previous piece and repeat its last letters are skipped.
      let skip = 0;
      if (i > 0) {
        const prev = entries[i - 1];
        const overlap = (prev.x + prev.w) - e.x;
        const charW = e.w / Math.max(1, e.item.str.length);
        if (overlap > 1 && charW > 0) {
          // the overlap in letters is a rough number ("ti" + "im": 3.2pt over 6.5pt a letter): the nearest
          // counts that repeat the previous piece's last letters are tried, so "tiime" and "wwill" do not happen
          const k = Math.min(e.item.str.length, Math.round(overlap / charW));
          for (const c of [k, k - 1, k + 1]) {
            if (c > 0 && c <= e.item.str.length && c <= prev.item.str.length && e.item.str.slice(0, c) === prev.item.str.slice(-c)) { skip = c; break; }
          }
        }
      }
      if (skip < e.item.str.length) tokens.push({ str: e.item.str.slice(skip), page: pageNumber, item: e.index, offsetBase: skip || undefined });
    });
    return {
      y,
      text: tokens.map(t => t.str).join('').replace(/\s+/g, ' ').trim(),
      tokens,
      size: lineSize(entries),
      // the size where the line meets the line before it (see addPage)
      first: Math.abs(entries[0].item.transform[0]) || 10,
      x0: Math.min(...entries.map(e => e.x)),
      x1: Math.max(...entries.map(e => e.x + e.w))
    };
  };

  // Real papers mix full-width blocks (title, author list, wide figures) with columns. Split the page into
  // bands separated by the full-width rows, and read each band left column then right column. Read Aloud 2:
  // each side is split again when it has a gap of its own, so a three-column table reads column by column.
  const order = (rows, x0, x1, depth, g0) => {
    const g = g0 !== undefined ? g0 : depth === 0 ? gutter : gutterIn(rows, x0, x1);
    if (g === null || depth > 2) return rows.map(([y, entries]) => makeLine(y, entries));
    const out = [];
    let left = [];
    let right = [];
    let inset = [];  // a box across both columns (a pulled quote) that the columns run past
    let insetSure = false;
    let insetMark = [0, 0];  // how many left and right rows the band had when the box began
    const flushBand = () => {
      out.push(...order(left, x0, g, depth + 1), ...order(right, g, x1, depth + 1), ...inset);
      left = [];
      right = [];
      inset = [];
      insetSure = false;
    };
    // Read Aloud 2: the left column stops mid-sentence above a full-width block ("Consequently, endodontists" /
    // quote / "often needlessly spend"): the columns carry on below it, so read each column whole and the block
    // after them. A column that ends a sentence there meets a real break (a heading, a new section).
    // Both columns must stop mid-sentence: a left column that stops mid-sentence while the right column ends its
    // sentence simply goes on at the top of the right column (a page with two short columns above a chart, then
    // full-width text: the text below was held back as a "box" and its short last line was read first).
    const midSentence = () => {
      if (!left.length || !right.length) return false;
      const open = (rows) => { const t = makeLine(...rows[rows.length - 1]).text.trim(); return t.length > 0 && !/[.!?:]["'”’)\]]?$/.test(t); };
      return open(left) && open(right);
    };
    const breaks = ([, es]) => es.some(e => e.x < g && e.x + e.w > g)
      || (es.some(e => e.x + e.w / 2 < g) && es.some(e => e.x + e.w / 2 >= g) && !hasGutterGap(es, g));
    // Read Aloud 2: the gap is one number for the page, but a page can hold a narrow column with a figure
    // caption beside it (gap at 265) above two wide columns (gap at 353). After three rows, the band knows
    // where its left column ends and its right column starts; text that starts past the left edge is right-hand
    // text, and text that ends before the right edge is left-hand text, whatever side of the gap it sits on.
    // The edges come from the last three rows on each side only: a page can change its layout part way down
    // (wide columns, then a narrow column beside a figure, then wide columns again) without any row crossing.
    const edges = () => {
      const last = (arr) => arr.slice(-3);
      const L = left.length >= 3 ? Math.max(...last(left).map(([, es]) => Math.max(...es.map(e => e.x + e.w)))) : null;
      const R = right.length >= 3 ? Math.min(...last(right).map(([, es]) => Math.min(...es.map(e => e.x)))) : null;
      return [L, R];
    };
    const sideOf = (e, L, R) => {
      if (L !== null && e.x >= L - 1) return 'r';
      if (R !== null && e.x + e.w <= R + 1) return 'l';
      return e.x + e.w / 2 < g ? 'l' : 'r';
    };
    let bandStart = 0;
    for (let idx = 0; idx < rows.length; idx++) {
      const [y, entries] = rows[idx];
      if (!left.length && !right.length && !inset.length) bandStart = idx;
      const [L, R] = edges();
      const l = entries.filter(e => sideOf(e, L, R) === 'l');
      const r = entries.filter(e => sideOf(e, L, R) === 'r');
      const crosses = entries.some(e => e.x < g && e.x + e.w > g && !((L !== null && e.x >= L - 1) || (R !== null && e.x + e.w <= R + 1)));
      const apart = !l.length || !r.length || Math.max(...l.map(e => e.x + e.w)) <= Math.min(...r.map(e => e.x));
      if (crosses || (l.length && r.length && !apart)) {
        // Read Aloud 2: a page can change its layout part way down: a narrow column beside a figure above, two
        // wide columns below. The lower rows all cross the upper gap. A run of three or more such rows is given
        // its own gap search; with a gap of its own it is read as its own columns. A quote box has no gap inside.
        let end = idx;
        while (end + 1 < rows.length && breaks(rows[end + 1])) end++;
        const run = rows.slice(idx, end + 1);
        if (run.length >= 3 && depth < 2) {
          const g2 = gutterIn(run, x0, x1);
          if (g2 !== null && run.filter(([, es]) => hasGutterGap(es, g2) && es.some(e => e.x + e.w <= g2) && es.some(e => e.x >= g2)).length >= 2) {
            flushBand();
            out.push(...order(run, x0, x1, depth + 1, g2));
            idx = end;
            continue;
          }
        }
        // Read Aloud 2: a three-column table at the top of the page set the gap at 301; below it, a big bold
        // question heading in the left column (119 to 345) reached past that gap, with the right column at 359.
        // Each heading line crossed on its own, between right-hand rows that did not, so the lines of the two
        // columns came out interleaved. The rows from here down to the next full-width row are given one gap
        // search of their own; when that gap splits them cleanly (lines wholly on each side, none across), they
        // are read as their own columns.
        if (run.length < 3 && depth < 2 && !inset.length) {
          let stop = idx;
          while (stop + 1 < rows.length && !acrossMiddle(rows[stop + 1])) stop++;
          const span = rows.slice(bandStart, stop + 1);  // the band's rows above this one belong to the same columns
          const g2 = span.length >= 4 ? gutterIn(span, x0, x1) : null;
          if (g2 !== null && Math.abs(g2 - g) > 5) {
            const txt = ([, es]) => es.map(e => e.item.str).join('').trim().length >= 3;
            const L = span.filter(r => txt(r) && r[1].every(e => e.x + e.w <= g2 + 1)).length;
            const R = span.filter(r => txt(r) && r[1].every(e => e.x >= g2 - 1)).length;
            const X = span.filter(([, es]) => es.some(e => e.x < g2 - 1 && e.x + e.w > g2 + 1)).length;
            if (L >= 2 && R >= 2 && X === 0) {
              left = []; right = [];  // re-read with the span, not flushed on their own
              out.push(...order(span, x0, x1, depth + 1, g2));
              idx = stop;
              continue;
            }
          }
        }
        if (inset.length || midSentence()) {
          // Read Aloud 2: the right-hand rows that arrive while the box is still in doubt are remembered: if the
          // box turns out to be a heading, they belong after it, not before it (a page whose print slug at the
          // top put "core, compared to the file's total diameter" before the running head and the question).
          if (!inset.length) insetMark = [left.length, right.length];
          inset.push({ ...makeLine(y, entries), inset: true }); continue;
        }
        flushBand();
        out.push(makeLine(y, entries));
        continue;
      }
      // A box only if the left column goes on below it with the same sentence (a small first letter). A heading
      // such as "References" followed by a new list is a real break: read it where it is, and do not skip it.
      // A word split at the end of the box ("require-" / "ments of the obturation technique used.") goes on in the
      // box's own text, not in the column, and so does a line set as small as the box's last line (a caption's tail).
      if (inset.length && !insetSure && l.length) {
        const lastBox = inset[inset.length - 1];
        const here = makeLine(y, entries);
        if (/[-‐]$/.test(lastBox.text.trim()) || (here.size < lastBox.size * 1.05 && lastBox.size < 0.9 * makeLine(...left[left.length - 1] || [y, entries]).size)) {
          inset.push({ ...here, inset: true }); continue;
        }
        if (/^[a-z]/.test(makeLine(y, l).text.trim())) insetSure = true;
        else {
          const real = inset.map(({ inset: _, ...line }) => line);
          inset = [];
          const lAfter = left.splice(insetMark[0]), rAfter = right.splice(insetMark[1]);
          flushBand();
          out.push(...real);
          left = lAfter; right = rAfter;
        }
      }
      if (l.length) left.push([y, l]);
      if (r.length) right.push([y, r]);
    }
    flushBand();
    return out;
  };
  if (gutter !== null) known.set(Math.round(gutter), (known.get(Math.round(gutter)) || 0) + 1);
  // Read Aloud 2: a table is rows of three or more short cells with clear space between them (a word space is
  // under one letter wide; a cell gap is over two and a half). Read as text, a table is a string of loose words
  // ("Property Recovered Elongation Biocompatibility Effective Modulus"). Speechify skips tables; so can this
  // reader ("Skip tables"). A lone row with three gaps is not a table: three such rows on a page are.
  // A row holds everything at one height across the page, so the table's cells and a line of the other
  // column share a row: the cells are marked by where they sit (x), and a line is table only when it lies
  // within the cells' span.
  const tableSpans = new Map();  // y -> [[x0, x1], ...]
  const tableBoxes = [];  // the area of each table: its rows down to a line of text
  {
    const cellsOf = (es) => {
      const cells = [];
      for (const e of es) {
        const size = Math.abs(e.item.transform[0]) || 10;
        const last = cells[cells.length - 1];
        // Read Aloud 2: a bullet starts a cell; it sits a point above its text and now shares the text's row
        if (last && e.x - last.end < size * 2.5 && !/^\s*[•▪●◦‣]/.test(e.item.str)) { last.end = Math.max(last.end, e.x + e.w); last.text += e.item.str; }
        else cells.push({ start: e.x, end: e.x + e.w, text: e.item.str });
      }
      return cells.map(c => ({ ...c, text: c.text.trim() })).filter(c => c.text);
    };
    const spans = [];
    for (const [y, es] of ordered) {
      const cells = cellsOf(es);
      let run = [];
      const close = () => { if (run.length >= 3) spans.push({ y, cells: run.map(c => ({ ...c, key: Math.round(c.start / 4) })) }); run = []; };
      for (const c of cells) {
        // the two columns of a page are not one table row: a run ends at the column gap
        if (c.text.length < 40) run.push(c); else close();
      }
      close();
    }
    // A table's cells line up from row to row. A justified line of a narrow column with three wide word gaps
    // ("again start   recording at   that point.") has gaps that line up with nothing: it is text.
    // Only the cells that line up are the table: a line of the other column at the same height, in the same
    // run, lines up with nothing and stays outside the span.
    const count = new Map();
    for (const sp of spans) for (const k of new Set(sp.cells.map(c => c.key))) count.set(k, (count.get(k) || 0) + 1);
    const table = [];
    for (const sp of spans) {
      const lined = sp.cells.filter(c => (count.get(c.key) || 0) >= 3);
      if (lined.length >= 2) table.push({ y: sp.y, a: Math.min(...lined.map(c => c.start)), b: Math.max(...lined.map(c => c.end)) });
    }
    if (table.length >= 3) {
      for (const { y, a, b } of table) tableSpans.set(y, [...(tableSpans.get(y) || []), [a, b]]);
      // One box for each table: a row of text between table rows (a sentence, or 40 letters or more) ends it.
      const inTable = new Map(table.map(t => [t.y, t]));
      let run = [];
      const close = () => {
        if (run.length >= 2) tableBoxes.push({ top: run[0].y, bottom: run[run.length - 1].y, a: Math.min(...run.map(t => t.a)), b: Math.max(...run.map(t => t.b)) });
        run = [];
      };
      for (const [y, es] of ordered) {
        if (inTable.has(y)) { run.push(inTable.get(y)); continue; }
        const t = es.map(e => e.item.str).join('').trim();
        if (t.length >= 40 || /[.!?]["')\]]?$/.test(t)) close();
      }
      close();
    }
  }
  const lines = order(ordered, 0, pageWidth, 0);
  // Read Aloud 2: a short line inside the table's area is a cell's second line ("Cancer" / "Rsrch"), not text.
  const inBox = l => l.text.length < 40 && !/[.!?]["')\]]?$/.test(l.text) && tableBoxes.some(box =>
    l.y <= box.top + 1 && l.y >= box.bottom - 1 && l.x0 >= box.a - 2 && l.x1 <= box.b + 2);
  for (const l of lines) if ((tableSpans.get(l.y) || []).some(([a, b]) => l.x0 >= a - 2 && l.x1 <= b + 2) || inBox(l)) l.table = true;

  // Deliberately NOT calling page.cleanup(): pdf.js hands the same page proxy
  // to the viewer, and cleaning it up mid-render makes render() hang forever.
  const split = dropPageFurniture(lines.filter(l => l.text));
  return { page: pageNumber, lines: split.lines, furniture: split.furniture, gutter };
}

/**
 * Read Aloud 2: the type size of a line is the size of most of its characters. The first item alone made a
 * line with a raised drop cap (one 30pt letter, then 10pt text) a 30pt line, and so a heading.
 */
function lineSize(entries) {
  const weight = new Map();
  for (const e of entries) {
    const size = Math.abs(e.item.transform[0]) || 10;
    weight.set(size, (weight.get(size) || 0) + e.item.str.trim().length);
  }
  let size = 10, best = -1;
  for (const [s, w] of weight) if (w > best) { best = w; size = s; }
  return size;
}

/**
 * Read Aloud 2: a page whose text is drawn turned (a landscape page set with /Rotate 90 or 270) is read in the
 * text's own direction. pdf.js gives each item's place on the unturned sheet, where those lines run up or down
 * the page: in rows by height, the lines came out mixed. The direction of most characters, in quarter turns,
 * is turned back on every item, and the page width is measured along the lines. A page of upright text is
 * left as it is.
 */
function uprightItems(items, viewport) {
  const weight = [0, 0, 0, 0];
  const turnOf = ({ transform: t }) => ((Math.round(Math.atan2(t[1], t[0]) / (Math.PI / 2)) % 4) + 4) % 4;
  for (const item of items) weight[turnOf(item)] += item.str.length;
  const q = weight.indexOf(Math.max(...weight));
  if (q === 0) return { items, pageWidth: viewport.width };
  // turn a point or a direction back by q quarter turns
  const turn = ([u, v]) => (q === 1 ? [v, -u] : q === 2 ? [-u, -v] : [-v, u]);
  const [x0, y0, x1, y1] = viewport.viewBox || [0, 0, viewport.width, viewport.height];
  const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(turn);
  const minX = Math.min(...corners.map(c => c[0])), minY = Math.min(...corners.map(c => c[1]));
  const pageWidth = Math.max(...corners.map(c => c[0])) - minX;
  return {
    pageWidth,
    items: items.map(item => {
      const [a, b, c, d, e, f] = item.transform;
      const [e2, f2] = turn([e, f]);
      return { ...item, transform: [...turn([a, b]), ...turn([c, d]), e2 - minX, f2 - minY] };
    })
  };
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
  if (!bodySize) return { lines, furniture: [] };

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
    // Read Aloud 2: small type that reads as text (a bold list at the foot of a column) is text, not a footer
    if (prose(l) && l.size >= bodySize * 0.7) break;
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
    // Read Aloud 2: each page counts a line once. On a page of fewer than 6 lines the first 3 and the last 3
    // share lines, and one page alone made its own lines running heads.
    const keys = new Set();
    for (const line of [...p.lines.slice(0, 3), ...p.lines.slice(-3)]) {
      // Running heads and folios are short. A long line is body copy, and
      // eating it as furniture silently deletes a sentence.
      if (line.text.length > 90) continue;
      const key = line.text.replace(/\d+/g, '#').toLowerCase().trim();
      if (key.length >= 4) keys.add(key);
    }
    for (const key of keys) counts.set(key, (counts.get(key) || 0) + 1);
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
  '–': '-', '—': '-', '−': '-', '‐': '-', '‑': '-', ' ': ' ',
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

// Symbols a narrator would simply not say. Read Aloud 2: also "_" (a "____" fill-in line, a file name in the
// margin) and "¹" (a footnote mark, or a wrong apostrophe glyph); the old filter of unmapped glyphs took them.
const UNSPOKEN = /[•·▪●∗*†‡§¶_¹\u2460-\u2473\u24EA\u2776-\u2793]/;

// Spelling these out beats hearing silence in a methods section.
const GREEK = {
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon',
  'θ': 'theta', 'λ': 'lambda', 'μ': 'mu', 'π': 'pi', 'ρ': 'rho',
  'σ': 'sigma', 'τ': 'tau', 'φ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega',
  'Δ': 'delta', 'Σ': 'sum', 'Ω': 'omega', '°': ' degrees ', '±': ' plus or minus ',
  '×': ' by ', '≈': ' approximately ', '≤': ' at most ', '≥': ' at least ',
  '→': ' to ', '™': '', '®': '', '©': '',
  // Read Aloud 2: fractions ("½ mm per second" lost its ½: the unmapped-glyph filter dropped it)
  '½': ' one half ', '¼': ' one quarter ', '¾': ' three quarters ', '⅓': ' one third ', '⅔': ' two thirds ',
  '⅛': ' one eighth ', '⅜': ' three eighths ', '⅝': ' five eighths ', '⅞': ' seven eighths ', '⅕': ' one fifth ', '‰': ' per mille '
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

// Read Aloud 2: the start of a unit after a micro prefix ("μm", "μg", "μmol", "μs").
const MICRO_UNIT = /^(mol|m|g|l|L|s|M|A|V|W|Hz|Pa)(?![A-Za-z])/;
// Read Aloud 2: a sign a voice cannot say — an emoji, a skin tone, a flag letter, a pictograph. NFKC runs
// first, so a sign that stands for letters ("㎜" is "mm") is kept as its letters.
const PICTOGRAPH = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}\p{So}]/u;

/**
 * Read Aloud 2: is this Greek mu the micro sign of a unit ("5 μm", "3μs", "μmol")? Then the speech rewrite
 * says it as "micro". `before` is the text pushed before it, `after` the text after it. "μOR" and
 * "the μ value" stay the letter mu.
 */
function isMicro(before, after) {
  return MICRO_UNIT.test(after) && (/\d ?$/.test(before) || /^(m|g|mol|l|L)(?![A-Za-z])/.test(after));
}

function speakable(ch, micro = false) {
  if (ch === 'μ' && micro) return 'µ';
  if (UNSPOKEN.test(ch)) return ' ';
  if (GREEK[ch] !== undefined) return GREEK[ch];
  if (INVISIBLE.test(ch)) return '';
  const mapped = LIGATURES[ch];
  if (mapped !== undefined) return mapped;
  // Anything else exotic gets decomposed if that yields plain letters.
  // Read Aloud 2: a mathematical letter (𝑥, 𝛼) is one character of two code units; NFKC gives its plain letter.
  if (ch.codePointAt(0) > 0x2000) {
    const norm = ch.normalize('NFKC');
    if (norm !== ch) return GREEK[norm] !== undefined ? GREEK[norm] : norm;
  }
  if (PICTOGRAPH.test(ch)) return ' ';
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
      // Read Aloud 2: walk by character, not by code unit, so a character of two code units (𝑥) reaches
      // speakable() whole. The offset stays in code units, and every entry of `chars` stays one code unit
      // long, which finish() needs to keep the owners aligned.
      const s = token.str;
      for (let i = 0; i < s.length;) {
        const cp = String.fromCodePoint(s.codePointAt(i));
        const owner = { page: token.page, item: token.item, offset: base + i };
        // One source character can expand to several spoken ones (the "ﬃ" in
        // "association" is a single glyph in the PDF). Every expanded
        // character keeps pointing at the glyph it came from.
        const micro = cp === 'μ' && isMicro(this.chars.slice(-2).join(''), s.slice(i + cp.length, i + cp.length + 4));
        for (const ch of speakable(cp, micro).split('')) {
          this.chars.push(ch);
          this.owners.push(owner);
        }
        i += cp.length;
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

  /** Drop the final `n` characters. */
  trimEnd(n) {
    this.chars.length = Math.max(0, this.chars.length - n);
    this.owners.length = this.chars.length;
  }

  /** Read Aloud 2: drop the spaces at the end of the buffer. */
  trimSpaces() {
    while (this.chars.length && /\s/.test(this.chars[this.chars.length - 1])) this.trimEnd(1);
  }

  /** Read Aloud 2: undo a line-end hyphen — the spaces after it, then the hyphen itself, if there is one (a soft
   *  hyphen leaves nothing in the buffer). */
  trimHyphen() {
    this.trimSpaces();
    if (this.chars[this.chars.length - 1] === '-') this.trimEnd(1);
  }

  isEmpty() {
    return !this.chars.some(c => c.trim());
  }

  /** Apply the noise regexes, then collapse whitespace, keeping owners aligned. */
  finish(stripCitations, skipParens = false) {
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

    const patterns = [...(stripCitations ? NOISE : NOISE.slice(3))];  // the first three are citations
    if (skipParens) patterns.push(/\s*\([^()]{1,300}\)/g, /\s*\[[^\[\]]{1,300}\]/g, /\s*\{[^{}]{1,300}\}/g);
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
    // Read Aloud 2: only a list marker holds the sentence together: "1." at the start of a sentence, or a
    // number of 1 or 2 digits followed by its item, which starts with a digit or a small letter
    // ("…length 4. 25/.04 to…"). A number at a sentence end ("…was 120. The next…", "…on p. 12. The
    // next…") ends it. A decimal ("0.5") has no space after its dot, so it never gets here.
    const listMarker = /^\d{1,2}\.$/.test(candidate.trim()) ||
      (/\s\d{1,2}\.$/.test(candidate.trim()) && /^ +[0-9a-z]/.test(text.slice(end, end + 4)));
    if (abbrevRe.test(candidate.trim()) || listMarker) continue;

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
        for (const mark of ['; ', ' - ', ', ']) {  // the dash is already '-' (LIGATURES)
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
// Read Aloud 2: left parts that English joins to a whole word with a hyphen ("well-known", "self-esteem"),
// where the word list also has the closed form.
const HYPHEN_PREFIXES = new Set(['self', 'well']);
// Read Aloud 2: a prefix keeps its hyphen before a word that starts with the prefix's own last vowel
// ("re-entry", "co-operation", "pre-existing", "anti-inflammatory"). Before another letter it is a cut word
// ("re-" + "search" is "research", "re-" + "port" is "report"), so it is joined.
const VOWEL_PREFIXES = new Set(['re', 'pre', 'de', 'co', 'anti', 'semi', 'multi']);

/**
 * Is the hyphen at the end of `text` part of a real compound ("evidence-" + "based"), not a word cut at the
 * line end ("exam-" + "ination")? A soft hyphen is always a cut. A compound has a word on each side, and
 * its closed form is not a word — or its left part is one that English joins with a hyphen.
 */
function keepsHyphen(text, next) {
  const m = /([A-Za-z]+)[-\u2010\u2011]$/.exec(text);
  const right = /^[a-z]+/.exec(next);
  if (!m || !right) return false;
  const left = m[1], r = right[0];
  const prefix = left.toLowerCase();
  if (VOWEL_PREFIXES.has(prefix) && r[0] === prefix[prefix.length - 1] && r.length >= 3 && isWord(r)) return true;
  if (left.length < 2 || r.length < 3 || !isWord(left) || !isWord(r)) return false;
  return !isWord(left + r) || (HYPHEN_PREFIXES.has(left.toLowerCase()) && r.length >= 5);
}

export class DocumentBuilder {
  constructor(options = {}) {
    this.options = {
      stripCitations: true,
      stripCaptions: true,
      stopAtReferences: true,
      skipTables: true,    // Read Aloud 2
      skipParens: false,   // Read Aloud 2: text in parentheses and brackets, like Speechify's "Skip brackets"
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
    const traced = this.buffer.finish(this.options.stripCitations, this.options.skipParens);
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
      // Read Aloud 2: a folio in small Roman numerals counts too ("xiv Preface"); its line is set smaller than the
      // body, now that a line's size is the size of most of its letters.
      const RUNNING = new RegExp(`^(?:\\d{1,4}|${ROMAN})\\s+\\D.{0,70}$|^.{1,70}\\D\\s+(?:\\d{1,4}|${ROMAN})$|^\\d{1,4}$`);
      // A body line can start or end with a number too ("15 patients were", "the mean age was 45"). A header
      // or footer is a page number alone, or set smaller than the body, or set apart from the text block.
      const rowYs = [...new Set(ys.map(y => Math.round(y)))].sort((a, b) => b - a);
      const rowGaps = rowYs.slice(1).map((y, k) => rowYs[k] - y).sort((a, b) => a - b);
      const leading = rowGaps.length ? rowGaps[Math.floor(rowGaps.length / 2)] : 0;
      const apart = l => {
        if (!leading) return true;
        const k = rowYs.indexOf(Math.round(l.y));
        const gap = l.y >= top - 6 ? rowYs[k] - (rowYs[k + 1] ?? -Infinity) : (rowYs[k - 1] ?? Infinity) - rowYs[k];
        return gap > leading * 1.5;
      };
      // A running head at body size that sits close to the text still names the book's chapter or a heading.
      const nameKey = t => t.replace(/^\d{1,4}\s*[.|:]?\s*|\s*\|?\s*\d{1,4}$/g, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const head = chapterFromHead(pageData.furniture);
      const names = new Set([...this.sections.slice(1).map(s => s.title), this.chapter?.title, head?.title]
        .filter(Boolean).map(nameKey).filter(k => k.length >= 4));
      const runningHead = l => !this.bodySize || /^\d{1,4}$/.test(l.text.trim()) ||
        l.size < this.bodySize * 0.95 || apart(l) || names.has(nameKey(l.text));
      lines = lines.filter(l => !((l.y >= top - 6 || l.y <= bottom + 6) && l.text.length < 80 &&
        RUNNING.test(l.text.trim()) && runningHead(l)));
    }
    // Read Aloud 2: a quote box between the columns, on request ("Skip boxed quotes")
    if (this.options.skipInsets) lines = lines.filter(l => !l.inset);
    // Read Aloud 2: a superscript reference number set as a line of its own ("22–28" at 5.5pt beside 9.7pt text)
    if (this.options.stripCitations && this.bodySize > 0) {
      lines = lines.filter(l => !(l.size <= this.bodySize * 0.7 && /^[\d\s,;–-]+$/.test(l.text.trim())));
    }
    // Read Aloud 2: footnotes and figure sources (small print under all the body text) are citations
    if (this.options.stripCitations && this.bodySize > 0) {
      const body = lines.filter(l => l.size >= this.bodySize * 0.95 && l.text.length > 20);
      if (body.length) {
        const lowest = Math.min(...body.map(l => l.y));
        const small = lines.filter(l => l.size <= this.bodySize * 0.85 && l.y < lowest);
        // Footnotes stand off from the text by a clear space. Small type that follows the text at the normal
        // line spacing (a bold list at the foot of a column) is part of the text.
        const ys = [...new Set(lines.map(l => Math.round(l.y)))].sort((a, b) => b - a);
        const gaps = ys.slice(1).map((y, i) => ys[i] - y).filter(d => d > 2).sort((a, b) => a - b);
        const leading = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
        const real = small.filter(l => l.text.trim().length >= 3);  // not a lone footnote number
        const top = real.length ? Math.max(...real.map(l => l.y)) : -1;
        if (small.length && (leading === 0 || lowest - top >= leading * 1.8)) lines = lines.filter(l => !small.includes(l));
      }
    }

    // The contents page is a map of the book, not part of it. Read Aloud 2: so is its last, shorter page,
    // which follows a contents page and still lists titles with page numbers ("Develop a Product Plan 253").
    // Read Aloud 2: a copyright page set at body size (two or more sure signs in body type) is not part of the
    // book. A footnote block in small type on the first page of a paper is not counted: that page has the abstract.
    if (this.bodySize > 0 &&
        lines.filter(l => l.size >= this.bodySize * 0.95 && copyrightSign(l.text)).length >= 2) {
      this.flush(); return;
    }
    // Read Aloud 2: rows of a number table end in a number too, and a page that is mostly a table was dropped
    // whole, with its body text. Judge the page on its lines outside tables. A contents page whose own rows
    // look like a table (number, title, page) has few lines outside tables: then only the rows with three or
    // more numbers, which no contents line has, are left out.
    const outside = lines.filter(l => !l.table);
    const judged = outside.filter(l => l.text.length > 3).length >= 8 ? outside
      : lines.filter(l => !(l.table && (l.text.match(/\d+(?:[.,]\d+)*/g) || []).length >= 3));
    // Read Aloud 2: a page number at a line end is a number or a Roman numeral in small letters (not any word
    // that ends in "i", "v" or "x"). A page after a contents page goes on with it only when its lines are short
    // like contents lines: body text can end a line in a year.
    const numbered = judged.filter(l => new RegExp(`\\s(?:\\d{1,4}|${ROMAN})$`).test(l.text)).length;
    const lengths = judged.map(l => l.text.length).sort((a, b) => a - b);
    const shortLines = lengths.length > 0 && lengths[Math.floor(lengths.length / 2)] <= 45;
    // Read Aloud 2: the first page of the index, under its big heading "Index", is a map of the book too; its two
    // columns of short lines did not always reach the half of lines that end in a page number. It must look like
    // an index: most of its other lines end in a page number or a range of pages. A section named "Index" in the
    // middle of a book is read.
    const pointer = /[\s,]\d{1,4}(?:[–-]\d{1,4})?\.?$/;
    const indexRows = lines.filter(l => l.text.length > 3 && !/^index$/i.test(l.text.trim()));
    const indexHead = this.bodySize > 0 && lines.some(l => /^index$/i.test(l.text.trim()) && l.size >= this.bodySize * 1.6) &&
      indexRows.length >= 8 && indexRows.filter(l => pointer.test(l.text)).length >= indexRows.length * 0.4;
    if (indexHead) { this.flush(); return; }
    if (isContentsPage(judged) || (this.inContents && shortLines && numbered >= Math.max(2, judged.length * 0.25))) {
      this.inContents = true; this.flush(); return;
    }
    this.inContents = false;
    // Read Aloud 2: tables, on request (on by default): rows of short cells read as loose words
    if (this.options.skipTables) lines = lines.filter(l => !l.table);

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
      // Read Aloud 2: a quote box is its own paragraph: never glued to the column text before or after it
      if (!!line.inset !== !!this.lastInset) { this.flush(); this.lastInset = !!line.inset; }

      if (this.repeated.has(key)) continue;
      if (isPageNumber(text)) continue;
      if (isPhotoTag(text)) continue;
      if (SLUG.test(text)) continue;

      // A change of type size ends the paragraph. Page 63 of the test book
      // sets the body at 7pt, its captions at 6pt, the figure number at
      // 5.6pt and the photo tag at 9.8pt — all interleaved with the body in
      // reading order, because a caption sitting at the head of the right
      // column lands exactly where a sentence crosses over from the left.
      // Without this the caption is spoken inside the sentence: "Adopting
      // the 'wait This ACE Class II patient left untreated his fractured
      // incisal and see' strategy". Nothing about the words says they do not
      // belong together; the typography says it plainly.
      // Read Aloud 2: the main size of the last line is compared with the size where this line starts. A line
      // can hold two sizes ("16mm. (Note that ...)": the end of a sentence in body type, then a note in small
      // type); its main size broke the sentence before "16mm.". The last line's own last item is not used: a
      // subscript or a word in small capitals at a line end ("T23,1", "JSFUNFUZZ") broke the sentence after it.
      const start = line.first ?? line.size;
      if (this.lastSize && Math.abs(this.lastSize - start) >
          Math.max(this.lastSize, start) * 0.08) {
        this.flush();
      }
      this.lastSize = line.size;

      if (this.options.stripCaptions && isImageLabel(text)) {
        this.flush();
        continue;
      }

      const furnitureKind = boilerplate(line, this.bodySize);
      if (furnitureKind === 'line') { this.flush(); continue; }
      if (furnitureKind === 'block') {
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
        // Read Aloud 2: a caption ends at the end of its first sentence, at a change of size, or at a gap wider
        // than a line. A label alone on its line ("Fig. 70") is the whole caption: the text below it can be body
        // text set small, and when in doubt the text is read. (Before, a caption in small type took all the small
        // type after it, whole paragraphs too.)
        const rest = text.replace(CAPTION_START, '');
        if (/^[\s.:)–-]*(?:[\d.]+[a-z]?)?[\s.:)–-]*$/.test(rest)) continue;
        const cap = line.size;
        while (i + 1 < lines.length && !/[.!?]["')\]]?$/.test(lines[i].text) && Math.abs(lines[i + 1].size - cap) < 0.6 &&
               Math.abs(lines[i].y - lines[i + 1].y) <= cap * 1.8) i++;
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
      // Read Aloud 2: also a soft hyphen or the hyphen sign U+2010 / U+2011.
      if (/[a-z][-\u00AD\u2010\u2011]$/.test(text) && i + 1 < lines.length) {
        const next = lines[i + 1].text;
        const nextKey = next.replace(/\d+/g, '#').toLowerCase().trim();
        const nextSkipped = this.repeated.has(nextKey) || isPageNumber(next) ||
          isPhotoTag(next) || boilerplate(lines[i + 1], this.bodySize) ||
          (this.options.stripCaptions && CAPTION_START.test(next));

        if (/^[a-z]/.test(next) && !nextSkipped) {
          this.buffer.push(line.tokens);
          if (keepsHyphen(text, next)) this.buffer.trimSpaces();
          else this.buffer.trimHyphen();
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
    // Read Aloud 2: a part of a hyphenated word or of a code name ("e-mails", "mul3") is not a ligature split.
    const before = text[m.index - 1] || ' ', after = text[m.index + m[0].length] || ' ';
    const fixed = /[\w-]/.test(before) || /[\w-]/.test(after) ? null : repairSplit(m[1], m[2]);
    // Read Aloud 2: not joined, so test the second word with the word after it ("the A er": "A" + "er").
    if (!fixed) { re.lastIndex = m.index + m[1].length + 1; continue; }
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
  resetRepairs();  // Read Aloud 2: the ligature record of the last document does not decide this one
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
  // Read Aloud 2: a damaged page (its text or its font cannot be read) is passed over, not the end of the book.
  const tryRead = async n => {
    try { return await readPage(doc, n); } catch (e) {
      // A closed document or a cancelled read-in is not a damaged page: it ends the read-in.
      if (/^Abort/.test(e?.name) || /destroyed|terminated|cancel/i.test(e?.message)) throw e;
      console.warn('page', n, 'cannot be read:', e);
      return null;
    }
  };
  for (const n of [...new Set(want)]) cached.set(n, await tryRead(n));

  const sample = [...cached.values()].filter(Boolean);
  builder.setRepeatedLines(learnRepeatedLines(sample));
  builder.setTypography(learnTypography(sample));

  for (let n = 1; n <= total; n++) {
    const pd = cached.has(n) ? cached.get(n) : await tryRead(n);
    if (pd) builder.addPage(pd);
    if (onPage && (await onPage(n, total, builder)) === false) return null;
    if (builder.stopped) break;
  }

  builder.finalize();
  return builder;
}
