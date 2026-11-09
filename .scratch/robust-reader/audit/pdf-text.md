# Audit: pdf-text

Read-only audit of 9 Nov 2026. Each finding is a claim. Confirm it in the code before you fix it.

I read all of extract.js, lexicon.js and ocr.js, and checked callers in app.js and the unit rules in speech.js. I did not edit any file. There are 20 findings, ranked by value (impact against effort).

1. **ocr.js:15 — memory/speed — certain.** The read-ahead cascades through the whole book.
   - Every empty page starts reading pages n+1 and n+2 before its own text recognition finishes. That is a chain reaction, so within about a second every page of a scanned book is running `recognize()` at once.
   - Each run allocates a canvas of about 2400 px (about 16 MB) and sends one POST to the voice server. A 300-page scan can crash the tab.
   - Read-ahead pages also start their own read-ahead. Their rejections are not handled, and a rejected promise stays cached in `done`.
   - Fix:
     - `const textOf = (n, ahead=false) => …; if (!ahead) for (k…) setTimeout(() => textOf(k, true).catch(()=>{}), 0);`
     - Run recognition one page at a time: `let gate = Promise.resolve(); const one = f => (gate = gate.then(f, f));` then `one(() => recognize(page))`.

2. **lexicon.js:220 and 227 — precision — certain.** `KEEPABLE` turns every character outside Latin, digits and a few symbols into a space, and `repairLigatures` (extract.js:1092) applies it to every character.
   - These are lost: Cyrillic, Hebrew, Arabic and all CJK (so a non-Latin or right-to-left PDF reads as silence), Greek letters not in `GREEK` (η κ ν ξ ζ Γ Π Φ…), currency (£ € ¥), and `~ ^ _ |`.
   - Fix: strip only what is really unmapped. Use `const UNMAPPED = /[\p{Co}\p{Cn}\p{Cc}�]/u;` and `out += UNMAPPED.test(ch) && ch !== '\n' ? ' ' : ch;`.
   - Make `ALIEN` (line 22) the same test. Today "café" and "résumé" count as damaged words and go through the ligature search.

3. **extract.js:15 and 1336 — precision (lost text) — certain.**
   - `BOILERPLATE` contains `\d{3}-\d`, `doi\b` and `isbn\b`. So a body line that starts "150-200 patients were…" or "DOI …" counts as a copyright block.
   - The skip loop then drops every following line on the page with size ≤ that line + 0.5. That is the rest of the body.
   - Fix: run the block skip only for small type: `if (BOILERPLATE.test(text) && (!this.bodySize || line.size < this.bodySize*0.95))`. Also make the ISBN pattern stricter: `\d{3}-\d{1,5}-\d`.

4. **extract.js:1250 — precision (lost text) — certain.** The `RUNNING` filter removes any top or bottom line under 80 characters that starts or ends with a number. Real body lines match, for example a page that ends "…the mean age was 45" or starts "15 patients were treated". Two-column pages lose the last line of both columns.
   - Fix: also require small or separated type: `&& (!this.bodySize || l.size < this.bodySize*0.95 || /^\d{1,4}$/.test(l.text.trim()))`.

5. **extract.js:1486-1493 — precision (bug) — certain.** In `repairSplitWords`, when a pair (w1, w2) is not repaired, `lastIndex` stays at the end of w2. The pair (w2, w3) is never tested. So "the A er" never repairs "A er", and about half of the ligature splits are missed, depending on word parity.
   - Fix: `if (!fixed) { re.lastIndex = m.index + m[1].length + 1; continue; }`.

6. **extract.js:837 — precision — certain.**
   - `'°': ' degrees'` has no trailing space, so "37°C" becomes "37 degreesC".
   - `'μ'` (U+03BC) maps to "mu" before speech.js runs. speech.js knows only `µm` (U+00B5), so "5 μm" is read "five mum".
   - Fix: `'°': ' degrees '` and `'μ': 'µ'` (the micro sign, which `KEEPABLE` and the speech UNITS already handle).

