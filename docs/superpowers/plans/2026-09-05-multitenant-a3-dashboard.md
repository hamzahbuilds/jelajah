# Multitenancy A3 + Admin Dashboard (v0.18) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish leader self-service (any-account trip creation, role editing, leadership transfer, trip deletion) and light up the /admin dashboard screens (metric cards, signups chart, feature usage, referral leaderboard, activity feed) from A2's instrumentation.

**Architecture:** A3 is small server deltas on established machinery (the role endpoint exists; transfer is one atomic batch; deletion is one careful cascade helper) plus People/Trips UI. The dashboard is two admin-only aggregate endpoints reading `users`/`usage_daily`/`audit_log`, a pure series helper (`shared/metrics.ts`) for gap-filling and trend math, and inline-SVG cards on Admin.tsx following the FxWidget/`.barlist` patterns — no chart library.

**Tech Stack:** existing Hono Worker + D1 + KV, React 19, vitest, Playwright e2e.

**Spec:** `docs/06-spec-v0.16-multitenant.md` — Addendum 4 (binding for this release), with Addenda 1–3 as context.

## Global Constraints

- **No git commits** — the user commits via GitHub Desktop. Tasks end at "tests pass".
- No new tables this release; no UPGRADES entries needed (deletion is DML at request time, not migration).
- Money correctness: trip deletion is the ONLY code allowed to remove expense rows, it must be leader-gated with typed confirmation, and it must never touch other trips' rows — every DELETE carries `trip_id = ?` (or a subselect scoped to it).
- Charts: inline SVG only (FxWidget sparkline precedent), `.barlist` for bar lists. No chart library.
- All series: UTC day buckets, zero-filled, presented via `toLocaleDateString` in the viewer's tz (Addendum 3 note).
- All new user-facing strings in BOTH `en` and `ms` in `src/i18n.tsx`.
- Test commands: `npx vitest run` (101 baseline); full e2e ritual (kill workerd AND wrangler parent, sleep 3, `rm -rf .wrangler/state`, `npm run db:local`, `npm run build`, background `npx wrangler dev --port 8788`, poll `/api/health`, `node scripts/e2e.mjs`; full reset every run). Baseline banner `E2E PASSED (v0.6-v0.17)`.
- Version 0.18.0 in the final task only.

**Scope fence:** no per-trip AI keys, no PWA, no rooms allocation, no email, no export of metrics, no changes to the balance engine (deletion removes rows wholesale; it never recomputes).

---

### Task 1: Pure metrics helpers (`shared/metrics.ts`)

**Files:**
- Create: `shared/metrics.ts`
- Test: `tests/metrics.test.ts`

**Interfaces (produced, used by Tasks 4/5):**
- `fillDays(rows: Array<{ day: string; n: number }>, start: string, end: string): Array<{ day: string; n: number }>` — inclusive UTC-day range, zero-filled, input rows may be sparse/unordered; days outside the range dropped.
- `trendPct(current: number, previous: number): number | null` — percentage change rounded to 1 dp; `previous === 0` → `null` (render as "—", never Infinity).
- `lastNDaysUtc(n: number, today?: Date): { start: string; end: string }` — `end` = today's UTC date, `start` = end − (n−1) days.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/metrics.test.ts
import { describe, it, expect } from 'vitest';
import { fillDays, trendPct, lastNDaysUtc } from '../shared/metrics';

