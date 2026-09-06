# Spec v0.26 — Per-Night Room Splits (nights-as-weights)

**Status:** design approved by Sage 6 Sep 2026. MONEY-CRITICAL extension of v0.25; conservation + v0.25-behavior-freeze are the automatic-fail checks.

## 1 · Model

- `room_occupants.nights INTEGER` nullable (SCHEMA + UPGRADES idempotent). NULL = whole stay (today's behavior).
- Room amounts remain per-stay (v0.25 editor unchanged). Split within a room weights each NON-infant occupant by nights; infants stay 0-rows regardless of nights.
- Weighted allocation in integer sen via largest remainder over person-night weights (ties: ascending participant_id, same as v0.25). NO per-night rounding — one allocation per room.
- Backward compatibility invariant: all-null nights ⇒ output byte-identical to v0.25 (equal weights). Every existing roomSplit test must pass UNCHANGED.

## 2 · Engine (shared/roomSplit.ts, additive)

- Room input gains optional `occupantNights?: Record<participantId, number>` (absent/id-missing = default weight). Default weight = the stay's night count when known, else 1 — IMPORTANT: with mixed explicit+default weights the default must be the stay nights, so the caller (server) resolves defaults BEFORE calling: engine contract = every non-infant occupant gets an explicit positive integer weight (caller-normalized). Simpler + testable: extend signature to `occupantWeights?: Record<number, number>`; engine validates weights positive integers ('invalid_weight'), absent map = equal weights.
- New tests: weighted conservation (RM400 @ 4:4:2 → 160/160/80; odd-sen weighted cases; property loop with random weights); mixed infant+weights; invalid weights (0, negative, NaN, non-integer) throw 'invalid_weight'; ABSENT map ⇒ existing behavior (regression suite untouched proves it).

## 3 · Server

- Occupants PUT (`/trips/:id/rooms/:roomId/occupants`) body gains optional `nights: Record<participantId, number|null>`; validation: participant must be in the submitted list; value null or positive integer; when the stay has check_in/check_out, 1 ≤ nights ≤ stayNights ('invalid_nights'); persisted on room_occupants rows (INSERT ... nights).
- resolveRoomsSplit: loads nights; computes weights = nights ?? stayNights ?? 1 per non-infant occupant; passes occupantWeights to the engine.
- split_json occupants snapshot gains nights (per spec v0.25 §1 shape extended: `occupants: {roomId: [{id, nights}...]}` — MIGRATION NOTE: old snapshots are plain id arrays; drift helper must accept both shapes).
- GET rooms: occupant_ids stays for compatibility; ADD `occupants: [{participant_id, nights}]` per room.

## 4 · Client

- RoomsCard: each occupant chip shows a nights badge when the stay has dates ("4/4") — tap (editor+) cycles/opens a small stepper (1..stayNights, plus "all"); saves via occupants PUT (full list + nights map). Viewers see badge read-only. No dates on stay = no badge (weights default equal).
- Split editor (ExpenseForm): occupancy label per room shows person-nights when any occupant has custom nights (e.g. "10 person-nights"); prefill proportional by person-nights (reuse allocateByWeight with the new weights).
- Drift (roomsDrift): nights changes count as drift (compare {id,nights} sets, both-shape tolerant).
- i18n en+ms for nights UI.

## 5 · e2e

Extend the v0.25 section: set one occupant to 2 of 4 nights (stay must have dates — the fixture stay needs check_in/check_out; add if missing), re-apply the RM350 split (or fresh expense) → hand-computed weighted shares asserted exactly (comment the arithmetic); nights badge visible; drift fires on nights change. Marker v0.26.

## 6 · Constraints

Standard battery + money freeze (v0.25 equal-weight outputs byte-identical; existing tests unchanged; conservation exact; no silent recompute). No deps/commits. Full ritual (key-agnostic branches intact).
