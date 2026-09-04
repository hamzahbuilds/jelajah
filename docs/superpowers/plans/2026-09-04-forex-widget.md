# Forex Widget (v0.15) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-trip currency widget: reference currency + watched currencies, daily-rate sparkline, average-high/low band over 1W/1M/3M/6M/1Y, and a buy/ok/wait signal computed on the cost of the foreign currency.

**Architecture:** Pure band/signal math in `shared/fxband.ts` (unit-tested). The Worker gains three endpoints that reuse the existing `fx_rates` D1 cache: one Frankfurter range call per base currency per day fills a year of history for every watched currency, everything else serves from D1. React widget on the trip dashboard renders inline-SVG sparklines — no chart library.

**Tech Stack:** Hono Worker + D1 (existing), Frankfurter v1 range API (existing FX source, keyless), React 19, vitest, Playwright e2e.

**Spec:** `docs/05-spec-v0.15-forex.md`

## Global Constraints

- RM0 / keyless: Frankfurter only (`api.frankfurter.dev`), no new dependencies, no new Cloudflare bindings.
- Every schema change goes in BOTH `SCHEMA` and `UPGRADES` in `server/lib/schema.ts` (UPGRADES statements run on every cold isolate with errors swallowed — they must be idempotent DDL; **no data UPDATEs in UPGRADES**).
- **No git commits** — the user commits via GitHub Desktop. Every task ends at "tests pass", never at `git commit`.
- All user-facing strings in BOTH `en` and `ms` objects in `src/i18n.tsx` (TypeScript enforces key parity — `ms` is typed from `en`).
- Date arithmetic on calendar days uses `shared/days.ts` helpers, never `toISOString().slice(0,10)` on a local Date (v0.14 timezone regression).
- Test commands: `npx vitest run` (unit), `node scripts/e2e.mjs` (needs the reset ritual: kill workerd → `rm -rf .wrangler/state` → `npm run db:local` → `npm run build` → `npx wrangler dev --port 8788`).
- `main` branch, version target `0.15.0` (bump in the final task only).

