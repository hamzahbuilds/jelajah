import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDocument } from '../shared/parsers';

const fx = (name: string) => readFileSync(`tests/fixtures/${name}.txt`, 'utf8');

describe('Trip.com receipt parser', () => {
  it('parses the KUL–Tokyo / Osaka–KUL receipt (Visa)', () => {
    const d = parseDocument(fx('db86bdd3-Ereceipt_from_Hamzah_Travels'));
    expect(d.parser).toBe('tripcom-receipt');
    expect(d.vendor).toBe('Trip.com');
    expect(d.bookingNo).toBe('1433810621882408');
    expect(d.totalAmount).toBe(5508);
    expect(d.currency).toBe('MYR');
    expect(d.paymentMethod).toMatch(/Visa/);
    expect(d.paymentDate).toBe('2026-03-10');
    expect(d.people).toHaveLength(3);
    expect(d.people).toContain('HAIRUNI BINTI HASSIM');
    expect(d.legs).toHaveLength(2);
    expect(d.legs[0]).toMatchObject({ from: 'Kuala Lumpur', to: 'Tokyo', date: '2026-11-29', flightNo: 'OD872' });
    expect(d.legs[1]).toMatchObject({ from: 'Osaka', to: 'Kuala Lumpur', date: '2026-12-07', flightNo: 'D7533' });
    expect(d.category).toBe('flight');
    expect(d.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('parses the 9-pax Tokyo–Osaka receipt (ATOME) and flags instalments', () => {
    const d = parseDocument(fx('b424642e-Ereceipt_from_Hamzah_Travels_1'));
    expect(d.parser).toBe('tripcom-receipt');
    expect(d.bookingNo).toBe('1433814271718440');
    expect(d.totalAmount).toBe(2844);
    expect(d.paymentMethod).toBe('ATOME');
    expect(d.paymentDate).toBe('2026-08-09');
    expect(d.people).toHaveLength(9);
    expect(d.legs[0]).toMatchObject({ from: 'Tokyo', to: 'Osaka', date: '2026-12-03', flightNo: 'JL119' });
    expect(d.warnings.join(' ')).toMatch(/ATOME/);
  });

  it('parses the 6-pax Tokyo–Osaka receipt (ATOME)', () => {
    const d = parseDocument(fx('8d7ece71-Ereceipt_from_Hamzah_Travels_2'));
    expect(d.bookingNo).toBe('1433814271969384');
    expect(d.totalAmount).toBe(1956);
    expect(d.people).toHaveLength(6);
    expect(d.people).toContain('HAMZAH BINHAMIZAN');
  });
});

describe('Trip.com itinerary parser', () => {
  it('parses the 3-pax KUL itinerary with two legs and airports', () => {
    const d = parseDocument(fx('12fa568b-Itinerary_from_Hamzah_Travels'));
    expect(d.parser).toBe('tripcom-itinerary');
    expect(d.bookingNo).toBe('1433810621882408');
    expect(d.people).toHaveLength(3);
    expect(d.people).toContain('MOHD ISMAIL ISMAIL BIN HASSIM');
    expect(d.legs).toHaveLength(2);
    expect(d.legs[0]).toMatchObject({ date: '2026-11-29', depTime: '00:10', arrTime: '08:25', flightNo: 'OD872' });
    expect(d.legs[0].depPlace).toMatch(/Kuala Lumpur International/);
    expect(d.legs[1]).toMatchObject({ date: '2026-12-07', depTime: '10:55', flightNo: 'D7533' });
    expect(d.suggestExpense).toBe(false);
  });

  it('parses the 9-pax itinerary (names glued to bin/binti)', () => {
    const d = parseDocument(fx('0ddd2512-Itinerary_from_Hamzah_Travels_1'));
    expect(d.bookingNo).toBe('1433814271718440');
    expect(d.people).toHaveLength(9);
    expect(d.people).toContain('JALITA BINTI JUNAIDI');
    expect(d.legs[0]).toMatchObject({ date: '2026-12-03', depTime: '13:30', arrTime: '14:40', flightNo: 'JL119' });
  });

  it('parses the 7-pax itinerary including the infant', () => {
    const d = parseDocument(fx('33eb1ab4-Itinerary_from_Hamzah_Travels_2'));
    expect(d.bookingNo).toBe('1433814271969384');
    expect(d.people).toHaveLength(7);
    expect(d.people).toContain('HARETHAZRANBIN HAMZAH');
  });
});

describe('Airbnb parser', () => {
  it('parses the Tokyo confirmation', () => {
    const d = parseDocument(fx('1f4b526e-AirBnB_Tokyo'));
    expect(d.parser).toBe('airbnb-confirmation');
    expect(d.vendor).toBe('Airbnb');
    expect(d.category).toBe('accommodation');
    expect(d.bookingNo).toBe('HM3AA22BW2');
    expect(d.totalAmount).toBeCloseTo(7277.06);
    expect(d.currency).toBe('MYR');
    expect(d.checkInDate).toBe('2026-11-29');
    expect(d.checkOutDate).toBe('2026-12-03');
    expect(d.checkInTime).toMatch(/4:00\s*PM/i);
    expect(d.guests).toMatchObject({ adults: 16, infants: 1 });
    expect(d.location).toMatch(/Katsushika/);
  });

  it('parses the Osaka confirmation', () => {
    const d = parseDocument(fx('00b9ce0c-Airbnb_Osaka'));
    expect(d.bookingNo).toBe('HMSSMEAJ33');
    expect(d.totalAmount).toBeCloseTo(6833.43);
    expect(d.checkInDate).toBe('2026-12-03');
    expect(d.checkOutDate).toBe('2026-12-07');
    expect(d.location).toMatch(/Sakuragawa|Osaka/);
  });
});

describe('generic fallback', () => {
  it('never throws and guesses sensibly on unknown text', () => {
    const d = parseDocument('RECEIPT\nIchiran Ramen Dotonbori\n2026-12-04\nTotal JPY 8,400\n');
    expect(d.parser).toBe('generic');
    expect(d.category).toBe('food');
    expect(d.currency).toBe('JPY');
    expect(d.totalAmount).toBe(8400);
    expect(d.warnings.length).toBeGreaterThan(0);
  });
});

describe('AirAsia invoice parser', () => {
  it('parses the 4-pax MOVE invoice (SH3P9K)', () => {
    const d = parseDocument(fx('45e16bd7-AirAsia_Invoice'));
    expect(d.parser).toBe('airasia-invoice');
    expect(d.vendor).toBe('AirAsia');
    expect(d.category).toBe('flight');
    expect(d.bookingNo).toBe('SH3P9K');
    expect(d.totalAmount).toBeCloseTo(934.70);
    expect(d.currency).toBe('MYR');
    expect(d.paymentDate).toBe('2026-03-09');
    expect(d.paymentMethod).toBe('Visa');
    expect(d.people).toHaveLength(4);
    expect(d.people).toContain('Hamzah Bin Hamizan');
    expect(d.people).toContain('Jadirah Azra Binti Kamarolzeman');
    expect(d.warnings.join(' ')).toMatch(/no flight route/i);
  });

  it('parses the 2-pax invoice (AJ6ZYE)', () => {
    const d = parseDocument(fx('50c0ce7c-KUL_NRT_Invoice'));
    expect(d.bookingNo).toBe('AJ6ZYE');
    expect(d.totalAmount).toBeCloseTo(506.80);
    expect(d.people).toEqual(['Mohammad Indera Bin Zamri', 'Haziqah Binti Hassan']);
  });
});
