# v0.31 — MCP v2: reliable pins, bulk edits, protocol hygiene

Status: **§2.1–2.4 built** (2026-11-07); §2.3b (Claude lookup + OSM verification) and §2.3c (Claude in-app) not started.

**As built — differences from the proposal:**
- MCP code stays in `server/app.ts` (moving it to `server/lib/mcp.ts` would import half of `app.ts` back); geocoding is in `server/lib/geocode.ts`; the reset-day and bulk-delete logic is shared by the UI routes and MCP (`resetDayActivities`, `deleteActivityIds`).
- **Trip area is multi-anchor**, not one centre: live testing showed a "Tokyo & Osaka" trip with Tokyo pins rejecting an Osaka market (406 km from the centre). A match is accepted within 300 km of *any* anchor (pins, bookings, and each place named in the destination).
- **Ambiguity rule** added: if any in-range match is >25 km from the best one ("Dotonbori" = Tokyo restaurants and the Osaka street), nothing is auto-pinned and the reason tells the model to add the area.
- `structuredContent` is returned on every result (arrays wrapped as `{ items }`); per-tool `outputSchema` not added yet.
- Old tool names keep working (`add_activity`, `delete_activity`); `add_activity` is now a one-item `add_activities`.
- Tests: `tests/mcp.test.ts` (14, real SQLite + the real app, geocoders mocked). Live-checked against the local server: Sensoji → Asakusa (was Lima), Kuromon Market → Osaka, Dotonbori → ambiguous until "Dotonbori, Osaka".

Original proposal date: 2026-11-07 · Scope: the Jelajah MCP server in `server/app.ts`
(`MCP_TOOLS`, `mcpToolCall`, `mcpHandleOne`, `mcpHttp`, `geocodeServer`, ~L3444–3860).

## 1. What's going wrong today (with evidence)

### 1.1 Plans added through Claude show few or no map pins

Shared/guest/public plans and the personal-plan copy all read coordinates from the
same `activities.lat/lng` (`server/journey.ts` `groupJourney` → `shared/journey.ts`).
So "no pins when I share" = the activities were created without coordinates.
Causes in the MCP path:

| # | Cause | Evidence |
|---|---|---|
| L1 | `place` is **optional** and only described inside `add_activity`'s description. Models put the place in the title ("Lunch at Ichiran Shibuya") and skip `place` → nothing is geocoded. | Local DB: 2/2 MCP-created activities have `location_name NULL, lat NULL`. |
| L2 | **No location bias.** `geocodeServer` sends only `q` + `limit=1` to Photon. | `Sensoji` → *Sensoji, Santiago de Surco, **Perú*** (unbiased). With `lat/lon` of Tokyo → 浅草寺, 台東区 (correct). `Ichiran Shibuya`, `Dotonbori`, `Nara Park` happened to be right. |
| L3 | **Silent failure.** On a miss the tool still succeeds with `located:false`; the model has no candidates, no hint, and no tool to fix it. | `add_activity` return value. |
| L4 | **Can't repair pins.** `update_activity` has no `place`, `lat`, `lng`. | `MCP_TOOLS.update_activity` schema. |
| L5 | **Can't pass known coordinates.** The model often knows a venue's lat/lng but the schema has no fields for it. | schema |
| L6 | **Overwrites the user's wording** with the geocoder label, in whatever script Photon returns (e.g. `Храм Сенсодзи 金龍山 浅草寺`) — no `lang=en`. | live Photon call |
| L7 | Comment says "Photon → Nominatim", but there is **no Nominatim fallback** — one Photon timeout = no pin. | `geocodeServer` |
| L8 | One geocode per call, no cache — a 12-stop plan = 12 sequential external calls inside 12 tool calls. | code |

### 1.2 "Delete all of day 3" happens one activity at a time

| # | Cause | Evidence |
|---|---|---|
| D1 | Only `delete_activity(activity_id)` exists → N tool calls, N round trips. | `MCP_TOOLS` |
| D2 | **No tool annotations**, so clients treat every tool as potentially destructive and **ask the user to approve each delete**. | spec: tools without annotations are assumed destructive/open-world |
| D3 | The app already has the right server operations — `POST /trips/:id/activities/reset-day` (one transaction, keeps bookings/notes/budgets) and `POST /trips/:id/activities/delete` (≤300 ids, one batch) — the MCP just doesn't expose them. | `server/app.ts` L2386, L2402 |
| D4 | Partial failure: if call 7 of 12 fails, the day is half-deleted with no summary. | — |

