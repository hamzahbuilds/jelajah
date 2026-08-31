// Compact airport coordinates for the journey map (no API needed).
// IATA → [lat, lng, city]. Extend freely; unknown airports are geocoded once and cached.
export const AIRPORTS: Record<string, [number, number, string]> = {
  // Malaysia & Borneo
  KUL: [2.7456, 101.7099, 'Kuala Lumpur'], SZB: [3.1303, 101.5493, 'Subang'],
  PEN: [5.2971, 100.2770, 'Penang'], LGK: [6.3297, 99.7287, 'Langkawi'],
  BKI: [5.9372, 116.0511, 'Kota Kinabalu'], KCH: [1.4847, 110.3467, 'Kuching'],
  MYY: [4.3220, 113.9868, 'Miri'], SBW: [2.2616, 111.9853, 'Sibu'], BTU: [3.1239, 113.0203, 'Bintulu'],
  JHB: [1.6383, 103.6697, 'Johor Bahru'], KBR: [6.1670, 102.2929, 'Kota Bharu'],
  // Japan
  NRT: [35.7719, 140.3928, 'Tokyo Narita'], HND: [35.5494, 139.7798, 'Tokyo Haneda'],
  KIX: [34.4347, 135.2441, 'Osaka Kansai'], ITM: [34.7855, 135.4382, 'Osaka Itami'],
  NGO: [34.8584, 136.8054, 'Nagoya'], CTS: [42.7752, 141.6923, 'Sapporo New Chitose'],
  AKJ: [43.6708, 142.4475, 'Asahikawa'], FUK: [33.5859, 130.4510, 'Fukuoka'],
  OKA: [26.1958, 127.6459, 'Okinawa'], HIJ: [34.4361, 132.9194, 'Hiroshima'],
  OKJ: [34.7569, 133.8554, 'Okayama'], OIT: [33.4794, 131.7371, 'Oita'], KOJ: [31.8034, 130.7194, 'Kagoshima'],
  // SE / E Asia hubs
  SIN: [1.3644, 103.9915, 'Singapore'], BKK: [13.6900, 100.7501, 'Bangkok Suvarnabhumi'],
  DMK: [13.9126, 100.6068, 'Bangkok Don Mueang'], HKT: [8.1132, 98.3169, 'Phuket'],
  CNX: [18.7668, 98.9626, 'Chiang Mai'], SGN: [10.8189, 106.6520, 'Ho Chi Minh'],
  HAN: [21.2212, 105.8072, 'Hanoi'], DAD: [16.0439, 108.1994, 'Da Nang'],
  CGK: [-6.1256, 106.6559, 'Jakarta'], DPS: [-8.7482, 115.1672, 'Bali'],
  MNL: [14.5086, 121.0198, 'Manila'], HKG: [22.3080, 113.9185, 'Hong Kong'],
  TPE: [25.0777, 121.2328, 'Taipei Taoyuan'], TSA: [25.0694, 121.5525, 'Taipei Songshan'],
  ICN: [37.4602, 126.4407, 'Seoul Incheon'], GMP: [37.5583, 126.7906, 'Seoul Gimpo'],
  PUS: [35.1795, 128.9382, 'Busan'], PVG: [31.1443, 121.8083, 'Shanghai Pudong'],
  PEK: [40.0799, 116.6031, 'Beijing'], CAN: [23.3924, 113.2988, 'Guangzhou'],
  // Middle East / Europe / Oceania common
  DXB: [25.2532, 55.3657, 'Dubai'], DOH: [25.2731, 51.6081, 'Doha'], JED: [21.6796, 39.1565, 'Jeddah'],
  MED: [24.5534, 39.7051, 'Madinah'], IST: [41.2753, 28.7519, 'Istanbul'],
  LHR: [51.4700, -0.4543, 'London Heathrow'], CDG: [49.0097, 2.5479, 'Paris CDG'],
  AMS: [52.3105, 4.7683, 'Amsterdam'], SYD: [-33.9399, 151.1753, 'Sydney'],
  MEL: [-37.6690, 144.8410, 'Melbourne'], PER: [-31.9385, 115.9672, 'Perth'], AKL: [-37.0082, 174.7850, 'Auckland'],
};

// City/airport keywords → IATA, for matching parsed leg text like
// "Kuala Lumpur International Airport T1" or "Osaka - Kansai".
const KEYWORDS: Array<[RegExp, string]> = [
  [/kansai/i, 'KIX'], [/itami/i, 'ITM'], [/narita/i, 'NRT'], [/haneda/i, 'HND'],
  [/chitose|sapporo/i, 'CTS'], [/asahikawa/i, 'AKJ'], [/don ?mueang/i, 'DMK'],
  [/suvarnabhumi/i, 'BKK'], [/taoyuan/i, 'TPE'], [/incheon/i, 'ICN'],
  [/kuala lumpur/i, 'KUL'], [/miri/i, 'MYY'], [/kuching/i, 'KCH'], [/kota kinabalu/i, 'BKI'],
  [/fukuoka/i, 'FUK'], [/hiroshima/i, 'HIJ'], [/okayama/i, 'OKJ'], [/oita|beppu/i, 'OIT'],
  [/singapore|changi/i, 'SIN'], [/tokyo/i, 'HND'], [/osaka/i, 'KIX'], [/bangkok/i, 'DMK'],
  [/taipei/i, 'TPE'], [/seoul/i, 'ICN'], [/hong ?kong/i, 'HKG'], [/penang/i, 'PEN'],
];

/** Resolve a leg endpoint (airport name, "City - Airport", or bare city) to coordinates. */
export function airportCoords(text: string | undefined): { lat: number; lng: number; code: string } | null {
  if (!text) return null;
  const iata = text.match(/\b([A-Z]{3})\b/)?.[1];
  if (iata && AIRPORTS[iata]) {
    const [lat, lng] = AIRPORTS[iata];
    return { lat, lng, code: iata };
  }
  for (const [re, code] of KEYWORDS) {
    if (re.test(text)) {
      const [lat, lng] = AIRPORTS[code];
      return { lat, lng, code };
    }
  }
  return null;
}
