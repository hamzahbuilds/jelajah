import { useEffect, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { api, fmtMYR, fmtDate } from '../api';
import { useT } from '../i18n';
import { TripCtx } from './TripShell';
import { useToast } from '../components/Toast';
import MoneyTabs from '../components/MoneyTabs';
import PageHead from '../components/PageHead';
import Empty from '../components/Empty';
import { Icon } from '../components/Icon';

// initials for the `.avatar` chip — mirrors the People.tsx helper.
const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

export default function Payments() {
  const { t, lang } = useT();
  const { toast } = useToast();
  const { trip, tripId, members, canLead } = useOutletContext<TripCtx>();
  const [bal, setBal] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [open, setOpen] = useState<any | null>(null); // statement drill-down {b, bp, highlight?}
  const [form, setForm] = useState({ from_participant_id: 0, to_participant_id: 0, amount_myr: '', pay_date: new Date().toISOString().slice(0, 10), note: '' });
  const [params, setParams] = useSearchParams();

  const load = async () => {
    const b2 = await api.get(`/trips/${tripId}/balances`);
    setBal(b2);
    setPayments(await api.get(`/trips/${tripId}/payments`));
    return b2;
  };
  useEffect(() => { load(); }, [tripId]);

  // deep link from a due date: /payments?expense=<id>[&participant=<pid>] → open the matching statement
  useEffect(() => {
    const eid = Number(params.get('expense'));
    if (!eid || !bal?.balances) return;
    const pid = Number(params.get('participant')) || null;
    for (const b of bal.balances) {
      if (pid && b.participant.id !== pid) continue;
      for (const bp of b.byPayee) {
        if (bp.items.some((it: any) => it.expense_id === eid)) {
          setOpen({ b, bp, highlight: eid });
          setParams({}, { replace: true });
          return;
        }
      }
    }
  }, [bal]);

  /** Record a settlement from the statement: one item (targeted) or everything remaining. */
  const settle = async (b: any, bp: any, item?: any) => {
    const amount = item ? item.remaining : bp.remaining;
    if (!(amount > 0)) return;
    await api.post(`/trips/${tripId}/payments`, {
      from_participant_id: b.participant.id, to_participant_id: bp.to_participant_id,
      amount_myr: amount, pay_date: new Date().toISOString().slice(0, 10),
      note: item ? item.description : t.settleAll, expense_id: item?.expense_id ?? null,
    });
    toast(t.tSettled);
    const fresh = await load();
    const nb = fresh.balances.find((x: any) => x.participant.id === b.participant.id);
    const nbp = nb?.byPayee.find((x: any) => x.to_participant_id === bp.to_participant_id);
    setOpen(nb && nbp ? { b: nb, bp: nbp, highlight: item?.expense_id } : null);
  };

  const pname = (id: number) => members.find(m => m.id === id)?.name ?? '?';

  const record = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post(`/trips/${tripId}/payments`, { ...form, amount_myr: Number(form.amount_myr) });
    setForm({ ...form, amount_myr: '', note: '' });
    toast(t.tPaymentRecorded);
    await load();
  };

  const removePayment = async (p: any) => {
    if (!window.confirm(t.confirmDelete)) return;
    await api.del(`/payments/${p.id}`);
    await load();
  };

  return (
    <div>
      <PageHead crumb={trip.name} title={t.money} sub={t.moneySub} />
      <MoneyTabs />
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
      {/* v0.27: column stacks get .grid so consecutive cards don't touch */}
      <div className="grid">
        <div className="card">
          <div className="cardhead"><h3>{t.balances}</h3></div>
          {!bal && <p className="muted">{t.loading}</p>}
          {bal?.balances?.length === 0 && <Empty icon="check" title={t.allSquare} sub={t.allSquareSub} />}
          <div className={(bal?.balances?.length ?? 0) > 5 ? 'scroll-cap-lg' : ''}>
          {bal?.balances?.map((b: any) => (
            <div key={b.participant.id} className="lrow" style={{ flexWrap: 'wrap' }}>
              <span className="avatar">{initials(b.participant.name)}</span>
              <div className="l-main">
                <b>{b.participant.name}</b>
                <small>{t.owed} {fmtMYR(b.owed)} · {t.paid} {fmtMYR(b.paid)}</small>
              </div>
              <div className="l-end">
                {b.outstanding > 0.004
                  ? <span className="badge warning"><span className="d" />{t.remaining}: {fmtMYR(b.outstanding)}</span>
                  : <span className="badge success"><span className="d" />{t.settledLbl}</span>}
              </div>
              {b.byPayee.length > 0 && (
                <div style={{ flexBasis: '100%', marginLeft: 44 }}>
                  {b.byPayee.map((bp: any) => (
                    <div className="row-between" key={bp.to_participant_id} style={{ padding: '4px 0' }}>
                      <span className="tiny">
                        {t.owes(b.participant.name, pname(bp.to_participant_id))} · {fmtMYR(bp.remaining)} / {fmtMYR(bp.total)}
                        {bp.credit > 0 && <> · {t.credit} {fmtMYR(bp.credit)}</>}
                      </span>
                      <button type="button" className="btn ghost sm" onClick={() => setOpen({ b, bp })}>{t.statement}</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
          </div>
        </div>
      </div>

      <div className="grid">
        {canLead && (
          <form className="card" onSubmit={record}>
            <h3>{t.recordPayment}</h3>
            <p className="tiny">{t.lumpsumHint}</p>
            <div className="form-grid">
              <label className="fld"><span>{t.from}</span>
                <select required value={form.from_participant_id}
                  onChange={e => setForm({ ...form, from_participant_id: Number(e.target.value) })}>
                  <option value={0} disabled>—</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select></label>
              <label className="fld"><span>{t.to}</span>
                <select required value={form.to_participant_id}
                  onChange={e => setForm({ ...form, to_participant_id: Number(e.target.value) })}>
                  <option value={0} disabled>—</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select></label>
              <label className="fld"><span>{t.amountMyr}</span>
                <input type="number" step="0.01" min="0.01" required value={form.amount_myr}
                  onChange={e => setForm({ ...form, amount_myr: e.target.value })} /></label>
              <label className="fld"><span>{t.date}</span>
                <input type="date" required value={form.pay_date}
                  onChange={e => setForm({ ...form, pay_date: e.target.value })} /></label>
              <label className="fld full"><span>{t.note}</span>
                <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
            </div>
            <button className="btn" disabled={!form.from_participant_id || !form.to_participant_id}>{t.save}</button>
          </form>
        )}

        <div className="card">
          <div className="cardhead"><h3>{t.history}</h3></div>
          {payments.length === 0 && <p className="muted">{t.noPayments}</p>}
          {payments.map(p => (
            <div className="lrow" key={p.id}>
              <div className="l-main">
                <b>{pname(p.from_participant_id)} → {pname(p.to_participant_id)}</b>
                <small>{fmtDate(p.pay_date, lang)}{p.note ? ` · ${p.note}` : ''}</small>
              </div>
              <div className="l-amt">{fmtMYR(p.amount_myr)}</div>
              {canLead && (
                <div className="l-end">
                  <button type="button" className="btn ghost sm" aria-label={t.delete} onClick={() => removePayment(p)}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {open && (
        <div className="overlay" onClick={() => setOpen(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="row-between">
              <h2>{t.statement}: {open.b.participant.name} → {pname(open.bp.to_participant_id)}</h2>
              <button className="icon" onClick={() => setOpen(null)} aria-label={t.close}><Icon name="plus" className="x-close" size={20} /></button>
            </div>
            {canLead && open.bp.remaining > 0.004 && (
              <button type="button" className="btn sm" style={{ marginBottom: 8 }}
                onClick={() => window.confirm(`${t.settleAll}: ${fmtMYR(open.bp.remaining)}?`) && settle(open.b, open.bp)}>
                <Icon name="check" size={16} /> {t.settleAll} · {fmtMYR(open.bp.remaining)}
              </button>
            )}
            <div className="tablewrap">
              <table>
                <thead>
                  <tr><th>{t.description}</th><th className="hide-sm">{t.date}</th><th className="num">{t.amount}</th><th className="num">{t.remaining}</th>{canLead && <th />}</tr>
                </thead>
                <tbody>
                  {open.bp.items.map((it: any, i: number) => (
                    <tr key={i} className={open.highlight === it.expense_id ? 'hl-row' : ''}>
                      <td>{it.description}<div className="tiny">{(t as any)[it.category]}</div></td>
                      <td className="hide-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDate(it.date, lang)}</td>
                      <td className="num">{fmtMYR(it.amount)}</td>
                      <td className="num">{it.remaining > 0.004
                        ? <strong>{fmtMYR(it.remaining)}</strong>
                        : <span className="badge success">{t.paid}</span>}</td>
                      {canLead && (
                        <td>{it.remaining > 0.004 && (
                          <button type="button" className="btn ghost sm"
                            onClick={() => window.confirm(`${t.settleItem} "${it.description}": ${fmtMYR(it.remaining)}?`) && settle(open.b, open.bp, it)}>
                            {t.settleItem}
                          </button>
                        )}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
