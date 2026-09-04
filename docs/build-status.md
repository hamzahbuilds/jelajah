# Jelajah — Build Status

Updated: 4 Sep 2026 (v0.15)

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
Rooms allocation (admin assigns people per accommodation), PWA/offline
itinerary, insights, full BM copy review.

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
