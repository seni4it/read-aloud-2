// A virtualised PDF viewer. Only pages near the viewport hold a canvas and a
// text layer; everything else is a cheap sized placeholder, so a 600-page
// document opens as fast as a 6-page one.

const RENDER_MARGIN = '1200px 0px'; // how far ahead of the viewport to render

export class PdfViewer {
  constructor(pdfjsLib, container) {
    this.pdfjsLib = pdfjsLib;
    this.container = container;
    this.doc = null;
    this.pages = new Map(); // pageNumber -> { el, canvas, textLayer, spans, rendered }
    this.scale = 1;
    this.baseViewport = null;
    this.observer = null;
    this.renderQueue = new Set();
    this.highlighted = [];
    this.wordBoxes = [];
    // Manual zoom on top of the fit-to-width scale.
    this.zoom = Number(localStorage.getItem('pr.zoom')) || 1;
  }

  async load(doc) {
    // Read Aloud 2: nothing of the last book stays: its renders stop, its marks and its word box go.
    for (const entry of this.pages.values()) this.drop(entry);
    this.doc = doc;
    this.container.innerHTML = '';
    this.pages.clear();
    this.highlighted = [];
    this.wordBoxes = [];
    this.marks = [];
    this.lastWordBox = null;
    this.lastParts = null;

    const first = await doc.getPage(1);
    this.baseViewport = first.getViewport({ scale: 1 });
    this.computeScale();

    const h = Math.floor(this.baseViewport.height * this.scale);
    const w = Math.floor(this.baseViewport.width * this.scale);

    for (let n = 1; n <= doc.numPages; n++) {
      const el = document.createElement('div');
      el.className = 'page';
      el.dataset.page = String(n);
      el.style.width = w + 'px';
      el.style.height = h + 'px';

      const label = document.createElement('div');
      label.className = 'page-label';
      label.textContent = n;
      el.appendChild(label);

      this.container.appendChild(el);
      this.pages.set(n, { el, rendered: false, rendering: false, spans: new Map(), gen: 0 });
    }

    this.observe();

    if (!this.visibilityHook) {
      this.visibilityHook = () => { if (!document.hidden) this.refreshVisible(); };
      document.addEventListener('visibilitychange', this.visibilityHook);
    }
  }

  /** Re-render any on-screen page that never finished while we were hidden. */
  refreshVisible() {
    const scroller = this.container.parentElement;
    const view = scroller.getBoundingClientRect();
    for (const [n, entry] of this.pages) {
      if (entry.rendered) continue;
      const box = entry.el.getBoundingClientRect();
      if (box.bottom < view.top - 400 || box.top > view.bottom + 400) continue;
      this.drop(entry);
      this.renderPage(n);
    }
  }

  computeScale() {
    const avail = this.container.clientWidth - 32;
    const fit = avail / this.baseViewport.width;
    this.scale = Math.max(0.25, Math.min(4, fit * this.zoom));
  }

  /** Set the manual zoom factor and redraw, holding the reading position. */
  setZoom(zoom) {
    const next = Math.max(0.5, Math.min(3, Number(zoom.toFixed(2))));
    if (next === this.zoom) return this.zoom;

    const scroller = this.container.parentElement;
    const anchor = scroller.scrollTop / Math.max(1, scroller.scrollHeight);

    this.zoom = next;
    try { localStorage.setItem('pr.zoom', String(next)); } catch { /* private mode */ }
    this.rescale();

    // Keep roughly the same place in the document after the redraw.
    requestAnimationFrame(() => {
      scroller.scrollTop = anchor * scroller.scrollHeight;
    });
    return this.zoom;
  }

