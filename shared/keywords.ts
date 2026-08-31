// Universal keyword extraction for unknown documents (v0.11).
// Pure functions over plain text (from a PDF's embedded text or from OCR),
// language-aware for EN + BM + JP + CN. No network, fully unit-testable.

export interface Kw { raw: string; context: string }
export interface KwDate extends Kw { iso: string; role?: 'checkin' | 'checkout' | 'due' | 'payment' | 'departure' }
export interface KwAmount extends Kw { currency: string; value: number; score: number }
export interface KwRef extends Kw { value: string; label?: string }
export interface KwFlight extends Kw { flightNo?: string; from?: string; to?: string }

export interface KeywordSet {
  dates: KwDate[];
  amounts: KwAmount[];
  refs: KwRef[];
  flights: KwFlight[];
  names: Kw[];
  vendors: Kw[];
  payments: Kw[];
}

const MONTHS_EN: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const MONTHS_BM: Record<string, number> = {
  januari: 1, februari: 2, mac: 3, april: 4, mei: 5, jun: 6, julai: 7,
  ogos: 8, september: 9, oktober: 10, november: 11, disember: 12,
  ogo: 8, okt: 10, dis: 12,
};
const monthNum = (s: string): number | undefined =>
  MONTHS_EN[s.toLowerCase()] ?? MONTHS_BM[s.toLowerCase()];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number): string | null =>
  (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100) ? `${y}-${pad(m)}-${pad(d)}` : null;

/** ~40 chars of surrounding text, single-spaced, for chip tooltips + role detection. */
function contextAt(text: string, index: number, len: number): string {
  const start = Math.max(0, index - 40);
  return text.slice(start, index + len + 40).replace(/\s+/g, ' ').trim();
}

const ROLE_WORDS: Array<[KwDate['role'], RegExp]> = [
  ['checkin', /check[ -]?in|daftar\s*masuk|チェックイン|入住/i],
  ['checkout', /check[ -]?out|daftar\s*keluar|チェックアウト|退房|退去/i],
  ['due', /\bdue\b|pay (?:by|before)|payment deadline|bayar sebelum|tarikh akhir|支払期限|期限|截止|最迟/i],
  ['payment', /\bpaid\b|payment date|transaction|purchase date|tarikh (?:bayaran|pembayaran)|支払日|決済|支付|付款/i],
  ['departure', /depart|departure|berlepas|出発|出发|離陸/i],
];
function roleFor(context: string): KwDate['role'] {
  for (const [role, re] of ROLE_WORDS) if (re.test(context)) return role;
  return undefined;
}

function pushDate(out: KwDate[], iso: string | null, raw: string, context: string) {
  if (!iso) return;
  const role = roleFor(context);
  const dup = out.find(d => d.iso === iso && d.role === role);
  if (!dup) out.push({ iso, raw, context, role });
}

export function extractDates(text: string): KwDate[] {
  const out: KwDate[] = [];
  // ISO 2026-12-20
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    pushDate(out, ymd(+m[1], +m[2], +m[3]), m[0], contextAt(text, m.index!, m[0].length));
  }
  // Dec 20, 2026 / December 20 2026
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/g)) {
    const mon = monthNum(m[1]);
    if (mon) pushDate(out, ymd(+m[3], mon, +m[2]), m[0], contextAt(text, m.index!, m[0].length));
  }
  // 20 December 2026 / 20 Dis 2026 (EN + BM month names)
  for (const m of text.matchAll(/\b(\d{1,2})(?:hb)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g)) {
    const mon = monthNum(m[2]);
    if (mon) pushDate(out, ymd(+m[3], mon, +m[1]), m[0], contextAt(text, m.index!, m[0].length));
  }
  // 2026年12月20日 (JP/CN)
  for (const m of text.matchAll(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) {
    pushDate(out, ymd(+m[1], +m[2], +m[3]), m[0], contextAt(text, m.index!, m[0].length));
  }
  // 20/12/2026 or 20-12-2026 — day-first (Malaysian convention); swap when day>12 says month-first
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g)) {
    let d = +m[1], mo = +m[2];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    pushDate(out, ymd(+m[3], mo, d), m[0], contextAt(text, m.index!, m[0].length));
  }
  // Two-column layouts put "Check-in Check-out" on one line and both dates on
  // the next, so both dates see both labels. When that happens, the earlier
  // date is the check-in and the later one the check-out.
  const paired = out.filter(d => d.role === 'checkin' && /check[ -]?out|チェックアウト|退房|退去|daftar\s*keluar/i.test(d.context));
  if (paired.length >= 2 && !out.some(d => d.role === 'checkout')) {
    paired.reduce((a, b) => (a.iso >= b.iso ? a : b)).role = 'checkout';
  }
  return out;
}

