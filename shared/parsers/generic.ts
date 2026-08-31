import { Category, ParsedDoc, normalize } from './types';
import { extractKeywords } from '../keywords';

const CATEGORY_KEYWORDS: Array<[Category, RegExp]> = [
  ['flight', /\b(flight|airline|boarding|airways|airasia|batik|departure|e-?ticket)\b|航空|搭乗/i],
  ['accommodation', /\b(hotel|hostel|check-?in|checkout|night stay|accommodation|ryokan|airbnb|agoda|booking\.com)\b|ホテル|旅館|酒店|入住/i],
  ['pass', /\b(rail pass|jr pass|suica|icoca|day pass|unlimited ride)\b/i],
  ['entrance', /\b(admission|entrance|entry ticket|theme park|museum|universal studios|disneyland|disney)\b|入場/i],
  ['transport', /\b(taxi|grab|train|bus|shinkansen|metro|transfer|klook transport|ferry)\b|新幹線|地下鉄/i],
  ['food', /\b(restaurant|cafe|ramen|sushi|dining|meal|food)\b|レストラン|餐厅/i],
  ['shopping', /\b(don ?quijote|uniqlo|mall|store|purchase|tax-?free)\b|免税/i],
];

/** Best-effort parse for anything no dedicated parser recognises (v0.11:
 *  driven by the universal keyword extractor; all candidates ride along in
 *  doc.keywords so the review screen can offer tappable chips). */
export function parseGeneric(raw: string): ParsedDoc {
  const text = normalize(raw);
  const kw = extractKeywords(text);
  const doc: ParsedDoc = {
    parser: 'generic', docType: 'other',
    people: [], legs: [], fields: {}, warnings: [], confidence: 0.2, suggestExpense: true,
    keywords: kw,
  };

  if (kw.vendors[0]) doc.vendor = kw.vendors[0].raw;

  // category: flights beat keyword sniffing; check-in-role dates imply a stay
  if (kw.flights.some(f => f.flightNo)) doc.category = 'flight';
  else if (kw.dates.some(d => d.role === 'checkin')) doc.category = 'accommodation';
  else for (const [c, re] of CATEGORY_KEYWORDS) if (re.test(text)) { doc.category = c; break; }
  doc.category ??= 'other';

  // amounts: top-scored candidate (context beats magnitude)
  if (kw.amounts[0]) {
    doc.currency = kw.amounts[0].currency;
    doc.totalAmount = kw.amounts[0].value;
  }

  // dates by role
  const byRole = (r: string) => kw.dates.find(d => d.role === r)?.iso;
  doc.checkInDate = byRole('checkin');
  doc.checkOutDate = byRole('checkout');
  doc.paymentDate = byRole('payment') ?? (doc.category !== 'accommodation' ? kw.dates[0]?.iso : undefined);
  const due = byRole('due');
  if (due) doc.fields['Due'] = due;

  if (kw.refs[0]) doc.bookingNo = kw.refs[0].value;
  if (kw.payments[0]) doc.paymentMethod = kw.payments.map(p => p.raw).slice(0, 2).join(' ');
  doc.people = kw.names.map(n => n.raw);

  if (kw.flights.length) {
    const nos = kw.flights.filter(f => f.flightNo).map(f => f.flightNo).join(', ');
    const routes = kw.flights.filter(f => f.from).map(f => `${f.from}→${f.to}`).join(', ');
    if (nos) doc.fields['Flights'] = nos;
    if (routes) doc.fields['Route'] = routes;
  }

  // description: first meaningful line that isn't just a label/number
  const firstLine = text.split('\n').map(l => l.trim())
    .find(l => l.length > 3 && !/^(page|tel|fax|www\.|http)/i.test(l));
  doc.description = (firstLine ?? 'Uploaded document').slice(0, 80);

  doc.warnings.push('Format not recognised — best-effort guesses. Tap the detected keywords below to correct any field.');
  return doc;
}
