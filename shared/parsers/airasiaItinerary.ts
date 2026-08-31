import { ParsedDoc, ParsedLeg, MONTHS, normalize, ymd } from './types';

export function detectAirasiaItinerary(text: string): boolean {
  return /Flight summary/i.test(text) && /Guest details/i.test(text) && /(airasia|air\.asia)/i.test(text);
}

/** AirAsia itinerary: multi-segment flights listed as timed points.
    Layout per segment:
      HH:MM <city>
      DD Mon <airport>[, Terminal N]
      <Airline> , <XX NNN>     ← only on departure points
      <duration> / fare class / layover lines (noise)
    The year appears only in "Depart: <Weekday>, D Month YYYY" headers. */
export function parseAirasiaItinerary(raw: string): ParsedDoc {
  const text = normalize(raw);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const doc: ParsedDoc = {
    parser: 'airasia-itinerary', vendor: 'AirAsia', docType: 'itinerary',
    people: [], legs: [], fields: {}, warnings: [], confidence: 0, suggestExpense: false,
  };
  doc.category = 'flight';

  const bIdx = lines.findIndex(l => /^Booking no\.?$/i.test(l));
  if (bIdx >= 0) {
    for (const l of lines.slice(bIdx + 1, bIdx + 3)) {
      if (/^[A-Z0-9]{5,8}$/.test(l)) { doc.bookingNo = l; break; }
    }
  }
  const bd = lines.find(l => /^Booking date:/i.test(l))?.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (bd && MONTHS[bd[2].toLowerCase()]) {
    doc.fields['Booking date'] = ymd(Number(bd[3]), MONTHS[bd[2].toLowerCase()], Number(bd[1]));
  }

  // Guests: "Name (adult) Name (adult)" until "Flight summary"
  const gIdx = lines.findIndex(l => /^Guest details$/i.test(l));
  if (gIdx >= 0) {
    for (const l of lines.slice(gIdx + 1, gIdx + 12)) {
      if (/^Flight summary/i.test(l)) break;
      for (const m of l.matchAll(/([A-Z][A-Za-z'./ -]+?)\s*\((adult|child|infant)\)/gi)) {
        doc.people.push(m[1].trim());
      }
    }
  }

  // Walk the timed points. Year anchor comes from the closest preceding
  // "Depart: Weekday, D Month YYYY" header; day-month points roll forward.
  let anchorYear: number | null = null;
  let anchorMonth: number | null = null;
  interface Point { time: string; city: string; date?: string; airport?: string }
  let pending: { point: Point; airline: string; flightNo: string } | null = null;

  const resolveDate = (day: number, mon: number): string | undefined => {
    if (anchorYear == null || anchorMonth == null) return undefined;
    let y = anchorYear;
    if (mon < anchorMonth) y += 1; // Dec → Jan rollover
    return ymd(y, mon, day);
  };

  const endIdx = lines.findIndex(l => /^Add-ons$/i.test(l));
  const scan = endIdx > 0 ? lines.slice(0, endIdx) : lines;
  for (let i = 0; i < scan.length; i++) {
    const dep = scan[i].match(/^Depart:\s*[A-Za-z]+,\s*(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/i);
    if (dep && MONTHS[dep[2].toLowerCase()]) {
      anchorYear = Number(dep[3]);
      anchorMonth = MONTHS[dep[2].toLowerCase()];
      continue;
    }
    const pt = scan[i].match(/^(\d{2}:\d{2})\s+(.+)$/);
    if (!pt) continue;
    const point: Point = { time: pt[1], city: pt[2].trim() };
    const dm = scan[i + 1]?.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(.+)$/);
    if (dm && MONTHS[dm[2].toLowerCase()]) {
      point.date = resolveDate(Number(dm[1]), MONTHS[dm[2].toLowerCase()]);
      point.airport = dm[3].replace(/\s*,\s*Terminal.*$/i, '').trim();
      i++;
    }
    // if this point closes a pending flight, emit the leg
    if (pending) {
      doc.legs.push({
        from: pending.point.city, to: point.city,
        date: pending.point.date, depTime: pending.point.time, arrTime: point.time,
        depPlace: pending.point.airport, arrPlace: point.airport,
        airline: pending.airline, flightNo: pending.flightNo,
      } as ParsedLeg);
      pending = null;
    }
    // does an airline line follow? then this point opens a new flight
    const air = scan[i + 1]?.match(/^(.+?)\s*,\s*([A-Z0-9]{1,2})\s?(\d{2,4})$/);
    if (air && !/Terminal/i.test(scan[i + 1])) {
      pending = { point, airline: air[1].trim(), flightNo: `${air[2]}${air[3]}` };
      i++;
    }
  }

  doc.description = doc.legs.length
    ? 'Itinerary: ' + doc.legs.map(l => `${l.from}→${l.to} (${l.flightNo})`).join(', ')
    : `AirAsia itinerary${doc.bookingNo ? ` ${doc.bookingNo}` : ''}`;
  doc.warnings.push('Itineraries have no price — usually attach to the matching invoice (same booking no.) instead of creating a new expense.');

  let score = 0;
  if (doc.bookingNo) score += 0.3;
  if (doc.people.length) score += 0.3;
  if (doc.legs.length) score += 0.4;
  doc.confidence = score;
  return doc;
}
