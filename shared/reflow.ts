// Smart reflow: after reordering a day's activities, keep each activity's
// duration, anchor the first at the day's earliest start, and push every next
// start to previous end + estimated travel minutes for the NEW order.
// Untimed activities keep manual order after the timed block. Pure + testable.

export interface ReflowItem {
  id: number;
  start_time: string | null;  // HH:MM
  end_time: string | null;
  lat?: number | null;
  lng?: number | null;
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const toHHMM = (m: number) => {
  const clamped = Math.min(m, 23 * 60 + 55);
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
};
const roundUp5 = (m: number) => Math.ceil(m / 5) * 5;

export const DEFAULT_DURATION_MIN = 60;

/**
 * @param ordered   items in the NEW desired order
 * @param travelMin travel estimate (minutes) between two consecutive items; return 0 when unknown
 * @returns items with recomputed start/end (untimed stay untimed, placed as given)
 */
export function reflowDay(
  ordered: ReflowItem[],
  travelMin: (a: ReflowItem, b: ReflowItem) => number,
): ReflowItem[] {
  const timed = ordered.filter(i => i.start_time);
  if (timed.length === 0) return ordered.map(i => ({ ...i }));
  const anchor = Math.min(...timed.map(i => toMin(i.start_time!)));

  const out: ReflowItem[] = [];
  let cursor = anchor;
  let prevTimed: ReflowItem | null = null;
  for (const item of ordered) {
    if (!item.start_time) { out.push({ ...item }); continue; }
    const dur = item.end_time ? Math.max(5, toMin(item.end_time) - toMin(item.start_time)) : DEFAULT_DURATION_MIN;
    let start = cursor;
    if (prevTimed) start = roundUp5(cursor + Math.max(0, travelMin(prevTimed, item)));
    const hadEnd = !!item.end_time;
    out.push({
      ...item,
      start_time: toHHMM(start),
      end_time: hadEnd ? toHHMM(start + dur) : null,
    });
    cursor = start + dur;
    prevTimed = item;
  }
  return out;
}
