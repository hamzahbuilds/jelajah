import { describe, it, expect } from 'vitest';
import { roomShares, RoomSplitError } from '../shared/roomSplit';
import type { RoomSplitRoom } from '../shared/roomSplit';

// Deterministic seeded PRNG (mulberry32) so the property-style loop below is
// reproducible across runs/CI — no external deps, pure JS.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sumMyr(rows: { amount_myr: number }[]): number {
  // sum in sen to avoid float drift in the assertion itself
  const sen = rows.reduce((acc, r) => acc + Math.round(r.amount_myr * 100), 0);
  return sen / 100;
}

describe('roomShares — conservation', () => {
  it('RM100.01 across a 3-occupant + 3-occupant pair of rooms (uneven sens)', () => {
    // RM100.01 split as 50.01 + 50.00 across two 3-occupant rooms
    const input = {
      totalMyr: 100.01,
      rooms: [
        { id: 1, amountMyr: 50.01, occupantIds: [1, 2, 3] },
        { id: 2, amountMyr: 50.0, occupantIds: [4, 5, 6] },
      ],
      infantIds: new Set<number>(),
    };
    const out = roomShares(input);
    expect(sumMyr(out)).toBe(100.01);
    expect(out.every(r => r.amount_myr >= 0)).toBe(true);
  });

  it('RM999.99 across rooms of 1/5/7 non-infant occupants', () => {
    const ids1 = [1];
    const ids2 = [2, 3, 4, 5, 6];
    const ids3 = [7, 8, 9, 10, 11, 12, 13];
    // Pick arbitrary amounts that sum exactly to 999.99
    const input = {
      totalMyr: 999.99,
      rooms: [
        { id: 1, amountMyr: 100.0, occupantIds: ids1 },
        { id: 2, amountMyr: 400.0, occupantIds: ids2 },
        { id: 3, amountMyr: 499.99, occupantIds: ids3 },
      ],
      infantIds: new Set<number>(),
    };
    const out = roomShares(input);
    expect(sumMyr(out)).toBe(999.99);
    expect(out.every(r => r.amount_myr >= 0)).toBe(true);
  });

  it('16-person realistic case (4 rooms, mixed amounts)', () => {
    const input = {
      totalMyr: 1234.57,
      rooms: [
        { id: 1, amountMyr: 300.11, occupantIds: [1, 2, 3, 4] },
        { id: 2, amountMyr: 350.22, occupantIds: [5, 6, 7, 8, 9] },
        { id: 3, amountMyr: 284.24, occupantIds: [10, 11, 12] },
        { id: 4, amountMyr: 300.0, occupantIds: [13, 14, 15, 16] },
      ],
      infantIds: new Set<number>([16]),
    };
    const out = roomShares(input);
    expect(sumMyr(out)).toBe(1234.57);
    expect(out.every(r => r.amount_myr >= 0)).toBe(true);
    // infant present in output with amount 0
    const infantRow = out.find(r => r.participant_id === 16);
    expect(infantRow?.amount_myr).toBe(0);
  });

  it('randomized property-style loop (~50 seeded cases): conservation + non-negativity', () => {
    const rand = mulberry32(20260906);
    for (let trial = 0; trial < 50; trial++) {
      const roomCount = 1 + Math.floor(rand() * 4); // 1..4 rooms
      let nextId = 1;
      const rooms: RoomSplitRoom[] = [];
      const infantIds = new Set<number>();
      const roomAmountsSen: number[] = [];

      for (let r = 0; r < roomCount; r++) {
        const occCount = 1 + Math.floor(rand() * 6); // 1..6 occupants
        const occupantIds: number[] = [];
        for (let o = 0; o < occCount; o++) {
          const id = nextId++;
          occupantIds.push(id);
          // ~15% chance of being an infant, but never make a room infant-only
          if (rand() < 0.15 && !(occCount === 1)) infantIds.add(id);
        }
        // guarantee at least one non-infant in the room
        if (occupantIds.every(id => infantIds.has(id))) infantIds.delete(occupantIds[0]);

        const amountSen = Math.floor(rand() * 100000); // 0..999.99 in sen
        roomAmountsSen.push(amountSen);
        rooms.push({ id: r + 1, amountMyr: amountSen / 100, occupantIds });
      }

      const totalSen = roomAmountsSen.reduce((a, b) => a + b, 0);
      const input = { totalMyr: totalSen / 100, rooms, infantIds };
      const out = roomShares(input);
      expect(sumMyr(out)).toBe(totalSen / 100);
      expect(out.every(r => r.amount_myr >= 0)).toBe(true);
    }
  });
});

