# Spec v0.21 — Rooms Allocation

**Status:** approved by Sage (design nod 6 Sep 2026) · this spec freezes the details.

## What

Per-stay room allocation: who sleeps in which room at each accommodation. Visible to every trip member; editable by editors and leaders. No money coupling in v1 (split engine untouched). Rooms exposed to MCP/AI trip context read-only.

## Data (SCHEMA + UPGRADES, idempotent)

```sql
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id),
  stay_label TEXT NOT NULL,          -- hotel/stay name, free text
  check_in TEXT, check_out TEXT,     -- YYYY-MM-DD, optional
  name TEXT NOT NULL,                -- "Room 1", "Family suite"
  capacity INTEGER,                  -- nullable = unspecified
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS room_occupants (
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  participant_id INTEGER NOT NULL REFERENCES participants(id),
  PRIMARY KEY (room_id, participant_id)
);
```

Rule (app-enforced on assign): within one stay group (same trip_id + stay_label), a participant occupies at most one room — assigning moves them (delete from the other room in the same group first, one transaction/batch).

## API (server/app.ts)

- `GET /trips/:id/rooms` (member): `{ rooms: [{...room, occupant_ids: []}], suggested_stays: [{label, check_in, check_out}] }` — suggestions derived from accommodation expenses exactly like the plan payload's `stays` (reuse/extract that query; label = description, dates = expense_date/end_date). trackUsage('rooms_view').
- `POST /trips/:id/rooms` (editor+ via requireEditor — same gate as plan edits): {stay_label, check_in?, check_out?, name, capacity?} → room. 
- `PATCH /trips/:id/rooms/:roomId` (editor+): name/capacity/stay fields.
- `DELETE /trips/:id/rooms/:roomId` (editor+): removes room + occupants (batch).
- `PUT /trips/:id/rooms/:roomId/occupants` (editor+): {participant_ids: []} — replaces the room's occupants; enforces the one-room-per-stay-group rule by removing those participants from sibling rooms in the same group (D1 batch). Participants must belong to the trip (validate against trip_members ∪ trip participants — mirror how activities validate participant ids).
- Integer guards + trip-exists per v0.20 precedent; audit() on writes; delete cascade added to the trip-deletion batch list (DELETE /trips/:id must now also clear rooms + room_occupants — REQUIRED, the 20-table cascade grows to 22).

## UI — Rooms card on People page

Below the members card, visible to ALL members (People page is currently leader-only route? — CHECK: if the route/page gates to canLead, rooms must render for everyone: adjust the page to show a read-only Rooms card for non-leaders while keeping the rest leader-only. The nav item People currently leader-gated in navModel — change: People visible to all roles, page internals gate themselves; nav label stays "People". This is a deliberate IA change the design implies — everyone must SEE rooms.)

- Stay groups as sub-sections (label + dates). "Add stay" → picker of suggested_stays (one-tap) or free-text form.
- Rooms as chips/cards: name, capacity badge (occupants/capacity; warning badge when over — never blocks), occupant avatar chips (tap an occupant → remove for editors).
- Unassigned pool per stay group: trip participants not in any room of that group; tap person → assign into a target room (select room first via an "assign into" active-room state, or per-room "+ add" opening a small person picker — implementer picks the lighter pattern, records it).
- Infants: listed with an infant badge, excluded from the capacity count (display "3+1" style when a room holds an infant).
- Editors/leaders edit; viewers read-only (no buttons).
- EN+BM keys for all strings; icons via <Icon> (hotel/users/plus/trash).

## MCP / AI context

Wherever trip notes are included in the MCP/Gemini context builder (server-side), append a compact rooms section (stay label → room name → occupant names). Read-only.

## e2e

Editor creates a stay + 2 rooms, assigns 3 people, over-assigns to trigger the capacity badge, moves a person between rooms (asserts single-occupancy rule), viewer sees read-only card, trip deletion still passes (cascade).

## Constraints

RM0; no deps; t() EN+BM; SCHEMA+UPGRADES discipline; money untouched; 148+ unit tests green (pure helpers: occupancy math/one-room rule as shared function with tests); full ritual to E2E PASSED (v0.21 marker).
