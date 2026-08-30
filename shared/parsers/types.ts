export type Category =
  | 'accommodation' | 'flight' | 'transport' | 'entrance'
  | 'pass' | 'food' | 'shopping' | 'other';

export interface ParsedLeg {
  from?: string;
  to?: string;
  date?: string;      // YYYY-MM-DD
  depTime?: string;   // HH:MM
  arrTime?: string;
  depPlace?: string;
  arrPlace?: string;
  airline?: string;
  flightNo?: string;
}

export interface ParsedDoc {
  parser: string;
  vendor?: string;
  docType: 'receipt' | 'itinerary' | 'confirmation' | 'other';
  bookingNo?: string;
  category?: Category;
  description?: string;
  totalAmount?: number;
  currency?: string;          // ISO code, RM normalised to MYR
  paymentMethod?: string;
  paymentDate?: string;       // YYYY-MM-DD (date money moved / booking date)
  people: string[];           // names found on the document
  legs: ParsedLeg[];
  checkInDate?: string;
  checkInTime?: string;
  checkOutDate?: string;
  checkOutTime?: string;
  location?: string;
  guests?: { adults?: number; infants?: number };
  fields: Record<string, string>; // extra key/values worth showing
  warnings: string[];
  confidence: number;         // 0..1
  suggestExpense: boolean;    // itineraries default to document-only
}

export const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

export function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "November 29, 2026" -> 2026-11-29 */
export function parseLongDate(s: string): string | undefined {
  const m = s.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return undefined;
  const mon = MONTHS[m[1].toLowerCase()];
  if (!mon) return undefined;
  return ymd(Number(m[3]), mon, Number(m[2]));
}

/** Normalise odd unicode (U+2236 ratio colon used by Trip.com PDFs) and whitespace */
export function normalize(text: string): string {
  return text
    .replace(/∶/g, ':')
    .replace(/(\d)\s*:\s*(\d{2})/g, '$1:$2')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, ' ');
}

export function parseAmount(s: string): number {
  return Number(s.replace(/,/g, ''));
}

export function normCurrency(c: string): string {
  const up = c.toUpperCase();
  if (up === 'RM') return 'MYR';
  if (up === '¥' || up === 'YEN') return 'JPY';
  return up;
}