describe('roomShares — largest-remainder distribution', () => {
  it('RM100.00 / 3 occupants → 33.34/33.33/33.33, extra sen to the earliest (ascending) participant_id', () => {
    const input = {
      totalMyr: 100.0,
      rooms: [{ id: 1, amountMyr: 100.0, occupantIds: [3, 1, 2] }], // deliberately out of order
      infantIds: new Set<number>(),
    };
    const out = roomShares(input);
    const byId = new Map(out.map(r => [r.participant_id, r.amount_myr]));
    // 10000 sen / 3 = 3333 base, remainder 1 -> earliest ascending id (1) gets the extra sen
    expect(byId.get(1)).toBe(33.34);
    expect(byId.get(2)).toBe(33.33);
    expect(byId.get(3)).toBe(33.33);
    expect(sumMyr(out)).toBe(100.0);
  });

  it('remainder of 2 goes to the two lowest ascending ids', () => {
    // 10.01 -> 1001 sen / 3 = 333 base, remainder 2 -> ids 1 and 2 get 334, id 3 gets 333
    const input = {
      totalMyr: 10.01,
      rooms: [{ id: 1, amountMyr: 10.01, occupantIds: [2, 3, 1] }],
      infantIds: new Set<number>(),
    };
    const out = roomShares(input);
    const byId = new Map(out.map(r => [r.participant_id, r.amount_myr]));
    expect(byId.get(1)).toBe(3.34);
    expect(byId.get(2)).toBe(3.34);
    expect(byId.get(3)).toBe(3.33);
    expect(sumMyr(out)).toBe(10.01);
  });
});

describe('roomShares — infants', () => {
  it('infant occupants get amount 0 rows (present in output); non-infants share the full room amount', () => {
    const input = {
      totalMyr: 100.0,
      rooms: [{ id: 1, amountMyr: 100.0, occupantIds: [1, 2, 3] }],
      infantIds: new Set<number>([3]),
    };
    const out = roomShares(input);
    const byId = new Map(out.map(r => [r.participant_id, r.amount_myr]));
    expect(byId.get(3)).toBe(0);
    expect(byId.get(1)).toBe(50.0);
    expect(byId.get(2)).toBe(50.0);
    expect(sumMyr(out)).toBe(100.0);
  });

  it('infant-only room with amount 0 is valid: infant present, owes 0', () => {
    const input = {
      totalMyr: 0,
      rooms: [{ id: 1, amountMyr: 0, occupantIds: [1] }],
      infantIds: new Set<number>([1]),
    };
    const out = roomShares(input);
    expect(out).toEqual([{ participant_id: 1, amount_myr: 0 }]);
  });
});

