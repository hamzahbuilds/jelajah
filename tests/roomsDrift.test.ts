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
