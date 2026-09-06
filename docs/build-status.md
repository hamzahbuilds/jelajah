# Jelajah — Build Status

Updated: 6 Sep 2026 (v0.25 COMPLETE — room-cost splitting, e2e green)

## v0.25.0 — room-cost splitting (6 Sep 2026) — v0.25 COMPLETE

Per `docs/13-spec-v0.25-room-split.md` (approved): links the v0.21 rooms
allocation (previously informational-only) to the split engine, so an
accommodation expense can be divided by room instead of equally/custom
across all participants.

**Shipped (T1–T4):**
- **Engine** (`shared/roomSplit.ts`, additive, frozen once landed) —
  `roomShares()`: pure function, all arithmetic in integer sen internally
  (float MYR only at the input/output boundary) to avoid drift. Splits the
  total across rooms by each room's entered amount, then within a room
  divides evenly among its non-infant occupants; when a room's sen amount
  doesn't divide evenly, the extra sen go to the lowest participant ids
  first (documented, deterministic tie-break). Throws typed
  `RoomSplitError`s (`ROOM_SPLIT_ERROR_CODES`) for invalid/negative amounts,
  duplicate occupants across rooms, sum mismatch vs the expense total, an
  empty room with a non-zero amount, and an infant-only room with a
  non-zero amount. A separate `allocateByWeight` weighted largest-remainder
  helper is exported for **UI prefill only** — never used by `roomShares`
  itself, keeping the money-critical path a single, frozen code path.
  21 unit tests (`tests/roomSplit.test.ts`).
- **Routes** (`server/app.ts`) — `POST/PUT` on `/trips/:id/expenses` and
  `/expenses/:id` accept an optional `split: { mode:'rooms', stay_label,
  room_amounts }` body. `resolveRoomsSplit()` validates category is
  `accommodation` first (else `400 rooms_split_category` — checked before
  any other field, so a non-accommodation category always short-circuits
  here regardless of what else is in the payload), resolves the stay's
  rooms + current occupants + infant flags from D1, calls `roomShares()`,
  and persists the engine-computed shares (client-sent shares are ignored
  for rooms mode) plus a `split_json` snapshot
  (`{mode,stay_label,room_amounts,occupants}`) used later for drift
  detection. Any other/absent `split` leaves `split_json` `NULL` and the
  existing equal/custom path byte-identical.
- **Editor** (`src/components/ExpenseForm.tsx`) — "Split by rooms" appears
  only for `category === 'accommodation'` with ≥1 room stay group; picking
  it hides the participant-picker + equal/custom blocks (unwrapped and
  untouched otherwise). Per-room amount inputs prefill via
  `allocateByWeight` (weighted by non-infant occupant count) but freeze the
  moment a user hand-edits a room (`dirty` flags) so the recompute effect
  never clobbers a manual entry. Live remainder line + a "Balance last
  room" helper; submit is blocked client-side while the remainder ≠ 0 (the
  server re-validates regardless).
- **Drift** (`src/lib/roomsDrift.ts`, `src/pages/Ledger.tsx`) — pure
  `roomsDrift(split_json, currentRooms)` compares the saved occupants
  snapshot to live room occupancy (order-insensitive; a since-deleted room
  counts as drift). Ledger fetches rooms alongside expenses and shows a
  "Rooms changed since this split" chip + **Re-apply** button on any
  drifted row (leader-only). Re-apply is literally the existing edit path
  (`openEdit`) with no new endpoint or state machine — the room editor
  reopens with the **saved amounts** but **current** occupant
  counts/badges, so re-saving recomputes shares against who's actually in
  each room today. 14 unit tests (`tests/roomsDrift.test.ts`).
- **Conservation invariant**, verified exactly (sen-precise, no float
  rounding) in unit tests and e2e alike: `Σ per-person shares ===
  amount_myr` in every rooms-mode split, before and after a re-apply.
- **Modes frozen**: the pre-existing equal-split and custom-split code
  paths in `ExpenseForm.tsx` are unmodified except for additive
  `!d.roomsSplit &&` visibility gates — verbatim below the new
  `if (d.roomsSplit)` early-return in `submit()`.
- **e2e** (`scripts/e2e.mjs`, reuses the v0.21 "E2E Test Stay" / Room
  One (1 occupant) / Room Two (2 occupants) fixtures): leader adds a
  RM350.00 accommodation expense split by rooms (Room One RM200.00, Room
  Two RM150.00) — asserts the remainder line reaches 0, the "By rooms"
  badge appears on the ledger row, and per-person shares are **exact**
  (200 / 75 / 75, hand-computed, sum 350 conserved) via
  `GET /trips/:id/expenses`. Then moves an occupant between the two rooms
  via the rooms API, reloads the ledger, asserts the drift chip appears,
  clicks Re-apply, confirms the editor shows the *current* occupancy
  ((2) / (1/2)) with the *saved* amounts (200/150) unchanged, saves, and
  asserts the *new* exact shares (100 / 100 / 150, sum 350 conserved) with
  the drift chip gone afterward. Negative coverage: a non-accommodation
  expense form shows no "Split by rooms" option (categories `other` and
  `food` both checked), and a direct API `POST` with
  `split.mode:'rooms'` on category `food` 400s `rooms_split_category`
  (request-level assert, bypassing the UI). Marker:
  `E2E PASSED (Phase 1 + 2 + v0.6-v0.25)`.
- **Verify trio, 2 clean full-suite runs**: `npx vitest run` 202/202 ·
  `npx tsc --noEmit` clean · `node scripts/e2e.mjs` green twice in a row
  (full reset-and-reseed ritual between runs), no fetch-flake sighted in
  either run.

**Explicitly deferred (recorded, untouched):**
- **Offline write queueing (v2)** — reads only (PWA, v0.22); writes still
  never intercepted by the service worker, by design.
- **Push notifications** — needs its own spec.
- **Per-night room splits** — v0.25 splits a room's *entered amount* across
  its occupants for the whole stay; splitting by individual night (e.g. an
  occupant who only stayed 2 of 4 nights) is a distinct future spec, not
  attempted here.

## v0.24.0 — dashboard/sidebar/plan polish (6 Sep 2026)

- Dashboard: consistent 16px card rhythm; Currency + Up-next share a 2-col row on desktop; sparkline stretches full-width (FxWidget layout-only, logic frozen).
- Sidebar: language select + bare logout icon removed; proper "Log out" nav item; avatar aligned to the icon grid; language now lives in Settings for everyone (mobile topbar select also removed).
- Plan: transit chips aligned to the pin column (solid background, rail line flows behind); row actions redesigned — checkbox always visible, desktop "Edit mode" toggle reveals move/edit/delete/drag, mobile per-row ⋯ opens the shared actions menu. All handlers byte-frozen.
- e2e: language steps migrated to Settings; Move-up steps gated on Edit mode; new mobile ⋯ asserts; Unsplash block now KEY-AGNOSTIC (branches on carousel probe; both branches ritual-verified). Marker: E2E PASSED (Phase 1 + 2 + v0.6-v0.24).
- Watch item: transient e2e fetch-flake (2nd sighting, unreproduced on retry) — 3rd sighting earns a repro ticket.

## v0.23.0 — "Mobile overflow + key-optional Unsplash" (6 Sep 2026) — v0.23 COMPLETE

Per `docs/11-spec-v0.23-unsplash-mobile.md` (approved): the mobile-overflow bug
report plus a key-optional Unsplash integration (carousel photos, an
auto-cover source, and a gallery picker) that degrades cleanly with zero
`UNSPLASH_ACCESS_KEY` set — the state of every environment so far, this one
included.

**Shipped:**
- **Mobile overflow fixes (evidence-based).** Reproduced first against real
  adversarial data (an unbroken ~63-char vendor/participant name), not the
  seeded demo data, which never triggers it. Found two sites: Ledger/
  Payments/MySpend's shared `.lrow .l-main` row (long vendor/description
  text) and `.chip` (long participant/member names) — both had `min-width:0`/
  `flex-wrap:wrap` on their containers already, but no `overflow-wrap` on the
  text-bearing element itself, so a single unbroken run of characters forced
  the flex item — and everything above it up to `.shell` — wider than the
  viewport. Two CSS-only fixes in `src/styles.css`: `overflow-wrap: anywhere`
  added to `.lrow .l-main`, and `max-width: 100%; overflow-wrap: anywhere`
  added to `.chip`. Re-scanned all 8 pages (Dashboard, Ledger, Payments,
  MySpend, Plan, People, Settings, Admin) at 360×740 and 390×844 with the
  same stress data still seeded: zero overflow anywhere, before-and-after
  confirmed by `scrollWidth`. `scripts/e2e.mjs` now asserts
  `document.scrollingElement.scrollWidth <= window.innerWidth + 1` on the
  trip dashboard and on the ledger (via the mobile Money tab) at 390px, in
  the existing 390×844 mobile-chrome context.