describe('roomShares — errors', () => {
  it('sum mismatch beyond 0.005 throws sum_mismatch', () => {
    const input = {
      totalMyr: 100.0,
      rooms: [{ id: 1, amountMyr: 90.0, occupantIds: [1, 2] }],
      infantIds: new Set<number>(),
    };
    expect(() => roomShares(input)).toThrow(RoomSplitError);
    try {
      roomShares(input);
      expect.unreachable();
    } catch (e) {
      expect((e as RoomSplitError).code).toBe('sum_mismatch');
    }
  });

  it('room with occupants=[] but amount>0 throws empty_room_nonzero', () => {
    const input = {
      totalMyr: 50.0,
      rooms: [{ id: 1, amountMyr: 50.0, occupantIds: [] as number[] }],
      infantIds: new Set<number>(),
    };
    try {
      roomShares(input);
      expect.unreachable();
    } catch (e) {
      expect((e as RoomSplitError).code).toBe('empty_room_nonzero');
    }
  });

  it('room with ONLY infants and amount>0 throws infant_only_room', () => {
    const input = {
      totalMyr: 50.0,
      rooms: [{ id: 1, amountMyr: 50.0, occupantIds: [1, 2] }],
      infantIds: new Set<number>([1, 2]),
    };
    try {
      roomShares(input);
      expect.unreachable();
    } catch (e) {
      expect((e as RoomSplitError).code).toBe('infant_only_room');
    }
  });

  it('negative room amount throws negative_amount', () => {
    const input = {
      totalMyr: -10.0,
      rooms: [{ id: 1, amountMyr: -10.0, occupantIds: [1, 2] }],
      infantIds: new Set<number>(),
    };
    try {
      roomShares(input);
      expect.unreachable();
    } catch (e) {
      expect((e as RoomSplitError).code).toBe('negative_amount');
    }
  });

  it('negative total amount (with a valid non-negative room) throws negative_amount', () => {
    const input = {
      totalMyr: -5.0,
      rooms: [{ id: 1, amountMyr: 5.0, occupantIds: [1] }],
      infantIds: new Set<number>(),
    };
    try {
      roomShares(input);
      expect.unreachable();
    } catch (e) {
      expect((e as RoomSplitError).code).toBe('negative_amount');
    }
  });

  it('NaN totalMyr throws invalid_amount', () => {
    const input = {
      totalMyr: NaN,
      rooms: [{ id: 1, amountMyr: 5.0, occupantIds: [1] }],
      infantIds: new Set<number>(),
    };
    try {
      roomShares(input);
      expect.unreachable();
    } catch (e) {
      expect((e as RoomSplitError).code).toBe('invalid_amount');
    }
  });

  it('Infinity room amount throws invalid_amount', () => {
    const input = {
      totalMyr: Infinity,
      rooms: [{ id: 1, amountMyr: Infinity, occupantIds: [1] }],
      infantIds: new Set<number>(),
    };
    try {
      roomShares(input);
      expect.unreachable();
    } catch (e) {
      expect((e as RoomSplitError).code).toBe('invalid_amount');
    }
  });

  it('-Infinity totalMyr throws invalid_amount', () => {
    const input = {
      totalMyr: -Infinity,
      rooms: [{ id: 1, amountMyr: 5.0, occupantIds: [1] }],
      infantIds: new Set<number>(),
    };
    try {
      roomShares(input);
      expect.unreachable();
    } catch (e) {
      expect((e as RoomSplitError).code).toBe('invalid_amount');
    }
  });

  it('NaN room amount throws invalid_amount', () => {
    const input = {
      totalMyr: 5.0,
      rooms: [{ id: 1, amountMyr: NaN, occupantIds: [1] }],
      infantIds: new Set<number>(),
    };
    try {
      roomShares(input);
      expect.unreachable();
    } catch (e) {
      expect((e as RoomSplitError).code).toBe('invalid_amount');
    }
  });

  it('duplicate occupant id within a single room throws duplicate_occupant', () => {
    const input = {
      totalMyr: 10.0,
      rooms: [{ id: 1, amountMyr: 10.0, occupantIds: [1, 1, 2] }],
      infantIds: new Set<number>(),
    };
    try {
      roomShares(input);
      expect.unreachable();
    } catch (e) {
      expect((e as RoomSplitError).code).toBe('duplicate_occupant');
    }
  });

  it('duplicate occupant id across two different rooms throws duplicate_occupant', () => {
    const input = {
      totalMyr: 20.0,
      rooms: [
        { id: 1, amountMyr: 10.0, occupantIds: [5, 1] },
        { id: 2, amountMyr: 10.0, occupantIds: [5, 2] },
      ],
      infantIds: new Set<number>(),
    };
    try {
      roomShares(input);
      expect.unreachable();
    } catch (e) {
      expect((e as RoomSplitError).code).toBe('duplicate_occupant');
    }
  });

  it('distinct occupant ids across rooms pass validation', () => {
    const input = {
      totalMyr: 20.0,
      rooms: [
        { id: 1, amountMyr: 10.0, occupantIds: [1, 2] },
        { id: 2, amountMyr: 10.0, occupantIds: [3, 4] },
      ],
      infantIds: new Set<number>(),
    };
    const out = roomShares(input);
    expect(sumMyr(out)).toBe(20.0);
  });
});

describe('roomShares — zero-amount room with occupants', () => {
  it('is valid; all occupants owe 0', () => {
    const input = {
      totalMyr: 0,
      rooms: [{ id: 1, amountMyr: 0, occupantIds: [1, 2, 3] }],
      infantIds: new Set<number>(),
    };
    const out = roomShares(input);
    expect(out).toEqual([
      { participant_id: 1, amount_myr: 0 },
      { participant_id: 2, amount_myr: 0 },
      { participant_id: 3, amount_myr: 0 },
    ]);
  });
});
