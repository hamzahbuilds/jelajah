# Jelajah — Family Travel Planner & Expense Splitter
**Product Requirements Document (PRD) v1.0 — for approval**

- Author: Claude (PM) with Sage
- Date: 30 Aug 2026
- Status: **Draft — awaiting Sage's approval before build**
- Stack decision (approved): **Plan C — All-Cloudflare** (Pages + Workers + D1 + R2, free tier)
- Working name: *Jelajah* (BM: "explore") — placeholder, rename anytime

---

## 1. Problem Statement

Sage organises large family trips (next: Japan, 29 Nov – 7 Dec 2026, ~16 pax + 1 infant) and fronts most of the money across Trip.com, Airbnb, ATOME instalments and on-the-ground spending. Today the bookings live in scattered PDFs, the "who owes the main payer what" maths lives in someone's head or an ad-hoc spreadsheet, and there is no single place the family can see the plan. The cost of not solving it: money leaks (unclaimed repayments, forgotten instalment due dates), repeated "what time is check-in?" questions, and hours of manual reconciliation after every trip.

Evidence from the real documents: one flight receipt covers only 3 of 16 travellers, two flights were paid by ATOME instalments (due dates exist but aren't tracked anywhere), amounts appear in both MYR and JPY contexts, and passenger lists differ per booking — exactly the complexity a spreadsheet handles badly.

## 2. Goals

1. **One source of truth for money**: every booking/receipt uploaded, categorised and attributed to specific people; the who-owes-whom balance for the Japan trip is always current and matches reality (target: admin reconciliation effort ≤ 10 min/week vs hours in a spreadsheet).
2. **Accurate extraction with minimal typing**: for Trip.com and Airbnb PDFs, ≥ 90% of fields auto-filled; admin corrects at most 1–2 fields per document on the review screen.
3. **Family self-service**: every adult member can log in, see the calendar/itinerary and their own balance, and keep a private strike-off checklist — before, during and after the trip (target: all adult members log in at least once before 29 Nov).
4. **True zero hosting cost**: runs entirely within Cloudflare free tiers + free APIs (frankfurter.app, OSM tiles). Target: RM 0/month at family scale, with headroom of ≥ 10× current usage.
5. **Bilingual from day one**: every screen available in English and Bahasa Malaysia via a per-user toggle.

## 3. Non-Goals (v1)

- **No payment gateway / money movement** — the platform records repayments; actual transfers happen outside (DuitNow, cash). Rationale: cost, compliance, unnecessary for family trust model.
- **No email sending** — admin creates accounts and hands out passwords; resets are admin-issued temp passwords. Rationale: no free-tier-safe mail dependency yet; designed so Resend/SES can slot in later (P2).
- **No native mobile apps** — responsive web (installable PWA later). Rationale: one codebase, family uses phone browsers fine.
- **No AI/LLM parsing service** — rule-based parsers + review screen only. Rationale: Sage's explicit constraint; predictable and free. Architecture leaves a parser interface where an AI fallback could plug in later (P2).
- **No embedded live transit routing** — Leaflet/OSM map + deep links out to Google Maps for train routing; fares logged manually. Rationale: free embedded JP transit routing doesn't exist without heavy self-hosting (decided with Sage).
- **No multi-family/SaaS features** (orgs, billing, public sharing) — single household instance.

## 4. Users & Roles

| Role | Who | Can do |
|---|---|---|
| **Admin** | Sage (+ optionally 1–2 co-organisers) | Everything: create trips, create/disable member accounts, upload & confirm documents, edit ledger/splits, record repayments, allocate rooms, edit itinerary, set who's involved per activity |
| **Member** | Family adults | Log in, switch language, view dashboard/calendar/itinerary/map, view own balance & payment history, download document PDFs, maintain own private checklist |

A person can also exist as a **participant only** (e.g. kids, infant) — appears in passenger lists, splits and rooms without a login.

## 5. User Stories (prioritised)

**Admin — money engine**
1. As the admin, I want to drop a Trip.com or Airbnb PDF and have dates, times, people, prices, vendor and category auto-extracted so that I don't retype bookings.
2. As the admin, I want to confirm/correct extracted fields on a review screen before anything enters the ledger so that the ledger is always trustworthy.
3. As the admin, I want each expense to carry its own participant list (e.g. 3 of 16 pax on a flight) with equal or custom shares so that splits reflect reality.
4. As the admin, I want to set who paid each expense so that balances compute against the right payer.
5. As the admin, I want to record repayments (per-item or lump sum, auto-applied oldest-first) so that each member's outstanding balance updates automatically.
6. As the admin, I want amounts in any currency converted to MYR using the exchange rate on the payment date so that totals are accurate, with the original amount preserved.
7. As the admin, I want instalment/payment due dates (e.g. ATOME) tracked and surfaced before they're due so that nothing is missed.
8. As the admin, I want to re-download any original PDF so that the platform doubles as the trip's document archive.

**Admin — planning**
9. As the admin, I want a day-by-day itinerary auto-seeded from confirmed flights and accommodation so that planning starts from what's already booked.
10. As the admin, I want to add activities with time, place (map pin), estimated/actual cost, attached receipt, and selectable participants (all / group / individuals) so that plans and money stay linked.
11. As the admin, I want to allocate people to rooms per accommodation so that everyone knows where they sleep.

**Member**
12. As a member, I want to see the trip calendar (monthly/weekly/daily) and today's plan so that I know what's happening without asking.
13. As a member, I want to see how much I owe (and have paid) with a per-item breakdown so that repayment is transparent.
14. As a member, I want a private checklist I can strike off so that I can track my own to-dos; nobody else sees it.
15. As a member, I want the interface in Bahasa Malaysia or English so that everyone in the family is comfortable.

**Edge/error stories**
16. As the admin, when a PDF isn't recognised by any parser, I want a pre-filled-as-far-as-possible manual form so that unknown formats still enter the system.
17. As the admin, when a duplicate document is uploaded (same booking no.), I want a warning so that expenses aren't double-counted.
18. As a member with no activities today (pre-trip), I want the dashboard to show the countdown ("87 days to go") — and during the trip "Day 3", after it "5 days since" — so the home screen always orients me.

## 6. Requirements

### P0 — Must have (Phase 1 + 2, ship before 29 Nov)

**Auth & accounts**
- Email + password login; scrypt-hashed passwords (WebCrypto); HttpOnly signed session cookies stored in D1; admin-created accounts; admin temp-password reset; roles admin/member.
- AC: given a disabled account, login fails with a clear message; sessions expire after 30 days; no self-registration route exists.

**Trips**
- Admin CRUD for trips (name, destination, date range, base currency MYR, cover emoji/colour). Each trip scopes its own members, documents, ledger, itinerary, dashboard.
- AC: a member sees only trips they belong to.

**Document ingestion & parsing (rule-based + review)**
- Upload PDF/image up to 10 MB → stored in R2, original always re-downloadable.
- Text extracted client-side (pdf.js); parser registry tried in order: `tripcom-receipt`, `tripcom-itinerary`, `airbnb-confirmation`, then `generic` (keyword/regex mapper for dates, amounts, currency codes, check-in/out, booking refs).
- Extracts: dates, times (check-in/out, departure/arrival), category (accommodation/flight/entrance/pass/food/shopping/transport/other), people involved, total & per-person price, location, vendor/origin, payment method, payment due date(s).
- Review screen: PDF preview beside editable fields; nothing enters the ledger until admin confirms. Unrecognised docs open the same screen mostly blank (story 16). Duplicate booking-no. warning (story 17).
- AC (grounded in real files): `Ereceipt_from_Hamzah_Travels.pdf` → Trip.com, booking 1433810621882408, MYR 5,508.00, Visa, 3 named passengers, 2 flight legs with dates; `AirBnB Tokyo.pdf` → Airbnb, check-in Sun 29 Nov 4:00 PM, checkout Thu 3 Dec 10:00 AM, RM 7,277.06, Katsushika address. Each of the 8 sample docs parses with ≥ 90% of fields correct.

**Ledger & splits**
- Confirmed documents become expenses; manual expenses can be added without a document. Fields: category, description, vendor, amounts (original currency + MYR), payer, participants + shares (equal-split default, per-person override), date, location, linked document, due dates.
- Balance engine: member owes Σ(their shares of expenses they didn't pay) − Σ(repayments recorded). Views: by trip, by member, by category; sortable "who owes most".
- AC: totals across category view, member view and trip total always reconcile to the sen.

**Payments tracker**
- Admin records repayments: member → payer, amount, date, note; either targeted at specific items or lump sum auto-applied oldest-outstanding-first; per-member statement shows paid/remaining per item.
- AC: a lump sum larger than outstanding leaves a visible credit balance, never a silent loss.

**Currency**
- frankfurter.app historical rate on payment date (cached in D1); store original amount, currency, rate, rate date, MYR value. Manual rate override allowed. In-app JPY↔MYR converter widget.
- AC: an expense dated 3 Dec 2026 in JPY uses the 3 Dec rate (or nearest previous business day), not today's.

**Planner & itinerary**
- Day-by-day view auto-seeded from confirmed flights/stays; admin adds activities (title, day, time, notes, map pin via Leaflet/OSM search, est./actual cost, receipt link, participants all/group/individual). Deep links per leg to Google Maps transit directions; manual fare field flows into the ledger as a transport expense.
- Named participant groups (e.g. "Osaka foodies") reusable across activities.

**Dashboard (per trip)**
- Countdown / Day-N / days-since header (story 18); monthly-weekly-daily calendar of itinerary items; personal private strike-off checklist; money widgets (trip total, per-category donut, top outstanding members, upcoming due dates). Members see their own balance; only admin sees everyone's.

**Rooms**
- Per accommodation: admin defines rooms and drags members/participants in; members see their own room on the dashboard.

**i18n & responsiveness**
- All strings via en/ms dictionaries; per-user language setting; dates/currency localised. Layouts usable from 360 px phones to desktop.

### P1 — Nice to have (Phase 3, during-trip polish)
- **Snap-a-receipt OCR**: photo upload → Tesseract.js (eng+jpn) in-browser → keyword categoriser (e.g. ramen/どんぶり → food) → same review screen. Free, no AI service.
- PWA install + basic offline caching of itinerary for in-transit use.
- Financial insights: burn per day, planned vs actual, per-person trip cost.
- Due-date badge/banner nudges (in-app only; no email).
- CSV export of ledger.

### P2 — Future considerations (design for, don't build)
- Email service (Resend free tier) for invites/resets/due-date reminders — auth designed so email verification can be toggled on.
- Optional AI parser fallback behind the same parser interface (BYO key).
- Split templates ("adults only", "per family unit"), multi-payer expenses.
- Trip sharing in read-only link form for extended family.
- More vendor parsers (AirAsia direct, Klook, Agoda) as real documents appear.

## 7. Architecture (Plan C — All-Cloudflare, RM 0/month)

- **Frontend**: React + Vite SPA on **Cloudflare Pages** (unlimited free static requests). Leaflet + OSM tiles; pdf.js and Tesseract.js run in the browser so the free Worker CPU budget stays untouched.
- **API**: **Pages Functions (Workers)** — free tier 100k requests/day (family usage will be < 1%).
- **DB**: **D1** (SQLite, 5 GB free). Tables: `users, sessions, trips, trip_members, participants, documents, expenses, expense_shares, payments, due_dates, activities, activity_participants, groups, rooms, room_assignments, checklist_items, fx_rates, audit_log`.
- **Files**: **R2** (10 GB free, zero egress fees) for original PDFs/photos, served through an authenticated Worker route.
- **Auth**: hand-rolled (the accepted trade-off of Plan C): scrypt via WebCrypto, constant-time compare, signed HttpOnly SameSite cookies, per-session server-side revocation, rate-limited login. No third-party auth dependency.
- **External free APIs**: frankfurter.app (FX, no key), OSM tile servers (with required attribution), Nominatim (place search, throttled + cached).
- **Backups**: nightly `d1 export` via GitHub Actions (free) to the repo/artifact + R2 lifecycle copy.

**Free-tier watchpoints**: Workers 100k req/day and D1 5M reads/day are ~1000× family scale; the only real limits are R2 10 GB (≈ 7,000 PDFs like yours) and Nominatim rate limits (cached + debounced). No sleep/pause behaviour anywhere — this stack doesn't idle out.

## 8. Success Metrics

- **Leading (first 2 weeks after Phase 1)**: all 8+ existing trip documents ingested; average manual corrections per parsed doc ≤ 2; ledger total matches Sage's manual figure exactly (~RM 24,418 so far); every adult member account created and logged in.
- **Lagging (post-trip, Dec 2026)**: 100% of shared expenses settled or visibly tracked; zero missed instalment due dates; Sage's post-trip reconciliation time < 30 min (vs hours previously); hosting bill RM 0.
- Measurement: in-app counters + audit log; a simple admin "health" page shows docs parsed, correction counts and API usage vs free-tier limits.

## 9. Phasing & Timeline (trip starts Sun 29 Nov 2026 — 13 weeks out)

| Phase | Target | Scope |
|---|---|---|
| **1 — Money engine** | ~20 Sep | Auth, trips, members, upload → parse → review, ledger, splits, payments, currency, document archive. Seeded with the real 8 documents. |
| **2 — Planner & dashboard** | ~25 Oct | Itinerary auto-seed + activities, map + deep links, groups, rooms, calendar, countdown, checklist, money widgets, full BM pass. |
| **3 — During-trip** | ~21 Nov (buffer week before departure) | OCR receipts, PWA/offline itinerary, insights, due-date nudges, CSV export. |

Hard deadline: Phases 1–2 must be usable by **22 Nov** (family briefing week). Phase 3 items degrade gracefully if cut.

## 10. Open Questions (for Sage)

1. **Blocking — none.** Build can start on approval.
2. Product name: keep *Jelajah* or something else? (Affects only branding strings + URL.)
3. URL: free `*.pages.dev` subdomain, or do you want a custom domain (~RM 40–60/yr, the only possible cost)?
4. The KUL→Tokyo receipt covers 3 of 16 pax — do receipts exist for the other travellers' outbound flights to upload later? (Platform handles either way.)
5. ATOME instalment schedule (number of instalments, due dates) — not in the receipts; you'll enter these on the review screen.
6. Member list: how many adult logins to create at launch (names/emails), and are kids tracked as participants-only?

---
*On approval, build begins with Phase 1 on the approved Cloudflare stack, seeded with the Japan trip data above.*
