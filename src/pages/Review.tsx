import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useOutletContext, useParams } from 'react-router-dom';
import { api, fmtMoney } from '../api';
import { useT } from '../i18n';
import { useToast } from '../components/Toast';
import { useSession } from '../App';
import { TripCtx } from './TripShell';
import ExpenseForm, { emptyDraft, equalShares, ExpenseDraft } from '../components/ExpenseForm';
import Loading from '../components/Loading';
import Empty from '../components/Empty';
import { Icon } from '../components/Icon';

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '');

export default function Review() {
  const { t, lang } = useT();
  const ms = lang === 'ms';
  const { toast } = useToast();
  const { user } = useSession();
  const { tripId, members } = useOutletContext<TripCtx>();
  const { docId } = useParams();
  const location = useLocation();
  const duplicate = (location.state as any)?.duplicate;
  const [error,setError] = useState('');
  const [saved,setSaved] = useState(false);
  const [doc, setDoc] = useState<any>(null);
  const [createExp, setCreateExp] = useState(true);
  const [busy, setBusy] = useState(false);
  // v0.11 keyword chips → form field pushes
  const [patch, setPatch] = useState<{ seq: number; data: any }>({ seq: 0, data: {} });
  const [dateTarget, setDateTarget] = useState<'date' | 'checkout' | 'payment' | 'due'>('date');
  const [bookingNo, setBookingNo] = useState<string | undefined>(undefined);
  const push = (data: any) => setPatch(p => ({ seq: p.seq + 1, data }));

  const load = async () => { setError(''); try { setDoc(await api.get(`/documents/${docId}`)); } catch { setError(ms ? 'Dokumen tidak dapat dimuatkan.' : 'Could not load this document.'); } };
  useEffect(() => { setDoc(null); setSaved(false); setBookingNo(undefined); void load(); }, [docId]);

  const parsed = useMemo(() => { try { return JSON.parse(doc?.parsed_json || '{}'); } catch { return {}; } }, [doc]);

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
    if (doc?.expense) {
      const e=doc.expense;
      const equal = equalShares(e.amount_myr,doc.shares.map((s:any)=>s.participant_id));
      return {...d,...e,vendor:e.vendor||'',location:e.location||'',expense_date:e.expense_date||'',end_date:e.end_date||'',payment_date:e.payment_date||'',
        participant_ids:doc.shares.map((s:any)=>s.participant_id),custom:doc.shares.some((s:any)=>Math.abs(s.amount_myr-equal[s.participant_id])>0.005),customShares:Object.fromEntries(doc.shares.map((s:any)=>[s.participant_id,s.amount_myr])),due_dates:doc.due_dates.map((due:any)=>({...due,amount_myr:due.amount_myr??undefined,note:due.note||''}))};
    }
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
  }, [doc, parsed, matches]);

  useEffect(() => { if (parsed) setCreateExp(!!doc?.expense || parsed.suggestExpense !== false); }, [doc, parsed]);

  if (error && !doc) return <Empty icon="file" title={error} sub={ms ? 'Cuba lagi atau kembali ke dokumen.' : 'Try again or return to the document library.'} action={{label:ms?'Cuba lagi':'Retry',onClick:()=>void load()}} />;
  if (!doc) return <Loading label={t.loading} />;

  const confirm = async (expensePayload?: any) => {
    setBusy(true);
    setSaved(false);
    setError('');
    try {
      await api.post(`/documents/${docId}/confirm`, {
        expense: expensePayload,
        vendor: parsed.vendor, docType: parsed.docType, bookingNo: bookingNo ?? parsed.bookingNo,
      });
      toast(expensePayload ? t.tExpenseSaved : t.tSaved);
      setSaved(true);
      await load();
    } catch { setError(ms ? 'Gagal menyimpan. Semak butiran dan cuba lagi.' : 'Could not save. Check the details and try again.'); } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="row-between"><h2>{t.reviewTitle}</h2><Link className="btn secondary sm" to={`/trips/${tripId}/documents`}>{ms?'Kembali ke dokumen':'Back to documents'}</Link></div>
      {busy && <Loading compact label={ms ? "Menyimpan…" : "Saving your review…"} />}
      {saved && <p className="callout info" role="status">{ms?'Disimpan. Anda boleh terus menyemak atau mengubah peserta.':'Saved. You can keep reviewing or amend the participants here.'}</p>}
      {error && <p className="callout warn" role="alert">{error}</p>}
      {duplicate && <p className="callout warn"><Icon name="alert" size={16} /> {t.duplicateWarn}</p>}
      {(parsed.warnings ?? []).map((w: string, i: number) => (
        <p className="callout info" key={i}>ℹ️ {w}</p>
      ))}

      <div className="grid grid-2">
        {/* v0.27: column stack gets .grid so consecutive cards don't touch */}
        <div className="grid">
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
                  <tr><td className="muted">{t.paymentStatusLbl}</td><td><span className="badge warning"><Icon name="hotel" size={16} /> {t.payAtHotel}</span></td></tr>
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
                      ? <span className="badge success">{m.participant.name} ✓</span>
                      : <span className="badge warning">{t.notMatched}</span>}
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        <div className="card">
          {parsed.keywords && (() => {
            const kw = parsed.keywords;
            const group = (label: React.ReactNode, key: string, chips: React.ReactNode[]) => chips.length ? (
              <div className="kw-group" key={key}>
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
                {group(<><Icon name="calendar" size={16} /> {t.kwDates}</>, 'dates', kw.dates.slice(0, 8).map(dateChip))}
                {group(<><Icon name="coins" size={16} /> {t.kwAmounts}</>, 'amounts', kw.amounts.slice(0, 8).map((a: any, i: number) => (
                  <span key={i} className="chip" title={a.context}
                    onClick={() => push({ amount_original: a.value, currency: a.currency, ...(a.currency === 'MYR' ? { fx_rate: 1, amount_myr: a.value } : {}) })}>
                    {a.currency} {a.value.toLocaleString()}
                  </span>
                )))}
                {group(<><Icon name="ticket" size={16} /> {t.kwRefs}</>, 'refs', kw.refs.slice(0, 5).map((r: any, i: number) => (
                  <span key={i} className={`chip ${(bookingNo ?? parsed.bookingNo) === r.value ? 'on' : ''}`}
                    title={r.context} onClick={() => setBookingNo(r.value)}>{r.value}</span>
                )))}
                {group(<><Icon name="plane" size={16} /> {t.kwFlights}</>, 'flights', kw.flights.slice(0, 6).map((f: any, i: number) => (
                  <span key={i} className="chip" title={f.context}
                    onClick={() => push((prev: ExpenseDraft) => ({ description: prev.description ? `${prev.description} ${f.raw}` : f.raw }))}>
                    {f.flightNo ?? `${f.from}→${f.to}`}
                  </span>
                )))}
                {group(<><Icon name="user" size={16} /> {t.kwNames}</>, 'names', kw.names.slice(0, 8).map(nameChip))}
                {group(<><Icon name="bag" size={16} /> {t.kwVendor}</>, 'vendor', kw.vendors.slice(0, 4).map((v: any, i: number) => (
                  <span key={i} className="chip" title={v.context} onClick={() => push({ vendor: v.raw })}>{v.raw}</span>
                )))}
                {group(<><Icon name="wallet" size={16} /> {t.kwPayment}</>, 'payment', kw.payments.slice(0, 4).map((p2: any, i: number) => (
                  <span key={i} className="chip" title={p2.context}>{p2.raw}</span>
                )))}
              </div>
            );
          })()}
          <label className="row" style={{ marginBottom: 12, gap: 8 }}>
            <input type="checkbox" checked={createExp} disabled={!!doc.expense} onChange={e => setCreateExp(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: 'var(--brand-700)' }} />
            <strong>{doc.expense ? (ms?'Kemas kini perbelanjaan terpaut':'Update linked expense') : t.createExpense}</strong>
          </label>
          {doc.expense?.split_json ? <p className="callout info">{ms?'Pembahagian bilik diurus dalam lejar.':'This expense uses room-based splitting. Edit its participants in the ledger to preserve that calculation.'} <Link to={`/trips/${tripId}/ledger`}>{ms?'Buka lejar':'Open ledger'}</Link></p> : createExp ? (
            // v0.25: rooms-split-at-confirm is deliberately unsupported here —
            // POST /documents/:id/confirm never calls resolveRoomsSplit, so a
            // `split` payload would 400 (or, if that guard ever slipped,
            // insert an accommodation expense with zero share rows). No
            // `tripId` is passed, so ExpenseForm never offers the "Split by
            // rooms" option on this screen; a leader who wants a rooms split
            // confirms normally, then edits the expense in Ledger afterwards.
            // Wiring the confirm route for splits is future work.
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
