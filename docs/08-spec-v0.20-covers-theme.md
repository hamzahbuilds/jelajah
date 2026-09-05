# Spec v0.20 — Trip Covers, Server-side Theme, Mobile e2e

**Status:** draft for Sage review · 6 Sep 2026
**Scope:** the three concrete backlog items recorded at v0.19 closeout, plus the /join BM debt. Rooms allocation and PWA/offline are OUT (each needs its own brainstorm+spec). Licensed auth-carousel photos OUT (needs Sage's photo picks — gradients remain until then).

## 1 · Trip photo covers

**What:** a trip can have a cover image. Two sources: (a) leader uploads a photo; (b) one-tap "Use a destination photo" that fetches a free image for the trip's destination. Covers show on the Trips grid (replacing the gradient when present; gradient+emoji stays the fallback) and as a subtle header backdrop in TripShell.

**Storage:** reuse the existing `FILES` KV adapter (`filesPut/filesGet/filesDelete`). Key: `cover/<tripId>`. Client resizes/compresses before upload (canvas → JPEG/WebP, max 1280px wide, target ≤300KB); server enforces ≤600KB and content-type image/*.

**Auto-fetch (keyless, RM0):** server endpoint calls Wikipedia REST `GET https://en.wikipedia.org/api/rest_v1/page/summary/<destination>` (fallback `ms.wikipedia.org` skipped — EN summary is fine for photos), takes `thumbnail.source` (~640px), downloads it server-side, stores bytes in KV under the same key. No hotlinking (privacy + reliability). If no page/thumbnail found → 404, UI toasts "no photo found, upload one instead". Attribution: store `cover_credit` (page title + "via Wikipedia") and render a small credit line in the trip settings card, linking the page URL. One subrequest per fetch; cached forever in KV until replaced.

**Schema (SCHEMA + UPGRADES, idempotent):** `trips.cover_key TEXT` (KV key when set), `trips.cover_credit TEXT` (nullable). No data migration needed.

**API:** `GET /api/trips/:id/cover` → streams KV bytes (auth: trip member; cache-control long, versioned query param client-side on change) · `PUT /api/trips/:id/cover` (leader; raw body upload) · `POST /api/trips/:id/cover/auto` (leader; does the Wikipedia fetch) · `DELETE /api/trips/:id/cover` (leader; back to gradient). All tracked via `trackUsage`.

**GUARDRAILS:** leader-only writes; member-only reads; the Wikipedia call happens server-side only (no client CORS shenanigans); upload size enforced server-side; no external URL ever stored/rendered directly (bytes only); e2e covers the upload-and-render path with a tiny fixture image.

## 2 · Server-side theme preference

**What:** theme follows the user across devices. `users.theme TEXT NOT NULL DEFAULT '' CHECK (theme IN ('','dark','system'))` (SCHEMA + UPGRADES idempotent add-column with the repo's try/catch pattern; CHECK enforced app-side on old rows).

**Flow:** PATCH `/me` accepts `theme` (same shape as the existing `lang` handling). `/me` returns it. Client: on session load, if server theme ≠ localStorage `jl-theme`, server wins → `setThemePref(serverValue)`. Settings seg control now calls PATCH too (localStorage stays the pre-login/instant path; login/auth pages keep device pref). Logout keeps device value (no flash).

**GUARDRAIL:** the pre-paint script is untouched (still reads localStorage — server sync happens after hydration, applying only when different, so no flash and no extra request).

## 3 · Mobile-chrome e2e coverage

New e2e section (desktop suite untouched): 390×844 context — asserts tab bar visible + sidebar hidden; taps Money tab → ledger; opens More sheet → Settings; long-press (pointerdown, 600ms wait, pointerup) on Plan tab → trip-switch sheet lists seeded trip; theme seg in Settings flips `data-theme` and persists through reload (now also asserting the PATCH landed via a second context? no — assert localStorage + html attr only; server assert via /me fetch). Keep it ~10 steps, appended to `scripts/e2e.mjs` behind the existing pass so `E2E PASSED` line covers it.

## 4 · /join Bahasa Malaysia

The join page's existing `t.*` keys get proper `ms` values where missing, and the page renders via the same lang toggle as login (it already imports useT — audit which strings were EN-hardcoded vs keyed; convert hardcoded ones to keys en+ms). Security-frozen logic untouched — strings/markup only. (Deliberately unfreezes the earlier "EN-only" deferral.)

## 5 · Explicitly deferred (recorded, untouched)

`api.del` body support (no current consumer), MySpend fx race ticket (needs its own repro + fix plan), rooms allocation, PWA/offline, licensed carousel/cover stock photos.

## Cross-cutting

RM0 (Wikipedia REST is keyless/free; KV within free tier — a 300KB cover × dozens of trips is nothing); t() EN+BM for every new string; leader-vs-member gating via existing `tripRole`; schema changes follow SCHEMA+UPGRADES idempotency; 148 unit tests + full e2e ritual green at the end; no new deps (canvas resize is vanilla).
