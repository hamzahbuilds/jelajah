import { describe, expect, it } from 'vitest';
import { parseSuggestions, freeSlots } from '../shared/assistant';

describe('parseSuggestions', () => {
  const good = JSON.stringify([
    { day: '2026-11-30', start_time: '14:00', duration_min: 90, title: 'Ueno Park stroll', why: 'Flat paths, stroller-friendly.', place: 'Ueno Park, Tokyo' },
    { day: '2026-11-30', start_time: '16:30', duration_min: 60, title: 'Ameyoko market snacks', place: 'Ameyoko, Tokyo' },
  ]);

  it('parses a clean JSON array', () => {
    const s = parseSuggestions(good);
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ day: '2026-11-30', start_time: '14:00', duration_min: 90 });
  });

  it('strips markdown fences and surrounding chatter', () => {
    expect(parseSuggestions('Here you go!\n```json\n' + good + '\n```\nEnjoy!')).toHaveLength(2);
    expect(parseSuggestions('Sure: ' + good + ' — hope that helps')).toHaveLength(2);
  });

  it('rejects garbage without throwing', () => {
    expect(parseSuggestions('I cannot help with that.')).toEqual([]);
    expect(parseSuggestions('{"day":"x"}')).toEqual([]);
    expect(parseSuggestions('[{"title":""}]')).toEqual([]);
  });

  it('drops invalid rows, clamps durations, keeps at most 10', () => {
    const rows = Array.from({ length: 14 }, (_, i) => ({ day: '2026-12-01', start_time: '09:00', duration_min: 5000, title: `T${i}` }));
    const s = parseSuggestions(JSON.stringify([{ nope: 1 }, { day: 'not-a-date', title: 'x' }, ...rows]));
    expect(s).toHaveLength(10);
    expect(s[0].duration_min).toBe(720); // clamped to 12h
  });

  it('snaps hallucinated dates to the nearest trip day', () => {
    const s = parseSuggestions(
      JSON.stringify([{ day: '2027-03-15', start_time: '10:00', duration_min: 60, title: 'Wrong year thing' }]),
      ['2026-11-29', '2026-11-30', '2026-12-01'],
    );
    expect(s[0].day).toBe('2026-12-01');
  });
});

describe('freeSlots', () => {
  it('finds gaps between timed activities', () => {
    const slots = freeSlots([
      { start_time: '10:30', end_time: '13:10' },
      { start_time: '15:00', end_time: null }, // assumed 60 min
    ]);
    expect(slots).toEqual([
      { start: '09:00', end: '10:30', minutes: 90 },
      { start: '13:10', end: '15:00', minutes: 110 },
      { start: '16:00', end: '21:00', minutes: 300 },
    ]);
  });

  it('ignores untimed items and small gaps', () => {
    const slots = freeSlots([
      { start_time: null, end_time: null },
      { start_time: '09:00', end_time: '20:30' },
    ]);
    expect(slots).toEqual([]); // 30-min tail is under the 45-min minimum
  });

  it('returns the whole day when nothing is scheduled', () => {
    expect(freeSlots([])).toEqual([{ start: '09:00', end: '21:00', minutes: 720 }]);
  });
});
