import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/geo', () => ({ geocode: vi.fn(async (q: string) => (q === 'Nowhere' ? [] : [{ name: 'Batu Caves, Gombak, Malaysia', lat: 3.2379, lng: 101.684 }])) }));
vi.mock('../src/components/LazyMap', () => ({ default: () => null }));
const { pinFirst, isPinned } = await import('../src/components/PlaceSearch');

describe('place search save-time pinning', () => {
  it('pins a typed but unpicked place with the best match, keeping the typed name', async () => {
    expect(await pinFirst({ name: 'Batu Caves', lat: null, lng: null })).toEqual({ name: 'Batu Caves', lat: 3.2379, lng: 101.684 });
  });
  it('leaves pinned, empty and unmatched places alone', async () => {
    const pinned = { name: 'Home', lat: 1, lng: 2 };
    expect(await pinFirst(pinned)).toBe(pinned);
    expect(await pinFirst({ name: '  ', lat: null, lng: null })).toEqual({ name: '  ', lat: null, lng: null });
    expect(isPinned(await pinFirst({ name: 'Nowhere', lat: null, lng: null }))).toBe(false);
  });
});
