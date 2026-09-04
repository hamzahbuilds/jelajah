# v0.16 — "Everyone's trips" · Multitenancy spec

**Status: draft, awaiting approval. 4 Sep 2026.**
Sub-project A of the roadmap approved 4 Sep 2026 (order C → A → B; C shipped
as v0.15). Decisions already locked with the owner: **invite-gated
registration · in-place migration · Leader/Editor/Viewer per-trip roles.**

## What changes, in one paragraph

Today Jelajah has one god-admin (Hamzah) and members he creates by hand.
After v0.16, any invited person can hold an account, create trips, and lead
them: inviting family, assigning per-trip roles, controlling money and
settings for *their* trip only. Users see only trips they belong to. Hamzah
becomes the **platform admin** — same login, same trips, plus the only
account that manages users globally. Nothing changes for the Japan trip's
family except a new role label; every existing login keeps working.

## Hard constraints honoured

- RM0/keyless; no email sending (invites are links/codes, never mails).
- Browser-only deploys; schema auto-upgrades; **no manual SQL** — this spec
  introduces a one-time data-migration runner precisely so the role backfill
  can ship through a normal push (see §Migration).
- Money correctness and My-spend privacy stay covered by tests that must
  remain green throughout. The balance engine itself is untouched.
- Timeline: must be live and settled well before the trip (29 Nov). §Phasing
  splits delivery into three independently shippable pushes.

## Roles

Two orthogonal levels:

**Platform level** — `users.role` keeps its existing values, reinterpreted:
`'admin'` now means *platform admin* (Hamzah; grantable to others later),
`'member'` is every normal account. Platform admin retains today's
god-mode: sees all trips, bypasses all per-trip checks, manages users,
holds platform-level settings (AI provider key, tile URL). No schema
change, no login disruption.

**Trip level** — `trip_members` gains `role TEXT NOT NULL DEFAULT 'viewer'`
(`'leader' | 'editor' | 'viewer'`). Roles attach to the membership row
(participant), and take effect through the linked user account; a traveller
without an account (infants) has a role that simply never activates.

### Capability matrix (the heart — every one of the 35 server-side and 33
client-side admin checks maps to exactly one row)

| Capability | Viewer | Editor | Leader | Platform admin |
|---|---|---|---|---|
| See the trip, dashboard, journey, plan, documents, own My-spend | ✔ | ✔ | ✔ | ✔ |
| See ledger/payments (per feature-hiding) | ✔ | ✔ | ✔ | ✔ |
| Edit plan: activities, reorder, day notes, day titles, leg overrides | ✖ | ✔ | ✔ | ✔ |
| Upload/parse documents, confirm into ledger | ✖ | ✖ | ✔ | ✔ |
| Money: expenses, payments, due dates, settlements, budgets | ✖ | ✖ | ✔ | ✔ |
| Trip settings: dates, theming, currencies, feature-hiding | ✖ | ✖ | ✔ | ✔ |
| Manage travellers (add/edit participants), roles, invites | ✖ | ✖ | ✔ | ✔ |
| Create accounts for their travellers (password + forced change) | ✖ | ✖ | ✔ | ✔ |
| Promote co-leader / transfer leadership | ✖ | ✖ | ✔ | ✔ |
| Delete the trip (typed-confirmation) | ✖ | ✖ | ✔ | ✔ |
| Create new trips (becomes their leader) | ✔ any account | ✔ | ✔ | ✔ |
| Manage users globally, platform invites, AI/tile settings | ✖ | ✖ | ✖ | ✔ |

Notes:
- **Money stays leader-only** — deliberate. It matches today's admin-only
  writes, keeps the sacred balance invariants under one pair of hands per
  trip, and mirrors how Sage actually runs trips. (Wanderlog lets any editor
  touch expenses; we are stricter on purpose.) Editors' "log fare to My
  spend" keeps working — that is private money.
- `trips.member_can_edit_plan` is superseded by roles: the column stays (D1
  cannot drop columns) but nothing reads it after migration.
