import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
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
  const [open, setOpen] = useState<any | null>(null); // statement drill-down
  const [form, setForm] = useState({ from_participant_id: 0, to_participant_id: 0, amount_myr: '', pay_date: new Date().toISOString().slice(0, 10), note: '' });

  const load = async () => {
    setBal(await api.get(`/trips/${tripId}/balances`));
    setPayments(await api.get(`/trips/${tripId}/payments`));
  };
  useEffect(() => { load(); }, [tripId]);

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
            <div className="tablewrap">
              <table>
                <thead>
                  <tr><th>{t.description}</th><th>{t.date}</th><th className="num">{t.amount}</th><th className="num">{t.remaining}</th></tr>
                </thead>
                <tbody>
                  {open.bp.items.map((it: any, i: number) => (
                    <tr key={i}>
                      <td>{it.description}<div className="tiny">{(t as any)[it.category]}</div></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(it.date, lang)}</td>
                      <td className="num">{fmtMYR(it.amount)}</td>
                      <td className="num">{it.remaining > 0.004
                        ? <strong>{fmtMYR(it.remaining)}</strong>
                        : <span className="badge ok">{t.paid}</span>}</td>
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
