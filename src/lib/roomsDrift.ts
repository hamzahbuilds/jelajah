import { daysBetween } from '../../shared/days';

// Pure drift-detection helper for v0.25 room-cost-splitting (spec
// docs/13-spec-v0.25-room-split.md §4), extended in v0.26 for per-night
// weights (spec docs/14-spec-v0.26-per-night.md §3/§4). No DB/network
// access — takes the expense's stored split_json (string or already-parsed)
// and the trip's CURRENT rooms payload (GET /trips/:id/rooms), and reports
// whether the room occupants (or, v0.26, their nights) have changed since
// the split was saved. Occupant-set comparison is order-insensitive
// (occupant lists are unordered sets in practice). split_json is NEVER read
// by balance/payment math (§1) — this helper is UI-hint only.
//
// v0.26 both-shape tolerance: the occupants snapshot inside split_json comes
// in two shapes depending on when it was saved —
//   old (pre-T2):  Record<roomId, number[]>                  (plain ids)
//   new (T2+):     Record<roomId, Array<{ id, nights }>>      (id + nights)
// Both must be accepted forever, since old expenses' split_json is never
// rewritten in place. An old-shape snapshot carries no nights information,
// so for it drift can only ever be an occupant-SET change — a same-set,
// nights-only change made after the snapshot was saved is invisible to an
// old-shape snapshot by construction (there was nothing to compare) and
// correctly reports no drift.

// F3 — the same both-shape tolerance applies to the room-level `stay_nights`
// (spec docs/14-spec-v0.26-per-night.md §3): only a snapshot saved AFTER
// this fix carries `room_stay_nights` at all. When it's present, a date edit
// that changes the group's derived stayNights (without necessarily changing
// any occupant's stored nights) now shows drift too. Snapshots without the
// field (v0.26-early or v0.25) stay tolerant — no date-drift — rather than
// false-positiving every pre-existing rooms-split expense.

/** One occupant entry in a room's snapshot — either shape, normalized. */
export interface SnapshotOccupant {
  id: number;
  /** null/undefined when the snapshot shape carries no nights info (old
   *  shape) or when nights was unset (new shape, whole-stay default). */
  nights?: number | null;
}

/** A room's occupant snapshot as stored, either shape. */
export type RoomOccupantSnapshot = number[] | Array<{ id: number; nights?: number | null }>;

export interface RoomsSplitJson {
  mode: string;
  stay_label: string;
  room_amounts: Record<string, number>;
  /** Occupant snapshot at save time, keyed by room id (string). Either the
   *  old plain-id-array shape or the new {id,nights}[] shape (v0.26 §3). */
  occupants: Record<string, RoomOccupantSnapshot>;
  /** F3 — resolved stayNights per room at save time, keyed by room id
   *  (string), number|null. Absent entirely on snapshots saved before this
   *  fix — see the both-shape-tolerance note above. */
  room_stay_nights?: Record<string, number | null>;
}

export interface CurrentRoomOccupant {
  participant_id: number;
  nights: number | null;
}

export interface CurrentRoomRow {
  id: number;
  occupant_ids: number[];
  /** v0.26 (T2 API) — per-occupant nights; optional so a pre-T2 caller (or
   *  a room with no occupants) still type-checks. Absent ⇒ nights-blind
   *  comparison (only occupant-set changes count, same as the old shape). */
  occupants?: CurrentRoomOccupant[];
  /** F3/F4 — needed to derive the room's CURRENT stayNights the same way
   *  the server does (own dates first, else the first sibling by ascending
   *  room id with both dates set). Optional so callers that don't carry
   *  dates still type-check (date-drift then never fires, same as before
   *  this fix). */
  check_in?: string | null;
  check_out?: string | null;
  stay_label?: string;
}

/** True when `snapshot` uses the new {id,nights}[] shape rather than the
 *  old plain number[] shape. An empty array is ambiguous but harmless
 *  either way (no occupants to compare), so it's treated as the new shape. */
function isNewShape(snapshot: RoomOccupantSnapshot): snapshot is Array<{ id: number; nights?: number | null }> {
  return snapshot.length === 0 || typeof snapshot[0] === 'object';
}

/** Normalizes either snapshot shape into `{id, nights}` entries. Old-shape
 *  (plain id) entries get `nights: undefined` — "unknown", not "null" (null
 *  is a meaningful v0.26 value: explicitly whole-stay) — so nights-aware
 *  comparisons can distinguish "no data" from "explicitly no override". */
function normalizeSnapshot(snapshot: RoomOccupantSnapshot): SnapshotOccupant[] {
  if (isNewShape(snapshot)) return snapshot.map(o => ({ id: o.id, nights: o.nights }));
  return (snapshot as number[]).map(id => ({ id, nights: undefined }));
}

function sameOccupantSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const as = [...a].sort((x, y) => x - y);
  const bs = [...b].sort((x, y) => x - y);
  return as.every((v, i) => v === bs[i]);
}