- Every trip must have ≥1 leader at all times: the last leader cannot demote
  themself or leave; leadership transfer swaps roles atomically.
- Feature-hiding (`hidden_features`) now hides from non-leaders (was:
  non-admins). The 'assistant' toggle keeps its meaning.

## Registration & invites (no email infrastructure)

New table:

```sql
CREATE TABLE invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,            -- 'inv_' + 128-bit random hex
  kind TEXT NOT NULL CHECK (kind IN ('platform','trip')),
  trip_id INTEGER REFERENCES trips(id), -- NULL for platform invites
  role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('editor','viewer')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,             -- default now + 14 days
  max_uses INTEGER NOT NULL DEFAULT 10,
  used_count INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)
```

- **No public signup.** `/register` exists only as `/join/<code>`.
- **Trip invite** (leader-issued, from the People page): logged-out visitor
  → registration form (name, email, password, BM/EN) → account + a new
  participant (linked) + `trip_members` row at the invite's role. Logged-in
  visitor → joins directly (creates + links a participant if they lack one
  in that trip). A leader can hand one link to the whole family
  (max_uses).
- **Platform invite** (platform-admin-issued, from Settings until the B
  dashboard exists): account only, no trip — for Sage's client who will
  lead her own trips.
- Codes are capability links: 128-bit random, expiring, revocable, listed
  with usage counts for their issuer. Registration endpoint is rate-limited
  (KV counter per IP per hour) and invite validation is constant-shape (no
  code-exists oracle beyond valid/invalid).
- Joining an already-joined trip is a no-op; disabled users cannot join.

## Visibility & isolation

- `GET /me` returns only trips where the user's linked participants sit in
  `trip_members` (platform admin: all trips, flagged so the UI can badge
  "not a member").
- Every trip-scoped route keeps `assertTripAccess`; it drops the global
  admin bypass in favour of: platform admin OR membership. New helpers
  `tripRole(user, tripId)`, `requireLeader`, `requireEditor` replace the 35
  `requireAdmin` uses per the matrix above (the plan will enumerate every
  route).
- `GET /participants` (global list) becomes leader-scoped: returns only
  participants of trips you lead. This closes an existing cross-tenant leak.
