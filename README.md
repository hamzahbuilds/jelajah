# 🧭 Jelajah — Family Travel Planner & Expense Splitter

Phase 1 (money engine) of the platform specced in `travel-platform-spec.md`:
upload travel PDFs → rule-based extraction → review screen → categorised ledger →
per-person splits → who-owes-whom → payment tracker → bilingual (EN/BM) dashboard.

**Stack (Plan C, all free tier):** React + Vite on Cloudflare Pages · Hono API in
Pages Functions · D1 (SQLite) · R2 (file archive) · pdf.js text extraction in the
browser · frankfurter.dev historical FX (cached in D1) · zero AI services.

- `shared/parsers/` — vendor parsers (Trip.com receipt/itinerary, Airbnb, generic
  fallback). Unit-tested in `tests/` against the 8 real trip documents.
- `functions/` — API: hand-rolled auth (PBKDF2 + server-side sessions), trips,
  documents, expenses/shares/due dates, payments, balances, FX, checklist.
- `src/` — responsive SPA: dashboard (countdown, category spend, outstanding,
  due dates, private checklist), documents+review flow, ledger, payments, people.
- `scripts/` — seed generator (Japan 2026 trip), fixture extractor, e2e test.

**Deploy:** see [DEPLOY.md](./DEPLOY.md). **Tests:** `npm test` (parsers) and
`node scripts/e2e.mjs` (full browser flow against `wrangler pages dev`).