### 1.3 Protocol / tool-design gaps (from the MCP spec and Anthropic's tool-writing guidance)

| # | Gap | Why it matters |
|---|---|---|
| P1 | Business errors ("Activity not found", "needs editor role") are returned as **JSON-RPC errors**. | Spec: tool *execution* errors belong in the result with `isError: true` so the model can read them and self-correct; JSON-RPC errors are for protocol problems. |
| P2 | No `annotations` / `title` on tools. | Clients use `readOnlyHint` / `destructiveHint` to decide when to prompt. |
| P3 | Results are stringified JSON only; no `structuredContent` / `outputSchema`. | Structured results are validated and easier for clients/models to use; keep the text copy for older clients. |
| P4 | `initialize` echoes any `protocolVersion`, reports `version: 0.12.0`, sends no `instructions`. | Version negotiation is wrong for clients newer/older than what we implement; `instructions` is where to teach "always give a place; use bulk tools". |
| P5 | Writes don't honour the trip's "members can edit the plan" switch or a hidden plan (UI does via `canEditPlan`). | Permission parity with the app. |
| P6 | Ids without names in write results (`{ id }`, `{ ok: true }`). | Guidance: return meaningful context (names, not just ids) so the model can confirm what it changed. |
| P7 | Group plan only — no read/write of the personal plan, notes privacy, or sharing. | Upstream v0.28 added personal plans; the AI can't see or edit "My plan". |

## 2. Proposal

### 2.1 Tool set v2 (fewer, workflow-shaped tools)

Reads (`readOnlyHint: true`):

| Tool | Change |
|---|---|
| `list_trips` | + destination, dates, your role, `map_center` (lat/lng used for geocoding bias). |
| `get_itinerary` | + per-activity `located` flag and `unlocated_count` per day; `detail: "concise" \| "full"` (concise = id, time, title, place, located). |
| `search_place` **new** | `{ trip_id, query, limit≤5 }` → candidates `{ name, address, lat, lng, distance_km_from_trip }`, biased to the trip. Lets the model choose instead of guessing. |
| `get_balances`, `get_expenses`, `get_notes`, `suggest_free_slots` | unchanged apart from §2.3. |

Writes:

| Tool | Annotations | Behaviour |
|---|---|---|
| `add_activities` **new** (replaces `add_activity`, which stays as an alias for one release) | `destructiveHint: false` | `{ trip_id, activities: [1–50 × { day, title, start_time?, end_time? \| duration_min?, place?, lat?, lng?, category?, notes? }] }`. Geocodes with trip bias (§2.2), inserts all rows in **one D1 batch**, returns each row `{ id, day, title, place, located, lat, lng, note? }` + `{ located: n, unlocated: [...with top-3 candidates] }`. |
| `update_activity` | `idempotentHint: true` | + `place`, `lat`, `lng`, `category`, `start_time`, `end_time`. Changing `place` re-geocodes; explicit `lat/lng` win. |
| `pin_activities` **new** | `idempotentHint: true` | `{ trip_id, day? }` — geocode every unlocated activity (trip-biased), save confident hits, return the rest with candidates. Fixes plans that already exist (including ones shared before this change) in one call. |
| `delete_activities` **new** | `destructiveHint: true` | `{ trip_id, activity_ids: [≤300] }` → reuses the `/activities/delete` logic (trip-scoped, one batch). Returns the deleted titles. |
| `clear_day` **new** | `destructiveHint: true`, `idempotentHint: true` | `{ trip_id, day }` → reuses `/activities/reset-day` (one transaction; flights/stays, notes, day title and budget are kept). Returns the titles it removed. "Delete all of day 3" = **one call, one approval prompt**. |
| `delete_activity` | `destructiveHint: true` | kept for single deletes. |
| `add_note`, `update_note`, `delete_note`, `set_day_title` | notes delete `destructiveHint: true`; updates idempotent | unchanged behaviour. |

Phase 2 (after v2 ships): `get_my_plan` / `add_to_my_plan` for the personal plan, and `create_guest_link` (with `destructiveHint: false`, `openWorldHint: true`) — gated by the same server permission checks as the app.

### 2.2 Geocoding pipeline (fixes L1–L8)

