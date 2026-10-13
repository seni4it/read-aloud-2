// Read Aloud 2: pages that are only pictures (scanned books) get their text from Apple's Vision on this Mac
// (voice-server.py /ocr). Each recognized word becomes a PDF text item with its place on the page, so the
// reader orders columns, highlights words and follows along exactly as it does for a normal PDF.
const SERVER = 'http://127.0.0.1:8793';
const STYLE = { ocr: { fontFamily: 'sans-serif', ascent: 0.8, descent: -0.2, vertical: false } };

export async function withOcr(doc, note = () => {}) {
  const done = new Map();
  const getPage = doc.getPage.bind(doc);
  const textOf = async (n) => {
    if (!done.has(n)) {
      done.set(n, getPage(n).then(async (page) => {
        const c = await page.__text();
        if (c.items.some((i) => i.str && i.str.trim())) return c;
        doc.__scanned = true;
        for (const k of [n + 1, n + 2]) if (k <= doc.numPages) setTimeout(() => textOf(k), 0);  // read ahead
        note(`Reading the picture of page ${n}…`);
        return recognize(page).catch((e) => { note(`Page ${n}: no text found (${e.message}).`); return c; });
      }));
    }
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
  await (await doc.getPage(1)).getTextContent();  // page 1 tells the reader early whether this is a scanned book
  doc.__scanned = !!doc.__scanned;
  return doc;
}

async function recognize(page) {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, 2400 / Math.max(base.width, base.height));  // about 2400 px on the long side
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const png = await new Promise((ok) => canvas.toBlob(ok, 'image/png'));
  const r = await fetch(SERVER + '/ocr', { method: 'POST', body: png });
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
      const [px, py] = base.convertToPdfPoint(x * W, (1 - baseline) * H);  // the line's bottom edge, in PDF units
      const last = k === line.words.length - 1;
      items.push({ str: w.text + (last ? '' : ' '), dir: 'ltr', transform: [size, 0, 0, size, px, py],
        width: bw * W, height: size, fontName: 'ocr', hasEOL: last });
    });
  }
  return { items, styles: STYLE };
}
