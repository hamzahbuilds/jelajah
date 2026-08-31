# Jelajah v0.10 — "Craft & Flow" (spec)

Status: approved and shipped · 31 Aug 2026
Scope agreed through Q&A; same stack, RM0, no card, auto DB upgrades.

## 1. Sharper pins + station intelligence
- **Geocoder upgrade**: place search switches to Photon (free, typo-tolerant, POI-aware),
  biased to the trip's map area; Nominatim stays as fallback. Applies to activity
  search, day start/end, stay pins, and import geocoding.
- **Nearest stations**: when a pin is set, fetch the 3 nearest railway/subway
  stations via the free Overpass API (name incl. English tag, walking distance,
  operator/lines where tagged), cached on the activity (`stations_json`,
  `station_idx` for the chosen one; default = nearest). Per-activity picker to
  switch station/line. Legs render as: 🚶 x min → 🚇 StationA → StationB ≈¥fare →
  🚶 y min (walk times from station distances; rail fare from inter-station
  distance). Lookup happens once per pin move; failures degrade to point-to-point legs.
- **Acceptance**: pin on teamLab Planets suggests Toyosu-area stations
  with distances; switching stations changes the leg's walk minutes; no external
  call on re-render (cache hit).

## 2. Reorder with smart reflow (per Sage's custom answer)
- Drag-and-drop (native HTML5, desktop/tablet) + ↑↓ buttons (all screens), admin only
  (NOTE: v0.12 extended editing to members when the trip's toggle allows).
- On reorder the day **reflows**: durations preserved (start-only activities
  assume 60 min); first activity keeps the day's earliest start; each next
  start = previous end + recomputed travel estimate for the new order (chosen
  mode), rounded up to 5 min; untimed activities keep manual order after the
  timed block; auto events (flights/check-ins/outs) never move. Travel legs,
  fares and map route update immediately.
- **Undo** chip restores the previous order+times (kept until next change).
- Acceptance: swapping two timed activities swaps their slots and shifts the rest
  by the new travel deltas; server stores new sort + times atomically (bulk endpoint).

## 3. Dashboard journey map
- "Journey" card per trip: one map with ✈️ dashed great-arc lines between airports
  (built-in IATA→lat/lng table ~60 airports; unknown codes matched by city keywords),
  🏨 stay pins, numbered 📍 activity pins in chronological order, auto-fit whole
  journey, trip-accent-coloured pins/arcs, stat chips (✈️ n flights · 🏨 n stays ·
  📍 n places · ~total km).
- Members see it too (hidden only if admin hid Plan).

## 4. Trip personalisation
- Create/edit trip modal: curated travel-emoji grid + free emoji input, and 8
  preset accent colours (contrast-checked). Accent tints that trip's hero, active
  tab underline and map pins. `trips.color` column, default current teal.

## 5. Foreign-CSV mapping wizard (client itineraries)
- Import CSV has two paths: **Template** (auto-detected by header) and
  **Map columns…** for any other spreadsheet:
  1. Upload → grid preview.
  2. Column mapping UI: point Jelajah fields (day/date, time, title, notes,
     overnight/accommodation, budget columns — v0.12 added category + price) at
     her columns; day/date forward-fills merged rows; "11:00–13:00" splits into
     start/end; "Dec 8" gets the year from the trip's date range.
  3. Rows whose time cell is text (e.g. "Halal/Pork-Free Meal") become untimed
     note-activities; the Overnight column becomes a 🛏️ lodging activity.
  4. Preview with **auto-geocoding** (Photon, throttled, destination-biased):
     each row shows its resolved pin ✓/— before Apply; stations fetched on apply.
  5. Mapping saved as a named profile (trip-level) for re-imports.
- Verified against the real client file (tests/fixtures/client-campervan.csv):
  10 days, ~60 rows, time ranges, meal rows, per-day ¥ budgets.

## 6. Day budgets
- `day_budgets` table (trip_id, day, transport/accommodation/food/attractions/
  misc/total + currency + myr_estimate). Populated by the wizard or edited inline
  (admin) in the Plan day header. Display/planning only — never enters the ledger.

## 7. Check-in vouchers + "Pay at hotel"
- Parser `tripcom-hotel-voucher` (built from the real Asahikawa voucher):
  hotel name, address, check-in/out dates AND times, rooms/nights, guest names
  (matched to participants), amount+currency, booking & confirmation numbers,
  free-cancellation deadline.
- Review screen **Payment status** field: `paid` (default) or `pay at hotel`
  (voucher parser preselects it).
- **Committed, not owed**: pay-at-hotel expenses show in the ledger with a 🏨💤
  badge and in trip totals as "committed", are EXCLUDED from who-owes-whom, and
  auto-create a whole-payment due date on the check-in day. One tap "Mark paid"
  (admin) flips status → enters balances normally. Dashboard shows committed
  amount beside trip total.
- Schema: `expenses.payment_status TEXT DEFAULT 'paid'` (auto-upgrade).

## 8. Map tiles & the "API key" question
- Tile layer is a fallback chain with error detection: CARTO Voyager (English
  labels) → OpenStreetMap standard (no key, always works); self-heals within a
  second and remembers for the session. `window.JELAJAH_TILE_URL` override for
  any provider. Geocoding (Photon/Nominatim) and Overpass need no keys.

## Non-goals
- No paid routing/fares APIs; station "convenience" = distance + line info, not
  timetable quality. No auto-settlement of pay-at-hotel. Rooms/OCR/PWA in backlog
  (OCR later shipped in v0.11).

## Verification
- Unit: voucher parser vs the real PDF; wizard transforms vs the real client CSV;
  reflow arithmetic; station-cache logic.
- e2e: reorder→reflow with recomputed legs + undo; wizard import of the client
  CSV; voucher → pay-at-hotel excluded from balances, due date on check-in,
  mark-paid enters balances; journey card renders; trip accent applied.
- Responsive spot-checks at 360 px.
