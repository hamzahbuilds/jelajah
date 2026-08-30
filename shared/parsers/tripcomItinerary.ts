import { ParsedDoc, ParsedLeg, normalize, parseLongDate } from './types';

export function detectTripcomItinerary(text: string): boolean {
  return /^Itinerary/m.test(text) && /Booking Information/i.test(text) && /\(First/.test(text);
}

export function parseTripcomItinerary(raw: string): ParsedDoc {
  const text = normalize(raw);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const joined = lines.join(' ');
  const doc: ParsedDoc = {
    parser: 'tripcom-itinerary', vendor: 'Trip.com', docType: 'itinerary',
    people: [], legs: [], fields: {}, warnings: [], confidence: 0, suggestExpense: false,
  };

  const bm = joined.match(/Booking No\.?\s*(\d{6,})/i);
  if (bm) doc.bookingNo = bm[1];

  // Passenger names wrap across lines and interleave with class/ticket columns.
  // Strip the "Economy <ticket-no> <booking-ref>" noise first, then match
  // "X (First name) Y (Last name)".
  const cleaned = joined.replace(/\b\w+\s+(?:\d{3}-\d{7,13}|--)\s+[A-Z0-9]{5,7}\b/g, ' ');
  const nameRe = /([A-Z][A-Z'. -]+?)\s*\(First\s*name\)\s*([A-Z][A-Z'. -]+?)\s*\(Last\s*name\)/g;
  const seen = new Set<string>();
  for (const m of cleaned.matchAll(nameRe)) {
    const full = `${m[1].trim()} ${m[2].trim()}`.replace(/\s+/g, ' ');
    if (!seen.has(full)) { seen.add(full); doc.people.push(full); }
  }

  // Flight Information blocks:
  //   <From> - <To>
  //   Departure HH:MM, Month D, YYYY, <Airport>
  //   Arrival HH:MM, Month D, YYYY, <Airport>
  //   Airline <Name> <FLIGHTNO>
  for (let i = 0; i < lines.length; i++) {
    const dep = lines[i].match(/^Departure\s+(\d{1,2}:\d{2}),\s*([A-Za-z]+ \d{1,2}, \d{4}),\s*(.+)$/);
    if (!dep) continue;
    const leg: ParsedLeg = { depTime: dep[1], date: parseLongDate(dep[2]), depPlace: dep[3].trim() };
    // route header is the closest preceding "<A> - <B>" line
    for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
      const r = lines[j].match(/^(.{2,40}?)\s+-\s+(.{2,40}?)$/);
      if (r) { leg.from = r[1].trim(); leg.to = r[2].trim(); break; }
    }
    const arr = lines[i + 1]?.match(/^Arrival\s+(\d{1,2}:\d{2}),\s*([A-Za-z]+ \d{1,2}, \d{4}),\s*(.+)$/);
    if (arr) { leg.arrTime = arr[1]; leg.arrPlace = arr[3].trim(); }
    const air = lines[i + 2]?.match(/^Airline\s+(.*?)\s*([A-Z]{1,2}\d{2,4})$/);
    if (air) { leg.airline = air[1].trim(); leg.flightNo = air[2]; }
    doc.legs.push(leg);
  }

  doc.category = 'flight';
  doc.description = doc.legs.length
    ? 'Itinerary: ' + doc.legs.map(l => `${l.from ?? '?'}→${l.to ?? '?'}${l.flightNo ? ` (${l.flightNo})` : ''}`).join(', ')
    : 'Trip.com itinerary';
  doc.warnings.push('Itineraries have no price — usually attach to the matching receipt (same booking no.) instead of creating a new expense.');

  let score = 0;
  if (doc.bookingNo) score += 0.3;
  if (doc.people.length) score += 0.3;
  if (doc.legs.length) score += 0.4;
  doc.confidence = score;
  return doc;
}
