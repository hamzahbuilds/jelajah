import { describe, it, expect } from 'vitest';
import { roomsDrift, parseRoomsSplitJson } from '../src/lib/roomsDrift';

const splitJson = (occupants: Record<string, number[]>) =>
  JSON.stringify({ mode: 'rooms', stay_label: 'Osaka 1-3', room_amounts: { '1': 100, '2': 50 }, occupants });

describe('parseRoomsSplitJson', () => {
  it('parses a stored rooms-mode split_json string', () => {
    const parsed = parseRoomsSplitJson(splitJson({ '1': [1, 2] }));
    expect(parsed?.mode).toBe('rooms');
    expect(parsed?.occupants).toEqual({ '1': [1, 2] });
  });

  it('returns null for null/undefined', () => {
    expect(parseRoomsSplitJson(null)).toBeNull();
    expect(parseRoomsSplitJson(undefined)).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(parseRoomsSplitJson('{not json')).toBeNull();
  });

  it('returns null for a non-rooms mode', () => {
    expect(parseRoomsSplitJson(JSON.stringify({ mode: 'equal' }))).toBeNull();
  });

  it('accepts an already-parsed object', () => {
    expect(parseRoomsSplitJson({ mode: 'rooms', occupants: { '1': [1] } })).not.toBeNull();
  });
});

describe('roomsDrift', () => {
  const currentRooms = [
    { id: 1, occupant_ids: [1, 2] },
    { id: 2, occupant_ids: [3] },
  ];

  it('is false when occupants match exactly', () => {
    expect(roomsDrift(splitJson({ '1': [1, 2], '2': [3] }), currentRooms)).toBe(false);
  });

  it('is false when occupant order differs but the set is the same', () => {
    expect(roomsDrift(splitJson({ '1': [2, 1], '2': [3] }), currentRooms)).toBe(false);
  });

  it('is true when a participant was added to a room', () => {
    expect(roomsDrift(splitJson({ '1': [1], '2': [3] }), currentRooms)).toBe(true);
  });

  it('is true when a participant was removed from a room', () => {
    expect(roomsDrift(splitJson({ '1': [1, 2, 4], '2': [3] }), currentRooms)).toBe(true);
  });

  it('is true when occupants were swapped between rooms (same counts)', () => {
    expect(roomsDrift(splitJson({ '1': [3], '2': [1, 2] }), currentRooms)).toBe(true);
  });

  it('is true when a snapshotted room no longer exists', () => {
    expect(roomsDrift(splitJson({ '1': [1, 2], '9': [5] }), currentRooms)).toBe(true);
  });

  it('is false for a non-rooms split_json', () => {
    expect(roomsDrift(JSON.stringify({ mode: 'equal' }), currentRooms)).toBe(false);
  });

  it('is false for null/missing split_json', () => {
    expect(roomsDrift(null, currentRooms)).toBe(false);
    expect(roomsDrift(undefined, currentRooms)).toBe(false);
  });

  it('is false when snapshot has no rooms at all', () => {
    expect(roomsDrift(splitJson({}), currentRooms)).toBe(false);
  });
});

