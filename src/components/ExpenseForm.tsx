import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, fmtMYR } from '../api';
import { useT } from '../i18n';
import { useToast } from './Toast';
import { Participant } from '../pages/TripShell';
import { allocateByWeight, ROOM_SPLIT_ERROR_CODES } from '../../shared/roomSplit';
import { occupancyLabel } from '../../shared/rooms';
import { daysBetween } from '../../shared/days';

/** v0.25 F2c — server-side codes a rooms-split submit can be rejected with:
 *  the resolveRoomsSplit-level codes plus every engine RoomSplitError code.
 *  Anything in this set maps to one generic, actionable toast; anything
 *  outside it (a genuine network/unexpected failure) still surfaces via the
 *  inline `err` callout as before. */
const KNOWN_ROOMS_SPLIT_ERROR_CODES = new Set<string>([
  'sum_mismatch', 'unknown_room', 'unknown_stay', 'missing_room', 'rooms_split_category',
  // F1 (fail-closed) — a room has explicit occupant nights but the stay's
  // night count isn't derivable (no dated room in the group): the server
  // refuses to mix an absolute-nights weight against a scale-1 default.
  'stale_nights',
  ...Object.values(ROOM_SPLIT_ERROR_CODES),
]);

export const CATEGORIES = ['accommodation', 'flight', 'transport', 'entrance', 'pass', 'food', 'shopping', 'other'] as const;
const CURRENCIES = ['MYR', 'JPY', 'SGD', 'USD', 'EUR', 'GBP', 'THB', 'IDR', 'KRW', 'CNY'];

export interface ExpenseDraft {
  category: string; description: string; vendor: string; location: string;
  expense_date: string; end_date: string; payment_date: string;
  amount_original: number; currency: string; fx_rate: number; amount_myr: number;
  payer_participant_id: number | 0;
  participant_ids: number[];
  custom: boolean;
  customShares: Record<number, number>;
  due_dates: Array<{ due_date: string; amount_myr?: number; note?: string; participant_id?: number | null }>;
  payment_status: 'paid' | 'pay_at_hotel';
  /** v0.25 — room-cost splitting (additive; null = not in rooms mode).
   *  `amounts`/`dirty` are keyed by room id (string). `dirty[roomId]` tracks
   *  whether the user hand-edited that room's amount, so proportional
   *  re-prefill (on amount/stay change) never clobbers it. */
  roomsSplit: { stay_label: string; amounts: Record<string, number>; dirty: Record<string, boolean> } | null;
}

export function emptyDraft(): ExpenseDraft {
  return {
    category: 'other', description: '', vendor: '', location: '',
    expense_date: '', end_date: '', payment_date: '',
    amount_original: 0, currency: 'MYR', fx_rate: 1, amount_myr: 0,
    payer_participant_id: 0, participant_ids: [], custom: false, customShares: {}, due_dates: [],
    payment_status: 'paid',
    roomsSplit: null,
  };
}

/** v0.25 room-cost splitting — types + pure helpers for the room editor.
 *  See docs/13-spec-v0.25-room-split.md §4. All additive; the equal/custom
 *  split paths above are untouched. */
type RoomRow = {
  id: number; stay_label: string; check_in: string | null; check_out: string | null;
  name: string; capacity: number | null; occupant_ids: number[];
  /** v0.26 (T2 API) — per-occupant nights; absent on pre-T2 payloads. */
  occupants?: Array<{ participant_id: number; nights: number | null }>;
};
type RoomGroup = { stay_label: string; check_in: string | null; check_out: string | null; rooms: RoomRow[] };

