import { ParsedDoc, normalize, parseAmount, parseLongDate } from './types';

export function detectTripcomVoucher(text: string): boolean {
  return /Check-?in voucher/i.test(text) && /Booking No/i.test(text) && /Guest names/i.test(text);
}

/** Trip.com-style hotel check-in voucher (typically pay-at-hotel bookings). */
export function parseTripcomVoucher(raw: string): ParsedDoc {
  const text = normalize(raw);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const joined = lines.join(' ');
  const doc: ParsedDoc = {
    parser: 'tripcom-hotel-voucher', vendor: 'Trip.com', docType: 'confirmation',
    people: [], legs: [], fields: {}, warnings: [], confidence: 0, suggestExpense: true,
    paymentStatus: 'pay_at_hotel',
  };
  doc.category = 'accommodation';

  const bm = joined.match(/Booking No\.?:?\s*(\d{8,})/i);
  if (bm) doc.bookingNo = bm[1];
  const conf = joined.match(/Confirmation no\.?\s*(\d{8,})/i);
  if (conf) doc.fields['Confirmation no.'] = conf[1];

  // Hotel name: the line right before "Address:"
  const addrIdx = lines.findIndex(l => /^Address:/i.test(l));
  if (addrIdx > 0) {
    doc.description = lines[addrIdx - 1];
    doc.location = lines[addrIdx].replace(/^Address:\s*/i, '');
  }

  // "Dec 20, 2026 Dec 22, 2026 1 / 2"  (check-in, check-out, rooms/nights)
  const dl = lines.find(l => /[A-Za-z]{3,9} \d{1,2}, \d{4}\s+[A-Za-z]{3,9} \d{1,2}, \d{4}/.test(l));
  if (dl) {
    const dates = [...dl.matchAll(/([A-Za-z]{3,9} \d{1,2}, \d{4})/g)].map(m => parseLongDate(m[1]));
    doc.checkInDate = dates[0];
    doc.checkOutDate = dates[1];
    const rn = dl.match(/(\d+)\s*\/\s*(\d+)/);
    if (rn) { doc.fields['Rooms'] = rn[1]; doc.fields['Nights'] = rn[2]; }
  }
  // "15:00–00:00 Before 10:00"
  const tl = lines.find(l => /^\d{1,2}:\d{2}[–-]/.test(l));
  if (tl) {
    doc.checkInTime = tl.match(/^(\d{1,2}:\d{2})/)?.[1];
    doc.checkOutTime = tl.match(/Before (\d{1,2}:\d{2})/i)?.[1];
  }

  const amt = lines.find(l => /^[A-Z]{2,3}\s*[\d,]+\.\d{2}\b/.test(l))?.match(/^([A-Z]{2,3})\s*([\d,]+\.\d{2})/);
  if (amt) { doc.currency = amt[1] === 'RM' ? 'MYR' : amt[1]; doc.totalAmount = parseAmount(amt[2]); }

  // Guest names: window between "Guest names" and "Occupancy", with two-column
  // noise (amounts, "Includes:", "Taxes", "Prepay Online") stripped out.
  const gm = joined.match(/Guest names\s+(.*?)\s+Occupancy/i);
  if (gm) {
    const cleanedWindow = gm[1]
      .replace(/[A-Z]{2,3}\s*[\d,]+\.\d{2}/g, ' ')
      .replace(/(Includes:?|\bTaxes\b|Prepay Online|Pay at hotel)/gi, ' ')
      .replace(/\s+/g, ' ').trim();
    doc.people = cleanedWindow.split(',').map(s => s.trim()).filter(s => /^[A-Z][A-Z'./ -]+$/.test(s) && s.length > 3);
  }

  // Two-column PDFs can orphan the year onto another line, so match time + day only.
  const cxl = joined.match(/Before (\d{1,2}:\d{2}\s*[AP]M),?\s*([A-Za-z]{3,9})\s+(\d{1,2}),?[\s\S]{0,120}?Free cancellation/i)
    ?? joined.match(/Before (\d{1,2}:\d{2}\s*[AP]M),?\s*([A-Za-z]{3,9})\s+(\d{1,2})/i);
  if (cxl) doc.fields['Free cancellation until'] = `${cxl[1]}, ${cxl[2]} ${cxl[3]}`;

  const room = lines.find(l => /\b(Twin|Double|Single|Family|Deluxe|Standard|Superior) Room\b/i.test(l));
  if (room) doc.fields['Room'] = room.replace(/^Price details\s*/i, '').trim();

  doc.warnings.push('Check-in voucher — usually PAID AT THE HOTEL. Payment status is preset to "pay at hotel"; switch it if this was prepaid.');

  let score = 0;
  if (doc.bookingNo) score += 0.2;
  if (doc.totalAmount) score += 0.2;
  if (doc.checkInDate && doc.checkOutDate) score += 0.3;
  if (doc.people.length) score += 0.2;
  if (doc.location) score += 0.1;
  doc.confidence = score;
  return doc;
}
