// Read Aloud 2 (ticket 27): the Reading position of a library Book, with no page in it.
// The reader keeps its own copy in the browser; the voice server keeps one too (/library/<id>/position), so the
// library and a page of another origin know it. A record is { i, at, t, ... }: the sentence, its first words, and
// a time in ms. The own copy has the time of the browser; the voice server copy has the voice server's time of the
// save. Both are clocks of this Mac.

const FUTURE = 60000;  // ms: a time later than now + this is not trusted (a clock that was ahead); it counts as 0

const valid = (p) => Boolean(p) && typeof p === 'object' && Number.isInteger(p.i) && p.i >= 0;
const timeOf = (p, now) => { const t = Number(p.t); return Number.isFinite(t) && t > 0 && t <= now + FUTURE ? t : 0; };

/** The newer of the reader's own copy and the voice server's copy.
 *  - A copy with no time, or a time in the future, is the oldest: a bad clock cannot make a copy win for ever.
 *  - The same time: the own copy.
 *  - A voice server copy with no first words ("at") is used only when its sentence is inside the Book (i < count).
 *  - None valid: null. */
export function newerPosition(local, remote, { now = Date.now(), count = Infinity } = {}) {
  const remoteOk = valid(remote) && (remote.at || remote.i < count);
  if (!remoteOk) return valid(local) ? local : null;
  if (!valid(local)) return remote;
  return timeOf(remote, now) > timeOf(local, now) ? remote : local;
}
