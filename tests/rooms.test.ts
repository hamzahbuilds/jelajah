import { describe, it, expect } from 'vitest';
import { occupancyLabel, singleOccupancyBatch } from '../shared/rooms';

describe('occupancyLabel', () => {
  it('shows count/capacity when capacity is set', () => {
    expect(occupancyLabel(3, 0, 4)).toBe('3/4');
  });

  it('shows infants added on with a + when the room holds an infant', () => {
    expect(occupancyLabel(3, 1, 4)).toBe('3+1/4');
  });

  it('drops the /capacity suffix when capacity is unspecified', () => {
    expect(occupancyLabel(3, 0, null)).toBe('3');
  });

  it('shows infants with no capacity suffix when capacity is unspecified', () => {
    expect(occupancyLabel(3, 1, null)).toBe('3+1');
  });

  it('shows an empty room as 0/capacity', () => {
    expect(occupancyLabel(0, 0, 2)).toBe('0/2');
  });

  it('treats undefined capacity the same as null', () => {
    expect(occupancyLabel(2, 0, undefined)).toBe('2');
  });
});

describe('singleOccupancyBatch', () => {
  it('deletes the incoming participants from every sibling room in the stay group', () => {
    expect(singleOccupancyBatch(10, [1, 2], [11, 12])).toEqual({ deleteFrom: [11, 12] });
  });

  it('excludes the target room itself even if present in siblingRoomIds', () => {
    expect(singleOccupancyBatch(10, [1, 2], [10, 11, 12])).toEqual({ deleteFrom: [11, 12] });
  });

  it('returns no deletions when no participants are being assigned', () => {
    expect(singleOccupancyBatch(10, [], [11, 12])).toEqual({ deleteFrom: [] });
  });

  it('returns no deletions when there are no sibling rooms', () => {
    expect(singleOccupancyBatch(10, [1, 2], [])).toEqual({ deleteFrom: [] });
  });
});
