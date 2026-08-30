import { ParsedDoc, ParsedLeg, normalize, parseLongDate, parseAmount, normCurrency } from './types';

export function detectTripcomReceipt(text: string): boolean {
  return /Trip\.com/i.test(text) && /\bReceipt\b/.test(text) && /Booking No/i.test(text);
}

export function parseTripcomReceipt(raw: string): ParsedDoc {
  const text = normalize(raw);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const doc: ParsedDoc = {
    parser: 'tripcom-receipt', vendor: 'Trip.com', docType: 'receipt',
    people: [], legs: [], fields: {}, warnings: [], confidence: 0, suggestExpense: true,
  };

  const bookingLine = lines.find(l => /Booking No/i.test(l));
  const bm = bookingLine?.match(/Booking No\.?\s*(\d{6,})/i);
  if (bm) doc.bookingNo = bm[1];

  const dateLine = lines.find(l => /Date of Booking/i.test(l));
  if (dateLine) {
    doc.paymentDate = parseLongDate(dateLine);
    if (doc.paymentDate) doc.fields['Booking date'] = doc.paymentDate;
  }

  const contactLine = lines.find(l => /^Contact Name\b/i.test(l));
  if (contactLine) doc.fields['Contact'] = contactLine.replace(/^Contact Name\s*/i, '');

  // Passenger block: between "Passenger & E-ticket" and "Flights"
  const pStart = lines.findIndex(l => /Passenger\s*&\s*E-?ticket/i.test(l));
  const pEnd = lines.findIndex((l, i) => i > pStart && /^Flights\b/i.test(l));
  if (pStart >= 0 && pEnd > pStart) {
    for (const l of lines.slice(pStart + 1, pEnd)) {
      // "NAME WHLLRN,816-9542575005" or "NAME 131-7504906191"
      const m = l.match(/^(.+?)\s+(?:[A-Z0-9]{5,7},)?(\d{3}-\d{7,13})$/);
      if (m) doc.people.push(m[1].trim());
    }
  }

  // Flights: "<From> - <To> <Month> <D>, <YYYY> Economy class" followed by "<Airline> <FLIGHTNO>"
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(.{2,40}?)\s+-\s+(.{2,40}?)\s+([A-Za-z]+ \d{1,2}, \d{4})\s+(\w+) class$/);
    if (m) {
      const leg: ParsedLeg = { from: m[1].trim(), to: m[2].trim(), date: parseLongDate(m[3]) };
      const next = lines[i + 1]?.match(/^(.*?)\s*([A-Z]{1,2}\d{2,4})$/);
      if (next) { leg.airline = next[1].trim(); leg.flightNo = next[2]; }
      doc.legs.push(leg);
    }
  }

  // "Total (Visa credit card 438289***93) MYR 5,508.00" / "Total (ATOME) MYR 2,844.00"
  const totalLine = lines.find(l => /^Total\s*\(/.test(l));
  const tm = totalLine?.match(/^Total\s*\((.+?)\)\s+([A-Z]{2,3})\s*([\d,]+\.\d{2})$/);
  if (tm) {
    doc.paymentMethod = tm[1].trim();
    doc.currency = normCurrency(tm[2]);
    doc.totalAmount = parseAmount(tm[3]);
    if (/atome/i.test(doc.paymentMethod)) {
      doc.warnings.push('Paid via ATOME — add instalment due dates on the review screen.');
    }
  }
  const fare = lines.find(l => /^Fare\b/.test(l))?.match(/([A-Z]{2,3})\s*([\d,]+\.\d{2})/);
  if (fare) doc.fields['Fare'] = `${fare[1]} ${fare[2]}`;
  const taxes = lines.find(l => /Taxes\s*&\s*fees/.test(l))?.match(/([A-Z]{2,3})\s*([\d,]+\.\d{2})/);
  if (taxes) doc.fields['Taxes & fees'] = `${taxes[1]} ${taxes[2]}`;

  doc.category = 'flight';
  if (doc.legs.length) {
    doc.description = doc.legs.map(l => `${l.from}→${l.to}${l.flightNo ? ` (${l.flightNo})` : ''}`).join(', ');
  } else {
    doc.description = 'Trip.com booking';
    doc.warnings.push('No flight legs recognised — check the document.');
  }

  let score = 0;
  if (doc.bookingNo) score += 0.2;
  if (doc.totalAmount) score += 0.3;
  if (doc.people.length) score += 0.2;
  if (doc.legs.length) score += 0.2;
  if (doc.paymentDate) score += 0.1;
  doc.confidence = score;
  return doc;
}

export function firstLegDate(doc: ParsedDoc): string | undefined {
  return doc.legs.find(l => l.date)?.date;
}
