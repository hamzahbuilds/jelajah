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
  INVALID_WEIGHT: 'invalid_weight',
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
  /**
   * Optional per-occupant weights (spec docs/14-spec-v0.26-per-night.md §2),
   * e.g. person-nights. Keyed by participant_id → positive integer weight.
   * ADDITIVE: absent (or undefined) ⇒ every non-infant occupant is weighted
   * equally, reproducing v0.25 output byte-for-byte (the internal allocator
   * below is provably equivalent to the old base/remainder arithmetic when
   * every weight is 1 — see `weightedShares`). When present, every
   * non-infant occupant of this room MUST have a corresponding entry that is
   * a finite positive integer, or `roomShares` throws 'invalid_weight'.
   * Infant occupants may appear in the map (ignored) or be omitted.
   */
  occupantWeights?: Record<number, number>;
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
 * Internal weighted largest-remainder allocator for `roomShares`. Splits
 * `amountSen` whole sens across `ids` (assumed pre-sorted ascending —
 * callers must sort first) proportionally to the parallel `weights` array
 * (all-positive integers, `weights.length === ids.length`, sum > 0).
 *
 * base[i] = floor(amountSen * weights[i] / sumWeights); the leftover sens
 * (amountSen - sum(base)) go one each to the entries with the largest
 * fractional remainder, ties broken by ascending participant_id (spec
 * docs/14-spec-v0.26-per-night.md §2, same tie rule as v0.25).
 *
 * Equivalence proof (equal-weight ⇒ v0.25-identical): when every weight is
 * 1, sumWeights = n and raw[i] = amountSen * 1 / n = amountSen / n exactly
 * as computed by the old `Math.floor(amountSen / n)` — multiplying by 1 is a
 * no-op in IEEE754, so base[i] is bit-identical to the old `base`. The
 * leftover is amountSen - n*floor(amountSen/n), the same integer identity
 * the old code computed directly via `amountSen % n`. Every weight's
 * fractional remainder is then equal, so the tie-break (ascending id) alone
 * decides who gets the extra sen — exactly the old "first `remainder`
 * ascending ids" rule. Hence this function reproduces v0.25 output exactly
 * for the equal-weight (occupantWeights absent) path.
 */
function weightedShares(amountSen: number, ids: number[], weights: number[]): Map<number, number> {
  const sumW = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map(w => (amountSen * w) / sumW);
  const base = raw.map(Math.floor);
  const used = base.reduce((a, b) => a + b, 0);
  let remainder = amountSen - used;
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || ids[a.i] - ids[b.i]);
  const sens = [...base];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    sens[order[k].i] += 1;
  }
  const map = new Map<number, number>();
  ids.forEach((id, idx) => map.set(id, sens[idx]));
  return map;
}

/**
 * Splits a total accommodation amount across rooms, then within each room
 * splits that room's amount among its non-infant occupants — equally by
 * default, or proportionally to `room.occupantWeights` when supplied (spec
 * docs/14-spec-v0.26-per-night.md §2) — using largest-remainder rounding to
 * the sen. Infant occupants always get a visible 0-amount row.
 *
 * Tie-break rule (documented, deterministic): when a room's amount doesn't
 * divide evenly among its non-infant occupants, the leftover sens are handed
 * out one each to the occupants with the largest fractional remainder first,
 * ties broken by the lowest participant_id (ascending order), until the
 * remainder is exhausted. In equal-weight mode every fractional remainder is
 * identical, so this reduces to "lowest participant_id first" — the
 * original v0.25 rule, reproduced exactly (see `weightedShares` above).
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

    const sortedIds = [...nonInfantIds].sort((a, b) => a - b);

    let weights: number[];
    if (room.occupantWeights) {
      weights = sortedIds.map(id => {
        const w = room.occupantWeights![id];
        if (!(typeof w === 'number' && Number.isFinite(w) && Number.isInteger(w) && w > 0)) {
          throw new RoomSplitError(
            ROOM_SPLIT_ERROR_CODES.INVALID_WEIGHT,
            `room ${room.id} participant ${id} has an invalid or missing weight (must be a finite positive integer)`,
          );
        }
        return w;
      });
    } else {
      // Equal weights (v0.25 default path). Provably identical output to
      // the old base/remainder arithmetic — see weightedShares() below.
      weights = sortedIds.map(() => 1);
    }

    const sensById = weightedShares(amountSen, sortedIds, weights);
    sortedIds.forEach(id => {
      out.push({ participant_id: id, amount_myr: sensById.get(id)! / 100 });
    });

    for (const id of infantOccupantIds) out.push({ participant_id: id, amount_myr: 0 });
  });

  return out;
}

/**
 * Weighted largest-remainder allocator — client-side UI PREFILL ONLY (spec
 * §4). Positional (index-keyed, not participant_id-keyed) sibling of the
 * internal `weightedShares` used by `roomShares`, exported so ExpenseForm's
 * room-editor prefill can reuse the same rounding discipline instead of
 * reimplementing it, guaranteeing the prefilled room amounts sum to
 * `totalSen` exactly — including v0.26 person-nights weights (T3 passes a
 * weights array here; no change needed to this function's signature, since
 * it was already generic over arbitrary positive weights). Splits
 * `totalSen` whole sens across `weights` proportionally; base =
 * floor(share), then the leftover sens go to the entries with the largest
 * fractional remainder (ties broken by ascending index, deterministic). A
 * prefill is a starting point the user can freely edit — it is never
 * persisted as-is, so it carries none of the throw-on-mismatch guarantees
 * `roomShares` enforces on the real split.
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
