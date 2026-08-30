import { ParsedDoc, MONTHS, normalize, parseAmount, normCurrency, ymd } from './types';

export function detectAirbnb(text: string): boolean {
  return /Airbnb/i.test(text) && /Check-?in/i.test(text) && /Checkout/i.test(text);
}

/** Airbnb trip PDFs print dates without a year ("Sun, Nov 29"). Infer the nearest sensible year. */
function inferYear(month: number, day: number, today = new Date()): number {
  const y = today.getFullYear();
  for (const cand of [y, y + 1, y - 1]) {
    const dt = new Date(Date.UTC(cand, month - 1, day));
    const diffDays = (dt.getTime() - today.getTime()) / 86400000;
    if (diffDays > -60 && diffDays < 400) return cand; // recent past or up to ~13 months ahead
  }
  return y;
}

export function parseAirbnb(raw: string): ParsedDoc {
  const text = normalize(raw);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const doc: ParsedDoc = {
    parser: 'airbnb-confirmation', vendor: 'Airbnb', docType: 'confirmation',
    people: [], legs: [], fields: {}, warnings: [], confidence: 0, suggestExpense: true,
  };
  doc.category = 'accommodation';

  const title = lines.find(l => /^Home in /i.test(l) || /^(Apartment|Villa|Room) in /i.test(l));
  const hostLine = lines.find(l => /^Hosted by /i.test(l));
  const host = hostLine?.replace(/^Hosted by\s*/i, '');
  doc.description = title ?? 'Airbnb stay';
  if (host) doc.fields['Host'] = host;

  // "Check-in Checkout" / "Sun, Nov 29 Thu, Dec 3" / "4:00 PM 10:00 AM"
  const hdr = lines.findIndex(l => /^Check-?in\s+Checkout$/i.test(l));
  if (hdr >= 0) {
    const dm = lines[hdr + 1]?.match(/^\w{3},\s*([A-Za-z]{3,9})\s+(\d{1,2})\s+\w{3},\s*([A-Za-z]{3,9})\s+(\d{1,2})$/);
    if (dm) {
      const m1 = MONTHS[dm[1].toLowerCase()], m2 = MONTHS[dm[3].toLowerCase()];
      if (m1 && m2) {
        const y1 = inferYear(m1, Number(dm[2]));
        doc.checkInDate = ymd(y1, m1, Number(dm[2]));
        // checkout may wrap into the next year (Dec -> Jan)
        let y2 = y1;
        if (m2 < m1) y2 = y1 + 1;
        doc.checkOutDate = ymd(y2, m2, Number(dm[4]));
        doc.warnings.push('Airbnb PDFs omit the year — inferred it; confirm the dates.');
      }
    }
    const tm = lines[hdr + 2]?.match(/^(\d{1,2}:\d{2}\s*[AP]M)\s+(\d{1,2}:\d{2}\s*[AP]M)$/i);
    if (tm) { doc.checkInTime = tm[1]; doc.checkOutTime = tm[2]; }
  }

  const conf = lines.findIndex(l => /^Confirmation code$/i.test(l));
  if (conf >= 0 && /^[A-Z0-9]{8,12}$/.test(lines[conf + 1] ?? '')) doc.bookingNo = lines[conf + 1];

  const totalLine = lines.find(l => /Total cost:/i.test(l));
  const t = totalLine?.match(/Total cost:\s*([A-Z]{2,3})\s*([\d,]+\.\d{2})/i);
  if (t) { doc.currency = normCurrency(t[1]); doc.totalAmount = parseAmount(t[2]); }

  const g = text.match(/(\d+)\s+guests?(?:\s+and\s+(\d+)\s+infants?)?/i);
  if (g) doc.guests = { adults: Number(g[1]), infants: g[2] ? Number(g[2]) : 0 };

  // Address: line (possibly wrapped) ending in ", Japan" or containing a postal code + country
  const joined = lines.join('\n');
  const addr = joined.match(/^([^\n]{10,120}(?:-\n[^\n]{1,60})?),\s*(Japan|Malaysia|[A-Z][a-z]+)$/m)
    ?? joined.match(/([^\n]{10,120}\d{3}-?\n?\d{4},\s*\w+)/);
  if (addr) doc.location = addr[0].replace(/-?\n/g, '').replace(/\s+/g, ' ').trim();
  if (!doc.location) {
    const gi = lines.findIndex(l => /^Getting there$/i.test(l));
    if (gi >= 0) {
      // take the longest of the next few lines (skip UI labels)
      const cand = lines.slice(gi + 1, gi + 4).filter(l => !/^(Copy address|Get directions|House manual)/i.test(l));
      doc.location = cand.sort((a, b) => b.length - a.length)[0];
    }
  }

  doc.warnings.push('Airbnb charges may be split/instalment — add a payment due date if the total is not fully charged yet.');
  if (doc.guests && doc.people.length === 0) {
    doc.warnings.push(`Document lists ${doc.guests.adults} guests but no names — pick the participants on this screen.`);
  }

  let score = 0;
  if (doc.totalAmount) score += 0.3;
  if (doc.checkInDate && doc.checkOutDate) score += 0.3;
  if (doc.bookingNo) score += 0.2;
  if (doc.location) score += 0.1;
  if (doc.checkInTime) score += 0.1;
  doc.confidence = score;
  return doc;
}
