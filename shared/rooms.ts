// Pure helpers for v0.21 room allocation — no DB/env access, unit-tested.

/** "3/4", "3+1/4" (infants shown as a "+n" add-on, excluded from the capacity
 *  math), "3" / "3+1" when capacity is unspecified (null/undefined). */
export function occupancyLabel(count: number, infants: number, capacity?: number | null): string {
  const base = infants > 0 ? `${count}+${infants}` : `${count}`;
  return capacity == null ? base : `${base}/${capacity}`;
}

/** Single-occupancy-per-stay-group rule: assigning participants into `roomId`
 *  must first remove them from every OTHER room in the same trip_id+stay_label
 *  group. Pure — just filters the target room out of the sibling list and
 *  short-circuits when there's nothing to assign. */
export function singleOccupancyBatch(
  roomId: number,
  participantIds: number[],
  siblingRoomIds: number[],
): { deleteFrom: number[] } {
  if (!participantIds.length) return { deleteFrom: [] };
  return { deleteFrom: siblingRoomIds.filter(id => id !== roomId) };
}
