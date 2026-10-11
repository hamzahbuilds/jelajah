import { expect, it } from 'vitest';
import { geoapifyTransit } from '../server/lib/geoapify-transit';

it('rejects missing, malformed and out-of-range geometry instead of drawing a line', () => {
  for (const geometry of [null, {type:'Point',coordinates:[0,0]}, {type:'LineString',coordinates:[[0,0]]}, {type:'LineString',coordinates:[[0,0],[181,20]]}]) {
    expect(() => geoapifyTransit({features:[{geometry,properties:{time:60,distance:100}}]})).toThrow();
  }
});

it('keeps disconnected geometry separate and does not invent fares or schedules', () => {
  const result = geoapifyTransit({features:[{geometry:{type:'MultiLineString',coordinates:[[[2,48],[2.1,48.1]],[[2.2,48.2],[2.3,48.3]]]},properties:{time:900,distance:4000}}]});
  expect(result.segments).toHaveLength(2);
  expect(result.duration).toBe(900);
  expect(result).not.toHaveProperty('fare');
  expect(result).not.toHaveProperty('departure');
});
