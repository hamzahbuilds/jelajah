// In-browser OCR for scanned PDFs and receipt photos (v0.11) — Tesseract.js.
// Free, no API keys. Worker + wasm core are served by the app itself; the
// English + Malay language packs ship with the app, Japanese/Chinese download
// once from a free CDN and are cached by the browser.
import { createWorker } from 'tesseract.js';

export const OCR_LANGS: Array<{ code: string; label: string; local: boolean }> = [
  { code: 'eng', label: 'English', local: true },
  { code: 'msa', label: 'Bahasa Melayu', local: true },
  { code: 'jpn', label: '日本語', local: false },
  { code: 'chi_sim', label: '中文', local: false },
];

const CDN_LANG_PATH = 'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@4.1.0';
const LOCAL_LANG_PATH = '/tess/lang';

const LS_KEY = 'ocr_langs';
export function savedLangs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_KEY) ?? '');
    if (Array.isArray(v) && v.length) return v.filter(l => OCR_LANGS.some(o => o.code === l));
  } catch { /* default below */ }
  return ['eng', 'msa'];
}
export function saveLangs(langs: string[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(langs)); } catch { /* ignore */ }
}

/** True when the PDF's embedded text is too thin to parse — likely a scan. */
export function looksScanned(text: string, pages = 1): boolean {
  return text.replace(/\s+/g, '').length < 40 * Math.max(1, pages);
}

export interface OcrProgress { page: number; pages: number; pct: number; status: string }

/** OCR a list of page images; returns the concatenated text. */
export async function ocrImages(
  images: Blob[],
  langs: string[],
  onProgress: (p: OcrProgress) => void,
): Promise<string> {
  const use = langs.length ? langs : ['eng'];
  // packs must all come from one path: local when everything ships with the
  // app, the CDN as soon as a downloadable language is selected
  const allLocal = use.every(l => OCR_LANGS.find(o => o.code === l)?.local);
  const custom = (window as any).JELAJAH_TESS_LANGPATH as string | undefined;
  const langPath = custom ?? (allLocal ? LOCAL_LANG_PATH : CDN_LANG_PATH);

  let page = 0;
  const worker = await createWorker(use, 1, {
    workerPath: '/tess/worker.min.js',
    corePath: '/tess/tesseract-core-simd-lstm.wasm.js',
    langPath,
    logger: m => {
      if (m.status === 'recognizing text') {
        onProgress({ page: page + 1, pages: images.length, pct: m.progress ?? 0, status: 'recognize' });
      } else if (/loading language/i.test(m.status ?? '')) {
        onProgress({ page: 0, pages: images.length, pct: m.progress ?? 0, status: 'lang' });
      }
    },
  });
  try {
    const texts: string[] = [];
    for (page = 0; page < images.length; page++) {
      onProgress({ page: page + 1, pages: images.length, pct: 0, status: 'recognize' });
      const { data } = await worker.recognize(images[page]);
      texts.push(data.text);
    }
    return texts.join('\n');
  } finally {
    await worker.terminate();
  }
}