/** v0.26 stayNights for a room (spec §3/§4), mirrored client-side to match
 *  the SERVER's stayNightsForRoom (server/app.ts, ~1806-1831) and
 *  RoomsCard.tsx's client copy exactly: the room's own check_in/check_out
 *  when both are set, else SEARCH every sibling room in the stay group,
 *  ORDERED BY ASCENDING ROOM ID (F4 — matches the server's stayGroupNights
 *  exactly, not render order), for the first one with both dates set,
 *  else null (no known stay length — every occupant defaults to weight 1).
 *  Review fix (task-3-review.md finding 3): this used to fall back to
 *  `group.check_in`/`check_out`, which groupRoomsByStay seeds from only the
 *  FIRST room encountered — if that first room had no dates while a later
 *  sibling did, the prefill silently diverged from what resolveRoomsSplit
 *  (and the badge) would actually compute. Must search all siblings, same
 *  as the other two implementations, so the prefill preview never disagrees
 *  with the saved split. */
function stayNightsForRoom(room: RoomRow, group: RoomGroup): number | null {
  const fromDates = (ci: string | null, co: string | null): number | null => {
    if (!ci || !co) return null;
    const days = daysBetween(ci, co);
    if (days.length < 2) return null;
    return days.length - 1;
  };
  const own = fromDates(room.check_in, room.check_out);
  if (own != null) return own;
  const byIdAsc = [...group.rooms].sort((a, b) => a.id - b.id);
  for (const sib of byIdAsc) {
    if (sib.id === room.id) continue;
    const n = fromDates(sib.check_in, sib.check_out);
    if (n != null) return n;
  }
  return null;
}

/** v0.26 — total person-nights for a room's non-infant occupants: each
 *  occupant's explicit nights, or the stay's night count, or 1 as the final
 *  fallback (spec §4: "weight = nights ?? stayNights ?? 1"). Used both as
 *  the room's prefill weight (bigger person-nights ⇒ proportionally more of
 *  the total) and to detect/format the person-nights occupancy label. */
function personNightsForRoom(room: RoomRow, infantIds: Set<number>, stayNights: number | null): number {
  const nightsByPid = new Map((room.occupants ?? []).map(o => [o.participant_id, o.nights]));
  return room.occupant_ids
    .filter(id => !infantIds.has(id))
    .reduce((sum, id) => sum + (nightsByPid.get(id) ?? stayNights ?? 1), 0);
}

/** True when any of the room's NON-INFANT occupants carries an explicit
 *  (non-null) nights value — the trigger for showing "X person-nights"
 *  instead of the plain headcount label. F6: infants are excluded from the
 *  money weighting entirely (server filters them out of occupantWeights),
 *  so an infant-only nights edit must not flip the label — it has zero
 *  money effect. */
function hasExplicitNights(room: RoomRow, infantIds: Set<number>): boolean {
  return (room.occupants ?? []).some(o => o.nights != null && !infantIds.has(o.participant_id));
}

function groupRoomsByStay(rooms: RoomRow[]): RoomGroup[] {
  const groups: RoomGroup[] = [];
  for (const r of rooms) {
    let g = groups.find(g2 => g2.stay_label === r.stay_label);
    if (!g) { g = { stay_label: r.stay_label, check_in: r.check_in, check_out: r.check_out, rooms: [] }; groups.push(g); }
    g.rooms.push(r);
  }
  return groups;
}

/** Prefill match: prefer a stay whose check-in/out overlaps the expense's
 *  date range, or whose label matches the description either way; falls
 *  back to the first group when nothing scores. */
function pickBestStayGroup(groups: RoomGroup[], expenseDate: string, endDate: string, description: string): RoomGroup | null {
  if (!groups.length) return null;
  const desc = description.trim().toLowerCase();
  let best = groups[0]; let bestScore = -1;
  for (const g of groups) {
    let score = 0;
    if (g.check_in && expenseDate && g.check_in === expenseDate) score += 2;
    if (g.check_out && endDate && g.check_out === endDate) score += 2;
    if (g.check_in && expenseDate && g.check_in <= expenseDate && (!g.check_out || g.check_out >= expenseDate)) score += 1;
    const label = g.stay_label.toLowerCase();
    if (desc && label && (label.includes(desc) || desc.includes(label))) score += 1;
    if (score > bestScore) { bestScore = score; best = g; }
  }
  return best;
}

