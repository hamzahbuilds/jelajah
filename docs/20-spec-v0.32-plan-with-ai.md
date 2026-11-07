# v0.32 — Plan with AI: prompt-first start page, chat planner, import from links

Status: built (2026-11-07) — §6 steps 1–5 done and verified locally (mock AI); step 6 (deploy) pending. Inspired by gopaths.ai's `/trip` start page and its
"Extract the places from this link" chat.

## 1. Why

Planning starts somewhere else: a YouTube vlog, a TikTok, a friend's blog, a
screenshot. Today Jelajah starts with an empty form, and every place has to be
typed and pinned by hand. The goal: paste the thing you saved (or describe the
trip) and get a pinned, editable itinerary — as a new trip or merged into one
you're already planning.

## 2. Goals / non-goals / anti-goals

Goals
- Home ("My trips") leads with one composer: **Plan with AI** | **Import from link**.
- Submitting opens the **chat planner** (`/new`): chat on the left, a live draft
  itinerary on the right. Every reply can reshape the draft.
- "New trip" anywhere opens the same chat planner. The old form stays one tap
  away ("Create manually").
- Import sources: YouTube, TikTok, Instagram, any web page / blog, pasted text,
  screenshots.
- Finish as **a new trip** (name, destination, dates prefilled) or **add to an
  existing trip**: multi-select places, choose the trip date for each extracted
  day, places pinned on the map.

Non-goals (this version)
- Saving drafts server-side; drafts live in this tab (sessionStorage).
- Downloading or transcribing video audio ourselves.
- Route optimisation, opening hours, bookings.

Anti-goals
- Nothing is written to a trip before the user confirms.
- No guessed pins: a place that can't be geocoded confidently goes in unpinned
  (same rule as MCP v2, docs/19 §2.2).
- No new paid service or new secret: uses the AI provider admins already set in
  Admin → AI.

## 3. Sources — how each is read

| Source | What we can get from a Worker | Notes |
|---|---|---|
| YouTube | oEmbed (title, channel). Watch-page `ytInitialPlayerResponse` → description + caption track (`fmt=json3`). **Gemini**: the video itself via `fileData.fileUri` (Gemini reads public YouTube videos natively — speech + on-screen text). | Caption fetch is best-effort; YouTube often blocks datacenter IPs. Gemini path doesn't need it. |
| TikTok | oEmbed `tiktok.com/oembed` → caption text + author. | No video. Caption is usually the place list. User can add on-screen text by pasting / screenshot. |
| Instagram | `og:title` / `og:description` from the post page (caption excerpt), when not login-walled. | Often blocked → UI asks the user to paste the caption or screenshot. |
| Web page / blog | HTML → text (scripts/styles/nav stripped), plus JSON-LD. Truncated to ~24k chars. | Works for most blogs. |
| Pasted text | As is. | |
| Screenshot | Image sent to the model (Gemini `inlineData`, OpenAI-compatible `image_url`). Max 4 images, downscaled client-side to ≤1600px JPEG. | Needs a vision-capable model. |

The server tells the model what it got (`SOURCE` block) and what it couldn't
(e.g. "captions unavailable"), and the reply says so honestly.

## 4. UX

### 4.1 Home (`/`)
- Hero card at top: segmented `Plan with AI` | `Import from link`, an auto-growing
  textarea (`field-sizing: content`, 2–8 lines), round send button. Enter sends,
  Shift+Enter newline, IME-safe (`isComposing || keyCode 229`).
- Plan mode placeholder rotates examples ("4 days in Tokyo with kids…");
  three suggestion chips fill the box.
- Import mode: placeholder "Paste a YouTube, TikTok, Instagram or blog link — or
  the itinerary text"; an "Add screenshots" button (image picker).
- Footer line: "Start from scratch? **Create manually →**" opens the existing form.
- AI not configured → composer shows a note and only "Create manually" works.
- Below: "My trips" grid as today.

### 4.2 Chat planner (`/new`)
- Desktop (≥1024px): two panes — chat 420px | draft. Phone: one pane with a
  `Chat | Plan (n)` switch; after the first reply it flips to Plan.
- Chat: user bubbles, assistant replies (plain text, short), quick-reply chips
  the model offers ("Make it 3 days", "Add halal food spots"). Composer as on home
  plus the screenshot button. Busy state: "Reading the video…" / "Planning…"
  (polite live region).
- Draft pane: header (emoji, name, destination, n days · m places), then day
  cards ("Day 1 — Marina Bay river walk") with place rows: checkbox, category
  icon, title, place line, note. "Ideas" bin for unscheduled extras. Select all /
  none per day. Source chip (YouTube title + link) when imported.
