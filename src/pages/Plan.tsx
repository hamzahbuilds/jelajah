import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api, fmtMYR, fmtDate } from '../api';
import { useT } from '../i18n';
import { useSession } from '../App';
import { TripCtx } from './TripShell';
import LeafletMap, { Pin } from '../components/LeafletMap';
import { estimates, haversine, MODE_ICON, Mode } from '../../shared/fares';
import { toCsv, parseCsv, PLAN_COLUMNS, PLAN_EXAMPLE_ROW } from '../../shared/csv';

const normName = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '');

function downloadCsv(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const KIND_ICON: Record<string, string> = { flight: '✈️', checkin: '🔑', checkout: '🧳' };

interface ChainPt { ref: string; name: string; lat: number; lng: number }
export interface Leg {
  key: string; from: ChainPt; to: ChainPt; distM: number;
  chosen: Mode; fareJpy: number; minutes: number; overridden: boolean;
}

function buildLegs(chain: ChainPt[], overrides: any[], day: string): Leg[] {
  const ovMap = new Map<string, any>(overrides.filter(o => o.day === day).map(o => [o.leg_key, o]));
  const legs: Leg[] = [];
  for (let i = 1; i < chain.length; i++) {
    const from = chain[i - 1], to = chain[i];
    const key = `${from.ref}->${to.ref}`;
    const distM = haversine(from.lat, from.lng, to.lat, to.lng);
    const ests = estimates(distM);
    const ov = ovMap.get(key);
    const chosen: Mode = (ov?.mode as Mode) ?? ests.find(e => e.recommended)!.mode;
    const est = ests.find(e => e.mode === chosen) ?? ests[0];
    legs.push({
      key, from, to, distM, chosen,
      fareJpy: ov?.fare_jpy ?? est.fareJpy, minutes: est.minutes,
      overridden: !!ov,
    });
  }
  return legs;
}

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
  const [seModal, setSeModal] = useState<'start' | 'end' | null>(null);
  const [jpyRate, setJpyRate] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ rows: any[]; badRows: Array<{ row: number; error: string }> } | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  useEffect(() => {
    api.get(`/fx?date=${new Date().toISOString().slice(0, 10)}&from=JPY&to=MYR`)
      .then(r => setJpyRate(r.rate)).catch(() => setJpyRate(null));
  }, []);

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

  // ---- day chain: start → located activities → end ----
  const stays: any[] = data.stays ?? [];
  const dsList: any[] = data.daySettings ?? [];
  const ds = dsList.find((x: any) => x.day === selDay) ?? dsList.find((x: any) => x.day === '*');
  const stayMorning = stays.find(s => s.checkin < selDay && selDay <= (s.checkout ?? '9999'));
  const stayNight = stays.find(s => s.checkin <= selDay && selDay < (s.checkout ?? '9999'));
  const startPt: ChainPt | null = ds?.start_lat != null
    ? { ref: 'start', name: ds.start_name ?? '', lat: ds.start_lat, lng: ds.start_lng }
    : stayMorning?.lat != null
      ? { ref: 'start', name: `🏨 ${stayMorning.description}`, lat: stayMorning.lat, lng: stayMorning.lng }
      : null;
  const endPt: ChainPt | null = ds?.end_lat != null
    ? { ref: 'end', name: ds.end_name ?? '', lat: ds.end_lat, lng: ds.end_lng }
    : stayNight?.lat != null
      ? { ref: 'end', name: `🏨 ${stayNight.description}`, lat: stayNight.lat, lng: stayNight.lng }
      : null;
  const locatedActs: ChainPt[] = items
    .filter(i => i.activity?.lat != null)
    .map(i => ({ ref: `act:${i.activity.id}`, name: i.title, lat: i.activity.lat, lng: i.activity.lng }));
  const chain: ChainPt[] = [
    ...(startPt ? [startPt] : []),
    ...locatedActs,
    ...(endPt && !(locatedActs.length === 0 && startPt && endPt.lat === startPt.lat && endPt.lng === startPt.lng) ? [endPt] : []),
  ];
  const legs = buildLegs(chain, data.legOverrides ?? [], selDay);
  const unpinnedStay = user.role === 'admin' ? stays.find(s => s.lat == null) : null;

  const setLegOverride = async (leg: Leg, mode: Mode | null, fareJpy?: number) => {
    await api.put(`/trips/${tripId}/legs`, { day: selDay, leg_key: leg.key, mode, fare_jpy: fareJpy ?? null });
    load();
  };
  const logFare = async (leg: Leg, target: 'shared' | 'private') => {
    const raw = window.prompt(t.fareJpyPrompt, String(leg.fareJpy || ''));
    if (!raw) return;
    const jpy = Number(raw);
    if (!(jpy > 0)) return;
    const rate = jpyRate ?? 0.03;
    const desc = `${leg.from.name} → ${leg.to.name}`.replace(/🏨 /g, '');
    if (target === 'private') {
      await api.post(`/trips/${tripId}/myspend`, {
        spend_date: selDay, category: 'transport', description: desc,
        amount_original: jpy, currency: 'JPY', fx_rate: rate,
        amount_myr: Math.round(jpy * rate * 100) / 100,
      });
    } else {
      if (!user.participant_id) { window.alert(t.linkParticipantFirst); return; }
      const ids = members.map(m => m.id);
      const myr = Math.round(jpy * rate * 100) / 100;
      const cents = Math.round(myr * 100);
      const base = Math.floor(cents / ids.length);
      let rem = cents - base * ids.length;
      await api.post(`/trips/${tripId}/expenses`, {
        category: 'transport', description: desc, expense_date: selDay, payment_date: selDay,
        amount_original: jpy, currency: 'JPY', fx_rate: rate, amount_myr: myr,
        payer_participant_id: user.participant_id,
        shares: ids.map(id => { const a = (base + (rem > 0 ? 1 : 0)) / 100; if (rem > 0) rem--; return { participant_id: id, amount_myr: a }; }),
      });
    }
    window.alert('✓');
  };

  const pins: Pin[] = chain.map(p => ({ lat: p.lat, lng: p.lng, label: p.name }));

  // ---- CSV template export / import ----
  const exportCsv = () => {
    const acts = [...(data.activities ?? [])].sort((a: any, b: any) =>
      a.day === b.day ? (a.start_time ?? '99').localeCompare(b.start_time ?? '99') : a.day.localeCompare(b.day));
    const rows: any[][] = [[...PLAN_COLUMNS]];
    for (const a of acts) {
      const pcell = a.participant_ids.length === 0 ? ''
        : a.participant_ids.length === members.length ? 'ALL'
          : a.participant_ids.map((id2: number) => members.find(m => m.id === id2)?.name).filter(Boolean).join('; ');
      rows.push([a.id, a.day, a.start_time, a.end_time, a.title, a.notes,
        a.location_name, a.lat, a.lng, a.est_cost_myr, pcell, a.done ? 'x' : '']);
    }
    downloadCsv(`${trip.name.replace(/\W+/g, '-')}-plan.csv`, toCsv(rows));
  };
  const blankTemplate = () => downloadCsv('plan-template.csv', toCsv([[...PLAN_COLUMNS], PLAN_EXAMPLE_ROW]));

  const onImportFile = async (file: File | null) => {
    if (!file) return;
    const grid = parseCsv(await file.text());
    if (!grid.length) return;
    const header = grid[0].map(h => h.trim().replace(/^﻿/, '').toLowerCase());
    const col = (name: string) => header.indexOf(name);
    const badRows: Array<{ row: number; error: string }> = [];
    if (col('title') < 0 || col('day') < 0) {
      setPreview({ rows: [], badRows: [{ row: 0, error: 'missing "title"/"day" columns — use the exported template' }] });
      return;
    }
    const rows: any[] = [];
    grid.slice(1).forEach((g, idx) => {
      const get = (n: string) => { const i2 = col(n); return i2 >= 0 ? (g[i2] ?? '').trim() : ''; };
      const day = get('day'), title = get('title');
      if (!title && !day) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !title) {
        badRows.push({ row: idx + 2, error: `invalid day/title (${day || '—'} / ${title || '—'})` });
        return;
      }
      let participant_ids: number[] = [];
      const pcell = get('participants');
      if (pcell.toUpperCase() === 'ALL') participant_ids = members.map(m => m.id);
      else if (pcell) {
        for (const nm of pcell.split(/[;|]/).map(s => s.trim()).filter(Boolean)) {
          const hit = members.find(m => {
            const a2 = normName(m.name), b2 = normName(nm);
            return a2 === b2 || a2.includes(b2) || b2.includes(a2);
          });
          if (hit) participant_ids.push(hit.id);
          else badRows.push({ row: idx + 2, error: `unknown participant "${nm}" (row still imported)` });
        }
      }
      rows.push({
        id: get('id') ? Number(get('id')) : undefined,
        day, title,
        start_time: get('start_time') || null, end_time: get('end_time') || null,
        notes: get('notes') || null, location_name: get('location_name') || null,
        lat: get('lat') ? Number(get('lat')) : null, lng: get('lng') ? Number(get('lng')) : null,
        est_cost_myr: get('est_cost_myr') ? Number(get('est_cost_myr')) : null,
        participant_ids: [...new Set(participant_ids)],
        done: !!get('done'),
      });
    });
    setPreview({ rows, badRows });
  };

  const applyImport = async () => {
    if (!preview?.rows.length) { setPreview(null); return; }
    setImportBusy(true);
    try {
      const res = await api.post(`/trips/${tripId}/activities/bulk`, { rows: preview.rows });
      window.alert(t.importDone(res.created, res.updated)
        + (res.errors?.length ? `\n${t.rowErrors}: ${res.errors.map((e2: any) => e2.row).join(', ')}` : ''));
      setPreview(null);
      await load();
    } finally { setImportBusy(false); }
  };

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
          <div className="row">
            <button className="btn btn-ghost btn-sm" onClick={exportCsv}>⬇️ {t.exportCsv}</button>
            <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
              ⬆️ {t.importCsv}
              <input type="file" accept=".csv,text/csv" hidden
                onChange={e => { onImportFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
            </label>
            <button className="btn btn-ghost btn-sm" onClick={blankTemplate}>📄 {t.blankTemplate}</button>
            <button className="btn" onClick={() => setModal(emptyActivity(selDay || days[0] || today))}>＋ {t.addActivity}</button>
          </div>
        )}
      </div>

      {preview && (
        <div className="overlay" onClick={() => setPreview(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="row-between">
              <h2>{t.importPreview}</h2>
              <button className="icon" onClick={() => setPreview(null)}>✕</button>
            </div>
            <p className="tiny">{t.importHint}</p>
            {preview.badRows.length > 0 && (
              <div className="callout warn">
                <strong>{t.rowErrors}:</strong>
                {preview.badRows.slice(0, 8).map((b, i) => <div key={i} className="tiny">Row {b.row}: {b.error}</div>)}
              </div>
            )}
            <div className="tablewrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table>
                <thead><tr><th></th><th>{t.date}</th><th>{t.timeLabel}</th><th>{t.activityTitle}</th><th>{t.participants}</th><th>📍</th></tr></thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={i}>
                      <td><span className={`badge ${r.id ? '' : 'ok'}`}>{r.id ? `${t.updateRow} #${r.id}` : t.newRow}</span></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{r.day}</td>
                      <td>{r.start_time ?? ''}</td>
                      <td>{r.title}<div className="tiny">{r.location_name ?? ''}</div></td>
                      <td>{r.participant_ids.length === members.length ? t.everyone : r.participant_ids.length}</td>
                      <td>{r.lat != null ? '✓' : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
              <button className="btn btn-ghost" onClick={() => setPreview(null)}>{t.cancel}</button>
              <button className="btn" disabled={importBusy || preview.rows.length === 0} onClick={applyImport}>
                {t.applyImport} ({preview.rows.length})
              </button>
            </div>
          </div>
        </div>
      )}

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
              <div className="row-between">
                <h3>🧭 {t.directions}</h3>
                {user.role === 'admin' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setSeModal('start')}>{t.editStartEnd}</button>
                )}
              </div>
              <p className="tiny">
                {t.dayStart}: {startPt ? startPt.name : t.noStartPoint} · {t.dayEnd}: {endPt ? endPt.name : '—'}
              </p>
              {unpinnedStay && (
                <p className="callout info" style={{ cursor: 'pointer' }} onClick={() => setSeModal('start')}>
                  📌 {t.setStayPin}: {unpinnedStay.description}
                </p>
              )}
              {legs.length === 0 && <p className="muted tiny">—</p>}
              {legs.map(leg => (
                <div className="leg-row" key={leg.key}>
                  <div className="leg-head">
                    <span className="leg-names">{leg.from.name} → {leg.to.name}</span>
                    <a target="_blank" rel="noreferrer" className="tiny"
                      href={`https://www.google.com/maps/dir/?api=1&origin=${leg.from.lat},${leg.from.lng}&destination=${leg.to.lat},${leg.to.lng}&travelmode=transit`}>
                      🗺️
                    </a>
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <span className="badge brand">{MODE_ICON[leg.chosen]} {t.minsLabel(leg.minutes)}</span>
                    <span className="badge">
                      {leg.fareJpy === 0 ? t.freeLabel : <>
                        {leg.overridden ? '' : `${t.estBadge} `}¥{leg.fareJpy.toLocaleString()}
                        {jpyRate ? ` (~${fmtMYR(leg.fareJpy * jpyRate)})` : ''}
                        {leg.chosen === 'taxi' ? ` · ${t.perCab}` : ''}
                      </>}
                    </span>
                    <span className="tiny">{(leg.distM / 1000).toFixed(1)} km</span>
                  </div>
                  <div className="row" style={{ gap: 4, marginTop: 3 }}>
                    {user.role === 'admin' && (['walk', 'train', 'taxi'] as Mode[]).map(m => (
                      <button key={m} className={`chip ${leg.chosen === m ? 'on' : ''}`} style={{ padding: '2px 8px' }}
                        onClick={() => setLegOverride(leg, m)}>{MODE_ICON[m]}</button>
                    ))}
                    {user.role === 'admin' && leg.overridden && (
                      <button className="icon" title="reset" onClick={() => setLegOverride(leg, null)}>↺</button>
                    )}
                    {user.role === 'admin' && (
                      <button className="btn btn-ghost btn-sm" onClick={() => logFare(leg, 'shared')}>💰 {t.toShared}</button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => logFare(leg, 'private')}>👤 {t.toPrivate}</button>
                  </div>
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
      {seModal && (
        <StartEndModal tripId={tripId} day={selDay} ds={ds} stays={stays}
          onClose={() => setSeModal(null)} onSaved={() => { setSeModal(null); load(); }} />
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

function PlacePicker({ value, onChange }: {
  value: { name: string; lat: number; lng: number } | null;
  onChange: (v: { name: string; lat: number; lng: number }) => void;
}) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const search = async () => {
    if (!q.trim()) return;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`);
      setResults(await res.json());
    } catch { setResults([]); }
  };
  return (
    <div>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={t.searchPlace}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search(); } }} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={search}>{t.searchBtn}</button>
      </div>
      {results.map((r, i) => (
        <div key={i} className="search-result" onClick={() => {
          onChange({ name: r.display_name.split(',').slice(0, 2).join(','), lat: Number(r.lat), lng: Number(r.lon) });
          setResults([]);
        }}>📍 {r.display_name}</div>
      ))}
      {value && <p className="tiny" style={{ margin: '4px 0' }}>📍 {value.name}</p>}
      <div style={{ marginTop: 6 }}>
        <LeafletMap pins={[]} picked={value ? { lat: value.lat, lng: value.lng } : null}
          onPick={(lat, lng) => onChange({ name: value?.name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng })}
          height={160} />
      </div>
    </div>
  );
}

function StartEndModal({ tripId, day, ds, stays, onClose, onSaved }: {
  tripId: number; day: string; ds: any; stays: any[];
  onClose: () => void; onSaved: () => void;
}) {
  const { t } = useT();
  const [scope, setScope] = useState<'day' | '*'>(ds?.day === '*' ? '*' : 'day');
  const [start, setStart] = useState<{ name: string; lat: number; lng: number } | null>(
    ds?.start_lat != null ? { name: ds.start_name ?? '', lat: ds.start_lat, lng: ds.start_lng } : null);
  const [end, setEnd] = useState<{ name: string; lat: number; lng: number } | null>(
    ds?.end_lat != null ? { name: ds.end_name ?? '', lat: ds.end_lat, lng: ds.end_lng } : null);
  const [pinStay, setPinStay] = useState<any | null>(null);
  const [pinLoc, setPinLoc] = useState<{ name: string; lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const unpinned = stays.filter(s => s.lat == null);

  const save = async () => {
    setBusy(true);
    try {
      if (pinStay && pinLoc) {
        await api.patch(`/expenses/${pinStay.expense_id}/coords`, { lat: pinLoc.lat, lng: pinLoc.lng });
      }
      await api.put(`/trips/${tripId}/daysettings`, {
        day: scope === '*' ? '*' : day,
        start_name: start?.name ?? null, start_lat: start?.lat ?? null, start_lng: start?.lng ?? null,
        end_name: end?.name ?? null, end_lat: end?.lat ?? null, end_lng: end?.lng ?? null,
      });
      onSaved();
    } finally { setBusy(false); }
  };

  const side = (label: string, val: any, setVal: any) => (
    <div style={{ marginBottom: 12 }}>
      <div className="row-between">
        <strong style={{ fontSize: '.88rem' }}>{label}</strong>
        <label className="row tiny" style={{ gap: 5 }}>
          <input type="radio" checked={val === null} onChange={() => setVal(null)} /> {t.useStay}
        </label>
      </div>
      {val !== null ? <PlacePicker value={val} onChange={setVal} />
        : <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => setVal({ name: '', lat: 35.68, lng: 139.76 })}>✏️ {t.edit}</button>}
    </div>
  );

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="row-between">
          <h2>{t.editStartEnd} · {day}</h2>
          <button className="icon" onClick={onClose}>✕</button>
        </div>
        <div className="row" style={{ marginBottom: 10 }}>
          <label className="row tiny" style={{ gap: 5 }}>
            <input type="radio" checked={scope === 'day'} onChange={() => setScope('day')} /> {t.thisDayOnly}
          </label>
          <label className="row tiny" style={{ gap: 5 }}>
            <input type="radio" checked={scope === '*'} onChange={() => setScope('*')} /> {t.wholeTrip}
          </label>
        </div>
        {side(t.dayStart, start, setStart)}
        {side(t.dayEnd, end, setEnd)}
        {unpinned.length > 0 && (
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 10, marginBottom: 10 }}>
            <strong style={{ fontSize: '.88rem' }}>📌 {t.setStayPin}</strong>
            <select style={{ margin: '6px 0' }} value={pinStay?.expense_id ?? ''}
              onChange={e => setPinStay(unpinned.find(s => s.expense_id === Number(e.target.value)) ?? null)}>
              <option value="">—</option>
              {unpinned.map(s => <option key={s.expense_id} value={s.expense_id}>{s.description}</option>)}
            </select>
            {pinStay && <PlacePicker value={pinLoc} onChange={setPinLoc} />}
          </div>
        )}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>{t.cancel}</button>
          <button className="btn" disabled={busy} onClick={save}>{t.save}</button>
        </div>
      </div>
    </div>
  );
}