// v0.26 — both-shape tolerance (spec docs/14-spec-v0.26-per-night.md §3/§4).
// split_json occupants snapshots come in two shapes: the pre-T2 plain
// number[] shape (no nights info at all), and the T2+ {id,nights}[] shape.
// Both must be accepted forever, since old expenses' split_json is never
// rewritten in place.
describe('roomsDrift — both snapshot shapes (v0.26)', () => {
  const newSplitJson = (occupants: Record<string, Array<{ id: number; nights: number | null }>>) =>
    JSON.stringify({ mode: 'rooms', stay_label: 'Osaka 1-3', room_amounts: { '1': 100, '2': 50 }, occupants });

  it('old-shape snapshot: no drift when the occupant set is unchanged', () => {
    const currentRooms = [
      { id: 1, occupant_ids: [1, 2], occupants: [{ participant_id: 1, nights: 2 }, { participant_id: 2, nights: null }] },
      { id: 2, occupant_ids: [3], occupants: [{ participant_id: 3, nights: null }] },
    ];
    // old-shape snapshot has no nights data — even though the CURRENT rows
    // now carry explicit nights (room 1's occupant 1 is set to 2 nights),
    // an old-shape snapshot can't see that: only the occupant SET matters.
    expect(roomsDrift(splitJson({ '1': [1, 2], '2': [3] }), currentRooms)).toBe(false);
  });

  it('old-shape snapshot: drift when a member changes (set-only comparison)', () => {
    const currentRooms = [
      { id: 1, occupant_ids: [1], occupants: [{ participant_id: 1, nights: null }] },
      { id: 2, occupant_ids: [2, 3], occupants: [{ participant_id: 2, nights: null }, { participant_id: 3, nights: null }] },
    ];
    expect(roomsDrift(splitJson({ '1': [1, 2], '2': [3] }), currentRooms)).toBe(true);
  });

  it('new-shape snapshot: drift when nights changes for the same occupant set', () => {
    const currentRooms = [
      { id: 1, occupant_ids: [1, 2], occupants: [{ participant_id: 1, nights: 3 }, { participant_id: 2, nights: null }] },
      { id: 2, occupant_ids: [3], occupants: [{ participant_id: 3, nights: null }] },
    ];
    // saved with occupant 1 at 2 nights; now the room has occupant 1 at 3
    // nights — same set, nights changed.
    expect(roomsDrift(newSplitJson({
      '1': [{ id: 1, nights: 2 }, { id: 2, nights: null }],
      '2': [{ id: 3, nights: null }],
    }), currentRooms)).toBe(true);
  });

  it('new-shape snapshot: no drift when occupants and nights are identical', () => {
    const currentRooms = [
      { id: 1, occupant_ids: [1, 2], occupants: [{ participant_id: 1, nights: 2 }, { participant_id: 2, nights: null }] },
      { id: 2, occupant_ids: [3], occupants: [{ participant_id: 3, nights: null }] },
    ];
    expect(roomsDrift(newSplitJson({
      '1': [{ id: 2, nights: null }, { id: 1, nights: 2 }], // order-insensitive
      '2': [{ id: 3, nights: null }],
    }), currentRooms)).toBe(false);
  });
});

