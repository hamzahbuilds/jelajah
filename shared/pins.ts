// Map numbering shared by the day map and the itinerary list.
//
// A day's "chain" is the walking order the transit legs are built from:
//   [ start point (the accommodation, unless overridden) , located activities… , end point ]
// Pin 1 is therefore always where the day starts from — the hotel — and each
// located activity follows in plan order. Numbering lives here, not in the map
// component, so the list rows can show the SAME number the pin shows.

export interface Numbered { ref: string }

/** ref → 1-based pin number, in chain order. */
export function pinNumbers<T extends Numbered>(chain: T[]): Map<string, number> {
  const out = new Map<string, number>();
  chain.forEach((p, i) => { if (!out.has(p.ref)) out.set(p.ref, i + 1); });
  return out;
}

/** The chain ref used for an activity id. */
export const actRef = (id: number): string => `act:${id}`;

/** Pin number for an activity, or null when it has no coordinates (so no pin). */
export function pinOfActivity(numbers: Map<string, number>, id: number): number | null {
  return numbers.get(actRef(id)) ?? null;
}
