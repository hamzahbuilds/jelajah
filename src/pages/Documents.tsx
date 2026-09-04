import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext, Link } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { useT } from '../i18n';
import { TripCtx } from './TripShell';
import { extractPdfText, renderPdfPages } from '../pdf';
import { parseDocument } from '../../shared/parsers';
import { OCR_LANGS, savedLangs, saveLangs, looksScanned, ocrImages, OcrProgress } from '../ocr';
import { useToast } from '../components/Toast';

const ICONS: Record<string, string> = {
  receipt: '🧾', itinerary: '🛫', confirmation: '🏠', other: '📄',
};

export default function Documents() {
  const { t, lang } = useT();
  const { tripId, canLead } = useOutletContext<TripCtx>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [docs, setDocs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const toggleSel = (id: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const bulkDelete = async () => {
    if (!selected.size || !window.confirm(t.bulkDeleteConfirm(selected.size))) return;
    setBusy(true);
    try {
      for (const id of selected) await api.del(`/documents/${id}`);
      setSelected(new Set());
      await load();
    } finally { setBusy(false); }
  };

  const load = async () => setDocs(await api.get(`/trips/${tripId}/documents`));
  useEffect(() => { load(); }, [tripId]);

  const [ocrQueue, setOcrQueue] = useState<{ files: File[]; single: boolean } | null>(null);
  // v0.12: visible import pipeline — ✈️ progress, counts, per-file errors
  const [prog, setProg] = useState<{ done: number; total: number; current: string; errors: Array<{ name: string; reason: string }> } | null>(null);

  const emptyParse = (warning?: string) => ({
    parser: 'none', docType: 'other', people: [], legs: [], fields: {},
    warnings: warning ? [warning] : [], confidence: 0, suggestExpense: true,
  });

  const uploadOne = async (file: File, parsed: any, goReview: boolean) => {
    const form = new FormData();
    form.append('file', file);
    form.append('meta', JSON.stringify(parsed));
    const res = await api.upload(`/trips/${tripId}/documents`, form);
    if (goReview) navigate(`/trips/${tripId}/documents/${res.id}/review`, { state: { duplicate: res.duplicate } });
    return res;
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length || busy || ocrQueue) return;
    setBusy(true);
    const all = Array.from(files);
    const errors: Array<{ name: string; reason: string }> = [];
    let done = 0;
    setProg({ done: 0, total: all.length, current: all[0]?.name ?? '', errors: [] });
    const tick = (current: string) => setProg({ done, total: all.length, current, errors: [...errors] });
    try {
      const needOcr: File[] = [];
      for (const file of all) {
        tick(file.name);
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        const isImage = /^image\//.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
        try {
          if (isPdf) {
            let text = '';
            try { text = await extractPdfText(file); } catch { /* treat as scan */ }
            if (looksScanned(text)) { needOcr.push(file); continue; } // scanned PDF → OCR prompt
            await uploadOne(file, parseDocument(text), all.length === 1);
            if (all.length === 1) return;
          } else if (isImage) {
            needOcr.push(file); // photos always go through the OCR prompt
          } else {
            await uploadOne(file, emptyParse(), false);
          }
          done++;
        } catch {
          errors.push({ name: file.name, reason: t.uploadFailedRow });
        }
        tick(file.name);
      }
      if (all.length > 1 || errors.length) toast(t.uploadDone(done, errors.length), errors.length ? 'error' : 'ok');
      if (needOcr.length) { setOcrQueue({ files: needOcr, single: all.length === 1 && needOcr.length === 1 }); return; }
      await load();
    } finally {
      setBusy(false);
      setProg(p => (p && p.errors.length === 0 && errors.length === 0 ? null : p ? { ...p, done, errors: [...errors] } : null));
      if (!errors.length) setProg(null);
    }
  };

  return (
    <div>
      {canLead && (
        <>
          <div
            className={`dropzone ${drag ? 'drag' : ''} ${busy || ocrQueue ? 'disabled' : ''}`}
            onClick={() => !busy && !ocrQueue && fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); if (!busy && !ocrQueue) setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
          >
            <div style={{ fontSize: '1.6rem' }}>📥</div>
            <strong>{busy ? t.parsing : t.uploadDoc}</strong>
            <div className="tiny">{t.dropHint}</div>
            <input ref={fileRef} type="file" accept="application/pdf,image/*" multiple hidden
              onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
          </div>
          {prog && (
            <div className="upload-strip">
              <div className="row-between tiny" style={{ marginBottom: 3 }}>
                <span>{busy ? t.uploadingDocs : t.uploadDone(prog.done, prog.errors.length)}</span>
                <span>{t.uploadCount(prog.done, prog.total)}{prog.errors.length ? ` · ⚠️ ${prog.errors.length}` : ''}</span>
              </div>
              <div className="upload-track">
                <div className="fillbar" style={{ width: `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%` }} />
                <span className="plane" style={{ left: `${Math.max(4, Math.min(96, Math.round((prog.done / Math.max(1, prog.total)) * 100)))}%` }}>✈️</span>
              </div>
              {busy && <div className="tiny" style={{ marginTop: 2 }}>{prog.current}</div>}
              {prog.errors.length > 0 && !busy && (
                <div className="callout warn" style={{ marginTop: 6 }}>
                  {prog.errors.map((er, i) => <div key={i} className="tiny">⚠️ {er.name} — {er.reason}</div>)}
                  <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={() => setProg(null)}>✕ {t.close}</button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        {canLead && docs.length > 0 && (
          <div className="row-between" style={{ paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
            <label className="row tiny" style={{ gap: 6 }}>
              <input type="checkbox"
                checked={selected.size === docs.length && docs.length > 0}
                onChange={e => setSelected(e.target.checked ? new Set(docs.map(d => d.id)) : new Set())} />
              {t.selectAll}
            </label>
            {selected.size > 0 && (
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={bulkDelete}>
                🗑️ {t.deleteSelected} ({selected.size})
              </button>
            )}
          </div>
        )}
        {docs.length === 0 && <p className="muted">{t.noDocs}</p>}
        {docs.map(d => (
          <div className="doc-row" key={d.id}>
            {canLead && (
              <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleSel(d.id)}
                style={{ width: 17, height: 17, flex: '0 0 auto', accentColor: 'var(--brand)' }} />
            )}
            <span className="ic">{ICONS[d.doc_type] ?? '📄'}</span>
            <div className="grow">
              <div className="fname">{d.filename}</div>
              <div className="tiny">
                {d.vendor ?? '—'}{d.booking_no ? ` · ${d.booking_no}` : ''} · {fmtDate(d.created_at?.slice(0, 10), lang)}
              </div>
            </div>
            {d.status === 'confirmed'
              ? <span className="badge ok">{t.confirmedStatus}</span>
              : <span className="badge warn">{t.draft}</span>}
            {d.expense_id && <Link className="badge brand" to={`/trips/${tripId}/ledger`}>{t.linkedExpense}</Link>}
            <a className="btn btn-ghost btn-sm" href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer">
              {t.viewFile}
            </a>
            {canLead && d.status === 'draft' && (
              <Link className="btn btn-sm" style={{ textDecoration: 'none' }}
                to={`/trips/${tripId}/documents/${d.id}/review`}>{t.reviewNow}</Link>
            )}
            {canLead && (
              <button className="icon" aria-label={t.delete} onClick={async () => {
                if (!window.confirm(d.expense_id ? t.deleteDocLinked : t.deleteDocConfirm)) return;
                await api.del(`/documents/${d.id}`);
                await load();
              }}>🗑️</button>
            )}
          </div>
        ))}
      </div>

      {ocrQueue && (
        <OcrModal files={ocrQueue.files} single={ocrQueue.single}
          upload={uploadOne}
          onClose={async () => { setOcrQueue(null); await load(); }} />
      )}
    </div>
  );
}

/** v0.11: OCR prompt for photos and scanned PDFs — language chips + progress. */
function OcrModal({ files, single, upload, onClose }: {
  files: File[];
  single: boolean;
  upload: (file: File, parsed: any, goReview: boolean) => Promise<any>;
  onClose: () => void;
}) {
  const { t } = useT();
  const [idx, setIdx] = useState(0);
  const [langs, setLangs] = useState<string[]>(savedLangs());
  const [prog, setProg] = useState<OcrProgress | null>(null);
  const [err, setErr] = useState('');
  const file = files[idx];
  const isLast = idx === files.length - 1;

  const toggleLang = (code: string) => {
    if (code === 'eng') return; // English always on — it anchors Latin text
    const next = langs.includes(code) ? langs.filter(l => l !== code) : [...langs, code];
    setLangs(next.length ? next : ['eng']);
    saveLangs(next.length ? next : ['eng']);
  };

  const advance = async () => {
    if (isLast) onClose();
    else { setIdx(idx + 1); setProg(null); setErr(''); }
  };

  const run = async () => {
    setErr('');
    setProg({ page: 0, pages: 1, pct: 0, status: 'lang' });
    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const images: Blob[] = isPdf ? await renderPdfPages(file) : [file];
      const text = await ocrImages(images, langs, setProg);
      const parsed = parseDocument(text);
      parsed.fields['OCR'] = langs.join('+');
      await upload(file, parsed, single && isLast);
      if (!(single && isLast)) await advance();
    } catch (e: any) {
      setErr(t.ocrFailed);
      setProg(null);
    }
  };

  const skip = async () => {
    await upload(file, {
      parser: 'none', docType: 'other', people: [], legs: [], fields: {},
      warnings: [t.ocrSkippedWarn], confidence: 0, suggestExpense: true,
    }, single && isLast);
    if (!(single && isLast)) await advance();
  };

  const running = prog !== null;
  return (
    <div className="overlay" onClick={() => !running && onClose()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="row-between">
          <h2>🔎 {t.ocrTitle}</h2>
          {!running && <button className="icon" onClick={onClose}>✕</button>}
        </div>
        <p className="tiny">{file.name}{files.length > 1 ? ` (${idx + 1}/${files.length})` : ''}</p>
        <p className="tiny">{t.ocrHint}</p>
        <div className="chips" style={{ margin: '8px 0' }}>
          {OCR_LANGS.map(l => (
            <span key={l.code}
              className={`chip ${langs.includes(l.code) ? 'on' : ''}`}
              onClick={() => !running && toggleLang(l.code)}>
              {l.label}{!l.local && !langs.includes(l.code) ? ' ⬇️' : ''}
            </span>
          ))}
        </div>
        {langs.some(l => !OCR_LANGS.find(o => o.code === l)?.local) && (
          <p className="tiny">{t.ocrDownloadNote}</p>
        )}
        {running && (
          <div style={{ margin: '10px 0' }}>
            <div className="tiny">
              {prog.status === 'lang' ? t.ocrLoadingLang : t.ocrPage(prog.page, prog.pages, Math.round(prog.pct * 100))}
            </div>
            <div className="track" style={{ height: 8, marginTop: 4 }}>
              <div className="fill" style={{ width: `${Math.round(prog.pct * 100)}%` }} />
            </div>
          </div>
        )}
        {err && <p className="callout warn">{err}</p>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
          <button className="btn btn-ghost" disabled={running} onClick={skip}>{t.ocrSkip}</button>
          <button className="btn" disabled={running} onClick={run}>▶️ {t.ocrStart}</button>
        </div>
      </div>
    </div>
  );
}