1. **Explicit coordinates first**: valid `lat` ∈ [-90, 90] and `lng` ∈ [-180, 180] are saved as-is; `place` becomes the label.
2. **Trip bias**: `map_center` = mean of the trip's pinned activities and stays; if none, geocode `trips.destination` once and cache it on the trip. Photon call: `q`, `lang=en`, `limit=5`, `lat`, `lon`, `location_bias_scale=0.2`, `zoom=10`.
3. **Confidence rule**: take the first candidate within **300 km** of `map_center` (covers Tokyo ↔ Osaka/Nara day trips; tunable per trip span). Otherwise don't guess — leave unlocated and return the candidates.
4. **Fallback**: Nominatim (`format=jsonv2`, `accept-language=en`, `viewbox` around `map_center`, an identifying `User-Agent`, ≤1 req/s) when Photon errors or times out — the fallback the code comment already promises.
5. **Keep the user's words**: `location_name` = the `place` text the user/model gave; the geocoder label goes to the result only.
6. **Cache**: `geocode_cache(query_norm, bias_cell, lat, lng, label, created_at)` in D1, so repeat places (hotels, stations) cost nothing and batches stay within public-geocoder fair use. Batches geocode with concurrency 2 and a per-call cap; anything left over is returned unlocated with a hint to call `pin_activities`.
7. **Make `place` the obvious path**: tool description + server `instructions` say "Always set `place` to the venue name and area (e.g. 'Ichiran, Shibuya'); keep `title` short".

### 2.3 Protocol hygiene (fixes P1–P6)

- **Errors**: unknown tool / bad JSON / missing required args → JSON-RPC error. Everything else (not found, no permission, hidden plan, invalid day) → `{ isError: true, content: [{ type: 'text', text: <actionable message> }] }`, e.g. "No activity 812 on trip 1. Call get_itinerary(trip_id: 1, day: '2026-11-30') to list ids."
- **Annotations + titles** on every tool as in §2.1 (`openWorldHint: true` only on tools that call the geocoder).
- **Structured results**: `outputSchema` per tool; return both `structuredContent` and the JSON text copy.
- **Version negotiation**: support `['2025-11-25', '2025-06-18', '2025-03-26']`; reply with the client's version if supported, else our latest; `serverInfo.version` from `package.json`.
- **`instructions`** (≈150 words): dates are `YYYY-MM-DD`, times `HH:MM` local; prefer `add_activities` for >1 stop; always set `place`; to empty a day use `clear_day`; check `located`/`unlocated` and fix with `search_place` + `update_activity` or `pin_activities`.
- **Permissions**: writes go through the same `canEditPlan` rule as the app (respects "members can edit the plan" and a hidden plan); reads keep `mcpHidden`.
- **Results name things**: every write returns titles/days, not just ids.

### 2.3b Claude looks places up, Jelajah records and verifies them

Idea: Claude is better at *finding the right venue* (it can read the user's message, search
the web, or call a maps tool); Jelajah is better at *storing and checking* it. So the MCP
accepts a rich location from Claude, and the server verifies it against OpenStreetMap
before pinning it on the app's OpenStreetMap-based map.

**What Claude can use to look places up** (whichever the user has connected):

| Source | How Claude reaches it | Returns | Notes |
|---|---|---|---|
| Google Maps **Grounding Lite** MCP (`search_places`) | add `https://mapstools.googleapis.com/mcp` as a connector (Google Cloud project + API key) | place summaries with **Place ID, lat/lng, Google Maps link** | Billed per request outside its experimental period; results must show Google Maps attribution. |
| An OpenStreetMap MCP server (Nominatim/Overpass based, e.g. osm-tools, osm-mcp) | add as a connector | OSM ids, coordinates, address | Free; public Nominatim/Overpass have strict usage policies (≈1 req/s). |
| Claude's own web search | built into Claude apps | addresses, official sites, map links | No coordinates guaranteed — Jelajah resolves the address. |
| The user | pastes a Google Maps / OSM link or coordinates | URL / lat,lng | Parse server-side. |

**MCP input** — every write tool that takes a place (`add_activities`, `update_activity`) also accepts:

```jsonc
"location": {
  "name": "Sensō-ji",                       // what to show in the plan
  "address": "2-3-1 Asakusa, Taito, Tokyo",  // optional, improves matching
  "lat": 35.7148, "lng": 139.7967,           // optional
  "source": "google" | "osm" | "web" | "user",
  "osm": { "type": "node|way|relation", "id": 1234 },   // optional
  "google_place_id": "ChIJ…",               // optional
  "maps_url": "https://maps.google.com/…"   // optional; user links are parsed for @lat,lng / place ids
}
```

