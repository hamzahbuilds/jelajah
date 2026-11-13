# 27. UI consistency audit and competitor benchmark (v0.41)

## How the audit worked

Headless Chromium visited 13 screens on a phone (390 px, touch) and on a desktop (1280 px). For each screen it recorded:

- font sizes and corner radii in use
- spacing that falls off the 4 px grid
- tap targets smaller than 40 px
- elements that overflow their box
- horizontal page scroll and page errors

| Measure | Before | After |
|---|---|---|
| Distinct font sizes | 37 | 16 (token sizes plus a few display headings) |
| Distinct corner radii | 14 | 8 (4 / 6 / 8 / 12 / 16 / 20 / pill, plus 2 px from Leaflet) |
| Off-grid spacing rules | 173 | 18 (mostly browser defaults on checkboxes, and Leaflet) |
| Horizontal scroll or page errors | 0 | 0 |

## Changes

### Tokens

- Added `--fs-h3`, `--r-xs`, `--r-xl` (16) and `--r-2xl` (20).
- 171 raw `font-size` values and 89 `border-radius` values now use tokens.

### Spacing

- 69 padding and margin values now sit on the 4 px grid.
- The paragraph margin is now `--s-1`.
- Inline `padding: 5px 0` was replaced by a `.row-pad` class. The inline-style ratchet went from 255 to 251.

### Touch

- Under `@media (pointer: coarse)`, these get a 44 px minimum height:
  - buttons and segmented controls
  - fields and `summary` elements
  - brief step buttons
  - checkbox labels
- Fields are at least 16 px, so iOS no longer zooms in on focus.
- Desktop keeps its density.

### Type

- `text-wrap: balance` on headings.
- `text-wrap: pretty` on paragraphs and list items.

### Overflow

- Trip brief step labels can now shrink and wrap.
- The audit still flags two things, both deliberate:
  - room chip "×": its hit area is extended past the chip
  - brief connector lines

### Onboarding

`ObArt.tsx` adds one animated SVG scene for each step:

- **Welcome tour:** route, then AI itinerary, then group.
- **Plan intro:** chat, then link to list, then checklist.

How the scenes behave:

- They use theme tokens, so they work in light and dark.
- Each scene plays once with a stagger, then idles in a gentle loop.
- With reduced motion, a scene shows its finished state and nothing loops.
- On the last step, the footer buttons share the row evenly.

Audit caveat: a `fullPage` screenshot in Playwright resets touch emulation for the pages that follow it. Check tap sizes before taking the screenshot.

## Competitor benchmark (Nov 2026)

| App | Strength | Weakness or gap |
|---|---|---|
| Wanderlog | Live collaborative itinerary in the free tier; map plus list | Offline needs Pro (about $40/yr); budget and splitting are basic; no voting |
| TripIt | Forward a booking email and the itinerary builds itself | Not built for planning or groups |
| Splitwise | Best-in-class expense splitting | Expenses only |
| Mindtrip | Chat planner, booking inside the chat | Sign-in is required before you can try it |
| Layla | Conversational onboarding that asks specifics first | Paid (about $49/yr); solo-focused |

### What Jelajah already wins on

- One place for the plan, the map, bookings and split costs. Wanderlog plus Splitwise in one, with no paywall on offline (PWA).
- Plans from a link, video or screenshot.
- Public transport estimates for Malaysia and Singapore. Tokyo is also covered.
- The trip brief asks questions first, as Layla does.

### Gaps worth closing, ranked

1. **Group voting on places.** Members can thumbs-up or thumbs-down an activity, or a poll picks between options. No competitor in the list does this well, and it fits Jelajah's group focus.
2. **Forward bookings by email.** Forward a confirmation and Jelajah adds the flight or hotel. This needs Cloudflare Email Routing and an inbound address per trip.
3. **Try before sign-up.** Run the trip brief and the AI draft without an account, then sign in with Google to save. This avoids Mindtrip's friction. Watch AI cost by rate-limiting per IP.
4. **Smaller polish:**
   - an empty-state checklist on a new trip (invite people, add the first booking, set a budget)
   - a share card image for public journeys

### Sources

- blog-719.pages.dev (TripIt vs Wanderlog)
- whenavailable.com (best group planning apps)
- pilotplans.com
- stippl.io blog
- endlesstravelplans.com (Wanderlog review)
- tripsquad-web.pages.dev
- layla.ai tier list
- monkeytravel.app (Layla vs Mindtrip 2026)
- analyticsinsight.net
- jotform.com/ai/best-ai-trip-planner