**Spec deviations locked in this plan (both safer than the spec's letter):**
1. No seed of `watch_currencies` for live trips via UPGRADES (data UPDATEs there re-run forever and can resurrect cleared settings). Instead the trip admin sees a one-click "set up currencies" card (Task 4) and sets it once per trip.
2. The expense-form pre-fill already exists (`ExpenseForm.tsx:96` fetches `/fx` per payment date); the widget's daily series fetch warms the same `fx_rates` table, making that lookup cache-hit. No ExpenseForm change.

---

### Task 1: Band + signal math (`shared/fxband.ts`)

**Files:**
- Create: `shared/fxband.ts`
- Test: `tests/fxband.test.ts`

**Interfaces:**
- Produces (used by Tasks 3 and 4):
  - `type FxWindow = '1w' | '1m' | '3m' | '6m' | '1y'`
  - `const FX_WINDOWS: Record<FxWindow, number>` — `{ '1w': 7, '1m': 30, '3m': 90, '6m': 180, '1y': 365 }`
  - `type FxSignal = 'buy' | 'ok' | 'wait'`
  - `costBand(costs: number[]): { mean: number; avgLow: number; avgHigh: number } | null`
  - `analyzeRates(rates: number[]): { band: { low: number; high: number } | null; signal: FxSignal | null }` — input is the chronological DISPLAY-rate series (`1 ref = X quote`); the last element is "current".

- [ ] **Step 1: Write the failing tests**

```ts
// tests/fxband.test.ts
import { describe, it, expect } from 'vitest';
import { costBand, analyzeRates, FX_WINDOWS } from '../shared/fxband';

describe('fxband', () => {
  it('splits a window into average low and average high around the mean', () => {
    // mean 14; below-mean {10,12} → avgLow 11; above-mean {16,18} → avgHigh 17
    expect(costBand([10, 12, 14, 16, 18])).toEqual({ mean: 14, avgLow: 11, avgHigh: 17 });
  });

  it('needs at least 5 points', () => {
    expect(costBand([10, 12, 14, 16])).toBeNull();
    expect(analyzeRates([40, 41, 42, 43])).toEqual({ band: null, signal: null });
  });

  it('a flat series is "ok", never a fake signal', () => {
    const r = analyzeRates([40, 40, 40, 40, 40]);
    expect(r.signal).toBe('ok');
    expect(r.band).toEqual({ low: 40, high: 40 });
  });

  // THE INVERSION PIN — display rate is "1 MYR = X JPY"; the signal is about
  // the COST of JPY. A HIGH display rate means JPY is CHEAP (buy); a LOW
  // display rate means JPY is EXPENSIVE (wait). If someone "simplifies" the
  // 1/rate step away, these two tests fail.
  it('series ending at its cheapest foreign-currency point says buy', () => {
    // display rates; last = 55 = the most yen per ringgit seen → buy
    expect(analyzeRates([50, 48, 52, 45, 55]).signal).toBe('buy');
  });

  it('series ending at its most expensive foreign-currency point says wait', () => {
    // last = 45 = the least yen per ringgit seen → wait
    expect(analyzeRates([50, 48, 52, 55, 45]).signal).toBe('wait');
  });

  it('band is returned in display terms with low < high', () => {
    // costs: 1/50=.02, 1/48=.0208333, 1/52=.0192308, 1/55=.0181818, 1/45=.0222222
    // cost mean .0200936; below-mean {.02,.0192308,.0181818} → avgLow .0191375
    // above-mean {.0208333,.0222222} → avgHigh .0215278
    // display band: low = 1/avgHigh = 46.45, high = 1/avgLow = 52.25
    const { band } = analyzeRates([50, 48, 52, 55, 45]);
    expect(band!.low).toBeCloseTo(46.45, 1);
    expect(band!.high).toBeCloseTo(52.25, 1);
  });

  it('a mid-band current rate is ok', () => {
    expect(analyzeRates([50, 48, 52, 55, 45, 49]).signal).toBe('ok');
  });

  it('window map is the approved five windows', () => {
    expect(FX_WINDOWS).toEqual({ '1w': 7, '1m': 30, '3m': 90, '6m': 180, '1y': 365 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/fxband.test.ts`
Expected: FAIL — cannot resolve `../shared/fxband`.

- [ ] **Step 3: Implement**

```ts
// shared/fxband.ts
// Band + signal math for the trip forex widget (spec: docs/05-spec-v0.15-forex.md).
//
// DIRECTION: the app displays "1 {ref} = X {quote}" (e.g. 1 MYR = 38.5 JPY),
// but "cheap/expensive" must describe the FOREIGN currency, so the signal is
// computed on cost = 1/rate (what one JPY costs in MYR). A HIGH display rate
// therefore means the foreign currency is CHEAP → good time to buy.
// tests/fxband.test.ts pins this against hand-computed fixtures.

export type FxWindow = '1w' | '1m' | '3m' | '6m' | '1y';
export const FX_WINDOWS: Record<FxWindow, number> = { '1w': 7, '1m': 30, '3m': 90, '6m': 180, '1y': 365 };

export type FxSignal = 'buy' | 'ok' | 'wait';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** avgLow = mean of below-mean days, avgHigh = mean of above-mean days. */
export function costBand(costs: number[]): { mean: number; avgLow: number; avgHigh: number } | null {
  if (costs.length < 5) return null;
  const m = mean(costs);
  const lows = costs.filter(c => c < m);
  const highs = costs.filter(c => c > m);
  // a flat series has no below/above set — collapse the band onto the mean
  return { mean: m, avgLow: lows.length ? mean(lows) : m, avgHigh: highs.length ? mean(highs) : m };
}

/** Input: chronological DISPLAY-rate series; last element is current. */
export function analyzeRates(rates: number[]): { band: { low: number; high: number } | null; signal: FxSignal | null } {
  const costs = rates.map(r => 1 / r);
  const cb = costBand(costs);
  if (!cb) return { band: null, signal: null };
  const c = costs[costs.length - 1];
  const signal: FxSignal = c < cb.avgLow ? 'buy' : c > cb.avgHigh ? 'wait' : 'ok';
  // display band: dividing 1 by the cost band SWAPS low and high
  return { band: { low: 1 / cb.avgHigh, high: 1 / cb.avgLow }, signal };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/fxband.test.ts` → all pass. Then `npx vitest run` → whole suite (79 + new) green.

---

### Task 2: Schema — `trips.watch_currencies`

**Files:**
- Modify: `server/lib/schema.ts` (the `trips` CREATE TABLE inside `SCHEMA`, and the `UPGRADES` array)

**Interfaces:**
- Produces: column `trips.watch_currencies TEXT NOT NULL DEFAULT '[]'` (JSON array of ISO codes) — read by Tasks 3–5.

- [ ] **Step 1: Add the column to the `trips` CREATE TABLE in `SCHEMA`**

In the `trips` table definition, after `member_can_edit_plan INTEGER NOT NULL DEFAULT 0,` add:

```sql
    watch_currencies TEXT NOT NULL DEFAULT '[]',  -- ISO codes shown in the forex widget
```

- [ ] **Step 2: Add the matching upgrade**

In `UPGRADES`, after the `` `ALTER TABLE day_settings ADD COLUMN title TEXT` `` line add:

```ts
  `ALTER TABLE trips ADD COLUMN watch_currencies TEXT NOT NULL DEFAULT '[]'`,
```

(No data UPDATE here — see Global Constraints deviation 1.)

- [ ] **Step 3: Verify**

Run: `npx tsc -b` → clean. Run: `npx vitest run` → green (schema is exercised end-to-end in Task 6).

---

### Task 3: Worker endpoints (`server/app.ts`)

**Files:**
- Modify: `server/app.ts` — new helpers + routes next to the existing `/fx` endpoint (line ~1287)

**Interfaces:**
- Consumes: `FX_WINDOWS, FxWindow, analyzeRates` from `../shared/fxband`; existing `getSettingJSON/setSettingJSON`, `assertTripAccess`, `requireAdmin`, `bad`, `fx_rates` table.
- Produces:
  - `GET /api/currencies` → `Array<{ code: string; name: string }>`
  - `GET /api/trips/:id/fxseries?quote=JPY&window=1m` → `{ base, quote, window, points: Array<{date,rate}>, band: {low,high}|null, signal: 'buy'|'ok'|'wait'|null, current: {date,rate} }`
  - `PATCH /api/trips/:id/currencies` (admin) body `{ base_currency?, watch_currencies? }` → `{ ok, base_currency, watch_currencies }`
  - `POST /api/trips` additionally accepts `base_currency` and `watch_currencies`.

- [ ] **Step 1: Import the shared math**

Extend the existing import block at the top of `server/app.ts`:

```ts
import { FX_WINDOWS, FxWindow, analyzeRates } from '../shared/fxband';
```

- [ ] **Step 2: Add the currency-list helper + route** (place directly after the existing `/fx` route)

```ts
/* ================================================================== */
/* v0.15 — trip forex widget (spec: docs/05-spec-v0.15-forex.md)      */
/* ================================================================== */

/** Frankfurter currency catalogue, cached in app_settings for 7 days. */
async function currencyList(env: Env): Promise<Array<{ code: string; name: string }>> {
  const cached = await getSettingJSON<{ at: string; list: Array<{ code: string; name: string }> }>(env, 'currency_list');
  if (cached && Date.now() - new Date(cached.at).getTime() < 7 * 86400000) return cached.list;
  try {
    const res = await fetch('https://api.frankfurter.dev/v2/currencies');
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json<any[]>();
    const list = data.map(x => ({ code: String(x.iso_code), name: String(x.name) }));
    if (!list.length) throw new Error('empty');
    await setSettingJSON(env, 'currency_list', { at: new Date().toISOString(), list });
    return list;
  } catch {
    // offline / upstream change: serve the stale cache, else a minimal set so
    // the pickers still work
    return cached?.list ?? [
      { code: 'MYR', name: 'Malaysian Ringgit' }, { code: 'JPY', name: 'Japanese Yen' },
      { code: 'USD', name: 'US Dollar' }, { code: 'EUR', name: 'Euro' },
    ];
  }
}

app.get('/currencies', async c => c.json(await currencyList(c.env)));
```

- [ ] **Step 3: Add the series freshness helper**

```ts
/** One Frankfurter range call per base per day fills a year of daily rates
 *  for every watched currency into fx_rates; all reads then hit D1 only. */
async function ensureFxSeries(env: Env, base: string, quotes: string[]): Promise<void> {
  if (!quotes.length) return;
  const today = new Date().toISOString().slice(0, 10); // server-side UTC day is fine here
  const key = `fx_series_fetched:${base}`;
  const state = await getSettingJSON<{ date: string; quotes: string[] }>(env, key);
  if (state?.date === today && quotes.every(q => state.quotes.includes(q))) return;
  const all = [...new Set([...(state?.quotes ?? []), ...quotes])];
  const start = new Date(); start.setUTCDate(start.getUTCDate() - 370);
  const res = await fetch(
    `https://api.frankfurter.dev/v1/${start.toISOString().slice(0, 10)}..${today}?base=${base}&symbols=${all.join(',')}`);
  if (!res.ok) throw new Error('fx_unavailable');
  const data = await res.json<any>();
  const stmts: D1PreparedStatement[] = [];
  for (const [date, rates] of Object.entries<any>(data?.rates ?? {})) {
    for (const [q, r] of Object.entries<any>(rates)) {
      if (typeof r === 'number') {
        stmts.push(env.DB.prepare(
          'INSERT OR REPLACE INTO fx_rates (rate_date, base, quote, rate) VALUES (?,?,?,?)').bind(date, base, q, r));
      }
    }
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50)); // D1 batch politeness
  if (stmts.length) await setSettingJSON(env, key, { date: today, quotes: all });
}
```

- [ ] **Step 4: Add the series route**

```ts
app.get('/trips/:id/fxseries', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  const trip = await c.env.DB.prepare('SELECT base_currency, watch_currencies FROM trips WHERE id = ?').bind(id).first<any>();
  if (!trip) return bad(c, 'not_found', 404);
  let watch: string[] = [];
  try { watch = JSON.parse(trip.watch_currencies ?? '[]'); } catch { /* treat as empty */ }
  const quote = String(c.req.query('quote') ?? '').toUpperCase();
  const window = String(c.req.query('window') ?? '1m') as FxWindow;
  if (!watch.includes(quote)) return bad(c, 'not_watched');
  if (!(window in FX_WINDOWS)) return bad(c, 'bad_window');
  try { await ensureFxSeries(c.env, trip.base_currency, watch); } catch { /* stale cache below still serves */ }
  const start = new Date(); start.setUTCDate(start.getUTCDate() - FX_WINDOWS[window]);
  const rows = await c.env.DB.prepare(
    'SELECT rate_date, rate FROM fx_rates WHERE base = ? AND quote = ? AND rate_date >= ? ORDER BY rate_date',
  ).bind(trip.base_currency, quote, start.toISOString().slice(0, 10)).all();
  const points = (rows.results as any[]).map(r => ({ date: r.rate_date, rate: r.rate }));
  if (!points.length) return bad(c, 'fx_unavailable', 502);
  const { band, signal } = analyzeRates(points.map(p => p.rate));
  return c.json({ base: trip.base_currency, quote, window, points, band, signal, current: points[points.length - 1] });
});
```

- [ ] **Step 5: Add the currency-settings route**

```ts
app.patch('/trips/:id/currencies', requireAdmin, async c => {
  const id = Number(c.req.param('id'));
  const trip = await c.env.DB.prepare('SELECT base_currency, watch_currencies FROM trips WHERE id = ?').bind(id).first<any>();
  if (!trip) return bad(c, 'not_found', 404);
  const b = await c.req.json<any>();
  const codes = new Set((await currencyList(c.env)).map(x => x.code));
  let base: string = trip.base_currency;
  if (b.base_currency !== undefined) {
    base = String(b.base_currency).toUpperCase();
    if (!codes.has(base)) return bad(c, 'bad_currency');
  }
  let watch: string[];
  try { watch = JSON.parse(trip.watch_currencies ?? '[]'); } catch { watch = []; }
  if (b.watch_currencies !== undefined) {
    if (!Array.isArray(b.watch_currencies)) return bad(c, 'bad_watch');
    watch = [...new Set(b.watch_currencies.map((x: any) => String(x).toUpperCase()))];
    if (watch.some(w => !codes.has(w))) return bad(c, 'bad_currency');
  }
  watch = watch.filter(w => w !== base);           // never watch the reference itself
  if (watch.length > 6) return bad(c, 'too_many_currencies');
  await c.env.DB.prepare('UPDATE trips SET base_currency = ?, watch_currencies = ? WHERE id = ?')
    .bind(base, JSON.stringify(watch), id).run();
  return c.json({ ok: true, base_currency: base, watch_currencies: watch });
});
```

- [ ] **Step 6: Extend `POST /trips`** (line ~"app.post('/trips'")

Replace the handler body so currencies are accepted and validated:

```ts
app.post('/trips', requireAdmin, async c => {
  const { name, destination, start_date, end_date, emoji, color, base_currency, watch_currencies } = await c.req.json<any>();
  if (!name?.trim()) return bad(c, 'name_required');
  const codes = new Set((await currencyList(c.env)).map(x => x.code));
  const base = base_currency && codes.has(String(base_currency).toUpperCase())
    ? String(base_currency).toUpperCase() : 'MYR';
  const watch = Array.isArray(watch_currencies)
    ? [...new Set(watch_currencies.map((x: any) => String(x).toUpperCase()))]
        .filter(w => codes.has(w) && w !== base).slice(0, 6)
    : [];
  const r = await c.env.DB.prepare(
    'INSERT INTO trips (name, destination, start_date, end_date, emoji, color, base_currency, watch_currencies) VALUES (?,?,?,?,?,?,?,?)',
  ).bind(name.trim(), destination ?? null, start_date ?? null, end_date ?? null,
    emoji ?? '🧳', color ?? '', base, JSON.stringify(watch)).run();
  return c.json({ id: r.meta.last_row_id });
});
```

- [ ] **Step 7: Verify**

Run: `npx tsc -b` → clean. `npx vitest run` → green. (Route behaviour is asserted in Task 6's e2e steps.)

---

### Task 4: The widget (`src/components/FxWidget.tsx` + dashboard + i18n + CSS)

**Files:**
- Create: `src/components/FxWidget.tsx`
- Modify: `src/pages/Dashboard.tsx` (render the widget after the journey card, ~line 190)
- Modify: `src/i18n.tsx` (new keys, EN + BM)
- Modify: `src/styles.css` (append a `/* v0.15 forex widget */` block)

**Interfaces:**
- Consumes: `GET /trips/:id/fxseries`, `PATCH /trips/:id/currencies`, `GET /currencies` (Task 3 shapes), `FxWindow` semantics from Task 1.
- Produces: `export default function FxWidget({ tripId, trip, isAdmin, onChanged }: { tripId: number; trip: any; isAdmin: boolean; onChanged: () => void })` and `export function CurrencyFields({ base, watch, onBase, onWatch }: { base: string; watch: string[]; onBase: (c: string) => void; onWatch: (w: string[]) => void })` (reused by Task 5's create form).

- [ ] **Step 1: i18n keys** — in `src/i18n.tsx` after the `dataMenu`/CSV-help block in the `en` object:

```ts
  fxTitle: 'Currency', fxSetup: 'Set up currencies',
  fxRefCurrency: 'Reference currency', fxWatchCurrencies: 'Currencies to watch',
  fxAddCurrency: 'Add currency (code or name)…', fxMax6: 'Up to 6 watch currencies',
  fxBuy: 'Good time to buy', fxOk: 'Within its usual range', fxWait: 'Pricier than usual — consider waiting',
  fxVsDays: (n: number) => `vs last ${n} days`,
  fxNoHistory: 'Not enough history yet', fxUnavailable: 'Rates unavailable right now',
  fxEditCurrencies: 'Edit currencies',
