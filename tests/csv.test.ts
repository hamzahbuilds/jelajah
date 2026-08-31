import { describe, it, expect } from 'vitest';
import { parseCsv, toCsv } from '../shared/csv';

describe('csv module', () => {
  it('round-trips plain rows', () => {
    const rows = [['a', 'b', 'c'], ['1', '2', '3']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('handles commas, quotes and newlines in fields', () => {
    const rows = [['title', 'notes'], ['Sushi, then tea', 'he said "sedap"\nline two']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('parses Excel-style CRLF and skips empty trailing lines', () => {
    expect(parseCsv('a,b\r\n1,2\r\n\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps empty middle fields', () => {
    expect(parseCsv('a,,c\n')).toEqual([['a', '', 'c']]);
  });
});