// F3 — drift completeness: room-level `stay_nights` snapshot ladder rung.
// A snapshot saved AFTER this fix carries `room_stay_nights` alongside
// `occupants`; one saved before it does not. Only the former can detect a
// date edit that changes the group's derived stayNights.
describe('roomsDrift — room_stay_nights (F3)', () => {
  const splitJsonWithStayNights = (
    occupants: Record<string, Array<{ id: number; nights: number | null }>>,
    roomStayNights: Record<string, number | null>,
  ) => JSON.stringify({
    mode: 'rooms', stay_label: 'Osaka 1-3', room_amounts: { '1': 100, '2': 50 },
    occupants, room_stay_nights: roomStayNights,
  });

  it('fires when the derived stayNights changed but occupants/nights did not (dates shortened)', () => {
    // saved with a 4-night stay; room now derives 2 nights (dates edited),
    // same occupant set, same stored nights (both null — whole-stay default).
    const currentRooms = [
      { id: 1, occupant_ids: [1, 2], occupants: [{ participant_id: 1, nights: null }, { participant_id: 2, nights: null }], check_in: '2026-01-01', check_out: '2026-01-03', stay_label: 'Osaka 1-3' },
      { id: 2, occupant_ids: [3], occupants: [{ participant_id: 3, nights: null }], check_in: null, check_out: null, stay_label: 'Osaka 1-3' },
    ];
    expect(roomsDrift(splitJsonWithStayNights(
      { '1': [{ id: 1, nights: null }, { id: 2, nights: null }], '2': [{ id: 3, nights: null }] },
      { '1': 4, '2': 4 },
    ), currentRooms)).toBe(true);
  });

  it('is false when the derived stayNights is unchanged', () => {
    const currentRooms = [
      { id: 1, occupant_ids: [1, 2], occupants: [{ participant_id: 1, nights: null }, { participant_id: 2, nights: null }], check_in: '2026-01-01', check_out: '2026-01-05', stay_label: 'Osaka 1-3' },
      { id: 2, occupant_ids: [3], occupants: [{ participant_id: 3, nights: null }], check_in: null, check_out: null, stay_label: 'Osaka 1-3' },
    ];
    expect(roomsDrift(splitJsonWithStayNights(
      { '1': [{ id: 1, nights: null }, { id: 2, nights: null }], '2': [{ id: 3, nights: null }] },
      { '1': 4, '2': 4 },
    ), currentRooms)).toBe(false);
  });

  it('is false (tolerant) when the snapshot has no room_stay_nights field at all, even though dates changed', () => {
    // pre-fix (v0.26-early) snapshot shape: occupants only, no room_stay_nights.
    const currentRooms = [
      { id: 1, occupant_ids: [1, 2], occupants: [{ participant_id: 1, nights: null }, { participant_id: 2, nights: null }], check_in: '2026-01-01', check_out: '2026-01-02', stay_label: 'Osaka 1-3' },
      { id: 2, occupant_ids: [3], occupants: [{ participant_id: 3, nights: null }], check_in: null, check_out: null, stay_label: 'Osaka 1-3' },
    ];
    expect(roomsDrift(newSplitJsonNoStayNights({
      '1': [{ id: 1, nights: null }, { id: 2, nights: null }],
      '2': [{ id: 3, nights: null }],
    }), currentRooms)).toBe(false);
  });

  it('is false for an old (plain-id) shape snapshot even when dates changed', () => {
    const currentRooms = [
      { id: 1, occupant_ids: [1, 2], occupants: [{ participant_id: 1, nights: null }, { participant_id: 2, nights: null }], check_in: '2026-01-01', check_out: '2026-01-02', stay_label: 'Osaka 1-3' },
      { id: 2, occupant_ids: [3], occupants: [{ participant_id: 3, nights: null }], check_in: null, check_out: null, stay_label: 'Osaka 1-3' },
    ];
    expect(roomsDrift(splitJson({ '1': [1, 2], '2': [3] }), currentRooms)).toBe(false);
  });

  it('derives current stayNights via ascending-room-id sibling order (F4), matching the server', () => {
    // room 1 has no dates of its own; siblings 2 (no dates) and 3 (dates)
    // exist in the group — ascending id order means room 1 falls back to
    // whichever dated sibling comes first by id, same as the server.
    const currentRooms = [
      { id: 1, occupant_ids: [9], occupants: [{ participant_id: 9, nights: null }], check_in: null, check_out: null, stay_label: 'Kyoto' },
      { id: 2, occupant_ids: [], occupants: [], check_in: null, check_out: null, stay_label: 'Kyoto' },
      { id: 3, occupant_ids: [], occupants: [], check_in: '2026-02-01', check_out: '2026-02-04', stay_label: 'Kyoto' },
    ];
    // saved when room 1's derived stayNights was 3 (from room 3); unchanged now.
    expect(roomsDrift(splitJsonWithStayNights(
      { '1': [{ id: 9, nights: null }] }, { '1': 3 },
    ), currentRooms)).toBe(false);
    // saved with a stale value — drift fires.
    expect(roomsDrift(splitJsonWithStayNights(
      { '1': [{ id: 9, nights: null }] }, { '1': 2 },
    ), currentRooms)).toBe(true);
  });
});

function newSplitJsonNoStayNights(occupants: Record<string, Array<{ id: number; nights: number | null }>>) {
  return JSON.stringify({ mode: 'rooms', stay_label: 'Osaka 1-3', room_amounts: { '1': 100, '2': 50 }, occupants });
}
