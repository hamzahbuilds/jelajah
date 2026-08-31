# 🧭 Jelajah — Project Handover

**Read this file first.** You (the assistant taking over) are inheriting a
live, deployed product with a real family depending on it before their trip
starts on **29 Nov 2026**. This file + the `docs/` folder contain everything
the previous developer knew. Nothing else survives the handover — treat this
repo as the single source of truth.

## What Jelajah is

A family travel planner + expense splitter, built for Sage (admin account
"Hamzah") who organises a ~16-person family trip to Japan (29 Nov – 7 Dec
2026, Tokyo→Osaka) and fronts most of the money. It ingests booking PDFs and
receipt photos, keeps a who-owes-whom ledger with instalment due dates,
plans day-by-day itineraries with maps/transit estimates, and now includes an
optional AI assistant and an MCP server. A second trip in the same instance
serves Sage's client (Kyushu campervan itinerary imported from her CSV).
English + Bahasa Malaysia throughout; the AI chat also does Sarawak Malay.

**Hard constraints (never violate):**
1. **RM 0/month, no credit card anywhere** — Cloudflare free tier (Worker +
   D1 + Workers KV), free keyless APIs only. The single optional key is the
   admin's own free Gemini key.
2. **Sage deploys with a browser only** — he uploads files to GitHub;
   Cloudflare auto-builds. No terminal, no manual SQL ever (schema
   auto-upgrades in-app), and **delivery zips must NEVER contain
   wrangler.toml** (his live copy holds the real D1/KV ids and secret).
3. **Money correctness and privacy are sacred** — the balance engine, per-trip
   isolation, and My-spend privacy are covered by tests that must stay green.

## Current state (v0.12.2, 31 Aug 2026)

Deployed and working: document parsing (Trip.com, Airbnb, AirAsia, hotel
vouchers + a universal keyword extractor and in-browser OCR for anything
else), ledger/splits/payments with targeted settlement and pay-at-hotel
"committed" status, FX at payment-date rates, itinerary with transit legs /
station intelligence / smart reorder-reflow / CSV import wizard / AI
suggestions, per-user dashboards + journey map, private My-spend with peer
tagging & settlement, member permissions & feature hiding, trip theming,
toasts, upload progress, an AI assistant (bring-your-own-key, Gemini native
or any OpenAI-compatible), and an MCP server (`/api/mcp`) usable from Claude
Code/Desktop, Codex, etc.

**`docs/build-status.md` is the authoritative version-by-version history —
read it end to end.** The remaining agreed backlog is at the bottom of
`docs/DEV-RUNBOOK.md` §8 (headline items: rooms allocation, PWA/offline,
insights, full BM pass).

## Reading order

1. This file.
2. `docs/build-status.md` — what exists, and every bug/decision along the way.
3. `docs/DEV-RUNBOOK.md` — how to build, test, package; the traps; the
   invariants. **Do not write code before reading §4 (schema) and §6 (packaging).**
4. `travel-platform-spec.md` (repo root) — the original approved PRD;
   `docs/00…04-*.md` — per-version feature specs with acceptance criteria.
5. Skim the code in this order: `server/lib/schema.ts` → `server/app.ts`
   (all API + MCP) → `shared/` (pure logic: parsers, fares, reflow, wizard,
   keywords, assistant) → `src/pages/Plan.tsx` (the heaviest page) →
   `scripts/e2e.mjs` (the 40-step regression suite doubles as executable
   documentation of every feature).

## How the previous developer worked with Sage (keep this cadence)

Sage is non-technical for ops but sharp on product. The proven loop:
**ask clarifying questions (with recommended options) → present a plan →
get approval → write a spec → get approval again → build → verify with the
FULL test suite → deliver zip + screenshots + a plain-language summary →
update docs/build-status.md.** He frequently adds requests mid-build — fold
them in, and record them in the spec's addendum. Explain technical events
(deploy failures, API changes) in plain language with exact click-by-click
fixes; he deploys from the GitHub web UI.

When he reports a bug, reproduce it in the e2e environment before fixing;
every fix ships with a regression test.

## First session checklist for the new assistant

1. Read the docs in the order above.
2. Bootstrap the dev environment and run BOTH suites (`DEV-RUNBOOK.md` §1–§3);
   confirm 61 unit tests + 40 e2e steps green before touching anything.
3. Summarise back to Sage: current version, what works, the backlog, and the
   open follow-ups (runbook §8) — so he can correct any drift.
4. Only then take the next feature request, using the cadence above.

## Live-deployment facts Sage holds (not in this repo, by design)

- The GitHub repo connected to Cloudflare (this code).
- `wrangler.toml` with his real D1 database id, KV namespace id and
  SESSION_SECRET — lives ONLY in his repo; never overwrite it.
- The Cloudflare account (Workers project "jelajah", D1 "jelajah-db", KV).
- His Gemini API key (in the app's Settings, stored server-side in D1).
- Admin login for the live site.
If any of these are needed, ask him — never guess or reset them.