```

and the BM equivalents at the same position in the `ms` object:

```ts
  fxTitle: 'Mata wang', fxSetup: 'Sedia mata wang',
  fxRefCurrency: 'Mata wang rujukan', fxWatchCurrencies: 'Mata wang dipantau',
  fxAddCurrency: 'Tambah mata wang (kod atau nama)…', fxMax6: 'Maksimum 6 mata wang dipantau',
  fxBuy: 'Masa sesuai untuk beli', fxOk: 'Dalam julat biasa', fxWait: 'Lebih mahal dari biasa — boleh tunggu dulu',
  fxVsDays: (n: number) => `berbanding ${n} hari lepas`,
  fxNoHistory: 'Sejarah belum mencukupi', fxUnavailable: 'Kadar tidak tersedia buat masa ini',
  fxEditCurrencies: 'Sunting mata wang',
```

- [ ] **Step 2: The component**

```tsx
// src/components/FxWidget.tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';

import { FX_WINDOWS, FxWindow } from '../../shared/fxband';

const WINDOWS = Object.keys(FX_WINDOWS) as FxWindow[];
type Win = FxWindow;

interface Series {
  base: string; quote: string; points: Array<{ date: string; rate: number }>;
  band: { low: number; high: number } | null; signal: 'buy' | 'ok' | 'wait' | null;
  current: { date: string; rate: number };
}

