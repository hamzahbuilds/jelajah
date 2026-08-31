# Jelajah v0.12 "Assistant & Open Doors" — Spec (plan approved 31 Aug 2026)

Goal: a free, bring-your-own-key AI assistant inside Jelajah (itinerary
suggestions the user approves into the plan, multilingual trip Q&A), Jelajah
exposed as a standard MCP server so Sage's own LLMs (Claude, Codex, others)
can plan trips from outside — plus two UX-feedback upgrades: action
confirmations everywhere, and a themed upload progress bar.

## 1. AI provider settings (admin)

New **Settings** page (admin-only, topbar link):
- One provider card: Base URL, API key, Model — speaks the OpenAI-compatible
  chat-completions format, so any conforming endpoint works.
- Presets fill the fields in one tap: **Gemini (free)** →
  `https://generativelanguage.googleapis.com/v1beta/openai` +
  `gemini-2.0-flash` with a note: create a free key at aistudio.google.com
  (no credit card); also **OpenRouter** and **Groq** presets (both have free
  tiers). Custom values allowed (local Ollama etc.).
- Stored in D1 (`app_settings` key/value). The key is used ONLY server-side
  by the Worker proxy; no endpoint ever returns it (the UI shows •••• + last 4).
- **Test connection** button → tiny round-trip, shows model's reply or error.
- If no provider is configured, all assistant UI shows a friendly
  "Ask your admin to connect an AI provider in Settings" state.

## 2. ✨ Itinerary suggestions (Plan tab)

- "✨ Suggest" button opens a panel: free-text ask ("family afternoon in
  Asakusa with a toddler", "fill D3's free time") + optional day scope.
- Worker builds context: trip name/destination/dates, that day's (or whole
  trip's) activities with times, stays, day start/end points. Sends with a
  system prompt demanding STRICT JSON:
  `[{ day, start_time, duration_min, title, why, place }]`.
- Response renders as suggestion cards: time, title, why, 📍 place.
  Each card: **Add**; header: **Add all**. On add:
  - place geocoded client-side via the existing Photon→Nominatim pipeline
    (destination-hint suffix); pin + nearest-station cache come along, same
    as a hand-added activity;
  - activity POSTed with day/time/duration/notes ("why" → notes);
  - card flips to ✓ Added.
- Nothing writes without a tap. Cards carry a one-line "AI can be wrong —
  check opening hours & prices" note.
- Rate-limit / provider errors → calm message ("The assistant is resting —
  try again in a minute"), never a raw stack.

## 3. 💬 Trip Q&A chat

- Floating chat button on all trip tabs → drawer with a per-trip
  conversation. Kept in browser memory only (nothing stored in D1).
- Language chips: **English / Bahasa Malaysia / Bahasa Melayu Sarawak** —
  steer the reply language via system prompt (Sarawak: kamek/kitak-style,
  flagged as approximate). Chip choice remembered per browser.
- Context built SERVER-SIDE per asking user, mirroring existing visibility
  rules: itinerary + stays + legs always (unless plan hidden); balances,
  dues and expense summaries only if that user's role already sees them
  (feature-hiding respected, exactly like the API 403s today); My-spend:
  only the asker's own items. The provider sees only what that user could
  already read in the UI.
- "Assistant" becomes a fourth per-trip feature-hiding toggle (members).

## 4. MCP server (`/mcp`)

Jelajah's own Worker speaks MCP over Streamable HTTP (JSON-RPC 2.0:
`initialize`, `tools/list`, `tools/call`; stateless responses, protocol
version 2025-03-26) — usable from Claude Desktop / Claude Code, Codex,
Cursor, Gemini CLI, and any MCP client, with just a URL + token.

- **Auth**: `Authorization: Bearer <token>`. Personal access tokens:
  generated on the People page (admins) / a "My token" card (members);
  shown ONCE, stored hashed (SHA-256) in `api_tokens` (user_id, name,
  token_hash, created_at, last_used_at, revoked). Revoke = one tap.
  A member's token has member permissions (hidden features stay hidden).
- **Tools** (plan read-write, money read-only — approved):
  - `list_trips` — trips the token's user can see
  - `get_itinerary(trip_id, day?)` — activities, auto events, stays, legs,
    day budgets
  - `get_balances(trip_id)` / `get_expenses(trip_id)` — read-only, role-filtered
  - `add_activity(trip_id, day, title, start_time?, duration_min?, notes?,
    place?)` — place geocoded server-side via Photon (Worker-side fetch)
  - `update_activity(activity_id, …)` / `delete_activity(activity_id)`
  - `suggest_free_slots(trip_id, day)` — gaps between timed activities
  - No expense/payment/user/settings writes, by design.
- Mutating tools are admin-token-only (matches in-app permissions).
- A "Connect your AI" help card (Settings page) shows copy-paste setup for
  Claude Code (`claude mcp add --transport http jelajah <url> --header
  "Authorization: Bearer …"`), Claude Desktop JSON, and Codex config.

## 5. UX: action confirmations everywhere (new)

A global toast system (bottom-centre, auto-dismiss ~2.5 s, trip-accent ✓;
errors in red staying until dismissed). Wired to every "did it work?" spot:
- People: participant added/removed, account created, password reset,
  visibility saved
- Ledger/Review: expense saved / deleted / marked paid
- Payments: payment recorded, item settled, statement settled
- Plan: activity saved/deleted, order updated (with "Undo" hint), budget
  saved, CSV/wizard import applied (counts), suggestion added
- Trips: trip created; My spend: item added / promoted; Settings: saved,
  connection OK
Toasts announce via `aria-live="polite"` for screen readers.

## 6. UX: document upload progress (new)

Multi-file upload in Documents gets a visible pipeline:
- Progress strip under the dropzone: ✈️ plane icon flying along a track,
  `n / total` imported, current filename, error count; per-file result list
  (✓ parsed · 🔎 OCR queued · ⚠️ failed + reason).
- The dropzone is DISABLED while a batch runs (greyed, no clicks/drops) so
  files can't stack; re-enabled when the batch (incl. the OCR queue) ends.
- Batch finish → toast: "✈️ 5 imported, 1 error"; errors stay listed in a
  dismissible callout.

## 7. Schema v6 (auto-upgrade, as always)

`app_settings(key PRIMARY KEY, value)`;
`api_tokens(id, user_id, name, token_hash, created_at, last_used_at,
revoked)`; `trips.hidden_features` gains the 'assistant' value (no ALTER
needed). No manual SQL for Sage.

## 8. Verification

- Unit: suggestion-JSON parser (strict + fenced/malformed fallback), context
  builder role-filtering, free-slot finder, token hashing.
- e2e (hermetic): mock provider endpoint served locally → settings save +
  test connection; suggest → cards → Add → activity lands with pin; chat
  drawer answers from mock; member with assistant hidden sees no chat; MCP
  full handshake with curl/client (initialize → tools/list → add_activity →
  get_itinerary shows it; member token blocked from mutations; revoked
  token 401); toasts appear on add-participant and record-payment; upload 3
  files → progress counts, dropzone disabled mid-batch, error listed for a
  corrupt file.
- Live-site caveat (told to Sage): first real Gemini call happens on the
  deployed site — sandbox cannot reach Google; MCP is fully testable and
  tested here.

## Out of scope

AI writing expenses/payments; storing chat history server-side; streaming
token-by-token replies (v1 returns whole messages); OAuth for MCP (bearer
tokens only); voice.
