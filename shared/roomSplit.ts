// Pure room-cost-splitting engine — spec docs/13-spec-v0.25-room-split.md §2.
// MONEY-CRITICAL: no imports, no DB/env access, unit-tested exhaustively in
// tests/roomSplit.test.ts. All arithmetic is done in integer sen internally;
// MYR floats only cross the boundary at input (Math.round(x*100)) and output
// (sen/100), so no floating-point drift can accumulate mid-computation.

/** Typed error codes this engine throws. Documented here as the source of
 *  truth — callers should switch on `.code`, never parse `.message`. */
export const ROOM_SPLIT_ERROR_CODES = {
  SUM_MISMATCH: 'sum_mismatch',
  EMPTY_ROOM_NONZERO: 'empty_room_nonzero',
  INFANT_ONLY_ROOM: 'infant_only_room',
  NEGATIVE_AMOUNT: 'negative_amount',
  INVALID_AMOUNT: 'invalid_amount',
  DUPLICATE_OCCUPANT: 'duplicate_occupant',
} as const;

export type RoomSplitErrorCode = typeof ROOM_SPLIT_ERROR_CODES[keyof typeof ROOM_SPLIT_ERROR_CODES];

export class RoomSplitError extends Error {
  code: RoomSplitErrorCode;
  constructor(code: RoomSplitErrorCode, message: string) {
    super(message);
    this.name = 'RoomSplitError';
    this.code = code;
  }
}

export interface RoomSplitRoom {
  id: number;
  amountMyr: number;
  occupantIds: number[];
}

export interface RoomSplitInput {
  totalMyr: number;
  rooms: RoomSplitRoom[];
  infantIds: Set<number>;
}

export interface RoomShare {
  participant_id: number;
  amount_myr: number;
}

/**
 * Splits a total accommodation amount across rooms, then within each room
 * splits that room's amount equally among its non-infant occupants using
 * largest-remainder rounding to the sen. Infant occupants always get a
 * visible 0-amount row.
 *
 * Tie-break rule (documented, deterministic): when a room's amount doesn't
 * divide evenly among its non-infant occupants, the leftover sens are handed
 * out one each to the occupants with the lowest participant_id first
 * (ascending order), until the remainder is exhausted.
 */
export function roomShares(input: RoomSplitInput): RoomShare[] {
  const { totalMyr, rooms, infantIds } = input;

  if (!Number.isFinite(totalMyr)) {
    throw new RoomSplitError(ROOM_SPLIT_ERROR_CODES.INVALID_AMOUNT, 'totalMyr must be a finite number');
  }
  for (const room of rooms) {
    if (!Number.isFinite(room.amountMyr)) {
      throw new RoomSplitError(
        ROOM_SPLIT_ERROR_CODES.INVALID_AMOUNT,
        `room ${room.id} amountMyr must be a finite number`,
      );
    }
  }

  if (totalMyr < 0) {
    throw new RoomSplitError(ROOM_SPLIT_ERROR_CODES.NEGATIVE_AMOUNT, 'totalMyr cannot be negative');
  }
  for (const room of rooms) {
    if (room.amountMyr < 0) {
      throw new RoomSplitError(
        ROOM_SPLIT_ERROR_CODES.NEGATIVE_AMOUNT,
        `room ${room.id} amountMyr cannot be negative`,
      );
    }
  }

  const seenOccupantIds = new Set<number>();
  for (const room of rooms) {
    for (const id of room.occupantIds) {
      if (seenOccupantIds.has(id)) {
        throw new RoomSplitError(
          ROOM_SPLIT_ERROR_CODES.DUPLICATE_OCCUPANT,
          `participant ${id} appears more than once across rooms (within a room or across two rooms)`,
        );
      }
      seenOccupantIds.add(id);
    }
  }

  const totalSen = Math.round(totalMyr * 100);
  const roomSens = rooms.map(r => Math.round(r.amountMyr * 100));
  const sumRoomsSen = roomSens.reduce((a, b) => a + b, 0);

  // Tolerance of 0.005 MYR (half a sen) per spec — since both sides are
  // already rounded to whole sens, any real mismatch is >= 1 sen (0.01 MYR),
  // so an exact integer comparison is equivalent to the spec's tolerance
  // while still absorbing float-representation dust from the *100 step.
  if (Math.abs(sumRoomsSen - totalSen) > 0.5) {
    throw new RoomSplitError(
      ROOM_SPLIT_ERROR_CODES.SUM_MISMATCH,
      `room amounts sum to ${sumRoomsSen / 100} but total is ${totalSen / 100}`,
    );
  }

  const out: RoomShare[] = [];

  rooms.forEach((room, i) => {
    const amountSen = roomSens[i];
    const nonInfantIds = room.occupantIds.filter(id => !infantIds.has(id));
    const infantOccupantIds = room.occupantIds.filter(id => infantIds.has(id));

    if (room.occupantIds.length === 0) {
      if (amountSen > 0) {
        throw new RoomSplitError(
          ROOM_SPLIT_ERROR_CODES.EMPTY_ROOM_NONZERO,
          `room ${room.id} has no occupants but amount > 0`,
        );
      }
      return;
    }

    if (nonInfantIds.length === 0) {
      if (amountSen > 0) {
        throw new RoomSplitError(
          ROOM_SPLIT_ERROR_CODES.INFANT_ONLY_ROOM,
          `room ${room.id} has only infant occupants but amount > 0`,
        );
      }
      for (const id of infantOccupantIds) out.push({ participant_id: id, amount_myr: 0 });
      return;
    }

    const n = nonInfantIds.length;
    const base = Math.floor(amountSen / n);
    const remainder = amountSen % n;
    const sortedIds = [...nonInfantIds].sort((a, b) => a - b);

    sortedIds.forEach((id, idx) => {
      const sen = base + (idx < remainder ? 1 : 0);
      out.push({ participant_id: id, amount_myr: sen / 100 });
    });

    for (const id of infantOccupantIds) out.push({ participant_id: id, amount_myr: 0 });
  });

  return out;
}

/**
 * Weighted largest-remainder allocator — client-side UI PREFILL ONLY (spec
 * §4). Not used by `roomShares` above, which keeps its own equal-weight
 * remainder logic untouched (money-critical freeze); this is exported
 * purely so ExpenseForm's room-editor prefill can reuse the same rounding
 * discipline instead of reimplementing it, guaranteeing the prefilled room
 * amounts sum to `totalSen` exactly. Splits `totalSen` whole sens across
 * `weights` proportionally; base = floor(share), then the leftover sens go
 * to the entries with the largest fractional remainder (ties broken by
 * ascending index, deterministic). A prefill is a starting point the user
 * can freely edit — it is never persisted as-is, so it carries none of the
 * throw-on-mismatch guarantees `roomShares` enforces on the real split.
 */
export function allocateByWeight(totalSen: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) {
    // Nothing to weight by (e.g. every room is infant-only/empty) — dump the
    // whole amount on the first slot so the sum invariant still holds
    // exactly; the user edits from there.
    return weights.map((_, i) => (i === 0 ? totalSen : 0));
  }
  const raw = weights.map(w => (totalSen * w) / sumW);
  const base = raw.map(Math.floor);
  const used = base.reduce((a, b) => a + b, 0);
  let remainder = totalSen - used;
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = [...base];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    out[order[k].i] += 1;
  }
  return out;
}
