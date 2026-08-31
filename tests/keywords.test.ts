import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { extractKeywords, extractDates, extractAmounts } from '../shared/keywords';
import { parseDocument } from '../shared/parsers';
import { parseGeneric } from '../shared/parsers/generic';

const fx = (name: string) => readFileSync(`tests/fixtures/${name}.txt`, 'utf8');

describe('keyword extraction — real documents', () => {
  it('finds the total, booking ref and flight legs on the Trip.com receipt', () => {
    const kw = extractKeywords(fx('db86bdd3-Ereceipt_from_Hamzah_Travels'));
    expect(kw.amounts[0].currency).toBe('MYR');
    expect(kw.amounts.some(a => a.value === 5508)).toBe(true);
    expect(kw.flights.some(f => f.flightNo === 'OD872')).toBe(true);
    expect(kw.flights.some(f => f.flightNo === 'D7533')).toBe(true);
    expect(kw.vendors.some(v => v.raw === 'Trip.com')).toBe(true);
  });

  it('finds AirAsia booking ref, guests and payment method on the invoice', () => {
    const kw = extractKeywords(fx('45e16bd7-AirAsia_Invoice'));
    expect(kw.refs.some(r => r.value === 'SH3P9K')).toBe(true);
    expect(kw.vendors.some(v => v.raw === 'AirAsia')).toBe(true);
    expect(kw.names.length).toBeGreaterThan(0);
  });

  it('tags check-in/check-out roles on the hotel voucher', () => {
    const kw = extractKeywords(fx('a5969b58-Checkin_Voucher'));
    expect(kw.dates.some(d => d.iso === '2026-12-20' && d.role === 'checkin')).toBe(true);
    expect(kw.dates.some(d => d.iso === '2026-12-22')).toBe(true);
    expect(kw.names.some(n => /RANIZAH BINTI RAHBI/i.test(n.raw))).toBe(true);
  });
});

describe('keyword extraction — synthetic multilingual receipts', () => {
  it('reads a Bahasa Malaysia receipt', () => {
    const kw = extractKeywords([
      'Resit Rasmi — Kedai Runcit Pak Ali',
      'Tarikh bayaran: 5 Disember 2026',
      'Nombor rujukan: INV-2026-0455',
      'Jumlah besar RM 123.45',
      'Bayar sebelum 20 Dis 2026',
      'Kad kredit Maybank',
    ].join('\n'));
    expect(kw.dates.some(d => d.iso === '2026-12-05' && d.role === 'payment')).toBe(true);
    expect(kw.dates.some(d => d.iso === '2026-12-20' && d.role === 'due')).toBe(true);
    expect(kw.amounts[0]).toMatchObject({ currency: 'MYR', value: 123.45 });
    expect(kw.refs.some(r => r.value === 'INV-2026-0455')).toBe(true);
    expect(kw.payments.some(p => /kad kredit/i.test(p.raw))).toBe(true);
  });

  it('reads a Japanese konbini-style receipt', () => {
    const kw = extractKeywords([
      'セブンイレブン 札幌駅前店',
      '2026年12月21日 09:15',
      '小計 1,180円',
      '合計 1,298円',
      'クレジットカード',
    ].join('\n'));
    expect(kw.dates.some(d => d.iso === '2026-12-21')).toBe(true);
    // 合計 (total) must outscore 小計 (subtotal) despite both matching
    expect(kw.amounts[0]).toMatchObject({ currency: 'JPY', value: 1298 });
    expect(kw.payments.length).toBeGreaterThan(0);
  });

  it('reads a Chinese receipt with 元 amounts and 入住 dates', () => {
    const kw = extractKeywords([
      '预订确认 — 携程 trip.com',
      '订单号: 88123456789',
      '入住: 2026年12月20日  退房: 2026年12月22日',
      '总额 RMB 1,024.50',
    ].join('\n'));
    expect(kw.dates.some(d => d.iso === '2026-12-20' && d.role === 'checkin')).toBe(true);
    expect(kw.dates.some(d => d.iso === '2026-12-22' && d.role === 'checkout')).toBe(true);
    expect(kw.amounts[0]).toMatchObject({ currency: 'CNY', value: 1024.5 });
    expect(kw.refs.some(r => r.value === '88123456789')).toBe(true);
  });

  it('reads an OCR-style receipt where "RECEIPT" appears alone on a line above the ref', () => {
    const kw = extractKeywords('SUNWAY TRAVEL SDN BHD\nOFFICIAL RECEIPT\n\nReceipt no: TR88421\n\nDate paid: 15/08/2026\n\nGuest: HAIRUNI BINTI HASSIM\nBus tour Kyoto day trip\n\nGrand Total RM 148.50\n\nPaid by Visa\n');
    expect(kw.refs.some(r => r.value === 'TR88421')).toBe(true);
    expect(kw.amounts[0]).toMatchObject({ currency: 'MYR', value: 148.5 });
    expect(kw.dates.some(d => d.iso === '2026-08-15' && d.role === 'payment')).toBe(true);
    expect(kw.names.some(n => n.raw === 'HAIRUNI BINTI HASSIM')).toBe(true);
    expect(kw.names.some(n => /SDN BHD/.test(n.raw))).toBe(false); // companies are not people
  });

  it('handles dd/mm/yyyy and swaps an impossible month', () => {
    const dates = extractDates('Paid on 20/12/2026, printed 12/05/2026');
    expect(dates.some(d => d.iso === '2026-12-20')).toBe(true);
    expect(dates.some(d => d.iso === '2026-05-12')).toBe(true); // day-first default
  });

  it('scores a labelled total above a bigger unlabelled number', () => {
    const a = extractAmounts('Reference 99999 MYR 900.00 room rate\nGrand total RM 350.00');
    expect(a[0].value).toBe(350);
  });
});

describe('generic parser (v0.11 keyword-driven)', () => {
  it('builds a rich best-effort parse from an unknown flight receipt', () => {
    const d = parseGeneric([
      'FlyHigh Airways — Payment receipt',
      'Booking reference: ZK8P2Q',
      'Passenger: Sarah Binti Osman',
      'Flight FY1234  PEN - KUL  20 December 2026, departure 08:30',
      'Total amount paid MYR 289.90 by Visa ending 4242',
    ].join('\n'));
    expect(d.parser).toBe('generic');
    expect(d.category).toBe('flight');
    expect(d.totalAmount).toBe(289.9);
    expect(d.currency).toBe('MYR');
    expect(d.bookingNo).toBe('ZK8P2Q');
    expect(d.fields['Flights']).toContain('FY1234');
    expect(d.fields['Route']).toContain('PEN→KUL');
    expect(d.people).toContain('Sarah Binti Osman');
    expect(d.keywords?.amounts.length).toBeGreaterThan(0);
  });

  it('keeps dedicated parsers in charge of known documents', () => {
    const d = parseDocument(fx('db86bdd3-Ereceipt_from_Hamzah_Travels'));
    expect(d.parser).toBe('tripcom-receipt'); // generic did not hijack it
  });

  it('detects an unknown hotel bill as accommodation with check-in dates', () => {
    const d = parseGeneric([
      'Sakura Guesthouse Kyoto',
      'Check-in: Dec 3, 2026 15:00',
      'Check-out: Dec 5, 2026 10:00',
      'Total JPY 24,000',
    ].join('\n'));
    expect(d.category).toBe('accommodation');
    expect(d.checkInDate).toBe('2026-12-03');
    expect(d.checkOutDate).toBe('2026-12-05');
    expect(d.totalAmount).toBe(24000);
    expect(d.currency).toBe('JPY');
  });
});
