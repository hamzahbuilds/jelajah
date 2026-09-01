import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api, fmtMYR, fmtDate } from '../api';
import { useT } from '../i18n';
import { useSession } from '../App';
import { TripCtx } from './TripShell';
import LeafletMap, { Pin } from '../components/LeafletMap';
import { estimates, haversine, metroFareJpy, MODE_ICON, Mode } from '../../shared/fares';
import { toCsv, parseCsv, PLAN_COLUMNS, PLAN_EXAMPLE_ROW } from '../../shared/csv';
import { daysBetween, todayYmd } from '../../shared/days';
import { pinNumbers, actRef } from '../../shared/pins';
import { reflowDay } from '../../shared/reflow';
import { transformGrid, WizardMapping, ACTIVITY_CATEGORIES, ACTIVITY_CAT_ICON, ActivityCategory } from '../../shared/wizard';
import { geocode, nearestStations, walkMinutes, Station } from '../geo';
import { Suggestion } from '../../shared/assistant';
import { useToast } from '../components/Toast';

const normName = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '');

function downloadCsv(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const KIND_ICON: Record<string, string> = { flight: '✈️', checkin: '🔑', checkout: '🧳' };

interface ChainPt { ref: string; name: string; lat: number; lng: number; station?: Station | null }
export interface Leg {
  key: string; from: ChainPt; to: ChainPt; distM: number;
  chosen: Mode; fareJpy: number; minutes: number; overridden: boolean;
  rail?: { fromStation: Station; toStation: Station; walkFrom: number; walkTo: number; rideMin: number };
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
    const leg: Leg = {
      key, from, to, distM, chosen,
      fareJpy: ov?.fare_jpy ?? est.fareJpy, minutes: est.minutes,
      overridden: !!ov,
    };
    // station-aware rail leg: both ends have a chosen station and it's a train trip
    if ((leg.chosen === 'train' || leg.chosen === 'intercity') && from.station && to.station
      && from.station.name !== to.station.name) {
      const rideKm = haversine(from.station.lat, from.station.lng, to.station.lat, to.station.lng) / 1000;
      const walkFrom = walkMinutes(from.station.distM);
      const walkTo = walkMinutes(to.station.distM);
      const rideMin = Math.round(rideKm * 3 + 6);
      leg.rail = { fromStation: from.station, toStation: to.station, walkFrom, walkTo, rideMin };
      leg.minutes = walkFrom + rideMin + walkTo;
      if (!ov?.fare_jpy) leg.fareJpy = metroFareJpy(rideKm);
    }
    legs.push(leg);
  }
  return legs;
}

const stationOf = (a: any): Station | null => {
  try {
    const list: Station[] = a.stations_json ? JSON.parse(a.stations_json) : [];
    return list[a.station_idx ?? 0] ?? null;
  } catch { return null; }
};

