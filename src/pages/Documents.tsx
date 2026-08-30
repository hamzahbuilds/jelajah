import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext, Link } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { useT } from '../i18n';
import { useSession } from '../App';
import { TripCtx } from './TripShell';
import { extractPdfText } from '../pdf';
import { parseDocument } from '../../shared/parsers';

const ICONS: Record<string, string> = {
  receipt: '🧾', itinerary: '🛫', confirmation: '🏠', other: '📄',
};

export default function Documents() {
  const { t, lang } = useT();
  const { user } = useSession();
  const { tripId } = useOutletContext<TripCtx>();
  const navigate = useNavigate();
  const [docs, setDocs] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => setDocs(await api.get(`/trips/${tripId}/documents`));
  useEffect(() => { load(); }, [tripId]);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length || busy) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        let parsed: any = { parser: 'none', docType: 'other', people: [], legs: [], fields: {}, warnings: [], confidence: 0, suggestExpense: true };
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          try {
            const text = await extractPdfText(file);
            parsed = parseDocument(text);
          } catch {
            parsed.warnings = ['Could not read PDF text — fill the fields manually.'];
          }
        }
        const form = new FormData();
        form.append('file', file);
        form.append('meta', JSON.stringify(parsed));
        const res = await api.upload(`/trips/${tripId}/documents`, form);
        if (files.length === 1) {
          navigate(`/trips/${tripId}/documents/${res.id}/review`, { state: { duplicate: res.duplicate } });
          return;
        }
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {user.role === 'admin' && (
        <div
          className={`dropzone ${drag ? 'drag' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
        >
          <div style={{ fontSize: '1.6rem' }}>📥</div>
          <strong>{busy ? t.parsing : t.uploadDoc}</strong>
          <div className="tiny">{t.dropHint}</div>
          <input ref={fileRef} type="file" accept="application/pdf,image/*" multiple hidden
            onChange={e => handleFiles(e.target.files)} />
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        {docs.length === 0 && <p className="muted">{t.noDocs}</p>}
        {docs.map(d => (
          <div className="doc-row" key={d.id}>
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
            {user.role === 'admin' && d.status === 'draft' && (
              <Link className="btn btn-sm" style={{ textDecoration: 'none' }}
                to={`/trips/${tripId}/documents/${d.id}/review`}>{t.reviewNow}</Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
