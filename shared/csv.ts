// Minimal RFC-4180-ish CSV: handles quoted fields, embedded commas/quotes/newlines,
// and both \n and \r\n line endings. Used by the plan template export/import.

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const esc = (v: string | number | null | undefined): string => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map(r => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '', row: string[] = [], inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      pushField();
    } else if (ch === '\n') {
      pushRow();
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) pushRow();
  // drop fully-empty trailing rows
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

/** Column order for the plan template. `id` blank = create new. */
export const PLAN_COLUMNS = [
  'id', 'day', 'start_time', 'end_time', 'title', 'category', 'notes',
  'location_name', 'lat', 'lng', 'est_cost_myr', 'participants', 'done',
] as const;

export const PLAN_EXAMPLE_ROW = [
  '', '2026-11-30', '10:30', '12:00', 'teamLab Planets', 'sightseeing', 'buy tickets online',
  'teamLab Planets TOKYO', '35.6491', '139.7898', '160', 'ALL', '',
];
