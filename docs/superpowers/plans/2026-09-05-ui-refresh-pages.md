# UI Refresh Pages (P4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Executes only after the foundation plan (2026-09-05-ui-refresh-foundation.md) is complete and e2e-green.

**Goal:** Migrate every page to the v0.19 design system — new components, icons, empty states, charts and the auth split layout — preserving all behavior, with e2e green at the end.

**Architecture:** Presentational restyles per page using the landed foundation (tokens, Icon, btn2/badge2/card2/lrow/seg2/fld/empty CSS, Modal/Menu/Sheet/Toast, sidebar + tab bar). No server/schema/API changes. Each task = one page group, independently shippable.

**Tech Stack:** unchanged (React 19, plain CSS, vitest, Playwright e2e).

**Spec:** `docs/07-spec-v0.19-design-system.md`. Visual reference per task: the matching `design/ui-refresh/*.html` prototype page.

## Global Constraints

(Same as foundation plan — RM0/no new deps/no CDN; t() EN+BM parity; money math + My-spend privacy + role gating untouched; Leader never Admin; icons via <Icon> with viewBox, no functional emoji; dark -700 text overrides; 44px targets; reduced-motion; no server/ or shared/ or schema edits; no git commits (Sage commits); after each task `npx vitest run` + `npx tsc --noEmit` + `npm run build` green; e2e selectors fixed in the SAME task that breaks them, full ritual at final task.)

**Standing rulings carried in:** `.stat2`/`.seg2` naming; navModel is the single nav truth; TripShell fetch-error state fixed in Task 1 here; auth images = bundled CSS-gradient/SVG destination cards (no licensed photos yet — swap point documented; no picsum, no external fetches).

---

### Task 1: Page scaffolding + Trips (Home) page

**Files:** Create `src/components/PageHead.tsx` (crumb/h1/sub/actions per prototype `.pagehead`), `src/components/Empty.tsx` (icon/title/sub/action using `.empty` CSS). Modify `src/pages/Trips.tsx`, `src/pages/TripShell.tsx` (error state), `src/styles.css` (tripcard styles from `design/ui-refresh/00-trips.html` <style>, gradient covers — NO picsum: cover = brand-gradient tile + trip emoji at 44px/.35 opacity), `src/i18n.tsx`.
**Reference:** `design/ui-refresh/00-trips.html`.
- [ ] PageHead + Empty components (props typed, labels via t()).
- [ ] Trips.tsx → card grid: cover (gradient + emoji), name, destination+dates sub, member avatars if available in payload (else omit), `my_role` badge2, "days to go" chip computed via shared/days helpers (NEVER toISOString on local dates), dashed "Start a new trip" card + existing create flow inside Modal, empty state for zero trips ("Start your first trip"), referral hint card linking Settings.
- [ ] TripShell: failed `reload()` → error card with "Back to My trips" link (new i18n keys `tripLoadFailed`, `backToTrips`, en+ms) — kills the infinite spinner.
- [ ] Verify: vitest/tsc/build; e2e selector check (`grep -n "trip" scripts/e2e.mjs`) — update any broken by markup changes, run affected e2e section if cheap, else note for final task.

### Task 2: Dashboard + Documents + People

**Files:** `src/pages/Dashboard.tsx`, `src/pages/Documents.tsx`, `src/pages/Review.tsx` (only classNames if needed), `src/pages/People.tsx`, `src/styles.css` (minor), `src/i18n.tsx`.
**Reference:** `01-dashboard.html`, `06-documents.html`, `07-people.html`.
- [ ] Dashboard: stat2 cards with tile icons (wallet/hotel/check pattern), card2+cardhead sections, existing sparkline recolored via tokens (fill `var(--tile)` dark guardrail), Icon replaces decorative emoji.
- [ ] Documents: upload dropzone styled per prototype (dashed, upload icon), uploaded list → lrow (tile icon by doc kind, name+meta, badge2 status, eye/review actions), Empty for no documents ("Drop a booking PDF…").
- [ ] People: member list → lrow (avatar initials, name+sub, role badge2, role select for leaders styled `.fld` select), invite panel card2 with copy button + toast, danger zone card (delete trip → Modal destructive), Empty not needed (leader always present).
- [ ] Verify trio: vitest/tsc/build; i18n parity.

### Task 3: Money pages (Ledger · Payments · MySpend)

