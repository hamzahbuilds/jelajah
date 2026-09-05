# Multitenancy Phase A2 (v0.17) Implementation Plan — invites, join, referrals

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The first door into the system: leaders issue trip invite links, the platform admin issues platform invites, every user carries a personal referral code, and `/join/<code>` registers-or-joins — with referral attribution recorded at registration.

**Architecture:** One `invites` table serves all three kinds (trip / platform / referral). Pure validity logic in `shared/invites.ts`. Public `/api/join/:code` endpoints sit outside the session middleware with a KV rate limiter. Per Addendum 2 the UI splits three ways: the People page becomes trip-only (members with role chips, trip invite links); Settings becomes every user's personal page (MCP tokens moved from My-spend, personal referral link); a new platform-admin-only `/admin` page takes the AI provider config, global accounts, platform invites and the referrals switch — the future home of sub-project B.

**Tech Stack:** existing Hono Worker + D1 + KV (`FILES` binding doubles as rate-limit counter store), React 19, vitest, Playwright e2e.

**Spec:** `docs/06-spec-v0.16-multitenant.md` — §Registration & invites, §Visibility (participants scoping), Addendum 1 (referrals), **Addendum 2 (admin panel & settings split)**. Phasing: this is A2; role-picker (editing) UI / transfer / any-account trip creation stay A3.

## Global Constraints

- **No git commits** — the user commits via GitHub Desktop. Tasks end at "tests pass".
- Schema DDL in BOTH `SCHEMA` and `UPGRADES` (idempotent DDL only); any data backfill would use the `runDataMigrations` runner (none needed in A2).
- No email anywhere. Invite codes: `inv_` + 32 hex chars from `crypto.getRandomValues` (128 bits).
- Public endpoints (`/api/join/*`) must be rate-limited and constant-shape: an invalid/expired/revoked/exhausted code returns the SAME body `{ valid: false }` with 404 — no oracle distinguishing "never existed" from "revoked".
- All new user-facing strings in BOTH `en` and `ms` in `src/i18n.tsx`.
- Test commands: `npx vitest run`; full e2e ritual (kill workerd AND wrangler parent, sleep 3, `rm -rf .wrangler/state`, `npm run db:local`, `npm run build`, background `npx wrangler dev --port 8788`, poll `/api/health`, `node scripts/e2e.mjs`; full reset every run).
- Version 0.17.0 in the final task only. Baseline: 93 unit tests + `E2E PASSED (v0.6-v0.16)`.

**A2 scope fence:** no role-EDITING UI (chips display roles; changing them is A3), no leadership transfer UI, no any-account trip creation, no referral report screen (sub-project B — but its future home, /admin, is created here per Addendum 2), no changes to the balance engine.

---

### Task 1: Schema + pure invite validity (`shared/invites.ts`)

**Files:**
- Create: `shared/invites.ts`
- Test: `tests/invites.test.ts`
- Modify: `server/lib/schema.ts`

**Interfaces (produced):**
- `type InviteStatus = 'ok' | 'expired' | 'revoked' | 'exhausted'`
- `checkInvite(inv: { revoked: number; expires_at: string | null; max_uses: number; used_count: number }, nowIso: string): InviteStatus` — null `expires_at` = never expires (referral codes).
- `newInviteCode(rand: Uint8Array): string` — `'inv_' + 32 hex chars` from the 16 provided bytes (caller supplies randomness so the function stays pure/testable).
- Tables: `invites` (below) + `users.referred_by`, `users.referral_invite_id`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/invites.test.ts
import { describe, it, expect } from 'vitest';
import { checkInvite, newInviteCode } from '../shared/invites';

const base = { revoked: 0, expires_at: '2026-12-31T00:00:00Z', max_uses: 10, used_count: 0 };
const NOW = '2026-09-05T00:00:00Z';

