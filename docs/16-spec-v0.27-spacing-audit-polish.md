# Spec v0.27 — spacing audit, activity pagination, Trip Settings rename

Date: 2026-09-07. Source: user feedback batch.

## 1. Card-to-card spacing (Plan, Admin, + audit of all pages)

Root cause: `.card` carries no margin; vertical spacing comes only from a
`.grid` (gap 16) wrapper. Several pages stack cards inside *bare* column
divs, so consecutive cards touch. v0.24 precedent (Dashboard): wrap the
stack in `<div className="grid">`.

Fixes (all pages audited):
- `Plan.tsx` — both `.plan-cols` column divs get `className="grid"`.
- `Payments.tsx` — both `grid-2` column divs get `className="grid"`.
- `MySpend.tsx` — right column div gets `className="grid"`.
- `Review.tsx` — left column div gets `className="grid"`.
- `Admin.tsx` — the stats fragment becomes `<div className="grid">`
  (`.stats` gets inline `marginBottom: 0` so grid gap doesn't double);
  trailing AI/accounts `grid-2` gets `marginTop: 16`.
- Already correct, untouched: Dashboard, People (cards are direct grid-2
  children), Settings (explicit margins), Documents, Ledger (single card).

## 2. Home page top gap

`.container` has zero top padding, so PageHead sits flush on every page —
most visible on `/` (Home + New trip). Fix globally:
- `.container` → `padding: 24px 16px 48px` (mobile ≤620px: `16px 10px 40px`).
- `TripShell` trip-header drops its `marginTop: 18` to avoid doubling.

## 3. Admin "Recent activity" pagination

Default show 5; "Show more" reveals/loads more (audit history purpose).
- Server: `/admin/stats` audit select adds `a.id`; new
  `GET /admin/audit?cursor=<id>` (requireAdmin) — rows with `id < cursor`,
  `ORDER BY a.id DESC LIMIT 20`, returns `{ items, next_cursor }`
  (next_cursor null when exhausted).
- Client (Admin feed card): list = stats.audit + fetched extras; shown
  starts at 5; Show more reveals +10 locally, then fetches next page via
  cursor when local list exhausted; button hides when done.
- i18n: `showMore` en "Show more" / ms "Tunjuk lagi".

## 4. People tab → "Trip Settings"

Label-only rename (route `/people`, keys, icons unchanged):
- i18n `people`: en "Trip Settings", ms "Tetapan Trip".
- Covers navModel label, TabBar More sheet, People PageHead automatically.
- e2e: sidebar selectors `has-text("People")` → `has-text("Trip Settings")`.

## Constraints

RM0, no schema change, no money-path files touched, EN+BM parity,
ritual must end `E2E PASSED (Phase 1 + 2 + v0.6-v0.27)`.
