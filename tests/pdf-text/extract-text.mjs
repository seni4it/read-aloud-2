// Run the reader's real PDF text code (extension/pdf/extract.js with the
// vendored pdf.js) in Node, and give back the sentences of one PDF.
//
// The browser files are imported as they are: they are ES modules, and Node
// loads them without a change. Two things differ from the page:
//  - fetch() in Node cannot read a file: URL, so the lexicon is read with fs
//    and handed to loadLexicon through a small fetch stand-in;
//  - pdf.js runs its worker code in this process (no Web Worker).
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PDF_DIR = path.resolve(HERE, '../../extension/pdf');
const VENDOR = path.join(PDF_DIR, 'vendor');

let ready = null;

async function load() {
  // pdf.js prints a warning that asks for its "legacy" build in Node. The
  // reader ships the normal build, and the test must run the same code.
  const warn = console.warn;
  const log = console.log;
  console.log = console.warn = (...a) => {
    if (/legacy/.test(String(a[0]))) return;
    warn(...a);
  };
  try {
    const pdfjs = await import(pathToFileURL(path.join(VENDOR, 'pdf.mjs')).href);
    pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(VENDOR, 'pdf.worker.mjs')).href;
    const lexicon = await import(pathToFileURL(path.join(PDF_DIR, 'lexicon.js')).href);
    const extract = await import(pathToFileURL(path.join(PDF_DIR, 'extract.js')).href);
    await loadLexiconFromFile(lexicon);
    return { pdfjs, extract };
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

/** Load vendor/lexicon.txt into lexicon.js the way the page does, through fetch(). */
export async function loadLexiconFromFile(lexicon) {
  const url = pathToFileURL(path.join(VENDOR, 'lexicon.txt')).href;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async u => {
    if (String(u) !== url) return realFetch(u);
    const text = await readFile(fileURLToPath(u), 'utf8');
    return { ok: true, status: 200, text: async () => text };
  };
  try {
    await lexicon.loadLexicon(url);
  } finally {
    globalThis.fetch = realFetch;
  }
}

/** The default reader options (the switches of the reader, as they start). */
export const DEFAULT_OPTIONS = {
  stripCitations: true,
  stripCaptions: true,
  skipInsets: false,
  skipTables: true,   // "Skip tables" starts on in the reader (index.html, app.js)
  skipParens: false,
  stopAtReferences: true
};

/** The sentences of one PDF file, as the reader makes them. */
export async function sentencesOf(file, options = DEFAULT_OPTIONS) {
  ready ??= load();
  const { pdfjs, extract } = await ready;
  const data = new Uint8Array(await readFile(file));
  const warn = console.warn;
  const log = console.log;
  console.log = console.warn = (...a) => {
    if (/legacy/.test(String(a[0]))) return;
    warn(...a);
  };
  let doc;
  try {
    doc = await pdfjs.getDocument({
      data,
      standardFontDataUrl: path.join(VENDOR, 'standard_fonts') + '/',
      cMapUrl: path.join(VENDOR, 'cmaps') + '/',
      cMapPacked: true,
      verbosity: 0
    }).promise;
    const builder = await extract.buildDocument(doc, options);
    return builder.sentences.map(s => s.text);
  } finally {
    console.log = log;
    console.warn = warn;
    if (doc) await doc.destroy();
  }
}
