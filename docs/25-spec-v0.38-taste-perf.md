# v0.38 — Speed, size and a "taste" pass

Status: built locally (2026-11-08), not deployed.

## Speed and size
| | Before | After (gzip) |
| --- | --- | --- |
| Main bundle | 212 KB | ~185 KB (avatar generator `@dicebear` loads on demand: `Avatar.tsx`) |
| Documents page | 140 KB | 17 KB (pdfjs loads when a PDF is read: `loadPdf()`) |
| Map engine (Leaflet + MapLibre, 327 KB) | with the page | when a map nears the viewport (`LazyMap.tsx`, types in `mapTypes.ts`) |
| Trip brief CSS | 440 KB raw (flag-icons stylesheet) | 19 KB raw; flags are `<img>` URLs (`import.meta.glob(..., '?no-inline')`), fetched when shown |
| Home cover photos | 209–336 KB each | 60–110 KB each: `?size=sm` serves `<cover_key>-sm` (800×400 webp, the card's 2:1 band) |

Small covers: Unsplash covers get one server-side (Unsplash resizer); uploads
make one in the browser (`smallCover`, from the photo's natural size); older covers are backfilled once by a
leader's browser when the server answers `X-Cover-Small: missing`
(`PUT /api/trips/:id/cover/small?v=<cover_key>`, ≤250 KB, webp/jpeg, leader
only, current cover only). Removing or replacing a cover deletes its small
copy. Tests: `tests/coverSmall.test.ts`.

Heading font: Bricolage Grotesque Variable (`@fontsource-variable`, latin
~41 KB woff2, `font-display: swap`), headings only.

## Taste pass (owner choices, from leonxlnx/taste-skill's anti-"AI look" rules)
- No accent stripe borders (trip cards, "Up next", settings).
- No glow/gradient panels: Home hero, trip ticket, plan intro, dashboard
  countdown are flat.
- Icons stand alone: no tinted tiles behind them (`.tile` neutralised globally).
- Copy: no em-dashes in UI strings (EN + BM); headlines rewritten plainer.
- Fewer pills: trip-card role and countdown as plain text; "Today" and
  participant names as text.
- Trip cards: taller photo, 2px lift and 1.03 photo zoom on hover.
- Home: "New trip" header button removed; three start options in one switch
  (Plan with AI / Import from link / Create manually).
- Ticket day count rolls on `spring.progress` (~0.25s); dashboard money
  figures don't roll.

Maps stay vector (owner choice).
