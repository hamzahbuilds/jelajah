import { useEffect, useState } from 'react';
import { useOutletContext, useSearchParams } from 'react-router-dom';
import { api, fmtMYR, fmtDate } from '../api';
import { useT } from '../i18n';
import { useSession } from '../App';
import { TripCtx } from './TripShell';

export default function Payments() {
  const { t, lang } = useT();
  const { user } = useSession();
  const { tripId, members } = useOutletContext<TripCtx>();
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
    await load();
  };

  const removePayment = async (p: any) => {
    if (!window.confirm(t.confirmDelete)) return;
    await api.del(`/payments/${p.id}`);
    await load();
  };

  return (
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <div>
        <div className="card">
          <h3>{t.balances}</h3>
          {!bal && <p className="muted">{t.loading}</p>}
          {bal?.balances?.length === 0 && <p className="muted">{t.none}</p>}
          <div className={(bal?.balances?.length ?? 0) > 5 ? 'scroll-cap-lg' : ''}>
          {bal?.balances?.map((b: any) => (
            <div key={b.participant.id} style={{ borderBottom: '1px solid var(--line)', padding: '8px 0' }}>
              <div className="row-between">
                <strong>{b.participant.name}</strong>
                <span className={`badge ${b.outstanding > 0.004 ? 'warn' : 'ok'}`}>
                  {b.outstanding > 0.004 ? `${t.remaining}: ${fmtMYR(b.outstanding)}` : t.settled}
                </span>
              </div>
              <div className="tiny">{t.owed} {fmtMYR(b.owed)} · {t.paid} {fmtMYR(b.paid)}</div>
              {b.byPayee.map((bp: any) => (
                <div className="row-between" key={bp.to_participant_id} style={{ padding: '2px 0' }}>
                  <span className="tiny">{t.owes(b.participant.name, pname(bp.to_participant_id))}</span>
                  <span className="row" style={{ gap: 6 }}>
                    <span className="tiny">{fmtMYR(bp.remaining)} / {fmtMYR(bp.total)}</span>
                    {bp.credit > 0 && <span className="badge brand">{t.credit} {fmtMYR(bp.credit)}</span>}
                    <button className="btn btn-ghost btn-sm" onClick={() => setOpen({ b, bp })}>{t.statement}</button>
                  </span>
                </div>
              ))}
            </div>
          ))}
          </div>
        </div>
      </div>

      <div>
        {user.role === 'admin' && (
          <form className="card" onSubmit={record}>
            <h3>{t.recordPayment}</h3>
            <p className="tiny">{t.lumpsumHint}</p>
            <div className="form-grid">
              <label className="field"><span>{t.from}</span>
                <select required value={form.from_participant_id}
                  onChange={e => setForm({ ...form, from_participant_id: Number(e.target.value) })}>
                  <option value={0} disabled>—</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select></label>
              <label className="field"><span>{t.to}</span>
                <select required value={form.to_participant_id}
                  onChange={e => setForm({ ...form, to_participant_id: Number(e.target.value) })}>
                  <option value={0} disabled>—</option>
                  {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select></label>
              <label className="field"><span>{t.amountMyr}</span>
                <input type="number" step="0.01" min="0.01" required value={form.amount_myr}
                  onChange={e => setForm({ ...form, amount_myr: e.target.value })} /></label>
              <label className="field"><span>{t.date}</span>
                <input type="date" required value={form.pay_date}
                  onChange={e => setForm({ ...form, pay_date: e.target.value })} /></label>
              <label className="field full"><span>{t.note}</span>
                <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} /></label>
            </div>
            <button className="btn" disabled={!form.from_participant_id || !form.to_participant_id}>{t.save}</button>
          </form>
        )}

        <div className="card">
          <h3>{t.history}</h3>
          {payments.length === 0 && <p className="muted">{t.noPayments}</p>}
          {payments.map(p => (
            <div className="row-between" key={p.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
              <div>
                <div>{pname(p.from_participant_id)} → {pname(p.to_participant_id)}</div>
                <div className="tiny">{fmtDate(p.pay_date, lang)}{p.note ? ` · ${p.note}` : ''}</div>
              </div>
              <div className="row">
                <strong>{fmtMYR(p.amount_myr)}</strong>
                {user.role === 'admin' && <button className="icon" onClick={() => removePayment(p)}>🗑️</button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {open && (
        <div className="overlay" onClick={() => setOpen(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="row-between">
              <h2>{t.statement}: {open.b.participant.name} → {pname(open.bp.to_participant_id)}</h2>
              <button className="icon" onClick={() => setOpen(null)}>✕</button>
            </div>
            {user.role === 'admin' && open.bp.remaining > 0.004 && (
              <button className="btn btn-sm" style={{ marginBottom: 8 }}
                onClick={() => window.confirm(`${t.settleAll}: ${fmtMYR(open.bp.remaining)}?`) && settle(open.b, open.bp)}>
                ✅ {t.settleAll} · {fmtMYR(open.bp.remaining)}
              </button>
            )}
            <div className="tablewrap">
              <table>
                <thead>
                  <tr><th>{t.description}</th><th className="hide-sm">{t.date}</th><th className="num">{t.amount}</th><th className="num">{t.remaining}</th>{user.role === 'admin' && <th />}</tr>
                </thead>
                <tbody>
                  {open.bp.items.map((it: any, i: number) => (
                    <tr key={i} className={open.highlight === it.expense_id ? 'hl-row' : ''}>
                      <td>{it.description}<div className="tiny">{(t as any)[it.category]}</div></td>
                      <td className="hide-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDate(it.date, lang)}</td>
                      <td className="num">{fmtMYR(it.amount)}</td>
                      <td className="num">{it.remaining > 0.004
                        ? <strong>{fmtMYR(it.remaining)}</strong>
                        : <span className="badge ok">{t.paid}</span>}</td>
                      {user.role === 'admin' && (
                        <td>{it.remaining > 0.004 && (
                          <button className="btn btn-ghost btn-sm"
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
  );
}