- MCP: `list_trips` scoped identically; write tools switch from
  `needAdmin()` to `needLeader(trip)`/`needEditor(trip)` per the matrix.
  Existing admin tokens (Hamzah's) behave unchanged.
- AI context: already per-user; role filter replaces admin filter for the
  money block (leaders see all, others their own rows).
- My-spend: untouched (already `user_id`-scoped).
- Documents in KV are fetched only through trip-scoped routes — covered.

## Migration (in place, browser-deploy only)

**New machinery — one-time data migrations.** UPGRADES stays DDL-only (its
statements re-run on every cold isolate). A new `runDataMigrations(env)`
in the same middleware reads `app_settings.data_migrations` (JSON array of
applied ids), applies pending migrations in order, records each id. Each
migration is idempotent anyway (defence in depth).

**Migration `m001-trip-roles`** (runs once, automatically, on first request
after deploy):
1. For every trip: memberships whose participant links to a `role='admin'`
   user → `leader`.
2. Other memberships whose participant links to any user account →
   `editor` if that trip's `member_can_edit_plan=1`, else `viewer`.
3. Account-less participants stay `viewer` (inert).

Result for the live instance: Hamzah = platform admin + leader of Japan and
Kyushu; family exactly as capable as yesterday; nothing to click, nothing
to re-enter. Rollback = redeploy previous build (roles column is ignored by
old code; no destructive rewrites).

## UI

- **Trips page**: "New trip" for every account (was admin-only). Creating a
  trip auto-creates/links your participant and seats you as leader.
- **People page** (leader view): traveller list gains a role chip + picker
  for members with accounts; "Invite via link" panel (create/copy/revoke,
  shows expiry + uses); existing create-account-for-traveller flow kept,
  scoped to the leader's trip. Transfer-leadership action with typed
  confirmation.
- **Join page** `/join/<code>`: shows trip name + inviter, then login-or-
  register. Login page gains "Have an invite link? Open it to join."
- **Settings** (platform admin): platform-invites panel; user list moves
  here from People (global user management was never per-trip).
- **TripShell**: nav/gating driven by `myRole` from `/me` instead of
  `user.role === 'admin'` (the 33 client-side checks).
- All new strings EN + BM.

## Out of scope (cut lines)

Real-time co-editing; email anything; per-trip AI keys (assistant remains a
platform-admin-configured service; revisit if strangers ever join); org/team
grouping above trips; role 'editor' access to money (explicitly rejected
above); admin analytics dashboard (that is sub-project B).

## Phasing (each phase ships green on its own)

- **A1 — roles under the hood (v0.16):** schema + migration runner + role
  backfill + all 35 server checks + MCP + the client gating swap. No new
  pages. After A1 the live app behaves identically for the family, but
  authority is per-trip. Riskiest phase; lands first, soaks longest.
- **A2 — invites & join (v0.17):** invites table, join/register flow,
  People invite panel, platform invites, rate limiting. First moment a new
  human can enter the system.
- **A3 — leader self-service (v0.18):** any-account trip creation,
  role picker UI, co-leader/transfer, trip deletion, Settings user-mgmt
  move, BM pass over the whole flow.

## Tests

- Unit: `tripRole` resolution (member/leader/platform-admin/none),
  migration m001 mapping table (admin→leader, account+flag→editor,
  account→viewer, no-account→viewer), invite validity (expired, revoked,
  max_uses, disabled user), last-leader protection.
- E2E additions per phase, headline scenarios:
  - **Isolation:** second tenant registers via platform invite, creates a
    trip; assert tenant B sees exactly 1 trip, every trip-A endpoint 403s,
    `/participants` shows only B's people, MCP `list_trips` with B's token
    shows only B's trip.
  - **Role ladder:** viewer blocked from plan edit (403 + no UI), editor
    edits plan but blocked from expenses, leader does everything; demotion
    takes effect without re-login.
  - **Migration:** seeded pre-v0.16 DB upgrades to the expected role rows,
    family login unchanged, e2e regression suite (all prior steps) still
    passes — the whole existing suite doubles as the migration test.
  - **Invites:** link joins at correct role; expired/revoked/over-limit links
    refuse politely; joining twice is a no-op.
- The full existing suite (87 unit + e2e) stays green in every phase.

## Rollout

Three normal pushes (A1, A2, A3), each with its own build-status entry and
e2e run. No Cloudflare config changes, no new bindings. After A1 the owner
should click through the live app once as himself and once as a family
member (checklist will be in the delivery message).

## Addendum 1 (4 Sep 2026, owner request): referral tracking

Riding on the invite machinery — an invite already knows who created it:

- `users` gains `referred_by INTEGER REFERENCES users(id)` and
  `referral_invite_id INTEGER REFERENCES invites(id)`, both set once at
  registration from the invite used. Never editable afterwards.
- Every user gets a **personal referral code**: an auto-created platform
  invite (`kind='referral'`, owner = the user, default max_uses 20,
  no expiry, revocable), shown on their Settings page with a copyable
  `/join/<code>` link. Registrations through it attribute `referred_by` to
  that user and seat the newcomer with no trip (like a platform invite).
- Platform-admin control: an app-setting `referrals_enabled` (default on)
  hides/disables all personal codes at once; individual codes revocable.
  Personal codes are still capability links (random, capped, revocable), so
  the invite-gate posture holds — every account traces to a real inviter.
- Rewards themselves are out of scope; the **referral report** (per-user
  referred count, chain view) is sub-project B dashboard material. Trip
  invites also attribute `referred_by` (the leader), so family joins count.
- Phasing: schema + capture in **A2** (registration is A2); personal-code UI
  in **A2**; report in **B**. Nothing lands in A1.
