# v0.15 — "Know your rate" · Forex widget spec

**Status: approved 4 Sep 2026 · shipped as v0.15.0 — as-built deviations listed in docs/build-status.md.**
Sub-project C of the multitenant roadmap (approved 4 Sep 2026: order C → A → B).

## What it is

A currency widget on each trip's dashboard. The trip has a **reference
currency** (what the family thinks in — MYR) and any number of **watch
currencies** (the trip's local currency, plus anything used for purchases,
e.g. JPY and USD). For each watched currency the widget shows the current
rate, a sparkline of history, an average-high/average-low band for a chosen
window, and a plain-language signal: is this foreign currency cheap, normal,
or expensive right now *relative to that window*.

Explicitly not a prediction. Every signal is labelled "vs the last N days".

## Hard constraints honoured

- RM0, keyless: data from Frankfurter (`api.frankfurter.dev`), already the
  app's FX source. No key, no quotas, daily ECB-style reference rates,
  200+ currencies (MYR/JPY/USD verified live on 4 Sep 2026).
- At most one upstream fetch per trip per day (a single range call covers
  every watched currency for a full year), cached in the existing
  `fx_rates` D1 table. The family hammering the widget costs Frankfurter
  nothing and the worker one D1 query.
- Schema changes go in BOTH `SCHEMA` and `UPGRADES`. No manual SQL.
- Daily data only → windows are **1W / 1M / 3M / 6M / 1Y** (approved: no
  intraday "day" filter; it cannot exist keyless-free).

## The direction trap (nailed down so the signal is never inverted)

Frankfurter with `base=MYR` returns "1 MYR = 38.5 JPY" — a HIGHER number
means your money buys MORE yen. But "cheap/expensive" must describe the
FOREIGN currency, because "is JPY cheap right now?" is the question a buyer
asks. Therefore:

- **Display rate** (big number): `1 {ref} = X {watch}` — the Wise-style
  familiar direction (1 MYR = 38.5 JPY).
- **Signal math** runs on **cost**: `cost = 1 / rate` (what one unit of the
  watch currency costs in the reference currency). Cheap = cost below the
  band. With display-rate series r₁..rₙ this is equivalent to: rate ABOVE
  the rate-band's high ⇒ foreign currency cheap ⇒ **good time to buy**.
- The unit test suite pins both formulations against a hand-computed
  fixture so an inversion can never ship silently.

### Band + signal definition

Over the selected window's daily rates (in cost terms c₁..cₙ, n ≥ 5):

- `mean` = arithmetic mean of cᵢ
- `avgLow` = mean of all cᵢ < mean (the "average low")
- `avgHigh` = mean of all cᵢ > mean (the "average high")
- current cost `c`:
  - `c < avgLow` → **buy** — "JPY is cheaper than its recent average low"
  - `avgLow ≤ c ≤ avgHigh` → **ok** — "within its usual range"
  - `c > avgHigh` → **wait** — "more expensive than its recent average high"
- Fewer than 5 data points in the window (young currency, API gap):
  no band, no signal — show the rate and sparkline with "not enough history".
- All cᵢ equal (degenerate): signal **ok**.

Pure logic lives in `shared/fxband.ts` (`computeBand(points)`,
`signalOf(band, current)`) — unit-testable, no I/O.

## Schema (SCHEMA + UPGRADES)

```sql
ALTER TABLE trips ADD COLUMN watch_currencies TEXT NOT NULL DEFAULT '[]'
```

JSON array of ISO codes, e.g. `["JPY","USD"]` — same pattern as
`hidden_features`. `trips.base_currency` (exists, default 'MYR') becomes the
reference currency and is finally surfaced in the UI. `fx_rates`
(rate_date, base, quote, rate) is reused unchanged as the series store.

Seed upgrade: the Japan trip gets `["JPY","USD"]`; the Kyushu client trip
gets `["JPY"]` — via UPGRADES so live data matches dev.

## API

