// Read Aloud 2: pages that are only pictures (scanned books) get their text from Apple's Vision on this Mac
// (voice-server.py /ocr). Each recognized word becomes a PDF text item with its place on the page, so the
// reader orders columns, highlights words and follows along exactly as it does for a normal PDF.
const SERVER = 'http://127.0.0.1:8793';
const STYLE = { ocr: { fontFamily: 'sans-serif', ascent: 0.8, descent: -0.2, vertical: false } };
const LIMIT = 60000;  // a scanned page that has no text after 60 seconds gives a message (the voice server does not answer)

// One scanned page at a time, for all open books: each recognition waits until the one before it ends.
let queue = Promise.resolve();
const inTurn = (job) => { const run = queue.then(job); queue = run.catch(() => {}); return run; };
// pdf.js marks a closed book (app.js closes the old book when another file is opened).
const closed = (doc) => doc.loadingTask?.destroyed === true;
const fail = (signal) => new Promise((_, no) => signal.addEventListener('abort', () => no(signal.reason), { once: true }));

export async function withOcr(doc, note = () => {}) {
  const done = new Map();
  const failed = new Set();   // pages whose recognition failed: read-ahead does not ask them again
  const scanned = new Set();  // pages that are only a picture
  const getPage = doc.getPage.bind(doc);
  // Only a wanted scanned page reads ahead, 2 pages, so no chain reaction goes through the book.
  const readAhead = (n) => {
    for (const k of [n + 1, n + 2]) {
      if (k <= doc.numPages && !done.has(k) && !failed.has(k) && !closed(doc)) textOf(k, true).catch(() => {});
    }
  };
  const readPage = async (n, ahead) => {
    const page = await doc.getPage(n);  // through the wrapper below, which keeps the page's own text reader
    const c = await page.__text();
    if (c.items.some((i) => i.str && i.str.trim())) return c;
    scanned.add(n);
    if (!ahead) readAhead(n);
    note(`Reading the picture of page ${n}…`);
    // The owner gets a message within 60 seconds of the ask, also when the page waits behind other pages.
    const job = { started: false, cancelled: false };
    const waited = new AbortController();
    const timer = setTimeout(() => waited.abort(new Error(job.started ? 'no text after 60 seconds'
      : 'it waited 60 seconds behind other pages')), LIMIT);
    try {
      const text = await Promise.race([fail(waited.signal), inTurn(() => {
        if (job.cancelled || closed(doc)) throw new Error('skipped');  // a page that gave up, or a closed book
        job.started = true;
        return recognize(page);
      })]);
      failed.delete(n);
      return text;
    } catch (e) {
      job.cancelled = true;
      done.delete(n);  // a page that failed is tried again when the reader wants it again
      failed.add(n);
      if (!closed(doc)) note(`Page ${n}: no text found (${e.message}).`);
      return c;
    } finally { clearTimeout(timer); }
  };
  // ahead: a read-ahead page.
  const textOf = (n, ahead = false) => {
    if (!done.has(n)) done.set(n, readPage(n, ahead).catch((e) => { done.delete(n); throw e; }));
    else if (!ahead && scanned.has(n)) readAhead(n);
    return done.get(n);
  };
  doc.getPage = async (n) => {
    const page = await getPage(n);
    if (!page.__text) {
      page.__text = page.getTextContent.bind(page);
      page.getTextContent = () => textOf(n);
    }
    return page;
  };
  // A scanned book: most of its first pages have no text of their own. One picture page (a cover) is not enough.
  let empty = 0; const look = Math.min(3, doc.numPages);
  for (let n = 1; n <= look; n++) {
    const page = await doc.getPage(n);
    if (!(await page.__text()).items.some((i) => i.str && i.str.trim())) empty++;
  }
  doc.__scanned = empty * 2 > look;
  return doc;
}

// The whole recognition of one page (the picture, the PNG and the voice server) has 60 seconds; then the queue goes on.
async function recognize(page) {
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(new Error('text recognition took more than 60 seconds')), LIMIT);
  try { return await Promise.race([fail(stop.signal), recognizeNow(page, stop.signal)]); } finally { clearTimeout(timer); }
}

async function recognizeNow(page, signal) {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 2400 / Math.max(base.width, base.height));  // about 2400 px on the long side
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  let png;
  try {
    canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const drawing = page.render({ canvasContext: ctx, viewport: vp });
    signal.addEventListener('abort', () => drawing.cancel?.(), { once: true });
    await drawing.promise;
    png = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
  } finally { canvas.width = canvas.height = 0; }  // release the page picture (about 16 MB)
  const r = await fetch(SERVER + '/ocr', { method: 'POST', body: png, signal });
  if (!r.ok) throw new Error('text recognition ' + r.status);
  const { lines } = await r.json();
  const W = base.width, H = base.height, items = [];
  // One size per line, and the page's usual size for ordinary lines: the reader starts a new paragraph when the
  // text size changes, and a word with a tail (p, g, y) must not look like a different size.
  const heights = lines.map((l) => l.box[3] * H).sort((a, b) => a - b);
  const usual = heights[Math.floor(heights.length / 2)] || 10;
  for (const line of lines) {
    const lh = line.box[3] * H;
    const size = Math.max(4, (Math.abs(lh - usual) < usual * 0.35 ? usual : lh) * 0.85);
    const baseline = line.box[1];
    line.words.forEach((w, k) => {
      const [x, , bw] = w.box;
      const vx = x * W, vy = (1 - baseline) * H;
      const [px, py] = base.convertToPdfPoint(vx, vy);  // the line's bottom edge, in PDF units
      // The page rotation (/Rotate): the picture is the turned page, so its lines run along the turned page. On the
      // unturned sheet the word gets that direction (along) and its up, as pdf.js gives the text of a turned page.
      const [ax, ay] = base.convertToPdfPoint(vx + 1, vy), [ux, uy] = base.convertToPdfPoint(vx, vy - 1);
      const along = [ax - px, ay - py], up = [ux - px, uy - py];
      const last = k === line.words.length - 1;
      items.push({ str: w.text + (last ? '' : ' '), dir: 'ltr', transform: [size * along[0], size * along[1], size * up[0], size * up[1], px, py],
        width: bw * W, height: size, fontName: 'ocr', hasEOL: last });
    });
  }
  return { items, styles: STYLE };
}