describe('invites', () => {
  it('a live invite is ok', () => expect(checkInvite(base, NOW)).toBe('ok'));
  it('revoked wins over everything', () =>
    expect(checkInvite({ ...base, revoked: 1, used_count: 99 }, NOW)).toBe('revoked'));
  it('expired when past expires_at', () =>
    expect(checkInvite({ ...base, expires_at: '2026-09-04T23:59:59Z' }, NOW)).toBe('expired'));
  it('boundary: expiring exactly now is expired', () =>
    expect(checkInvite({ ...base, expires_at: NOW }, NOW)).toBe('expired'));
  it('null expires_at never expires (referral codes)', () =>
    expect(checkInvite({ ...base, expires_at: null }, '2030-01-01T00:00:00Z')).toBe('ok'));
  it('exhausted at max_uses', () =>
    expect(checkInvite({ ...base, used_count: 10 }, NOW)).toBe('exhausted'));
  it('one use left is still ok', () =>
    expect(checkInvite({ ...base, used_count: 9 }, NOW)).toBe('ok'));
  it('code format: inv_ + 32 lowercase hex from the given bytes', () => {
    const code = newInviteCode(new Uint8Array(16).fill(0xab));
    expect(code).toBe('inv_' + 'ab'.repeat(16));
    expect(code).toMatch(/^inv_[0-9a-f]{32}$/);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/invites.test.ts` → cannot resolve.

- [ ] **Step 3: Implement**

```ts
// shared/invites.ts
// Invite/referral validity (spec: docs/06-spec-v0.16-multitenant.md §Registration
// + Addendum 1). Pure — the caller supplies now and randomness.

export type InviteStatus = 'ok' | 'expired' | 'revoked' | 'exhausted';

export function checkInvite(
  inv: { revoked: number; expires_at: string | null; max_uses: number; used_count: number },
  nowIso: string,
): InviteStatus {
  if (inv.revoked) return 'revoked';
  if (inv.expires_at != null && inv.expires_at <= nowIso) return 'expired';
  if (inv.used_count >= inv.max_uses) return 'exhausted';
  return 'ok';
}

/** 'inv_' + 32 hex chars from 16 caller-provided random bytes. */
export function newInviteCode(rand: Uint8Array): string {
  return 'inv_' + [...rand].map(b => b.toString(16).padStart(2, '0')).join('');
}
```

- [ ] **Step 4: Schema** — in `server/lib/schema.ts` `SCHEMA`, add (near the other v-recent tables):

```sql
  `CREATE TABLE IF NOT EXISTS invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,            -- 'inv_' + 128-bit random hex
    kind TEXT NOT NULL CHECK (kind IN ('platform','trip','referral')),
    trip_id INTEGER REFERENCES trips(id), -- NULL unless kind='trip'
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('editor','viewer')),
    created_by INTEGER NOT NULL REFERENCES users(id),
    expires_at TEXT,                      -- NULL = never (referral codes)
    max_uses INTEGER NOT NULL DEFAULT 10,
    used_count INTEGER NOT NULL DEFAULT 0,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code)`,
```

`users` CREATE TABLE gains `referred_by INTEGER REFERENCES users(id),` and `referral_invite_id INTEGER REFERENCES invites(id),` after `participant_id`. `UPGRADES` gains three lines: the two `ALTER TABLE users ADD COLUMN …` statements and `...SCHEMA.filter` — extend the existing filter regex alternation with `|invites` and add `idx_invites_code` to the index alternation so the table/index CREATE also reach existing DBs.

- [ ] **Step 5: Verify** — `npx vitest run` green (93 + 8), `npx tsc -b` clean.

---

### Task 2: Invite management endpoints (server)

**Files:**
- Modify: `server/app.ts`

**Interfaces (produced; all JSON):**
- `POST /trips/:id/invites` (leader) body `{ role?: 'editor'|'viewer', expires_days?: number, max_uses?: number }` → `{ id, code, url, role, expires_at, max_uses }` (`url` = `/join/<code>`; defaults role 'viewer', 14 days, 10 uses; caps: expires_days ≤ 90, max_uses ≤ 50)
- `GET /trips/:id/invites` (leader) → active-first list `{ id, code, role, expires_at, max_uses, used_count, revoked, created_at }[]`
- `POST /invites/platform` (platform admin) body `{ expires_days?, max_uses? }` → same shape, kind 'platform'
- `GET /invites/platform` (platform admin) → list incl. issuer name
- `GET /invites/referral` (any user) → `{ code, url, used_count, max_uses, enabled }` — auto-creates the user's `kind='referral'` invite (max_uses 20, expires_at NULL) on first call; `enabled` mirrors the `referrals_enabled` app setting (default true). When disabled, still returns the row with `enabled: false`.
- `DELETE /invites/:id` (issuer or platform admin) → `{ ok: true }` (sets revoked=1)
- `PUT /settings/referrals` (platform admin) body `{ enabled: boolean }`; `GET /settings/referrals` (platform admin).

- [ ] **Step 1: Add a section after the fx endpoints:**

```ts
/* ================================================================== */
/* v0.17 — invites, join & referrals (spec §Registration + Addendum 1) */
/* ================================================================== */
import { checkInvite, newInviteCode } from '../shared/invites'; // (add to the top import block)

const inviteUrl = (code: string) => `/join/${code}`;
const makeCode = () => newInviteCode(crypto.getRandomValues(new Uint8Array(16)));
const inviteRow = (i: any) => ({
  id: i.id, code: i.code, url: inviteUrl(i.code), kind: i.kind, role: i.role,
  expires_at: i.expires_at, max_uses: i.max_uses, used_count: i.used_count,
  revoked: !!i.revoked, created_at: i.created_at,
});

app.post('/trips/:id/invites', requireLeader, async c => {
  const tripId = Number(c.req.param('id'));
  const b = await c.req.json<any>().catch(() => ({}));
  const role = b.role === 'editor' ? 'editor' : 'viewer';
  const days = Math.min(Math.max(Number(b.expires_days) || 14, 1), 90);
  const maxUses = Math.min(Math.max(Number(b.max_uses) || 10, 1), 50);
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  const code = makeCode();
  const user: SessionUser = c.get('user');
  const r = await c.env.DB.prepare(
    `INSERT INTO invites (code, kind, trip_id, role, created_by, expires_at, max_uses) VALUES (?,?,?,?,?,?,?)`,
  ).bind(code, 'trip', tripId, role, user.id, expires, maxUses).run();
  await audit(c.env, user.id, 'invite_create', 'trip', tripId);
  return c.json({ id: Number(r.meta.last_row_id), code, url: inviteUrl(code), role, expires_at: expires, max_uses: maxUses });
});

app.get('/trips/:id/invites', requireLeader, async c => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM invites WHERE kind = 'trip' AND trip_id = ? ORDER BY revoked, id DESC",
  ).bind(Number(c.req.param('id'))).all();
  return c.json((rows.results as any[]).map(inviteRow));
});

app.post('/invites/platform', requireAdmin, async c => {
  const b = await c.req.json<any>().catch(() => ({}));
  const days = Math.min(Math.max(Number(b.expires_days) || 14, 1), 90);
  const maxUses = Math.min(Math.max(Number(b.max_uses) || 5, 1), 50);
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  const code = makeCode();
  const user: SessionUser = c.get('user');
  const r = await c.env.DB.prepare(
    `INSERT INTO invites (code, kind, created_by, expires_at, max_uses) VALUES (?,?,?,?,?)`,
  ).bind(code, 'platform', user.id, expires, maxUses).run();
  await audit(c.env, user.id, 'invite_create', 'platform', Number(r.meta.last_row_id));
  return c.json({ id: Number(r.meta.last_row_id), code, url: inviteUrl(code), expires_at: expires, max_uses: maxUses });
});

app.get('/invites/platform', requireAdmin, async c => {
  const rows = await c.env.DB.prepare(
    `SELECT i.*, u.name AS created_by_name FROM invites i JOIN users u ON u.id = i.created_by
     WHERE i.kind IN ('platform','referral') ORDER BY i.revoked, i.id DESC`).all();
  return c.json((rows.results as any[]).map(i => ({ ...inviteRow(i), created_by_name: i.created_by_name })));
});

const referralsEnabled = async (env: Env) =>
  (await getSettingJSON<{ enabled: boolean }>(env, 'referrals_enabled'))?.enabled ?? true;

app.get('/invites/referral', async c => {
  const user: SessionUser = c.get('user');
  let row = await c.env.DB.prepare(
    "SELECT * FROM invites WHERE kind = 'referral' AND created_by = ? AND revoked = 0").bind(user.id).first<any>();
  if (!row) {
    const code = makeCode();
    await c.env.DB.prepare(
      `INSERT INTO invites (code, kind, created_by, expires_at, max_uses) VALUES (?,'referral',?,NULL,20)`,
    ).bind(code, user.id).run();
    row = await c.env.DB.prepare('SELECT * FROM invites WHERE code = ?').bind(code).first<any>();
  }
  return c.json({ ...inviteRow(row), enabled: await referralsEnabled(c.env) });
});

app.delete('/invites/:id', async c => {
  const user: SessionUser = c.get('user');
  const inv = await c.env.DB.prepare('SELECT * FROM invites WHERE id = ?').bind(Number(c.req.param('id'))).first<any>();
  if (!inv) return bad(c, 'not_found', 404);
  const isIssuer = inv.created_by === user.id;
  const isTripLeader = inv.kind === 'trip' && inv.trip_id != null && await needRole(c, inv.trip_id, 'leader');
  if (!isIssuer && !isTripLeader && user.role !== 'admin') return bad(c, 'forbidden', 403);
  await c.env.DB.prepare('UPDATE invites SET revoked = 1 WHERE id = ?').bind(inv.id).run();
  await audit(c.env, user.id, 'invite_revoke', 'invite', inv.id);
  return c.json({ ok: true });
});

app.get('/settings/referrals', requireAdmin, async c => c.json({ enabled: await referralsEnabled(c.env) }));
app.put('/settings/referrals', requireAdmin, async c => {
  const b = await c.req.json<any>();
  await setSettingJSON(c.env, 'referrals_enabled', { enabled: !!b.enabled });
  return c.json({ ok: true, enabled: !!b.enabled });
});
```

- [ ] **Step 2: Verify** — `npx tsc -b` clean, `npx vitest run` green.

---

### Task 3: Public join endpoints + rate limiting + referral capture

**Files:**
- Modify: `server/app.ts` (session middleware exemption ~line 163 + new public routes)

**Interfaces (produced):**
- `GET /join/:code` (public) → valid: `{ valid: true, kind, trip_name (trip kind only), inviter_name, role (trip kind) }` · invalid for ANY reason: 404 `{ valid: false }`.
- `POST /join/:code` (public, rate-limited) body `{ name, email, password, lang? }` → creates the account (+ `referred_by` = invite.created_by, `referral_invite_id` = invite.id), increments `used_count`, creates session cookie; trip kind also creates a linked participant + `trip_members` row at the invite role. → `{ ok: true, trip_id? }`. Duplicate email → 400 `email_taken` (only AFTER the invite validated — no probing with dead codes).
- `POST /join/:code/accept` (authenticated) → logged-in user joins the trip (trip kind only; no-op `{ ok: true, already: true }` if already a member; creates+links a participant named after the user when they have none). Referral/platform kinds → `{ ok: true }` (nothing to join).

- [ ] **Step 1: Middleware exemption** — extend the guard at ~line 164:

```ts
  if (c.req.path === '/api/auth/login' || c.req.path === '/api/health'
    || c.req.path.startsWith('/api/setup')
    || (c.req.path.startsWith('/api/join/') && c.req.method === 'GET')
    || (c.req.path.startsWith('/api/join/') && c.req.method === 'POST' && !c.req.path.endsWith('/accept'))) return next();
```

(`/accept` stays behind the session because it acts as the logged-in user.)

- [ ] **Step 2: Rate limiter + loader helpers** (place with the invite section):

```ts
/** KV counter: max N join attempts per IP per hour. FILES doubles as the store. */
async function joinRateLimited(c: any): Promise<boolean> {
  try {
    const ip = c.req.header('CF-Connecting-IP') ?? 'local';
    const key = `rl:join:${ip}:${new Date().toISOString().slice(0, 13)}`; // per-hour bucket
    const store = c.env.FILES;
    if (typeof store.get !== 'function' || typeof store.put !== 'function') return false; // R2-bound: skip limiting
    const n = Number((await store.get(key)) ?? 0) + 1;
    await store.put(key, String(n), { expirationTtl: 7200 });
    return n > 20;
  } catch { return false; } // limiter must never take the door down
}

async function loadInvite(env: Env, code: string): Promise<any | null> {
  if (!/^inv_[0-9a-f]{32}$/.test(code)) return null;
  const inv = await env.DB.prepare('SELECT * FROM invites WHERE code = ?').bind(code).first<any>();
  if (!inv) return null;
  if (checkInvite(inv, new Date().toISOString()) !== 'ok') return null;
  if (inv.kind === 'referral' && !(await referralsEnabled(env))) return null;
  const issuer = await env.DB.prepare('SELECT disabled FROM users WHERE id = ?').bind(inv.created_by).first<any>();
  if (!issuer || issuer.disabled) return null; // a disabled account's links die with it
  return inv;
}
```

- [ ] **Step 3: The three routes** — GET returns the constant shape (join trip name + inviter name only on the valid path); POST validates invite → rate limit → email uniqueness (lowercased) → password ≥ 8 chars → create user via the same `hashPassword` flow `/setup` and `POST /users` use, with `referred_by: inv.created_by`, `referral_invite_id: inv.id`, `must_change_password: 0` → for kind 'trip': `INSERT INTO participants (name) …`, link `users.participant_id`, `INSERT OR IGNORE INTO trip_members (trip_id, participant_id, role)` with the invite role → `UPDATE invites SET used_count = used_count + 1` → `createSession` + `sessionCookie` (mirror `/auth/login`'s cookie code) → audit `join_register`. `/accept`: validate invite; trip kind: if the session user has no `participant_id`, create+link a participant named after them; `INSERT OR IGNORE` membership at the invite role (existing membership: return `already: true`, do NOT touch their existing role, do NOT increment used_count); else increment used_count and audit `join_accept`.

- [ ] **Step 4: Verify** — `npx tsc -b` clean, `npx vitest run` green, plus a curl smoke: run the dev stack (reset ritual), `curl -s http://127.0.0.1:8788/api/join/inv_deadbeef…` (32 hex) → `{"valid":false}` 404; kill the server after.

---

### Task 4: The `/join/<code>` page

**Files:**
- Create: `src/pages/Join.tsx`
- Modify: `src/App.tsx` (public route), `src/pages/Login.tsx` (hint line), `src/i18n.tsx`

**Interfaces:** consumes Task 3's three endpoints. Route registered OUTSIDE `Shell` next to `/login`: `<Route path="/join/:code" element={<I18nProvider><Join /></I18nProvider>} />`.

- [ ] **Step 1: i18n keys** (EN shown; add MS twins at the same position — translate in the same register as the rest of the file):

```ts
  joinTitle: 'Join Jelajah', joinTripTitle: (trip: string) => `Join “${trip}”`,
  joinInvitedBy: (name: string) => `Invited by ${name}`,
  joinInvalid: 'This invite link is not valid any more. Ask for a new one.',
  joinHaveAccount: 'I already have an account', joinNewAccount: 'Create my account',
  joinName: 'Your name', joinEmail: 'Email', joinPassword: 'Password (min 8 characters)',
  joinRegister: 'Create account & join', joinAccept: 'Join trip', joinDone: 'You are in!',
  joinLoginFirst: 'Log in, then open the invite link again.',
  loginInviteHint: 'Have an invite link? Open it to join.',
  emailTaken: 'That email already has an account — log in instead.',
```

- [ ] **Step 2: Join.tsx** — loads `GET /api/join/:code` directly with `fetch` (NOT the `api` helper — its 401 redirect must not fire on this public page). Three states: invalid (message + link to `/login`); valid + not logged in (register form name/email/password → `POST /api/join/:code`, on success `location.href = trip_id ? '/trips/'+trip_id : '/'`; `email_taken` error shows `t.emailTaken` with a `/login` link); valid + logged in (detect by trying `GET /api/me` with a raw fetch; 200 → show a single `t.joinAccept` button → `POST /api/join/:code/accept` → navigate). Trip kind shows `joinTripTitle(trip_name)` + `joinInvitedBy(inviter_name)`; platform/referral kinds show `joinTitle` + inviter. Style: reuse the `.login-card` classes Login.tsx uses.
- [ ] **Step 3: Login.tsx** — one muted line under the form: `{t.loginInviteHint}`.
- [ ] **Step 4: Verify** — `npx tsc -b`, `npm run build`, `npx vitest run` all clean.

---

### Task 5: People page — trip-only (role chips, invite panel, participants scoping)

**Files:**
- Modify: `src/pages/People.tsx`, `src/i18n.tsx`, `server/app.ts`, `src/styles.css`

**Interfaces:**
- Server: the members SELECT in `GET /trips/:id` (~line 336: `SELECT p.* FROM participants p JOIN trip_members m …`) becomes `SELECT p.*, m.role AS trip_role FROM …` — every member row carries its per-trip role.
- Server: `GET /participants` — platform admin → all (unchanged); non-admin → participants of trips the user LEADS. `POST /participants` — any trip leader or platform admin. `PATCH /participants/:id` — platform admin, or leader of a trip containing that participant. `/users` routes stay platform-admin (their UI moves to /admin in Task 7).
- Client: People renders for `canLead` and contains ONLY trip concerns: **Members** (traveller list + add-traveller form + role chip per member from `trip_role` — `t.roleLeader/roleEditor/roleViewer`, so the platform admin displays as *Leader* here; account-less travellers show no chip), **Visibility** (feature-hiding toggles, unchanged), **Invite links** (new panel). The Accounts section (`t.usersTitle`, add-user form, reset/disable buttons) is REMOVED from this page entirely — it reappears on /admin in Task 7.

- [ ] **Step 1: Server** — the members-SELECT role addition and the three `/participants` route scopings per Interfaces (helper `leadsAnyTrip(env, user)` via `SELECT 1 FROM trip_members WHERE participant_id = ? AND role = 'leader'`).
- [ ] **Step 2: People rework** — strip the Accounts section; add role chips to the members table; add the Invite links card: list from `GET /trips/:id/invites` (full URL `location.origin + '/join/' + code`, 📋 copy via `navigator.clipboard.writeText` + toast, role chip, `used/max`, expiry, revoke ✕ via `DELETE /invites/:id`); create row: role select (viewer default / editor) + `t.inviteCreate` → `POST /trips/:id/invites`, new link auto-copied + highlighted.
- [ ] **Step 3: i18n** — `inviteTitle: 'Invite links'`, `inviteCreate: 'New invite link'`, `inviteRoleLabel: 'Joins as'`, `inviteCopied: 'Link copied'`, `inviteRevoke: 'Revoke'`, `inviteUses: (u: number, m: number) => \`${u}/${m} used\``, `inviteExpires: (d: string) => \`until ${d}\`` + MS twins. (roleLeader/roleEditor/roleViewer already exist from A1.)
- [ ] **Step 4: Verify** — `npx tsc -b`, `npm run build`, `npx vitest run` clean.

---

### Task 6: Settings — every user's personal page (tokens + referral)

**Files:**
- Modify: `src/pages/Settings.tsx`, `src/pages/MySpend.tsx`, `src/App.tsx`, `src/i18n.tsx`

**Interfaces (per Addendum 2):** Settings serves ALL users: MCP access tokens + MCP connection help + personal referral link. The AI-provider card LEAVES this page (Task 7 gives it a home on /admin — this task removes it and Task 7 must land in the same release). `TokenCard` LEAVES MySpend.

- [ ] **Step 1: Settings.tsx** — remove the AI-provider card (`t.aiProvider` section) and its state/imports; keep the MCP help card + `<TokenCard />` for every user (no admin gate); add the referral card: "🎁 {t.referralTitle}" — personal link from `GET /invites/referral` (copyable + toast), `t.inviteUses(used, max)`, `t.referralHint`; `enabled: false` → `t.referralDisabled` instead of the link. Keys: `referralTitle: 'Your referral link'`, `referralHint: 'Friends who join through your link count as invited by you.'`, `referralDisabled: 'Referrals are currently switched off.'` + MS twins.
- [ ] **Step 2: MySpend.tsx** — remove `<TokenCard />` and its import; leave everything else untouched.
- [ ] **Step 3: App.tsx** — the header ⚙️ Settings link shows for EVERY logged-in user (drop its `user.role === 'admin'` gate if one exists at ~line 95).
- [ ] **Step 4: Verify** — `npx tsc -b`, `npm run build`, `npx vitest run` clean.

---

### Task 7: The /admin panel

**Files:**
- Create: `src/pages/Admin.tsx`
- Modify: `src/App.tsx` (route + nav link), `src/i18n.tsx`

**Interfaces (per Addendum 2 — the future home of sub-project B):** `/admin`, platform-admin only (route guard: non-admin → `<Navigate to="/" replace />`; nav link `🛂 {t.adminTitle}` rendered only for `user.role === 'admin'`). Four cards, all from EXISTING endpoints — this task creates no new server routes:
1. **AI provider** — the exact card removed from Settings in Task 6 (same `/settings/ai` GET/PUT/test wiring, moved verbatim).
2. **Accounts** — the user-management UI removed from People in Task 5 (list from `GET /users` incl. `referred_by`, add-user form via `POST /users`, reset-password + disable via `PATCH /users/:id` — same handlers People used).
3. **Platform invites** — list `GET /invites/platform` (kind badge — platform vs referral —, issuer, uses, expiry, revoke), create via `POST /invites/platform`.
4. **Referrals switch** — checkbox bound to `GET/PUT /settings/referrals` (`t.referralsEnabled`).

- [ ] **Step 1: Build Admin.tsx** from the two moved card implementations + the two invite cards; register `<Route path="/admin" element={<Admin />} />` inside Shell; nav link beside Settings, admin-gated. Keys: `adminTitle: 'Admin'`, `platformInvites: 'Platform invites'`, `referralsEnabled: 'Allow personal referral links'`, `accountsTitle: 'Accounts'` (reuse `t.usersTitle` strings where they fit) + MS twins.
- [ ] **Step 2: `GET /users`** — extend its SELECT with `referred_by` if absent (one column; the referral report proper is sub-project B).
- [ ] **Step 3: Verify** — `npx tsc -b`, `npm run build`, `npx vitest run` clean.

---

### Task 8: Usage instrumentation groundwork (Addendum 3 — no UI)

**Files:**
- Modify: `server/lib/schema.ts`, `server/app.ts`

**Interfaces (produced; consumed by sub-project B later):**
- Table `usage_daily`: `(day TEXT NOT NULL, user_id INTEGER NOT NULL, feature TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, user_id, feature))` — in SCHEMA and reached on live DBs via the UPGRADES `SCHEMA.filter` regex (add `|usage_daily` to the table alternation).
- `trackUsage(env: Env, userId: number, feature: string): Promise<void>` — single upsert `INSERT INTO usage_daily (day, user_id, feature, count) VALUES (date('now'), ?, ?, 1) ON CONFLICT(day, user_id, feature) DO UPDATE SET count = count + 1`, wrapped in try/catch — tracking must NEVER fail a request.

- [ ] **Step 1: Schema + helper** as above (helper next to `audit`).
- [ ] **Step 2: Hooks — exactly these eleven, one line each** (`await trackUsage(c.env, user.id, '<feature>')` after the action succeeds; in `/auth/login` also `await audit(c.env, u.id, 'login')`):

| feature | where |
|---|---|
| `login` | `POST /auth/login` success path |
| `join_register` | `POST /join/:code` success (Task 3) |
| `plan_view` | `GET /trips/:id/plan` |
| `expense_add` | `POST /trips/:id/expenses` |
| `payment_add` | `POST /trips/:id/payments` |
| `doc_upload` | `POST /trips/:id/documents` |
| `ai_chat` | `POST /trips/:id/assistant/chat` success |
| `ai_suggest` | `POST /trips/:id/assistant/suggest` success |
| `mcp_call` | `mcpHttp` after auth resolves the user (once per HTTP call, any method) |
| `myspend_add` | `POST /trips/:id/myspend` |
| `fx_view` | `GET /trips/:id/fxseries` |

- [ ] **Step 3: Verify** — `npx tsc -b` clean, `npx vitest run` green.

---

### Task 9: E2E, docs, release

**Files:**
- Modify: `scripts/e2e.mjs`, `docs/build-status.md`, `package.json` (version)

**Consumes everything. The suite has steps that MOVED homes — repair them first, then add the new journeys.**

- [ ] **Step 1: Repair moved-UI steps** (grep the suite for each):
  - "AI settings + test connection" steps drive `/settings` → now drive `/admin` (same selectors on the moved card).
  - The member token creation for MCP (`p5.goto(…/trips/1/myspend)` + "Token name") → `p5.goto('/settings')` (Settings now serves members; TokenCard gone from MySpend — assert it is NOT on MySpend any more).
  - People "add user / reset password / disable" steps → `/admin` Accounts card.
  - People page steps that asserted the accounts section there must now assert its ABSENCE on People.
- [ ] **Step 2: New journeys** (fresh incognito contexts, after the MCP steps):
  1. **Trip invite flow:** admin creates an editor invite via People UI; incognito context opens `/join/<code>` → registers (name "Join Test", `join@test.local`) → lands in trip 1; `/api/me` shows `my_role: 'editor'`; can POST activity, expense POST → 403.
  2. **Role chips:** People members table shows the admin's row chipped *Leader* and the new joiner *Editor* (the Addendum-2 "rename" — assert the string "Admin" does NOT appear in the People members card).
  3. **Referral attribution:** the joiner's Settings shows a referral link; a second incognito context registers through it (no trip); admin asserts via `GET /api/users` that account #2's `referred_by` = joiner's id.
  4. **Isolation:** referral-registered user: `/api/me` zero trips; `GET /api/trips/1/plan` → 403; `/admin` redirects them to `/`.
  5. **Invite lifecycle:** revoked → invalid page; used → `used_count` incremented; `max_uses: 1` invite exhausts (second registration 404).
  6. Rate limiter not e2e-tested (KV timing) — note in build-status.
- [ ] **Step 3: Usage instrumentation proof** — not a suite step (the browser cannot query D1). After the e2e script passes, with the local state still present, run `npx wrangler d1 execute jelajah-db --local --command "SELECT feature, COUNT(*) AS n FROM usage_daily GROUP BY feature ORDER BY feature"` and require at least `expense_add`, `login`, `mcp_call`, `plan_view` rows. Record the output in the report.
- [ ] **Step 4: Banner** → `E2E PASSED (Phase 1 + 2 + v0.6-v0.17)`.
- [ ] **Step 5: Full verification** — vitest green; full e2e ritual → PASSED.
- [ ] **Step 6: Release** — `npm pkg set version=0.17.0`; build-status v0.17 entry: invites (3 kinds) + join/register + referral attribution, the Addendum-2 split (/admin created; Settings personal for all — tokens moved from My-spend; People trip-only with role chips), participants scoping (spec §Visibility leak closed), rate limiting (fails open, not e2e-tested), usage instrumentation live (Addendum 3 — metrics counting from this deploy), deferred to A3/B (role editing, transfer, any-account trips, referral report onto /admin). Owner post-deploy check: open /admin (AI config + accounts present), open Settings as a family member (tokens + referral link there), create an invite on the Japan trip in a private window, register a throwaway as viewer, then revoke the invite and disable the throwaway from /admin.

---

## Self-review notes

- Spec coverage: invites table ✔ (T1, + referral kind), no-public-signup ✔, constant-shape validation ✔ (T3), rate limit ✔ (T3), trip/platform/referral flows ✔ (T2/T3/T4), referral columns + attribution ✔ (T1/T3), personal code + kill-switch ✔ (T2/T6/T7), People invite panel + role chips + trip-only ✔ (T5, Addendum 2), participants scoping ✔ (T5), Settings-for-all with tokens ✔ (T6, Addendum 2), /admin panel ✔ (T7, Addendum 2), disabled-issuer links die ✔ (T3), join-twice no-op ✔ (T3), EN+BM ✔ (T4/T5/T6/T7).
- Task 6 removes the AI card and Task 7 re-homes it — both land in one release; the e2e step repair (T8S1) proves the move.
- Type consistency: `checkInvite`/`newInviteCode` T1↔T3; `inviteRow` shape ↔ T5/T7 rendering; `trip_role` field name ↔ People chips; `needRole`/`tripRole`/`requireLeader` from A1.
- Addendum 3 covered: usage_daily + trackUsage + 11 hooks (T8), d1-execute proof (T9S3); no UI by design.
- Known judgment call: `/api/join/:code` GET returns trip_name + inviter_name for VALID codes only — the invitee must see what they are joining; invalid codes leak nothing.
