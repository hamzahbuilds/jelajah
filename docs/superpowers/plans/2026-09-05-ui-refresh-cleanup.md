# UI Refresh P5 — Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Runs after P4b (complete, e2e-green).

**Goal:** Retire every migration crutch from the v0.19 refresh — legacy classes, alias tokens, `2`-suffixed names, dead CSS — plus the parked i18n/consistency debts, leaving one clean design-system vocabulary. Zero visual or behavioral change intended anywhere.

**Architecture:** Mechanical, verification-heavy sweeps over `src/` + `scripts/e2e.mjs`. Order matters: first migrate remaining legacy-class consumers, then delete legacy CSS, then rename `2`-suffix back to bare names, then remove alias tokens. Full e2e ritual closes.

**Spec:** docs/07-spec-v0.19-design-system.md. **Ledger debts absorbed:** P4-final F2 (done in P4b-T5), F4 (legacy .card remnants, .fld gaps), F5 (Source-line/FREE_TIER EN hardcodes); foundation parked items (dead .tabs/.toast CSS, old button styles).

## Global Constraints

(Inherit P4's verbatim: no deps/CDN; t() EN+BM; server/shared/schema untouched; money+privacy+gating sacred; Leader never Admin; dark overrides; reduced-motion; 44px; vitest+tsc+build per task; e2e same-task selector fixes, ritual at end; no commits; kill pattern `ps aux | grep -E "[w]orkerd|[n]ode.*wrangler"`.)

**P5-specific rule:** every sweep step ends with a grep proving zero remaining references before deleting a rule/token. Delete nothing that still has a consumer.

---

### Task 1: Migrate remaining legacy-class consumers, delete legacy CSS

**Files:** `src/**/*.tsx` (grep-driven), `src/styles.css`, `scripts/e2e.mjs`.
- [ ] Inventory: `grep -rn 'className="[^"]*\b(btn|btn-ghost|btn-sm|btn-danger|badge|card|stat|seg|tabs|toast|table)\b' src/ --include="*.tsx" -E` minus already-new names — list every legacy usage (known: MySpend/Payments/FxWidget `.card`; ExpenseForm/record-payment/add-spend forms `.field`/`button.btn`; Review.tsx; MonthView; misc `btn-ghost`).
- [ ] Migrate each to the v0.19 equivalent (btn→btn2 [+secondary/ghost/sm/danger mapping], card→card2, field→fld where structure allows label-above-input without breaking form layout — if a form's grid depends on `.field`, convert the container too; badge ok/warn/brand→badge2 success/warning/brand). Callouts (.callout warn) STAY — they're their own component, restyle only if trivially mappable.
- [ ] Delete now-orphaned legacy CSS blocks: `.tabs`, old `.toast/.toasts`, `button.btn*`, `.badge` variants, `.card`, `.stat/.stats` (old), `.seg` (old, FxWidget/Plan migrated), `label.field`, `.barlist` if LfBars replaced all consumers (grep first — Dashboard may still use it), `.daychips` residue. Each deletion preceded by a zero-consumer grep recorded in the report. `.topbar` STAYS (mobile chrome still uses it) — only delete if TabBar fully replaced it AND nothing renders it (grep App.tsx).
- [ ] e2e selectors referencing migrated classes fixed intent-preserved.
- [ ] Verify trio + visual spot-check listed pages in report.

### Task 2: Rename `2`-suffix back to bare names

**Files:** `src/**`, `scripts/e2e.mjs`, `src/styles.css`.
- [ ] Scripted rename across tsx+css+e2e: btn2→btn, badge2→badge, card2→card, table2→table, seg2→seg, stat2→stat, toast2/toasts2→toast/toasts, menu2→menu, fld2→fld? NO — fld2 is auth-specific (different structure); keep fld2, note it. drop2 keep (no collision). Order: only AFTER Task 1 deleted the legacy rules (bare names must be free — verify with grep before renaming).
- [ ] Remove the "migration-only" comment banner.
- [ ] Guard: `grep -rn "btn2\|badge2\|card2\|table2\|seg2\|stat2\|toast2\|menu2" src/ scripts/` → zero after.
- [ ] Verify trio; e2e selectors renamed in the same sweep (they're in the sed scope).

### Task 3: Alias-token removal + i18n debt + BM audit

**Files:** `src/styles.css`, `src/**/*.tsx`, `src/pages/Admin.tsx`, `src/components/charts/*`, `src/i18n.tsx`.
- [ ] Migrate consumers of alias tokens to explicit ones: `--brand`→`--brand-700` (or -600 contextually — match rendered value exactly: --brand WAS -700), `--brand-strong`→`--brand-800`, `--data`→`--brand-600`, `--line`→`--border`, `--danger`→`--error-700` (+ dark override check per usage), `--warn-bg/--warn-ink/--ok-bg/--ok-ink`→ explicit values or badge classes, `--radius`→`--r-lg`, `--shadow`→`--shadow-xs`. Grep-zero then delete the alias block.
- [ ] F5 debt: Admin FREE_TIER_LIMITS copy + `Source · ` prefix → t() keys en+ms (`sourcePrefix` etc.); chart components take translated source strings.
- [ ] BM audit: read every v0.19-era ms key added this refresh (diff i18n.tsx vs git HEAD for the key list) — fix stilted literals; report a table of changed strings.
- [ ] Verify trio.

### Task 4: Final sweep + full e2e ritual + closeout

**Files:** `src/styles.css`, `scripts/e2e.mjs`, `docs/build-status.md`.
- [ ] Dead-CSS pass: for every class defined in styles.css, grep src/ for usage; list + delete zero-consumer rules (excluding e2e-only helper classes — check e2e.mjs too before deleting).
- [ ] Contrast pass: grep all remaining `-700`/raw-hex text colors for dark overrides; both themes eyeball via dev on Trips/Plan/Money/Admin.
- [ ] 360px re-check Plan + Ledger.
- [ ] Full e2e ritual to `E2E PASSED`.
- [ ] build-status.md: v0.19 COMPLETE (P1–P5); remaining future: photo covers spec, server-side theme, e2e mobile-chrome coverage.

## Self-review notes
- Rename order (T1 delete legacy → T2 rename) prevents the one real hazard: bare-name collision while both vocabularies live.
- fld2 exemption recorded (auth layout differs); drop2 kept.
- Every deletion gated on recorded zero-consumer greps — the plan's own guardrail.
