# v0.25 Room-Cost Splitting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Ship spec v0.25 room-cost splitting, e2e green at v0.25. MONEY-CRITICAL plan — conservation invariant + existing-mode freeze are automatic-fail review checks on every task.
**Spec:** docs/13-spec-v0.25-room-split.md (binding).

## Global Constraints
Standard battery; expense_shares stays sole balance truth; split_json never read by money math; existing split modes byte-frozen; leader gating unchanged; ritual final task (key-agnostic branches intact); kill pattern ps-aux; wipe .wrangler/state.

### Task 1: Pure engine + schema
**Files:** shared/roomSplit.ts + tests/roomSplit.test.ts (TDD, exhaustive: conservation at 2dp across adversarial cases — odd sens like RM100.01 across 3+3 occupants, 1-occupant rooms, infant-only room rejection, zero-occupant nonzero rejection, sum-mismatch throw, 16-person realistic case, infant 0-rows present), server/lib/schema.ts (expenses.split_json TEXT, SCHEMA+UPGRADES), migrations/0001_init.sql (regenerate via the established node extraction).
- [ ] Engine per spec §2 exactly; throw errors typed/coded not silent.
- [ ] Verify: vitest (new tests), tsc, build, db:local, scratch-sqlite migration check.

### Task 2: Server routes
**Files:** server/app.ts (expense create + update routes: optional split payload per spec §3; validation ladder; batch delete/insert shares + split_json; NULL split_json on non-rooms saves; GET expenses includes split_json), no other server changes.
- [ ] Read the existing expense routes FIRST; existing equal/picked share generation byte-identical (freeze).
- [ ] Validation: category gate, stay/rooms ownership, 2dp exact sum, occupants from room_occupants, roomShares() import from shared.
- [ ] Verify: tsc/build/vitest; wrangler smoke (create rooms-split expense via curl on seeded trip, assert share rows sum + split_json stored, then equal-mode expense still works).

### Task 3: Client
**Files:** src/components/ExpenseForm.tsx (rooms mode option + editor per spec §4 — read the form fully; existing modes' JSX/logic untouched), src/pages/Ledger.tsx ("By rooms" badge + drift chip + Re-apply), src/i18n.tsx (en+ms), src/styles.css minimal.
- [ ] Prefill uses the SAME largest-remainder helper (import from shared — prefill must sum exactly).
- [ ] Drift detection pure helper (shared or client-local w/ test): compare snapshot vs current occupants.
- [ ] Verify trio; e2e selector grep (form.card2 flows) — note breakage for T4.

### Task 4: e2e + ritual + closeout
**Files:** scripts/e2e.mjs, docs/build-status.md.
- [ ] Steps per spec §5 with HAND-COMPUTED expected amounts asserted exactly; drift + re-apply flow; non-accommodation negative check; marker v0.25; FULL ritual green (keyed branch fine); build-status v0.25.

## Self-review notes
- Amount arithmetic in sen (integers) inside the engine, converting at the boundary — avoids float drift; tests assert exact 2dp.
- Re-apply = plain expense update with mode rooms; no new endpoint; no auto-recompute anywhere.
- ExpenseForm is shared by Ledger flows — freeze discipline mirrors FxWidget precedent.
