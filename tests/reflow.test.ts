import { describe, it, expect } from 'vitest';
import { reflowDay } from '../shared/reflow';

const noTravel = () => 0;

describe('smart reflow', () => {
  it('keeps durations and shifts subsequent starts after a swap', () => {
    // original: A 10:00–12:00, B 14:00–15:00 → reorder to B, A with 30min travel
    const out = reflowDay(
      [
        { id: 2, start_time: '14:00', end_time: '15:00' },
        { id: 1, start_time: '10:00', end_time: '12:00' },
      ],
      () => 30,
    );
    expect(out[0]).toMatchObject({ id: 2, start_time: '10:00', end_time: '11:00' }); // anchor = earliest start
    expect(out[1]).toMatchObject({ id: 1, start_time: '11:30', end_time: '13:30' }); // 11:00 + 30min travel
  });

  it('start-only activities take the default 60-minute duration', () => {
    const out = reflowDay(
      [
        { id: 1, start_time: '09:00', end_time: null },
        { id: 2, start_time: '15:00', end_time: '16:00' },
      ],
      () => 20,
    );
    expect(out[0].start_time).toBe('09:00');
    expect(out[1].start_time).toBe('10:20'); // 09:00 + 60 default + 20 travel
  });

  it('untimed items pass through in position, timeline skips them', () => {
    const out = reflowDay(
      [
        { id: 1, start_time: '09:00', end_time: '10:00' },
        { id: 9, start_time: null, end_time: null },
        { id: 2, start_time: '18:00', end_time: '19:00' },
      ],
      () => 15,
    );
    expect(out[1].start_time).toBeNull();
    expect(out[2].start_time).toBe('10:15');
  });

  it('rounds travel-adjusted starts up to 5 minutes', () => {
    const out = reflowDay(
      [
        { id: 1, start_time: '09:00', end_time: '10:00' },
        { id: 2, start_time: '11:00', end_time: '11:30' },
      ],
      () => 13,
    );
    expect(out[1].start_time).toBe('10:15'); // 10:00+13 → 10:13 → rounds to 10:15
  });

  it('all-untimed day is untouched', () => {
    const out = reflowDay([{ id: 1, start_time: null, end_time: null }], noTravel);
    expect(out[0].start_time).toBeNull();
  });
});
