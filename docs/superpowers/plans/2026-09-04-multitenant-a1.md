# Multitenancy Phase A1 (v0.16) Implementation Plan — roles under the hood

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the global admin/member split with per-trip Leader/Editor/Viewer roles plus a platform-admin flag — with a one-time data migration — while the live app behaves identically for the current family.

**Architecture:** A pure role module (`server/lib/roles.ts`) feeds three things: a data-migration runner that backfills `trip_members.role` once; server middleware (`requireLeader`/`requireEditor`) that replaces every `requireAdmin` on trip-scoped routes; and a `myRole` field on `/me` that drives all client gating through the TripShell context. MCP and AI context swap the same way. No new pages, no invites yet (A2).

**Tech Stack:** existing Hono Worker + D1, React 19, vitest, Playwright e2e.

**Spec:** `docs/06-spec-v0.16-multitenant.md` (capability matrix + migration are binding; Addendum 1 [referrals] lands in A2, NOT here)

## Global Constraints

- **No git commits** — the user commits via GitHub Desktop. Tasks end at "tests pass".
- Schema DDL in BOTH `SCHEMA` and `UPGRADES` (idempotent DDL only there). Data backfill goes through the NEW one-time migration runner, never UPGRADES.
- Behaviour freeze for the family: after migration, Hamzah (role='admin') can do everything he could; family members can do exactly what they could (view; plan-edit only where `member_can_edit_plan` was on). The full pre-existing e2e suite passing IS the migration test.
- Money correctness sacred: `computeBalances`, expense storage, splits untouched. Money writes = leader-only (spec matrix).
- All new user-facing strings in BOTH `en` and `ms` in `src/i18n.tsx` (A1 adds almost none).
- Test commands: `npx vitest run`; full e2e ritual: kill workerd (`pgrep -f "workerd|wrangler dev" | xargs kill -9`), `rm -rf .wrangler/state`, `npm run db:local`, `npm run build`, background `npx wrangler dev --port 8788`, poll `/api/health`, `node scripts/e2e.mjs`. A partial e2e run changes the admin password — always full reset before a run.
- Version 0.16.0 in the final task only. `main` branch.

**A1 scope fence:** no invites, no join/register pages, no referral columns, no role-picker UI, no any-account trip creation (POST /trips stays platform-admin until A3). The ONLY new endpoints are `PATCH /trips/:id/members/:pid/role` and the reworked `member_can_edit_plan` semantics below.

---

### Task 1: Role module + schema + one-time migration runner

**Files:**
- Create: `server/lib/roles.ts`
- Test: `tests/roles.test.ts`
- Modify: `server/lib/schema.ts` (trip_members CREATE TABLE + UPGRADES)
- Modify: `server/app.ts` (extend the existing lazy-upgrade middleware, ~line 42)

**Interfaces (produced, used by every later task):**
- `type TripRole = 'leader' | 'editor' | 'viewer'`
- `const ROLE_RANK: Record<TripRole, number>` — viewer 0, editor 1, leader 2
- `atLeast(role: TripRole | null, min: TripRole): boolean`
- `migratedRole(m: { isAdminUser: boolean; hasAccount: boolean; memberCanEditPlan: boolean }): TripRole`
- `runDataMigrations(env: Env): Promise<void>` in app.ts, executed once per deploy via `app_settings.data_migrations`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/roles.test.ts
import { describe, it, expect } from 'vitest';
import { ROLE_RANK, atLeast, migratedRole } from '../server/lib/roles';