- Footer (sticky): `Create trip` (primary) and `Add to a trip…`.
  - **Create trip** → sheet: name, destination (prefilled), dates via the
    airline DateRangePicker (start pick auto-fills end = start + days − 1),
    emoji. Creates trip, adds the selected places, sets day titles, pins, then
    opens the trip's Plan.
  - **Add to a trip** → sheet: pick trip (trips I can edit), then a row per
    extracted day with a select of that trip's dates (default: day N → trip day
    N, clamped; "Ideas" → first day). Confirm → adds + pins, opens Plan.
  - Result toast: "Added 18 places · 16 pinned".
- Plan page gets an "Import" button → `/new?mode=import&trip=<id>`; the footer
  then leads with `Add to <trip>`.

## 5. API

`POST /api/plan/draft` — `{ mode: 'plan'|'import', messages: [{role, content}],
draft?: Draft, images?: [{mime, data(base64)}], lang }` →
`{ reply, suggestions: string[], draft: Draft, source?: {kind, url, title} }`.
The server finds the first URL in the latest user message, reads it (§3), and
asks the model for strict JSON `{reply, suggestions, draft}`. The current draft
is sent back each turn so the model edits rather than restarts.

`POST /api/plan/commit` — `{ draft, picks: [{id, day: 'YYYY-MM-DD'}], day_titles:
{ 'YYYY-MM-DD': title }, target: {trip_id} | {new: {name, destination, start_date,
end_date, emoji}} }` → `{ trip_id, added, located }`. New trips reuse the
`POST /trips` path (member as leader, auto cover). Existing trips need editor.
Inserts via the same batch + `resolvePin` + `tripCenter` path as MCP
`add_activities`; max 80 picks.

`GET /api/plan/status` → `{ ai: boolean, provider: 'gemini'|'openai'|null }`.

Draft shape (shared/draft.ts, validated by `parseDraftReply`):
```ts
{ name, destination, emoji, days: [{ title, places: [Place] }], ideas: [Place] }
Place = { id, title, place, category, notes?, start_time?, duration_min? }
```
Limits: ≤ 14 days, ≤ 20 places/day, ≤ 30 ideas; strings clipped.

## 6. Build order
1. shared/draft.ts (types, parse/validate, prompt) + tests.
2. server/lib/sources.ts (detect + fetch per source) + tests with a fake fetch.
3. callAI multimodal (`callAIRich`): Gemini fileData/inlineData + JSON mode;
   OpenAI-compatible content parts.
4. Endpoints `/plan/status`, `/plan/draft`, `/plan/commit` + tests.
5. Home composer (Trips.tsx), `/new` page (NewPlan.tsx), commit sheets, Plan
   "Import" button, i18n EN/BM, CSS.
6. Verify in the browser; deploy via push.

## 7. Calls made by the builder (review)
- Route `/new`; drafts in sessionStorage; no server persistence.
- "Ideas" go to the first trip day when added (activities need a day).
- Usage tracked as `ai_draft`; the `assistant` per-trip hide flag doesn't apply
  to the home composer (it's not trip-scoped) but does to the Plan "Import" button.

## 8. v0.32.1 — extraction tuning (2026-11-07)
- **Cut-off replies**: Gemini draft budget 32k (OpenAI-compatible capped 16k); `repairTruncatedJson` keeps every place that arrived complete; raw JSON is never shown in the chat.
- **Structured output**: Gemini gets `responseSchema` (`draftResponseSchema(mode)`); if a model rejects the schema (400 mentioning "schema") the call is retried once without it.
- **Thinking**: `thinkingBudget: 1024` (2.5 flash/pro) or `thinkingLevel: "low"` (Gemini 3) for imports, screenshots and edits; planning from scratch keeps the default.
- **Video cost**: `videoMetadata.fps` 0.5, or 0.25 for videos over 30 min (length from the Data API or watch page), on top of `MEDIA_RESOLUTION_LOW`.
- **Cache**: `plan_cache` table (created lazily), key = sha256(version, canonical link, ask without the link, lang, model); first turn on an empty draft only; 30 days; not written when the video fell back to text. Response carries `cached: true`.
- **YouTube Data API v3**: title, channel, full description (chapters) and duration. Key: `YOUTUBE_API_KEY` secret, else the Gemini key (works when the YouTube Data API is enabled on that Google project), else oEmbed + watch page.
- **Edit ops**: follow-ups on a non-empty draft (no new link/screenshots) return `ops` (`add/remove/update/move/day_title/add_day/remove_day/meta`, day 0 = ideas) applied by `applyDraftOps`; budget 8k. A full `draft` is still accepted when the user wants a different trip.
