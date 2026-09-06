// Pure drift-detection helper for v0.25 room-cost-splitting (spec
// docs/13-spec-v0.25-room-split.md §4). No DB/network access — takes the
// expense's stored split_json (string or already-parsed) and the trip's
// CURRENT rooms payload (GET /trips/:id/rooms), and reports whether the
// room occupants have changed since the split was saved. Comparison is
// order-insensitive (occupant lists are unordered sets in practice).
// split_json is NEVER read by balance/payment math (§1) — this helper is
// UI-hint only.

export interface RoomsSplitJson {
  mode: string;
  stay_label: string;
  room_amounts: Record<string, number>;
  /** Occupant snapshot at save time, keyed by room id (string). */
  occupants: Record<string, number[]>;
}

export interface CurrentRoomRow {
  id: number;
  occupant_ids: number[];
}

function sameOccupantSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const as = [...a].sort((x, y) => x - y);
  const bs = [...b].sort((x, y) => x - y);
  return as.every((v, i) => v === bs[i]);
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
 * set of occupants (added/removed/swapped) than at save time, or when a
 * snapshotted room no longer exists at all (deleted room ⇒ drifted).
 * Non-rooms splits (or missing/malformed split_json) never drift — returns
 * false so callers can call this unconditionally per expense row.
 */
export function roomsDrift(splitJson: unknown, currentRooms: CurrentRoomRow[]): boolean {
  const sj = parseRoomsSplitJson(splitJson);
  if (!sj) return false;
  const byId = new Map(currentRooms.map(r => [String(r.id), r.occupant_ids]));
  for (const roomId of Object.keys(sj.occupants)) {
    const snapshot = sj.occupants[roomId] ?? [];
    const current = byId.get(roomId);
    if (!current) return true; // room deleted since the split was saved
    if (!sameOccupantSet(snapshot, current)) return true;
  }
  return false;
}