**Server verification ("snap to OpenStreetMap")**, in order:
1. `osm` id given → Nominatim `lookup` by id → authoritative OSM coordinates. `pin_status = verified`.
2. Coordinates given (from any source) → search OSM for `name` within ~250 m of them (Photon with `lat/lon` bias + distance check, or Nominatim reverse). Match → store the **OSM** coordinates and OSM id, `verified`. No match → keep the given coordinates, `pin_status = unverified`, and say so in the result.
3. Only `name`/`address` → trip-biased geocode (§2.2).
4. Every result reports `pin_status`, the distance from the trip area, and (for `unverified`) why — so Claude can tell the user "8 pinned and verified, 1 placed from Google but not found on OpenStreetMap — check it".

**Why snap to OSM instead of storing Google's coordinates as-is:** the app's map, routing and shared plans are OpenStreetMap-based, and Google's Maps service terms only allow caching latitude/longitude for a limited time (30 days in the caching table), while **Place IDs may be kept**. So Jelajah stores OSM coordinates when it can, and keeps `google_place_id` + `maps_url` to offer an "Open in Google Maps" link. Have the exact Google terms checked before relying on Google-sourced coordinates long-term; this is a product decision, not legal advice.

**"Insert into OpenStreetMap"** here means *pin it on Jelajah's OpenStreetMap map*. Editing the public OSM database is out of scope: it needs an OSM account, community review, and OSM forbids copying data from Google or other proprietary maps. If a place is missing from OSM, the app can offer a user-driven "Report missing place on OpenStreetMap" link (an OSM note), never an automatic import.

**Data model** (lazy `CREATE/ALTER` like `document-schema.ts`): `activities` gains `address`, `place_source`, `place_ref` (`osm:node/123` or `google:ChIJ…`), `maps_url`, `pin_status` (`verified | unverified | none`). UI: activity row shows "Open in Maps" (Google link if a Place ID exists, else OSM), and an "Unverified pin" badge with *Move pin* / *Choose another match*.

**Guiding Claude** (the client does the looking-up, so tell it how):
- Server `instructions`: "Before adding places, look each one up with any maps tool you have (Google Maps, OpenStreetMap) or web search, then pass `location` with coordinates and the source id. If you have no maps tool, pass `name` + area and Jelajah will geocode it."
- **MCP prompts** (show up as slash commands in Claude Desktop / Claude Code): `import_plan` (paste an itinerary → look up every stop → `add_activities` → report unverified pins), `fix_pins` (list unlocated/unverified → look up → `update_activity`), `clear_and_replan_day`.
- **Elicitation** when a name is ambiguous *and* the client declares the `elicitation` capability: ask the user to pick from 2–5 candidates in a form; otherwise return the candidates in the result. Servers must handle decline/cancel.
- Results include a link to the day's map in Jelajah (`/trips/:id/plan?day=YYYY-MM-DD`) so the user can eyeball the pins.
- Settings → "Connect your own AI" gets a short section on adding a maps connector next to Jelajah.

### 2.3c Optional: Claude inside Jelajah's own assistant

The in-app assistant (chat drawer, "Suggest with AI") is provider-neutral today — admin picks
any OpenAI-compatible endpoint or Gemini; it has no tool calling, so it can't look places up or
write activities. Proposal: add **Anthropic (Claude)** as one more provider in Admin → AI, without
removing the others.

- Use the official `@anthropic-ai/sdk` from the Worker (the project is TypeScript; no raw-HTTP shim).
- Default model `claude-opus-5-5` (admin can choose Sonnet/Haiku for cost); adaptive thinking with `output_config.effort: "low"` for chat, `"medium"` for planning; include the server-side refusal `fallbacks` option.
- Tools: Anthropic's server-side **web search** (`web_search_20260209`, `max_uses` capped) to find venues, plus Jelajah client tools `search_place` (OSM, §2.2) and `propose_activities` — a *proposal only*; the app shows the stops with pins and the user taps **Add** (no silent writes from the chat).
- Tool loop via the SDK's tool runner; parallel tool results returned in one message; tool failures returned with `is_error`.
- Costs are the admin's API bill; keep `max_uses` and per-user rate limits (existing `ai_rate_limited` path).

### 2.4 Security & limits

- Annotations are hints only — server role checks stay authoritative (spec).
- Batch caps: 50 adds, 300 deletes per call; one audit row per batch (`mcp_activities_bulk_create`, `mcp_clear_day: <day>`) listing ids.
- Token-in-URL endpoint stays (claude.ai custom connectors), but document it as a secret and add OAuth 2.1 later if claude.ai connectors need it.

