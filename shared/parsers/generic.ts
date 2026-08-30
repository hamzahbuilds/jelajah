import { Category, ParsedDoc, normalize, parseAmount, parseLongDate, normCurrency } from './types';

const CATEGORY_KEYWORDS: Array<[Category, RegExp]> = [
  ['flight', /\b(flight|airline|boarding|airways|airasia|batik|departure|e-?ticket)\b/i],
  ['accommodation', /\b(hotel|hostel|check-?in|checkout|night stay|accommodation|ryokan|airbnb|agoda|booking\.com)\b/i],
  ['pass', /\b(rail pass|jr pass|suica|icoca|day pass|unlimited ride)\b/i],
  ['entrance', /\b(admission|entrance|entry ticket|theme park|museum|universal studios|disneyland|disney)\b/i],
  ['transport', /\b(taxi|grab|train|bus|shinkansen|metro|transfer|klook transport)\b/i],
  ['food', /\b(restaurant|cafe|ramen|sushi|dining|meal|food)\b/i],
  ['shopping', /\b(don ?quijote|uniqlo|mall|store|purchase|tax-?free)\b/i],
];

const VENDOR_KEYWORDS: Array<[string, RegExp]> = [
  ['Trip.com', /trip\.com/i], ['Airbnb', /airbnb/i], ['Klook', /klook/i],
  ['Agoda', /agoda/i], ['Booking.com', /booking\.com/i], ['AirAsia', /airasia/i],
];

export function parseGeneric(raw: string): ParsedDoc {
  const text = normalize(raw);
  const doc: ParsedDoc = {
    parser: 'generic', docType: 'other',
    people: [], legs: [], fields: {}, warnings: [], confidence: 0.1, suggestExpense: true,
  };

  for (const [v, re] of VENDOR_KEYWORDS) if (re.test(text)) { doc.vendor = v; break; }
  for (const [c, re] of CATEGORY_KEYWORDS) if (re.test(text)) { doc.category = c; break; }
  doc.category ??= 'other';

  // Largest money-looking amount wins as the candidate total
  let best: { cur: string; amt: number } | undefined;
  for (const m of text.matchAll(/\b(MYR|RM|JPY|USD|SGD|EUR|GBP|¥)\s*([\d,]+(?:\.\d{2})?)\b/gi)) {
    const amt = parseAmount(m[2]);
    if (!best || amt > best.amt) best = { cur: normCurrency(m[1]), amt };
  }
  if (best) { doc.currency = best.cur; doc.totalAmount = best.amt; }

  const d = parseLongDate(text) ?? text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)?.[0];
  if (d) doc.paymentDate = typeof d === 'string' && d.includes('-') ? d : d;

  const ref = text.match(/\b(?:Booking|Confirmation|Order|Reference)\s*(?:No\.?|code|#|ID)?[:\s]+([A-Z0-9-]{6,20})\b/i);
  if (ref) doc.bookingNo = ref[1];

  const firstLine = text.split('\n').map(l => l.trim()).find(l => l.length > 3);
  doc.description = firstLine?.slice(0, 80) ?? 'Uploaded document';
  doc.warnings.push('Format not recognised — fields below are best-effort guesses; please check everything.');
  return doc;
}