**Files:** Create `src/components/MoneyTabs.tsx` (seg2 of three NavLinks: t.ledger/t.payments/t.myspend — routes unchanged, respects hidden_features exactly as navModel does). Modify `src/pages/Ledger.tsx`, `src/pages/Payments.tsx`, `src/pages/MySpend.tsx`, `src/i18n.tsx`.
**Reference:** `03-wallet.html`.
- [ ] MoneyTabs rendered atop all three pages under a shared PageHead "Money" (crumb = trip name).
- [ ] Ledger: totals → stat2 trio (trip total / committed / settled with trend line where data exists); expense list → lrow (category tile icon, title+meta, amount+sub right-aligned tabular-nums, status badge2, edit action opens the EXISTING ExpenseForm flow — do not rebuild the form this task, wrap it in Modal only if it's already an overlay, else leave inline and restyle its fields to .fld).
- [ ] Payments: who-owes list → lrow with avatar, outstanding amounts, settle action (existing flow), badge2 statuses; Empty "Everyone's square" when no debts.
- [ ] MySpend: privacy-forward Empty when no personal entries ("Your spend stays private…" + log action); entries → lrow. PRIVACY: zero shared-surface rendering changes — verify MySpend data appears nowhere outside this page.
- [ ] Money math display: assert unchanged by running the money unit tests + eyeballing a seeded ledger; leader-only gating intact (`canLead`).
- [ ] Verify: vitest/tsc/build.

### Task 4: Settings + Admin dashboard charts

**Files:** `src/pages/Settings.tsx`, `src/pages/Admin.tsx`, create `src/components/charts/` (`LfBars.tsx` capsule bars, `LfLine.tsx` cumulative draw-in line + counter, `LfWaffle.tsx` dot waffle, `LfPunch.tsx` weekday×daypart) — hand-written SVG ONLY (license guardrail: lieflat style, zero copied code), each card carries uppercase `SOURCE ·` line. Modify `src/styles.css` (port `.lf*`, `.waffle`, `.punch`, `.lfrow` blocks from `design/ui-refresh/ui.css` v5 section), `src/i18n.tsx`, `tests/` (pure chart-data helpers: cumulative series builder, waffle rounding to 100 dots — TDD).
**Reference:** `04-admin.html`, `08-settings.html`.
- [ ] Settings: cards → card2 (referral, tokens, MCP, appearance seg2 already, language seg2), mono URL rows styled.
- [ ] Admin: wire charts to the REAL `/admin/stats` + `/admin/referrals` payloads (read server/app.ts response shapes first — read-only): signups cumulative line, feature-usage capsule bars from usage metrics, signup-source waffle if referral data distinguishes kinds (else omit waffle — no fabricated data), activity punch card ONLY if hourly buckets exist (usage_daily is daily — if no hourly data, SKIP punch card and note it; charts must be honest). Referral leaderboard → table2/lrow. Free-tier headroom card is STATIC informational copy (no fake live numbers) or omitted — implementer picks, ledger the choice.
- [ ] Chart data helpers tested (UTC bucketing per timezone rules — usage_daily is UTC domain).
- [ ] Verify: vitest/tsc/build.

### Task 5: Auth (Login + Join) split layout

**Files:** `src/pages/Login.tsx`, `src/pages/Join.tsx`, `src/styles.css` (port `.split .caro .cap .pane .authtabs .fld2 .joinbadge` from `design/ui-refresh/09-auth.html` <style>), `src/i18n.tsx`.
**Reference:** `09-auth.html`.
- [ ] Carousel WITHOUT photos: 5 destination slides as layered CSS gradients + large emoji/SVG scene per slide (bundled, RM0), same caption grammar (eyebrow/headline/hook — all via t(), BM included), 6s crossfade, dots, reduced-motion stops auto-advance. Comment marks the swap point for licensed photos later.
- [ ] Login: right pane form → fld2 fields, brand button; mobile = banner + form per prototype media rules.
- [ ] Join: SECURITY-FROZEN logic — markup/classes only; keep raw fetch, constant-shape handling, all copy keys as-is (page currently EN-only per known deferred minor — leave that). Invite context badge (trip/inviter/role) using response fields that ALREADY exist in the join payload; add nothing to the API.
- [ ] Verify: vitest/tsc/build.

### Task 6: Emoji sweep + dark pass + full e2e ritual + closeout

**Files:** any `src/**` stragglers, `scripts/e2e.mjs`, `docs/build-status.md`.
- [ ] `grep -rn "🧭\|⚙️\|🛂\|📄\|🗺\|💰\|👥\|✈️\|🏨" src/` — replace functional emoji with <Icon>; trip emblem emoji (user content) stays.
- [ ] Dark-mode audit: every page at data-theme=dark — no -700 text on dark surfaces (grep new inline styles), sparkline/chart fills use var(--tile).
- [ ] 360px pass: no horizontal scroll on any page (dev-tools check of Plan + Ledger, the two widest).
- [ ] Full e2e ritual per DEV-RUNBOOK to `E2E PASSED`; fix selectors broken by Tasks 1–5.
- [ ] build-status.md: v0.19 P4 shipped; P5 remaining (alias tokens, `2`-suffix renames, dead CSS: .tabs, old .toast, old .btn/.badge/.card once unused; BM audit).

### Not in P4 (explicitly)

Plan-page deep redesign (day rail visuals, per-mode route lines, pin-rail sync visuals from prototype 02) — that's its own plan (P4b) because Plan.tsx is the largest page and carries drag/reflow logic; this plan only gives Plan the shared chrome it inherits for free. Photo covers + Wikimedia auto-covers (needs design for KV storage — separate spec addendum). Server-side theme persistence.