/**
 * True when the snapshot and current occupant lists differ — as a set
 * change, or (only when both sides carry nights info) a nights change for
 * the same set of occupants.
 *
 * Nights comparison only applies when the SNAPSHOT is new-shape (has real
 * nights data to compare) AND the current row carries an occupants[]
 * array (T2 API). An old-shape snapshot has no nights data at all, so it
 * can only ever detect set changes — exactly the v0.25 behavior, preserved
 * unconditionally for every expense saved before T2 shipped.
 */
function occupantsDrifted(
  snapshot: RoomOccupantSnapshot, current: CurrentRoomRow,
  snapshotStayNights: number | null | undefined, currentStayNights: number | null,
): boolean {
  const snapEntries = normalizeSnapshot(snapshot);
  const snapIds = snapEntries.map(o => o.id);
  if (!sameOccupantSet(snapIds, current.occupant_ids)) return true;

  if (!isNewShape(snapshot) || !current.occupants) return false; // nights-blind: set-only comparison

  const currentNightsById = new Map(current.occupants.map(o => [o.participant_id, o.nights ?? null]));
  for (const entry of snapEntries) {
    const snapNights = entry.nights ?? null;
    const curNights = currentNightsById.get(entry.id) ?? null;
    if (snapNights !== curNights) return true;
  }

  // F3 — date-drift: only meaningful when the snapshot actually carries a
  // room_stay_nights entry for this room (snapshotStayNights !== undefined).
  // Absent ⇒ tolerant (old/v0.26-early snapshot, no data to compare).
  if (snapshotStayNights !== undefined && (snapshotStayNights ?? null) !== (currentStayNights ?? null)) return true;

  return false;
}

/** nights derived from one room's own check_in/check_out pair — client
 *  mirror of server/app.ts's nightsFromDates (F4). */
function nightsFromDates(checkIn: string | null | undefined, checkOut: string | null | undefined): number | null {
  if (!checkIn || !checkOut) return null;
  const days = daysBetween(checkIn, checkOut);
  if (days.length < 2) return null;
  return days.length - 1;
}

/** F3/F4 — the CURRENT stayNights per room, grouped by stay_label, mirroring
 *  server/app.ts's stayGroupNights exactly: a room's own dates first, else
 *  the first sibling (ascending room id — deterministic) with both dates
 *  set, else null. Rooms with no stay_label of their own form a singleton
 *  group (defensive; every real row carries one). */
function currentStayNightsByRoom(rooms: CurrentRoomRow[]): Map<number, number | null> {
  const groups = new Map<string, CurrentRoomRow[]>();
  for (const r of rooms) {
    const key = r.stay_label ?? `__room_${r.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const out = new Map<number, number | null>();
  for (const group of groups.values()) {
    const byIdAsc = [...group].sort((a, b) => a.id - b.id);
    const fallback = byIdAsc
      .map(r => nightsFromDates(r.check_in, r.check_out))
      .find((n): n is number => n != null) ?? null;
    for (const r of group) {
      const own = nightsFromDates(r.check_in, r.check_out);
      out.set(r.id, own ?? fallback);
    }
  }
  return out;
}

/** Parses a stored split_json value (raw TEXT from the DB, an
 *  already-parsed object, or null/undefined) into a RoomsSplitJson, or
 *  null when it isn't a rooms-mode split (or is malformed). */
export function parseRoomsSplitJson(splitJson: unknown): RoomsSplitJson | null {
  if (!splitJson) return null;
  let obj: any = splitJson;
  if (typeof splitJson === 'string') {
    try { obj = JSON.parse(splitJson); } catch { return null; }
  }
  if (!obj || typeof obj !== 'object' || obj.mode !== 'rooms' || !obj.occupants || typeof obj.occupants !== 'object') {
    return null;
  }
  return obj as RoomsSplitJson;
}

/**
 * True when any room in the split's occupant snapshot now has a different
 * set of occupants (added/removed/swapped) than at save time, or (v0.26,
 * new-shape snapshots only) any occupant's nights value has changed, or
 * when a snapshotted room no longer exists at all (deleted room ⇒
 * drifted). Non-rooms splits (or missing/malformed split_json) never
 * drift — returns false so callers can call this unconditionally per
 * expense row.
 */
export function roomsDrift(splitJson: unknown, currentRooms: CurrentRoomRow[]): boolean {
  const sj = parseRoomsSplitJson(splitJson);
  if (!sj) return false;
  const byId = new Map(currentRooms.map(r => [String(r.id), r]));
  const currentStayNightsById = currentStayNightsByRoom(currentRooms);
  for (const roomId of Object.keys(sj.occupants)) {
    const snapshot = sj.occupants[roomId] ?? [];
    const current = byId.get(roomId);
    if (!current) return true; // room deleted since the split was saved
    const snapshotStayNights = sj.room_stay_nights ? (sj.room_stay_nights[roomId] ?? null) : undefined;
    const currentStayNights = currentStayNightsById.get(current.id) ?? null;
    if (occupantsDrifted(snapshot, current, snapshotStayNights, currentStayNights)) return true;
  }
  return false;
}