const CUR_BEFORE = /(MYR|RM|USD|SGD|JPY|EUR|GBP|THB|IDR|KRW|CNY|RMB|AUD|HKD|TWD|PHP|VND|NTD|US\$|S\$|\$|¥|€|£)\s*([\d]{1,3}(?:[,.\s]\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;
const CUR_AFTER = /([\d]{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+)\s*(円|元|ドル|yen)/g;
function normCur(c: string): string {
  const up = c.toUpperCase();
  if (up === 'RM') return 'MYR';
  if (up === '¥' || up === '円' || up === 'YEN') return 'JPY';
  if (up === '元' || up === 'RMB') return 'CNY';
  if (up === '$' || up === 'US$' || up === 'ドル') return 'USD';
  if (up === 'S$') return 'SGD';
  if (up === '€') return 'EUR';
  if (up === '£') return 'GBP';
  if (up === 'NTD') return 'TWD';
  return up;
}
const AMOUNT_BOOST = /grand\s*total|\btotal\b|amount\s*(?:due|paid|payable)|balance\s*due|jumlah(?:\s*(?:besar|keseluruhan))?|合計|総額|总额|總額|总计|總計|应付|應付/i;
const AMOUNT_MILD = /\bdue\b|payable|\bpaid\b|charge|dibayar|amaun|小計|支払|支付|付款/i;
const AMOUNT_PENALTY = /per\s*night|per\s*pax|deposit|\btax\b|\bfee\b|semalam|cukai|税|deducted|discount|diskaun|refund/i;

export function extractAmounts(text: string): KwAmount[] {
  const found: KwAmount[] = [];
  const add = (curRaw: string, numRaw: string, raw: string, index: number) => {
    const value = Number(numRaw.replace(/[,\s]/g, '').replace(/\.(?=\d{3}\b)/g, ''));
    if (!(value > 0) || value > 100_000_000) return;
    const context = contextAt(text, index, raw.length);
    // score on the amount's own line only, so a "Total" label on a
    // neighbouring line can't boost the wrong number
    const lineStart = text.lastIndexOf('\n', index) + 1;
    const lineEndRaw = text.indexOf('\n', index);
    const line = text.slice(lineStart, lineEndRaw === -1 ? undefined : lineEndRaw);
    let score = 0;
    if (AMOUNT_BOOST.test(line)) score += 3;
    else if (AMOUNT_MILD.test(line)) score += 2;
    if (AMOUNT_PENALTY.test(line)) score -= 2;
    found.push({ currency: normCur(curRaw), value, raw, context, score });
  };
  for (const m of text.matchAll(CUR_BEFORE)) add(m[1], m[2], m[0], m.index!);
  for (const m of text.matchAll(CUR_AFTER)) add(m[2], m[1], m[0], m.index!);
  // de-dup identical currency+value, keep the best-scored context
  const best = new Map<string, KwAmount>();
  for (const a of found) {
    const k = `${a.currency}:${a.value}`;
    if (!best.has(k) || best.get(k)!.score < a.score) best.set(k, a);
  }
  return [...best.values()].sort((a, b) => b.score - a.score || b.value - a.value);
}

// label + value must sit on ONE line ([ \t] not \s) — otherwise a bare word
// like "OFFICIAL RECEIPT" bridges to the next line and eats the real match
const REF_LABEL = /(booking|confirmation|order|reference|invoice|receipt|reservation|itinerary|voucher|tempahan|rujukan|resit|予約|確認|注文|订单|訂單|凭证)[ \t]*(?:no\.?|number|num|code|#|id|番号|号|号码|編號)?[ \t]*[:：#]?[ \t]*([A-Z0-9][A-Z0-9-]{4,24})\b/gi;
const REF_STOP = /^(NUMBER|BOOKING|PAYMENT|INVOICE|RECEIPT|DETAILS?|CONFIRM(?:ED)?|SUMMARY|AMOUNT|ONLINE|STATUS)$/i;

export function extractRefs(text: string): KwRef[] {
  const out: KwRef[] = [];
  for (const m of text.matchAll(REF_LABEL)) {
    const value = m[2];
    if (REF_STOP.test(value) || /^\d{1,4}$/.test(value)) continue;
    if (!/\d/.test(value) && value !== value.toUpperCase()) continue; // Title-case word, not a code
    if (!out.some(r => r.value === value)) {
      out.push({ value, label: m[1], raw: m[0], context: contextAt(text, m.index!, m[0].length) });
    }
  }
  // bare 6-char PNR close to a booking word (e.g. "Booking AJ6ZYE")
  for (const m of text.matchAll(/\b([A-Z0-9]{6})\b/g)) {
    const v = m[1];
    if (!/[A-Z]/.test(v) || !/\d/.test(v)) continue; // must mix letters+digits
    const ctx = contextAt(text, m.index!, v.length);
    if (/booking|pnr|reference|tempahan|予約/i.test(ctx) && !out.some(r => r.value === v)) {
      out.push({ value: v, raw: v, context: ctx });
    }
  }
  return out;
}

// Airline designators worth trusting when followed by digits.
const AIRLINES = 'AK|D7|XJ|FD|QZ|Z2|OD|MH|FY|MF|8M|JL|NH|MM|GK|7G|IJ|SQ|TR|3K|JQ|CX|UO|HX|KE|OZ|LJ|7C|TW|ZE|BX|CI|BR|IT|JX|EK|QR|EY|SV|TG|VZ|VN|VJ|GA|ID|5J|PR|CA|MU|CZ|HO|9C|KL|LH|BA|AF|QF|NZ|UA|AA|DL|WY|UL|AI|6E|BI|NX';
const FLIGHT_RE = new RegExp(`\\b(${AIRLINES})\\s?(\\d{1,4})\\b`, 'g');
const ROUTE_RE = /\b([A-Z]{3})\s*(?:[-–—→>]|to)\s*([A-Z]{3})\b/g;
const IATA_STOP = /^(THE|AND|FOR|NOT|ALL|PDF|USD|MYR|JPY|SGD|GMT|UTC|TAX|QTY|REF|VIA|MON|TUE|WED|THU|FRI|SAT|SUN|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/;

export function extractFlights(text: string): KwFlight[] {
  const out: KwFlight[] = [];
  for (const m of text.matchAll(FLIGHT_RE)) {
    const flightNo = `${m[1]}${m[2]}`;
    if (!out.some(f => f.flightNo === flightNo)) {
      out.push({ flightNo, raw: m[0], context: contextAt(text, m.index!, m[0].length) });
    }
  }
  for (const m of text.matchAll(ROUTE_RE)) {
    if (IATA_STOP.test(m[1]) || IATA_STOP.test(m[2]) || m[1] === m[2]) continue;
    if (!out.some(f => f.from === m[1] && f.to === m[2])) {
      out.push({ from: m[1], to: m[2], raw: m[0], context: contextAt(text, m.index!, m[0].length) });
    }
  }
  return out;
}

const NAME_STOP = /total|amount|booking|payment|hotel|address|airport|terminal|invoice|receipt|check|guest|passenger|flight|airlines?|voucher|confirmation|jumlah|tarikh|nombor|date|room|night|adult|infant|child|policy|cancellation|departure|arrival|tax|status|online|per|the|your|\bsdn\b|\bbhd\b|\bltd\b|\binc\b|\bplc\b|\bllc\b|enterprise|travel|tours?\b/i;

export function extractNames(text: string): Kw[] {
  const out: Kw[] = [];
  const push = (raw: string, context: string) => {
    const clean = raw.trim().replace(/\s+/g, ' ');
    if (!out.some(n => n.raw.toUpperCase() === clean.toUpperCase())) out.push({ raw: clean, context });
  };
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.length > 50 || /\d/.test(t) || NAME_STOP.test(t)) continue;
    // Malaysian ALL-CAPS full names: NAME BIN/BINTI/A/L/A/P NAME
    if (/^[A-Z][A-Z' .]+\s(?:BIN|BINTI|BTE?|A\/L|A\/P)\s[A-Z][A-Z' .]+$/.test(t)) { push(t, t); continue; }
    // Plain 2–4 word Title-Case or ALL-CAPS name lines
    const words = t.split(/\s+/);
    if (words.length >= 2 && words.length <= 4 &&
        words.every(w => /^(?:[A-Z][a-z'.-]+|[A-Z]{2,})$/.test(w))) push(t, t);
  }
  // Malaysian-style ALL-CAPS names inline anywhere (wraps across lines, commas ok)
  for (const m of text.matchAll(/([A-Z][A-Z'.]{1,20}(?:\s+[A-Z][A-Z'.]{1,20}){0,2})\s+(BIN|BINTI|BTE|A\/L|A\/P)\s+([A-Z][A-Z'.]{1,20}(?:\s+[A-Z][A-Z'.]{1,20})?)/g)) {
    const full = `${m[1]} ${m[2]} ${m[3]}`.replace(/\s+/g, ' ');
    if (!NAME_STOP.test(full)) push(full, contextAt(text, m.index!, m[0].length));
  }
  // Labelled names: "Guest name: X", "Passenger(s): X", "Nama: X"
  for (const m of text.matchAll(/(?:guest\s*names?|passengers?|traveller?s?|nama(?:\s*penuh)?|氏名|姓名)\s*[:：]\s*([A-Za-z' .]{4,50})/gi)) {
    const v = m[1].trim();
    if (!NAME_STOP.test(v)) push(v, contextAt(text, m.index!, m[0].length));
  }
  return out.slice(0, 12);
}

const VENDOR_BRANDS: Array<[string, RegExp]> = [
  ['Trip.com', /trip\.com|ctrip/i], ['Airbnb', /airbnb/i], ['AirAsia', /airasia|move by|move travel/i],
  ['Klook', /klook/i], ['Agoda', /agoda/i], ['Booking.com', /booking\.com/i],
  ['Traveloka', /traveloka/i], ['Expedia', /expedia/i], ['Hotels.com', /hotels\.com/i],
  ['Malaysia Airlines', /malaysia airlines|\bMAB\b/i], ['Batik Air', /batik air|malindo/i],
  ['Firefly', /firefly/i], ['Scoot', /\bscoot\b/i], ['Jetstar', /jetstar/i],
  ['Singapore Airlines', /singapore airlines/i], ['ANA', /all nippon|\bANA\b/],
  ['Japan Airlines', /japan airlines|\bJAL\b/], ['Peach', /peach aviation/i], ['ZIPAIR', /zipair/i],
  ['JR', /japan rail|JR (?:East|West|Central|Pass)/i], ['Grab', /\bgrab(?:pay|car|food)?\b/i],
  ['Klia Ekspres', /klia ekspres/i], ['Touch ’n Go', /touch\s*'?n'?\s*go|\bTNG\b/i],
  ['Shopee', /shopee/i], ['EasyBook', /easybook/i],
];

export function extractVendors(text: string): Kw[] {
  const out: Kw[] = [];
  for (const [name, re] of VENDOR_BRANDS) {
    const m = text.match(re);
    if (m && !out.some(v => v.raw === name)) {
      out.push({ raw: name, context: contextAt(text, m.index ?? 0, m[0].length) });
    }
  }
  // sender-ish domains as a fallback hint
  for (const m of text.matchAll(/@([a-z0-9][a-z0-9-]{2,30})\.(?:com|co|net|my|jp|sg|cn|io)\b/gi)) {
    const dom = m[1].toLowerCase();
    if (['gmail', 'yahoo', 'hotmail', 'outlook', 'icloud'].includes(dom)) continue;
    const label = dom.charAt(0).toUpperCase() + dom.slice(1);
    if (!out.some(v => v.raw.toLowerCase().startsWith(dom.slice(0, 5)))) {
      out.push({ raw: label, context: contextAt(text, m.index!, m[0].length) });
    }
  }
  return out.slice(0, 5);
}

export function extractPayments(text: string): Kw[] {
  const out: Kw[] = [];
  // CJK terms carry no \b word boundaries, so they get their own pass
  for (const m of text.matchAll(/(クレジットカード|クレジット|信用卡|银联|銀聯|支付宝|微信支付|現金|现金)/g)) {
    if (!out.some(p => p.raw === m[1])) out.push({ raw: m[1], context: contextAt(text, m.index!, m[0].length) });
  }
  for (const m of text.matchAll(/\b(visa|master\s?card|amex|american express|fpx|touch\s*'?n'?\s*go|tng ?ewallet|grabpay|boost|duitnow|maybank|cimb|public bank|rhb|paypal|alipay|wechat ?pay|unionpay|credit card|debit card|kad kredit)\b/gi)) {
    const v = m[1].replace(/\s+/g, ' ');
    if (!out.some(p => p.raw.toLowerCase() === v.toLowerCase())) {
      out.push({ raw: v, context: contextAt(text, m.index!, m[0].length) });
    }
  }
  for (const m of text.matchAll(/(?:ending(?:\s*in)?|\*{2,})\s*(\d{4})\b/g)) {
    out.push({ raw: `•••• ${m[1]}`, context: contextAt(text, m.index!, m[0].length) });
    break;
  }
  return out.slice(0, 4);
}

export function extractKeywords(text: string): KeywordSet {
  return {
    dates: extractDates(text),
    amounts: extractAmounts(text),
    refs: extractRefs(text),
    flights: extractFlights(text),
    names: extractNames(text),
    vendors: extractVendors(text),
    payments: extractPayments(text),
  };
}
