# Jelajah — Development Runbook

For the AI (or human) developer taking over. Everything here was learned the
hard way; skipping steps re-earns the lessons.

## 1. Environment bootstrap

```bash
cd jelajah
npm install
npm i -D playwright        # NOT in package.json on purpose — see §6
# Playwright browser: if a preinstalled Chromium exists (e.g. Claude's cloud
# sandbox has /opt/pw-browsers/chromium), scripts/e2e.mjs uses executablePath.
# Elsewhere: npx playwright install chromium
```

Toolchain: Node 20+, TypeScript project refs (`npx tsc -b`), Vite 7, Hono,
wrangler 4. `npm run build` = `tsc -b && vite build`.

## 2. Local dev server + seeding (THE RITUAL)

The local stack is `wrangler dev` (workerd + miniflare D1/KV, state under
`.wrangler/state`). The exact reset-and-run sequence:

```bash
# 1. kill EVERYTHING first — orphan workerd processes silently hold :8788 and
#    serve STALE code/DB, causing baffling 500s and invalid_login
ps aux | grep -E "[w]orkerd|[n]ode.*wrangler" | awk '{print $2}' | xargs -r kill -9
sleep 2

# 2. wipe local state and reseed (admin@jelajah.local / ubah-saya-123,
#    16 participants, Japan trip — regenerate seed.sql via `npm run seed:gen`)
rm -rf .wrangler/state
npm run db:local

# 3. start dev — in unstable sandboxes wrangler dev sometimes gets OOM-killed,
#    so run it under a restart loop:
cat > /tmp/devloop.sh << 'SH'
#!/bin/bash
cd "$(dirname "$0")/../jelajah" 2>/dev/null || cd /path/to/jelajah
while [ ! -f /tmp/devloop.stop ]; do
  npx wrangler dev --port 8788 >> /tmp/wrangler.log 2>&1
  sleep 2
done
SH
chmod +x /tmp/devloop.sh; rm -f /tmp/devloop.stop /tmp/wrangler.log
(setsid nohup /tmp/devloop.sh >/dev/null 2>&1 &)
sleep 18 && curl -s http://127.0.0.1:8788/api/health
```

Traps (all hit in practice):
- `pkill` can exit 144 and kill your own shell command chain — kill by explicit
  PIDs as above, and never chain `kill` with `&&` into the same command as the
  work that follows.
- After a partial e2e run the admin password is `kata-laluan-baru-99`, not the
  seed password (the suite exercises the forced password change). ALWAYS reset
  state before a full e2e run.
- `wrangler dev` rebuilds on file save, but an already-running isolate may be
  stale for a few seconds — a mysteriously failing endpoint right after an edit
  usually just needs one retry.
- Shell cwd resets between separate tool calls — use absolute paths or cd every time.
- Seeding note: `POST /api/setup` needs `{name,email,password,seedJapanTrip:true}`;
  `npm run db:local` (migration + scripts/seed.sql) is what the e2e expects
  (it sets must_change_password=1, which the suite tests).

## 3. Tests

```bash
npx vitest run          # 61 unit tests: parsers vs REAL PDFs' extracted text
                        # (tests/fixtures/*.txt), fares, csv, reflow, wizard,
                        # keywords (incl. BM/JP/CN), assistant (suggestions,
                        # free slots, Gemini native translation)
node scripts/e2e.mjs    # 40-step Playwright suite vs :8788 — THE regression bar
```

e2e rules that keep it green:
- **Hermetic**: `blockExternal` aborts all non-localhost requests on every page
  (tiles, geocoders, FX are unreachable in sandboxes and stall page loads).
  Any new page/context in the suite MUST get `blockExternal(p)` +
  `setDefaultTimeout(25000)` and (if it confirms dialogs) a dialog handler.
- The suite runs its own mock OpenAI-compatible provider on 127.0.0.1:9797 —
  if a previous run died, `EADDRINUSE` follows; kill leftover node processes.
- OCR steps use the eng+msa language packs shipped in `public/tess/lang` — no
  network needed.
- Playwright text= matching is case-insensitive substring of TEXT NODES — a
  value inside an <input> never matches `text=...`; assert `inputValue()`.
- `waitForSelector` defaults to "visible" — a `hidden` file input needs
  `{ state: 'attached' }`.
- Toggle-style assertions: a click on an already-on state turns it OFF — assert
  the precondition first (see the name-chip test).
- Full-run wall time ≈ 3 min. After ANY code change: reset state (§2), rerun
  the FULL suite. Never ship on a partial run.

## 4. Schema changes (CRITICAL)

Lazy idempotent upgrades: `server/lib/schema.ts` exports `SCHEMA` (CREATEs)
and `UPGRADES` (ALTERs + filtered CREATEs), run once per isolate on first
request with failures swallowed. Sage never runs SQL.

