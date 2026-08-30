import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api, fmtMYR, fmtDate } from '../api';
import { useT } from '../i18n';
import { useSession } from '../App';
import { TripCtx } from './TripShell';
import LeafletMap, { Pin } from '../components/LeafletMap';

const KIND_ICON: Record<string, string> = { flight: '✈️', checkin: '🔑', checkout: '🧳' };

interface PlanItem {
  key: string; day: string; time: string | null; end_time: string | null;
  title: string; subtitle?: string | null; auto: boolean; kind?: string;
  activity?: any;
}

function daysBetween(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  while (d <= e && out.length < 90) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

const emptyActivity = (day: string) => ({
  id: 0, title: '', day, start_time: '', end_time: '', notes: '',
  location_name: '', lat: null as number | null, lng: null as number | null,
  est_cost_myr: '' as string | number, participant_ids: [] as number[],
});

export default function Plan() {
  const { t, lang } = useT();
  const { user } = useSession();
  const { trip, tripId, members } = useOutletContext<TripCtx>();
  const [data, setData] = useState<any>(null);
  const [view, setView] = useState<'day' | 'week' | 'month'>('day');
  const [modal, setModal] = useState<any | null>(null);

  const days = useMemo(() => {
    const base = trip.start_date && trip.end_date ? daysBetween(trip.start_date, trip.end_date) : [];
    const extra = new Set<string>(base);
    for (const a of data?.activities ?? []) extra.add(a.day);
    for (const e of data?.autoEvents ?? []) extra.add(e.day);
    return [...extra].sort();
  }, [trip, data]);

  const today = new Date().toISOString().slice(0, 10);
  const [selDay, setSelDay] = useState('');
  useEffect(() => {
    if (!selDay && days.length) setSelDay(days.includes(today) ? today : days[0]);
  }, [days]);

  const load = async () => {
    try { setData(await api.get(`/trips/${tripId}/plan`)); } catch { setData({ hidden: true }); }
  };
  useEffect(() => { load(); }, [tripId]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, PlanItem[]>();
    const push = (i: PlanItem) => {
      if (!map.has(i.day)) map.set(i.day, []);
      map.get(i.day)!.push(i);
    };
    for (const e of data?.autoEvents ?? []) {
      push({ key: `auto-${e.kind}-${e.expense_id}-${e.day}-${e.time}`, day: e.day, time: e.time, end_time: e.end_time, title: e.title, subtitle: e.subtitle, auto: true, kind: e.kind });
    }
    for (const a of data?.activities ?? []) {
      push({ key: `act-${a.id}`, day: a.day, time: a.start_time, end_time: a.end_time, title: a.title, subtitle: a.location_name, auto: false, activity: a });
    }
    for (const list of map.values()) list.sort((x, y) => (x.time ?? '99') < (y.time ?? '99') ? -1 : 1);
    return map;
  }, [data]);

  if (!data) return <p className="muted" style={{ padding: 30 }}>{t.loading}</p>;
  if (data.hidden) return <div className="card muted">—</div>;

  const dayNo = (d: string) => days.indexOf(d) + 1;
  const items = itemsByDay.get(selDay) ?? [];
  const pins: Pin[] = items.filter(i => i.activity?.lat != null).map(i => ({ lat: i.activity.lat, lng: i.activity.lng, label: i.title }));

  const participantsLabel = (ids: number[]) =>
    ids.length === members.length ? t.everyone
      : ids.map(id => members.find(m => m.id === id)?.name.split(' ')[0]).filter(Boolean).join(', ');

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <div className="row seg">
          {(['day', 'week', 'month'] as const).map(v => (
            <button key={v} className={`btn btn-sm ${view === v ? '' : 'btn-ghost'}`} onClick={() => setView(v)}>
              {v === 'day' ? t.dayView : v === 'week' ? t.weekView : t.monthView}
            </button>
          ))}
        </div>
        {user.role === 'admin' && (
          <button className="btn" onClick={() => setModal(emptyActivity(selDay || days[0] || today))}>＋ {t.addActivity}</button>
        )}
      </div>

      {view === 'day' && (
        <>
          <div className="daychips">
            {days.map(d => (
              <button key={d} className={`daychip ${d === selDay ? 'on' : ''}`} onClick={() => setSelDay(d)}>
                <span className="dn">D{dayNo(d)}</span>
                <span className="dd">{new Date(d + 'T00:00:00').toLocaleDateString(lang === 'ms' ? 'ms-MY' : 'en-MY', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              </button>
            ))}
          </div>
          <div className="grid grid-2" style={{ alignItems: 'start' }}>
            <div className="card">
              <h3>{fmtDate(selDay, lang)} {selDay === today && <span className="badge brand">{t.today}</span>}</h3>
              {items.length === 0 && <p className="muted">{t.noEvents}</p>}
              {items.map(i => (
                <div className={`plan-item ${i.activity?.done ? 'done' : ''}`} key={i.key}>
                  <div className="pi-time">{i.time ?? '—'}{i.end_time ? `–${i.end_time}` : ''}</div>
                  <div className="pi-ic">{i.auto ? KIND_ICON[i.kind ?? ''] ?? '•' : '📍'}</div>
                  <div className="pi-body">
                    <div className="pi-title">{i.title}</div>
                    {i.subtitle && <div className="tiny">{i.subtitle}</div>}
                    {i.activity && (
                      <div className="tiny">
                        {i.activity.participant_ids.length > 0 && <>👥 {participantsLabel(i.activity.participant_ids)} · </>}
                        {i.activity.est_cost_myr ? <>{fmtMYR(i.activity.est_cost_myr)} · </> : null}
                        {i.activity.notes ?? ''}
                      </div>
                    )}
                    {i.activity?.lat != null && (
                      <a className="tiny" target="_blank" rel="noreferrer"
                        href={`https://www.google.com/maps/dir/?api=1&destination=${i.activity.lat},${i.activity.lng}&travelmode=transit`}>
                        🗺️ {t.directions}
                      </a>
                    )}
                  </div>
                  {user.role === 'admin' && i.activity && (
                    <div className="row" style={{ gap: 2 }}>
                      <input type="checkbox" checked={!!i.activity.done} title={t.doneLabel}
                        onChange={async e => { await api.patch(`/activities/${i.activity.id}`, { done: e.target.checked }); load(); }} />
                      <button className="icon" onClick={() => setModal({ ...i.activity, est_cost_myr: i.activity.est_cost_myr ?? '' })}>✏️</button>
                      <button className="icon" onClick={async () => { if (window.confirm(t.confirmDelete)) { await api.del(`/activities/${i.activity.id}`); load(); } }}>🗑️</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="card">
              <LeafletMap pins={pins} line height={340} />
              <p className="tiny" style={{ marginTop: 6 }}>{pins.length} 📍</p>
            </div>
          </div>
        </>
      )}

      {view === 'week' && (
        <div className="weekgrid">
          {days.map(d => (
            <div key={d} className={`weekcell ${d === selDay ? 'on' : ''}`} onClick={() => { setSelDay(d); setView('day'); }}>
              <div className="wc-head">D{dayNo(d)} · {new Date(d + 'T00:00:00').toLocaleDateString(lang === 'ms' ? 'ms-MY' : 'en-MY', { weekday: 'short', day: 'numeric' })}</div>
              {(itemsByDay.get(d) ?? []).slice(0, 4).map(i => (
                <div key={i.key} className="wc-item">{i.time ? `${i.time} ` : ''}{i.auto ? KIND_ICON[i.kind ?? ''] : '📍'} {i.title}</div>
              ))}
              {(itemsByDay.get(d) ?? []).length > 4 && <div className="tiny">+{(itemsByDay.get(d) ?? []).length - 4}</div>}
              {(itemsByDay.get(d) ?? []).length === 0 && <div className="tiny">—</div>}
            </div>
          ))}
        </div>
      )}

      {view === 'month' && <MonthView days={days} selDay={selDay} itemsByDay={itemsByDay}
        onPick={d => { setSelDay(d); setView('day'); }} />}

      {modal && (
        <ActivityModal
          draft={modal} members={members} groups={data.groups ?? []} tripId={tripId}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}

function MonthView({ days, selDay, itemsByDay, onPick }: {
  days: string[]; selDay: string; itemsByDay: Map<string, PlanItem[]>; onPick: (d: string) => void;
}) {
  const { lang } = useT();
  const anchor = selDay || days[0];
  const [month, setMonth] = useState(anchor?.slice(0, 7) ?? new Date().toISOString().slice(0, 7));
  const first = new Date(month + '-01T00:00:00');
  const startDow = (first.getDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells: Array<string | null> = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`),
  ];
  const shift = (n: number) => {
    const d = new Date(first);
    d.setMonth(d.getMonth() + n);
    setMonth(d.toISOString().slice(0, 7));
  };
  const inTrip = new Set(days);
  return (
    <div className="card">
      <div className="row-between" style={{ marginBottom: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => shift(-1)}>←</button>
        <strong>{first.toLocaleDateString(lang === 'ms' ? 'ms-MY' : 'en-MY', { month: 'long', year: 'numeric' })}</strong>
        <button className="btn btn-ghost btn-sm" onClick={() => shift(1)}>→</button>
      </div>
      <div className="cal-grid">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <div key={i} className="cal-dow">{d}</div>)}
        {cells.map((d, i) => (
          <div key={i}
            className={`cal-cell ${d && inTrip.has(d) ? 'trip' : ''} ${d === selDay ? 'on' : ''} ${d && (itemsByDay.get(d)?.length ?? 0) > 0 ? 'has-items' : ''}`}
            onClick={() => d && onPick(d)}>
            {d && <>
              <div className="cal-num">{Number(d.slice(8))}</div>
              {(itemsByDay.get(d) ?? []).slice(0, 2).map(it => (
                <div key={it.key} className="cal-item">{it.auto ? KIND_ICON[it.kind ?? ''] : '📍'} {it.title}</div>
              ))}
              {(itemsByDay.get(d) ?? []).length > 2 && <div className="tiny">+{(itemsByDay.get(d) ?? []).length - 2}</div>}
            </>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityModal({ draft, members, groups, tripId, onClose, onSaved }: {
  draft: any; members: any[]; groups: any[]; tripId: number;
  onClose: () => void; onSaved: () => void;
}) {
  const { t } = useT();
  const [d, setD] = useState({ ...draft });
  const [results, setResults] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (p: any) => setD((prev: any) => ({ ...prev, ...p }));

  const search = async () => {
    if (!q.trim()) return;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`);
      setResults(await res.json());
    } catch { setResults([]); }
  };

  const toggle = (id: number) => {
    const on = d.participant_ids.includes(id);
    set({ participant_ids: on ? d.participant_ids.filter((x: number) => x !== id) : [...d.participant_ids, id] });
  };

  const saveGroup = async () => {
    const name = window.prompt(t.groupName);
    if (!name || !d.participant_ids.length) return;
    await api.post(`/trips/${tripId}/groups`, { name, member_ids: d.participant_ids });
    onSaved();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const payload = {
      title: d.title, day: d.day, start_time: d.start_time || null, end_time: d.end_time || null,
      notes: d.notes || null, location_name: d.location_name || null, lat: d.lat, lng: d.lng,
      est_cost_myr: d.est_cost_myr === '' ? null : Number(d.est_cost_myr),
      participant_ids: d.participant_ids,
    };
    try {
      if (d.id) await api.put(`/activities/${d.id}`, payload);
      else await api.post(`/trips/${tripId}/activities`, payload);
      onSaved();
    } finally { setBusy(false); }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <form className="modal" onClick={e => e.stopPropagation()} onSubmit={submit}>
        <div className="row-between">
          <h2>{d.id ? t.editActivity : t.addActivity}</h2>
          <button type="button" className="icon" onClick={onClose}>✕</button>
        </div>
        <div className="form-grid">
          <label className="field full"><span>{t.activityTitle}</span>
            <input value={d.title} onChange={e => set({ title: e.target.value })} required /></label>
          <label className="field"><span>{t.date}</span>
            <input type="date" value={d.day} onChange={e => set({ day: e.target.value })} required /></label>
          <label className="field"><span>{t.timeLabel} / {t.endTimeLabel}</span>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input type="time" value={d.start_time ?? ''} onChange={e => set({ start_time: e.target.value })} />
              <input type="time" value={d.end_time ?? ''} onChange={e => set({ end_time: e.target.value })} />
            </div></label>
          <label className="field"><span>{t.estCost}</span>
            <input type="number" step="0.01" min="0" value={d.est_cost_myr ?? ''} onChange={e => set({ est_cost_myr: e.target.value })} /></label>
          <label className="field"><span>{t.notes}</span>
            <input value={d.notes ?? ''} onChange={e => set({ notes: e.target.value })} /></label>
        </div>

        <div style={{ margin: '4px 0 12px' }}>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t.searchPlace}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search(); } }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={search}>{t.searchBtn}</button>
          </div>
          {results.map((r, i) => (
            <div key={i} className="search-result" onClick={() => {
              set({ location_name: r.display_name.split(',').slice(0, 2).join(','), lat: Number(r.lat), lng: Number(r.lon) });
              setResults([]);
            }}>📍 {r.display_name}</div>
          ))}
          {d.location_name && <p className="tiny" style={{ margin: '6px 0' }}>📍 {d.location_name}</p>}
          <div style={{ marginTop: 8 }}>
            <LeafletMap pins={[]} picked={d.lat != null ? { lat: d.lat, lng: d.lng } : null}
              onPick={(lat, lng) => set({ lat, lng, location_name: d.location_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}` })}
              height={200} />
            <p className="tiny">{t.mapHint}</p>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <div className="row-between">
            <span style={{ fontWeight: 600, fontSize: '.85rem', color: 'var(--ink-2)' }}>{t.participants}</span>
            <span className="row">
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={() => set({ participant_ids: members.map((m: any) => m.id) })}>{t.everyone}</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ participant_ids: [] })}>{t.clearAll}</button>
            </span>
          </div>
          {groups.length > 0 && (
            <div className="row" style={{ margin: '6px 0' }}>
              <span className="tiny">{t.groupsLabel}:</span>
              {groups.map((g: any) => (
                <button type="button" key={g.id} className="chip"
                  onClick={() => set({ participant_ids: [...new Set([...d.participant_ids, ...g.member_ids])] })}>
                  👥 {g.name}
                </button>
              ))}
            </div>
          )}
          <div className="chips" style={{ marginTop: 6 }}>
            {members.map((m: any) => (
              <span key={m.id} className={`chip ${d.participant_ids.includes(m.id) ? 'on' : ''}`} onClick={() => toggle(m.id)}>
                {m.name}{m.is_infant ? ' 👶' : ''}
              </span>
            ))}
          </div>
          {d.participant_ids.length > 1 && (
            <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={saveGroup}>
              💾 {t.saveGroup}
            </button>
          )}
        </div>

        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t.cancel}</button>
          <button className="btn" disabled={busy}>{t.save}</button>
        </div>
      </form>
    </div>
  );
}
