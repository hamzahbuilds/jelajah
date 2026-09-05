# v0.20 Covers + Theme + Mobile e2e Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Ship spec v0.20 — trip photo covers (upload + keyless destination auto-fetch), server-side theme preference, mobile-chrome e2e coverage, /join BM — on the existing stack, e2e green.

**Spec:** docs/08-spec-v0.20-covers-theme.md (binding).

## Global Constraints

RM0: no new deps, no keys — Wikipedia REST only, called server-side; bytes stored in FILES KV, never hotlinked. Schema changes in BOTH `SCHEMA` and `UPGRADES` (idempotent try/catch ADD COLUMN pattern — copy the repo's existing one). Money/roles untouched; cover + theme writes leader/self gated as spec says. t() EN+BM. Icons via <Icon>. Dark overrides. No commits (Sage commits). vitest+tsc+build per task; FULL e2e ritual at final task (`E2E PASSED` required), kill pattern `ps aux | grep -E "[w]orkerd|[n]ode.*wrangler"`. /join logic security-frozen (strings/markup only). Pre-paint theme script untouched.

---

### Task 1: Server — schema + theme PATCH + cover endpoints

**Files:** Modify `server/lib/schema.ts` (SCHEMA: `trips.cover_key TEXT`, `trips.cover_credit TEXT`, `users.theme TEXT NOT NULL DEFAULT ''`; UPGRADES: three idempotent ADD COLUMNs), `server/app.ts`.
**Interfaces produced:** PATCH /me accepts `theme` ∈ {'','dark','system'} (mirror the lang guard exactly); GET /me user payload includes `theme`. Cover routes per spec §1 (GET member-gated via tripRole, PUT/POST auto/DELETE leader via requireLeader; PUT reads raw body `await c.req.arrayBuffer()`, reject >600KB or non-image/* content-type; auto: fetch `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(destination)}`, take `thumbnail.source`, fetch bytes, filesPut `cover/<tripId>`, save cover_credit = `${title} · Wikipedia` + store page url in credit string; 404 when no thumbnail; DELETE filesDelete + null columns). trackUsage('cover_set') on PUT/auto. GET streams with `Content-Type` from KV metadata + `Cache-Control: private, max-age=86400`.
- [ ] Schema both places; `npm run db:local` applies clean.
- [ ] Endpoints; audit() on writes like sibling endpoints.
- [ ] tsc/build/vitest green (no unit-test additions here — server is e2e-tested per repo convention).

### Task 2: Client — theme sync + Settings PATCH

**Files:** `src/App.tsx` (after /me resolves: if `user.theme` differs from `getThemePref()`, `setThemePref(user.theme)`), `src/pages/Settings.tsx` (pick() also `api.patch('/me', { theme: v })`), `src/theme.ts` unchanged.
- [ ] Sync effect (once per session load, not per re-render).
- [ ] tsc/vitest/build; manual: set dark on device A-sim (second browser profile) → login elsewhere follows.

### Task 3: Client — covers UI

**Files:** `src/pages/Trips.tsx` (card cover: `trip.cover_key ? <img src={/api/trips/${id}/cover?v=hash}> : gradient` — keep gradient overlay for text legibility), `src/pages/TripShell.tsx` (subtle header backdrop when cover present), `src/pages/People.tsx` trip-details card (leader controls: Upload — file input → canvas resize ≤1280px JPEG quality .82 → PUT; "Use destination photo" btn → POST auto → toast result; Remove → DELETE; credit line rendered small with link when cover_credit), `src/lib/image.ts` (pure `fitWithin(w,h,max)` + tested), `tests/image.test.ts`, `src/i18n.tsx` keys en+ms.
- [ ] TDD fitWithin (landscape/portrait/smaller-than-max cases).
- [ ] UI per spec; cover img `loading="lazy"`, alt = trip name; 44px controls; dark-safe.
- [ ] tsc/vitest/build; e2e selectors on Trips/People checked.

### Task 4: /join BM + mobile e2e + full ritual + closeout

**Files:** `src/pages/Join.tsx` + `src/i18n.tsx` (audit hardcoded EN strings → keys en+ms; logic frozen), `scripts/e2e.mjs` (new mobile section per spec §3 + cover upload/render step using a generated 1px fixture via Buffer, + theme PATCH assert via /me), `docs/build-status.md`.
- [ ] Join i18n (keys like joinErrGeneric etc. — read the page for the exact EN-only spots).
- [ ] e2e mobile section ~10 steps + cover step + theme server-sync step; FULL ritual to `E2E PASSED`.
- [ ] build-status: v0.20 shipped; deferred list restated.

## Self-review notes
- Theme CHECK constraint: old SQLite rows predate the column — ADD COLUMN with DEFAULT '' is safe; CHECK included in SCHEMA (fresh DBs) but UPGRADES adds without CHECK (SQLite can't add CHECK via ALTER) — app-side guard in PATCH covers it; noted so reviewers don't flag drift.
- Cover GET auth via trip membership matches document-serving precedent (verify in T1 how document GET gates and mirror it).
- Wikipedia REST returns 403 for bot-y UAs occasionally — set a descriptive `User-Agent` header (allowed, keyless).