### `GET /trips/:id/fxseries?quote=JPY&window=1m`
Any trip member. `window ∈ 1w|1m|3m|6m|1y` (default `1m`).

1. Ensure freshness: if `fx_rates` lacks a row for (base, quote) on the most
   recent expected business day, fetch
   `https://api.frankfurter.dev/v1/{start}..{end}?base={ref}&symbols={all watched}`
   for the **largest** window (1y) and upsert every returned point for every
   watched symbol — one upstream call refreshes all pairs for a year, so
   window switching and sibling currencies are D1-only afterwards.
2. Serve from D1: `{ base, quote, window, points: [{date, rate}...],
   band: {avgLow, avgHigh, mean} | null, current: {date, rate},
   signal: 'buy'|'ok'|'wait'|null }`
   (band/signal in DISPLAY-rate terms, already direction-corrected).
3. Frankfurter down and cache empty → `502 fx_unavailable`; widget shows a
   quiet "rates unavailable" line, never breaks the dashboard.

### `PATCH /trips/:id/currencies` (admin)
Body `{ base_currency?, watch_currencies? }`. Codes validated against the
cached currency list; max 6 watch currencies (dashboard stays readable);
watch list excludes the reference currency itself.

### `GET /currencies`
Proxy of Frankfurter `/v2/currencies` cached in KV for 7 days →
`[{code, name}]` for the pickers.

### Trip creation
`POST /trips` accepts `base_currency` and `watch_currencies`. The Trips page
create form gains a reference-currency select (default MYR) and a
watch-currency multi-select (searchable by code/name).

## UI

**Dashboard widget** `💱 {t.fxTitle}` — a card on the trip dashboard,
visible to every member (rates are not sensitive), placed after the
countdown/journey cards:

- Window chips: `1W 1M 3M 6M 1Y` (selected persists per user in
  localStorage; default 1M).
- One row per watch currency:
  - `1 MYR = 38.52 JPY` (display direction) + day-over-day delta arrow
  - inline SVG sparkline (no chart library) with the band shaded and the
    current point marked
  - signal badge: 🟢 `t.fxBuy` ("Good time to buy — cheaper than its recent
    average low") · ⚪ `t.fxOk` ("Within its usual range") · 🟠 `t.fxWait`
    ("Pricier than usual — consider waiting") · plus "vs last {N} days"
- Admin-only ⚙ opens a small modal: reference currency + watch list
  (the same `PATCH /currencies` editor as trip creation).
- Zero watch currencies → widget hidden entirely (not an empty card).

**Expense form pre-fill:** when a currency being entered matches a cached
pair, today's cached rate pre-fills `fx_rate` (user can still override).
Existing payment-date FX behaviour is untouched.

All strings EN + BM in `i18n.tsx`.

## Out of scope (cut lines)

Rate alerts/notifications (needs push/email — revisit with PWA), intraday
data, historical "you should have bought on…" hindsight views, currency
conversion inside the ledger (balance engine stays MYR-based and untouched),
a 'forex' feature-hiding toggle (add later if a trip ever wants it hidden).

## Tests

Unit (`tests/fxband.test.ts` + additions):
- band math against a hand-computed 10-point fixture
- signal at, below and above each boundary (boundary = ok)
- **inversion pin**: display-rate formulation and cost formulation agree on
  the fixture
- <5 points → null band/signal; all-equal → ok
- window date arithmetic uses `shared/days.ts` (no toISOString regressions)

E2E additions:
- seed `fx_rates` rows directly, then open dashboard → widget renders rate,
  band values, signal badge — these are structural assertions that hold
  whether the run is offline against the seeded rows or online against live
  Frankfurter data
- switch window → values change accordingly
- admin edits watch list → row appears/disappears; non-admin sees no ⚙
- trip creation with base/watch currencies persists

Full 79-unit + e2e suite green before delivery.

## Rollout

v0.15.0. Schema auto-upgrades (`watch_currencies` column + seed values).
No Cloudflare config change, no new bindings, nothing for the deploy beyond
the usual push.