/** Proportional prefill by person-nights (v0.26 — weight = nights ??
 *  stayNights ?? 1 per non-infant occupant; equal-weight/all-null-nights
 *  reduces to the v0.25 headcount weighting exactly, since every occupant's
 *  weight is then stayNights ?? 1, a constant per room, so ratios between
 *  rooms are unchanged), summing to totalMyr EXACTLY via shared/roomSplit's
 *  allocateByWeight (same largest-remainder discipline the engine uses,
 *  exported for this purpose — see that file). */
function prefillRoomAmounts(group: RoomGroup, totalMyr: number, infantIds: Set<number>): Record<string, number> {
  const totalSen = Math.round(totalMyr * 100);
  const weights = group.rooms.map(r => personNightsForRoom(r, infantIds, stayNightsForRoom(r, group)));
  const sens = allocateByWeight(totalSen, weights);
  const out: Record<string, number> = {};
  group.rooms.forEach((r, i) => { out[String(r.id)] = sens[i] / 100; });
  return out;
}

/** Equal split in sen with remainder going to the first participants. */
export function equalShares(total: number, ids: number[]): Record<number, number> {
  const out: Record<number, number> = {};
  if (!ids.length) return out;
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / ids.length);
  let rem = cents - base * ids.length;
  for (const id of ids) {
    out[id] = (base + (rem > 0 ? 1 : 0)) / 100;
    if (rem > 0) rem--;
  }
  return out;
}

