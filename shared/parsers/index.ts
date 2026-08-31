import { ParsedDoc } from './types';
import { detectTripcomReceipt, parseTripcomReceipt } from './tripcomReceipt';
import { detectTripcomItinerary, parseTripcomItinerary } from './tripcomItinerary';
import { detectAirbnb, parseAirbnb } from './airbnb';
import { detectAirasia, parseAirasia } from './airasia';
import { detectAirasiaItinerary, parseAirasiaItinerary } from './airasiaItinerary';
import { detectTripcomVoucher, parseTripcomVoucher } from './tripcomVoucher';
import { parseGeneric } from './generic';

export * from './types';

interface ParserEntry {
  name: string;
  detect: (text: string) => boolean;
  parse: (text: string) => ParsedDoc;
}

/** Ordered registry — first detector that matches wins; generic always matches last. */
export const PARSERS: ParserEntry[] = [
  { name: 'tripcom-itinerary', detect: detectTripcomItinerary, parse: parseTripcomItinerary },
  { name: 'tripcom-receipt', detect: detectTripcomReceipt, parse: parseTripcomReceipt },
  { name: 'airbnb-confirmation', detect: detectAirbnb, parse: parseAirbnb },
  { name: 'tripcom-hotel-voucher', detect: detectTripcomVoucher, parse: parseTripcomVoucher },
  { name: 'airasia-itinerary', detect: detectAirasiaItinerary, parse: parseAirasiaItinerary },
  { name: 'airasia-invoice', detect: detectAirasia, parse: parseAirasia },
];

export function parseDocument(text: string): ParsedDoc {
  for (const p of PARSERS) {
    try {
      if (p.detect(text)) return p.parse(text);
    } catch {
      // fall through to next parser — never let one bad regex kill ingestion
    }
  }
  return parseGeneric(text);
}