  /** Redraw every page at the current scale. */
  rescale() {
    if (!this.doc || !this.baseViewport) return;
    const before = this.scale;
    this.computeScale();
    const ratio = this.scale / before;
    const w = Math.floor(this.baseViewport.width * this.scale);
    const h = Math.floor(this.baseViewport.height * this.scale);

    // Read Aloud 2: `highlighted` and `lastParts` stay, so the sentence mark and the word box come back on each
    // new page (renderPage). The old boxes go with the old page contents.
    this.wordBoxes = [];
    for (const [n, entry] of this.pages) {
      const redraw = entry.rendered || entry.rendering;
      // The picture on screen now stays, stretched, until the new one is ready: no white page while it draws.
      const shown = entry.rendered ? entry.canvas : entry.old;
      if (shown === entry.canvas) entry.canvas = null; else entry.old = null;  // drop() must not clear it
      this.blank(n, entry, shown);
      entry.el.style.width = w + 'px';
      entry.el.style.height = h + 'px';
      if (shown) {
        shown.style.width = parseFloat(shown.style.width) * ratio + 'px';
        shown.style.height = parseFloat(shown.style.height) * ratio + 'px';
        entry.old = shown;
      }
      if (redraw) this.renderPage(n);
    }
  }

  /** Read Aloud 2: stop the render of a page and give back its picture. A late render sees the new `gen` and stops. */
  drop(entry) {
    entry.gen = (entry.gen || 0) + 1;
    try { entry.task?.cancel(); } catch { /* already finished */ }
    for (const c of [entry.canvas, entry.old]) if (c) c.width = c.height = 0;
    // pdf.js frees nothing while the page is busy; renderPage then calls cleanup again when it ends.
    try { entry.page?.cleanup(); } catch { /* pdf.js keeps it */ }
    entry.task = entry.page = entry.canvas = entry.old = entry.textLayer = null;
    entry.spans = new Map();
    entry.rendered = entry.rendering = false;
  }

  /** The page becomes an empty sized placeholder with its number, or shows only the picture `keep`. */
  blank(n, entry, keep = null) {
    this.drop(entry);
    entry.el.textContent = '';
    if (keep) { entry.el.appendChild(keep); return; }
    const label = document.createElement('div');
    label.className = 'page-label';
    label.textContent = n;
    entry.el.appendChild(label);
  }

