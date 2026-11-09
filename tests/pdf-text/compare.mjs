// PDF text comparison check.
//
// For each sample PDF, run the reader's real text code and write its
// sentences to one text file (one sentence on each line). Then print the
// difference against the kept reference file.
//
//   node tests/pdf-text/compare.mjs            write and compare
//   node tests/pdf-text/compare.mjs --update   also make the new text the reference
//
// Two sets of samples:
//  - the public samples in tests/pdf-text/samples/ (references in
//    tests/pdf-text/reference/, new text in tests/pdf-text/out/);
//  - private books in the folder $READ_ALOUD_SAMPLES (default
//    ~/read-aloud-samples), when it exists. Their references go to
//    <folder>/reference/ and their new text to <folder>/out/, so nothing of a
//    private book comes into the repository.
//
// Exit code 0: every sample reads as its reference. 1: a difference, or a
// sample with no reference yet.
import { readdir, readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { sentencesOf } from './extract-text.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const PUBLIC_SET = {
  name: 'public samples',
  pdfs: path.join(HERE, 'samples'),
  reference: path.join(HERE, 'reference'),
  out: path.join(HERE, 'out')
};

export function privateSet(env = process.env) {
  const dir = env.READ_ALOUD_SAMPLES || path.join(os.homedir(), 'read-aloud-samples');
  return { name: 'private samples', pdfs: dir, reference: path.join(dir, 'reference'), out: path.join(dir, 'out') };
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

export async function listPdfs(dir) {
  if (!(await exists(dir))) return [];
  return (await readdir(dir)).filter(f => f.toLowerCase().endsWith('.pdf')).sort();
}

/** The text file of one PDF: one sentence on each line. */
export function toText(sentences) {
  return sentences.map(s => s.replace(/\s*\n\s*/g, ' ')).join('\n') + '\n';
}

/** Write the text of every PDF in a set and compare it. Returns the count of changed samples. */
export async function compareSet(set, { update = false, print = console.log } = {}) {
  const pdfs = await listPdfs(set.pdfs);
  if (!pdfs.length) return { checked: 0, changed: 0 };
  await mkdir(set.out, { recursive: true });
  await mkdir(set.reference, { recursive: true });
  let changed = 0;
  for (const pdf of pdfs) {
    const base = pdf.replace(/\.pdf$/i, '.txt');
    const outFile = path.join(set.out, base);
    const refFile = path.join(set.reference, base);
    let text;
    try {
      text = toText(await sentencesOf(path.join(set.pdfs, pdf)));
    } catch (err) {
      print(`FAIL  ${pdf}: the text could not be read (${err.message})`);
      changed++;
      continue;
    }
    await writeFile(outFile, text);
    if (!(await exists(refFile))) {
      if (update) { await copyFile(outFile, refFile); print(`NEW   ${pdf}: reference written`); }
      else { print(`NEW   ${pdf}: no reference yet (run with --update to keep this text)`); changed++; }
      continue;
    }
    const ref = await readFile(refFile, 'utf8');
    if (ref === text) { print(`same  ${pdf}`); continue; }
    print(`DIFF  ${pdf}`);
    const d = spawnSync('diff', ['-u', '--label', `reference/${base}`, '--label', `out/${base}`, refFile, outFile], { encoding: 'utf8' });
    print(d.stdout || d.stderr);
    if (update) { await copyFile(outFile, refFile); print(`      ${pdf}: reference updated`); }
    else changed++;
  }
  return { checked: pdfs.length, changed };
}

async function main() {
  const update = process.argv.includes('--update');
  let changed = 0;
  for (const set of [PUBLIC_SET, privateSet()]) {
    const pdfs = await listPdfs(set.pdfs);
    if (!pdfs.length) { console.log(`-- ${set.name}: none found`); continue; }
    console.log(`-- ${set.name}: ${pdfs.length} PDF(s), text in ${set.out}`);
    changed += (await compareSet(set, { update })).changed;
  }
  console.log(changed ? `PDF text: ${changed} sample(s) differ from the reference` : 'PDF text: every sample reads as its reference');
  process.exitCode = changed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
