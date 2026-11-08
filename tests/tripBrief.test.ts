import { describe, expect, it } from 'vitest';
import { briefDays, briefPromptBlock, cleanBrief, rangeDays } from '../shared/brief';
import { parseDraftReply, draftResponseSchema, emptyDraft } from '../shared/draft';

const name = (c: string) => ({ JP: 'Japan', KR: 'South Korea', MY: 'Malaysia' } as Record<string, string>)[c] ?? c;

describe('trip brief (v0.36)', () => {
  it('cleanBrief keeps valid countries/areas and drops junk', () => {
    const b = cleanBrief({
      places: [
        { country: 'jp', areas: ['Tokyo', ' tokyo ', 'Kyoto', '', 42] },
        { country: 'JP', areas: ['dupe'] },          // duplicate country
        { country: 'XX', areas: ['nowhere'] },       // not a country
        { country: 'KR' },
      ],
      when: { kind: 'dates', start: '2026-12-01', end: '2026-12-07' },
      party: { adults: 2, kids: '1', seniors: -3 },
      pace: 'zoom', interests: ['food', 'halal', 'skydiving', 'food'], from: '  Kuala   Lumpur ', extra: 'dropped',
    })!;
    expect(b.places).toEqual([{ country: 'JP', areas: ['Tokyo', 'tokyo', 'Kyoto'] }, { country: 'KR', areas: [] }]);
    expect(b.when).toEqual({ kind: 'dates', start: '2026-12-01', end: '2026-12-07' });
    expect(b.party).toEqual({ adults: 2, kids: 1, seniors: 0 });
    expect(b.pace).toBeUndefined();
    expect(b.interests).toEqual(['food', 'halal']);
    expect(b.from).toBe('Kuala Lumpur');
    expect('extra' in b).toBe(false);
  });

  it('rejects bad dates, clamps days and returns null for empty input', () => {
    expect(cleanBrief({ places: [], when: { kind: 'dates', start: '2026-12-07', end: '2026-12-01' } })).toBeNull();
    expect(cleanBrief({ when: { kind: 'dates', start: '2026-01-01', end: '2026-03-01' } })).toBeNull(); // > 30 days
    expect(cleanBrief({ when: { kind: 'month', month: '2026-13', days: 4 } })).toBeNull();
    expect(cleanBrief({ when: { kind: 'unsure', days: 99 } })!.when).toEqual({ kind: 'unsure', days: 30 });
    expect(cleanBrief(null)).toBeNull();
    expect(cleanBrief('JP')).toBeNull();
  });

  it('caps countries and areas', () => {
    const many = ['JP', 'KR', 'MY', 'TH', 'VN', 'SG', 'ID'].map(country => ({ country, areas: Array.from({ length: 12 }, (_, i) => `a${i}`) }));
    const b = cleanBrief({ places: many })!;
    expect(b.places).toHaveLength(5);
    expect(b.places[0].areas).toHaveLength(8);
  });

  it('counts days for each kind of "when"', () => {
    expect(rangeDays('2026-12-30', '2027-01-02')).toBe(4);
    expect(briefDays({ places: [], when: { kind: 'dates', start: '2026-12-01', end: '2026-12-01' } })).toBe(1);
    expect(briefDays({ places: [], when: { kind: 'month', month: '2026-12', days: 6 } })).toBe(6);
    expect(briefDays({ places: [], when: null })).toBeNull();
  });

  it('prompt block says where, exactly how many days, who, pace and interests', () => {
    const text = briefPromptBlock(cleanBrief({
      places: [{ country: 'JP', areas: ['Tokyo', 'Kyoto'] }, { country: 'KR', areas: [] }],
      when: { kind: 'month', month: '2026-12', days: 6 },
      party: { adults: 2, kids: 1, seniors: 0 }, pace: 'relaxed', interests: ['halal'], from: 'Kuala Lumpur',
    })!, name);
    expect(text).toContain('Japan (JP) — areas: Tokyo, Kyoto; South Korea (KR)');
    expect(text).toContain('Make exactly 6 days');
    expect(text).toContain('2 adults, 1 kid');
    expect(text).toContain('kid-friendly');
    expect(text).toContain('Pace: relaxed');
    expect(text).toContain('halal-friendly food only');
    expect(text).toContain('Travelling from: Kuala Lumpur');
  });

  it('parseDraftReply reads "found" countries (valid codes only)', () => {
    const r = parseDraftReply(JSON.stringify({
      reply: 'ok', suggestions: [], found: { countries: ['jp', 'ZZ', 'JP', 'kr'], areas: ['Tokyo', ''] }, draft: emptyDraft(),
    }), emptyDraft());
    expect(r.found).toEqual({ countries: ['JP', 'KR'], areas: ['Tokyo'] });
    expect(parseDraftReply(JSON.stringify({ reply: 'x', draft: emptyDraft(), found: { countries: ['ZZ'] } }), emptyDraft()).found).toBeUndefined();
  });

  it('full-mode schema asks for "found"; edit mode does not', () => {
    expect(JSON.stringify(draftResponseSchema('full'))).toContain('"found"');
    expect(JSON.stringify(draftResponseSchema('edit'))).not.toContain('"found"');
  });
});
