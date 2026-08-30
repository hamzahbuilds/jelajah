import { useEffect, useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { api, fmtMYR, fmtDate } from '../api';
import { useT, Dict } from '../i18n';
import { useSession } from '../App';
import { TripCtx } from './TripShell';

function countdown(t: Dict, start?: string | null, end?: string | null): { big: string; sub: string } {
  if (!start) return { big: '—', sub: '' };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const s = new Date(start + 'T00:00:00');
  const e = end ? new Date(end + 'T00:00:00') : s;
  const dayMs = 86400000;
  if (today < s) return { big: t.daysToGo(Math.round((s.getTime() - today.getTime()) / dayMs)), sub: fmtDate(start, 'en') };
  if (today <= e) return { big: t.dayN(Math.round((today.getTime() - s.getTime()) / dayMs) + 1), sub: t.today };
  return { big: t.daysSince(Math.round((today.getTime() - e.getTime()) / dayMs)), sub: '' };
}

export default function Dashboard() {
  const { t, lang } = useT();
  const { user } = useSession();
  const { trip, tripId } = useOutletContext<TripCtx>();
  const [bal, setBal] = useState<any>(null);
  const [dues, setDues] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [newTask, setNewTask] = useState('');

  const loadChecklist = async () => setItems(await api.get(`/trips/${tripId}/checklist`));
  useEffect(() => {
    // money widgets disappear gracefully when the admin hid payments/ledger from members
    api.get(`/trips/${tripId}/balances`).then(setBal).catch(() => setBal({ hidden: true }));
    api.get(`/trips/${tripId}/duedates`).then(setDues).catch(() => setDues([]));
    loadChecklist();
  }, [tripId]);

  const cd = countdown(t, trip.start_date, trip.end_date);
  const moneyHidden = !!bal?.hidden;
  const catTotals: Array<[string, number]> = bal && !moneyHidden
    ? Object.entries(bal.totalsByCategory as Record<string, number>).sort((a, b) => b[1] - a[1])
    : [];
  const maxCat = Math.max(1, ...catTotals.map(c => c[1]));
  const outstanding = bal?.balances
    ?.filter((b: any) => b.outstanding > 0.004)
    .sort((a: any, b: any) => b.outstanding - a.outstanding) ?? [];
  const mine = bal?.balances?.find((b: any) => b.participant.id === user.participant_id);
  const openDues = dues.filter(d => !d.settled);

  const addTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTask.trim()) return;
    await api.post(`/trips/${tripId}/checklist`, { text: newTask });
    setNewTask('');
    loadChecklist();
  };
  const toggle = async (it: any) => {
    await api.patch(`/checklist/${it.id}`, { done: !it.done });
    loadChecklist();
  };
  const remove = async (it: any) => {
    await api.del(`/checklist/${it.id}`);
    loadChecklist();
  };

  return (
    <div>
      <div className="hero">
        <div className="big">{cd.big}</div>
        <div className="sub">{trip.destination} · {fmtDate(trip.start_date, lang)} → {fmtDate(trip.end_date, lang)}</div>
      </div>

      <div className="stats">
        {!moneyHidden && (
        <div className="stat">
          <div className="label">{t.tripTotal}</div>
          <div className="value">{bal ? fmtMYR(bal.tripTotal) : '…'}</div>
          <div className="sub">{bal?.expenseCount ?? 0} {t.expenses}</div>
        </div>
        )}
        {moneyHidden ? null : user.role === 'admin' ? (
          <div className="stat">
            <div className="label">{t.outstanding}</div>
            <div className="value">{bal ? fmtMYR(outstanding.reduce((a: number, b: any) => a + b.outstanding, 0)) : '…'}</div>
          </div>
        ) : mine ? (
          <div className="stat">
            <div className="label">{t.myBalance}</div>
            <div className="value">{fmtMYR(mine.outstanding)}</div>
            <div className="sub">{t.owed} {fmtMYR(mine.owed)} · {t.paid} {fmtMYR(mine.paid)}</div>
          </div>
        ) : null}
        <div className="stat">
          <div className="label">{t.upcomingDues}</div>
          <div className="value">{openDues.length}</div>
        </div>
      </div>

      <div className="grid grid-2">
        {!moneyHidden && (
        <div className="card barlist">
          <h3>{t.byCategory}</h3>
          {catTotals.length === 0 && <p className="muted">{t.noExpenses}</p>}
          {catTotals.map(([cat, val]) => (
            <div className="barrow" key={cat}>
              <div className="name">{(t as any)[cat] ?? cat}</div>
              <div className="track"><div className="fill" style={{ width: `${(val / maxCat) * 100}%` }} /></div>
              <div className="val">{fmtMYR(val)}</div>
            </div>
          ))}
        </div>
        )}

        {moneyHidden ? null : user.role === 'admin' ? (
          <div className="card">
            <h3>{t.topOutstanding}</h3>
            {outstanding.length === 0 && <p className="muted">{t.allSettled}</p>}
            {outstanding.slice(0, 8).map((b: any) => (
              <div className="row-between" key={b.participant.id} style={{ padding: '5px 0' }}>
                <span>{b.participant.name}</span>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMYR(b.outstanding)}</strong>
              </div>
            ))}
            <Link to={`/trips/${tripId}/payments`} className="tiny">{t.payments} →</Link>
          </div>
        ) : (
          <div className="card">
            <h3>{t.myBalance}</h3>
            {!mine || mine.outstanding <= 0.004
              ? <p className="muted">{t.allSettled}</p>
              : mine.byPayee.map((bp: any) => (
                <div key={bp.to_participant_id} className="row-between" style={{ padding: '5px 0' }}>
                  <span className="muted">{t.remaining}</span>
                  <strong>{fmtMYR(bp.remaining)}</strong>
                </div>
              ))}
            <Link to={`/trips/${tripId}/payments`} className="tiny">{t.statement} →</Link>
          </div>
        )}

        <div className="card">
          <h3>{t.upcomingDues}</h3>
          {openDues.length === 0 && <p className="muted">{t.none}</p>}
          {openDues.map(d => (
            <div className="row-between" key={d.id} style={{ padding: '5px 0' }}>
              <div>
                <div>{d.description}</div>
                <div className="tiny">{fmtDate(d.due_date, lang)}{d.vendor ? ` · ${d.vendor}` : ''}</div>
              </div>
              <div className="row">
                {d.amount_myr ? <strong>{fmtMYR(d.amount_myr)}</strong> : null}
                {user.role === 'admin' && (
                  <button className="btn btn-ghost btn-sm" onClick={async () => {
                    await api.patch(`/duedates/${d.id}`, { settled: true });
                    setDues(await api.get(`/trips/${tripId}/duedates`));
                  }}>{t.markSettled}</button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <h3>{t.myChecklist}</h3>
          {items.length === 0 && <p className="muted">{t.noTasks}</p>}
          {items.map(it => (
            <div className={`check-item ${it.done ? 'done' : ''}`} key={it.id}>
              <input type="checkbox" checked={!!it.done} onChange={() => toggle(it)} />
              <span className="txt">{it.text}</span>
              <button className="icon" onClick={() => remove(it)} aria-label={t.delete}>✕</button>
            </div>
          ))}
          <form className="row" onSubmit={addTask} style={{ marginTop: 10 }}>
            <input value={newTask} onChange={e => setNewTask(e.target.value)} placeholder={t.addTask} style={{ flex: 1 }} />
            <button className="btn btn-sm" type="submit">{t.add}</button>
          </form>
        </div>
      </div>
    </div>
  );
}
