// Read Aloud 2 library: the rules behind the shelf, with no page in them (ticket 23).
// - the clean title of a Book (no underscores, no source tag, no file ending),
// - the status text of a card ("12% done, 40 min left", "New", "Finished"),
// - the Book for "Continue listening" (the one read last, not finished),
// - the order of the Books.
// The page loads this file before library.js; the tests load it in node:vm. It sets globalThis.LibraryModel.
(function (root) {
  // A part of a file name that only says where the file came from: a web address or a known download site.
  const SOURCE = /z-?lib|z-?library|libgen|library genesis|anna.?s archive|\bb-ok\b|\b1lib\b|pdf ?drive|sci-?hub|dokumen\.pub|www\.|\.(com|org|net|pub|io|ru|to|lol)\b/i;
  const HASH = /^[0-9a-f]{16,}$/i;                       // a checksum in the name
  const ISBN = /^(isbn[: ]*)?(97[89][- ]?)?\d[\d- ]{8,}[\dx]$/i;

  function cleanTitle(name) {
    const raw = String(name || '').trim();
    let t = raw.replace(/\.pdf$/i, '').replace(/_+/g, ' ');
    // a source tag in brackets: "(z-lib.org)", "[www.example.com]"
    t = t.replace(/[[({][^\])}]*[\])}]/g, (m) => (SOURCE.test(m) ? ' ' : m));
    // parts joined by " -- " or " - ": keep the parts that are not a source, a checksum or an ISBN; the title is the first
    for (const sep of [/\s+--\s+/, /\s+[-–—]\s+/]) {
      const parts = t.split(sep).map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const kept = parts.filter((p) => !SOURCE.test(p) && !HASH.test(p) && !ISBN.test(p));
      if (sep.source.includes('--')) { t = kept[0] || parts[0]; break; }  // the long download form: title -- author -- ...
      if (kept.length < parts.length) t = kept.join(' - ');
    }
    t = t.replace(/\s{2,}/g, ' ').replace(/^[\s\-–—.,;:]+|[\s\-–—.,;:]+$/g, '').trim();
    return t || raw.replace(/\.pdf$/i, '') || 'Untitled';
  }

  // The reading position that the reader keeps: { i, total, t, minLeft }
  function percent(p) {
    return p && p.total > 0 ? Math.max(0, Math.min(100, Math.round(((p.i + 1) / p.total) * 100))) : 0;
  }
  function minutesText(min) {
    const m = Math.max(1, Math.round(min));
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  }
  function statusText(p) {
    const pct = percent(p);
    if (!pct) return 'New';
    if (pct >= 100) return 'Finished';
    const left = p && Number.isFinite(p.minLeft) ? `, ${minutesText(p.minLeft)} left` : '';
    return `${pct}% done${left}`;
  }

  // When the Book was read last, in ms: the voice server's "opened" time or the reader's own save time.
  function lastRead(b, p) {
    return Math.max((Number(b && b.opened) || 0) * 1000, (p && Number(p.t)) || 0);
  }

  // The Book for "Continue listening": read last, and not finished. null when no Book was started.
  function pickContinue(books, progressOf) {
    let best = null, bestAt = 0;
    for (const b of books || []) {
      const p = progressOf(b), at = lastRead(b, p);
      if (at > bestAt && percent(p) < 100) { best = b; bestAt = at; }
    }
    return best;
  }

  // The Books in one order: "opened" = read last first, "added" = added last first, "name" = title A to Z.
  // A tie goes to the Book added last.
  function sortBooks(books, by, progressOf) {
    const key = (b) => (by === 'opened' ? lastRead(b, progressOf(b)) : Number(b[by]) || 0);
    return [...books].sort((a, b) => (by === 'name'
      ? cleanTitle(a.name).localeCompare(cleanTitle(b.name), undefined, { sensitivity: 'base', numeric: true })
      : key(b) - key(a)) || (Number(b.added) || 0) - (Number(a.added) || 0));
  }

  function matches(b, q) {
    if (!q) return true;
    const s = q.trim().toLowerCase();
    return cleanTitle(b.name).toLowerCase().includes(s) || String(b.name || '').toLowerCase().includes(s);
  }

  root.LibraryModel = { cleanTitle, percent, statusText, minutesText, lastRead, pickContinue, sortBooks, matches };
})(globalThis);
