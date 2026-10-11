import { describe, expect, it } from 'vitest';
import { decodeTransitPolyline, normalizeTransitOptions } from '../server/lib/transit-provider';
import { transitDeparture, hasJapaneseFareEstimate } from '../shared/transit-time';

describe('international transit adapter', () => {
  it('decodes actual geometry and rejects truncated geometry rather than drawing a straight line', () => {
    expect(decodeTransitPolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@',5)).toEqual([[38.5,-120.2],[40.7,-120.95],[43.252,-126.453]]);
    expect(()=>decodeTransitPolyline('_',6)).toThrow();
  });
  it('keeps alternative ticket products separate and drops cancelled journeys', () => {
    const journey = {startTime:'2026-11-30T09:00:00Z',endTime:'2026-11-30T10:00:00Z',duration:3600,transfers:0,
      legs:[{mode:'RAIL',from:{name:'A'},to:{name:'B'},legGeometry:{points:'',precision:6}}],
      fareTransfers:[{effectiveFareLegProducts:[[[{name:'Adult',amount:20,currency:'EUR'},{name:'Child',amount:10,currency:'EUR'}]]]}]};
    const result=normalizeTransitOptions({itineraries:[journey,{...journey,legs:[{...journey.legs[0],cancelled:true}]}]});
    expect(result).toHaveLength(1);
    expect(result[0].fareProducts.map(p=>p.amount)).toEqual([20,10]);
    expect(result[0].segments).toEqual([]);
    expect(result[0]).not.toHaveProperty('totalFare');
  });
  it('uses destination daylight-saving rules and rejects nonexistent or ambiguous departures', () => {
    expect(transitDeparture('2026-07-01T09:00','Europe/London')).toBe('2026-07-01T08:00:00.000Z');
    expect(transitDeparture('2026-11-30T09:00','Europe/Paris')).toBe('2026-11-30T08:00:00.000Z');
    expect(transitDeparture('2026-11-30T09:00','Asia/Tokyo')).toBe('2026-11-30T00:00:00.000Z');
    expect(()=>transitDeparture('2026-03-29T01:30','Europe/London')).toThrow();
    expect(()=>transitDeparture('2026-10-25T01:30','Europe/London')).toThrow();
  });
  it('does not apply legacy Japanese fare estimates to European cities', () => {
    for(const p of [{lat:51.5,lng:-.1},{lat:48.85,lng:2.35},{lat:40.4,lng:-3.7},{lat:41.9,lng:12.5}])expect(hasJapaneseFareEstimate(p,p)).toBe(false);
    expect(hasJapaneseFareEstimate({lat:35.68,lng:139.76},{lat:35.71,lng:139.79})).toBe(true);
  });
});
