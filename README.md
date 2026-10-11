# 🧭 Jelajah — Family Travel Planner & Expense Splitter

> **Taking over this project? Start with [HANDOVER.md](./HANDOVER.md)** — it
> links the build history (`docs/build-status.md`), the dev runbook with every
> operational trap (`docs/DEV-RUNBOOK.md`), and all feature specs (`docs/`).
> Current version: **v0.28.0**. Personal itineraries, private/group notes,
> password recovery, routed maps, guest sharing, public guides, and print/PDF
> views are described in [the journey specification](docs/17-spec-v0.28-journeys.md).
> Read [provider setup and release notes](docs/JOURNEY-SETUP.md) before deployment.


Phase 1 (money engine) of the platform specced in `travel-platform-spec.md`:
upload travel PDFs → rule-based extraction → review screen → categorised ledger →
per-person splits → who-owes-whom → payment tracker → bilingual (EN/BM) dashboard.

**Stack (Plan C, all free tier):** React + Vite on Cloudflare Pages · Hono API in
Pages Functions · D1 (SQLite) · R2 (file archive) · pdf.js text extraction in the
browser · frankfurter.dev historical FX (cached in D1) · zero AI services.

- `shared/parsers/` — vendor parsers (Trip.com receipt/itinerary, Airbnb, generic
  fallback). Unit-tested in `tests/` against the 8 real trip documents.
- `server/` — the Worker API: hand-rolled auth (PBKDF2 + server-side sessions),
  trips, documents, expenses/shares/due dates, payments, balances, FX, checklist.
- `src/` — responsive SPA: dashboard (countdown, category spend, outstanding,
  due dates, private checklist), documents+review flow, ledger, payments, people.
- `scripts/` — seed generator (Japan 2026 trip), fixture extractor, e2e test.

**Deploy:** see [DEPLOY.md](./DEPLOY.md). **Tests:** `npm test` (parsers) and
`node scripts/e2e.mjs` (full browser flow against `npm run dev:full`).