export default function ExpenseForm({ members, initial, onSubmit, submitLabel, busy, externalPatch, tripId }: {
  members: Participant[];
  initial: ExpenseDraft;
  onSubmit: (payload: any) => Promise<void>;
  submitLabel: string;
  busy?: boolean;
  /** v0.11 keyword chips push values in from outside; bump seq per tap */
  externalPatch?: { seq: number; data: Partial<ExpenseDraft> | ((prev: ExpenseDraft) => Partial<ExpenseDraft>) };
  /** v0.25 — needed to lazily fetch GET /trips/:id/rooms for the room-split
   *  option. Optional so any pre-existing caller that never touches
   *  accommodation expenses keeps compiling untouched; the rooms option
   *  simply never appears without it. */
  tripId?: number;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const [d, setD] = useState<ExpenseDraft>(initial);
  const [err, setErr] = useState('');
  const [fxBusy, setFxBusy] = useState(false);
  const set = (patch: Partial<ExpenseDraft>) => setD(prev => ({ ...prev, ...patch }));

  // ---- v0.25 room-cost splitting (additive) ----
  const [roomsData, setRoomsData] = useState<{ rooms: RoomRow[]; suggested_stays: any[] } | null>(null);
  const [roomsLoading, setRoomsLoading] = useState(false);

  // Fetch rooms lazily when category becomes accommodation; cached in state
  // for the life of this form instance (no refetch on re-render).
  useEffect(() => {
    if (d.category !== 'accommodation' || !tripId || roomsData || roomsLoading) return;
    setRoomsLoading(true);
    api.get(`/trips/${tripId}/rooms`)
      .then(r => setRoomsData({ rooms: r.rooms ?? [], suggested_stays: r.suggested_stays ?? [] }))
      .catch(() => setRoomsData({ rooms: [], suggested_stays: [] }))
      .finally(() => setRoomsLoading(false));
  }, [d.category, tripId, roomsData, roomsLoading]);

  const infantIds = useMemo(() => new Set(members.filter(m => m.is_infant).map(m => m.id)), [members]);
  const roomGroups = useMemo(() => roomsData ? groupRoomsByStay(roomsData.rooms) : [], [roomsData]);
  const activeGroup = useMemo(
    () => d.roomsSplit ? roomGroups.find(g => g.stay_label === d.roomsSplit!.stay_label) ?? null : null,
    [roomGroups, d.roomsSplit],
  );

  const enableRoomsMode = () => {
    const group = pickBestStayGroup(roomGroups, d.expense_date, d.end_date, d.description);
    if (!group) return;
    const amounts = prefillRoomAmounts(group, d.amount_myr, infantIds);
    const dirty: Record<string, boolean> = {};
    for (const k of Object.keys(amounts)) dirty[k] = false;
    set({ roomsSplit: { stay_label: group.stay_label, amounts, dirty } });
  };
  const disableRoomsMode = () => set({ roomsSplit: null });

  const changeStayGroup = (stayLabel: string) => {
    const group = roomGroups.find(g => g.stay_label === stayLabel);
    if (!group) return;
    const amounts = prefillRoomAmounts(group, d.amount_myr, infantIds);
    const dirty: Record<string, boolean> = {};
    for (const k of Object.keys(amounts)) dirty[k] = false;
    set({ roomsSplit: { stay_label: stayLabel, amounts, dirty } });
  };

  const setRoomAmount = (roomId: number, value: number, markDirty = true) => {
    if (!d.roomsSplit) return;
    const key = String(roomId);
    set({
      roomsSplit: {
        ...d.roomsSplit,
        amounts: { ...d.roomsSplit.amounts, [key]: value },
        dirty: markDirty ? { ...d.roomsSplit.dirty, [key]: true } : d.roomsSplit.dirty,
      },
    });
  };

  const balanceLastRoom = () => {
    if (!d.roomsSplit || !activeGroup || activeGroup.rooms.length === 0) return;
    const last = activeGroup.rooms[activeGroup.rooms.length - 1];
    const othersSumSen = activeGroup.rooms.slice(0, -1)
      .reduce((a, r) => a + Math.round((Number(d.roomsSplit!.amounts[String(r.id)]) || 0) * 100), 0);
    const remainingSen = Math.round(d.amount_myr * 100) - othersSumSen;
    if (remainingSen < 0) return;
    setRoomAmount(last.id, remainingSen / 100, true);
  };

  // Recompute non-dirty room amounts when the total or the selected stay
  // changes — never touches rooms the user has hand-edited.
  useEffect(() => {
    if (!d.roomsSplit || !activeGroup) return;
    const fresh = prefillRoomAmounts(activeGroup, d.amount_myr, infantIds);
    setD(prev => {
      if (!prev.roomsSplit) return prev;
      let changed = false;
      const amounts = { ...prev.roomsSplit.amounts };
      for (const r of activeGroup.rooms) {
        const key = String(r.id);
        if (!prev.roomsSplit.dirty[key] && amounts[key] !== fresh[key]) { amounts[key] = fresh[key]; changed = true; }
      }
      return changed ? { ...prev, roomsSplit: { ...prev.roomsSplit, amounts } } : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.amount_myr, activeGroup]);

  // v0.25 F2b — when roomsSplit mode is on but the saved stay group no
  // longer resolves (renamed/deleted), there is nothing to sum against and
  // the remainder MUST NOT read as "balanced" — that early-return-0 hole is
  // what let a stale-stay save reach the server silently. Any non-zero
  // sentinel keeps the `roomsRemainderSen !== 0` submit gate closed; the
  // actual guidance shown to the user is the staleStayMsg block below.
  const ROOMS_STALE_STAY_SENTINEL_SEN = Number.MAX_SAFE_INTEGER;
  const roomsRemainderSen = useMemo(() => {
    if (!d.roomsSplit) return 0;
    if (!activeGroup) return ROOMS_STALE_STAY_SENTINEL_SEN;
    const sumSen = activeGroup.rooms.reduce(
      (a, r) => a + Math.round((Number(d.roomsSplit!.amounts[String(r.id)]) || 0) * 100), 0);
    return Math.round(d.amount_myr * 100) - sumSen;
  }, [d.roomsSplit, activeGroup, d.amount_myr]);

  useEffect(() => {
    if (externalPatch && externalPatch.seq > 0) {
      setD(prev => {
        const raw = typeof externalPatch.data === 'function' ? externalPatch.data(prev) : externalPatch.data;
        const data = { ...raw };
        if (data.due_dates) data.due_dates = [...prev.due_dates, ...data.due_dates]; // chips append dues
        return { ...prev, ...data };
      });
    }
  }, [externalPatch?.seq]);

  useEffect(() => {
    if (d.currency === 'MYR' && (d.fx_rate !== 1 || d.amount_myr !== d.amount_original)) {
      set({ fx_rate: 1, amount_myr: d.amount_original });
    }
  }, [d.currency, d.amount_original]);

  const shares: Record<number, number> = useMemo(() => {
    if (d.custom) return d.customShares;
    return equalShares(d.amount_myr, d.participant_ids);
  }, [d]);
  const shareSum = Object.entries(shares)
    .filter(([id]) => d.participant_ids.includes(Number(id)))
    .reduce((a, [, v]) => a + (Number(v) || 0), 0);
  const sumOk = Math.abs(shareSum - d.amount_myr) <= 0.05;

  const toggleParticipant = (id: number) => {
    const on = d.participant_ids.includes(id);
    set({ participant_ids: on ? d.participant_ids.filter(x => x !== id) : [...d.participant_ids, id] });
  };

  const getRate = async () => {
    const date = d.payment_date || d.expense_date;
    if (!date || d.currency === 'MYR') return;
    setFxBusy(true);
    try {
      const r = await api.get(`/fx?date=${date}&from=${d.currency}&to=MYR`);
      set({ fx_rate: r.rate, amount_myr: Math.round(d.amount_original * r.rate * 100) / 100 });
    } catch {
      setErr('fx_unavailable');
    } finally {
      setFxBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    // v0.25 rooms mode is a fully separate branch — the equal/custom path
    // below (existing code) is never reached when it's active, so that
    // path's payload shape and sumOk gate stay byte-identical.
    if (d.roomsSplit) {
      // v0.25 F2b — the stay this split was built against no longer
      // resolves (renamed/deleted room's stay_label). Nothing safe to send.
      if (!activeGroup) { setErr(t.staleStayMsg); return; }
      if (roomsRemainderSen !== 0) { setErr(t.remainderLeft(fmtMYR(roomsRemainderSen / 100))); return; }
      // v0.25 F2a — build room_amounts from the CURRENT stay's rooms
      // (activeGroup.rooms), matching prior amounts by room id. A room
      // present in d.roomsSplit.amounts but no longer in the stay (deleted)
      // simply drops out here instead of being sent and rejected as
      // unknown_room; a room newly added to the stay that the prefill
      // effect hasn't caught up with yet defaults to 0 (and the remainder
      // gate above catches it, since 0 for that room won't balance the sum).
      const roomAmounts: Record<string, number> = {};
      for (const r of activeGroup.rooms) {
        const key = String(r.id);
        roomAmounts[key] = Number(d.roomsSplit.amounts[key]) || 0;
      }
      const roomsPayload = {
        category: d.category, description: d.description, vendor: d.vendor || undefined,
        location: d.location || undefined,
        expense_date: d.expense_date || undefined, end_date: d.end_date || undefined,
        payment_date: d.payment_date || undefined,
        amount_original: Number(d.amount_original), currency: d.currency,
        fx_rate: Number(d.fx_rate), amount_myr: Number(d.amount_myr),
        payer_participant_id: Number(d.payer_participant_id),
        shares: [] as Array<{ participant_id: number; amount_myr: number }>, // server recomputes for split.mode==='rooms'
        due_dates: d.due_dates.filter(x => x.due_date),
        payment_status: d.payment_status,
        split: { mode: 'rooms' as const, stay_label: d.roomsSplit.stay_label, room_amounts: roomAmounts },
      };
      // v0.25 F2c — no silent failures: a rooms-split save can now be
      // rejected by server-side codes that a client-side gate can't fully
      // prevent (e.g. another tab changed the stay between load and save).
      // Map any known code to one generic, actionable toast; keep the raw
      // code in a console.warn for debugging. Anything unrecognized falls
      // through to the inline error callout as before.
      try {
        await onSubmit(roomsPayload);
      } catch (e) {
        const code = e instanceof ApiError ? e.code : undefined;
        if (code && KNOWN_ROOMS_SPLIT_ERROR_CODES.has(code)) {
          console.warn(`[rooms-split] save rejected: ${code}`);
          toast(t.roomsSplitRejected, 'error');
        } else {
          setErr(t.roomsSplitRejected);
        }
      }
      return;
    }
    if (!sumOk) { setErr(t.sharesMustSum); return; }
    const payload = {
      category: d.category, description: d.description, vendor: d.vendor || undefined,
      location: d.location || undefined,
      expense_date: d.expense_date || undefined, end_date: d.end_date || undefined,
      payment_date: d.payment_date || undefined,
      amount_original: Number(d.amount_original), currency: d.currency,
      fx_rate: Number(d.fx_rate), amount_myr: Number(d.amount_myr),
      payer_participant_id: Number(d.payer_participant_id),
      shares: d.participant_ids.map(id => ({ participant_id: id, amount_myr: Number(shares[id] ?? 0) })),
      due_dates: d.due_dates.filter(x => x.due_date),
      payment_status: d.payment_status,
    };
    await onSubmit(payload);
  };

  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        <label className="fld"><span>{t.category}</span>
          <select value={d.category} onChange={e => set({ category: e.target.value })}>
            {CATEGORIES.map(c => <option key={c} value={c}>{(t as any)[c]}</option>)}
          </select>
        </label>
        <label className="fld"><span>{t.vendor}</span>
          <input value={d.vendor} onChange={e => set({ vendor: e.target.value })} placeholder="Trip.com, Airbnb…" />
        </label>
        <label className="fld full"><span>{t.description}</span>
          <input value={d.description} onChange={e => set({ description: e.target.value })} required />
        </label>
        <label className="fld full"><span>{t.location}</span>
          <input value={d.location} onChange={e => set({ location: e.target.value })} />
        </label>
        <label className="fld"><span>{t.date} ({t.checkIn}/{t.flightLegs})</span>
          <input type="date" value={d.expense_date} onChange={e => set({ expense_date: e.target.value })} />
        </label>
        <label className="fld"><span>{t.checkOut} ({t.optional})</span>
          <input type="date" value={d.end_date} onChange={e => set({ end_date: e.target.value })} />
        </label>
        <label className="fld"><span>{t.paymentDate}</span>
          <input type="date" value={d.payment_date} onChange={e => set({ payment_date: e.target.value })} />
        </label>
        <label className="fld"><span>{t.paymentStatusLbl}</span>
          <select value={d.payment_status} onChange={e => set({ payment_status: e.target.value as any })}>
            <option value="paid">{t.paidLbl}</option>
            <option value="pay_at_hotel">{t.payAtHotel}</option>
          </select>
        </label>
        <label className="fld"><span>{t.amount}</span>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <select style={{ width: 90 }} value={d.currency} onChange={e => set({ currency: e.target.value })}>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
            <input type="number" step="0.01" min="0" value={d.amount_original || ''}
              onChange={e => set({ amount_original: Number(e.target.value) })} required />
          </div>
        </label>
        {d.currency !== 'MYR' && (
          <>
            <label className="fld"><span>{t.fxRate} → MYR</span>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input type="number" step="0.000001" value={d.fx_rate}
                  onChange={e => {
                    const r = Number(e.target.value);
                    set({ fx_rate: r, amount_myr: Math.round(d.amount_original * r * 100) / 100 });
                  }} />
                <button type="button" className="btn ghost sm" onClick={getRate} disabled={fxBusy}>
                  {fxBusy ? '…' : t.getRate}
                </button>
              </div>
            </label>
            <label className="fld"><span>{t.amountMyr}</span>
              <input type="number" step="0.01" value={d.amount_myr}
                onChange={e => set({ amount_myr: Number(e.target.value) })} required />
            </label>
          </>
        )}
        <label className="fld full"><span>{t.payer}</span>
          <select value={d.payer_participant_id} onChange={e => set({ payer_participant_id: Number(e.target.value) })} required>
            <option value={0} disabled>—</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      </div>

      {/* v0.25 — "Split by rooms" option, additive: only shown for
          accommodation expenses with at least one room stay group. Selecting
          it hides the participant-picker + equal/custom blocks below
          (which stay byte-identical when it's off) in favor of the room
          editor. */}
      {d.category === 'accommodation' && roomGroups.length > 0 && (
        <div className="room-split-editor">
          <div className="row" style={{ marginBottom: d.roomsSplit ? 10 : 0 }}>
            <label className="row" style={{ gap: 5 }}>
              <input type="radio" checked={!d.roomsSplit} onChange={disableRoomsMode} /> {t.equalSplit}/{t.customSplit}
            </label>
            <label className="row" style={{ gap: 5 }}>
              <input type="radio" checked={!!d.roomsSplit} onChange={enableRoomsMode} /> {t.splitByRooms}
            </label>
          </div>
          {/* v0.25 F2b — saved split points at a stay_label that no longer
              resolves against the trip's current rooms (the stay was
              renamed or every room in it deleted). There is nothing to
              render or balance against, so show an explicit error instead
              of silently disappearing — the submit gate below also refuses
              this state via the roomsRemainderSen sentinel. */}
          {d.roomsSplit && !activeGroup && (
            <p className="callout warn">{t.staleStayMsg}</p>
          )}
          {d.roomsSplit && activeGroup && (
            <div>
              <label className="fld full" style={{ marginBottom: 8 }}>
                <span>{t.chooseStay}</span>
                <select value={d.roomsSplit.stay_label} onChange={e => changeStayGroup(e.target.value)}>
                  {roomGroups.map(g => <option key={g.stay_label} value={g.stay_label}>{g.stay_label}</option>)}
                </select>
              </label>
              {activeGroup.rooms.map(r => {
                const infants = r.occupant_ids.filter(id => infantIds.has(id)).length;
                const count = r.occupant_ids.length - infants;
                // v0.26 — when any occupant has an explicit nights value,
                // show person-nights alongside the headcount so the label
                // reflects what the server will actually weight the split
                // by (spec §4).
                const explicitNights = hasExplicitNights(r, infantIds);
                const personNights = explicitNights
                  ? personNightsForRoom(r, infantIds, stayNightsForRoom(r, activeGroup))
                  : null;
                return (
                  <div className="room-split-row" key={r.id}>
                    <span>{r.name} <span className="tiny">
                      ({occupancyLabel(count, infants, r.capacity)}
                      {personNights != null && ` · ${t.personNights(personNights)}`})
                    </span></span>
                    <input type="number" step="0.01" min="0" value={d.roomsSplit!.amounts[String(r.id)] ?? 0}
                      onChange={e => setRoomAmount(r.id, Number(e.target.value))} />
                  </div>
                );
              })}
              <div className="row-between" style={{ marginTop: 8 }}>
                <button type="button" className="btn ghost sm" onClick={balanceLastRoom}>{t.balanceLast}</button>
                <span className={`room-split-remainder${roomsRemainderSen !== 0 ? ' err' : ''}`}>
                  {t.remainderLeft(fmtMYR(roomsRemainderSen / 100))}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {!d.roomsSplit && (
      <div style={{ margin: '8px 0 14px' }}>
        <div className="row-between">
          <span style={{ fontWeight: 600, fontSize: '.85rem', color: 'var(--ink-2)' }}>
            {t.participants} ({d.participant_ids.length})
          </span>
          <span className="row">
            <button type="button" className="btn ghost sm"
              onClick={() => set({ participant_ids: members.map(m => m.id) })}>{t.selectAll}</button>
            <button type="button" className="btn ghost sm"
              onClick={() => set({ participant_ids: [] })}>{t.clearAll}</button>
          </span>
        </div>
        <div className="chips" style={{ marginTop: 6 }}>
          {members.map(m => (
            <span key={m.id} className={`chip ${d.participant_ids.includes(m.id) ? 'on' : ''}`}
              onClick={() => toggleParticipant(m.id)}>
              {m.name}{m.is_infant ? ' 👶' : ''}
            </span>
          ))}
        </div>
      </div>
      )}

      {!d.roomsSplit && d.participant_ids.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <label className="row" style={{ gap: 5 }}>
              <input type="radio" checked={!d.custom} onChange={() => set({ custom: false })} /> {t.equalSplit}
              <span className="tiny">({fmtMYR(d.participant_ids.length ? d.amount_myr / d.participant_ids.length : 0)} {t.perPerson})</span>
            </label>
            <label className="row" style={{ gap: 5 }}>
              <input type="radio" checked={d.custom}
                onChange={() => set({ custom: true, customShares: equalShares(d.amount_myr, d.participant_ids) })} /> {t.customSplit}
            </label>
          </div>
          {d.custom && (
            <div>
              {d.participant_ids.map(id => {
                const m = members.find(x => x.id === id);
                return (
                  <div className="share-row" key={id}>
                    <span>{m?.name}</span>
                    <input type="number" step="0.01" value={d.customShares[id] ?? 0}
                      onChange={e => set({ customShares: { ...d.customShares, [id]: Number(e.target.value) } })} />
                  </div>
                );
              })}
              <div className="tiny" style={{ textAlign: 'right', marginTop: 4 }}>
                Σ {fmtMYR(shareSum)} / {fmtMYR(d.amount_myr)}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div className="row-between">
          <span style={{ fontWeight: 600, fontSize: '.85rem', color: 'var(--ink-2)' }}>{t.dueDates}</span>
          <button type="button" className="btn ghost sm"
            onClick={() => set({ due_dates: [...d.due_dates, { due_date: '' }] })}>＋ {t.addDueDate}</button>
        </div>
        {d.due_dates.map((dd, i) => (
          <div className="row" key={i} style={{ marginTop: 6 }}>
            <input type="date" value={dd.due_date} style={{ width: 150, flex: '0 0 auto' }}
              onChange={e => set({ due_dates: d.due_dates.map((x, j) => j === i ? { ...x, due_date: e.target.value } : x) })} />
            <input type="number" step="0.01" placeholder="MYR" value={dd.amount_myr ?? ''} style={{ width: 100, flex: '0 0 auto' }}
              onChange={e => set({ due_dates: d.due_dates.map((x, j) => j === i ? { ...x, amount_myr: Number(e.target.value) || undefined } : x) })} />
            <select value={dd.participant_id ?? 0} style={{ width: 170, flex: '0 0 auto' }}
              title={t.forWhom}
              onChange={e => set({ due_dates: d.due_dates.map((x, j) => j === i ? { ...x, participant_id: Number(e.target.value) || null } : x) })}>
              <option value={0}>{t.wholePayment}</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input placeholder={t.note} value={dd.note ?? ''} style={{ flex: 1, minWidth: 90 }}
              onChange={e => set({ due_dates: d.due_dates.map((x, j) => j === i ? { ...x, note: e.target.value } : x) })} />
            <button type="button" className="icon"
              onClick={() => set({ due_dates: d.due_dates.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
      </div>

      {err && <p className="callout warn">{err}</p>}
      {!d.roomsSplit && !sumOk && d.participant_ids.length > 0 && <p className="callout warn">{t.sharesMustSum}</p>}
      <button className="btn" type="submit"
        disabled={busy || !d.payer_participant_id
          || (d.roomsSplit ? (!activeGroup || roomsRemainderSen !== 0) : d.participant_ids.length === 0)}>
        {submitLabel}
      </button>
    </form>
  );
}