- **Walk icon + emoji consistency.** Added a hand-drawn `walk` glyph (lucide-
  style, 24px grid/stroke-2/round, matching the existing sprite) to
  `src/components/iconDefs.ts`, and wired it into `Plan.tsx`'s
  `RAIL_MODE_ICON` map so transit chips and the transport-card mode toggle/
  leg badge render the sprite icon instead of falling back to the `🚶` emoji
  (`shared/fares.ts`'s `MODE_ICON`) — 3 render sites, one map. `e2e.mjs`
  asserts zero `🚶` anywhere in the Plan page DOM. `shared/fares.ts`'s
  `MODE_ICON.walk` and `i18n.tsx`'s `walkTo()` walking-time caption were left
  as plain-text emoji on purpose — different call sites (non-JSX / a
  distinct "minutes to station" feature), out of this task's scope.
- **Key-optional Unsplash** (`server/app.ts`, `server/env.d.ts`,
  `src/components/AuthCarousel.tsx`, `src/pages/People.tsx`, `src/i18n.tsx`).
  `UNSPLASH_ACCESS_KEY` is a Workers **secret** (never `wrangler.toml`/
  `[vars]`/the repo) — every route checks it first and returns
  `404 {error:'no_unsplash'}` before any external call:
  - `GET /api/public/carousel` — the app's first intentionally-
    unauthenticated data route besides `/join` (spec-sanctioned; public
    Unsplash metadata only). One photo per fixed destination (Kyoto,
    Santorini, Cappadocia, Banff, Kuala Lumpur), cached 24h in the existing
    `app_settings` D1 small-JSON-config mechanism (no KV/R2 binding fits the
    shape). `AuthCarousel` fetches it once on mount with a bare `fetch` (no
    auth header — pre-auth page) and swallows any failure; on success each
    slide's existing gradient keeps its emoji "scene" and gains a photo layer
    underneath, plus bottom-right attribution (author + Unsplash links). With
    no key, the response 404s and the carousel renders exactly as it always
    has — gradients only, zero `.caro-photo`/`.caro-credit` in the DOM.
  - `GET /trips/:id/unsplash?q=` (member) + `POST /trips/:id/cover/unsplash`
    (leader) — the People-page "Choose from Unsplash" cover picker: search →
    3×3 lazy thumb grid → tap → download-location trigger fired → downloaded/
    validated/stored through the existing versioned cover pipeline
    (`storeCover`, reused verbatim, same ≤600KB/MIME/SSRF guards as the v0.20
    upload/auto-cover routes). The picker button is visible to the leader on
    mount and only hides itself for the rest of that mount once a search
    comes back `no_unsplash` (`People.tsx`'s `showUnsplashBtn`) — no point
    leaving a button up that will always 404. `e2e.mjs` drives the real
    sequence: button visible → click (auto-searches the trip's destination)
    → `noUnsplashKey` toast → button gone.
  - Trip-create auto-cover — best-effort `waitUntil` search + download +
    store on `POST /trips`, silent-fail (Wikipedia/gradient fallback
    untouched either way).
  - **No live network calls to unsplash.com anywhere in `e2e.mjs`** — every
    Unsplash assertion in the suite exercises this environment's own
    keyless/404 path, matching spec §5's explicit instruction to skip live
    Unsplash and assert key-absent behavior instead.
- **e2e** (`scripts/e2e.mjs`): keyless-carousel 404 + gradient-only render
  (login page, via `page.request` — no navigation, can't be mistaken for a
  live call), the picker button visible→click→toast→hidden sequence (People
  page, leader), the two 390px no-horizontal-scroll assertions, and the
  no-🚶-in-Plan-DOM assertion, all wired into the flows that already execute
  (not appended dead outside them). Marker → `E2E PASSED (Phase 1 + 2 +
  v0.6-v0.23)`.
- **Full ritual, reset from scratch, run twice:** `npx tsc --noEmit` clean ·
  `npx vitest run` 167/167 · `npm run build` clean · `node scripts/e2e.mjs`
  → `E2E PASSED (Phase 1 + 2 + v0.6-v0.23)` (both attempts, both clean).

**Note:** every Unsplash-backed feature above (carousel photos, cover auto-
fetch, the gallery picker) is fully implemented and wired end-to-end, but
this environment has never had an `UNSPLASH_ACCESS_KEY`, so none of it has
been exercised against the live API — only the keyless/404 path is verified
here. All three degrade cleanly with no key set (confirmed): the carousel
falls back to gradients-only, the picker button hides itself after one
failed probe instead of staying up as dead weight, and trip creation still
gets its Wikipedia/gradient cover as before. The features activate
automatically the moment the secret is set — no code or deploy change
needed — and should get one live pass once a key is provisioned.

**Note:** after provisioning the key, the carousel may 404 for up to 10 minutes (negative cache) — not a provisioning failure.

**Explicitly deferred (carried over, still untouched):**
- **Offline write queueing (v2)** — reads only in v1 (PWA, v0.22); writes are
  never intercepted by the service worker, by design.
- **Push notifications** — needs its own spec.
- **Room-cost splitting** — shipped in v0.25 (see that section above); this
  bullet is kept here only as a historical note that it was once deferred.
- **MySpend `CAT_EMOJI` consistency pass (optional)** — `MySpend.tsx`'s
  category-icon map (`food`/`shopping`/`transport`/`entrance`/`other`) is
  still plain-text emoji, not sprite icons like the rest of the app's iconography;
  unrelated to this task's walk-icon scope, flagged as an optional future
  cleanup, not a bug.

## v0.22.0 — "PWA / read-only offline" (6 Sep 2026) — v0.22 COMPLETE

Installable PWA + read-only offline support, per `docs/10-spec-v0.22-pwa.md`
(approved). Offline write queueing, background sync, and push are explicitly
out of scope — own specs, v2 candidates.

**Shipped:**
- **Installable manifest + icons.** `public/manifest.webmanifest` (name/
  short_name "Jelajah", `start_url` "/", `display` "standalone",
  `background_color` #F9F9F8, `theme_color` #0F766E, 192/512 "any" icons +
  a 512 "maskable" icon). Icon art is a hand-written SVG pin glyph
  (`public/icon.svg` on a rounded teal square, `public/icon-maskable.svg`
  full-bleed for the OS mask), pre-rendered to PNGs once via a dev-only
  Playwright script (`scripts/make-icons.mjs`, not a project dependency —
  playwright stays out of `package.json`) and committed as static assets
  (`public/icons/*.png`). `index.html` links the manifest, `theme-color`
  meta, and an `apple-touch-icon`. No `vite.config.ts` change was needed —
  `public/` already lands in `dist/` unmodified (verified against the
  pre-existing `tess/` precedent).
- **Service worker** (`public/sw.js`, hand-rolled, zero deps). The fetch
  handler's first statement is a method check (`if (request.method !==
  'GET') return;`) — writes and non-GET requests are **never** intercepted,
  by construction, before any origin/path routing runs. Per-class routing:
  same-origin `/assets/*` cache-first (`jl-assets-v1`); navigations
  network-first with a 3s timeout falling back to a cached `'/'` shell
  (late-arriving successful responses still update the shell cache via
  `event.waitUntil`, independent of which side won the race); `/api/*` GET
  (excluding `/api/auth` and `/api/mcp`) network-first → cache fallback
  (`jl-api-v1`), with the fallback response wrapped to add
  `X-Jelajah-Offline: 1` so the client can detect it; cover/document-file
  GETs (`/cover`, `/file` suffix — matched against the real
  `server/app.ts` route shapes) cache-on-fetch into `jl-files-v1`, FIFO-
  trimmed at 40 entries; everything else passes through untouched.
  `install` precaches `/`, the manifest, and the icon (log-and-continue per
  entry, not all-or-nothing); `activate` deletes any stale `jl-*` cache not
  in the current version set; `skipWaiting` is **not** automatic — a
  waiting worker only activates when the client explicitly asks (via a
  scoped `SKIP_WAITING` postMessage from the update banner's Refresh
  button), keeping activation user-driven rather than a silent mid-flow
  takeover. Cache version is a manual, documented `V` constant — no build
  stamping.
- **Client registration + banners** (`src/lib/pwa.ts`, `src/main.tsx`,
  `src/api.ts`, `src/components/AppBanner.tsx`). Registration is
  production-only (`import.meta.env.PROD` guard) and fully defensive — any
  failure (unsupported browser, storage disabled) never breaks the app.
  `api.ts` gained one additive line: every successful response is sniffed
  for the `X-Jelajah-Offline` header and reported to a listener; existing
  error-path semantics (401 redirect, `!res.ok` throw) are byte-identical
  to before. A slim, non-blocking, dark-safe banner (`AppBanner`, mounted
  above page content in `Chrome`) shows one of two mutually-exclusive
  states — offline (auto-clears on the next fresh response) or update-
  available (a Refresh button, takes priority over offline) — both EN+BM
  (`offlineBanner`/`updateBanner`/`refresh` in `i18n.tsx`). Logout now
  calls `clearApiCaches()` (best-effort `caches.delete` on `jl-api-*`/
  `jl-files-*`) before navigating — mitigates a shared device retaining
  another user's cached offline data; recorded limitation, not a full fix.
- **e2e coverage** (`scripts/e2e.mjs`, steps 56–57, appended at the very end
  of the suite in a brand-new browser context + fresh login). Rationale for
  placement: the SW registers unconditionally once dist is served as a PROD
  build (wrangler dev serves `npm run build` output), so an earlier-in-
  suite SW could in principle serve cached responses to later assertions —
  keeping the PWA section last, in its own context, means nothing above it
  can be affected. Asserts: `GET /manifest.webmanifest` → 200 + `name ===
  'Jelajah'`; `GET /sw.js` → 200 + `content-type` javascript;
  `navigator.serviceWorker.ready` resolves after a fresh login (secure
  localhost context + PROD build fire registration as expected); visiting
  a trip plan page online populates the API cache; `context.setOffline
  (true)` + reload renders the plan content from cache **and** shows the
  offline banner; `setOffline(false)`; teardown unregisters the SW and
  clears every `jl-*` cache so suite reruns start clean. **No downgrade
  needed** — the spec's pre-authorized fallback (registration + cache-
  population assertions only, dropping the offline-reload assertion) was
  not exercised: two full from-scratch ritual attempts both passed the
  offline-render step cleanly on the first try.
- **Full ritual, reset from scratch, run twice:** `npx tsc --noEmit` clean ·
  `npx vitest run` 167/167 · `npm run build` clean · `node scripts/e2e.mjs`
  → `E2E PASSED (Phase 1 + 2 + v0.6-v0.22)` (both attempts).

**Explicitly deferred (recorded, untouched — spec §5):**
- **Offline write queueing (v2)** — reads only in v1; POST/PUT/PATCH/DELETE
  are never intercepted by the service worker, by design. Queueing writes
  made while offline for replay when connectivity returns is a distinct
  future spec.
- **Push notifications** — not attempted; needs its own spec (permission
  UX, payload design, server-side subscription storage).
- Licensed carousel/cover stock photos — still needs Sage's photo picks;
  gradients and the Wikipedia auto-fetch remain the only cover sources.
- **Room-cost splitting v2** — carried over from v0.21, still untouched.
- ~~`docs/11-spec-v0.23-unsplash-mobile.md` exists (drafted, not started)~~ —
  SHIPPED as v0.23 (see above); still blocked only on an `UNSPLASH_ACCESS_KEY`
  secret being provisioned for the live-photo paths to activate.

## v0.21.0 — "Rooms allocation" (6 Sep 2026) — v0.21 COMPLETE

Per-stay room allocation (who sleeps where), the first backlog item off the
v0.20 closeout list, per `docs/09-spec-v0.21-rooms.md`. No money coupling in
v1 — the split engine is untouched; rooms are informational + AI-context only.

**Shipped:**
- **Schema.** `rooms` (`trip_id`, `stay_label`, `check_in`/`check_out`,
  `name`, `capacity`, `sort`) and `room_occupants` (`room_id`,
  `participant_id`, composite PK) — `CREATE TABLE IF NOT EXISTS` in both
  `SCHEMA` and `UPGRADES` (inherently idempotent, no one-time migration
  needed). `migrations/0001_init.sql` regenerated in the same pass (see
  "Deferred, now resolved" below).
- **API** (`server/app.ts`, all under `/api/trips/:id/rooms...`): `GET`
  (member-gated, returns rooms + `occupant_ids` + `suggested_stays` derived
  from the same accommodation-expense query the Plan page's `stays` field
  uses — extracted into a shared `deriveStays()` helper), `POST`/`PATCH`/
  `DELETE`/`PUT .../occupants` all `requireEditor`. The occupants endpoint
  enforces **single-occupancy per stay group**: assigning a participant into
  a room removes them from every sibling room sharing the same
  `trip_id`+`stay_label`, via the pure `singleOccupancyBatch()` helper
  (`shared/rooms.ts`, unit-tested) executed as one `DB.batch()`. Participant
  ids are validated against trip membership (400 `unknown_participant`
  otherwise, mirroring the existing members-PUT cross-tenant guard).
  Trip-delete cascade grows from 20 to 22 tables (`room_occupants` then
  `rooms`, FK-safe order).
- **UI.** New `RoomsCard` on the People page, below the members card,
  **visible to every trip role** — a deliberate IA change: `People` is no
  longer leader-gated in `navModel.ts`/`TabBar.tsx`'s More sheet (nav label
  unchanged), while the page's invite/trip-details/danger/visibility cards
  stay `canLead`-gated internally. Stay groups render as sub-sections
  (label + dates), a one-tap "suggested stay" picker or a free-text form add
  new stays, per-stay "Add room" adds subsequent rooms. Room cards show an
  occupancy badge (`occupancyLabel()` from `shared/rooms.ts`: `"3/4"`,
  `"3+1/4"` with infants excluded from the capacity count) that turns
  `.badge.warning` when over capacity — informational only, never blocks.
  Editors/leaders get inline rename/capacity edit, a per-room person-picker
  scoped to the stay group's unassigned pool, occupant removal, and a
  destructive delete-room modal; viewers get the same read-only card with
  zero action buttons. EN+BM strings throughout; `hotel`/`users`/`plus`/
  `trash`/`edit` icons all pre-existed.
- **MCP / AI context.** A compact rooms section (stay → room → occupant
  names) now appears wherever trip notes reach a model: the Gemini/assistant
  context builder and the MCP `get_itinerary` tool result (new `rooms:
  string[]` field). Read-only — no MCP tool can write rooms.
- **e2e** (`scripts/e2e.mjs`, new v0.21 section): leader adds a stay via the
  free-text form + a second room via the per-stay mini-form (one room left
  uncapped, one capacity 2); assigns 3 people into the capacity-2 room and
  asserts the `.badge.warning` over-capacity badge (`"3/2"`); moves one of
  them into the other room via the occupants endpoint directly and asserts
  — both via the API and a UI reload — that they left the sibling room
  (single-occupancy rule); an editor session (Hairuni, temporarily promoted)
  sees the Rooms card fully interactive but confirms the invite/trip-details/
  danger/visibility cards stay hidden; a viewer session sees the People nav
  item and the same Rooms card fully read-only (zero buttons anywhere in the
  card, including no occupant-remove control). The pre-existing trip-deletion
  e2e step (danger card, cascade) passes unchanged against the now-22-table
  cascade.
- **Full ritual, reset from scratch:** `npx tsc --noEmit` clean · `npx
  vitest run` 169/169 (was 163: +6 nav-role-widening rewrite, net unchanged
  count since v0.21 added no new unit test file beyond T1's 10 `rooms.test.ts`
  cases already counted at T1) · `npm run build` clean · `node scripts/e2e.mjs`
  → `E2E PASSED (Phase 1 + 2 + v0.6-v0.21)`.

**Deferred, now resolved (from the v0.20 closeout list):**
- **`migrations/0001_init.sql` full regeneration** — done in this batch's
  Task 1 (same esbuild+dynamic-import extraction pattern as prior batches),
  validated against a scratch in-memory sqlite. The file is now current
  through v0.21's two new tables; no more parked drift.

**Still explicitly deferred:**
- ~~MySpend fx race ticket~~ — RESOLVED in the v0.20 ticket batch (stale-response
  guard on the fx effect; submit fetches the real rate or refuses to save — the
  hardcoded 0.03 fallback is gone). The e2e `networkidle` wait before the
  currency switch remains as belt-and-braces, no longer load-bearing.
- PWA/offline — needs its own brainstorm+spec.
- Licensed carousel/cover stock photos — needs Sage's photo picks; gradients
  and the Wikipedia auto-fetch remain the only cover sources until then.
- **Room-cost splitting v2** — rooms are informational only in v1 (no money
  coupling, per spec); linking room assignment to the split engine (e.g.
  per-room cost shares) is a distinct future spec, not started.

## v0.20.0 — "Covers, server theme, mobile e2e" (6 Sep 2026) — v0.20 COMPLETE

Closes the three backlog items recorded at v0.19 closeout plus the /join BM
debt, per `docs/08-spec-v0.20-covers-theme.md`. Rooms allocation, PWA/offline,
and licensed carousel photos stay explicitly out of scope (each needs its own
brainstorm+spec / Sage's photo picks).

**Shipped:**
- **Trip photo covers.** A trip can have a cover image from two sources: a
  leader upload (`src/lib/image.ts` `resizeImageFile` — canvas resize to
  ≤1280px wide, JPEG quality .82, client-side) or a one-tap "Use destination
  photo" that fetches a free Wikipedia REST summary photo server-side
  (`POST /trips/:id/cover/auto`, keyless, `en.wikipedia.org` only — never
  hotlinked, bytes land in the same `FILES` KV `cover/<tripId>` key as the
  upload path). Covers render on the Trips grid (`TripCardCover` in
  `Trips.tsx`, gradient+emoji stays the fallback on error/absence) and as a
  subtle header backdrop in `TripShell.tsx`. Leader-only writes (`PUT`/`POST
  .../auto`/`DELETE /trips/:id/cover`, `requireLeader`), member-only reads
  (`GET`, `assertTripAccess`); server enforces ≤600KB + `image/*` content
  type on upload; attribution (`cover_credit`) rendered as a linked credit
  line in People's Trip details card when the auto-fetch path set one.
  `trips.cover_key`/`trips.cover_credit` added to SCHEMA + UPGRADES
  (idempotent ADD COLUMN).
- **Server-side theme preference.** `users.theme TEXT NOT NULL DEFAULT ''
  CHECK (theme IN ('','dark','system'))` (SCHEMA fresh-DB CHECK; UPGRADES
  adds the column without CHECK — SQLite can't ALTER one in — with an
  app-side value guard on the PATCH handler covering old/upgraded rows).
  `PATCH /me` accepts `theme` (mirrors the existing `lang` handling exactly);
  `GET /me` returns it. Client: `App.tsx` syncs `setThemePref(user.theme)`
  once per session load when it differs from the device's `jl-theme`
  localStorage value (server wins); Settings' theme seg control now PATCHes
  `/me` alongside its existing localStorage write. The pre-paint script
  (`index.html`) is untouched — still reads localStorage only, so there's no
  flash; the server sync happens after hydration.
- **Mobile-chrome e2e coverage.** New `scripts/e2e.mjs` section (steps 53–55,
  own 390×844 context) behind the full desktop suite: tab bar visible /
  sidebar hidden at that width; Money tab → `/ledger`; long-press
  (pointerdown → 600ms wait → pointerup) on the Plan tab opens the trip
  switcher sheet listing the seeded trip, Escape closes it; More sheet →
  Settings; the Settings theme seg flips `html[data-theme]` and is confirmed
  server-side via a live `/me` fetch, then reset back to Light. A separate
  step (54) covers the cover upload/render/remove round trip on the desktop
  context (leader uploads a 1×1 PNG fixture via the hidden file input on
  People's cover-block, toast fires, the Trips card picks up `img[src*=
  "/cover"]`, Remove restores the gradient). The `/cover/auto` (Wikipedia)
  endpoint is deliberately **not** e2e'd — external network the sandbox's
  `blockExternal` blocks and CI has no business depending on; left to manual
  verification.
  - **Regression fix found along the way:** the chat FAB (`.chat-fab`,
    v0.12) sat on top of the tab bar's rightmost "More" tab below 1024px,
    intercepting its taps (pre-existing since the v0.19 T7 tab bar shipped,
    just never previously exercised by an e2e click at that width). Fixed by
    lifting `.chat-fab`/`.chat-drawer` above the tab bar's reserved space in
    the same `@media (max-width: 1023px)` breakpoint `styles.css` already
    uses for it — CSS-only, no logic touched.
- **/join Bahasa Malaysia.** `Join.tsx`'s last two EN-hardcoded strings
  (the weak-password and generic-error callouts) converted to `t.weak
  PasswordMsg`/`t.genericErrorMsg` (en+ms keys in `i18n.tsx`); the invite-role
  badge's ad-hoc `charAt(0).toUpperCase()` capitalization swapped for the
  same `t.roleLeader`/`t.roleEditor`/`t.roleViewer` keys People.tsx/TabBar.tsx
  already use (falling back to the old capitalize behavior for any
  unrecognized role string). Logic byte-identical: fetch/validate/register/
  accept untouched, markup/classNames untouched, only JSX text and the one
  derived-label expression changed. No lang toggle added — `Login.tsx` (the
  page Join mirrors) has none either; both pre-auth pages render in whatever
  language the browser/session default resolves to, unchanged from before.
- **Full ritual, reset from scratch:** `npx tsc --noEmit` clean · `npx
  vitest run` 153/153 · `npm run build` clean · `node scripts/e2e.mjs` →
  `E2E PASSED (Phase 1 + 2 + v0.6-v0.20)`.

**Explicitly deferred (recorded, untouched — spec §5):**
- `api.del` body support — no current consumer.
- MySpend fx race ticket — needs its own repro + fix plan.
- Rooms allocation — needs its own brainstorm+spec.
- PWA/offline — needs its own brainstorm+spec.
- Licensed carousel/cover stock photos — needs Sage's photo picks; gradients
  and the Wikipedia auto-fetch remain the only cover sources until then.
- **`migrations/0001_init.sql` full regeneration** — flagged in the v0.20
  T1 review: the file is ~6 versions stale (missing invites/usage_daily/
  watch_currencies and now the v0.20 columns too). Left untouched on
  purpose — a partial sync would be false consistency, and `UPGRADES`
  self-heals both fresh and existing DBs regardless, so there's zero
  functional risk. Parked as its own chore: regenerate the file from
  `server/lib/schema.ts`'s `SCHEMA` end-to-end in one pass.

## v0.19.0 — "UI refresh cleanup" (P5, 5 Sep 2026) — v0.19 COMPLETE

Final sweep closing out the v0.19 design-system refresh (P1–P5): legacy-class
migration and rename (P5 tasks 1–3, prior commits) followed by this task's
dead-CSS purge, contrast pass, 360px re-check, and full e2e ritual.

**Shipped (Task 4):**
- **Carried fixes from T3 review.** `TripShell.tsx`'s accent inline-style
  dropped the now-dead `--brand`/`--brand-strong` writes (zero remaining
  reads after the P5 alias-token removal), keeping only `--brand-600`/
  `--brand-700`; i18n `ms.backToTrips` unified to "Perjalanan saya" (lowercase
  *saya*), matching `myTrips`'s casing.
- **Dead-CSS purge.** Every class selector in `src/styles.css` grepped
  against `src/**/*.tsx` and `scripts/e2e.mjs`; zero-consumer rules deleted:
  `.dash-chart`, `.doc-row` (+ its `.ic`/`.grow`/`.fname` children —
  superseded by `.lrow` in `Documents.tsx`), `.budget-strip` (+ `.bseg`/
  `.btotal`), `.wizard-grid`, `.wizard-preview`, `.mcp-url` (its `.mcp-snippet`
  selector partner stays, still used in `Settings.tsx`), `.upload-filelist`
  (+ `.uf-row`), `.nav-label` (+ its reference in the `html.side-min` group
  selector — `Sidebar.tsx` never renders a section label), and a legacy
  `.trend`/`.trend.up`/`.trend.down` trio superseded by `.trend-up`/
  `.trend-down` (which already had dark overrides). `.leaflet-pane` kept —
  its consumer is the `leaflet` library's own generated DOM, not our tsx.
- **Contrast pass.** Every `-700`/raw-hex text color in `styles.css` checked
  for a `[data-theme="dark"]` override. Six gaps found and fixed (all sit on
  a theme-aware `var(--bg)`/`var(--surface)` ancestor, so `--brand-700` text
  would go low-contrast on dark): global `a` link color, `.weekcell .wc-head`,
  `.suggest-card .sc-time`, `.note-row .note-dot`, `.newcard:hover`, and
  `.authcard .logo` — each given a `var(--brand-300)` dark override matching
  the existing convention (`.tile`, `.invite-icon`, `.nav-item.on`, `.tab.on`).
  `.login-card .logo` deliberately left alone: `.login-card` has a fixed
  `background:#fff` regardless of theme (same exemption as `fld2`'s
  auth-layout difference), so it's self-contained. `.callout.warn`/
  `.callout.info` likewise left alone — fixed light backgrounds + matching
  fixed text, self-contained in both themes.
- **360px re-check.** `.plan-cols`, `.tripgrid`, `.split`, `.stats` all
  already responsive (media-query collapse / `auto-fit`+`auto-fill` with
  `minmax`); no fixed-width leaks found, no changes needed.
- **Full e2e ritual.** DB reset required mid-ritual (a stale `.wrangler/state`
  D1 snapshot from an earlier session held a different admin password hash);
  wiped `.wrangler/state`, reseeded via `npm run db:local`, restarted
  `wrangler dev`, reran clean: `E2E PASSED (Phase 1 + 2 + v0.6-v0.18)`,
  including its own BM-casing and 360px-no-scroll assertions. `npx vitest
  run` (148 tests) and `npx tsc --noEmit` both green.

**Remaining (future):** photo covers spec (Wikimedia auto-covers — needs a
KV-storage design), server-side theme preference persistence, e2e
mobile-chrome coverage, licensed auth-page photos.

## v0.19.0 — "Plan page redesign" (P4b, 5 Sep 2026)

Plan.tsx (Jelajah's biggest, most-used screen) brought to the v0.19 design
system per `design/ui-refresh/02-plan.html`, presentational only — zero
behavior change to drag/reflow, times, fares, import/export, notes, budgets.

**Shipped (Tasks 1–5):**
- **Two-column layout + day-pill rail.** `.daychips` → horizontal-scroll pill
  rail (D-number + date + title lines, brand-tinted active ring); `.plan-cols`
  two-column grid ≥1024px (main 1fr · right 360px), stacking below that (main
  → map → budget → notes); day header restyled with inline title edit,
  budget badge2, undoReflow/bulk buttons as btn2 ghost sm with icons.
- **Numbered pin-rail activity rows.** Each row: pin-number circle (existing
  `pinNumbers`/`actRef`, unchanged), time range, title + category badge,
  meta line, edit/drag Icons; transit chip between stops (mode icon + minutes
  + fare, display-only, sourced from the existing `legs` data); drag/reorder
  wiring byte-identical. Legs/transport card deliberately stayed in the main
  column (interaction-heavy, not a sidebar widget) — noted deviation from the
  prototype, which puts route data on the map only.
- **Per-mode route lines + map legend + right column.** `LeafletMap` gained
  an additive `routes` prop (one polyline per leg, train/metro solid teal ·
  walk dotted gray · taxi/car dashed orange · fallback solid gray) with a
  `.maplegend` under the map; day budget and day notes cards moved into the
  right column, restyled to lrow-ish, same CRUD/math unchanged.
- **Data menu + modals onto shared chrome.** The Data dropdown moved onto
  the shared `Menu`; ActivityModal/StartEndModal/BudgetModal/Suggest preview
  moved onto the shared `Modal` wrapper — all form logic/props/handlers
  unchanged, only chrome restyled.
- **Emoji reconciliation (P4-final F2 parked items).** Mixed emoji/Icon rows
  cleaned up: `Review.tsx`'s keyword panel (📅🔖👤🏪💳 → calendar/ticket/user/
  bag/wallet Icons, beside the existing coins/plane Icons in the same block);
  `Plan.tsx`'s `KIND_ICON` map (✈️🔑🧳 → plane/key/bag Icons) and its
  week/month-view + pin-rail-fallback usages, remaining standalone 📍 leftover
  glyphs → pin Icon, 👤/👥 → user/users Icon, and the `MODE_ICON` badges in
  the transport card (train/taxi → train/car Icon via a local UI-layer map,
  consistent with the pin-rail transit chip; walk keeps its 🚶 emoji — no
  1:1 icon exists for it); `FxWidget.tsx`'s 💱 header → swap Icon, and the
  🟢⚪🟠 signal dots → `badge2` success/gray/warning variants with a `.d` dot;
  `ExpenseForm.tsx`'s `<option>👤 name</option>` — the emoji was dropped
  (native `<select><option>` cannot render an SVG `<Icon>` child, so no 1:1
  replacement was possible there; plain text is the correct fix). Trip
  emblem, `LeafletMap` pin markers, and `StylePicker` swatches intentionally
  stay emoji (user-facing content/branding, out of scope). 30 emoji glyphs
  removed across the four files, plus 2 `MODE_ICON` badges (train/taxi legs
  in the transport card) switched to conditional Icon rendering.

**e2e:** two selectors fixed, both intent-preserving, no assertion weakened:
`button:has-text("☑️ Select")` → `button:has-text("Select")` (bulk-select
button lost its emoji prefix in the Task 2 restyle) and
`page.$('.fx-badge')` → `page.$('.fx-row .badge2')` (the fx signal badge's
class changed from `fx-badge fx-{signal}` to `badge2 {variant}` in this
task's FxWidget reconciliation). Full reset ritual (DEV-RUNBOOK §2) run to
green: `E2E PASSED (Phase 1 + 2 + v0.6-v0.18)`. `npx vitest run` (148 tests)
and `npx tsc --noEmit` both green.

**Remaining:** P5 cleanup (alias design tokens, `2`-suffix renames, dead
legacy CSS, BM copy audit), photo covers (Wikimedia auto-covers — needs a
KV-storage design), server-side theme persistence.

## v0.19.0 — "UI refresh pages" (P4, 5 Sep 2026)

On top of the P1–P3 foundation below: every page migrated to the v0.19
design system (`docs/07-spec-v0.19-design-system.md`), presentational only —
no server/schema/API changes, all behavior preserved, e2e green at the end.

**Shipped (Tasks 1–6):**
- **Page scaffolding + Trips (Home).** New `PageHead` and `Empty` shared
  components; Trips → card grid (gradient+emoji covers, member avatars,
  role badge2, days-to-go chip, dashed "Start a new trip" card, empty
  state, referral hint card); `TripShell` failed-load state now shows an
  error card with "Back to My trips" instead of an infinite spinner.
- **Dashboard + Documents + People.** Dashboard → stat2 tile cards +
  card2/cardhead sections; Documents → styled dropzone + lrow upload list
  with an Empty state; People → lrow member list, invite panel with copy
  button, danger-zone delete-trip Modal.
- **Money pages (Ledger · Payments · MySpend).** New shared `MoneyTabs`
  seg2 nav atop all three under one "Money" PageHead; stat2 totals trio;
  expense/payment lists restyled to lrow; MySpend privacy-forward empty
  state; money math and privacy boundaries verified unchanged.
- **Settings + Admin charts.** Settings cards → card2; Admin wired to the
  real `/admin/stats` + `/admin/referrals` payloads with hand-written SVG
  charts (`components/charts/`: capsule bars, cumulative line, dot waffle) —
  honest-data ruling followed (no hourly buckets in `usage_daily`, so the
  punch-card chart was skipped rather than faked).
- **Auth (Login + Join) split layout.** Photo-free destination carousel
  (bundled CSS gradients + large emoji scenes, 6s crossfade, reduced-motion
  safe, licensed-photo swap point commented); Join's security-frozen logic
  untouched (markup/classes only).
- **Emoji sweep + dark pass + 360px pass + closeout.** Functional chrome
  emoji (nav/menu/button/card-header glyphs) replaced with `<Icon>` across
  `App.tsx`, `TokenCard.tsx`, `FxWidget.tsx`, `Review.tsx`, `Login.tsx`,
  `Join.tsx`, `Plan.tsx`'s shared chrome (data menu, directions card, budget
  chip/modal, group chips) — day-rail item visuals and trip-emblem/map-marker
  emoji (user content) intentionally left as-is, reserved for P4b. Dark pass
  found one inline `var(--brand-700)` text color with no dark override
  (Trips.tsx invite-card icon) — moved to a `.invite-icon` class with a
  `[data-theme="dark"]` override to `--brand-300`, matching the existing
  `.tile`/`.badge2.brand`/`.empty .etile` convention. 360px pass found one
  real regression via e2e's new mobile spot-check: `.stats` grid items
  (stat2 cards) had no `min-width: 0`, so an unwrapped money value could
  force the grid — and the whole page — wider than the viewport; fixed with
  `.stats > * { min-width: 0 }` plus `overflow-wrap: anywhere` on `.stat2
  .v`. `.split`, `.tripgrid`, `.lrow`, `.tabbar` were already safe (verified,
  no changes needed).
- **Parked items closed out:** unused `.authtabs`/`.avars` CSS trimmed;
  added a pure unit test (`tests/scrollLock.test.ts`) for the
  `lockScroll`/`unlockScroll` refcount in `components/uiHelpers.ts`, incl.
  the unmount-safety guard against the counter going negative.

**e2e:** one selector fixed (Dashboard checklist form wrapper moved from
`.card` to `.card2` in the Task 2 restyle) and one assertion updated
(`'💰'` → `'¥'` in the wizard-import day-budget check, since that chip's
emoji was swept to `<Icon name="coins">` in this task) — both
intent-preserving, no server logic or assertion strength changed. Full
reset ritual (DEV-RUNBOOK §2) run clean: `E2E PASSED (Phase 1 + 2 +
v0.6-v0.18)`. `npx vitest run` (148 tests) and `npx tsc --noEmit` both
green.

**Not in this phase (see task-6 brief "Not in P4"):** Plan-page deep
redesign (day rail visuals, per-mode route lines, pin-rail sync visuals) —
P4b, its own plan, because Plan.tsx is the largest page and carries
drag/reflow logic; this phase only gave Plan the shared chrome it inherits
for free. Photo covers + Wikimedia auto-covers — needs a KV-storage design,
separate spec addendum. Server-side theme persistence — future spec
addendum.

**Pending — P5 (cleanup):** alias design tokens once every page is off
them, `2`-suffix renames, dead legacy CSS (`.tabs`, old `.toast`, old
`.btn`/`.badge`/`.card` once unused elsewhere — verify with a grep audit
before deleting anything), BM copy audit.

## v0.19.0 — "UI refresh foundation" (5 Sep 2026, in progress)

P1–P3 of the UI refresh (tokens/dark mode, icons, components + modal system,
sidebar + tab bar) have shipped and the full e2e suite is green against
them. P4 (page-by-page restyle) and P5 (cleanup) are still pending — see
below.

**Shipped (P1–P3, Tasks 1–7):**
- **Design tokens + dark mode.** New CSS custom-property token set (spacing,
  radii, ink/brand/accent colors) plus a `data-theme` dark palette, ported
  from `design/ui-refresh/`.
- **Icon system.** Inline SVG icon set (`components/Icon.tsx` + `iconDefs`)
  replacing ad hoc emoji/text glyphs across nav and buttons.
- **Component + modal system.** A shared `Modal` component (scrim, focus
  trap, Escape-to-close) exists but has exactly one consumer so far —
  `TokenCard`'s revoke action, which moved from an immediate destructive
  click to a confirm-gated Modal (red primary, "no undo" copy) as proof
  wiring for the pattern. `Menu.tsx` ships with no consumer yet. Wiring
  Modal/Menu onto other in-app dialogs (Add activity, import wizard, AI
  suggestions, Data menu, etc.) is P4 work, not yet done.
- **Sidebar (desktop, ≥1024px).** `TripShell`'s old `.tabs` nav is gone;
  navigation is a fixed collapsible `.sidebar` (`components/Sidebar.tsx`)
  driven by a pure `navModel()` (`components/navModel.ts`) shared with the
  tab bar. Money (Ledger/Payments/My spend) is now a single "Money" nav item
  that targets the first visible sub-page in priority order
  (ledger → payments → myspend) rather than three separate tabs.
- **Bottom tab bar (mobile, <1024px).** `components/TabBar.tsx` — 5-slot
  tab bar (Home/Plan/Money/Documents/More) with long-press trip switcher and
  a "More" sheet for People/Settings/Admin/logout. The old `.topbar` still
  renders, but only as mobile-only chrome under 1024px (desktop uses the
  sidebar exclusively).
- **Toast restyle.** Toasts moved from `.toast`/`.toasts` to a new
  `.toast2`/`.toasts2` pill style (`components/Toast.tsx`); the old classes
  are dead CSS, not removed yet (see Parked below).

**e2e (Task 8):** `scripts/e2e.mjs` selectors updated for the new shell —
`nav.tabs a:has-text(...)` clicks became `.sidebar a.nav-item:has-text(...)`
(Dashboard → "Overview", Ledger → "Money"); steps that specifically needed
Payments or My spend (not Money's default ledger target) now `page.goto`
those routes directly; `.topbar select` language-switch steps moved to the
sidebar's `.side-lang` select (`.topbar` is hidden at the suite's 1280px
viewport); the member nav-hiding check now asserts the Money link's href
falls through to `/myspend` (no more separate Ledger/Payments tab labels to
grep for); all `.toast` assertions moved to `.toast2`; the token-revoke step
now clicks through the new confirm Modal instead of expecting an immediate
toast. Full ritual (DEV-RUNBOOK §2) run clean: `E2E PASSED (Phase 1 + 2 +
v0.6-v0.18)`. No server/, shared/, or assertion-intent changes were needed —
every failure was a selector/flow catch-up to an intentional T1–T7 UI change.

**Pending (not in this phase):**
- **P4 — page-by-page restyle.** Trips folder cards+covers, Dashboard, Plan
  (day rail, pin sync visuals, per-mode route lines), Money merge
  (Ledger/Payments/MySpend under one page with seg tabs + empty states),
  Documents (+Receipts empty state), People, Settings cards, Admin lieflat
  charts, Auth carousel (needs licensed images sourced first). Also:
  TripShell fetch-error state (no UI today if the initial `/trips/:id` load
  fails).
- **P5 — cleanup.** Delete the dead `.tabs`/`.toast` CSS (superseded by the
  sidebar/tab-bar nav and `.toast2`), remove the alias design tokens once
  every page is off them, `2`-suffix renames, BM copy audit, contrast pass,
  final adversarial review.

## v0.18.0 — "Open trips & the admin dashboard" (5 Sep 2026)

Phase A3 of multitenancy (spec `docs/06-spec-v0.16-multitenant.md` +
Addenda 4/4a), on top of A2's invites/join/referrals: any signed-in user can
now start their own trip and lead it, trip leadership and roles are fully
editable (and transferable) from the People UI, a leader can delete a trip
outright, and `/admin` gained a real operational dashboard.

What shipped (Tasks 1–7, this phase):
- **Open trip creation, creator auto-leader.** `POST /trips` no longer
  requires the platform-admin role — any signed-in user can create a trip
  from the Trips page. The creator is auto-attached as a participant (their
  first trip auto-creates one named after their account, reusing it on every
  later trip) and inserted into `trip_members` as `leader` in the same
  request, so a brand-new account can create a trip and start leading it
  with zero extra setup. `trip_create` is audited.
- **Role editing UI.** People's Trip members card now renders a real
  `<select>` (Leader/Editor/Viewer) for every member who has a login
  account, calling the existing `PATCH /trips/:id/members/:pid/role`
  directly — no more editing roles by hand through the API.
- **Atomic leadership transfer.** "Make leader & step down" on a member's
  row (`POST /trips/:id/transfer`, leader-only, confirm-gated) atomically
  makes the target the sole new leader and steps the caller down to editor
  in one batched write — never a window with two leaders or, worse, zero.
  Guarded the same way role edits are: the caller must be a genuine
  `trip_members` row on that trip (the platform-admin bypass that lets an
  admin *view* any trip does not, on its own, make them a mover on a trip
  they never joined — see the e2e note below).
- **Trip deletion, with cascade.** The People page's new danger card deletes
  a trip once its exact name is typed in to confirm
  (`DELETE /trips/:id`, leader-only). The cascade removes every dependent
  row across activities/activity_participants, groups/group_members, day
  settings/budgets/notes, checklist items, leg overrides, import profiles,
  personal expenses/shares, due dates, payments, expense shares, expenses,
  documents, trip-scoped invites, trip_members, and the trip row itself —
  cross-checked against the live schema, including the document files
  themselves (`filesDelete()` against the KV/R2-agnostic `FILES` binding for
  every `documents.r2_key` before the DB rows go).
- **Trip details card (Addendum 4a).** Leaders can rename a trip, change its
  destination, and edit its start/end dates from a People card — shortening
  the dates never deletes anything: a day that still has an activity keeps
  its D-chip on Plan even if it now falls outside the (shortened) trip
  range, because `Plan.tsx`'s day list has always been a union of the date
  range *and* every day that actually has an activity/auto-event, not the
  range alone.
- **Admin dashboard (`/admin`, Task 4/5).** Four stat cards (30-day
  signups, 7-day active users with a vs-previous-7-days trend arrow, total
  trips, 30-day MCP calls), a 30-day signups bar chart, a feature-usage bar
  list (by `usage_daily.feature`, humanized per key — logins, uploads,
  expense/payment adds, plan views, FX views, registrations, AI
  suggestions/chat, MCP calls), a referral leaderboard (referrer name,
  count, since-date), and a recent-activity feed off `audit_log`. All UTC
  day buckets (`lastNDaysUtc`/`fillDays` in `shared/metrics.ts`) render in
  the browser's local calendar, same fix class as v0.14's day-arithmetic
  bug — never re-derive a calendar day by round-tripping through UTC.
  `GET /admin/stats` and `GET /admin/referrals` are `requireAdmin`-gated
  like every other admin-only endpoint.
- **BM pass.** Every new A3/dashboard string shipped with an EN+BM pair from
  day one (`transferLead`, `transferConfirm`, `lastLeaderMsg`, `deleteTrip`,
  `deleteTripHint`, `tTripDeleted`, `tLeadershipMoved`, `tripDetails`,
  `tripDatesHint`, `badDateRange`, `tTripUpdated`, the `mDashboard`/
  `mSignups30`/`mActive7`/`mVsPrev7`/`mTrips`/`mMcp30`/`mFeatureUsage`/
  `mReferrals`/`mNoReferrals`/`mActivity`/`mReferredBy`/`mReferredCount`/
  `mSince` dashboard labels, and the 10 `f*` feature-usage labels). Also
  reworded several existing v0.17 BM strings for consistency (curly-quote
  style in `joinTitle`/`deleteTripHint`, "sudah" instead of "dah" in
  `joinInvalid`/`joinHaveAccount`/`joinDone`, a fuller `joinLoginFirst`/
  `emailTaken`), and renamed `adminTitle`'s BM value from the borrowed
  "Admin" to "Pentadbir" so the platform-admin heading never collides with
  the Leader/Editor/Viewer trip-role rename from v0.17.
- **E2E precision fix.** The v0.17 "role chips" e2e assertion grepped the
  *entire* Trip members card's text for the substring `"Admin"` to guard the
  Leader/Editor/Viewer rename. Once open trip creation (this phase) lets a
  trip creator legitimately become a participant named after their account
  — and the seeded platform admin's account is literally named "Admin" —
  that whole-card text grep started false-positiving on the admin's own
  *participant name* appearing in the card's global participant-chip picker
  (a name, not a role). Confirmed as correct app behavior, not a bug:
  amended the assertion (`scripts/e2e.mjs`) to check only the actual role
  chip/badge and role-`<select>` elements inside the card for an exact
  match on the platform labels `"Admin"`/`"Member"`, never a whole-card text
  scan — same intent, immune to participant-name collisions. A member's
  *name* may be anything; only a role chip may never read a platform label.

Tests: 108 unit (unchanged from v0.17 — this phase is app + e2e only, no new
pure-logic modules) and the full e2e suite green
(`E2E PASSED (Phase 1 + 2 + v0.6-v0.18)`), with seven new steps extending
the A2 invite-flow block: any-account trip creation (zero-trip referral
user creates and leads their own trip via the UI, trip 1 stays invisible to
them), role editing through the People `<select>` (editor → viewer →
editor, verified via the target account's own `/api/me` each time), atomic
leadership transfer through the UI with its `confirm()` dialog (verified
via `GET /api/trips/:id`'s raw per-member roles, restored and re-verified),
the admin dashboard (all four cards, the chart, the feature list, the
referral leaderboard, the activity feed), the trip-dates round trip
(extend → +1 D-chip → restore → shrink past an activity-bearing day → chip
survives → restore again, exact original dates both times), a BM smoke
check via the topbar language switch, and trip deletion via the danger
card (with trip 1 confirmed untouched afterward). One deviation from the
literal spec text, approved by the controller: the BM smoke check verifies
a live-grepped ms string on an authenticated page (the trips list heading)
rather than on `/join/:code`, since that route's `<I18nProvider>` has no
`initial` prop and always renders English regardless of the logged-in
user's saved language — pre-existing v0.17 behavior, out of this phase's
scope to change.

**Fix wave (final whole-change review, 5 Sep 2026).** The A3 whole-change
review found one Critical and several Important issues after Tasks 1–7 had
each passed their own review; all were fixed in one pass and re-verified
with the full e2e ritual:
- **Cross-tenant members-PUT scoping (Critical).** `PUT /trips/:id/members`
  accepted arbitrary `participant_ids`, letting a leader graft any
  participant in the system onto their own trip regardless of tenant. Added
  a guard that rejects (`unknown_participant`, 403) any
  incoming id before any mutation runs, unless it is already a member of
  *this* trip, the caller is platform admin, or the participant is visible
  to the caller under the same leader-scoping rule `GET /participants`
  already used (member of some trip the caller leads). That rule's SQL
  fragment (`LED_TRIP_IDS_SQL`) is now shared between the two endpoints
  instead of being duplicated. `PATCH /participants/:id`'s existing
  leads-a-containing-trip check was audited against the same attacker path
  and needs no change — it can no longer be satisfied by grafting an
  unrelated participant in first, now that the graft itself is blocked.
- **Round 2 — `created_by` ownership rule.** The round-1 guard above
  regressed the add-a-new-traveller flow (`POST /participants` then the
  members PUT): a freshly created participant is a member of nothing yet,
  so it failed every allow rule. `participants` gained a nullable
  `created_by INTEGER REFERENCES users(id)` column (DDL only; legacy rows
  stay `NULL` and are already covered by the other allow rules), set on
  every `POST /participants` to the caller's user id, and the members-PUT
  guard gained one more allowance: an id with zero `trip_members` rows
  anywhere whose `created_by` equals the caller's own user id. This
  restores add-new-traveller while still refusing to let a different
  caller graft someone else's still-unattached fresh participant.
- **Days-union fix.** `Plan.tsx`'s day-chip union only counted activity/
  auto-event days; a day that only had a note, a budget, or a title (day
  setting) outside the trip's date range silently lost its chip. The union
  now also folds in `dayNotes`/`dayBudgets`/`daySettings` days (skipping the
  `'*'` default row), making the Addendum-4a "nothing vanishes" promise
  actually true for every day-scoped feature, not just activities.
- **''-vs-NULL fix.** People's trip-details save sent `''` for a cleared
  date/destination field, which a bare `COALESCE(?, col)` bind happily wrote
  as a literal empty string — corrupting `?? fallback` reads downstream
  (most visibly on trips created with no dates/destination, e.g. the
  any-account "Solo Getaway" flow). People.tsx now sends `null` instead of
  `''`, and `PATCH /trips/:id` normalizes any incoming `''` for
  `start_date`/`end_date`/`destination` to `null` before the bind — for
  every caller, not just People. The same endpoint also gained a
  server-side `end_date < start_date` guard (`bad_date_range`) alongside
  the client-side one that already existed.
- **Deletion ordering.** `DELETE /trips/:id` used to delete each document's
  KV/R2 blob before running the D1 batch that removes the rows. Reordered
  so `r2_key`s are collected up front, the D1 batch runs first, and the
  blob deletions happen only after it succeeds — a failed batch can no
  longer leave rows and blobs inconsistent; an orphaned blob after a failed
  *blob* pass (batch already committed) is accepted as harmless.
- **Viewer-view People fix.** The People route is URL-reachable by a viewer
  even though its nav tab is leader-only, and its data-loading effects
  (`/participants`, `/trips/:id/invites`) were unconditional, so a viewer
  landing there directly got 403s as unhandled promise rejections plus a
  broken-looking, unusable page. Those two effects now only fire when
  `ctx.canLead` is true, and the leader-only role-select column, invite
  links card, trip-details card, and danger card are all now wrapped in
  `canLead` — a viewer opening the page sees only the members list, nothing
  actionable.
- **e2e additions.** A new negative test in the A3 block: the referral user
  (leader of their own "Solo Getaway" trip, before they delete it) attempts
  `PUT /api/trips/<their trip>/members` with `participant_ids: [1]` (a
  family participant on trip 1, which they don't lead) — asserted 403, and
  trip 1's member set asserted byte-for-byte unchanged. The dashboard
  signups-chart assertion now checks that at least one `<rect>` has a
  numeric `height` attribute > 0, not just that a rect exists. The
  shrink-dates step now also adds a day note (via API) on an out-of-range
  day with no activity, and asserts that day's chip survives the shrink
  too, alongside the pre-existing activity-day check.

Two rulings recorded during this fix wave (not code changes, decisions for
the record):
- **Open trip creation is deliberately left uncapped.** Any signed-in
  account can create and lead trips with no per-account limit; population
  stays invite-gated (an account still needs to be invited/registered to
  exist at all), and a runaway or abusive account can be disabled from
  `/admin` — no rate limit or cap was added, and none is planned unless
  abuse is actually observed.
- **The Admin feed's timestamp-offset convention is deferred to Phase B.**
  The recent-activity feed renders `audit_log` timestamps without
  normalizing a display-timezone offset convention across entries; this is
  a real but low-severity polish item, explicitly punted to Phase B rather
  than folded into this fix wave.

Version 0.18.0. No manual SQL for this phase.

Remaining after this phase: rooms allocation (admin assigns people per
accommodation), PWA/offline itinerary, insights beyond the admin dashboard
shipped here (the dashboard covers usage/growth; deeper per-trip spend/
itinerary insights are still open), and a full-app BM audit (this phase
covered the new/reworded strings it touched, not every pre-existing string
in the app).

**Owner post-deploy check:** open `/admin` and confirm the dashboard is
populated (four cards, the signups chart, the feature-usage list, the
referral leaderboard, the activity feed); change a family member's trip
role and back from the People page; create a throwaway trip and delete it
via its danger card; check that the referral leaderboard only shows names
from the A2/A3 test era if those test accounts (`join@test.local`,
`referral@test.local`, etc.) still persist in the target environment —
they should generally be cleaned up before this ships somewhere real
people will see the dashboard.

## v0.17.0 — "Invites, join & referrals" (5 Sep 2026)

Phase A2 of multitenancy (spec `docs/06-spec-v0.16-multitenant.md` + Addenda
2/3): trip invite links, public self-registration through `/join/:code`,
personal referral links, the Addendum-2 UI split, and live usage
instrumentation, on top of A1's per-trip roles.

What shipped (Tasks 1–8, this phase):
- **Invites table + three kinds.** `invites` (code, kind `trip`/`platform`/
  `referral`, trip_id, role, created_by, expires_at, max_uses, used_count,
  revoked) backs trip invite links (leader-created, `viewer`/`editor`,
  `POST/GET /trips/:id/invites`), platform invites (`requireAdmin`,
  `/invites/platform`) and one stable referral link per user
  (`GET /invites/referral`, upserted). `checkInvite()` (`shared/invites.ts`)
  is the single pure status function (`ok`/`expired`/`revoked`/`exhausted`)
  used by both the UI-facing GET and the registration POST, so a disabled
  issuer's links die with the issuer, a revoked/expired/exhausted code always
  404s, and no invite state leaks except `trip_name`/`inviter_name` for a
  *valid* code (invalid codes leak nothing).
- **Public join flow.** `GET/POST /api/join/:code` (session-exempt in the
  auth middleware for GET and non-`/accept` POST only) plus the `/join/:code`
  React page (`src/pages/Join.tsx`): registers `{name, email, password}`,
  creates the account with `referred_by`/`referral_invite_id` set from the
  invite, and for a `trip` invite creates a participant + `trip_members` row
  at the invite's role in one insert sequence. A logged-in user
  hitting a valid link instead sees an "accept" button
  (`POST /join/:code/accept`) that joins without creating a second account.
  A hand-rolled KV-backed rate limiter (`joinRateLimited`, 20/IP/hour, fails
  open on any KV error) guards the POST — **not e2e-tested** (KV timing is
  not reliably reproducible against a `wrangler dev --local` KV binding in a
  scripted run; deferred to manual/staging verification).
- **Referrals switch.** `app_settings.referrals_enabled` (default true),
  toggled from `/admin`; a referral code that resolves to a disabled switch
  behaves as an invalid invite.
- **Addendum-2 UI split.** `/admin` (`src/pages/Admin.tsx`, platform-admin
  only, else `<Navigate to="/">`) is a new page holding four cards: AI
  provider (moved off `/settings`), Accounts (moved off the trip People page
  — create/reset-password/enable-disable), Platform invites, and the
  Referrals on/off switch. `/settings` (`src/pages/Settings.tsx`) is now for
  *every* user — the referral-link card plus the MCP help/API-token card
  (`TokenCard`, moved off My spend). The trip People page keeps visibility
  toggles, the member roster with `Leader`/`Editor`/`Viewer` chips (the
  Addendum-2 rename — "Admin" no longer appears anywhere in trip-scoped UI),
  and its own new Invite-links card (`role` picker + revoke).
- **Usage instrumentation (Addendum 3).** `usage_daily` + `trackUsage()`
  fired from 11 call sites (login, join_register, expense_add, myspend_add,
  payment_add, doc_upload, ai_chat, ai_suggest, mcp_call, plan_view,
  fx_view) with no UI by design — counts are read by SQL, not a dashboard.

Task 9 (e2e, docs, release) found a regression in Task 7's topbar change that
briefly blocked a clean full-suite pass; fixed — see below.

**Deferred to A3/B** (unchanged from the spec): role editing/transfer UI
beyond the existing role PATCH, trip creation by non-admin accounts, a
referral-report view on `/admin`.

### Topbar 360px overflow, fixed (found by Task 9 e2e)

`scripts/e2e.mjs`'s existing 360px responsive check (`hasHScroll`, unchanged
by Task 9) now fails: `.topbar-inner` (`src/App.tsx`, `Chrome()`) is a
non-wrapping flex row (`display:flex` and no `flex-wrap`/`overflow-x` in
either the base rule or the `@media (max-width:620px)` block in
`src/styles.css`) and Task 7 added a fifth item — the `🛂 Admin` link, shown
only when `user.role === 'admin'` — without any narrow-viewport handling.
Measured live: at a 360px viewport, `.topbar-inner` has
`scrollWidth = 376` against `clientWidth = 360` (16px of forced horizontal
scroll); the `Admin` link alone measures ~40px wide at `left:146/right:186`.
Before Task 7's topbar link this same row (logo, Settings, EN/BM select,
name, logout) fit; after it, an admin session on a phone-width screen gets a
horizontally-scrolling page header. Non-admin sessions are unaffected (the
link doesn't render for them).

**Fix (topbar 360px round):** `src/styles.css`'s `@media (max-width: 620px)`
block now sets `.topbar-inner { flex-wrap: wrap; gap: 6px 8px; }` and gives
`.topbar-inner .spacer { flex-basis: 100%; height: 0; }`, so under 620px the
logo occupies its own first line and Settings/Admin/language-select/name/
logout wrap onto a second line together — no item is hidden or shrunk, the
Admin link stays reachable and fully labelled at every width, and the e2e
`hasHScroll` assertion is untouched. Re-verified: `.topbar-inner` no longer
overflows at 360px with an admin session (Settings + Admin + name + Log out,
the widest case), and the full e2e run now reaches
`E2E PASSED (Phase 1 + 2 + v0.6-v0.17)`.

**Everything else verified green:** 101 unit tests (was 93; +8
`invites.test.ts`: `checkInvite` × 4 statuses, `newInviteCode` format) and
every other e2e step passes, including all of Task 9's new coverage —
repaired moved-UI steps (AI settings + test-connection now drives `/admin`;
the member MCP-token step now drives `/settings`; People add-account now
drives `/admin`'s Accounts card; TokenCard confirmed absent from My spend;
the Accounts card confirmed absent from People) and the new v0.17 journeys
(trip invite → `/join/:code` registration → editor role, activity add ok,
expense 403; People role chips show `Leader`/`Editor` and never `Admin`;
referral registration attributed via `GET /api/users`'s `referred_by`; the
referral-only account proven isolated — zero trips, `/trips/1/plan` 403,
`/admin` redirects home; invite lifecycle — revoked invite shows the invalid
page, a used trip invite's `used_count` increments, a `max_uses:1` invite
404s on its second registration), and now the 360px mobile check as well
(`mobile 360px ok (no horizontal scroll)`). The usage-instrumentation proof
(`SELECT feature, COUNT(*) FROM usage_daily GROUP BY feature`) shows rows for
every feature exercised in this run, including the required `expense_add`,
`login`, `mcp_call`, and `plan_view`. With the topbar fix above, the full
suite reaches `E2E PASSED (Phase 1 + 2 + v0.6-v0.17)` — `package.json`'s
`0.17.0` version bump stands and **v0.17.0 is released**.

**Post-release fix wave (final review):** the referral card's copied/rendered
link on `/settings` (and the platform/trip invite links on `/admin` and
People) now prepend `location.origin`, since `GET /invites/referral` returns
a relative `/join/inv_…` path — the joiner was previously shown/copying a
bare path instead of a usable URL; `scripts/e2e.mjs` now asserts the rendered
referral link starts with `http`. Also for sub-project B: `usage_daily`'s
day buckets are UTC calendar days by design (the server has no per-user
timezone), so a dashboard rendering them must present each bucket in the
viewer's local timezone rather than assume UTC == local day boundaries.

**Owner post-deploy check:** open `/admin` (AI config + accounts present),
open Settings as a family member (tokens + referral link there), create an
invite on the Japan trip in a private window, register a throwaway as
viewer, then revoke the invite and disable the throwaway from `/admin`.

## v0.16.0 — "Per-trip roles" (5 Sep 2026)
Phase A1 of multitenancy (spec `docs/06-spec-v0.16-multitenant.md`): every trip
now has a `leader`/`editor`/`viewer` role per member instead of the old binary
"admin vs. everyone else" model, laying the ground for later phases (invites,
join links, referrals, per-participant role UI, trip creation by any account)
without changing what today's single-admin-family setup looks or feels like.

What shipped:
- **Roles schema + migration.** `trip_members.role` (`leader`/`editor`/`viewer`,
  default `viewer`) added via the lazy `UPGRADES` path, plus a one-time data
  migration (`runDataMigrations`, recorded in `app_settings` so it runs exactly
  once per deploy, not on every cold isolate) that backfills every existing
  membership: the platform admin's own account → `leader`, an account holder
  whose trip already had "members can edit the plan" on → `editor`, everyone
  else → `viewer` (`migratedRole()` in `server/lib/roles.ts`, unit-tested in
  `tests/roles.test.ts`).
- **Authority swap.** All 34 trip-scoped routes now gate on `TripRole` via
  `requireLeader`/`requireEditor`/`atLeast()` instead of the old
  `user.role === 'admin'` check — leaders keep full control (money, membership,
  visibility, trip settings), editors can edit the plan (activities, legs, day
  notes/titles, import profiles) but not money or membership, viewers are
  read-only. A trip can never be left with zero leaders: `PATCH
  /trips/:id/members/:pid/role` refuses to demote the last `leader` (`400
  last_leader`).
- **`member_can_edit_plan` rework.** The existing admin toggle
  ("Members can edit the plan" on the People page) is kept as the only UI for
  this phase, but `PATCH /trips/:id` now bulk-maps it onto real roles —
  flipping it on/off sets every non-leader linked member's role to
  `editor`/`viewer` in one statement — rather than being read directly at
  authorization time. Behaviour is unchanged from a family member's point of
  view; e2e proves the equivalence end to end (403 before, activity add works
  immediately after the toggle, no code path left reading the old flag for
  auth).
- **`/me` + client.** `GET /api/me` returns `my_role` per trip (`'leader'` for
  the platform admin everywhere, the `trip_members.role` row otherwise);
  `TripShell` derives `myRole`/`canLead`/`canEdit` from it and every gated
  button (Add activity, Add expense, People tab, Documents upload, etc.) reads
  those instead of the old session-role check.
- **MCP + AI swap.** All MCP write tools (`add_activity`, `update_activity`,
  `delete_activity`, `add_note`, `update_note`, `delete_note`,
  `set_day_title`) now require `editor` on the trip via `needTripRole()`
  instead of "must be the admin's own token"; reads (`get_itinerary`,
  `get_balances`, `get_expenses`, `list_trips`, `get_notes`) are unchanged —
  any member can read. The block message changed from mentioning "admin
  token" to `This tool needs a ${role} role on the trip`; a viewer-role token
  is still fully blocked from every write tool, only the wording changed.
- **`delete_activity` scoping fix** (found during Task 4's role rollout): the
  MCP `delete_activity` handler now looks up the activity's own `trip_id`
  before checking the caller's role on *that* trip, instead of trusting a
  caller-supplied trip id — closes a cross-trip role-check bypass.
- **`GET /trips/:id` `my_role` gap** (found and fixed during this phase's e2e
  verification pass): the endpoint `TripShell` actually calls to load a trip
  (`GET /api/trips/:id`) had never been updated to include `my_role` — only
  `GET /api/me` had the join. Every trip page silently fell back to
  `my_role ?? 'viewer'`, so `canLead`/`canEdit` were `false` for *everyone*,
  including the platform admin — Add activity, Add expense, Documents upload,
  and the People tab all disappeared. Fixed by computing `my_role` for
  `GET /trips/:id` the same way `/me` and the MCP layer already did.
- **`scripts/seed-fx.mjs` timezone seam** (found while re-verifying the fx
  widget's window logic in this pass): the dev/e2e fx seed built its 30 days
  of history from `Date`'s *local* calendar parts, so after local midnight in
  a +08 timezone it stamped a row with tomorrow's date in UTC terms —
  `fx_rates` is Frankfurter's UTC-dated domain, so a `1W` band window computed
  in UTC could see 9 points instead of 7. Seed now builds dates from
  `setUTCDate`/`getUTCFullYear`/`getUTCMonth`/`getUTCDate` so seeded rows and
  the UTC-windowed band logic agree regardless of the machine's local
  timezone. Output (`seed-fx: 60 fx_rates rows ending today`) is unchanged.

Deliberately **not** in this phase (spec Addendum 1 / A2–A3): invite links,
join-by-link, referrals, any per-participant role-editing UI (the role change
is reachable today only via `PATCH /trips/:id/members/:pid/role`, no button in
the People page yet), trip creation by non-admin accounts, and a transfer-
leadership UI (the endpoint exists via the same role PATCH; a dedicated UI
comes later).

Verified: 93 unit tests (was 87; +6 `roles.test.ts`) and the full e2e suite
green end to end, with new coverage for the role ladder (viewer → editor →
viewer: API 403/200, button visibility, and MCP mutation blocking with the
new role-mentioning error, at every step), the `last_leader` guard, and the
`/me` migration proof (admin `my_role === 'leader'`, member `my_role`
following the toggle state). Version 0.16.0. No manual SQL — the role column
and its one-time backfill both run automatically on first request after
deploy, same lazy-upgrade pattern as every prior migration.

**Owner's post-deploy check:** log in as admin, confirm both trips ("Jelajah
Jepun 2026" and "Kyushu Campervan") still show on the trips list and open
normally with full editing; have a family member (e.g. Hairuni) log in and
confirm they see exactly what they saw before this release — same tabs, same
Add-activity access if it was already on, same read-only ledger/payments if
those were hidden. Nothing should look different to a member unless the admin
deliberately changes a role via the API.

**Post-review fix (same release):** `PUT /trips/:id/members` was found to
delete every `trip_members` row and re-insert without `role`, silently
resetting everyone — leaders included — to `viewer` on every membership save;
it now diffs the incoming participant-id set against the existing rows
(`DELETE … NOT IN`, `INSERT OR IGNORE`) so existing members keep their role
and only newly-added members default to `viewer`, with the same `last_leader`
guard as the role-PATCH endpoint when a save would remove every leader. My-
spend promote remains member-accessible by design (own money, payer = self) —
the one deliberate exception to money-writes-are-leader-only.

## v0.15.0 — "Know your rate" (4 Sep 2026)
Forex widget on the trip dashboard: pick a base + up to 6 watch currencies per
trip, each rendered as a card with the current rate, a sparkline over a
6-month band (`shared/fxband.ts`, 8 unit tests), a buy/ok/wait signal pinned
to direction (rate above the band is always "buy", below is always "wait" —
never inverted), and a window switch (1W–1Y). Admin-only "⚙️ Set up
currencies" / "Edit currencies" editor (`PATCH /trips/:id/currencies`,
`GET /currencies` for the reference list); members see the widget read-only
with no settings gear. New trip creation carries the same base/watch pickers
so a trip can start with currencies pre-selected. Rates are fetched at most
once per day per base/quote pair and cached in D1 (`fx_rates`); a failed
upstream fetch serves the stale cache instead of breaking the widget.
`db:local` now runs `seed-fx` after migrations so local/e2e runs start with
~2 months of history and don't depend on network access.

Two deviations from the spec:
1. No UPGRADES data seed for `watch_currencies` on existing trips — it ships
   as an empty `[]` and the dashboard shows the "Set up currencies" card
   instead, so the admin opts a trip in explicitly rather than a migration
   silently turning the widget on everywhere. This is exercised directly by
   the e2e (trip 1 starts empty, the suite drives the setup flow).
2. Expense pre-fill was already covered by the existing FX-rate-by-payment-date
   flow (ExpenseForm fetches `/fx` per payment date, frankfurter.dev, cached
   in D1) added back in Phase 1 — no new code needed there. Note this is a
   separate `fx_rates` lookup from the widget's series fetch: the widget
   stores `(base=MYR, quote=JPY)` rows while the expense pre-fill reads
   `(base=JPY, quote=MYR)`, a different primary key, so the widget does not
   warm or otherwise affect that cache.

Verified: 87 unit tests (was 79; +8 `fxband`) and the full e2e suite green,
with new steps for the widget (setup flow, 2 rows, band+signal direction,
window switch, bad-currency and watch-the-base validation), member view (no
gear), and trip-creation currency persistence. Version 0.15.0. No manual SQL —
`trips.watch_currencies`/`base_currency` and `fx_rates` auto-add on first
load. Live rollout note: after deploy, open each trip's dashboard once as
admin and click "⚙️ Set up currencies" (Japan: JPY + USD · Kyushu: JPY).

As-built deviations: currencies catalogue is cached in `app_settings` (D1)
rather than KV; the fxseries band is returned as `{low, high}` in display
terms; the band/signal helpers are named `costBand`/`analyzeRates`; the
window preference is stored in a single localStorage key.

## Done — Phase 1 (money engine), v0.3
Built on the approved Plan C stack (Cloudflare Pages + Workers + D1 + **KV**),
delivered as `jelajah-v0.3.zip` in the Cowork conversation, DEPLOY.md inside.

v0.2 added a one-time in-app setup screen (creates DB schema + admin + Japan trip
seed on first visit), enabling fully browser-based deployment (GitHub → Pages git
integration → dashboard-created D1/KV → setup screen). No terminal/Mac needed.
v0.3 swapped file storage from R2 to Workers KV so **no credit card is needed
anywhere** (KV free: 1 GB, ~700 PDFs); code auto-detects KV vs R2 binding, so R2
remains a drop-in upgrade. Verified: 1.5 MB Airbnb PDF byte-identical roundtrip
through KV; full e2e re-passed.
v0.4 (current, `jelajah-v0.4.zip`): Sage's first real deploy failed because
Cloudflare's git integration created a *Workers* project (runs `npx wrangler
deploy`) while the repo was in *Pages* format. Restructured: functions/ →
server/ (Hono app is now a standard Worker entry, `main = server/index.ts`),
static SPA served via [assets] with single-page-application fallback and
run_worker_first=["/api/*"]. `wrangler deploy --dry-run` and full e2e pass.
Sage's repo needs: upload v0.4 changed files + re-apply D1 id/KV id/secret in
wrangler.toml.

Working and verified end-to-end (automated browser test + 9 parser unit tests
against the 8 real trip PDFs):
- Auth: PBKDF2 + server-side sessions, admin-created accounts, forced first
  password change, EN/BM per-user toggle
- Trips seeded: "Jelajah Jepun 2026" (29 Nov–7 Dec), all 16 participants from the
  Trip.com/Airbnb documents
- Documents: drag-drop PDF → in-browser pdf.js text extraction → parser registry
  (tripcom-receipt, tripcom-itinerary, airbnb-confirmation, generic fallback) →
  review screen with auto passenger↔participant matching → confirm creates expense;
  originals archived in R2, re-downloadable; duplicate booking-no warning
- Ledger: categories, per-person shares (equal or custom), original currency +
  FX-rate + MYR, edit/delete, manual expenses, instalment due dates (ATOME)
- Payments: admin-recorded repayments, lump sums applied oldest-first, credit
  tracking, per-pair statements
- Dashboard: countdown/Day-N/days-since, trip total, spend by category, largest
  outstanding, due dates, private per-user checklist
- FX: frankfurter.dev historical rate by payment date, cached in D1, manual override

## Verified test results
- Parser accuracy on the 8 real docs: all key fields (booking no, totals, dates,
  passengers, flight legs, check-in/out) extracted; e.g. Visa receipt → RM 5,508,
  3 pax, OD872/D7533 legs; Airbnb Tokyo → RM 7,277.06, 29 Nov–3 Dec, HM3AA22BW2
- Split maths: 5,508/3 = 1,836 each; RM 500 lump sum → remaining 1,336 ✓

## Done — Phase 2 planner, v0.5 (`jelajah-v0.5.zip`)
- Plan tab: day/week/month views; auto-seeded events from booked flights/stays,
  flight times enriched from itinerary PDFs matched by booking number; activities
  with time, notes, est cost, Nominatim place search + Leaflet/OSM pin, per-day
  route polyline, Google Maps transit deep links; participant selection with
  reusable named groups; done/strike-off; admin CRUD.
- Member feature visibility: per-trip admin toggles hide Plan/Documents/Ledger/
  Payments from members — enforced in tabs, dashboard widgets AND API (403).
- DB v2 upgrades ship in-app and auto-apply on first request after deploy
  (activities, groups, trips.hidden_features) — no manual SQL for Sage.
- Responsive audit: 7 pages × 360/768/1280px, zero horizontal overflow; mobile
  polish (calendar dots, tighter paddings, modal scroll).
- Verified: 14-step e2e (Phase 1 + 2, incl. member-view enforcement) + 9 parser
  tests pass; e2e now hermetic (external tile/geocode requests blocked in test).

## Done — v0.6 "Getting Around & My Money" (`jelajah-v0.6.zip`)
Spec: claude/jelajah-v0.6-spec.md (approved). Highlights:
- Travel legs: day chain start→activities→end; mode auto-recommend by distance
  (walk ≤1km / train ≤40km / intercity; taxi alt), ¥+RM fare estimates (metro
  bands, taxi meter formula) in shared/fares.ts (7 unit tests), per-leg override
  + Google Maps transit deep links; "log actual fare" → shared ledger (admin) or
  private tracker; day start/end defaults to that night's accommodation
  (geocodable pin stored on the expense), per-day or whole-trip overrides.
- Map switched to CARTO Voyager tiles (English labels).
- Dashboards: "Up next" widget (admin: next 3 full schedule; member: their own
  next activity + whole-group events); member dashboard personalised; My spend tile.
- My spend: private per-trip tracker (JPY default + FX), behalf-of note,
  promote-to-shared-ledger (equal split, payer = promoter); admin has NO
  endpoint/UI to read others' items — privacy asserted in e2e.
- AirAsia/MOVE invoice parser (booking no, guests, totals, payment; note: these
  invoices carry no flight route — set on review) — tested on Sage's 2 real PDFs.
- Document deletion for any file incl. mistaken uploads; linked expense survives
  unlinked. 21-step e2e green; 18 parser+fares unit tests; mobile 360px clean.

## Done — v0.7 (`jelajah-v0.7.zip`)
- Due dates: each row on an expense is now either "whole payment" or tied to one
  participant (schema: due_dates.participant_id, auto-upgraded). Dashboard shows
  👤 name badges; members see whole-payment dues + their own only.
- Plan CSV template: Export CSV / Blank template / Import CSV on the Plan tab
  (admin). Columns: id,day,start_time,end_time,title,notes,location_name,lat,lng,
  est_cost_myr,participants(ALL or ;-separated names),done. Import shows a
  preview (New vs Update badges, row errors), then bulk-upserts via
  POST /trips/:id/activities/bulk — id present updates, blank creates, never
  deletes. Map pins update from lat/lng. shared/csv.ts (RFC-4180-ish, 4 unit tests).
- e2e now 24 steps: CSV export→edit→import round trip verified (new row with ALL
  participants + coords, time change applied), per-person due date rendered.
  22 unit tests total.

## Done — v0.8 (`jelajah-v0.8.zip`)
- Due-date rows on the dashboard link to /payments?expense=&participant= which
  auto-opens the matching statement modal with the item highlighted (hl-row).
- Settlement: statement modal gains per-item "Settle" and "Settle all remaining"
  (admin). Targeted payments: payments.expense_id (auto-upgraded); balance engine
  applies targeted payments to their item first, then remainder + lump sums
  oldest-first — e2e proves settling a newer item leaves older debt untouched.
- Breakdown tooltips (hover on desktop, tap on mobile) on spending-chart category
  rows and largest-outstanding rows (top 6 items + "+n more").
- Spending chart Category|Item toggle; by-item bars sorted desc in a scroll cap.
- Scroll caps: dashboard outstanding (~5 rows) and Payments balances (>5 people).
- e2e now 27 steps, all green; 22 unit tests.

## Done — v0.9 (`jelajah-v0.9.zip`)
- New `airasia-itinerary` parser for AirAsia's point-by-point itinerary PDFs:
  booking no, guests ("Name (adult)" pairs), and multi-leg flights with dates
  resolved from the "Depart: <full date>" year anchor incl. overnight/month
  rollovers (tested: KUL→BKK→NRT 28/29 Nov; KIX→TPE→KUL→MYY Dec 7→8 with
  technical stop, 3 legs, flight nos normalized AK892/XJ602/D7379/AK5651).
  Booking nos match the AirAsia invoices (AJ6ZYE/SH3P9K) so plan auto-events
  gain full flight times via the existing enrichment.
- Documents bulk delete: admin checkboxes + select-all + "Delete selected (n)"
  with one confirm; linked expenses survive unlinked. e2e: 29 steps green;
  24 unit tests.

## Done — v0.10 "Craft & Flow" (`jelajah-v0.10.zip`)
Spec: claude/jelajah-v0.10-spec.md (approved). All items shipped & verified:
- Precise locations: Photon geocoder (Nominatim fallback) in the activity modal;
  after saving a located activity the 3 nearest rail/subway stations (Overpass,
  1.6 km) are cached on it (stations_json) with a picker to choose another line.
  Travel legs become station-aware: walk→🚇 stationA→stationB→walk with metro
  fare from real station distance. All free APIs, no keys.
- Reorder + smart reflow: admin drag-drop or ▲▼ on day activities; durations are
  preserved, the first activity anchors at the day's earliest start, every later
  start = previous end + re-estimated travel for the NEW order (round-up 5 min);
  untimed items keep order; Undo restores the previous times (shared/reflow.ts,
  5 unit tests; e2e proves Sensoji→10:30 anchor, teamLab reflowed to 12:00, undo).
- Dashboard 🗺️ Journey card: one map with ✈️ dashed arcs between airports
  (built-in IATA table + city keywords, shared/airports.ts), 🏨 stay pins,
  numbered 📍 activity pins, trip-accent colouring, stat chips (flights/stays/
  places/total km).
- Trip personalisation: emoji picker (20 presets + free input) and 8 accent
  colours on trip create; accent recolours the whole trip UI + trips-list card.
- Foreign-CSV mapping wizard (Plan → "Map columns…"): upload any client
  spreadsheet, columns auto-guessed from headers, day forward-fill over merged
  rows, "11:00–13:00" ranges split, text-in-time-column → notes, Overnight →
  🛏️ lodging activity, per-day ¥ budget columns → display-only budget strip
  (never touches the ledger), optional geocode-all preview, saved import
  profiles. Verified against the real Kyushu campervan CSV (8 wizard unit tests
  + e2e import: 10 days, times, notes, lodging, ¥20,000 D1 budget).
- Pay-at-hotel vouchers: new tripcom-hotel-voucher parser (Asahikawa voucher:
  names, dates/times, confirmation no, RM 706.07). "Committed, not owed":
  expense saved with payment_status=pay_at_hotel is EXCLUDED from balances,
  shows 🏨💤 badge in ledger + committed total beside trip total, auto due date
  on check-in day; one-tap "Mark paid" moves it into balances (e2e-proven).
- Map tiles: CARTO Voyager → auto-fallback to keyless openstreetmap.org tiles
  after 3 tile errors (fixes the "API key" prompt); window.JELAJAH_TILE_URL
  override supported for a custom provider.
- Fixed: members could briefly see money widgets while balances were still
  loading (now hidden until the 403/data resolves).
- Tests: 38 unit tests; e2e now 31 steps incl. 360px mobile checks, all green.
- DB v5 upgrades auto-apply on deploy (trips.color, expenses.payment_status/
  lat/lng, activities.stations_json, day_budgets, import_profiles, targeted
  due-date/payment columns) — as always, no manual SQL for Sage.

## Done — v0.11 "Read Anything" (`jelajah-v0.11.zip`)
Spec: claude/jelajah-v0.11-spec.md (approved). General extraction for documents
no dedicated parser knows — future users' receipts, other airlines, scans:
- Universal keyword extractor (shared/keywords.ts, pure): typed candidates
  from any text — dates in EN/BM/JP/CN formats with roles (check-in/out, due,
  payment, departure) incl. two-column "Check-in Check-out / date date" layouts;
  amounts with currency, context-scored so a labelled "Grand total / jumlah /
  合計" beats a bigger unlabelled number; booking refs (labelled codes + bare
  PNRs, same-line matching); flight numbers (60+ airline codes) and IATA
  routes; person names incl. Malaysian BIN/BINTI/A/L patterns with company
  names (SDN BHD etc.) filtered out; vendor brands + sender domains; payment
  methods incl. CJK terms.
- Generic parser rebuilt on the extractor: best guesses fill the form
  (category from flights/check-in signals, top-scored total, dates by role,
  booking no, people) and the full candidate set rides along in parsed_json.
  Dedicated parsers unchanged and still win.
- In-browser OCR (Tesseract.js, free, no keys): Documents now accepts
  JPG/PNG photos; PDFs with no embedded text are detected as scans and
  rendered page-by-page for OCR. Language chips: English+Malay preselected
  (packs ship inside the app — work even if the CDN is unreachable), Japanese
  & Chinese one tap (download once from jsDelivr, ~15–18 MB, browser-cached;
  choice remembered). Progress bar; "Upload as-is" fallback. Worker + wasm
  core served by the app itself. App zip grew to ~11 MB because of this.
- Review "Detected keywords" panel for generic/OCR docs: chips grouped
  📅/💰/🔖/✈️/👤/🏪/💳; tap fills the field (dates via a Date/Check-out/
  Payment/+Due target switch; names toggle the matched participant; refs set
  booking no; flights append to description). Image documents preview inline.
- Tests: 50 unit tests (12 new: real fixtures + synthetic BM/JP/CN receipts
  + an OCR-layout regression where "OFFICIAL RECEIPT" on its own line ate the
  real "Receipt no:" match). e2e now 33 steps: renders a fake receipt PNG in
  the browser, OCRs it hermetically with the local eng+msa packs, verifies
  chips (amount/date/ref present, name chip toggles participant, date chip
  fills payment date), confirms into ledger. All green.
- Caveat for Sage: Japanese/Chinese OCR quality should be confirmed on the
  live site with a real receipt photo — the build sandbox cannot fetch those
  packs. English/Malay verified end-to-end.

## Done — v0.12 "Assistant & Open Doors" (`jelajah-v0.12.zip`)
Spec: claude/jelajah-v0.12-spec.md (approved; several extra requests landed
mid-build and shipped in the same version). Highlights:
- **AI assistant (bring your own free key)**: admin Settings page speaking the
  OpenAI-compatible format — one-tap presets for Gemini (free,
  aistudio.google.com, no card), OpenRouter and Groq; key stored server-side
  only (UI shows ••••last4); Test connection button. All AI calls proxy
  through the Worker.
- **✨ Itinerary suggestions**: free-text ask scoped to a day or the whole
  trip; server sends trip context + free slots, demands strict JSON;
  validated cards (day snap, duration clamp, category) with Add / Add all —
  added activities get geocoded pins + nearest-station cache like hand-added
  ones. Nothing writes without a tap; calm rate-limit messaging.
- **💬 Trip Q&A drawer** on all trip tabs: English / Bahasa Malaysia /
  Bahasa Melayu Sarawak (kamek/kitak prompt-steered, flagged approximate).
  Context is built server-side PER ASKING USER mirroring visibility rules
  (hidden features, member-only balances, own My-spend). Chats stay in
  browser memory. "Assistant" joined the feature-hiding toggles.
- **MCP server at /api/mcp** (Streamable HTTP, JSON-RPC 2.0, protocol
  2025-03-26): personal access tokens (SHA-256-hashed, shown once, revocable;
  member tokens = member permissions). 8 tools: list_trips, get_itinerary,
  get_balances, get_expenses (read-only), suggest_free_slots, add_activity /
  update_activity / delete_activity (admin tokens only; place geocoded
  server-side). Settings shows copy-paste setup for Claude Code / Desktop /
  Codex. Note for Sage: no wrangler.toml change needed — MCP lives under
  /api/*.
- **Toast confirmations everywhere**: global system (trip-accent ✓,
  auto-dismiss, aria-live; errors persist) wired to People, Ledger, Payments,
  Plan, Review, Trips, My spend, Settings, tokens.
- **✈️ Upload progress**: plane-on-a-track strip with n/total + current file
  + per-file errors in a dismissible list; dropzone disabled mid-batch so
  documents can't stack; summary toast.
- **My-spend peer tagging** (new request): tag trip participants on a private
  item → equal shares (optional include-me divisor); tagged users see
  "I owe" with the owner's name; owner marks shares received; Owed-to-me /
  I-owe stat tiles. Admin provably still sees none of it (e2e).
- **Flight/stay participant tags** (new request): auto events carry the
  booking's share participants; Plan shows 👥 names when a booking isn't for
  everyone; member dashboards only list their own flights.
- **Members can edit the plan** (new request): per-trip toggle on People;
  when on, members can add/edit/reorder/strike activities — enforced
  server-side (403 both proven in e2e).
- **Activity categories** (new request): activities.category
  (sightseeing/food/transport/lodging/shopping/other) with icons in the plan,
  modal select, CSV template column, wizard Category + Price column mapping
  (auto-categorised from titles when unmapped; ¥ prices stored as MYR
  estimates), and category support in MCP + AI suggestions.
- **Fixes**: Plan day view now honours the saved order (untimed activities no
  longer snap to the bottom; same-time ties stable; drag ghost cleared) —
  the reported drag/arrow bug; map pin tips now anchor exactly on their
  coordinate (were ~4 px south); GET /participants locked to admins (a member
  could previously list all participant names — found in the per-trip
  isolation audit Sage requested; all other routes verified strictly
  trip-scoped; payments/balances confirmed strictly per-trip).
- Schema v6 auto-upgrades: app_settings, api_tokens, personal_shares,
  trips.member_can_edit_plan, activities.category. New columns are now added
  to BOTH the SCHEMA creates and UPGRADES alters (fresh-install ordering bug
  found and fixed in testing).
- Tests: 58 unit tests; e2e now 40 steps incl. a hermetic mock AI provider
  and a full MCP handshake from outside the app; all green.
- Live-site caveat: the first real Gemini call happens on the deployed site
  (sandbox cannot reach Google); everything else e2e-tested here.

## Done — v0.12.1 patch (`jelajah-v0.12.1.zip`)
Sage's first live Gemini test failed with the generic "provider returned an
error" despite a valid key. Root cause: Google removed `gemini-2.0-flash`
(the preset default) from the free API on 9 June 2026 → 404 model-not-found.
- Gemini preset now `gemini-2.5-flash` (the direct free-tier replacement;
  the model field stays editable so future retirements are a UI edit, not a
  redeploy). Immediate fix on an un-patched deploy: type gemini-2.5-flash
  into the Model field and Test again.
- Provider errors now surface the upstream message (e.g. Gemini's
  "models/… is not found") in Settings → Test connection instead of a blind
  generic line; ApiError now carries the response body to the client.
- Thinking-model fix: 2.5-flash spends tokens on internal reasoning, so the
  Test call's 20-token cap could yield an empty reply even when everything
  worked; budgets raised (test 1024, assistant calls 3000/2000) and an
  explicit "model spent the budget thinking" error added.
- Deploy-safety: from this zip onward `wrangler.toml` is NOT in the zip, so
  drag-uploading everything to GitHub can never clobber Sage's configured
  bindings again (the earlier failed deploy was exactly that — placeholder
  KV id overwrote the real one).
- Full 40-step e2e + 58 unit tests re-run green; 404-detail path verified
  against a mock returning Google's exact error shape.

## Done — v0.12.2 patch (`jelajah-v0.12.2.zip`)
Sage's valid key still failed after v0.12.1 — the key began with `AQ.`:
Google's NEW AI Studio key format (replacing `AIza…`), which is known to be
rejected by Gemini's OpenAI-compatible endpoint under Bearer auth while
working on the native API. Fix: any googleapis base URL now routes to the
NATIVE generateContent API server-side (x-goog-api-key header; messages
translated OpenAI↔Gemini in shared/assistant.ts, unit-tested), so both key
formats work. Other providers still use the compat path. Gemini preset base
URL simplified to https://generativelanguage.googleapis.com; Settings hint
notes both key formats. 61 unit tests + full 40-step e2e green. Also told
Sage to rotate the key he pasted into chat.

## Done — v0.12.3 patch (`jelajah-v0.12.3-handover.zip`)
Sage tried adding Jelajah as a claude.ai custom connector and got "Couldn't
reach Jelajah" (ofid ref). Root cause: claude.ai connectors support only open
or full-OAuth MCP servers — there is no field for a bearer token, so our
(correct) 401 reads as unreachable. Fix: a second endpoint
`/api/mcp/t/<token>` carries the same revocable personal token in the URL for
header-less clients; Settings' MCP card documents it with a
treat-the-URL-as-secret warning. Header endpoint unchanged for Claude Code /
Desktop / Codex. e2e extended (path init OK, wrong token 401, revoked token
dies on both endpoints); full suite green. Optional future: real OAuth flow
for the polished claude.ai "Connect" experience.

## Done — v0.13 "Snappy Days" (`jelajah-v0.13.zip`)
Sage's asks: bulk delete for the plan, fix the sluggish feel of checkboxes and
moves on Plan/People, and a per-day notes area so the timeline stays pure
activities.
- Instant UI (optimistic updates): the done checkbox, ▲▼/drag reorder, single
  delete (Plan) and the member chips / visibility / members-can-edit-plan
  toggles (People) now update local state immediately and send the write in
  the background — no more waiting on the heavy full-plan refetch per click.
  A failed write reverts the control and shows a persistent red toast
  (`tSaveFailed`, EN+BM); reorder/delete failures also trigger a reload to
  resync. People keeps an in-flight counter so a background context refresh
  never clobbers rapid chip toggling.
- Bulk delete (Plan): per-trip endpoint `POST /trips/:id/activities/delete`
  {ids} — one canEditPlan check, rows filtered to the trip, one D1 batch
  (activity_participants + activities), audited, returns {deleted}. UI: a
  "☑️ Select" toggle in the day header (canEdit-gated), per-row checkboxes,
  a Select-all-for-this-day bar, one confirm, "n activities deleted" toast,
  list updates instantly.
- Day notes (new `day_notes` table — in BOTH SCHEMA and UPGRADES per the
  fresh-DB rule): per-day plain notes or ☑️ checklist items under each day's
  timeline. Add/tick/delete gated by canEditPlan (members see them read-only
  unless the edit toggle is on); ticking is optimistic; included in the plan
  payload (`dayNotes`). Routes: POST /trips/:id/daynotes, PATCH/DELETE
  /daynotes/:id.
- Also ships the corrected Claude Desktop connector instructions in Settings
  (token-URL for the Connectors UI; mcp-remote bridge JSON for the config
  file — the old invalid "type":"http" snippet is gone), previously applied
  but unverified.
- Verified: tsc clean, 61 unit tests, full e2e green including new steps —
  optimistic done-toggle persisted server-side, notes+checklist add/tick/
  delete persisted, bulk delete removes only the selected day's rows and
  other days untouched. Version 0.13.0; zip has no wrangler.toml. Deploy is
  the usual: upload changed files, no manual SQL (day_notes auto-creates).

## v0.14.0 — "Say what the day is" (1 Sep 2026)

**Timezone bug found and fixed first (this was live).** `daysBetween` in
`Plan.tsx` built the day list with `new Date(day + 'T00:00:00')` and then
`.toISOString()`, which re-projects local midnight into UTC. Anywhere east of
Greenwich — Malaysia is UTC+8 — every plan day rendered one day early and the
trip grew a phantom extra day: the Japan trip showed **D1 = Sat 28 Nov** for a
trip starting 29 Nov, with 10 chips for 9 days. The same class of bug shifted
Dashboard's "Up next" for early-morning events. Day arithmetic now lives in
`shared/days.ts` (`ymd`, `todayYmd`, `daysBetween`) with 11 unit tests that
pin the local calendar. Never use `toISOString()` on a Date that represents a
calendar day.

Then the four requested changes:

- **One Data button.** Export CSV / Import CSV / Map columns… / Blank template
  collapsed into a single `📊 Data ▾` menu on the Plan toolbar. Each row
  carries a plain-language line saying what it does (EN + BM), so the CSV
  round trip explains itself. A popover, not a `title=` tooltip — native
  tooltips never appear on the phones the family actually use.
- **Day titles.** `day_settings.title` (in SCHEMA *and* UPGRADES) names what a
  day is about; shown under the D1..Dx chip and beside the day heading, edited
  inline by anyone who can edit the plan. `PUT /trips/:id/daysettings` now
  writes only the columns present in the body, so naming a day cannot wipe its
  start/end point and vice versa.
- **Pins synced to the plan.** The map numbered its pins by array position and
  the list showed nothing, so "which stop is pin 3?" was unanswerable. One
  numbering now feeds both (`shared/pins.ts`): **pin 1 is always the
  accommodation** the day starts from, then each located activity in plan
  order. List rows show the matching numbered badge, tapping one pans the map
  and opens that pin, and an activity with no coordinates shows a dashed "—"
  instead of pretending to have a pin.
- **Notes reach the AI and MCP.** Day notes, checklist state and day titles now
  go into the model context for both the chat drawer and AI suggestions, and
  the suggestion prompt is told to respect a day's theme and act on unticked
  items. MCP gained five tools (8 → 13): `get_notes`, `add_note`,
  `update_note`, `delete_note`, `set_day_title`; `get_itinerary` returns
  `notes` and `day_titles`. Writes stay admin-token-only; member tokens read
  notes but cannot write them.

Tests: 79 unit (was 61: +11 days, +5 pins, +2 assistant prompt) and the full
e2e suite green, with new steps for the day title (persist, reload, no-clobber),
pin↔list numbering (before and after a start point exists) and the MCP notes
round trip. `scripts/e2e.mjs` and `scripts/responsive.mjs` now fall back to
Playwright's own Chromium when `/opt/pw-browsers/chromium` is absent, so the
suite runs on a normal Mac as well as in the cloud sandbox.

Version 0.14.0. No manual SQL — `day_settings.title` auto-adds on first load.

## Handover prepared (31 Aug 2026)
Sage is moving development to another Claude account. The repo is now the
single source of truth: `HANDOVER.md` (root) + `docs/` (build-status, the
DEV-RUNBOOK with every operational trap and invariant, and all five specs)
were baked into `jelajah-v0.12.2-handover.zip` for upload to GitHub. Sage
received SAGE-HANDOVER-CHECKLIST.md with a paste-ready first message that
makes the new assistant read the docs, run both test suites (61 unit /
40-step e2e) and summarise the constraints back before touching code.

## Next — remaining spec items
As of v0.18: rooms allocation (admin assigns people per accommodation),
PWA/offline itinerary, insights beyond the admin dashboard (v0.18 shipped
usage/growth stats — deeper per-trip spend/itinerary insights are still
open), and a full-app BM audit (v0.18's BM pass covered only the strings it
touched).

## Notes / open items for Sage
- R2 needs a payment card on file to enable (stays free within limits)
- Upload the remaining outbound-flight receipts for the other 13 travellers when found
- ATOME instalment due dates to be entered on the review screens
- Map tile "API key" prompt: fixed in v0.10 by auto-fallback; no key needed.
  Optional: a free MapTiler key via window.JELAJAH_TILE_URL if fancier styles
  are ever wanted.
- v0.12 setup: create a free Gemini key at aistudio.google.com, paste it in
  ⚙️ Settings (Gemini preset, model gemini-2.5-flash), press Test connection.
  For MCP: make a token in Settings and add the /api/mcp URL to Claude Code /
  Codex per the snippets shown there.
- wrangler.toml lives only in Sage's repo now — zips no longer contain it. If
  a future version ever needs a new binding, the exact lines to add will be
  spelled out in the delivery message.