**A new column MUST be added in BOTH places**: the CREATE TABLE in `SCHEMA`
AND an `ALTER TABLE ... ADD COLUMN` in `UPGRADES`. On a fresh DB the ALTER
runs before the table exists (fails, swallowed) and the CREATE builds the
table — if the CREATE lacks the column, fresh installs break while upgraded
ones work (this bug shipped briefly during v0.12 development; don't repeat it).
A new table goes in `SCHEMA` + add its name to the CREATE-filter regex in
`UPGRADES`.

## 5. Conventions & invariants (do not regress)

- **Free tier, no credit card, no API keys** for core features. KV for files
  (isKV duck-typing; R2 is a drop-in swap). Fares/stations are estimates from
  free OSM data. The ONLY key in the system is the admin's own optional AI key.
- **Parsers are rule-based** and built against real documents in
  `docs-samples/` with extracted text fixtures in `tests/fixtures/` (generated
  by `scripts/extract-text.mjs`, which mirrors `src/pdf.ts` line
  reconstruction exactly — keep them identical). New vendor = new file in
  `shared/parsers/` + registry entry + unit test against a real document.
- **My-spend privacy**: no endpoint may return another user's personal rows to
  anyone, including admins — asserted in e2e twice. Peer shares are visible
  only to the owner and the tagged participant.
- **Balances engine** (`computeBalances` in server/app.ts): targeted payments
  hit their expense first, then remainder + lump sums oldest-first; credit
  tracked; `pay_at_hotel` expenses are excluded until marked paid. e2e proves
  targeted settlement leaves older debt untouched — keep that test passing.
- **Feature-hiding** ('plan','documents','ledger','payments','assistant') is
  enforced in tabs AND API (403) AND AI context AND MCP. New endpoints must
  call `assertTripAccess` + `hiddenFor` (or `canEditPlan` for plan writes).
- **i18n**: every string through `src/i18n.tsx`, EN + BM both, always.
- **Toasts**: every add/save/delete gets a toast (components/Toast.tsx).
- **dataviz**: charts use single-hue bars (--data teal), text in ink tokens.
- **AI**: providers via OpenAI-compatible `/chat/completions` EXCEPT any
  googleapis base URL, which routes to Gemini's native generateContent
  (x-goog-api-key) because AQ.-format keys break the compat layer. The model
  proposes; a human always taps to apply. AI never writes money data.
- **MCP** (`/api/mcp`): bearer tokens (SHA-256-hashed), member tokens get
  member visibility, mutations admin-only, money read-only. It lives under
  /api/* precisely so wrangler.toml never needs changes.

## 6. Packaging & delivery to Sage

Sage deploys by drag-uploading files to GitHub (browser only, no terminal);
Cloudflare Workers git-integration runs `npm run build` then `npx wrangler deploy`.

```bash
npm pkg set version=0.X.0
npm pkg delete devDependencies.playwright   # its postinstall breaks CF CI
zip -qr jelajah-v0.X.zip . -x "node_modules/*" -x "dist/*" -x ".wrangler/*" \
  -x "e2e-shots/*" -x "*.zip" -x ".git/*" -x "wrangler.toml"
npm i -D playwright                          # restore for local e2e
```

- **NEVER ship wrangler.toml** — Sage's live copy holds his real D1 id, KV id
  and SESSION_SECRET; a placeholder overwrite broke a deploy once. If a new
  binding is ever required, give him the exact lines to add in the delivery
  message.
- Deliver the zip + screenshots of the new features, then update
  docs/build-status.md (and the claude.ai project doc if one is attached).
- Cadence with Sage: clarifying questions → plan → approval → spec (saved to
  the project) → build → verify → deliver → update build-status. He often adds
  requirements mid-build; fold them in and note them in the spec's addendum.

## 7. Known environment caveats

- Sandboxes usually block egress to frankfurter/tiles/Photon/Overpass/Google:
  FX falls back to manual rate entry, tiles go grey (fine — fallback chain is
  the feature), geocoding returns empty, Gemini is untestable live (use the
  e2e mock provider; first real call happens on Sage's deployed site).
- Google retires Gemini models and changes key formats — when "provider
  returned an error" appears, read the surfaced detail first; the model name
  is the usual suspect. Current known-good free model: gemini-2.5-flash.
- workerd in constrained sandboxes occasionally dies ("Killed"); the devloop
  in §2 is the mitigation.

## 8. Current backlog (agreed with Sage, in priority order)

1. Rooms allocation (admin assigns people per accommodation; PRD story 11).
2. PWA install + offline itinerary caching (for use in Japan).
3. Financial insights page (burn/day, planned vs actual, per-person cost).
4. Full BM copy review pass.
Open user follow-ups: remaining outbound-flight receipts to upload; ATOME due
dates to enter on review screens; JP/CN OCR quality + live Gemini to confirm
on the deployed site.