describe('metrics', () => {
  it('zero-fills missing days across the range, inclusive', () => {
    expect(fillDays([{ day: '2026-09-03', n: 2 }], '2026-09-01', '2026-09-04')).toEqual([
      { day: '2026-09-01', n: 0 }, { day: '2026-09-02', n: 0 },
      { day: '2026-09-03', n: 2 }, { day: '2026-09-04', n: 0 },
    ]);
  });
  it('orders unordered input and drops out-of-range days', () => {
    const out = fillDays(
      [{ day: '2026-09-02', n: 5 }, { day: '2026-08-31', n: 9 }, { day: '2026-09-01', n: 1 }],
      '2026-09-01', '2026-09-02');
    expect(out).toEqual([{ day: '2026-09-01', n: 1 }, { day: '2026-09-02', n: 5 }]);
  });
  it('single-day range works', () =>
    expect(fillDays([], '2026-09-01', '2026-09-01')).toEqual([{ day: '2026-09-01', n: 0 }]));
  it('trend: +50% and -25%, 1 dp', () => {
    expect(trendPct(15, 10)).toBe(50);
    expect(trendPct(7.5, 10)).toBe(-25);
    expect(trendPct(1, 3)).toBe(-66.7);
  });
  it('trend from zero is null, zero-to-zero is null', () => {
    expect(trendPct(5, 0)).toBeNull();
    expect(trendPct(0, 0)).toBeNull();
  });
  it('lastNDaysUtc: 7 days ending today (UTC)', () => {
    const { start, end } = lastNDaysUtc(7, new Date('2026-09-05T01:00:00Z'));
    expect(end).toBe('2026-09-05');
    expect(start).toBe('2026-08-30');
  });
  it('lastNDaysUtc uses the UTC date even late in a +08 evening', () => {
    // 23:30 in Kuching on Sep 5 is 15:30Z Sep 5 — still Sep 5 in UTC
    const { end } = lastNDaysUtc(1, new Date('2026-09-05T15:30:00Z'));
    expect(end).toBe('2026-09-05');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/metrics.test.ts` → cannot resolve.
- [ ] **Step 3: Implement**

```ts
// shared/metrics.ts
// Dashboard series math (spec Addendum 4). Pure; all days are UTC calendar
// days ("YYYY-MM-DD") to match usage_daily's date('now') buckets.

export function lastNDaysUtc(n: number, today: Date = new Date()): { start: string; end: string } {
  const end = today.toISOString().slice(0, 10);
  const s = new Date(today); s.setUTCDate(s.getUTCDate() - (n - 1));
  return { start: s.toISOString().slice(0, 10), end };
}

export function fillDays(rows: Array<{ day: string; n: number }>, start: string, end: string): Array<{ day: string; n: number }> {
  const byDay = new Map(rows.map(r => [r.day, r.n]));
  const out: Array<{ day: string; n: number }> = [];
  const d = new Date(start + 'T00:00:00Z');
  const stop = new Date(end + 'T00:00:00Z');
  while (d <= stop && out.length < 400) {
    const day = d.toISOString().slice(0, 10);
    out.push({ day, n: byDay.get(day) ?? 0 });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** % change to 1 dp; null when there is no previous baseline. */
export function trendPct(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
```

- [ ] **Step 4: Verify** — `npx vitest run` green (101 + 8), `npx tsc -b` clean.

---

### Task 2: A3 server — open trip creation, transfer, deletion cascade

**Files:**
- Modify: `server/app.ts`

**Interfaces (produced):**
- `POST /trips` — guard becomes plain authentication (drop `requireAdmin`): any user creates a trip; after the INSERT, ensure the creator has a participant (`users.participant_id`; create + link one named after them when null) and insert `trip_members (trip_id, participant_id, role) VALUES (?,?, 'leader')`. Response unchanged `{ id }`. Audit `trip_create`.
- `POST /trips/:id/transfer` (leader) body `{ participant_id }` → target must be a member with a linked user account (`bad 'no_account'` otherwise); atomic `env.DB.batch`: target row → `'leader'`, caller's own membership row → `'editor'`. Refuse transferring to yourself (`bad 'self'`). Audit `leadership_transfer`. → `{ ok: true }`.
- `DELETE /trips/:id` (leader) body `{ confirm: string }` — must equal the trip's exact name (`bad 'confirm_mismatch'` otherwise). Deletes KV files first (loop `SELECT r2_key FROM documents WHERE trip_id = ?` → `filesDelete`), then one `env.DB.batch` of scoped DELETEs in child-first order:
  `activity_participants` (via `activity_id IN (SELECT id FROM activities WHERE trip_id=?)`), `activities`, `group_members` (via groups subselect), `groups`, `day_settings`, `day_budgets`, `day_notes`, `leg_overrides`, `import_profiles`, `personal_shares` (via `personal_expenses` subselect), `personal_expenses`, `due_dates` (via expenses subselect), `payments`, `expense_shares` (via expenses subselect), `expenses`, `documents`, `invites` (kind='trip' and trip_id=?), `trip_members`, finally `trips`. Every statement binds the trip id. Audit `trip_delete` BEFORE the batch (the trip name goes into the action string since the row will be gone). → `{ ok: true }`.
- NOTE: consult the actual schema for exact child tables/columns (`server/lib/schema.ts`) — the list above was drawn from it; if a trip-scoped table exists that the list misses, delete from it too and say so in the report.

- [ ] **Step 1: Implement the three route changes** per Interfaces (transfer + delete go next to the members/role routes).
- [ ] **Step 2: Verify** — `npx tsc -b` clean, `npx vitest run` green. (Behaviour proven in Task 6's e2e.)

---

### Task 3: A3 UI — role editing, transfer, deletion, open creation

**Files:**
- Modify: `src/pages/People.tsx`, `src/pages/Trips.tsx`, `src/i18n.tsx`, `src/styles.css`

**Interfaces:**
- Trips.tsx: the New-trip button's `user.role === 'admin'` gate is REMOVED — every account may create (server now allows it).
- People.tsx (leader view):
  - The member role chip becomes a `<select>` for members with accounts (values leader/editor/viewer, current preselected) wired to `PATCH /trips/:id/members/:pid/role`; on `last_leader` error show `t.lastLeaderMsg` toast. Account-less travellers keep no control.
  - A "⤵ {t.transferLead}" action per non-self leaderable member (accounts only): confirm dialog (`window.prompt` typed trip name is NOT needed here — a `window.confirm` with `t.transferConfirm(name)` suffices), then `POST /trips/:id/transfer`; on success `reload()` — the caller is now editor and the page will re-gate itself.
  - A "🗑 {t.deleteTrip}" danger card at the bottom: text input where the leader types the trip name + delete button enabled only on exact match → `DELETE /trips/:id` with `{ confirm }` → navigate to `/` with toast.
- i18n keys (EN + MS): `transferLead: 'Make leader & step down'`, `transferConfirm: (n: string) => `Hand leadership of this trip to ${n}? You will become an editor.``, `lastLeaderMsg: 'A trip needs at least one leader.'`, `deleteTrip: 'Delete this trip'`, `deleteTripHint: (n: string) => `Type “${n}” to confirm. This removes every plan, expense and document of the trip — there is no undo.``, `tTripDeleted: 'Trip deleted'`, `tLeadershipMoved: 'Leadership transferred'`.

- [ ] **Step 1: Implement** per Interfaces. Small CSS: a `.danger-card { border: 1px solid #fecaca; }` block if nothing suitable exists.
- [ ] **Step 2: Trip details card (Addendum 4a)** — a "📝 {t.tripDetails}" card on People (leader view, above the danger card): inputs for name (required), destination, start_date, end_date (type=date) pre-filled from the trip ctx; Save → `api.patch(`/trips/${tripId}`, { name, destination, start_date, end_date })` → `reload()` + toast. Client-side guard: end_date must be ≥ start_date (`t.badDateRange` toast, no request). NO warning machinery for shrinking ranges — the Plan page already shows out-of-range activity days as extra chips (days = trip range ∪ activity days), which is the designed no-silent-loss behaviour; say so in a `tiny` hint line (`t.tripDatesHint`). i18n (EN + MS): `tripDetails: 'Trip details'`, `tripDatesHint: 'Shortening the dates never deletes anything — days that still have activities keep showing on the plan.'`, `badDateRange: 'End date must be after the start date.'`, `tTripUpdated: 'Trip updated'`.
- [ ] **Step 3: Verify** — `npx tsc -b`, `npm run build`, `npx vitest run` clean.

---

### Task 4: Dashboard endpoints (`GET /admin/stats`, `GET /admin/referrals`)

**Files:**
- Modify: `server/app.ts`

**Interfaces (produced; both `requireAdmin`):**
- `GET /admin/stats` →
```jsonc
{
  "signups": [{ "day": "2026-08-07", "n": 0 }, …],       // 30 zero-filled UTC days (users.created_at)
  "active7": 3, "active7Prev": 2,                          // COUNT(DISTINCT user_id) usage_daily, current vs prior 7-day window
  "active30": 5,
  "trips": 4,                                              // COUNT(*) trips
  "mcp30": 12,                                             // SUM(count) usage_daily feature='mcp_call' last 30d
  "features": [{ "feature": "plan_view", "n": 44 }, …],   // SUM(count) by feature, last 30d, desc
  "audit": [{ "action": "login", "user": "Hamzah", "at": "…" }, …]  // last 20, joined to users.name (nullable)
}
```
  Implementation: `lastNDaysUtc`/`fillDays` from `../shared/metrics` (import at top); signups via `SELECT substr(created_at,1,10) AS day, COUNT(*) n FROM users GROUP BY day` filtered to the window; actives via `COUNT(DISTINCT user_id) FROM usage_daily WHERE day BETWEEN ? AND ?`.
- `GET /admin/referrals` → `[{ "user_id": 2, "name": "Join Test", "referred": 3, "first_at": "…" }, …]` — `SELECT u.referred_by, COUNT(*) …, MIN(r.created_at)` grouped, joined to the referrer's name, ordered by count desc then first_at asc; users with zero referrals omitted.

- [ ] **Step 1: Implement both routes** (place after the invite section, banner `/* v0.18 — admin dashboard */`).
- [ ] **Step 2: Verify** — `npx tsc -b` clean, `npx vitest run` green.

---

### Task 5: Dashboard UI on /admin

**Files:**
- Modify: `src/pages/Admin.tsx`, `src/i18n.tsx`, `src/styles.css`

**Interfaces:** consumes Task 4's two endpoints. The dashboard section renders ABOVE the existing management cards.

- [ ] **Step 1: Metric cards row** — four `.stat`-style cards (follow Dashboard.tsx's `.stats` pattern): `t.mSignups30` (sum of signups series) · `t.mActive7` with trend badge `trendPct(active7, active7Prev)` rendered `▲ x%` / `▼ x%` / `—` (null) + `t.mVsPrev7` caption · `t.mTrips` · `t.mMcp30`.
- [ ] **Step 2: Signups chart** — inline SVG bar chart, 30 bars, height 60, bar width from viewBox math (FxWidget's Sparkline is the precedent; bars not lines); x-axis labels only first/last day via `toLocaleDateString` (viewer tz); brand-colored bars (`var(--data)`).
- [ ] **Step 3: Feature usage** — `.barlist` rows (Dashboard.tsx precedent): feature label (humanized: `plan_view` → "Plan views" via a small `FEATURE_LABELS` map with i18n EN/MS values; unknown features fall back to the raw key), bar scaled to max, count.
- [ ] **Step 4: Referral leaderboard** — simple table: name · referred count · since (localized date). Empty state `t.mNoReferrals`.
- [ ] **Step 5: Activity feed** — last-20 list: `action · user · toLocaleString(at)`, muted, no pagination.
- [ ] **Step 6: i18n** (EN + MS): `mDashboard: 'Dashboard'`, `mSignups30: 'Signups (30d)'`, `mActive7: 'Active users (7d)'`, `mVsPrev7: 'vs previous 7 days'`, `mTrips: 'Trips'`, `mMcp30: 'MCP calls (30d)'`, `mFeatureUsage: 'Feature usage (30d)'`, `mReferrals: 'Referral leaderboard'`, `mNoReferrals: 'No referrals yet — share your links!'`, `mActivity: 'Recent activity'`, + the `FEATURE_LABELS` map values.
- [ ] **Step 7: Verify** — `npx tsc -b`, `npm run build`, `npx vitest run` clean.

---

### Task 6: BM pass over the A2/A3 flows

**Files:**
- Modify: `src/i18n.tsx` only

- [ ] **Step 1: Audit** — read the `ms` object entries for every key added in v0.17–v0.18 (join*, invite*, referral*, admin/dashboard m*, role*, transfer/delete keys) against their `en` twins. Fix: missing twins (TypeScript would catch), literal English left in `ms`, awkward register (the file's convention: informal-polite BM, "anda" for you, no Indonesian loanwords). List every changed key + before/after in the report.
- [ ] **Step 2: Verify** — `npx tsc -b`, `npx vitest run` green (type parity is the net).

---

### Task 7: E2E, docs, release

**Files:**
- Modify: `scripts/e2e.mjs`, `docs/build-status.md`, `package.json` (version)

- [ ] **Step 1: New e2e journeys** (extend the A2 invite-flow block — the joiner/referral contexts already exist there):
  1. **Any-account creation:** the referral-registered user (no trips) creates a trip via the Trips UI (name "Solo Getaway") → `/api/me` shows it with `my_role: 'leader'`; their People page renders (no 403s); trip 1 remains invisible to them.
  2. **Role editing UI:** on trip 1 as admin, change the joiner's role via the People select editor→viewer→editor; assert each via `/api/me` from the joiner context.
  3. **Transfer:** on "Solo Getaway", its leader invites + admits nobody — instead use trip 1? No: transfer needs two accounts on one trip — use trip 1: admin transfers leadership to the joiner (confirm dialog — add a `page.on('dialog')` accept handler scoped to this step), assert admin's `my_role` on trip 1 is now `editor` and joiner's is `leader`; then the joiner transfers it BACK so later steps see the original state; assert restored.
  4. **Deletion:** the referral user deletes "Solo Getaway" via the danger card (type the name); assert their `/api/me` shows zero trips again and `GET /api/trips/<id>` → 404/403; assert trip 1 untouched (`/api/trips/1` still 200 for admin).
  5. **Dashboard:** admin opens /admin → assert the four metric cards render with numeric values, the signups SVG has ≥1 bar with height > 0, the feature-usage list contains "Plan views", the referral leaderboard names the joiner with count ≥ 1, activity feed non-empty.
  6. **Trip dates edit (Addendum 4a):** as admin on trip 1's People page, extend end_date by one day via the Trip details card → Plan page shows one more D-chip; set it back → chip count restored; assert an activity-bearing day outside a (temporarily) shortened range still renders its chip (no silent loss), then restore the original dates exactly.
  7. **BM smoke:** switch the joiner's context to MS (the language select in the topbar), open the join page of a fresh invite → assert a known MS string renders (e.g. the ms `joinRegister` value); switch back.
- [ ] **Step 2: Banner** → `E2E PASSED (Phase 1 + 2 + v0.6-v0.18)`.
- [ ] **Step 3: Full verification** — vitest green; full e2e ritual → PASSED.
- [ ] **Step 4: Release** — `npm pkg set version=0.18.0`; build-status v0.18 entry: A3 (open creation, role UI, transfer, deletion cascade incl. KV files), dashboard screens (cards/chart/usage/referrals/feed, UTC buckets rendered local), BM pass summary (keys touched), remaining backlog now = rooms allocation, PWA/offline, insights beyond the dashboard, full-app BM audit. Owner post-deploy check: open /admin (dashboard populated), change a family member's role and back, create + delete a throwaway trip, check the referral leaderboard shows the A2 test era only if those accounts persist.

---

## Self-review notes

- Addendum 4 coverage: open creation ✔ (T2/T3), role UI ✔ (T3), atomic transfer ✔ (T2/T3), deletion cascade incl. KV ✔ (T2/T3), BM pass ✔ (T6), metric cards + trend ✔ (T4/T5), signups chart ✔ (T5), feature usage ✔ (T5), referral leaderboard ✔ (T4/T5), activity feed ✔ (T4/T5), UTC→local rendering ✔ (T1/T5), endpoints admin-only ✔ (T4).
- Deletion list cross-checked against schema.ts trip_id references; T2 carries the instruction to re-verify against the live schema and extend if a table is missed.
- Transfer restores state in e2e so downstream steps are unaffected (T7S1.3).
- Addendum 4a covered: Trip details card (T3S2), server pre-existing PATCH verified, e2e chip-count round-trip (T7S1.6).
- Type consistency: `fillDays/trendPct/lastNDaysUtc` named identically in T1 exports, T4 imports, T5 trend rendering; stats JSON field names match between T4 shape and T5 consumption.
