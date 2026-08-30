// Extract text from sample PDFs using pdfjs-dist (same engine as the browser app)
// Output: tests/fixtures/<name>.txt — lines reconstructed by Y position, matching shared/pdftext.ts logic
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const SRC = 'docs-samples';
const OUT = 'tests/fixtures';

function itemsToLines(items) {
  // Group text items into lines by their transform Y (rounded), then sort by X
  const rows = new Map();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.transform[5]);
    // merge rows within 2px
    let key = null;
    for (const k of rows.keys()) if (Math.abs(k - y) <= 2) { key = k; break; }
    if (key === null) { key = y; rows.set(key, []); }
    rows.get(key).push({ x: it.transform[4], str: it.str });
  }
  const sorted = [...rows.entries()].sort((a, b) => b[0] - a[0]);
  return sorted.map(([, parts]) =>
    parts.sort((a, b) => a.x - b.x).map(p => p.str).join(' ').replace(/\s+/g, ' ').trim()
  );
}

await mkdir(OUT, { recursive: true });
for (const f of await readdir(SRC)) {
  if (!f.endsWith('.pdf')) continue;
  const data = new Uint8Array(await readFile(path.join(SRC, f)));
  const doc = await getDocument({ data, useSystemFonts: true }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    lines.push(...itemsToLines(tc.items), '');
  }
  const out = path.join(OUT, f.replace(/\.pdf$/, '.txt'));
  await writeFile(out, lines.join('\n'));
  console.log(`${f}: ${lines.length} lines -> ${out}`);
}
