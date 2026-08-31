import { ParsedDoc, MONTHS, normalize, parseAmount, ymd } from './types';

/** "09 Mar 2026" -> 2026-03-09 */
function parseShortDate(s: string): string | undefined {
  const m = s.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  if (!m) return undefined;
  const mon = MONTHS[m[2].toLowerCase()];
  if (!mon) return undefined;
  return ymd(Number(m[3]), mon, Number(m[1]));
}

export function detectAirasia(text: string): boolean {
  return /(airasia|Move Travel Sdn Bhd)/i.test(text) && /Total amount/i.test(text) && /Base fare/i.test(text);
}

/** AirAsia / MOVE invoice: booking + guests + amounts, but NO flight legs on the
    document — route and dates are confirmed on the review screen (or via a matching
    itinerary uploaded later). */
export function parseAirasia(raw: string): ParsedDoc {
  const text = normalize(raw);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const doc: ParsedDoc = {
    parser: 'airasia-invoice', vendor: 'AirAsia', docType: 'receipt',
    people: [], legs: [], fields: {}, warnings: [], confidence: 0, suggestExpense: true,
  };
  doc.category = 'flight';

  // Booking no.: a short all-caps code within a few lines of the "Booking no." header
  const bIdx = lines.findIndex(l => /Booking no\./i.test(l));
  if (bIdx >= 0) {
    for (const l of lines.slice(bIdx + 1, bIdx + 4)) {
      if (/^[A-Z0-9]{5,8}$/.test(l)) { doc.bookingNo = l; break; }
    }
    const d = lines.slice(bIdx + 1, bIdx + 4).map(parseShortDate).find(Boolean);
    if (d) doc.fields['Booking date'] = d;
  }

  // Guests block: "Name (Adult) Name (Adult)" pairs per line, until "Payment details"
  const gIdx = lines.findIndex(l => /^Guests$/i.test(l));
  if (gIdx >= 0) {
    for (const l of lines.slice(gIdx + 1, gIdx + 12)) {
      if (/^Payment details/i.test(l)) break;
      for (const m of l.matchAll(/([A-Z][A-Za-z'./ -]+?)\s*\((Adult|Child|Infant)\)/g)) {
        doc.people.push(m[1].trim());
      }
    }
  }

  const total = lines.find(l => /^Total amount paid/i.test(l))?.match(/([A-Z]{2,3})\s*([\d,]+\.\d{2})/)
    ?? lines.find(l => /^Total amount/i.test(l))?.match(/([A-Z]{2,3})\s*([\d,]+\.\d{2})/);
  if (total) { doc.currency = total[1] === 'RM' ? 'MYR' : total[1]; doc.totalAmount = parseAmount(total[2]); }

  const base = lines.find(l => /^Base fare/i.test(l))?.match(/([A-Z]{2,3})\s*([\d,]+\.\d{2})/);
  if (base) doc.fields['Base fare'] = `${base[1]} ${base[2]}`;
  const taxes = lines.find(l => /^Taxes, fees/i.test(l))?.match(/([A-Z]{2,3})\s*([\d,]+\.\d{2})/);
  if (taxes) doc.fields['Taxes & fees'] = `${taxes[1]} ${taxes[2]}`;

  // "Mon, 09 Mar 2026 (UTC) Visa MYR 934.70"
  const payLine = lines.find(l => /\(UTC\)/.test(l)) ?? lines[lines.length - 1];
  if (payLine) {
    doc.paymentDate = parseShortDate(payLine);
    const method = payLine.match(/\(UTC\)\s+(.+?)\s+[A-Z]{2,3}\s*[\d,]+\.\d{2}/);
    if (method) doc.paymentMethod = method[1].trim();
  }

  doc.description = `AirAsia booking${doc.bookingNo ? ` ${doc.bookingNo}` : ''}`;
  doc.warnings.push('AirAsia invoices carry no flight route/date — set the flight date and description here, or upload the itinerary too.');

  let score = 0;
  if (doc.bookingNo) score += 0.25;
  if (doc.totalAmount) score += 0.3;
  if (doc.people.length) score += 0.25;
  if (doc.paymentDate) score += 0.2;
  doc.confidence = score;
  return doc;
}
