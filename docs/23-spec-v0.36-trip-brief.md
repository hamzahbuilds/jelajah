# v0.36 — Trip brief (where, when, who) before Plan with AI

Status: built locally (2026-11-08), not deployed. Files: `shared/brief.ts`, `src/components/TripBrief.tsx` + `tripBrief.css`, `NewPlan.tsx`, `Trips.tsx`, `PlanComposer.tsx`, `/plan/draft` in `server/app.ts`. Tests: `tests/tripBrief.test.ts`, `tests/planDraft.test.ts`.

## Why
Today `/new` is a blank chat. The AI only gets free text, so it guesses the
country, how many days and the season, and "Create trip" asks for the dates
again at the end. A short structured brief makes every AI answer specific and
fills the trip details for free.

## Goals
- At minimum we always know the **country** (one or more) before the AI plans.
- Optional detail: areas (states / cities / regions), dates or month,
  number of days, who's travelling, pace, interests, starting city.
- Visual and a bit playful, but fast: the minimum path is
  *pick country → pick when → Start planning* (3 taps + typing).

## Non-goals
- No live place autocomplete (areas are free-text chips — owner decision).
- No change to how trips, activities or the map work after "Create trip".
- No emoji (flags) — UI rules forbid them; countries show a 2-letter code badge.

## Anti-goals
- A long form that feels like a visa application. Every step past "Where" can
  be skipped; nothing but the country is ever required.
- Animation that slows people down or ignores "reduce motion".

## Flow (owner decisions in **bold**)
**Starts on Home.** "Where to next?" becomes step ① of the brief; the rest
continues full-screen on `/new`, then the chat.

```
① Where  ─  ② When  ─  ③ You (optional)  ─  ④ Ready  →  chat
```

1. **Where** (required: ≥1 country)
   - Search box with a list as you type (`<input list>` + `<datalist>` from
     ISO codes, names from `Intl.DisplayNames` in EN/BM). Picks become chips
     `[JP Japan ×]`; several countries allowed (max 5).
   - Each country chip has an optional **areas** row: free text, Enter or
     comma makes a chip (`Tokyo`, `Kyoto`, `Hokkaido`). Max 8 per country.
   - Below: **"or paste a link to import"** — the existing import box.
     **Link import does not need the brief**: the AI reads country / areas /
     days from the source and fills the brief, which the user can correct.
2. **When** — three visible choices (radio cards):
   - *Exact dates* → the DateRangePicker; days = range length.
   - *Flexible month* → 12 month chips (this month onward) + a ± day stepper.
   - *Not sure yet* → day stepper only (default 3 days).
3. **You** (optional, "Skip" in the corner)
   - Who's travelling: steppers for adults / kids / seniors.
   - Pace: Relaxed / Balanced / Packed (radio chips).
   - Interests: multi-select chips — food, nature, culture & history,
     shopping, theme parks, beaches, nightlife, halal-friendly, photo spots.
   - Starting city: free text (e.g. "Kuala Lumpur"); used on the ticket and
     for arrival / departure day timing.
4. **Ready** — a boarding-pass "ticket" summary
   (`KUL ✈ Tokyo · Kyoto, JP` · `1–7 Dec 2026 · 7 days` · `2 adults, 1 kid`)
   plus an optional "Anything else?" text box. **Start planning** opens the
   chat with the brief pinned above it and sends the first request.

In the chat the brief stays as a compact chip row; tapping it reopens the
brief (as a sheet). Changing it makes the AI update the plan (edit mode).

## AI changes
- `POST /api/plan/draft` accepts `brief` (validated server-side, unknown
  fields dropped):
  ```ts
  interface TripBrief {
    places: { country: string /* ISO-3166 alpha-2 */; areas: string[] }[];
    when: { kind: 'dates'; start: string; end: string }
        | { kind: 'month'; month: string /* YYYY-MM */; days: number }
        | { kind: 'unsure'; days: number } | null;
    party?: { adults: number; kids: number; seniors: number };
    pace?: 'relaxed' | 'balanced' | 'packed';
    interests?: string[];   // from the fixed list
    from?: string;          // starting city
  }
  ```
- Added to the prompt as a `TRIP BRIEF:` block with plain rules: stay within
  these countries/areas unless asked; exactly N days; use the real dates /
  month for season, weather and opening days; respect pace, party and
  interests. Brief is part of the plan cache key.
- Link imports without a brief: the reply also returns `brief` (country,
  areas, days) read from the source; the client fills the brief from it.
- "Create trip" sheet prefills name, destination ("Tokyo, Kyoto · Japan") and
  dates from the brief.

## Look & motion
- Step header with progress; Back / Next; Enter key hint "next".
- Step changes slide left/right by direction using an **element-scoped view
  transition** on the brief card (`el.startViewTransition`); browsers without
  it just swap (no animation).
- Chips pop in (CSS `@starting-style`); ticket card draws its route line
  (SVG stroke) and a plane icon travels along it; day number counts up.
- All motion inside `@media (prefers-reduced-motion: no-preference)`.
- Tokens only, icon sizes 16/20/24, no new inline styles (uiGuard).

## Data
- The brief lives with the draft in `sessionStorage` (same as today's chat).
- Saved to the trip only through "Create trip" (destination + dates). No new
  tables. Party / pace / interests are not stored on the trip in this version.

## Also
- Plan intro (v0.35, uncommitted) step 1 changes to "Pick where and when".
- Home "Create manually" link stays.

## Builder's calls (mine, flag if wrong)
- Max 5 countries, 8 areas per country, 1–30 days.
- Month chips cover 12 months from the current month.
- Brief sheet on phones is full-screen; on desktop a centred card (560px).
- Starting city free text, not validated.
