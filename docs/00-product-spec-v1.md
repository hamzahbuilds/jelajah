# Jelajah — Family Travel Planner & Expense Splitter
**Product Requirements Document (PRD) v1.0 — approved (Plan C)**

- Author: Claude (PM) with Sage
- Date: 30 Aug 2026
- Status: Approved; Phases 1–2 shipped, see docs/build-status.md
- Stack decision (approved): **Plan C — All-Cloudflare** (Pages + Workers + D1 + KV*, free tier)
  (*R2 was swapped for Workers KV in v0.3 so no credit card is ever needed)
- Working name: *Jelajah* (BM: "explore")

---

## 1. Problem Statement

Sage organises large family trips (next: Japan, 29 Nov – 7 Dec 2026, ~16 pax + 1 infant) and fronts most of the money across Trip.com, Airbnb, ATOME instalments and on-the-ground spending. Today the bookings live in scattered PDFs, the "who owes the main payer what" maths lives in someone's head or an ad-hoc spreadsheet, and there is no single place the family can see the plan. The cost of not solving it: money leaks (unclaimed repayments, forgotten instalment due dates), repeated "what time is check-in?" questions, and hours of manual reconciliation after every trip.

Evidence from the real documents: one flight receipt covers only 3 of 16 travellers, two flights were paid by ATOME instalments (due dates exist but aren't tracked anywhere), amounts appear in both MYR and JPY contexts, and passenger lists differ per booking — exactly the complexity a spreadsheet handles badly.

## 2. Goals

1. **One source of truth for money**: every booking/receipt uploaded, categorised and attributed to specific people; the who-owes-whom balance for the Japan trip is always current and matches reality (target: admin reconciliation effort ≤ 10 min/week vs hours in a spreadsheet).
2. **Accurate extraction with minimal typing**: for Trip.com and Airbnb PDFs, ≥ 90% of fields auto-filled; admin corrects at most 1–2 fields per document on the review screen.
3. **Family self-service**: every adult member can log in, see the calendar/itinerary and their own balance, and keep a private strike-off checklist — before, during and after the trip.
4. **True zero hosting cost**: runs entirely within Cloudflare free tiers + free APIs. Target: RM 0/month, no credit card anywhere.
5. **Bilingual from day one**: every screen in English and Bahasa Malaysia via a per-user toggle.

## 3. Non-Goals (v1)

- No payment gateway / money movement — the platform records repayments; transfers happen outside (DuitNow, cash).
- No email sending — admin creates accounts and hands out passwords; resets are admin-issued temp passwords.
- No native mobile apps — responsive web.
- No AI/LLM parsing for documents — rule-based parsers + review screen (v0.12 later added an OPTIONAL bring-your-own-key AI assistant for planning/Q&A, but document parsing remains rule-based).
- No embedded live transit routing — Leaflet/OSM map + deep links to Google Maps; fares logged manually/estimated.
- No multi-family/SaaS features — single household instance (a client trip is handled as another trip in the same instance).

## 4. Users & Roles

| Role | Who | Can do |
|---|---|---|
| **Admin** | Sage (+ co-organisers) | Everything: trips, member accounts, upload & confirm documents, ledger/splits, repayments, itinerary, visibility toggles, AI settings, MCP tokens |
| **Member** | Family adults | Log in, switch language, view dashboard/itinerary/map, own balance & payment history, download documents, private checklist + My-spend, peer settlements; may edit the plan if the trip's toggle allows |

A person can also exist as a **participant only** (kids, infant) — appears in passenger lists, splits and rooms without a login.

## 5. Original requirement highlights (all shipped unless noted)

- Drop a PDF → auto-extract dates/times/category/people/prices/location/vendor/due dates → review screen → confirm to ledger; originals re-downloadable; duplicate warnings; unknown formats get best-effort + manual form.
- Per-expense participant lists with equal or custom shares; payer per expense; balances = shares owed to payer minus repayments (targeted at items or lump sums applied oldest-first, credit tracked).
- FX at the payment-date rate (frankfurter.app, cached, manual override), original amounts preserved.
- Instalment/due-date tracking (whole payment or per person) surfaced before due.
- Itinerary auto-seeded from bookings; activities with time/pin/cost/participants/groups; transport legs with mode auto-detect + ¥/RM fare estimates; day start/end from accommodation.
- Dashboard: countdown/Day-N/days-since, calendars, strike-off checklist, money widgets, journey map.
- Roles admin/member; per-trip member feature-hiding; EN + BM (+ BM Sarawak in the AI assistant).
- **Not yet built** (still open): rooms allocation, PWA/offline, insights page, full BM copy review.

## 6. Success Metrics

- All existing trip documents ingested; ≤ 2 manual corrections per parsed doc; ledger matches Sage's manual figure; every adult member logged in before 29 Nov.
- Post-trip: 100% of shared expenses settled or visibly tracked; zero missed instalment due dates; reconciliation < 30 min; hosting bill RM 0.

## 7. Architecture — see docs/build-status.md and HANDOVER.md for the as-built picture

Original plan: Pages + Workers + D1 + R2. As built: single Cloudflare **Worker** (git-deploy) serving the SPA via [assets] with run_worker_first=["/api/*"], D1, **Workers KV** for files (R2 is a drop-in swap later), hand-rolled auth (PBKDF2 100k, server-side sessions in D1), free keyless APIs only (frankfurter, OSM/CARTO tiles, Photon, Nominatim, Overpass), plus optional bring-your-own-key AI (Gemini native / any OpenAI-compatible) and a built-in MCP server.