7. **extract.js:1540 and 1547 — robustness — certain.** No `try/catch` around `readPage`. One damaged page (`getTextContent` rejects, or a bad font) aborts the whole document.
   - Fix: `let pd; try { pd = cached.get(n) || await readPage(doc, n); } catch (e) { console.warn('page', n, e); continue; }`. Do the same in the sample loop.

8. **extract.js:259 — precision — likely.** `makeLine` takes `size` from the first item only.
   - A drop cap ("T" at 30pt + "he patient…") makes the whole line big type. If it is under 80 characters with no final punctuation, it becomes a section heading.
   - A superscript marker at the line start makes a body line small. `dropPageFurniture` can then remove it, the footnote filter can remove it, and it forces a paragraph break at 1322.
   - Fix: use the size that sets the most characters: `size: entries.reduce((b,e)=> e.item.str.length > b.n ? {n:e.item.str.length, s:Math.abs(e.item.transform[0])||10} : b, {n:-1,s:10}).s`.

9. **extract.js:1435-1445 — precision — likely.** Line-end hyphens are not joined in four cases:
   - (a) If the last token is "exam- " with a trailing space, `trimEnd(1)` removes the space and leaves the hyphen.
   - (b) A soft hyphen (U+00AD) or U+2010 at the line end does not match `/[a-z]-$/`. A space is added, so the result is "exam ination".
   - (c) A real compound loses its hyphen: "evidence-" / "based" becomes "evidencebased".
   - Fix:
     - Use the regex `/[a-z][-­‐]$/`.
     - Add a `trimHyphen()` that pops trailing spaces and then one `-`/`‐`.
     - Keep the hyphen when `isWord(left) && isWord(right) && !isWord(left+right)`.

10. **ocr.js:44-51 — robustness/memory — certain.**
    - `fetch` has no timeout. If the voice server hangs, `getTextContent` never resolves and `buildDocument` stalls forever.
    - The 16 MB canvas is held until garbage collection.
    - Fix: `fetch(..., { signal: AbortSignal.timeout(60000) })`, and set `canvas.width = canvas.height = 0` after `toBlob`.

11. **lexicon.js:47, 71 and 35 — bug/memory — certain.**
    - `votes` and `cache` are module-level. `openFile` (app.js:501) can open a second PDF in the same page, and document A's ligature votes then decide B's repairs. The comment at lines 67-69 says the record is per-document. `cache` also grows without limit across documents.
    - `loadLexicon` keeps a rejected `loading` promise after one failure, so it never retries.
    - Fix: export `resetRepairs(){ votes.clear(); cache.clear(); }` and call it at the start of `buildDocument`. Wrap the loader body in `try { … } finally { loading = null; }`.

12. **lexicon.js:150-173 and 201 — speed — likely.** Every word not in the lexicon (proper nouns, dental terms, hyphenated compounds) runs `search(1)` plus `search(2)`. For a 10-letter word that is about 17,000 string slices and Set lookups, with an array allocated per step. Ambiguous results are never cached, so each occurrence repeats the search on the main thread.
    - Fix: skip case B for words with a capital after the first letter, a digit or a hyphen. Cache ambiguous results with the total vote count, and recompute only when that count has grown.

13. **extract.js:119-121 — speed — likely.** The "one-sided row" loop calls `gutterIn` and then `findGutter` (about 1,800 operations per row each) for every one-sided row in the top 60% until one succeeds. On one-column pages with many short lines (lists, index pages, poetry) none succeeds, so the cost is about rows² × 3,600 per page.
    - Fix: stop after 3 attempts: `for (let k=1, tries=0; … && tries < 3; k++) if (oneSide(…)) { tries++; … }`.

14. **extract.js:49-61 — bug (rotated pages) — likely.** Item coordinates are in unrotated PDF space, but `pageWidth` comes from the rotated viewport. On a `/Rotate 90` page, the text lines run along y, so grouping rows by `transform[5]` gives scrambled order. `transform[0]` is also 0 there, so the size falls back to 10. OCR items come out in the same unrotated space, so they have the same problem.
    - Fix: `const [vx, vy] = viewport.convertToViewportPoint(t[4], t[5]); x = vx; y = viewport.height - vy;`, and size `= Math.hypot(t[0], t[1])`.

