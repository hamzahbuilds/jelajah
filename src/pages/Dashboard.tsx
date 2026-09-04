import { useEffect, useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { api, fmtMYR, fmtDate } from '../api';
import { useT, Dict } from '../i18n';
import { useSession } from '../App';
import { TripCtx } from './TripShell';
import LeafletMap, { Pin, Arc } from '../components/LeafletMap';
import FxWidget from '../components/FxWidget';
import { ymd } from '../../shared/days';
import { airportCoords } from '../../shared/airports';
import { haversine } from '../../shared/fares';

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
  const { trip, tripId, reload } = useOutletContext<TripCtx>();
  const [bal, setBal] = useState<any>(null);
  const [dues, setDues] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [newTask, setNewTask] = useState('');
  const [plan, setPlan] = useState<any>(null);
  const [mySpendTotal, setMySpendTotal] = useState<number | null>(null);
  const [chartBy, setChartBy] = useState<'category' | 'item'>('category');
  const [tipOpen, setTipOpen] = useState<string | null>(null); // tap-to-toggle on touch screens

  const loadChecklist = async () => setItems(await api.get(`/trips/${tripId}/checklist`));
  useEffect(() => {
    // money widgets disappear gracefully when the admin hid payments/ledger from members
    api.get(`/trips/${tripId}/balances`).then(setBal).catch(() => setBal({ hidden: true }));
    api.get(`/trips/${tripId}/duedates`).then(setDues).catch(() => setDues([]));
    api.get(`/trips/${tripId}/plan`).then(setPlan).catch(() => setPlan(null));
    api.get(`/trips/${tripId}/myspend`)
      .then((rows: any[]) => setMySpendTotal(rows.reduce((a, r) => a + r.amount_myr, 0)))
      .catch(() => setMySpendTotal(null));
    loadChecklist();
  }, [tripId]);

  // upcoming events: auto events (whole-group) + activities the viewer is part of (members) / all (admin)
  const upcoming = (() => {
    if (!plan) return [];
    const now = new Date();
    const all: Array<{ when: Date; time: string | null; title: string; icon: string }> = [];
    for (const e of plan.autoEvents ?? []) {
      // v0.12: members only see the flights/stays THEY are booked on
      if (user.role !== 'admin' && user.participant_id && e.participant_ids?.length > 0
        && !e.participant_ids.includes(user.participant_id)) continue;
      all.push({ when: new Date(`${e.day}T${e.time ?? '00:00'}:00`), time: e.time, title: e.title, icon: e.kind === 'flight' ? '✈️' : e.kind === 'checkin' ? '🔑' : '🧳' });
    }
    for (const a of plan.activities ?? []) {
      if (user.role !== 'admin' && user.participant_id && a.participant_ids.length > 0
        && !a.participant_ids.includes(user.participant_id)) continue;
      all.push({ when: new Date(`${a.day}T${a.start_time ?? '00:00'}:00`), time: a.start_time, title: a.title, icon: '📍' });
    }
    return all.filter(x => x.when.getTime() >= now.getTime() - 3600e3).sort((a, b) => a.when.getTime() - b.when.getTime());
  })();
  const daysUntil = (d: Date) => Math.max(0, Math.round((new Date(d.toDateString()).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000));

  // Journey overview: 🏨 stay pins + numbered 📍 activity pins + ✈️ dashed arcs between airports.
  const journey = (() => {
    if (!plan) return null;
    const pins: Pin[] = [];
    const seen = new Set<string>();
    for (const s of plan.stays ?? []) {
      if (s.lat == null || s.lng == null) continue;
      const k = `${s.lat.toFixed(4)},${s.lng.toFixed(4)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      pins.push({ lat: s.lat, lng: s.lng, icon: '🏨', label: s.description });
    }
    const stayCount = pins.length;
    let n = 0;
    for (const a of plan.activities ?? []) {
      if (a.lat == null || a.lng == null) continue;
      n++;
      pins.push({ lat: a.lat, lng: a.lng, icon: String(n), label: `${n}. ${a.title}` });
    }
    const arcs: Arc[] = [];
    for (const e of plan.autoEvents ?? []) {
      if (e.kind !== 'flight') continue;
      const [fromTxt, toTxt] = String(e.title).split('→').map((s: string) => s.replace(/\(.*?\)/g, '').trim());
      const from = airportCoords(fromTxt);
      const to = airportCoords(toTxt);
      if (from && to && (from.code !== to.code)) {
        arcs.push({ from: { lat: from.lat, lng: from.lng }, to: { lat: to.lat, lng: to.lng }, label: e.title });
      }
    }
    const km = Math.round(arcs.reduce((a, x) => a + haversine(x.from.lat, x.from.lng, x.to.lat, x.to.lng), 0) / 1000);
    if (!pins.length && !arcs.length) return null;
    return { pins, arcs, km, stays: stayCount, places: n, flights: arcs.length };
  })();

  const cd = countdown(t, trip.start_date, trip.end_date);
  // treat "not loaded yet" as hidden so members never see a flash of money widgets
  const moneyHidden = !bal || !!bal.hidden;
  const catTotals: Array<[string, number]> = bal && !moneyHidden
    ? Object.entries(bal.totalsByCategory as Record<string, number>).sort((a, b) => b[1] - a[1])
    : [];
  const maxCat = Math.max(1, ...catTotals.map(c => c[1]));
  const outstanding = bal?.balances
    ?.filter((b: any) => b.outstanding > 0.004)
    .sort((a: any, b: any) => b.outstanding - a.outstanding) ?? [];
  const mine = bal?.balances?.find((b: any) => b.participant.id === user.participant_id);
  // members see whole-payment dues + their own personal ones; admin sees all
  const openDues = dues.filter(d => !d.settled)
    .filter(d => user.role === 'admin' || d.participant_id == null || d.participant_id === user.participant_id);

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
          <div className="sub">
            {bal?.expenseCount ?? 0} {t.expenses}
            {bal?.committedTotal > 0 && <> · 🏨 {fmtMYR(bal.committedTotal)} {t.committed}</>}
          </div>
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
        {mySpendTotal != null && (
          <div className="stat">
            <div className="label">👤 {t.myspend}</div>
            <div className="value">{fmtMYR(mySpendTotal)}</div>
          </div>
        )}
        {!moneyHidden && (
        <div className="stat">
          <div className="label">{t.upcomingDues}</div>
          <div className="value">{openDues.length}</div>
        </div>
        )}
      </div>

      {journey && (
        <div className="card">
          <h3>🗺️ {t.journey}</h3>
          <LeafletMap pins={journey.pins} arcs={journey.arcs} height={300}
            accent={(trip as any).color || undefined} />
          <div className="journey-stats">
            {journey.flights > 0 && <span className="jstat">✈️ {journey.flights} {t.flights}</span>}
            {journey.stays > 0 && <span className="jstat">🏨 {journey.stays} {t.stays}</span>}
            {journey.places > 0 && <span className="jstat">📍 {journey.places} {t.places}</span>}
            {journey.km > 0 && <span className="jstat">🧭 {journey.km.toLocaleString()} km {t.totalDistance}</span>}
          </div>
        </div>
      )}

      <FxWidget tripId={tripId} trip={trip} isAdmin={user.role === 'admin'} onChanged={reload} />

      {upcoming.length > 0 ? (
        <div className="card" style={{ borderLeft: '4px solid var(--data)' }}>
          <h3>⏭️ {t.upNext}</h3>
          {upcoming.slice(0, user.role === 'admin' ? 3 : 1).map((u2, i) => (
            <div className="row-between" key={i} style={{ padding: '4px 0' }}>
              <span>{u2.icon} <strong>{u2.title}</strong></span>
              <span className="muted" style={{ whiteSpace: 'nowrap' }}>
                {fmtDate(ymd(u2.when), lang)}{u2.time ? ` · ${u2.time}` : ''} · {t.inDays(daysUntil(u2.when))}
              </span>
            </div>
          ))}
        </div>
      ) : plan ? (
        <div className="card"><h3>⏭️ {t.upNext}</h3><p className="muted">{t.nothingUpcoming}</p></div>
      ) : null}

      <div className="grid grid-2">
        {!moneyHidden && (
        <div className="card barlist">
          <div className="row-between">
            <h3>{t.byCategory}</h3>
            <span className="row" style={{ gap: 4 }}>
              <button className={`chip ${chartBy === 'category' ? 'on' : ''}`} onClick={() => setChartBy('category')}>{t.byCategoryLbl}</button>
              <button className={`chip ${chartBy === 'item' ? 'on' : ''}`} onClick={() => setChartBy('item')}>{t.byItemLbl}</button>
            </span>
          </div>
          {catTotals.length === 0 && <p className="muted">{t.noExpenses}</p>}
          {chartBy === 'category' ? catTotals.map(([cat, val]) => {
            const catItems = (bal?.expenseItems ?? []).filter((x: any) => x.category === cat)
              .sort((a: any, b: any) => b.amount_myr - a.amount_myr);
            return (
              <div className={`barrow tip-wrap ${tipOpen === cat ? 'open' : ''}`} key={cat}
                onClick={() => setTipOpen(tipOpen === cat ? null : cat)}>
                <div className="name">{(t as any)[cat] ?? cat}</div>
                <div className="track"><div className="fill" style={{ width: `${(val / maxCat) * 100}%` }} /></div>
                <div className="val">{fmtMYR(val)}</div>
                <div className="tip">
                  <div className="tip-head">{(t as any)[cat] ?? cat} · {t.breakdown}</div>
                  {catItems.slice(0, 6).map((x: any) => (
                    <div className="tip-row" key={x.id}><span>{x.description}</span><span className="amt">{fmtMYR(x.amount_myr)}</span></div>
                  ))}
                  {catItems.length > 6 && <div className="tiny">{t.moreItems(catItems.length - 6)}</div>}
                </div>
              </div>
            );
          }) : (
            <div className="scroll-cap-lg">
              {[...(bal?.expenseItems ?? [])].sort((a: any, b: any) => b.amount_myr - a.amount_myr).map((x: any) => {
                const maxItem = Math.max(1, ...(bal?.expenseItems ?? []).map((y: any) => y.amount_myr));
                return (
                  <div className="barrow" key={x.id} title={`${(t as any)[x.category] ?? x.category}${x.vendor ? ` · ${x.vendor}` : ''}`}>
                    <div className="name">{x.description}</div>
                    <div className="track"><div className="fill" style={{ width: `${(x.amount_myr / maxItem) * 100}%` }} /></div>
                    <div className="val">{fmtMYR(x.amount_myr)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}

        {moneyHidden ? null : user.role === 'admin' ? (
          <div className="card">
            <h3>{t.topOutstanding}</h3>
            {outstanding.length === 0 && <p className="muted">{t.allSettled}</p>}
            <div className="scroll-cap">
              {outstanding.map((b: any) => {
                const openItems = b.byPayee.flatMap((bp: any) => bp.items.filter((it: any) => it.remaining > 0.004));
                const key = `o${b.participant.id}`;
                return (
                  <div className={`row-between tip-wrap ${tipOpen === key ? 'open' : ''}`} key={key}
                    style={{ padding: '5px 0' }} onClick={() => setTipOpen(tipOpen === key ? null : key)}>
                    <span>{b.participant.name}</span>
                    <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMYR(b.outstanding)}</strong>
                    <div className="tip">
                      <div className="tip-head">{b.participant.name} · {t.breakdown}</div>
                      {openItems.slice(0, 6).map((it: any, i: number) => (
                        <div className="tip-row" key={i}><span>{it.description}</span><span className="amt">{fmtMYR(it.remaining)}</span></div>
                      ))}
                      {openItems.length > 6 && <div className="tiny">{t.moreItems(openItems.length - 6)}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
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
              <Link style={{ color: 'inherit', display: 'block' }}
                to={`/trips/${tripId}/payments?expense=${d.expense_id}${d.participant_id ? `&participant=${d.participant_id}` : ''}`}>
                <div>{d.description} {d.participant_id != null && <span className="badge">👤 {d.participant_name}</span>} <span className="tiny">→</span></div>
                <div className="tiny">{fmtDate(d.due_date, lang)}{d.vendor ? ` · ${d.vendor}` : ''}</div>
              </Link>
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
