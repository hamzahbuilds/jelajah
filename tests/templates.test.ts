import { describe, expect, it } from 'vitest';
import { TEMPLATES, templateAsJourney, journeyAsDraft, templatePlaces } from '../shared/templates';
import { cleanDraft, DRAFT_LIMITS } from '../shared/draft';
import { COUNTRY_CODES } from '../shared/brief';

describe('starter templates', () => {
  it('have unique ids and real countries', () => {
    expect(new Set(TEMPLATES.map(t => t.id)).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) expect(COUNTRY_CODES).toContain(t.country);
  });
  it('pass the plan draft validator unchanged and within limits', () => {
    for (const t of TEMPLATES) {
      const clean = cleanDraft(t.draft);
      expect(clean.days.map(d => d.places.length)).toEqual(t.draft.days.map(d => d.places.length));
      expect(clean.days.length).toBeLessThanOrEqual(DRAFT_LIMITS.days);
      expect(templatePlaces(t)).toBeLessThanOrEqual(DRAFT_LIMITS.picks);
      const ids = t.draft.days.flatMap(d => d.places.map(p => p.id));
      expect(new Set(ids).size).toBe(ids.length);
      for (const p of t.draft.days.flatMap(d => d.places)) expect(p.start_time).toMatch(/^\d{2}:\d{2}$/);
    }
  });
  it('round-trip through the public schedule shape', () => {
    const t = TEMPLATES[0];
    const j = templateAsJourney(t);
    expect(j.days).toHaveLength(t.draft.days.length);
    expect(j.days[0].stops[0].endTime).toBe('09:15');
    const d = cleanDraft(journeyAsDraft(j));
    expect(d.days[0].places).toHaveLength(t.draft.days[0].places.length);
    expect(d.days[0].places[0].category).toBe('food');
  });
});
