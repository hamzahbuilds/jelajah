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

/** Render PDF pages to PNG blobs for OCR of scanned documents. */
export async function renderPdfPages(file: File, maxPages = 8, scale = 2.2, signal?: AbortSignal): Promise<Blob[]> {
  signal?.throwIfAborted();
  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({ data });
  const abort = () => { void task.destroy(); };
  signal?.addEventListener('abort', abort, {once:true});
  try {
    const doc = await task.promise;
    const out: Blob[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      signal?.throwIfAborted();
      const page = await doc.getPage(p);
      const base = page.getViewport({scale:1});
      // Bound each canvas to four megapixels, including unusually large scans.
      const vp = page.getViewport({scale:Math.min(scale,Math.sqrt(4_000_000/(base.width*base.height)))});
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      const render = page.render({canvasContext:canvas.getContext('2d')!,viewport:vp} as any);
      const cancel = () => render.cancel();
      signal?.addEventListener('abort',cancel,{once:true});
      try {
        await render.promise;
        signal?.throwIfAborted();
        const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve,'image/png'));
        if (!blob) throw new Error('ocr_render_failed');
        out.push(blob);
      } finally { signal?.removeEventListener('abort',cancel); canvas.width=0; canvas.height=0; page.cleanup(); }
    }
    return out;
  } finally { signal?.removeEventListener('abort',abort); await task.destroy(); }
}