  observe() {
    if (this.observer) this.observer.disconnect();
    this.observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const n = Number(entry.target.dataset.page);
          const page = this.pages.get(n);
          if (page) page.wanted = entry.isIntersecting;  // Read Aloud 2: a render that ends off screen is released
          if (entry.isIntersecting) this.renderPage(n);
          else this.releasePage(n);
        }
      },
      { root: this.container.parentElement, rootMargin: RENDER_MARGIN }
    );
    for (const { el } of this.pages.values()) this.observer.observe(el);
  }

  async renderPage(n) {
    const entry = this.pages.get(n);
    if (!entry || entry.rendered || entry.rendering) return;
    entry.rendering = true;
    // Read Aloud 2: a zoom, a release or a new book changes `gen`; this render then stops after its next await.
    const gen = entry.gen;
    const stale = () => gen !== entry.gen;
    let canvas = null, page = null;

    try {
      page = await this.doc.getPage(n);
      if (stale()) return;
      entry.page = page;
      const viewport = page.getViewport({ scale: this.scale });

      // Correct the placeholder if this page is a different size.
      entry.el.style.width = Math.floor(viewport.width) + 'px';
      entry.el.style.height = Math.floor(viewport.height) + 'px';

      canvas = document.createElement('canvas');
      const MAX_PIXELS = 6e6;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const raw = viewport.width * viewport.height * dpr * dpr;
      const ratio = raw > MAX_PIXELS ? dpr * Math.sqrt(MAX_PIXELS / raw) : dpr;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = Math.floor(viewport.width) + 'px';
      canvas.style.height = Math.floor(viewport.height) + 'px';

      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.scale(ratio, ratio);

      const task = entry.task = page.render({ canvasContext: ctx, viewport });
      if (document.hidden) {
        // Parked, not stuck: wait it out rather than failing the page.
        await task.promise;
      } else {
        let timer;
        const timeout = new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('render timed out')), 30000);
        });
        try {
          await Promise.race([task.promise, timeout]);
        } catch (err) {
          try { task.cancel(); } catch { /* already finished */ }
          throw err;
        } finally {
          clearTimeout(timer);
        }
      }
      entry.task = null;
      if (stale()) return;

      const textLayer = document.createElement('div');
      textLayer.className = 'text-layer';
      textLayer.style.width = Math.floor(viewport.width) + 'px';
      textLayer.style.height = Math.floor(viewport.height) + 'px';

      const content = await page.getTextContent();
      if (stale()) return;

      // Read Aloud 2: on the page first, then build: buildTextLayer measures each span, and a span that is not
      // in the document measures 0 wide, so it was never stretched to the PDF's width (the shading came out short).
      entry.el.textContent = '';
      entry.el.appendChild(canvas);
      entry.el.appendChild(textLayer);
      const spans = this.buildTextLayer(content, viewport, textLayer);
      if (entry.old) entry.old.width = entry.old.height = 0;  // the stretched picture of before a zoom
      entry.old = null;

      entry.canvas = canvas;
      entry.textLayer = textLayer;
      entry.spans = spans;
      entry.rendered = true;

      canvas = null;  // the page keeps it now
      this.reapplyHighlight(n);
      this.drawMarks(n);  // Read Aloud 2: saved highlights
      if (this.lastParts?.some(p => p.page === n)) this.drawWord();  // the word box after a zoom or a release
    } catch (err) {
      if (!stale()) console.error('render page ' + n, err);
    } finally {
      if (canvas) canvas.width = canvas.height = 0;  // a picture that no page shows
      // A dropped render: now that its work ended, pdf.js can free the page (it refused while it was busy).
      if (stale() && page && !entry.rendering && !entry.rendered) {
        try { page.cleanup(); } catch { /* pdf.js keeps it */ }
      }
      if (!stale()) {
        entry.rendering = false;
        entry.task = null;
        // The page left the screen while it was drawn: the observer will not tell us again.
        if (entry.wanted === false) this.releasePage(n);
      }
    }
  }

  /**
   * One absolutely-positioned span per PDF text item, index-aligned with
   * textContent.items so a sentence can find its glyphs by item number.
   */
  buildTextLayer(content, viewport, host) {
    const { Util } = this.pdfjsLib;
    const spans = new Map();
    const items = content.items.filter(i => typeof i.str === 'string');
    const frag = document.createDocumentFragment();
    const measure = [];

    items.forEach((item, index) => {
      if (!item.str.trim()) return;

      const tx = Util.transform(viewport.transform, item.transform);
      const fontHeight = Math.hypot(tx[2], tx[3]);
      const span = document.createElement('span');
      span.textContent = item.str;
      span.style.left = tx[4] + 'px';
      span.style.top = (tx[5] - fontHeight) + 'px';
      span.style.fontSize = fontHeight + 'px';
      span.style.fontFamily = (content.styles[item.fontName] || {}).fontFamily || 'sans-serif';

      frag.appendChild(span);
      spans.set(index, span);
      measure.push([span, item.width * viewport.scale]);
    });

    host.appendChild(frag);

    // Squeeze each span to the width the PDF says it occupies, so the
    // underline sits under the right glyphs regardless of substituted fonts.
    // Read Aloud 2: all reads first, then all writes: one layout pass, not one for each span.
    const widths = measure.map(([span]) => span.getBoundingClientRect().width);
    measure.forEach(([span, target], i) => {
      if (widths[i] > 0 && target > 0) {
        span.style.transform = `scaleX(${target / widths[i]})`;
        span.style.transformOrigin = '0 0';
      }
    });

    return spans;
  }

  releasePage(n) {
    const entry = this.pages.get(n);
    // Read Aloud 2: a page that is still drawing is released too (its render is cancelled).
    if (!entry || !(entry.rendered || entry.rendering)) return;

    // Never tear down the page we're currently reading.
    if (this.highlighted.some(s => s.page === n)) return;

    if (entry.rendered || entry.old) this.blank(n, entry);
    else this.drop(entry);
  }

  /**
   * Read Aloud 2: the boxes for character ranges, in two passes: all reads (sizes), then all writes (new boxes),
   * so the browser lays out the page once, not once for each box. parts: [{ page, item, start, end, ...data }]
   */
  drawBoxes(parts, className, data = () => ({})) {
    const found = [];
    const hosts = new Map();  // page element -> its box, read once
    for (const part of parts) {
      const entry = this.pages.get(part.page);
      if (!entry || !entry.rendered) continue;
      const span = entry.spans.get(part.item);
      if (!span || !span.firstChild) continue;
      const text = span.firstChild.textContent || '';
      const start = Math.max(0, Math.min(part.start, text.length));
      const end = Math.max(start, Math.min(part.end, text.length));
      if (end === start) continue;
      const range = document.createRange();
      try {
        range.setStart(span.firstChild, start);
        range.setEnd(span.firstChild, end);
      } catch { continue; }
      const host = entry.el;
      if (!hosts.has(host)) hosts.set(host, host.getBoundingClientRect());
      for (const rect of range.getClientRects()) if (rect.width >= 0.5) found.push({ part, host, rect });
      range.detach?.();
    }
    const boxes = found.map(({ part, host, rect }) => {
      const box = document.createElement('div');
      box.className = className;
      Object.assign(box.dataset, data(part));
      const hostBox = hosts.get(host);
      box.style.left = (rect.left - hostBox.left) + 'px';
      box.style.top = (rect.top - hostBox.top) + 'px';
      box.style.width = rect.width + 'px';
      box.style.height = rect.height + 'px';
      return { host, box };
    });
    for (const { host, box } of boxes) host.appendChild(box);
    return boxes.map(b => b.box);
  }

  /**
   * Box the single word being spoken. `parts` is a list of
   * { page, item, start, end } character ranges inside text items; we measure
   * them with a DOM Range so the box lands on the real glyphs even after the
   * scaleX correction.
   */
  highlightWord(parts, retried = false) {
    this.clearWord();
    if (!parts || !parts.length) return;
    this.lastParts = parts;

    // A block can run across a column break or onto the next page. If the word
    // has moved onto a page we haven't drawn yet, draw it now — otherwise the
    // highlight silently vanishes and you lose your place.
    // Read Aloud 2: only one try, and only while this is still the word that is read (no loop, no old word).
    for (const part of parts) {
      const entry = this.pages.get(part.page);
      if (!retried && entry && !entry.rendered && !entry.rendering) {
        this.renderPage(part.page).then(() => { if (this.lastParts === parts) this.highlightWord(parts, true); });
        return;
      }
    }

    const firstBox = this.drawWord();

    // Follow the word, not the block. Scrolling to the start of a block leaves
    // the highlight to wander off-screen halfway through a long paragraph.
    if (firstBox && this.follow !== false) this.keepInView(firstBox);  // Read Aloud 2: not while you scroll away
  }

  /** Read Aloud 2: (re)draw the boxes of the word that is read (`lastParts`), with no scroll. */
  drawWord() {
    for (const box of this.wordBoxes) box.remove();
    this.wordBoxes = this.drawBoxes(this.lastParts || [], 'word-box');
    const firstBox = this.wordBoxes[0];
    if (firstBox) this.lastWordBox = firstBox;
    return firstBox;
  }

  /** Nudges the scroller only when the target has drifted out of a comfortable band. */
  keepInView(el) {
    const scroller = this.container.parentElement;
    const box = el.getBoundingClientRect();
    const view = scroller.getBoundingClientRect();
    const topEdge = view.top + view.height * 0.18;
    const bottomEdge = view.bottom - view.height * 0.28;
    if (box.top >= topEdge && box.bottom <= bottomEdge) return;
    scroller.scrollBy({
      top: box.top - view.top - view.height * 0.35,
      behavior: 'smooth'
    });
  }

  /**
   * Read Aloud 2: saved highlights, drawn as a coloured underline under the text on every rendered page.
   * marks: [{ id, color, parts: [{ page, item, start, end }] }]
   */
  setMarks(marks) {
    this.marks = marks || [];
    for (const [n, entry] of this.pages) if (entry.rendered) this.drawMarks(n);
  }

  drawMarks(n) {
    const entry = this.pages.get(n);
    if (!entry || !entry.rendered) return;
    entry.el.querySelectorAll('.mark-box').forEach(b => b.remove());
    const parts = [];
    for (const mark of this.marks || []) {
      for (const part of mark.parts) if (part.page === n) parts.push({ ...part, mark });
    }
    this.drawBoxes(parts, 'mark-box', ({ mark }) => ({ color: mark.color, id: mark.id }));
  }

  clearWord() {
    for (const box of this.wordBoxes) box.remove();
    this.wordBoxes = [];
    this.lastParts = null;  // a word that waits for its page is not drawn any more
  }

  clearHighlight() {
    this.releaseLeft(this.unmark());
  }

  /** Remove the sentence mark and the word box; give back the old sentence. */
  unmark() {
    this.clearWord();
    for (const { page, item } of this.highlighted) {
      const entry = this.pages.get(page);
      const span = entry && entry.spans.get(item);
      if (span) span.classList.remove('speaking');
    }
    const old = this.highlighted;
    this.highlighted = [];
    return old;
  }

  /**
   * Read Aloud 2: a page that left the screen while it was read was kept (releasePage does not release the page
   * that is read), and the observer does not tell again. Release it when the reading has moved on.
   */
  releaseLeft(old) {
    for (const p of new Set(old.map(s => s.page))) if (this.pages.get(p)?.wanted === false) this.releasePage(p);
  }

  reapplyHighlight(pageNumber) {
    for (const { page, item } of this.highlighted) {
      if (page !== pageNumber) continue;
      const span = this.pages.get(page)?.spans.get(item);
      if (span) span.classList.add('speaking');
    }
  }

  /**
   * Underline the glyphs a sentence covers and keep them on screen.
   */
  async highlight(spans, { follow = true } = {}) {
    follow = follow && this.follow !== false;  // Read Aloud 2: you scrolled away: stay where you are
    const old = this.unmark();
    this.highlighted = spans && spans.length ? spans : [];
    this.releaseLeft(old);  // after the new sentence is set: a page that is still read stays
    if (!this.highlighted.length) return;

    const firstPage = spans[0].page;
    const entry = this.pages.get(firstPage);
    if (!entry) return;

    if (!entry.rendered) {
      // Jump to the page before we can underline anything on it.
      if (follow) entry.el.scrollIntoView({ block: 'center' });
      await this.renderPage(firstPage);
    }

    const touched = new Set(spans.map(s => s.page));
    for (const p of touched) {
      if (p !== firstPage && !this.pages.get(p)?.rendered) await this.renderPage(p);
      this.reapplyHighlight(p);
    }

    if (follow) this.scrollIntoView(spans[0]);
  }

  /** True when any glyph of the block is already on screen. */
  blockVisible(spans) {
    const scroller = this.container.parentElement;
    const view = scroller.getBoundingClientRect();
    for (const { page, item } of spans) {
      const span = this.pages.get(page)?.spans.get(item);
      if (!span) continue;
      const box = span.getBoundingClientRect();
      if (box.bottom > view.top && box.top < view.bottom) return true;
    }
    return false;
  }

  scrollIntoView({ page, item }) {
    const span = this.pages.get(page)?.spans.get(item);
    if (!span) return;
    const scroller = this.container.parentElement;
    const spanBox = span.getBoundingClientRect();
    const viewBox = scroller.getBoundingClientRect();

    const above = spanBox.top < viewBox.top + viewBox.height * 0.15;
    const below = spanBox.bottom > viewBox.bottom - viewBox.height * 0.25;
    if (!above && !below) return;

    const delta = spanBox.top - viewBox.top - viewBox.height * 0.35;
    scroller.scrollBy({ top: delta, behavior: 'smooth' });
  }

  goToPage(n) {
    this.pages.get(n)?.el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  async relayout() {
    if (!this.doc || !this.baseViewport) return;
    const previous = this.scale;
    this.computeScale();
    if (Math.abs(previous - this.scale) < 0.01) return;
    this.rescale();
  }
}
