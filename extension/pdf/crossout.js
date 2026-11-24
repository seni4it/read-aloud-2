// Read Aloud 2: crossed-out text. The owner crosses out a part of the page with the cross-out pen (notes.js), and the
// reader leaves that part out when "Skip crossed-out text" is on (owner's choice of 24 Nov 2026, prototype variant C).

/**
 * The text that the voice says for one sentence.
 * text: the sentence. cuts: its crossed-out parts, [{ a, b }] character ranges. from: the first character to say
 * (a click on a word starts there). Gives { text, map }: map[i] is the place in the sentence of letter i of the text,
 * so the word highlight still finds each word. A sentence with no letter or number left gives text ''.
 */
export function spokenText(text, cuts = [], from = 0) {
  const drop = new Uint8Array(text.length);
  drop.fill(1, 0, Math.min(Math.max(0, from), text.length));
  for (const { a, b } of cuts) drop.fill(1, Math.max(0, a), Math.min(text.length, b));
  let out = '';
  const map = [];
  for (let i = 0; i < text.length; i++) {
    if (drop[i]) continue;
    const ch = text[i];
    if (/\s/.test(ch) && (out === '' || /\s$/.test(out))) continue;  // no space at the start, no two spaces
    if (/[.,;:!?)]/.test(ch) && / $/.test(out) && drop[i - 1]) { out = out.slice(0, -1); map.pop(); }  // "deeper ." -> "deeper."
    out += ch; map.push(i);
  }
  while (/\s$/.test(out)) { out = out.slice(0, -1); map.pop(); }
  if (!/[\p{L}\p{N}]/u.test(out)) return { text: '', map: [] };
  return { text: out, map };
}