const SIGNAL_ICON = { buy: '🟢', ok: '⚪', wait: '🟠' } as const;

function Sparkline({ s }: { s: Series }) {
  const W = 220, H = 48, P = 3;
  const rates = s.points.map(p => p.rate);
  const lo = Math.min(...rates, s.band?.low ?? Infinity);
  const hi = Math.max(...rates, s.band?.high ?? -Infinity);
  const span = hi - lo || 1;
  const x = (i: number) => P + (i / Math.max(s.points.length - 1, 1)) * (W - 2 * P);
  const y = (r: number) => H - P - ((r - lo) / span) * (H - 2 * P);
  return (
    <svg className="fx-spark" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden>
      {s.band && (
        <rect x={0} y={y(s.band.high)} width={W} height={Math.max(y(s.band.low) - y(s.band.high), 1)}
          className="fx-band" />
      )}
      <polyline className="fx-line" fill="none"
        points={s.points.map((p, i) => `${x(i)},${y(p.rate)}`).join(' ')} />
      <circle className="fx-dot" cx={x(s.points.length - 1)} cy={y(s.current.rate)} r={2.5} />
    </svg>
  );
}

/** Base + watch pickers, shared by the widget's editor and the trip create form. */
export function CurrencyFields({ base, watch, onBase, onWatch }: {
  base: string; watch: string[]; onBase: (c: string) => void; onWatch: (w: string[]) => void;
}) {
  const { t } = useT();
  const [all, setAll] = useState<Array<{ code: string; name: string }>>([]);
  const [add, setAdd] = useState('');
  useEffect(() => { api.get('/currencies').then(setAll).catch(() => setAll([])); }, []);
  const resolve = (v: string) => {
    const s = v.trim().toUpperCase();
    return all.find(c => c.code === s)?.code
      ?? all.find(c => c.name.toUpperCase() === v.trim().toUpperCase())?.code ?? null;
  };
  const tryAdd = (v: string) => {
    const code = resolve(v);
    if (code && code !== base && !watch.includes(code) && watch.length < 6) onWatch([...watch, code]);
    if (code) setAdd('');
  };
  return (
    <>
      <label className="field"><span>{t.fxRefCurrency}</span>
        <select value={base} onChange={e => { onBase(e.target.value); onWatch(watch.filter(w => w !== e.target.value)); }}>
          {all.map(c => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
          {!all.some(c => c.code === base) && <option value={base}>{base}</option>}
        </select></label>
      <div className="field full"><span>{t.fxWatchCurrencies} <span className="tiny">({t.fxMax6})</span></span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {watch.map(w => (
            <span key={w} className="chip on">{w}
              <button type="button" className="icon" onClick={() => onWatch(watch.filter(x => x !== w))}>✕</button>
            </span>
          ))}
          <input list="fx-codes" value={add} placeholder={t.fxAddCurrency} style={{ minWidth: 180 }}
            onChange={e => { setAdd(e.target.value); if (resolve(e.target.value)) tryAdd(e.target.value); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); tryAdd(add); } }} />
          <datalist id="fx-codes">
            {all.filter(c => c.code !== base && !watch.includes(c.code))
              .map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </datalist>
        </div>
      </div>
    </>
  );
}

export default function FxWidget({ tripId, trip, isAdmin, onChanged }: {
  tripId: number; trip: any; isAdmin: boolean; onChanged: () => void;
}) {
  const { t } = useT();
  let watch: string[] = [];
  try { watch = JSON.parse(trip?.watch_currencies ?? '[]'); } catch { /* empty */ }
  const [win, setWin] = useState<Win>(() => {
    try { const w = localStorage.getItem('fx_window'); return (WINDOWS as readonly string[]).includes(w ?? '') ? w as Win : '1m'; }
    catch { return '1m'; }
  });
  const [series, setSeries] = useState<Record<string, Series | 'error'>>({});
  const [editor, setEditor] = useState<{ base: string; watch: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSeries({});
    for (const q of watch) {
      api.get(`/trips/${tripId}/fxseries?quote=${q}&window=${win}`)
        .then(s => setSeries(prev => ({ ...prev, [q]: s })))
        .catch(() => setSeries(prev => ({ ...prev, [q]: 'error' })));
    }
  }, [tripId, win, trip?.watch_currencies]);

  const pickWin = (w: Win) => { setWin(w); try { localStorage.setItem('fx_window', w); } catch { /* ignore */ } };
  const save = async () => {
    if (!editor) return;
    setBusy(true);
    try {
      await api.patch(`/trips/${tripId}/currencies`, { base_currency: editor.base, watch_currencies: editor.watch });
      setEditor(null); onChanged();
    } finally { setBusy(false); }
  };

  if (!watch.length && !isAdmin) return null;

  return (
    <div className="card">
      <div className="row-between">
        <h3>💱 {t.fxTitle}</h3>
        <span className="row" style={{ gap: 6 }}>
          {watch.length > 0 && (
            <span className="row seg">
              {WINDOWS.map(w => (
                <button key={w} className={`btn btn-sm ${win === w ? '' : 'btn-ghost'}`}
                  onClick={() => pickWin(w)}>{w.toUpperCase()}</button>
              ))}
            </span>
          )}
          {isAdmin && (
            <button className="btn btn-ghost btn-sm" title={t.fxEditCurrencies}
              onClick={() => setEditor({ base: trip.base_currency ?? 'MYR', watch })}>
              {watch.length ? '⚙️' : `⚙️ ${t.fxSetup}`}
            </button>
          )}
        </span>
      </div>
      {watch.map(q => {
        const s = series[q];
        return (
          <div className="fx-row" key={q}>
            {s === undefined && <span className="muted tiny">…</span>}
            {s === 'error' && <span className="muted tiny">{q}: {t.fxUnavailable}</span>}
            {s && s !== 'error' && (
              <>
                <div className="fx-head">
                  <strong>1 {s.base} = {s.current.rate.toLocaleString(undefined, { maximumSignificantDigits: 5 })} {s.quote}</strong>
                  {s.signal && (
                    <span className={`badge fx-badge fx-${s.signal}`}>
                      {SIGNAL_ICON[s.signal]} {s.signal === 'buy' ? t.fxBuy : s.signal === 'ok' ? t.fxOk : t.fxWait}
                    </span>
                  )}
                  {!s.signal && <span className="badge">{t.fxNoHistory}</span>}
                </div>
                <Sparkline s={s} />
                <div className="tiny muted">{t.fxVsDays(FX_WINDOWS[win])}
                  {s.band && <> · {s.band.low.toLocaleString(undefined, { maximumSignificantDigits: 5 })}–{s.band.high.toLocaleString(undefined, { maximumSignificantDigits: 5 })}</>}
                </div>
              </>
            )}
          </div>
        );
      })}
      {editor && (
        <div className="overlay" onClick={() => setEditor(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>💱 {t.fxEditCurrencies}</h2>
            <div className="form-grid">
              <CurrencyFields base={editor.base} watch={editor.watch}
                onBase={b => setEditor({ ...editor, base: b })}
                onWatch={w => setEditor({ ...editor, watch: w })} />
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setEditor(null)}>{t.cancel}</button>
              <button className="btn" disabled={busy} onClick={save}>{t.save}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Mount on the dashboard**

In `src/pages/Dashboard.tsx`: `import FxWidget from '../components/FxWidget';`, and directly AFTER the journey card's closing `)}` (~line 190) insert:

```tsx
      <FxWidget tripId={tripId} trip={trip} isAdmin={user.role === 'admin'} onChanged={reload} />
```

(`trip`, `tripId`, `user` and the trip `reload` come from the existing outlet context / session — match the names already used in that file; the outlet context field that refreshes the trip is `reload`.)

- [ ] **Step 4: CSS** — append to `src/styles.css`:

```css
/* ---- v0.15 forex widget ---- */
.fx-row { padding: 10px 0; border-bottom: 1px solid var(--line); }
.fx-row:last-child { border-bottom: none; }
.fx-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
.fx-spark { display: block; max-width: 100%; }
.fx-band { fill: var(--data); opacity: .12; }
.fx-line { stroke: var(--data); stroke-width: 1.5; }
.fx-dot { fill: var(--brand-strong); }
.fx-badge.fx-buy { background: #dcfce7; }
.fx-badge.fx-wait { background: #ffedd5; }
```

- [ ] **Step 5: Verify**

Run: `npx tsc -b` → clean. `npm run build` → clean. `npx vitest run` → green.

---

### Task 5: Trip creation currencies + hermetic FX seed

**Files:**
- Modify: `src/pages/Trips.tsx` (create form)
- Create: `scripts/seed-fx.mjs`
- Modify: `package.json` (`db:local` script only)

**Interfaces:**
- Consumes: `CurrencyFields` from `../components/FxWidget` (Task 4), extended `POST /trips` (Task 3).
- Produces: local/e2e DB always has ~30 recent daily MYR→JPY and MYR→USD rows in `fx_rates`, so the widget renders without Frankfurter egress.

- [ ] **Step 1: Create form fields**

In `src/pages/Trips.tsx`: `import { CurrencyFields } from '../components/FxWidget';`, extend the form state with `base_currency: 'MYR', watch_currencies: [] as string[]`, and inside the `<div className="form-grid">` after the end-date field add:

```tsx
              <CurrencyFields base={form.base_currency} watch={form.watch_currencies}
                onBase={c => setForm({ ...form, base_currency: c, watch_currencies: form.watch_currencies.filter(w => w !== c) })}
                onWatch={w => setForm({ ...form, watch_currencies: w })} />
```

(`api.post('/trips', form)` already sends the whole form — no other change.)

- [ ] **Step 2: FX seed script**

```js
// scripts/seed-fx.mjs — deterministic fx_rates rows for local dev + e2e,
// generated relative to TODAY so band windows always contain them.
// Rates are synthetic but shaped so 1M analysis is meaningful.
import { execSync } from 'node:child_process';

const rows = [];
const today = new Date();
for (let i = 29; i >= 0; i--) {
  const d = new Date(today); d.setDate(d.getDate() - i);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const jpy = 38 + 2 * Math.sin(i / 4) + (i % 3) * 0.2;      // wobbles 36–40.4
  const usd = 0.244 + 0.002 * Math.sin(i / 5);
  rows.push(`('${date}','MYR','JPY',${jpy.toFixed(3)})`, `('${date}','MYR','USD',${usd.toFixed(5)})`);
}
const sql = `INSERT OR REPLACE INTO fx_rates (rate_date, base, quote, rate) VALUES ${rows.join(',')};`;
execSync(`npx wrangler d1 execute jelajah-db --local --command "${sql}"`, { stdio: 'inherit' });
console.log(`seed-fx: ${rows.length} fx_rates rows ending today`);
```

- [ ] **Step 3: Hook into `db:local`** — in `package.json` change the script to:

```json
"db:local": "wrangler d1 execute jelajah-db --local --file=./migrations/0001_init.sql && wrangler d1 execute jelajah-db --local --file=./scripts/seed.sql && node scripts/seed-fx.mjs",
```

- [ ] **Step 4: Verify**

Run: `npx tsc -b && npm run build` → clean. Then the reset ritual (`rm -rf .wrangler/state && npm run db:local`) → seed-fx prints "60 fx_rates rows ending today".

---

### Task 6: E2E coverage, docs, version

**Files:**
- Modify: `scripts/e2e.mjs`
- Modify: `docs/build-status.md` (new v0.15 entry at the top of the version entries)
- Modify: `package.json` (version)

**Interfaces:**
- Consumes: everything above. The seeded trip 1 starts with `watch_currencies='[]'` (the column arrives via UPGRADES after seeding), so the e2e exercises the admin setup flow first — that is intentional coverage.

- [ ] **Step 1: Widget e2e steps** — insert right BEFORE the `// 39. MCP end to end` block:

```js
// 38b. v0.15 forex widget: admin sets currencies, widget renders band + signal
await page.goto(`${BASE}/trips/1`);
await page.waitForSelector('button:has-text("Set up currencies")');
await page.click('button:has-text("Set up currencies")');
await page.waitForSelector('.modal input[list="fx-codes"]');
await page.fill('.modal input[list="fx-codes"]', 'JPY');
await page.press('.modal input[list="fx-codes"]', 'Enter');
await page.fill('.modal input[list="fx-codes"]', 'USD');
await page.press('.modal input[list="fx-codes"]', 'Enter');
await page.click('.modal button:has-text("Save")');
await page.waitForSelector('.fx-row .fx-spark');
const fxRows = await page.$$('.fx-row');
if (fxRows.length !== 2) await fail(`expected 2 fx rows, got ${fxRows.length}`);
const fxText = await page.textContent('.card:has(.fx-row)');
if (!/1 MYR = [\d.,]+ JPY/.test(fxText)) await fail('fx display rate missing');
if (!(await page.$('.fx-badge'))) await fail('fx signal badge missing');
// the API itself: band ordered, signal valid, direction sane
const fxApi = await page.evaluate(() => fetch('/api/trips/1/fxseries?quote=JPY&window=1m').then(r => r.json()));
if (!fxApi.band || !(fxApi.band.low < fxApi.band.high)) await fail(`fx band malformed: ${JSON.stringify(fxApi.band)}`);
if (!['buy', 'ok', 'wait'].includes(fxApi.signal)) await fail(`fx signal invalid: ${fxApi.signal}`);
if (fxApi.current.rate > fxApi.band.high && fxApi.signal !== 'buy') await fail('fx signal inverted: rate above band must be buy');
if (fxApi.current.rate < fxApi.band.low && fxApi.signal !== 'wait') await fail('fx signal inverted: rate below band must be wait');
// window switch reaches the API with the new window
await page.click('.card:has(.fx-row) button:has-text("1W")');
await page.waitForTimeout(500);
const fx1w = await page.evaluate(() => fetch('/api/trips/1/fxseries?quote=JPY&window=1w').then(r => r.json()));
if (fx1w.points.length > 8) await fail(`1w window returned ${fx1w.points.length} points`);
// guardrails: bad currency rejected, watching the base rejected
const badCur = await page.evaluate(() => fetch('/api/trips/1/currencies', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ watch_currencies: ['ZZZ'] }),
}).then(r => r.status));
if (badCur !== 400) await fail(`bad currency should 400, got ${badCur}`);
await shot('24-fx-widget');
console.log('fx widget ok (setup, 2 rows, band+signal direction, window, validation)');
```

- [ ] **Step 2: Member visibility check** — the suite later has a member-session page (`p5`, used for My-spend/MCP member steps). After the member context exists, add:

```js
// member sees the widget but no settings gear
await p5.goto(`${BASE}/trips/1`);
await p5.waitForSelector('.fx-row .fx-spark');
if (await p5.$('button[title="Edit currencies"]')) await fail('member should not see fx settings');
console.log('fx member view ok (widget visible, no gear)');
```

- [ ] **Step 3: Trip-creation currencies** — the suite creates the "Kyushu Campervan" trip; extend that creation flow (where the modal is filled) to also add a watch currency before submitting, then assert after creation:

```js
// (inside the existing new-trip modal fill, before submit)
await page.fill('.modal input[list="fx-codes"]', 'JPY');
await page.press('.modal input[list="fx-codes"]', 'Enter');
// (after the trip exists — find its id from the API as the suite already does)
const kTrip = await page.evaluate(() => fetch('/api/trips').then(r => r.json()).then(ts => ts.find(x => x.name.includes('Kyushu'))));
if (!JSON.parse(kTrip.watch_currencies ?? '[]').includes('JPY')) await fail('trip creation did not persist watch currency');
console.log('trip creation currencies ok');
```

- [ ] **Step 4: Update the suite's final banner** from `v0.6-v0.14` to `v0.6-v0.15`.

- [ ] **Step 5: Full verification**

1. `npx vitest run` → all green (79 + ~8 new).
2. Reset ritual, then `node scripts/e2e.mjs` → `E2E PASSED`.

- [ ] **Step 6: Version + build status**

`npm pkg set version=0.15.0`. Add a `## v0.15.0 — "Know your rate" (…)` entry at the top of `docs/build-status.md`'s version entries: what shipped (widget, windows, signal + direction rule, one-fetch-per-day caching, trip-creation pickers, seed-fx for hermetic e2e), the two spec deviations (no UPGRADES data seed → admin setup card; expense pre-fill already existed), and the test counts.

- [ ] **Step 7: Hand to the user** — working tree ready; the user commits via GitHub Desktop. Live rollout note for the delivery message: after deploy, open each trip's dashboard once as admin and click "⚙️ Set up currencies" (Japan: JPY + USD · Kyushu: JPY).

---

## Self-review notes

- Spec coverage: reference+watch currencies (T2/T3/T5), band/signal + direction pin (T1), windows 1W–1Y (T1/T4), one-fetch-per-day caching + stale-serve (T3), widget UI + admin editor + member visibility (T4), trip creation (T5), EN+BM (T4), hermetic e2e (T5/T6), rollout (T6). Expense pre-fill: already existed — deviation 2. UPGRADES data seed: replaced — deviation 1.
- `watch_currencies` parse failures always degrade to `[]`, never throw.
- `FxWindow` names/values match between `shared/fxband.ts`, the server import, and the widget's local `WINDOWS` list.
