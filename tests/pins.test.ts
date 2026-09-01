import { describe, it, expect } from 'vitest';
import { pinNumbers, actRef, pinOfActivity } from '../shared/pins';

const chain = (...refs: string[]) => refs.map(ref => ({ ref }));

describe('pins', () => {
  it('numbers the accommodation start point as pin 1', () => {
    const n = pinNumbers(chain('start', actRef(7), actRef(8), 'end'));
    expect(n.get('start')).toBe(1);
    expect(n.get(actRef(7))).toBe(2);
    expect(n.get(actRef(8))).toBe(3);
    expect(n.get('end')).toBe(4);
  });

  it('starts activities at 1 when the day has no start point', () => {
    const n = pinNumbers(chain(actRef(7), actRef(8)));
    expect(n.get(actRef(7))).toBe(1);
    expect(n.get(actRef(8))).toBe(2);
  });

  it('gives no number to an activity that is not in the chain', () => {
    const n = pinNumbers(chain('start', actRef(7)));
    expect(pinOfActivity(n, 7)).toBe(2);
    expect(pinOfActivity(n, 99)).toBeNull();
  });

  it('is empty for a day with nothing located', () => {
    expect(pinNumbers(chain()).size).toBe(0);
  });

  it('keeps the first position when a ref repeats', () => {
    // start and end are the same hotel on a stay-put day
    const n = pinNumbers(chain('start', actRef(1), 'start'));
    expect(n.get('start')).toBe(1);
  });
});
