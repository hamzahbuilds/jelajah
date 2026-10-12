// In-browser OCR for scanned PDFs and receipt photos (v0.11) — Tesseract.js.
// Free, no API keys. Worker + wasm core are served by the app itself; the
// English + Malay language packs ship with the app, Japanese/Chinese download
// once from a free CDN and are cached by the browser.


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
    if (Array.isArray(v) && v.length) return [...new Set(['eng', ...v.filter(l => OCR_LANGS.some(o => o.code === l))])];
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

/** Direct adapter for the bundled Tesseract worker protocol. Owning the native
 * worker immediately lets us terminate it even during language initialization. */
export async function ocrImages(
  images: Blob[], langs: string[], onProgress: (p: OcrProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const use = [...new Set(['eng', ...langs.filter(l => OCR_LANGS.some(o => o.code === l))])];
  const worker = new Worker('/tess/worker.min.js');
  let page = 0, sequence = 0;
  let pending: { id: string; resolve: (data: any) => void; reject: (error: Error) => void } | undefined;
  let stopped = false;
  const stop = () => { stopped = true; worker.terminate(); pending?.reject(new DOMException('OCR cancelled', 'AbortError')); };
  signal?.addEventListener('abort', stop, { once: true });
  worker.onerror = () => pending?.reject(new Error('ocr_worker_failed'));
  worker.onmessageerror = () => pending?.reject(new Error('ocr_worker_failed'));
  worker.onmessage = ({data: m}) => {
    if (stopped) return;
    if (m.status === 'progress') {
      const status = m.data?.status;
      if (status === 'recognizing text' || /loading language/i.test(status || ''))
        onProgress({page: page + 1, pages: images.length, pct: m.data.progress || 0, status: status === 'recognizing text' ? 'recognize' : 'lang'});
    } else if (m.jobId === pending?.id) {
      if (m.status === 'reject') pending!.reject(new Error(String(m.data)));
      if (m.status === 'resolve') pending!.resolve(m.data);
    }
  };
  const job = async (action: string, payload: any) => {
    signal?.throwIfAborted();
    const id = `ocr-${++sequence}`;
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await new Promise<any>((resolve, reject) => {
        pending = {id,resolve,reject};
        timer = setTimeout(() => { worker.terminate(); reject(new Error('ocr_timeout')); }, 90000);
        worker.postMessage({workerId:'jelajah-ocr',jobId:id,action,payload});
      });
    } finally { clearTimeout(timer!); pending = undefined; }
  };
  try {
    onProgress({page:0,pages:images.length,pct:0,status:'lang'});
    await job('load', {options:{lstmOnly:true,corePath:'/tess/tesseract-core-simd-lstm.wasm.js',logging:false}});
    // Local packs are gzipped; tessdata_fast's CDN files are uncompressed.
    for (const local of [true,false]) {
      const selected = use.filter(code => OCR_LANGS.find(l => l.code === code)!.local === local);
      if (selected.length) await job('loadLanguage', {langs:selected,options:{langPath:local ? LOCAL_LANG_PATH : CDN_LANG_PATH,gzip:local,lstmOnly:true}});
    }
    await job('initialize', {langs:use,oem:1,config:{}});
    const texts: string[] = [];
    for (page = 0; page < images.length; page++) {
      signal?.throwIfAborted();
      onProgress({page:page+1,pages:images.length,pct:0,status:'recognize'});
      const image = new Uint8Array(await images[page].arrayBuffer());
      const data = await job('recognize', {image,options:{},output:{text:true}});
      texts.push(data.text);
    }
    return texts.join('\n');
  } finally { stopped = true; signal?.removeEventListener('abort',stop); worker.terminate(); }
}
