import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api, fmtMoney } from '../api';
import { useT } from '../i18n';
import { useSession } from '../App';
import { TripCtx } from './TripShell';
import ExpenseForm, { emptyDraft, ExpenseDraft } from '../components/ExpenseForm';

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '');

export default function Review() {
  const { t } = useT();
  const { user } = useSession();
  const { tripId, members } = useOutletContext<TripCtx>();
  const { docId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const duplicate = (location.state as any)?.duplicate;
  const [doc, setDoc] = useState<any>(null);
  const [createExp, setCreateExp] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get(`/documents/${docId}`).then(setDoc); }, [docId]);

  const parsed = useMemo(() => (doc?.parsed_json ? JSON.parse(doc.parsed_json) : null), [doc]);

  const matches = useMemo(() => {
    if (!parsed) return [];
    return (parsed.people ?? []).map((name: string) => {
      const n = norm(name);
      const hit = members.find(m => {
        const mn = norm(m.name);
        return mn === n || mn.includes(n) || n.includes(mn);
      });
      return { name, participant: hit ?? null };
    });
  }, [parsed, members]);

  const initial: ExpenseDraft = useMemo(() => {
    const d = emptyDraft();
    if (!parsed) return d;
    d.category = parsed.category ?? 'other';
    d.description = parsed.description ?? '';
    d.vendor = parsed.vendor ?? '';
    d.location = parsed.location ?? '';
    d.payment_date = parsed.paymentDate ?? '';
    const legDates = (parsed.legs ?? []).map((l: any) => l.date).filter(Boolean);
    d.expense_date = legDates[0] ?? parsed.checkInDate ?? '';
    d.end_date = parsed.checkOutDate ?? (legDates.length > 1 ? legDates[legDates.length - 1] : '');
    d.amount_original = parsed.totalAmount ?? 0;
    d.currency = parsed.currency ?? 'MYR';
    if (d.currency === 'MYR') { d.fx_rate = 1; d.amount_myr = d.amount_original; }
    d.participant_ids = matches.filter((m: any) => m.participant).map((m: any) => m.participant.id);
    if (user.participant_id && members.some(m => m.id === user.participant_id)) {
      d.payer_participant_id = user.participant_id;
    }
    return d;
  }, [parsed, matches]);

  useEffect(() => { if (parsed) setCreateExp(parsed.suggestExpense !== false); }, [parsed]);

  if (!doc || !parsed) return <p className="muted" style={{ padding: 30 }}>{t.loading}</p>;

  const confirm = async (expensePayload?: any) => {
    setBusy(true);
    try {
      await api.post(`/documents/${docId}/confirm`, {
        expense: expensePayload,
        vendor: parsed.vendor, docType: parsed.docType, bookingNo: parsed.bookingNo,
      });
      navigate(`/trips/${tripId}/${expensePayload ? 'ledger' : 'documents'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h2>{t.reviewTitle}</h2>
      {duplicate && <p className="callout warn">⚠️ {t.duplicateWarn}</p>}
      {(parsed.warnings ?? []).map((w: string, i: number) => (
        <p className="callout info" key={i}>ℹ️ {w}</p>
      ))}

      <div className="grid grid-2">
        <div>
          <div className="card">
            <h3>{doc.filename}</h3>
            <iframe className="preview" src={`/api/documents/${doc.id}/file`} title={doc.filename} />
          </div>
          <div className="card">
            <h3>{t.extractedFields}</h3>
            <table>
              <tbody>
                <tr><td className="muted">{t.vendor}</td><td>{parsed.vendor ?? '—'} <span className="tiny">({parsed.parser})</span></td></tr>
                <tr><td className="muted">{t.bookingNo}</td><td>{parsed.bookingNo ?? '—'}</td></tr>
                {parsed.totalAmount != null && (
                  <tr><td className="muted">{t.total}</td><td>{fmtMoney(parsed.totalAmount, parsed.currency ?? 'MYR')}</td></tr>
                )}
                {parsed.paymentMethod && <tr><td className="muted">{t.paymentMethod}</td><td>{parsed.paymentMethod}</td></tr>}
                {parsed.checkInDate && (
                  <tr><td className="muted">{t.checkIn}</td><td>{parsed.checkInDate} {parsed.checkInTime ?? ''}</td></tr>
                )}
                {parsed.checkOutDate && (
                  <tr><td className="muted">{t.checkOut}</td><td>{parsed.checkOutDate} {parsed.checkOutTime ?? ''}</td></tr>
                )}
                {(parsed.legs ?? []).map((l: any, i: number) => (
                  <tr key={i}>
                    <td className="muted">{t.flightLegs} {i + 1}</td>
                    <td>{l.from} → {l.to} · {l.date} {l.depTime ?? ''}{l.arrTime ? `–${l.arrTime}` : ''} {l.flightNo ? `· ${l.flightNo}` : ''}</td>
                  </tr>
                ))}
                {Object.entries(parsed.fields ?? {}).map(([k, v]) => (
                  <tr key={k}><td className="muted">{k}</td><td>{String(v)}</td></tr>
                ))}
              </tbody>
            </table>
            {(parsed.people ?? []).length > 0 && (
              <>
                <h3 style={{ marginTop: 12 }}>{t.peopleOnDoc}</h3>
                {matches.map((m: any, i: number) => (
                  <div className="row-between" key={i} style={{ padding: '3px 0' }}>
                    <span style={{ fontSize: '.85rem' }}>{m.name}</span>
                    {m.participant
                      ? <span className="badge ok">{m.participant.name} ✓</span>
                      : <span className="badge warn">{t.notMatched}</span>}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <div className="card">
          <label className="row" style={{ marginBottom: 12, gap: 8 }}>
            <input type="checkbox" checked={createExp} onChange={e => setCreateExp(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: 'var(--brand)' }} />
            <strong>{t.createExpense}</strong>
          </label>
          {createExp ? (
            <ExpenseForm members={members} initial={initial} busy={busy}
              submitLabel={t.confirmSave} onSubmit={p => confirm(p)} />
          ) : (
            <button className="btn" disabled={busy} onClick={() => confirm(undefined)}>{t.docOnly}</button>
          )}
        </div>
      </div>
    </div>
  );
}
