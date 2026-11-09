# 10. PDF text: characters, units and hyphens said correctly

GitHub issue: #11
Status: ready-for-agent
Type: AFK

## Parent

`.scratch/robust-reader/spec.md`

## What to build

Keep every character that has a meaning; remove only private-use, unassigned and control characters. Say degrees and the micro sign correctly. Join a word that is cut at a line end, also with a soft hyphen, and keep the hyphen of a real compound. Keep mathematical letters. Break a sentence after a year. Keep ligature votes for one document only, and try the word list again after a failed load.

Evidence: audit/pdf-text.md findings 2, 6, 9, 11, 18, 20. Each audit finding is a claim: confirm it in the code first.

## Acceptance criteria

- [x] Cyrillic, Hebrew, Greek letters and £ € ¥ stay in the sentences.
- [x] '37°C' gives 'degrees C' and '5 μm' gives 'micrometres'.
- [x] 'exam-' + 'ination' gives 'examination'; 'evidence-' + 'based' gives 'evidence-based'.
- [x] '…in 2019. The next…' is two sentences; '1. First item' is not cut after '1.'.
- [x] A second document does not use the ligature votes of the first.
- [x] The comparison check shows no sample that reads worse.

## Blocked by

- 09 (pdf-text-no-lost-lines)

## Notes from the test bench (ticket 02)

- The sample `tests/pdf-text/samples/hyphen.pdf` has a real compound that is cut at a line end ("well-" + "known"). The kept reference `tests/pdf-text/reference/hyphen.txt` shows today's wrong output "wellknown". Repair it here and accept the new reference with `node tests/pdf-text/compare.mjs --update`.

## Work report

Date: 9 Nov 2026. Tests: `tests/node/pdf-said-right.test.mjs` (13 tests, made lines only). Each test failed before the change, except the guards for "in 2019." and "1. First item" (see finding 20).

### Findings

- **2 (lexicon.js, unmapped characters): confirmed, repaired.** `KEEPABLE` turned every character outside Latin and a few symbols into a space. `stripUnmapped()` now removes only private-use, unassigned and control characters and U+FFFD (whitespace stays). `ALIEN` now tests the base letter (`isAlien()`, NFD), so a word with accents is not damage; `repairWord()` also looks the word up without its accents. Cyrillic and Hebrew words have more than 2 "alien" letters, so the ligature search stops at once for them.
- **6 (extract.js, degrees and micro): confirmed, repaired.** `'°'` gave "37 degreesC"; now `' degrees '`. `speakable()` gives the micro sign (U+00B5) for a Greek mu (U+03BC) before a Latin letter, so the speech rewrite says "micrometres". A mu alone is still "mu".
- **9 (extract.js, line-end hyphens): confirmed, repaired** (all three cases). `DocumentBuilder.addPage` now also joins a soft hyphen and U+2010/U+2011; `TracedText.trimHyphen()` removes the trailing spaces and then the hyphen; the new `keepsHyphen()` keeps the hyphen of a real compound: a word on each side and no closed form in the word list, or a left part "self" / "well" with a right part of 5 or more letters (the word list has "wellknown"). U+2010/U+2011 now map to "-" in `LIGATURES`.
- **11 (lexicon.js, votes, cache, loader): confirmed, repaired.** New `resetRepairs()` clears `votes` and `cache`; `buildDocument()` calls it first. `loadLexicon()` sets `loading = null` in a `finally`, so a failed load is tried again.
- **18 (extract.js, mathematical letters): confirmed, repaired.** `TracedText.push()` walks by code point and keeps offsets in code units; each `chars` entry stays one code unit. `speakable()` sends a normalised Greek letter through `GREEK` (𝛼 gives "alpha").
- **20 (extract.js, sentence after a number; clause mark): confirmed, repaired** (low impact). A year is already said in words before the sentence split, so "in 2019." broke correctly before; a number of 3 or more digits ("was 120.") and a number after a dot did not. `traceToSentences()` now protects only `(^|\s)\d{1,2}\.$` (list numbers). The clause mark `' — '` is now `' - '`.

### Comparison check

- Public: `hyphen.pdf` changed for the better ("wellknown" became "well-known"); reference updated with the private folder pointed at an empty folder, so no private reference changed.
- Private books (3), changed sentences: 52 better, 5 same, 0 worse.
  - Better: compound words keep their hyphen (38), sentence breaks after a number or a decimal now fall at the sentence end (10, regrouped lines with the same words), an accented word is no longer "repaired" into a wrong word (3), one code word is no longer "repaired" with the ligature votes of another document (1).
  - Same: a hyphen kept before a paragraph break that was already there (2; before, the hyphen was dropped and the break was the same), and a technical compound that a book also writes closed (3, sounds the same).
  - Two regressions found by the check and repaired: "_" (fill-in lines, a file name in the margin) and "¹" (a wrong apostrophe glyph) were removed before and now reached the voice. Both are now in `UNSPOKEN`, as before.