## 3. Expected outcomes

| Task | Today | v2 |
|---|---|---|
| "Delete everything on 3 Dec" | N × `delete_activity`, N approval prompts, partial on failure | 1 × `clear_day`, 1 prompt, atomic, returns removed titles |
| "Add this 12-stop plan" | 12 calls, pins only if `place` given and the unbiased geocode guessed right | 1 × `add_activities`, trip-biased geocoding, explicit coords honoured, unlocated list with candidates |
| "Fix the missing pins" | not possible | 1 × `pin_activities` (+ `search_place` for ambiguous ones) |
| Shared / guest / public plan pins | missing for MCP-made stops | present (same rows) |

## 4. Build plan & tests

1. Extract shared helpers from the HTTP routes: `deleteActivityIds(env, tripId, ids)`, `resetDay(env, tripId, day)`, `insertActivities(env, tripId, rows)` — the UI routes and MCP call the same code.
2. `server/lib/geocode.ts`: bias, confidence, Photon → Nominatim, cache table (`CREATE TABLE IF NOT EXISTS` in the lazy schema, like `document-schema.ts`).
3. `server/lib/mcp.ts`: move `MCP_TOOLS` + handlers out of `app.ts`; add annotations, `outputSchema`, `isError`, version negotiation, `instructions`.
4. Tests (vitest + the real-SQLite pattern upstream uses in `tests/journey.test.ts`):
   - `clear_day` removes only that day's group activities, keeps bookings/notes/title/budget, one audit row; non-editor → `isError`.
   - `delete_activities` ignores other trips' ids, caps at 300.
   - `add_activities` batch inserts atomically; explicit lat/lng saved; `place` label preserved.
   - geocode: mocked Photon returning Peru + Tokyo candidates for "Sensoji" with Tokyo bias → picks Tokyo; all candidates >300 km → unlocated with candidates; Photon timeout → Nominatim used.
   - protocol: `tools/list` has annotations/titles; business errors come back as `isError` results; `initialize` negotiates versions.
5. Location provenance (§2.3b): `location` input, snap-to-OSM verification, `pin_status`/`place_ref`/`maps_url` columns, Google Maps / OSM link parsing, "Open in Maps" + "Unverified pin" UI; tests with fixtures for an OSM id, Google coords that match OSM within 250 m, coords with no OSM match, and a pasted Maps link.
6. MCP prompts (`import_plan`, `fix_pins`, `clear_and_replan_day`), `instructions` text, elicitation behind the client capability check (fallback: candidates in the result).
7. Optional (§2.3c): Anthropic provider in Admin → AI with web search + `search_place` + `propose_activities`; existing providers untouched.
8. Manual check with Claude (Desktop or claude.ai connector), once without and once with a maps connector (Grounding Lite or an OSM MCP): "add these 8 stops to day 2", "clear day 3", "pin everything on day 4", and confirm a single approval prompt for the destructive call.

## Sources

- MCP spec, Tools (2025-06-18): https://modelcontextprotocol.io/specification/2025-06-18/server/tools — `outputSchema`, `structuredContent`, two error channels (`isError`).
- MCP spec, Tools (2025-11-25): https://modelcontextprotocol.io/specification/2025-11-25/server/tools — clients should pass tool execution errors to the model for self-correction.
- Anthropic, *Writing effective tools for agents*: https://www.anthropic.com/engineering/writing-tools-for-agents — consolidate around workflows, return meaningful context, token-efficient responses.
- Tool annotations: https://sunpeak.ai/docs/mcp-apps/server/tool-annotations, https://developers.outreach.io/mcp-server/tool-annotations — tools without annotations are treated as destructive; annotations are hints, not authorization.
- Salesforce hosted MCP best practices: https://developer.salesforce.com/docs/platform/hosted-mcp-servers/guide/general-best-practices.html
- Photon API (bias, bbox): https://github.com/Komoot/photon
- Google Maps Grounding Lite (MCP: `search_places`, `compute_routes`, `lookup_weather`): https://developers.google.com/maps/ai/grounding-lite
- Google Maps Platform service terms (caching): https://cloud.google.com/maps-platform/terms/maps-service-terms
- OpenStreetMap MCP servers: https://lobehub.com/mcp/buzdolapci-osm-tools, https://lobehub.com/en/mcp/nervsystems-osmmcp, https://lobehub.com/zh/mcp/grabosm-osm-mcp
- MCP elicitation (2025-06-18): https://modelcontextprotocol.io/specification/2025-06-18/client/elicitation.md