describe('roles', () => {
  it('ranks leader > editor > viewer', () => {
    expect(ROLE_RANK.leader).toBeGreaterThan(ROLE_RANK.editor);
    expect(ROLE_RANK.editor).toBeGreaterThan(ROLE_RANK.viewer);
  });

  it('atLeast: exact and above pass, below and null fail', () => {
    expect(atLeast('leader', 'editor')).toBe(true);
    expect(atLeast('editor', 'editor')).toBe(true);
    expect(atLeast('viewer', 'editor')).toBe(false);
    expect(atLeast(null, 'viewer')).toBe(false);
  });

  // the m001 mapping table from the spec, one test per row
  it('admin user becomes leader regardless of flags', () => {
    expect(migratedRole({ isAdminUser: true, hasAccount: true, memberCanEditPlan: false })).toBe('leader');
  });
  it('account holder on an editable-plan trip becomes editor', () => {
    expect(migratedRole({ isAdminUser: false, hasAccount: true, memberCanEditPlan: true })).toBe('editor');
  });
  it('account holder on a locked-plan trip becomes viewer', () => {
    expect(migratedRole({ isAdminUser: false, hasAccount: true, memberCanEditPlan: false })).toBe('viewer');
  });
  it('account-less traveller is viewer either way', () => {
    expect(migratedRole({ isAdminUser: false, hasAccount: false, memberCanEditPlan: true })).toBe('viewer');
    expect(migratedRole({ isAdminUser: false, hasAccount: false, memberCanEditPlan: false })).toBe('viewer');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/roles.test.ts` → cannot resolve module.

- [ ] **Step 3: Implement the pure module**

```ts
// server/lib/roles.ts
// Per-trip roles (spec: docs/06-spec-v0.16-multitenant.md).
// Pure — no Env, no D1 — so the migration mapping and rank logic are unit-testable.

export type TripRole = 'leader' | 'editor' | 'viewer';
export const ROLE_RANK: Record<TripRole, number> = { viewer: 0, editor: 1, leader: 2 };

export function atLeast(role: TripRole | null, min: TripRole): boolean {
  return role != null && ROLE_RANK[role] >= ROLE_RANK[min];
}

/** m001 backfill: how a pre-multitenant membership maps to a role. */
export function migratedRole(m: { isAdminUser: boolean; hasAccount: boolean; memberCanEditPlan: boolean }): TripRole {
  if (m.isAdminUser) return 'leader';
  if (m.hasAccount && m.memberCanEditPlan) return 'editor';
  return 'viewer';
}
```

- [ ] **Step 4: Schema** — in `server/lib/schema.ts`, trip_members becomes:

```sql
  `CREATE TABLE IF NOT EXISTS trip_members (
    trip_id INTEGER NOT NULL REFERENCES trips(id),
    participant_id INTEGER NOT NULL REFERENCES participants(id),
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('leader','editor','viewer')),
    PRIMARY KEY (trip_id, participant_id)
  )`,
```

and `UPGRADES` gains (after the watch_currencies line):

```ts
  `ALTER TABLE trip_members ADD COLUMN role TEXT NOT NULL DEFAULT 'viewer'`,
```

(SQLite ignores the CHECK on ALTER-added columns; the CHECK lives in fresh installs, the code validates everywhere else.)

- [ ] **Step 5: Migration runner** — in `server/app.ts`, extend the existing once-per-isolate middleware (the `let upgraded = false;` block, ~line 42):

```ts
import { migratedRole } from './lib/roles';

/** One-time data migrations — run exactly once per deploy, recorded in app_settings.
 *  UPGRADES cannot hold these: its statements re-run on every cold isolate. */
async function runDataMigrations(env: Env): Promise<void> {
  const applied: string[] = (await getSettingJSON<string[]>(env, 'data_migrations')) ?? [];
  if (!applied.includes('m001-trip-roles')) {
    const rows = await env.DB.prepare(
      `SELECT tm.trip_id, tm.participant_id, t.member_can_edit_plan,
              u.id AS user_id, u.role AS user_role
       FROM trip_members tm
       JOIN trips t ON t.id = tm.trip_id
       LEFT JOIN users u ON u.participant_id = tm.participant_id`,
    ).all();
    const stmts = (rows.results as any[]).map(r => env.DB.prepare(
      'UPDATE trip_members SET role = ? WHERE trip_id = ? AND participant_id = ?',
    ).bind(migratedRole({
      isAdminUser: r.user_role === 'admin',
      hasAccount: r.user_id != null,
      memberCanEditPlan: !!r.member_can_edit_plan,
    }), r.trip_id, r.participant_id));
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
    applied.push('m001-trip-roles');
    await setSettingJSON(env, 'data_migrations', applied);
  }
}
```

and call it inside the middleware right after the UPGRADES loop (still under the same `if (!upgraded)` guard), wrapped in try/catch that logs to audit best-effort but never blocks the request — a failed migration retries on the next cold start because the id was not recorded.

NOTE: `getSettingJSON`/`setSettingJSON` are defined later in the file (~line 1319) — hoist them ABOVE the middleware (move the two functions up, next to `audit`), do not duplicate them.

- [ ] **Step 6: Verify** — `npx vitest run` green (87 + 6 new), `npx tsc -b` clean.

---

### Task 2: Server authority swap (the 34 routes + 14 inline checks)

**Files:**
- Modify: `server/app.ts` only

**Interfaces (produced):**
- `tripRole(env, user, tripId): Promise<TripRole | null>` — platform admin ⇒ 'leader'; else the membership row's role via `users.participant_id`; null when not a member.
- Middleware factories `requireLeader` and `requireEditor` for routes whose trip id is `c.req.param('id')`; for routes keyed by child id (expense/payment/document/etc.) the handler resolves the trip id first and calls `await needRole(c, tripId, 'leader'|'editor')`.
- `PATCH /trips/:id/members/:pid/role` (leader) — body `{ role: 'leader'|'editor'|'viewer' }`; refuses demoting the LAST leader (`last_leader`); audits `role_change`.
- `PATCH /trips/:id` handling of `member_can_edit_plan`: still accepted, but now ALSO bulk-updates roles — every non-leader membership with a linked account becomes `editor` (flag true) or `viewer` (flag false). Column keeps being written for back-compat; nothing reads it for authorization anymore.

- [ ] **Step 1: Add the helpers** (below `requireAdmin`, which STAYS for platform-admin routes):

```ts
import { TripRole, atLeast } from './lib/roles';

/** Effective role of this user on this trip. Platform admin ⇒ leader everywhere. */
async function tripRole(env: Env, user: SessionUser, tripId: number): Promise<TripRole | null> {
  if (user.role === 'admin') return 'leader';
  if (!user.participant_id) return null;
  const row = await env.DB.prepare(
    'SELECT role FROM trip_members WHERE trip_id = ? AND participant_id = ?',
  ).bind(tripId, user.participant_id).first<any>();
  return (row?.role as TripRole) ?? null;
}

async function needRole(c: any, tripId: number, min: TripRole): Promise<boolean> {
  return atLeast(await tripRole(c.env, c.get('user'), tripId), min);
}

const requireRole = (min: TripRole) => async (c: any, next: any) => {
  if (!(await needRole(c, Number(c.req.param('id')), min))) return bad(c, 'forbidden', 403);
  return next();
};
const requireLeader = requireRole('leader');
const requireEditor = requireRole('editor');
```

- [ ] **Step 2: Swap the trip-scoped `requireAdmin` routes** — exactly this table (line numbers as of v0.15; locate by route string):

| Route | New guard |
|---|---|
| `PATCH /trips/:id` (~276) | requireLeader (+ the member_can_edit_plan bulk-role rework above) |
| `PUT /trips/:id/members` (~290) | requireLeader |
| `POST /trips/:id/documents` (~315) | requireLeader |
| `DELETE /documents/:id` (~369) | resolve doc→trip, needRole leader |
| `POST /documents/:id/confirm` (~432) | resolve doc→trip, needRole leader |
| `POST /trips/:id/expenses` (~469) | requireLeader |
| `PUT /expenses/:id` (~479) | resolve expense→trip, needRole leader |
| `DELETE /expenses/:id` (~509) | resolve expense→trip, needRole leader |
| `POST /trips/:id/payments` (~532) | requireLeader |
| `DELETE /payments/:id` (~544) | resolve payment→trip, needRole leader |
| `PATCH /expenses/:id/status` (~643) | resolve→trip, needRole leader |
| `PATCH /expenses/:id/coords` (~821) | resolve→trip, needRole leader |
| `PATCH /duedates/:id` (~1247) | resolve duedate→expense→trip, needRole leader |
| `PUT /trips/:id/daybudgets` (~1124) | requireLeader |
| `DELETE /trips/:id/daybudgets/:day` (~1139) | requireLeader |
| `POST /trips/:id/groups` (~1213) | requireLeader |
| `DELETE /groups/:id` (~1224) | resolve group→trip, needRole leader |
| `PATCH /trips/:id/currencies` (~1412) | requireLeader |
| `PUT /trips/:id/daysettings` (~780) | requireEditor (day titles/start-end = plan editing) |
| `DELETE /trips/:id/daysettings/:day` (~799) | requireEditor |
| `PUT /trips/:id/legs` (~805) | requireEditor |
| `GET+POST /trips/:id/importprofiles` (~1145,1151) | requireEditor |
| `POST /trips/:id/activities/bulk` (~1161) | requireEditor |

Stay `requireAdmin` (platform-level, untouched): `/participants` GET/POST/PATCH, `/users` GET/POST/PATCH, `POST /trips`, `/settings/ai` GET/PUT/test. (Spec's leader-scoped participants happens in A2 with the People rework; A1 keeps these admin-only, which is strictly no worse than today.)

- [ ] **Step 3: The 14 inline `role === 'admin'` server checks** — map each (grep `role === 'admin'` in server/app.ts): `assertTripAccess`'s admin bypass stays (platform admin); `hiddenFor`/`assistantHidden`/`mcpHidden` bypass becomes `atLeast(await tripRole(...), 'leader')`; `canEditPlan`/`canEditActivity` become `needRole(c, tripId, 'editor')` and STOP reading `member_can_edit_plan`; balances/duedates/myspend/tripContext "admin sees all" filters become leader-sees-all via `tripRole`. Where a check guards a PLATFORM concern (user management, AI settings), it stays `user.role === 'admin'`. Every conversion must preserve: platform admin passes everything.

- [ ] **Step 4: Add `PATCH /trips/:id/members/:pid/role`** per the Interfaces block, with the last-leader guard:

```ts
app.patch('/trips/:id/members/:pid/role', requireLeader, async c => {
  const tripId = Number(c.req.param('id')), pid = Number(c.req.param('pid'));
  const b = await c.req.json<any>();
  const role = String(b.role) as TripRole;
  if (!['leader', 'editor', 'viewer'].includes(role)) return bad(c, 'bad_role');
  const cur = await c.env.DB.prepare('SELECT role FROM trip_members WHERE trip_id = ? AND participant_id = ?')
    .bind(tripId, pid).first<any>();
  if (!cur) return bad(c, 'not_member', 404);
  if (cur.role === 'leader' && role !== 'leader') {
    const leaders = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM trip_members WHERE trip_id = ? AND role = 'leader'").bind(tripId).first<any>();
    if ((leaders?.n ?? 0) <= 1) return bad(c, 'last_leader');
  }
  await c.env.DB.prepare('UPDATE trip_members SET role = ? WHERE trip_id = ? AND participant_id = ?')
    .bind(role, tripId, pid).run();
  await audit(c.env, (c.get('user') as SessionUser).id, 'role_change', 'trip', tripId);
  return c.json({ ok: true, role });
});
```

- [ ] **Step 5: Verify** — `npx tsc -b` clean; `npx vitest run` green. (Behavioural proof is Task 5's e2e.)

---

### Task 3: `/me` roles + client gating swap

**Files:**
- Modify: `server/app.ts` (`GET /me`, ~line 157)
- Modify: `src/pages/TripShell.tsx`, `src/App.tsx` (types only if needed)
- Modify: `src/pages/Dashboard.tsx`, `Plan.tsx`, `Documents.tsx`, `Ledger.tsx`, `Payments.tsx`, `People.tsx`, `Trips.tsx`

**Interfaces:**
- `/me` trips gain `my_role: 'leader'|'editor'|'viewer'` (platform admin: `'leader'` + `platform_admin: true` on the user object).
- TripShell outlet context gains `myRole: TripRole`, `canLead: boolean`, `canEdit: boolean`; pages read those instead of `user.role === 'admin'`.

- [ ] **Step 1: `/me`** — join roles in the trips query: for platform admin, `SELECT *, 'leader' AS my_role FROM trips`; else `SELECT t.*, tm.role AS my_role FROM trips t JOIN trip_members tm ON tm.trip_id = t.id WHERE tm.participant_id = ?`. Keep response shape otherwise identical.
- [ ] **Step 2: TripShell** — compute `const myRole = (trip as any).my_role ?? 'viewer'; const canLead = myRole === 'leader'; const canEdit = myRole !== 'viewer';` and put all three in the outlet context. The People tab shows for `canLead`.
- [ ] **Step 3: Per-file swap of the 33 client checks** — rule table (grep `role === 'admin'` per file):
  - `Plan.tsx` (10): the `canEdit` definition drops `member_can_edit_plan` and becomes `canLead || canEdit(ctx)`... precisely: plan-editing affordances (add/edit/reorder/notes/day-title/CSV-import/wizard/suggest) use `canEdit`; money-ish and settings affordances (budget modal, start/end editor, leg mode override, log-fare-to-shared, unpinned-stay prompt) use `canLead`; Data menu uses `canLead`.
  - `Ledger.tsx` (4), `Payments.tsx` (4), `Documents.tsx` (5): all → `canLead`.
  - `Dashboard.tsx` (6): all → `canLead` (incl. `FxWidget isAdmin={canLead}` and the due-date filter).
  - `People.tsx` (1): role label chip — show `myRole` translations instead of admin/member (add i18n keys `roleLeader`/`roleEditor`/`roleViewer` EN: Leader/Editor/Viewer, MS: Ketua/Penyunting/Pemerhati).
  - `Trips.tsx` (1): New-trip button stays `user.role === 'admin'` (A3 opens it).
  - `TripShell.tsx` (1): People tab → `canLead`.
  - `Settings.tsx`/`App.tsx`: AI settings section stays `user.role === 'admin'` (platform).
- [ ] **Step 4: Verify** — `npx tsc -b`, `npm run build`, `npx vitest run` all clean.

---

### Task 4: MCP + AI context swap

**Files:**
- Modify: `server/app.ts` (MCP section ~1615+, tripContext ~1460)

**Interfaces:** MCP tool guards move from `needAdmin()` to role checks via `tripRole` (platform-admin tokens unchanged — they resolve to leader everywhere).

- [ ] **Step 1: MCP helper** — inside `mcpToolCall`, add `const needTripRole = async (tripId: number, min: TripRole) => { await needTrip(tripId); if (!atLeast(await tripRole(env, user, tripId), min)) throw new McpError(-32000, `This tool needs a ${min} role on the trip`); };` Keep `needAdmin` for nothing — remove its remaining uses per this table:

| Tool | Guard |
|---|---|
| `add_activity`, `update_activity`, `delete_activity`, `add_note`, `update_note`, `delete_note`, `set_day_title` | editor (resolve trip via args/row first for the by-id tools) |
| `get_*`, `list_trips`, `suggest_free_slots` | membership (as today) |

Update the five note/day-title tool descriptions from "admin token only" to "needs an editor role on the trip"; the three activity tools likewise.
- [ ] **Step 2: `list_trips`** — scope to memberships (platform admin: all), mirroring `/me`.
- [ ] **Step 3: tripContext money filter** — `includeMoney` blocks switch `user.role === 'admin'` to leader-of-this-trip (platform admin still passes).
- [ ] **Step 4: Verify** — `npx tsc -b`, `npx vitest run` green.

---

### Task 5: E2E, migration proof, release

**Files:**
- Modify: `scripts/e2e.mjs`, `docs/build-status.md`, `package.json` (version)

**Interfaces:** consumes everything; the pre-existing suite doubles as the migration/behaviour-freeze proof.

- [ ] **Step 1: Repair the plan-permission step** — the existing step toggles `member_can_edit_plan` and expects the member to gain plan editing. That path now flows through the bulk-role rework, so it MUST still pass unchanged. If it fails, the rework (Task 2 Step 2) is wrong — fix there, not in the test.
- [ ] **Step 2: Role-ladder block** (after the member context `p5` exists): via admin `page.evaluate` set the member's role to `viewer` (`PATCH /api/trips/1/members/<pid>/role`), assert member POST `/api/trips/1/activities` → 403 and no Add-activity button after reload; set `editor`, assert activity add succeeds AND expense POST → 403 AND no Add-expense button; assert `last_leader` guard: demoting the admin's own membership on trip 1 → 400 `last_leader`. Assert MCP: with the member set to editor, the member token CAN `add_activity` and `add_note`; with the member set back to viewer, both fail with an error mentioning the role; `get_itinerary` (read) works in both states.
- [ ] **Step 3: Migration assertion** — after login, `page.evaluate` fetch of `/api/trips/1` members (or a new tiny read of `trip_members` via an existing endpoint— use `GET /api/me`: assert trip 1 `my_role === 'leader'` for admin) plus: member login sees `my_role in {editor, viewer}` matching the suite's toggle state at that point.
- [ ] **Step 4: Banner** → `E2E PASSED (Phase 1 + 2 + v0.6-v0.16)`.
- [ ] **Step 5: Full verification** — vitest green; full e2e ritual → `E2E PASSED`.
- [ ] **Step 6: Release** — `npm pkg set version=0.16.0`; build-status entry: what A1 did (roles, migration runner + m001, authority swap tables, /me my_role, MCP/AI swap, member_can_edit_plan rework), what it deliberately did NOT do (invites/join/referrals/role UI/any-account trips — A2/A3), and the owner's post-deploy check: log in, confirm both trips show, family member logs in and sees exactly what they saw before.

---

## Self-review notes

- Spec coverage (A1 slice): roles schema ✔ (T1), migration runner + m001 ✔ (T1), 34-route swap ✔ (T2 table), inline checks ✔ (T2S3), last-leader guard ✔ (T2S4 — spec "every trip ≥1 leader"), /me + client 33 ✔ (T3 rule table), MCP + AI ✔ (T4), behaviour-freeze proof ✔ (T5). Deferred to A2/A3 per spec phasing: invites, join, referrals (Addendum 1), participants scoping, role UI, trip creation, transfer UI (endpoint exists via role PATCH; UI later).
- member_can_edit_plan: single writer (PATCH /trips/:id) now bulk-maps roles — e2e step proves equivalence.
- Type consistency: `TripRole`/`atLeast` names match across T1 definition and T2/T4 imports; `my_role` naming consistent between /me (T3S1) and TripShell (T3S2).