### Files changed

`extension/pdf/extract.js`, `extension/pdf/lexicon.js`, `tests/node/pdf-said-right.test.mjs` (new), `tests/pdf-text/reference/hyphen.txt`, this file. `speech.js` did not need a change.

### Left for other tickets

- A paragraph break that falls right after a line-end hyphen leaves "word-" at the end of the paragraph (it was "word" before). The cause is the paragraph break (for example a change of type size), not the hyphen rule.
- "line 1. i=3." still holds "1." as a list number inside a sentence; a number of 1 or 2 digits at a sentence end ("was 45.") still does not end the sentence. A better rule needs the line start.
- Other symbols that the old filter removed and that now reach the voice (`~ ^ |`, arrows, check marks) did not show in the samples. Watch for them.
- Audit finding 12 (speed of the ligature search for words not in the list) is unchanged.

### Review round 2

Tests first: 8 new tests in `tests/node/pdf-said-right.test.mjs` (23 in all). Each new test failed before its change, except the guards named below.

1. **"re-" + "entry" joined to "reentry": repaired.** `keepsHyphen()` keeps the hyphen when the left part is a prefix in `VOWEL_PREFIXES` (re, pre, de, co, anti, semi, multi) and the right part is a word that starts with the prefix's own last vowel ("re-entry", "co-operation", "pre-existing"). The rule the review proposed (any prefix before any word) is not used: it gives "re-search", "re-port", "re-turn", "pre-sent", which are the usual cuts of whole words. A test shows that "re-" + "search", "re-" + "port" and "infor-" + "mation" are still joined; "well-known" and "evidence-based" stay.
2. **"p. 12." and "Fig. 2." held the sentence: repaired.** `traceToSentences()` holds "N." (1 or 2 digits) only as a list marker: at the start of a sentence, or when the next word starts with a digit or a small letter (an inline list: "…length 4. 25/.04 to length 5. 25/.06…"). The second case came from the comparison check: with only the first case, one book had a list marker at the end of the sentence before its item. Tests: "on p. 12.", "in Fig. 2.", "in the year 2150." (each fails with the old code), the inline list (fails without the second case).
3. **"μOR" said "micro": repaired.** New `isMicro()`: a Greek mu is the micro sign only before a unit (`MICRO_UNIT`: mol, m, g, l, L, s, M, A, V, W, Hz, Pa), and for the units that are not also usual words (s, M, A, V, W, Hz, Pa) only after a number. "μOR" and "the μ value" stay "mu"; "2 μg", "3μs", "5 μm" become the micro sign.
4. **Emoji reached the voice: repaired.** `speakable()` gives a space for `PICTOGRAPH` (Extended_Pictographic, Emoji_Modifier, Regional_Indicator, So) after NFKC, so a sign that stands for letters keeps its letters; ° © ® ™ are said or dropped by the `GREEK` map before. `stripUnmapped()` (headings) removes the same class and keeps ° © ® ™.
5. **Weak tests: repaired or named as guards.** "1. First item" now asserts on the sentence array (the first sentence starts "1. First item", no sentence is "1."). It passes with the old code because the old code held every "N."; it is a guard against a rule that removes the hold. Guards that pass with the old code, and why: "exam-" + "ination" (the old code joined a plain hyphen; the test keeps that case while the hyphen code changed), "in 2019." (a year is said in words before the sentences are cut, so the old number rule never saw it), "1. First item" (above). The tests that fail with the old code: "in the year 2150.", "on p. 12.", "in Fig. 2.", "was 120.".
6. **"mul3" in the code line: not a fault of this ticket; one risk repaired.** The PDF prints the text items `mul` and `3` (a subscript digit in a compiler instruction), so "mul3" follows the print. The old "multi" was a ligature repair of the digit 3 as "ti", decided by votes from the documents read before it in the same run (the fault of finding 11). A document with a strong record of lost "ti" could still read it as "multi", so `repairWord()` now leaves every word with a digit alone (test: "mul3" stays with 13 lost-"ti" words in the same document). This also gives "19th" in one book, where the old code read "sisith". "ten hundred" for 1000 is the year rule of `speech.js`; it was in the reference before and is not changed here.

`node --check` passes on both files.

Comparison check after round 2 (private books, changed sentences against the old references): 63 changed — 57 better, 6 same, 0 worse.
- Better (57): compounds with their hyphen, sentence breaks after a number at a sentence end (the same words regrouped), "naïve" no longer "native" (3), "19th" no longer "sisith" (1), "mul3" as printed (1).
- Same: "first-" and "six-" before a paragraph break that was there before (2), "byte-code" and "op-codes" where the book also writes the closed form (3), "pre-empt" where the reference had "preempt" (1, both are correct spellings and sound the same).
- Public samples: all "same".

Left for other tickets: "ten hundred" for the number 1000 (the year rule in `speech.js`); "line 1. i=3." still holds "1." because "i=3." starts with a small letter.