interface PlanItem {
  key: string; day: string; time: string | null; end_time: string | null;
  title: string; subtitle?: string | null; auto: boolean; kind?: string;
  activity?: any;
  participant_ids?: number[]; // v0.12: who is on this auto event (flight/stay)
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
  const { toast } = useToast();
  // v0.12: members may edit activities when the trip's toggle allows it
  const canEdit = user.role === 'admin' || !!(trip as any).member_can_edit_plan;
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [data, setData] = useState<any>(null);
  const [view, setView] = useState<'day' | 'week' | 'month'>('day');
  const [modal, setModal] = useState<any | null>(null);
  const [seModal, setSeModal] = useState<'start' | 'end' | null>(null);
  const [jpyRate, setJpyRate] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ rows: any[]; badRows: Array<{ row: number; error: string }> } | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [dataMenu, setDataMenu] = useState(false);
  const [focusPin, setFocusPin] = useState<number | null>(null);
  const [titleEdit, setTitleEdit] = useState<string | null>(null);
  const [undoSnap, setUndoSnap] = useState<Array<{ id: number; start_time: string | null; end_time: string | null; sort: number }> | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [budgetModal, setBudgetModal] = useState(false);
  // v0.13: bulk-select mode for deleting many activities at once
  const [selMode, setSelMode] = useState(false);
  const [selIds, setSelIds] = useState<Set<number>>(new Set());
  // v0.13: day notes / checklist under each day
  const [noteText, setNoteText] = useState('');
  const [noteCheck, setNoteCheck] = useState(false);

  useEffect(() => {
    api.get(`/fx?date=${todayYmd()}&from=JPY&to=MYR`)
      .then(r => setJpyRate(r.rate)).catch(() => setJpyRate(null));
  }, []);

  const days = useMemo(() => {
    const base = trip.start_date && trip.end_date ? daysBetween(trip.start_date, trip.end_date) : [];
    const extra = new Set<string>(base);
    for (const a of data?.activities ?? []) extra.add(a.day);
    for (const e of data?.autoEvents ?? []) extra.add(e.day);
    return [...extra].sort();
  }, [trip, data]);

  const today = todayYmd();
  const [selDay, setSelDay] = useState('');
  useEffect(() => {
    if (!selDay && days.length) setSelDay(days.includes(today) ? today : days[0]);
  }, [days]);

  const load = async () => {
    try { setData(await api.get(`/trips/${tripId}/plan`)); } catch { setData({ hidden: true }); }
  };
  useEffect(() => { load(); }, [tripId]);

  // v0.13: optimistic local patches — the UI answers instantly, the server
  // catches up in the background, and a failed write reverts with a toast.
  const patchActivityLocal = (id: number, p: any) =>
    setData((d: any) => d?.activities ? { ...d, activities: d.activities.map((a: any) => (a.id === id ? { ...a, ...p } : a)) } : d);
  const removeActivitiesLocal = (ids: number[]) => {
    const gone = new Set(ids);
    setData((d: any) => d?.activities ? { ...d, activities: d.activities.filter((a: any) => !gone.has(a.id)) } : d);
  };
  const patchNoteLocal = (id: number, p: any) =>
    setData((d: any) => d?.dayNotes ? { ...d, dayNotes: d.dayNotes.map((n: any) => (n.id === id ? { ...n, ...p } : n)) } : d);
  const toggleDone = (act: any, v: boolean) => {
    patchActivityLocal(act.id, { done: v ? 1 : 0 });
    api.patch(`/activities/${act.id}`, { done: v })
      .catch(() => { patchActivityLocal(act.id, { done: v ? 0 : 1 }); toast(t.tSaveFailed, 'error'); });
  };

  const itemsByDay = useMemo(() => {
    // Activities keep the user's chosen order (sort column) as the primary
    // key — an untimed activity stays exactly where it was moved to, instead
    // of snapping to the bottom of the day. Auto events (flights, check-ins)
    // interleave by their own times.
    const toMin = (t?: string | null) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
    const actsByDay = new Map<string, any[]>();
    for (const a of data?.activities ?? []) {
      if (!actsByDay.has(a.day)) actsByDay.set(a.day, []);
      actsByDay.get(a.day)!.push(a);
    }
    const autosByDay = new Map<string, any[]>();
    for (const e of data?.autoEvents ?? []) {
      if (!autosByDay.has(e.day)) autosByDay.set(e.day, []);
      autosByDay.get(e.day)!.push(e);
    }
    const map = new Map<string, PlanItem[]>();
    for (const day of new Set([...actsByDay.keys(), ...autosByDay.keys()])) {
      const acts = (actsByDay.get(day) ?? []).sort((a, b) =>
        (a.sort ?? 0) - (b.sort ?? 0)
        || String(a.start_time ?? '99:99').localeCompare(String(b.start_time ?? '99:99'))
        || a.id - b.id);
      const entries: Array<{ eff: number; seq: number; item: PlanItem }> = [];
      let last = 0, tail = 0, seq = 0;
      for (const a of acts) {
        const m = toMin(a.start_time);
        const eff = m != null ? m : last + 0.001 * ++tail; // untimed: ride just after the previous timed item
        if (m != null) { last = m; tail = 0; }
        entries.push({ eff, seq: seq++, item: { key: `act-${a.id}`, day, time: a.start_time, end_time: a.end_time, title: a.title, subtitle: a.location_name, auto: false, activity: a } });
      }
      for (const e of autosByDay.get(day) ?? []) {
        entries.push({ eff: toMin(e.time) ?? 24 * 60 + 1, seq: seq++, item: { key: `auto-${e.kind}-${e.expense_id}-${day}-${e.time}`, day, time: e.time, end_time: e.end_time, title: e.title, subtitle: e.subtitle, auto: true, kind: e.kind, participant_ids: e.participant_ids } as PlanItem });
      }
      entries.sort((x, y) => x.eff - y.eff || x.seq - y.seq);
      map.set(day, entries.map(x => x.item));
    }
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
  // a day's title is per-day only — the '*' row is a start/end default, not a name
  const dayTitleOf = (d: string): string | null => dsList.find((x: any) => x.day === d)?.title || null;
  const saveDayTitle = async (value: string) => {
    setTitleEdit(null);
    if ((value.trim() || null) === dayTitleOf(selDay)) return;
    try {
      await api.put(`/trips/${tripId}/daysettings`, { day: selDay, title: value.trim().slice(0, 80) });
      load();
    } catch { toast(t.tSaveFailed, 'error'); }
  };
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
    .map(i => ({ ref: `act:${i.activity.id}`, name: i.title, lat: i.activity.lat, lng: i.activity.lng, station: stationOf(i.activity) }));
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

  // one numbering for both the map and the list — pin 1 is where the day starts
  // from (the accommodation), then each located activity in plan order
  const pinNos = pinNumbers(chain);
  const pins: Pin[] = chain.map((p, i) => ({ lat: p.lat, lng: p.lng, label: `${i + 1}. ${p.name}` }));

  // ---- CSV template export / import ----
  const exportCsv = () => {
    const acts = [...(data.activities ?? [])].sort((a: any, b: any) =>
      a.day === b.day ? (a.start_time ?? '99').localeCompare(b.start_time ?? '99') : a.day.localeCompare(b.day));
    const rows: any[][] = [[...PLAN_COLUMNS]];
    for (const a of acts) {
      const pcell = a.participant_ids.length === 0 ? ''
        : a.participant_ids.length === members.length ? 'ALL'
          : a.participant_ids.map((id2: number) => members.find(m => m.id === id2)?.name).filter(Boolean).join('; ');
      rows.push([a.id, a.day, a.start_time, a.end_time, a.title, a.category, a.notes,
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
        category: get('category') || null,
        participant_ids: [...new Set(participant_ids)],
        done: !!get('done'),
      });
    });
    setPreview({ rows, badRows });
  };

  // ---- reorder + smart reflow ----
  const dayActs = items.filter(i => i.activity).map(i => i.activity);
  const travelBetween = (a: any, b: any) => {
    if (a?.lat != null && b?.lat != null) {
      return estimates(haversine(a.lat, a.lng, b.lat, b.lng)).find(e => e.recommended)!.minutes;
    }
    return 10;
  };
  const applyOrder = (order: any[]) => {
    // optimistic: the list rearranges immediately; the PUT happens in the background
    setUndoSnap(dayActs.map(a => ({ id: a.id, start_time: a.start_time, end_time: a.end_time, sort: a.sort ?? 0 })));
    const reflowed = reflowDay(
      order.map(a => ({ id: a.id, start_time: a.start_time, end_time: a.end_time, lat: a.lat, lng: a.lng })),
      (x, y) => travelBetween(order.find(o => o.id === x.id), order.find(o => o.id === y.id)),
    );
    const items2 = reflowed.map((r, i2) => ({ id: r.id, start_time: r.start_time, end_time: r.end_time, sort: i2 }));
    for (const it of items2) patchActivityLocal(it.id, it);
    toast(t.tOrderUpdated);
    api.put(`/trips/${tripId}/reorder`, { day: selDay, items: items2 })
      .catch(() => { toast(t.tSaveFailed, 'error'); load(); });
  };
  const moveActivity = (actId: number, dir: -1 | 1) => {
    const order = [...dayActs];
    const idx = order.findIndex(a => a.id === actId);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= order.length) return;
    [order[idx], order[j]] = [order[j], order[idx]];
    applyOrder(order);
  };
  const dropOn = (targetId: number) => {
    if (dragId == null || dragId === targetId) return;
    const order = [...dayActs];
    const fromIdx = order.findIndex(a => a.id === dragId);
    const toIdx = order.findIndex(a => a.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = order.splice(fromIdx, 1);
    order.splice(toIdx, 0, moved);
    setDragId(null);
    applyOrder(order);
  };
  const undoReorder = () => {
    if (!undoSnap) return;
    const items2 = undoSnap.map((s, i2) => ({ ...s, sort: s.sort ?? i2 }));
    for (const it of items2) patchActivityLocal(it.id, it);
    setUndoSnap(null);
    api.put(`/trips/${tripId}/reorder`, { day: selDay, items: items2 })
      .catch(() => { toast(t.tSaveFailed, 'error'); load(); });
  };

  // v0.13: bulk delete — one confirm, one request, list updates instantly
  const toggleSel = (id: number) =>
    setSelIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const dayActIds = dayActs.map(a => a.id);
  const allDaySelected = dayActIds.length > 0 && dayActIds.every(id2 => selIds.has(id2));
  const selectAllDay = () =>
    setSelIds(prev => { const n = new Set(prev); allDaySelected ? dayActIds.forEach(id2 => n.delete(id2)) : dayActIds.forEach(id2 => n.add(id2)); return n; });
  const bulkDelete = async () => {
    const ids = [...selIds];
    if (!ids.length || !window.confirm(t.confirmBulkDelete(ids.length))) return;
    removeActivitiesLocal(ids);
    setSelIds(new Set());
    setSelMode(false);
    try {
      const r = await api.post(`/trips/${tripId}/activities/delete`, { ids });
      toast(t.tBulkDeleted(r.deleted));
    } catch { toast(t.tSaveFailed, 'error'); load(); }
  };

  // v0.13: day notes — plain notes or checklist items, kept out of the timeline
  const dayNotesList = ((data?.dayNotes ?? []) as any[]).filter(n => n.day === selDay);
  const addNote = async () => {
    const content = noteText.trim();
    if (!content) return;
    setNoteText('');
    try {
      const r = await api.post(`/trips/${tripId}/daynotes`, { day: selDay, content, is_check: noteCheck });
      setData((d: any) => ({ ...d, dayNotes: [...(d.dayNotes ?? []), { id: r.id, trip_id: tripId, day: selDay, content, is_check: noteCheck ? 1 : 0, done: 0, sort: 9999 }] }));
      toast(t.tNoteAdded);
    } catch { setNoteText(content); toast(t.tSaveFailed, 'error'); }
  };
  const toggleNote = (n: any, v: boolean) => {
    patchNoteLocal(n.id, { done: v ? 1 : 0 });
    api.patch(`/daynotes/${n.id}`, { done: v })
      .catch(() => { patchNoteLocal(n.id, { done: v ? 0 : 1 }); toast(t.tSaveFailed, 'error'); });
  };
  const deleteNote = (n: any) => {
    setData((d: any) => ({ ...d, dayNotes: (d.dayNotes ?? []).filter((x: any) => x.id !== n.id) }));
    toast(t.tNoteDeleted);
    api.del(`/daynotes/${n.id}`).catch(() => { toast(t.tSaveFailed, 'error'); load(); });
  };

  const budget = (data.dayBudgets ?? []).find((b: any) => b.day === selDay);

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
        <div className="row">
          {user.role === 'admin' && (
            <div className="datamenu-wrap">
              <button className="btn btn-ghost btn-sm" aria-haspopup="true" aria-expanded={dataMenu}
                onClick={() => setDataMenu(v => !v)}>📊 {t.dataMenu} ▾</button>
              {dataMenu && (
                <>
                  <div className="datamenu-scrim" onClick={() => setDataMenu(false)} />
                  <div className="datamenu" role="menu">
                    <button className="datamenu-row" role="menuitem" onClick={() => { setDataMenu(false); exportCsv(); }}>
                      <span className="dm-t">⬇️ {t.exportCsv}</span>
                      <span className="dm-d">{t.exportCsvHelp}</span>
                    </button>
                    <label className="datamenu-row" role="menuitem">
                      <span className="dm-t">⬆️ {t.importCsv}</span>
                      <span className="dm-d">{t.importCsvHelp}</span>
                      <input type="file" accept=".csv,text/csv" hidden
                        onChange={e => { setDataMenu(false); onImportFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
                    </label>
                    <button className="datamenu-row" role="menuitem" onClick={() => { setDataMenu(false); setWizardOpen(true); }}>
                      <span className="dm-t">🪄 {t.mapColumns}</span>
                      <span className="dm-d">{t.mapColumnsHelp}</span>
                    </button>
                    <button className="datamenu-row" role="menuitem" onClick={() => { setDataMenu(false); blankTemplate(); }}>
                      <span className="dm-t">📄 {t.blankTemplate}</span>
                      <span className="dm-d">{t.blankTemplateHelp}</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {canEdit && (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setSuggestOpen(true)}>✨ {t.suggestAi}</button>
              <button className="btn" onClick={() => setModal(emptyActivity(selDay || days[0] || today))}>＋ {t.addActivity}</button>
            </>
          )}
        </div>
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
              <button key={d} className={`daychip ${d === selDay ? 'on' : ''}`} onClick={() => setSelDay(d)}
                title={dayTitleOf(d) ?? undefined}>
                <span className="dn">D{dayNo(d)}</span>
                <span className="dd">{new Date(d + 'T00:00:00').toLocaleDateString(lang === 'ms' ? 'ms-MY' : 'en-MY', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
                {dayTitleOf(d) && <span className="dt">{dayTitleOf(d)}</span>}
              </button>
            ))}
          </div>
          <div className="grid grid-2" style={{ alignItems: 'start' }}>
            <div className="card">
              <div className="row-between">
                <h3 style={{ minWidth: 0 }}>
                  {fmtDate(selDay, lang)} {selDay === today && <span className="badge brand">{t.today}</span>}
                  {titleEdit === null ? (
                    <span className="daytitle">
                      {dayTitleOf(selDay) && <span className="daytitle-text">{dayTitleOf(selDay)}</span>}
                      {canEdit && (
                        <button className="icon" title={dayTitleOf(selDay) ? t.editDayTitle : t.addDayTitle}
                          onClick={() => setTitleEdit(dayTitleOf(selDay) ?? '')}>
                          {dayTitleOf(selDay) ? '✏️' : `🏷️ ${t.addDayTitle}`}
                        </button>
                      )}
                    </span>
                  ) : (
                    <form className="daytitle" onSubmit={e => { e.preventDefault(); saveDayTitle(titleEdit); }}>
                      <input autoFocus value={titleEdit} maxLength={80} placeholder={t.dayTitlePlaceholder}
                        onChange={e => setTitleEdit(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Escape') setTitleEdit(null); }} />
                      <button className="btn btn-sm" type="submit">{t.save}</button>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => setTitleEdit(null)}>{t.cancel}</button>
                    </form>
                  )}
                </h3>
                <span className="row" style={{ gap: 6 }}>
                  {(budget || user.role === 'admin') && (
                    <button className="badge" style={{ border: 'none', cursor: user.role === 'admin' ? 'pointer' : 'default' }}
                      title={budget ? `🚆${budget.transport ?? 0} 🏨${budget.accommodation ?? 0} 🍜${budget.food ?? 0} 🎟️${budget.attractions ?? 0} 📦${budget.misc ?? 0}` : t.editBudget}
                      onClick={() => user.role === 'admin' && setBudgetModal(true)}>
                      💰 {budget ? `¥${(budget.total ?? 0).toLocaleString()}${budget.myr_estimate ? ` (~${fmtMYR(budget.myr_estimate)})` : ''}` : t.dayBudget}
                    </button>
                  )}
                  {undoSnap && (
                    <button className="btn btn-ghost btn-sm" onClick={undoReorder}>↩️ {t.undoReflow}</button>
                  )}
                  {canEdit && dayActs.length > 0 && (
                    <button className={`btn btn-sm ${selMode ? '' : 'btn-ghost'}`}
                      onClick={() => { setSelMode(!selMode); setSelIds(new Set()); }}>
                      ☑️ {selMode ? t.cancel : t.selectBtn}
                    </button>
                  )}
                </span>
              </div>
              {selMode && (
                <div className="row bulkbar">
                  <label className="row tiny" style={{ gap: 6 }}>
                    <input type="checkbox" checked={allDaySelected} onChange={selectAllDay} /> {t.selectAll}
                  </label>
                  <button className="btn btn-sm btn-danger" disabled={selIds.size === 0} onClick={bulkDelete}>
                    🗑️ {t.deleteSelectedN(selIds.size)}
                  </button>
                </div>
              )}
              {items.length === 0 && <p className="muted">{t.noEvents}</p>}
              {items.map(i => (
                <div className={`plan-item ${i.activity?.done ? 'done' : ''} ${dragId === i.activity?.id ? 'dragging' : ''}`} key={i.key}
                  draggable={canEdit && !!i.activity}
                  onDragStart={() => i.activity && setDragId(i.activity.id)}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={e => { if (i.activity) e.preventDefault(); }}
                  onDrop={() => i.activity && dropOn(i.activity.id)}>
                  {selMode && i.activity && (
                    <input type="checkbox" className="sel-box" checked={selIds.has(i.activity.id)}
                      onChange={() => toggleSel(i.activity.id)} />
                  )}
                  <div className="pi-time">{i.time ?? '—'}{i.end_time ? `–${i.end_time}` : ''}</div>
                  <div className="pi-ic">
                    {(() => {
                      const no = i.activity ? pinNos.get(actRef(i.activity.id)) : undefined;
                      if (no) return (
                        <button className="pinno" title={t.showOnMap(no)}
                          onClick={() => setFocusPin(no - 1)}>{no}</button>
                      );
                      // no coordinates → no pin on the map; say so instead of faking one
                      if (i.activity) return <span className="pinno none" title={t.noPinYet}>—</span>;
                      return <span>{KIND_ICON[i.kind ?? ''] ?? '•'}</span>;
                    })()}
                  </div>
                  <div className="pi-body">
                    <div className="pi-title">
                      {i.activity && <span className="pi-cat">{ACTIVITY_CAT_ICON[(i.activity?.category as ActivityCategory) ?? 'other'] ?? '📍'} </span>}
                      {i.title}
                    </div>
                    {i.subtitle && <div className="tiny">{i.subtitle}</div>}
                    {i.auto && (i as any).participant_ids?.length > 0 && (i as any).participant_ids.length < members.length && (
                      <div className="tiny">👥 {participantsLabel((i as any).participant_ids)}</div>
                    )}
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
                  {canEdit && i.activity && (
                    <div className="row" style={{ gap: 2, flexWrap: 'nowrap' }}>
                      <span className="row" style={{ flexDirection: 'column', gap: 0 }}>
                        <button className="icon" style={{ padding: '0 4px', lineHeight: 1 }} title={t.moveUp}
                          onClick={() => moveActivity(i.activity.id, -1)}>▲</button>
                        <button className="icon" style={{ padding: '0 4px', lineHeight: 1 }} title={t.moveDown}
                          onClick={() => moveActivity(i.activity.id, 1)}>▼</button>
                      </span>
                      <input type="checkbox" checked={!!i.activity.done} title={t.doneLabel}
                        onChange={e => toggleDone(i.activity, e.target.checked)} />
                      <button className="icon" onClick={() => setModal({ ...i.activity, est_cost_myr: i.activity.est_cost_myr ?? '' })}>✏️</button>
                      <button className="icon" onClick={() => {
                        if (!window.confirm(t.confirmDelete)) return;
                        const aid = i.activity.id;
                        removeActivitiesLocal([aid]);
                        toast(t.tActivityDeleted);
                        api.del(`/activities/${aid}`).catch(() => { toast(t.tSaveFailed, 'error'); load(); });
                      }}>🗑️</button>
                    </div>
                  )}
                </div>
              ))}
              {(dayNotesList.length > 0 || canEdit) && (
                <div className="daynotes">
                  <div className="tiny" style={{ fontWeight: 700, margin: '12px 0 4px' }}>🗒️ {t.dayNotes}</div>
                  {dayNotesList.map((n: any) => (
                    <div className={`note-row ${n.is_check && n.done ? 'done' : ''}`} key={n.id}>
                      {n.is_check
                        ? <input type="checkbox" checked={!!n.done} disabled={!canEdit}
                            onChange={e => toggleNote(n, e.target.checked)} />
                        : <span className="note-dot">•</span>}
                      <span className="note-text">{n.content}</span>
                      {canEdit && <button className="icon" title={t.delete} onClick={() => deleteNote(n)}>✕</button>}
                    </div>
                  ))}
                  {canEdit && (
                    <form className="row" style={{ flexWrap: 'nowrap', marginTop: 6 }}
                      onSubmit={e => { e.preventDefault(); addNote(); }}>
                      <input value={noteText} onChange={e => setNoteText(e.target.value)}
                        placeholder={t.notePlaceholder} style={{ flex: 1, minWidth: 0 }} />
                      <label className="row tiny" style={{ gap: 4, whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={noteCheck} onChange={e => setNoteCheck(e.target.checked)} />
                        ☑️ {t.checklistLabel}
                      </label>
                      <button className="btn btn-sm" disabled={!noteText.trim()}>{t.add}</button>
                    </form>
                  )}
                </div>
              )}
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
                  {leg.rail && (
                    <div className="tiny" style={{ marginTop: 2 }}>
                      {t.walkTo(leg.rail.walkFrom)} → 🚇 <strong>{leg.rail.fromStation.name}</strong> → <strong>{leg.rail.toStation.name}</strong> ({t.minsLabel(leg.rail.rideMin)}) → {t.walkTo(leg.rail.walkTo)}
                    </div>
                  )}
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
              <LeafletMap pins={pins} line height={340} focus={focusPin} />
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
          onSaved={() => { setModal(null); toast(t.tActivitySaved); load(); }}
        />
      )}
      {seModal && (
        <StartEndModal tripId={tripId} day={selDay} ds={ds} stays={stays}
          onClose={() => setSeModal(null)} onSaved={() => { setSeModal(null); load(); }} />
      )}
      {budgetModal && (
        <BudgetModal tripId={tripId} day={selDay} budget={budget} jpyRate={jpyRate}
          onClose={() => setBudgetModal(false)} onSaved={() => { setBudgetModal(false); load(); }} />
      )}
      {wizardOpen && (
        <WizardModal tripId={tripId} trip={trip} jpyRate={jpyRate}
          onClose={() => setWizardOpen(false)} onDone={() => { setWizardOpen(false); load(); }} />
      )}
      {suggestOpen && (
        <SuggestModal tripId={tripId} trip={trip} day={selDay} canEdit={canEdit}
          onClose={() => setSuggestOpen(false)} onAdded={() => load()} />
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
    const bias = d.lat != null ? { lat: d.lat, lng: d.lng } : undefined;
    setResults(await geocode(q, bias));
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
      category: d.category || null,
    };
    try {
      let actId = d.id;
      if (d.id) await api.put(`/activities/${d.id}`, payload);
      else actId = (await api.post(`/trips/${tripId}/activities`, payload)).id;
      // cache nearest stations when the pin is new/moved; persist the chosen station either way
      if (actId && d.lat != null) {
        const coordsChanged = d.lat !== draft.lat || d.lng !== draft.lng;
        if (coordsChanged || !d.stations_json) {
          const sts = await nearestStations(d.lat, d.lng);
          await api.patch(`/activities/${actId}/stations`, { stations_json: sts, station_idx: 0 }).catch(() => {});
        } else if ((d.station_idx ?? 0) !== (draft.station_idx ?? 0)) {
          await api.patch(`/activities/${actId}/stations`, { station_idx: d.station_idx ?? 0 }).catch(() => {});
        }
      }
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
          <label className="field"><span>{t.activityCategory}</span>
            <select value={d.category ?? ''} onChange={e => set({ category: e.target.value || null })}>
              <option value="">—</option>
              {ACTIVITY_CATEGORIES.map(cval => (
                <option key={cval} value={cval}>
                  {ACTIVITY_CAT_ICON[cval]} {(t as any)[`cat${cval.charAt(0).toUpperCase()}${cval.slice(1)}`]}
                </option>
              ))}
            </select></label>
          <label className="field full"><span>{t.notes}</span>
            <input value={d.notes ?? ''} onChange={e => set({ notes: e.target.value })} /></label>
        </div>

        <div style={{ margin: '4px 0 12px' }}>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t.searchPlace}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search(); } }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={search}>{t.searchBtn}</button>
          </div>
          {results.map((r: any, i) => (
            <div key={i} className="search-result" onClick={() => {
              set({ location_name: r.name.split(',').slice(0, 2).join(','), lat: r.lat, lng: r.lng });
              setResults([]);
            }}>📍 {r.name}</div>
          ))}
          {d.location_name && <p className="tiny" style={{ margin: '6px 0' }}>📍 {d.location_name}</p>}
          {(() => {
            try {
              const sts: Station[] = d.stations_json ? JSON.parse(d.stations_json) : [];
              if (!sts.length) return null;
              return (
                <div style={{ margin: '6px 0' }}>
                  <span className="tiny" style={{ fontWeight: 700 }}>🚉 {t.nearestStations}:</span>
                  <div className="row" style={{ gap: 4, marginTop: 3 }}>
                    {sts.map((s, i2) => (
                      <button type="button" key={i2} className={`chip ${(d.station_idx ?? 0) === i2 ? 'on' : ''}`}
                        onClick={() => set({ station_idx: i2 })}>
                        🚇 {s.name} · {t.walkTo(Math.max(1, Math.round((s.distM / 1000) * 1.3 * 12)))}
                      </button>
                    ))}
                  </div>
                </div>
              );
            } catch { return null; }
          })()}
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

function BudgetModal({ tripId, day, budget, jpyRate, onClose, onSaved }: {
  tripId: number; day: string; budget: any; jpyRate: number | null;
  onClose: () => void; onSaved: () => void;
}) {
  const { t } = useT();
  const [b, setB] = useState<any>({
    transport: budget?.transport ?? '', accommodation: budget?.accommodation ?? '',
    food: budget?.food ?? '', attractions: budget?.attractions ?? '', misc: budget?.misc ?? '',
  });
  const total = ['transport', 'accommodation', 'food', 'attractions', 'misc']
    .reduce((a, k) => a + (Number(b[k]) || 0), 0);
  const save = async () => {
    await api.put(`/trips/${tripId}/daybudgets`, {
      day, currency: 'JPY',
      transport: Number(b.transport) || null, accommodation: Number(b.accommodation) || null,
      food: Number(b.food) || null, attractions: Number(b.attractions) || null, misc: Number(b.misc) || null,
      total: total || null,
      myr_estimate: jpyRate && total ? Math.round(total * jpyRate * 100) / 100 : null,
    });
    onSaved();
  };
  const fields: Array<[string, string]> = [
    ['transport', '🚆'], ['accommodation', '🏨'], ['food', '🍜'], ['attractions', '🎟️'], ['misc', '📦'],
  ];
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="row-between">
          <h2>{t.dayBudget} · {day}</h2>
          <button className="icon" onClick={onClose}>✕</button>
        </div>
        {fields.map(([k, ic]) => (
          <label className="field" key={k}>
            <span>{ic} {(t as any)[k === 'transport' ? 'transport' : k === 'accommodation' ? 'accommodation' : k === 'food' ? 'food' : k === 'attractions' ? 'entrance' : 'other']} (¥)</span>
            <input type="number" min="0" value={b[k]} onChange={e => setB({ ...b, [k]: e.target.value })} />
          </label>
        ))}
        <p className="muted">Σ ¥{total.toLocaleString()}{jpyRate && total ? ` (~${fmtMYR(total * jpyRate)})` : ''}</p>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>{t.cancel}</button>
          <button className="btn" onClick={save}>{t.save}</button>
        </div>
      </div>
    </div>
  );
}

function WizardModal({ tripId, trip, jpyRate, onClose, onDone }: {
  tripId: number; trip: any; jpyRate: number | null;
  onClose: () => void; onDone: () => void;
}) {
  const { t } = useT();
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [map2, setMap2] = useState<any>({ date: -1, time: -1, title: -1, notes: [], category: -1, price: -1, overnight: -1, bTransport: -1, bAccom: -1, bFood: -1, bAttr: -1, bMisc: -1, bTotal: -1 });
  const [result, setResult] = useState<any>(null);
  const [geo, setGeo] = useState<Map<string, { name: string; lat: number; lng: number }>>(new Map());
  const [geoProg, setGeoProg] = useState<[number, number] | null>(null);
  const [saveProf, setSaveProf] = useState(true);
  const [busy, setBusy] = useState(false);

  const onFile = async (f: File | null) => {
    if (!f) return;
    const g = parseCsv(await f.text());
    setGrid(g);
    // auto-guess columns from header keywords
    const h = g[0].map(x => x.toLowerCase());
    const find = (re: RegExp) => h.findIndex(x => re.test(x));
    setMap2({
      date: find(/date/), time: find(/time/), title: find(/activity|route|title|plan/),
      notes: [find(/parking|note|remark/)].filter(i => i >= 0),
      category: find(/category|type|kategori/),
      price: find(/^price|cost(?!.*day)|fee|harga|ticket/),
      overnight: find(/overnight|hotel|stay|lodg/),
      bTransport: find(/transport/), bAccom: find(/accom/), bFood: find(/food/),
      bAttr: find(/attraction/), bMisc: find(/misc/), bTotal: find(/total.*¥|day total \(?¥/),
    });
  };

  const mapping = (): WizardMapping => ({
    date: map2.date >= 0 ? map2.date : undefined,
    time: map2.time >= 0 ? map2.time : undefined,
    title: map2.title,
    notes: map2.notes,
    category: map2.category >= 0 ? map2.category : undefined,
    price: map2.price >= 0 ? map2.price : undefined,
    priceRate: jpyRate ?? 0.031, // client CSV prices are ¥ — store as an MYR estimate
    overnight: map2.overnight >= 0 ? map2.overnight : undefined,
    budgets: {
      transport: map2.bTransport >= 0 ? map2.bTransport : undefined,
      accommodation: map2.bAccom >= 0 ? map2.bAccom : undefined,
      food: map2.bFood >= 0 ? map2.bFood : undefined,
      attractions: map2.bAttr >= 0 ? map2.bAttr : undefined,
      misc: map2.bMisc >= 0 ? map2.bMisc : undefined,
      total: map2.bTotal >= 0 ? map2.bTotal : undefined,
    },
    budgetCurrency: 'JPY',
  });

  const transform = () => {
    if (!grid || map2.title < 0) return;
    setResult(transformGrid(grid, mapping(), trip.start_date ?? '2000-01-01', trip.end_date ?? '2099-12-31'));
  };

  const cleanTitle = (s: string) => s.replace(/\(.*?\)/g, '').split(/[,–—-]/)[0].trim().slice(0, 60);
  const findLocations = async () => {
    if (!result) return;
    const targets = result.activities.filter((a: any) => !a.isLodging && a.start_time);
    const uniq = [...new Set(targets.map((a: any) => cleanTitle(a.title)).filter((s: string) => s.length > 3))] as string[];
    const next = new Map(geo);
    setGeoProg([0, uniq.length]);
    for (let i = 0; i < uniq.length; i++) {
      const q = uniq[i];
      if (!next.has(q)) {
        const hint = (trip.destination ?? '').split(',').pop()?.trim() ?? '';
        const res = await geocode(`${q} ${hint}`);
        if (res[0]) next.set(q, res[0]);
        await new Promise(r => setTimeout(r, 350));
      }
      setGeoProg([i + 1, uniq.length]);
      setGeo(new Map(next));
    }
  };

  const apply = async () => {
    if (!result) return;
    setBusy(true);
    try {
      const rows = result.activities.map((a: any) => {
        const g2 = geo.get(cleanTitle(a.title));
        return {
          day: a.day, title: a.title, start_time: a.start_time, end_time: a.end_time,
          notes: a.notes, location_name: g2?.name ?? null, lat: g2?.lat ?? null, lng: g2?.lng ?? null,
          est_cost_myr: a.est_cost_myr ?? null, category: a.category ?? null, participant_ids: [], done: false,
        };
      });
      const budgets = result.budgets.map((b: any) => ({
        ...b, myr_estimate: jpyRate && b.total ? Math.round(b.total * jpyRate * 100) / 100 : null,
      }));
      const res = await api.post(`/trips/${tripId}/activities/bulk`, { rows, budgets });
      if (saveProf) {
        await api.post(`/trips/${tripId}/importprofiles`, { name: `wizard-${todayYmd()}`, mapping: map2 }).catch(() => {});
      }
      window.alert(t.importDone(res.created, res.updated));
      onDone();
    } finally { setBusy(false); }
  };

  const colSelect = (val: number, onCh: (v: number) => void) => (
    <select value={val} onChange={e => onCh(Number(e.target.value))}>
      <option value={-1}>{t.notMapped}</option>
      {(grid?.[0] ?? []).map((h, i) => <option key={i} value={i}>{i + 1}. {h || '(blank)'}</option>)}
    </select>
  );

  const located = result ? result.activities.filter((a: any) => geo.has(cleanTitle(a.title))).length : 0;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="row-between">
          <h2>🪄 {t.wizardTitle}</h2>
          <button className="icon" onClick={onClose}>✕</button>
        </div>
        <p className="tiny">{t.wizardHint}</p>
        {!grid ? (
          <label className="dropzone" style={{ display: 'block' }}>
            📥 CSV
            <input type="file" accept=".csv,text/csv" hidden onChange={e => onFile(e.target.files?.[0] ?? null)} />
          </label>
        ) : (
          <>
            <div className="form-grid">
              <label className="field"><span>{t.fieldDate}</span>{colSelect(map2.date, v => setMap2({ ...map2, date: v }))}</label>
              <label className="field"><span>{t.fieldTime}</span>{colSelect(map2.time, v => setMap2({ ...map2, time: v }))}</label>
              <label className="field"><span>{t.fieldTitle}</span>{colSelect(map2.title, v => setMap2({ ...map2, title: v }))}</label>
              <label className="field"><span>{t.fieldNotes}</span>{colSelect(map2.notes[0] ?? -1, v => setMap2({ ...map2, notes: v >= 0 ? [v] : [] }))}</label>
              <label className="field"><span>{t.fieldCategory}</span>{colSelect(map2.category, v => setMap2({ ...map2, category: v }))}</label>
              <label className="field"><span>{t.fieldPrice}</span>{colSelect(map2.price, v => setMap2({ ...map2, price: v }))}</label>
              <label className="field"><span>{t.fieldOvernight}</span>{colSelect(map2.overnight, v => setMap2({ ...map2, overnight: v }))}</label>
              <label className="field"><span>{t.fieldBudgets} (🚆/🏨/🍜/🎟️/📦/Σ)</span>
                <div className="row" style={{ gap: 3, flexWrap: 'wrap' }}>
                  {colSelect(map2.bTransport, v => setMap2({ ...map2, bTransport: v }))}
                  {colSelect(map2.bAccom, v => setMap2({ ...map2, bAccom: v }))}
                  {colSelect(map2.bFood, v => setMap2({ ...map2, bFood: v }))}
                  {colSelect(map2.bAttr, v => setMap2({ ...map2, bAttr: v }))}
                  {colSelect(map2.bMisc, v => setMap2({ ...map2, bMisc: v }))}
                  {colSelect(map2.bTotal, v => setMap2({ ...map2, bTotal: v }))}
                </div>
              </label>
            </div>
            <div className="row" style={{ margin: '8px 0' }}>
              <button className="btn btn-ghost btn-sm" disabled={map2.title < 0} onClick={transform}>👁️ {t.importPreview}</button>
              {result && (
                <button className="btn btn-ghost btn-sm" onClick={findLocations} disabled={!!geoProg && geoProg[0] < geoProg[1]}>
                  📍 {geoProg && geoProg[0] < geoProg[1] ? t.geocoding(geoProg[0], geoProg[1]) : t.geocodeNow}
                </button>
              )}
            </div>
            {result && (
              <>
                <p className="tiny">
                  {t.activityCount(result.activities.length)} · 💰 {result.budgets.length} · 📍 {located}
                  {result.skipped.length ? ` · ⚠️ ${result.skipped.length}` : ''}
                </p>
                <div className="tablewrap" style={{ maxHeight: 240, overflowY: 'auto' }}>
                  <table>
                    <thead><tr><th>{t.date}</th><th>{t.timeLabel}</th><th>{t.activityTitle}</th><th>📍</th></tr></thead>
                    <tbody>
                      {result.activities.slice(0, 80).map((a: any, i: number) => (
                        <tr key={i}>
                          <td style={{ whiteSpace: 'nowrap' }}>{a.day}</td>
                          <td>{a.start_time ?? ''}{a.end_time ? `–${a.end_time}` : ''}</td>
                          <td>{a.title.slice(0, 60)}</td>
                          <td>{geo.has(cleanTitle(a.title)) ? '✓' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <label className="row tiny" style={{ gap: 6, margin: '8px 0' }}>
                  <input type="checkbox" checked={saveProf} onChange={e => setSaveProf(e.target.checked)} />
                  {t.saveProfile}
                </label>
                <div className="row" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn btn-ghost" onClick={onClose}>{t.cancel}</button>
                  <button className="btn" disabled={busy || !result.activities.length} onClick={apply}>
                    {t.applyImport} ({result.activities.length})
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** v0.12: AI itinerary suggestions — the model proposes, the human taps Add. */
function SuggestModal({ tripId, trip, day, canEdit, onClose, onAdded }: {
  tripId: number; trip: any; day: string; canEdit: boolean;
  onClose: () => void; onAdded: () => void;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const [prompt, setPrompt] = useState('');
  const [scope, setScope] = useState<'day' | 'trip'>('day');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<number | 'all' | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [added, setAdded] = useState<Set<number>>(new Set());
  const [err, setErr] = useState('');

  const ask = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setErr('');
    setSuggestions(null);
    setAdded(new Set());
    try {
      const r = await api.post(`/trips/${tripId}/assistant/suggest`, {
        prompt, day: scope === 'day' ? day : undefined,
      });
      setSuggestions(r.suggestions);
    } catch (ex: any) {
      const code = ex?.code ?? ex?.body?.error ?? '';
      setErr(code === 'ai_rate_limited' ? t.aiResting : code === 'ai_not_configured' ? t.aiNotConfigured : code === 'ai_unreachable' ? t.aiUnreachable : t.aiError);
    } finally { setBusy(false); }
  };

  const addOne = async (s: Suggestion, idx: number) => {
    if (added.has(idx)) return;
    setAdding(idx);
    try {
      let geo: { name: string; lat: number; lng: number } | null = null;
      if (s.place) {
        const hint = (trip.destination ?? '').split(',').pop()?.trim() ?? '';
        geo = (await geocode(`${s.place} ${hint}`))[0] ?? (await geocode(s.place))[0] ?? null;
      }
      let end: string | null = null;
      if (s.start_time && s.duration_min) {
        const m = Number(s.start_time.slice(0, 2)) * 60 + Number(s.start_time.slice(3, 5)) + s.duration_min;
        end = `${String(Math.floor(Math.min(m, 1435) / 60)).padStart(2, '0')}:${String(Math.min(m, 1435) % 60).padStart(2, '0')}`;
      }
      const r = await api.post(`/trips/${tripId}/activities`, {
        title: s.title, day: s.day, start_time: s.start_time, end_time: end,
        notes: s.why ?? null, category: s.category ?? null,
        location_name: geo?.name ?? s.place ?? null, lat: geo?.lat ?? null, lng: geo?.lng ?? null,
        participant_ids: [],
      });
      if (geo && r?.id) {
        const sts = await nearestStations(geo.lat, geo.lng).catch(() => []);
        if (sts.length) await api.patch(`/activities/${r.id}/stations`, { stations_json: sts, station_idx: 0 }).catch(() => {});
      }
      setAdded(prev => new Set(prev).add(idx));
      toast(t.tSuggestionAdded);
      onAdded();
    } finally { setAdding(null); }
  };

  const addAll = async () => {
    if (!suggestions) return;
    setAdding('all');
    for (let i = 0; i < suggestions.length; i++) {
      if (!added.has(i)) await addOne(suggestions[i], i);
    }
    setAdding(null);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="row-between">
          <h2>✨ {t.suggestAi}</h2>
          <button className="icon" onClick={onClose}>✕</button>
        </div>
        <form className="row" onSubmit={ask} style={{ flexWrap: 'nowrap', marginBottom: 8 }}>
          <input value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={t.suggestPlaceholder} style={{ flex: 1 }} />
          <button className="btn btn-sm" type="submit" disabled={busy || !prompt.trim()}>{busy ? '…' : t.suggestGo}</button>
        </form>
        <div className="row tiny" style={{ gap: 4 }}>
          <span className={`chip ${scope === 'day' ? 'on' : ''}`} onClick={() => setScope('day')}>📅 {day}</span>
          <span className={`chip ${scope === 'trip' ? 'on' : ''}`} onClick={() => setScope('trip')}>🧳 {trip.name}</span>
        </div>
        {busy && <p className="muted" style={{ marginTop: 10 }}>🤖 {t.suggesting}</p>}
        {err && <p className="callout warn">{err}</p>}
        {suggestions && suggestions.length === 0 && <p className="muted" style={{ marginTop: 10 }}>—</p>}
        {suggestions && suggestions.length > 0 && (
          <>
            <div className="row-between" style={{ marginTop: 10 }}>
              <span className="tiny">⚠️ {t.aiDisclaimer}</span>
              {canEdit && (
                <button className="btn btn-ghost btn-sm" onClick={addAll} disabled={adding !== null}>
                  ＋ {t.addAll} ({suggestions.length})
                </button>
              )}
            </div>
            {suggestions.map((s, i) => (
              <div key={i} className={`suggest-card ${added.has(i) ? 'added' : ''}`}>
                <div className="sc-time">{s.day.slice(5)}<br />{s.start_time ?? '—'}</div>
                <div className="sc-body">
                  <div className="sc-title">{ACTIVITY_CAT_ICON[(s.category as ActivityCategory) ?? 'sightseeing'] ?? '📍'} {s.title}</div>
                  {s.why && <div className="tiny">{s.why}</div>}
                  {s.place && <div className="tiny">📍 {s.place}</div>}
                </div>
                {canEdit && (
                  <button className="btn btn-sm" disabled={added.has(i) || adding !== null}
                    onClick={() => addOne(s, i)}>
                    {added.has(i) ? `✓ ${t.addedLbl}` : adding === i ? '…' : `＋ ${t.add}`}
                  </button>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
