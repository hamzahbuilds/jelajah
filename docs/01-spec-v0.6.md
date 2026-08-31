# Jelajah v0.6 — "Getting Around & My Money" (spec)

Status: approved by Sage (plan + build in one go) · 30 Aug 2026
Extends the main PRD; same stack (Cloudflare Worker + D1 + KV, RM0, no card).

## 1. Travel legs engine

**Problem**: moving 16 people between activities is the least-planned, most-argued part
of the day; nobody knows how long or how much between stops.

**Behaviour**
- Each plan day renders as a chain: START → located activities (time order) → END,
  with a "leg" connector between each pair showing: recommended mode, est. duration,
  est. fare in ¥ and RM (at the trip's cached FX rate), and a Google Maps transit
  deep link (origin+destination filled).
- Mode recommendation by great-circle distance: ≤1.0 km walk; 1–40 km train/metro;
  >40 km intercity rail; taxi always shown as the alternative. User can switch the
  chosen mode per leg (persisted as an override).
- Fare estimates (marked "≈"): metro/JR distance bands (¥180–¥480 up to 40 km),
  intercity ≈¥25/km, Tokyo/Osaka taxi meter (¥500 first 1.096 km + ¥100/255 m),
  walking free. Durations: walk 12 min/km, train ~3 min/km + 8 min overhead,
  taxi ~2.5 min/km.
- "Log actual fare": admin logs to the shared ledger (transport expense, per-pax
  multiply option); a member logs to their private tracker. Estimate ≠ ledger —
  nothing enters any ledger without explicit logging.
- **Start/end points**: default = that night's accommodation, resolved automatically
  from confirmed accommodation bookings covering the day (checkout day uses the
  next stay if any). Admin can geocode/adjust a stay's pin once (stored on the
  expense), override start/end per day, or set a trip-wide default ('*' row).

**Acceptance**
- Given two activities 0.6 km apart → leg recommends 🚶 with "free".
- Given 8 km apart → recommends 🚇 with ¥210–260 band and RM conversion.
- Overriding a leg to taxi persists across reloads and other admins' views.
- A day with no located start still renders legs between located activities.

## 2. English base map
- Swap Leaflet tiles to CARTO Voyager (latin/international labels), attribution
  "© OpenStreetMap contributors © CARTO". Fallback to standard OSM tiles is a
  one-line revert if the free tier ever degrades.

## 3. Personalised dashboards
- Member dashboard: countdown; **next upcoming activity** (first future event where
  they are a participant; whole-group auto events — flights, check-in/out — always
  count) with date/time; my outstanding + link to statement; **My spend** summary
  (this month + trip total); private checklist. No trip-wide money widgets.
- Admin dashboard: unchanged + upcoming widget (full schedule, next 3 events).
- If the admin hid Plan from members, the upcoming widget hides gracefully.

## 4. My spend — private per-trip tracker
- New tab, all roles: quick-add (amount, JPY default with FX at spend date and
  editable rate, category, note, optional "on behalf of" free-text), list with
  date/category filters, totals + by-category.
- **Privacy**: rows carry user_id; every endpoint filters by the session user.
  There is no admin endpoint to read others' items — verified by test.
- **Promote**: member pushes one item into the shared ledger → server creates a
  normal expense (payer = their linked participant, equal split across all trip
  members — admin edits after if wrong), deletes the private row, audit-logged.
  Promote requires a linked participant; a user without one sees promote disabled.

## Non-goals (v0.6)
- No live routing/fares API (estimates + deep links only, per decision).
- No settlement engine for behalf-of notes inside My spend (informal text only —
  NOTE: v0.12 later added structured peer tagging + settlement).
- Rooms, OCR, PWA unchanged in backlog.

## Data (v3 upgrades, auto-applied)
- `day_settings(trip_id, day PK('*'=default), start_name/lat/lng, end_name/lat/lng)`
- `leg_overrides(trip_id, day, leg_key UNIQUE, mode, fare_jpy, note)` — leg_key =
  `${fromRef}->${toRef}` with refs `start|end|act:<id>|auto:<expense>` so edits
  survive resequencing.
- `personal_expenses(id, trip_id, user_id, spend_date, category, description,
  amount_original, currency, fx_rate, amount_myr, behalf_note, created_at)`
- `expenses.lat/lng` (nullable) for accommodation pins.

## Verification
- Unit tests for the fare/mode module (distance bands, taxi formula, edge 0 km).
- e2e: leg renders with mode+fare between two located activities; override persists;
  member adds private item → admin API/UI cannot see it; promote → appears in
  shared ledger and leaves the private list; upcoming widget shows next activity.
- Responsive spot-check at 360 px for Plan-with-legs and My spend.
