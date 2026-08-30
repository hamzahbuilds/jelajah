// Client-side PDF text extraction — same line-reconstruction logic as
// scripts/extract-text.mjs so parsers see identical text in tests and in the app.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

function itemsToLines(items: any[]): string[] {
  const rows = new Map<number, Array<{ x: number; str: string }>>();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.transform[5]);
    let key: number | null = null;
    for (const k of rows.keys()) if (Math.abs(k - y) <= 2) { key = k; break; }
    if (key === null) { key = y; rows.set(key, []); }
    rows.get(key)!.push({ x: it.transform[4], str: it.str });
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map(p => p.str).join(' ').replace(/\s+/g, ' ').trim());
}

export async function extractPdfText(file: File): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    lines.push(...itemsToLines(tc.items as any[]), '');
  }
  return lines.join('\n');
}
