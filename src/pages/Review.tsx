import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { api, fmtMoney } from '../api';
import { useT } from '../i18n';
import { useToast } from '../components/Toast';
import { useSession } from '../App';
import { TripCtx } from './TripShell';
import ExpenseForm, { emptyDraft, ExpenseDraft } from '../components/ExpenseForm';

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '');

export default function Review() {
  const { t } = useT();
  const { toast } = useToast();
  const { user } = useSession();
  const { tripId, members } = useOutletContext<TripCtx>();
  const { docId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const duplicate = (location.state as any)?.duplicate;
  const [doc, setDoc] = useState<any>(null);
  const [createExp, setCreateExp] = useState(true);
  const [busy, setBusy] = useState(false);
  // v0.11 keyword chips → form field pushes
  const [patch, setPatch] = useState<{ seq: number; data: any }>({ seq: 0, data: {} });
  const [dateTarget, setDateTarget] = useState<'date' | 'checkout' | 'payment' | 'due'>('date');
  const [bookingNo, setBookingNo] = useState<string | undefined>(undefined);
  const push = (data: any) => setPatch(p => ({ seq: p.seq + 1, data }));

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
    if (parsed.paymentStatus === 'pay_at_hotel') {
      d.payment_status = 'pay_at_hotel';
      // committed, not owed — remind on the check-in day itself
      if (parsed.checkInDate) {
        d.due_dates = [{
          due_date: parsed.checkInDate,
          // due amounts are stored in MYR; skip when the voucher is foreign-currency
          amount_myr: (parsed.currency ?? 'MYR') === 'MYR' ? parsed.totalAmount ?? undefined : undefined,
          note: t.payAtHotel,
        }];
      }
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
        vendor: parsed.vendor, docType: parsed.docType, bookingNo: bookingNo ?? parsed.bookingNo,
      });
      toast(expensePayload ? t.tExpenseSaved : t.tSaved);
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
            {/^image\//.test(doc.mime ?? '') || /\.(png|jpe?g|webp)$/i.test(doc.filename)
              ? <img className="preview" src={`/api/documents/${doc.id}/file`} alt={doc.filename} />
              : <iframe className="preview" src={`/api/documents/${doc.id}/file`} title={doc.filename} />}
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
                {parsed.paymentStatus === 'pay_at_hotel' && (
                  <tr><td className="muted">{t.paymentStatusLbl}</td><td><span className="badge warn">🏨💤 {t.payAtHotel}</span></td></tr>
                )}
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
          {parsed.keywords && (() => {
            const kw = parsed.keywords;
            const group = (label: string, chips: React.ReactNode[]) => chips.length ? (
              <div className="kw-group" key={label}>
                <span className="kw-label">{label}</span>
                <span className="chips">{chips}</span>
              </div>
            ) : null;
            const dateChip = (d: any, i: number) => (
              <span key={i} className="chip" title={d.context}
                onClick={() => push(dateTarget === 'due'
                  ? { due_dates: [{ due_date: d.iso }] }
                  : dateTarget === 'checkout' ? { end_date: d.iso }
                  : dateTarget === 'payment' ? { payment_date: d.iso }
                  : { expense_date: d.iso })}>
                {d.iso}{d.role ? ` · ${d.role}` : ''}
              </span>
            );
            const nameChip = (n: any, i: number) => {
              const nn = norm(n.raw);
              const hit = members.find(m => { const mn = norm(m.name); return mn === nn || mn.includes(nn) || nn.includes(mn); });
              return (
                <span key={i} className={`chip ${hit ? '' : 'off'}`} title={hit ? hit.name : t.notMatched}
                  onClick={() => hit && push((prev: ExpenseDraft) => ({
                    participant_ids: prev.participant_ids.includes(hit.id)
                      ? prev.participant_ids.filter(x => x !== hit.id)
                      : [...prev.participant_ids, hit.id],
                  }))}>
                  {n.raw}{hit ? ' ✓' : ''}
                </span>
              );
            };
            return (
              <div className="kw-panel">
                <div className="row-between">
                  <h3 style={{ margin: 0 }}>🔍 {t.detectedKeywords}</h3>
                  <span className="tiny">{t.kwTip}</span>
                </div>
                {kw.dates.length > 0 && (
                  <div className="row tiny" style={{ gap: 4, margin: '6px 0 0' }}>
                    <span>{t.dateTargetLbl}:</span>
                    {([['date', t.dtDate], ['checkout', t.dtCheckout], ['payment', t.dtPayment], ['due', t.dtDue]] as const).map(([k, lbl]) => (
                      <span key={k} className={`chip ${dateTarget === k ? 'on' : ''}`} onClick={() => setDateTarget(k)}>{lbl}</span>
                    ))}
                  </div>
                )}
                {group(`📅 ${t.kwDates}`, kw.dates.slice(0, 8).map(dateChip))}
                {group(`💰 ${t.kwAmounts}`, kw.amounts.slice(0, 8).map((a: any, i: number) => (
                  <span key={i} className="chip" title={a.context}
                    onClick={() => push({ amount_original: a.value, currency: a.currency, ...(a.currency === 'MYR' ? { fx_rate: 1, amount_myr: a.value } : {}) })}>
                    {a.currency} {a.value.toLocaleString()}
                  </span>
                )))}
                {group(`🔖 ${t.kwRefs}`, kw.refs.slice(0, 5).map((r: any, i: number) => (
                  <span key={i} className={`chip ${(bookingNo ?? parsed.bookingNo) === r.value ? 'on' : ''}`}
                    title={r.context} onClick={() => setBookingNo(r.value)}>{r.value}</span>
                )))}
                {group(`✈️ ${t.kwFlights}`, kw.flights.slice(0, 6).map((f: any, i: number) => (
                  <span key={i} className="chip" title={f.context}
                    onClick={() => push((prev: ExpenseDraft) => ({ description: prev.description ? `${prev.description} ${f.raw}` : f.raw }))}>
                    {f.flightNo ?? `${f.from}→${f.to}`}
                  </span>
                )))}
                {group(`👤 ${t.kwNames}`, kw.names.slice(0, 8).map(nameChip))}
                {group(`🏪 ${t.kwVendor}`, kw.vendors.slice(0, 4).map((v: any, i: number) => (
                  <span key={i} className="chip" title={v.context} onClick={() => push({ vendor: v.raw })}>{v.raw}</span>
                )))}
                {group(`💳 ${t.kwPayment}`, kw.payments.slice(0, 4).map((p2: any, i: number) => (
                  <span key={i} className="chip" title={p2.context}>{p2.raw}</span>
                )))}
              </div>
            );
          })()}
          <label className="row" style={{ marginBottom: 12, gap: 8 }}>
            <input type="checkbox" checked={createExp} onChange={e => setCreateExp(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: 'var(--brand)' }} />
            <strong>{t.createExpense}</strong>
          </label>
          {createExp ? (
            <ExpenseForm members={members} initial={initial} busy={busy} externalPatch={patch}
              submitLabel={t.confirmSave} onSubmit={p => confirm(p)} />
          ) : (
            <button className="btn" disabled={busy} onClick={() => confirm(undefined)}>{t.docOnly}</button>
          )}
        </div>
      </div>
    </div>
  );
}
