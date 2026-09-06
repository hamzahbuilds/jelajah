# Spec v0.25 — Room-Cost Splitting

**Status:** design approved by Sage 6 Sep 2026. MONEY-CRITICAL: every task reviewed against the split-engine freeze; the new engine is additive.

## 1 · Model

- New split mode for accommodation-category expenses: `rooms`. Existing modes (equal/picked) byte-frozen.
- `expenses.split_json TEXT` (nullable; SCHEMA+UPGRADES idempotent ADD COLUMN): editor memory only — `{"mode":"rooms","stay_label":str,"room_amounts":{"<roomId>":myr,...},"occupants":{"<roomId>":[participantIds...]}}` (occupants = snapshot at save time, for drift detection). `expense_shares` rows remain the single source of truth for balances; split_json is NEVER read by balance/payment math.

## 2 · Share generation (pure, shared/roomSplit.ts)

`roomShares(input: { totalMyr: number; rooms: { id: number; amountMyr: number; occupantIds: number[] }[]; infantIds: Set<number> }): { participant_id: number; amount_myr: number }[]`
- Validates: every room amount ≥ 0; Σ room amounts === totalMyr within 0.005 (caller pre-validates equality to the sen; function throws on violation — money never silently adjusts).
- Per room: amount splits equally among NON-infant occupants via largest-remainder rounding to the sen (2dp); infants present get a 0-amount share row (visible, owes nothing). Room with only infants or zero occupants must carry amountMyr 0 (throw otherwise).
- Invariant (tested exhaustively): Σ output === totalMyr exactly at 2dp for adversarial inputs (odd sens, 1-occupant rooms, 16 people, infant mixes).

## 3 · Server (server/app.ts)

- POST /trips/:id/expenses and the expense-update route: accept optional `split: { mode:'rooms', stay_label, room_amounts }` for category 'accommodation' (400 otherwise). Validation server-side: stay_label has rooms in this trip; every room_amounts key is a room of that stay group; Σ === amount_myr (2dp exact); occupants loaded from room_occupants; shares = shared roomShares(); D1 batch: delete old shares → insert new → save split_json (mode/amounts/occupant snapshot). Leader-only via the routes' existing gating (verify + keep).
- Non-rooms saves on an expense that had split_json → split_json set NULL (mode reverted).
- GET expenses payload: include split_json so the client can re-edit + detect drift. No recompute anywhere server-side.

## 4 · Client

- ExpenseForm: when category==='accommodation' AND the trip has ≥1 room stay group, show split-mode choice "Split by rooms" alongside existing options (others unchanged). Selecting opens the room editor (inline section or shared Modal — implementer picks lighter): stay-group select (prefilled by date/description match, fallback first), per-room rows (name · occupancy badge · amount input) prefilled proportionally by non-infant occupant count (largest-remainder so prefill sums exactly), live remainder line ("RM 12.00 left to assign", error styling when ≠0), "Balance last room" helper button, save disabled until remainder 0.
- Ledger row for a rooms-split expense: small badge "By rooms". Drift: client compares split_json.occupants vs current rooms payload → hint chip "Rooms changed since this split" + "Re-apply" (opens the editor with current occupants, same amounts prefilled — saving re-generates; NEVER automatic).
- MySpend/Payments untouched (they read shares).
- EN+BM keys for all strings.

## 5 · e2e

Leader creates stay+2 rooms w/ occupants (reuse v0.21 seed steps or fresh), adds accommodation expense with rooms split (unequal amounts), asserts per-person owed amounts EXACTLY (compute expected by hand in the test), payments page reflects them; edits room occupants → ledger shows drift chip → re-apply → amounts update; non-accommodation expense shows no rooms option. Marker v0.25.

## 6 · Constraints

Standard battery + money freeze (existing split paths byte-identical; conservation invariant is the review's automatic-fail check; no silent recompute anywhere). No new deps/commits. Full ritual (key-agnostic e2e branches preserved).
