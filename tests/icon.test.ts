import { describe, it, expect } from 'vitest';
import { DEFS, ICON_NAMES } from '../src/components/iconDefs';

describe('icon sprite', () => {
  it('has an id="i-<name>" def for every ICON_NAMES entry', () => {
    for (const name of ICON_NAMES) {
      expect(DEFS).toContain(`id="i-${name}"`);
    }
  });

  it('has no duplicate g ids', () => {
    const ids = [...DEFS.matchAll(/<g id="(i-[^"]+)"/g)].map((m) => m[1]);
    const unique = new Set(ids);
    expect(ids.length).toBeGreaterThan(0);
    expect(unique.size).toBe(ids.length);
  });

  it('contains no hardcoded fill colors', () => {
    expect(DEFS).not.toMatch(/fill="#/);
  });
});