15. **extract.js:59 — precision — likely.** `Math.round(y/2)*2` cuts rows at fixed boundaries. Two items on one visual line at y=4.99 and y=5.01 land in rows 4 and 6. This happens with a font change or slight baseline jitter. The line is then split, and its parts are ordered out of place.
    - Fix: sort the raw y values and start a new row only when the gap to the previous y is more than 1.5pt (the size of the change is similar).

16. **extract.js:1278-1284 — precision — possible.**
    - `isContentsPage` runs before the `skipTables` filter. A page that is mostly a numeric table ("Group A 12", …) counts as a contents page and is dropped whole, with its body text.
    - `inContents` then carries over: any next page with 25% or more lines ending in a number is dropped too.
    - Fix: run the contents test on `lines.filter(l => !l.table)`.

17. **extract.js:481 — bug — certain (rare trigger).** `if (!bodySize) return lines;` returns an array, but the caller reads `split.lines` and `split.furniture`. The page then gets `lines = undefined` and `addPage` throws. The trigger is a page where every size rounds to 0 (font size under 0.25).
    - Fix: `return { lines, furniture: [] };`.

18. **extract.js:955-960 — precision — likely.** `push` walks `token.str[i]` by UTF-16 code unit. Mathematical italic letters (𝑥 𝑦 𝛼, common in science PDFs) arrive as lone surrogates. `NFKC` never sees the whole character, and `stripUnmapped` turns both halves into spaces. Variables disappear from the spoken text.
    - Fix: walk by code point and keep the offset in code units: `for (let i=0; i<s.length;) { const cp = String.fromCodePoint(s.codePointAt(i)); for (const ch of speakable(cp).split('')) {…offset: base+i…} i += cp.length; }`. Using `split('')` keeps every `chars` entry one code unit long, which `finish()` needs for alignment.

19. **extract.js:36 — regex backtracking — possible.** In the figure-reference NOISE regex, `[\w.-]+(?:\s*(?:,|and|&|–|-|to)\s*[\w.-]+)*\)`, the hyphen is both a token character and a separator. All en dashes have already become "-". "(Fig. 1-2-3-…-25" with no closing parenthesis therefore backtracks exponentially over the whole paragraph.
    - Fix: drop `-` from the token class: `[\w.]+`.

20. **extract.js:1120 and 1152 — precision — certain, low impact.**
    - `/\d\.$/` stops a sentence break after any number ("…in 2019. The next…"). Decimals never need it, because "0.5" has no space after the dot (line 1116 already handles that).
    - The clause mark `' — '` can never be found, because `LIGATURES` already maps "—" to "-".
    - Fix: `/(^|\s)\d{1,2}\.$/` (protects only list numbers), and use `' - '` as the mark.

**How extract.js is laid out:**
- Lines 49-451, `readPage`: groups items into rows by y. It then finds the column gap: candidate gaps at 98-122, judged at 127-205 (`splitRows`, `whole`, `figureNot`, `judge`, plus the `doc.__gutters` memory). `makeLine` (208) builds a line and handles fake bold. The recursive `order()` (268-399) does columns, bands, boxed quotes and nested gaps. Table spans are at 401-445, then `dropPageFurniture` (469).
- Lines 543-792 are helpers: `hasGutterGap`, `findGutter` (a 600-bin histogram), `learnTypography`, `chapterFromHead`, `isContentsPage`, `learnRepeatedLines`. Lines 794-1190 are the speech text: the character maps, `recomposeAccents`, `TracedText` (one owner per character, NOISE stripping in `finish`), `repairLigatures` and `traceToSentences`.
- Lines 1196-1554: `DocumentBuilder.addPage` runs the per-page filters (headers, footnotes, contents, tables), then the per-line loop (size breaks, boilerplate, references, captions, headings, hyphenation). `buildDocument` samples 14 pages to learn the typography, then streams all pages.
