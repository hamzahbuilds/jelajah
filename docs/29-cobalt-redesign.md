# 29. Cobalt redesign (v0.43)

## Goal

Make Jelajah look professional, casual but trustworthy, so it can stand next to Wanderlog and Paths.
The look was trending "vibe-coded" because of:

- a green, warm-paper palette
- a quirky display font
- big 20 px bubbles everywhere
- emoji scenes
- a drawn map

## Design system

Everything lives in the `src/styles.css` tokens, so every screen follows.

### Brand: Cobalt

| Token | Value |
|---|---|
| `--brand-600` (primary) | `#2557E8` |
| `--brand-700` (text and links) | `#1D47C8` |
| Light tints | `--brand-25` … `--brand-100` |

Cobalt is deeper and slightly more indigo than travel-site azure (Trip.com is about `#287DFA`).
Contrast: white on primary is 5.6:1. Link colour on paper is 7.0:1.

### Accent: Coral

`--coral-500` `#F26B3A` (`--accent-warm`) is for sparks and illustration only, never body text.

### Neutrals

- Cool slate: `--gray-25` … `--gray-950`.
- Ink is `#111827` on `#F6F7F9`.

### Dark mode

- Navy surfaces.
- The primary becomes soft cobalt (`--brand-300`) with dark text.

### Type

- Figtree Variable for everything.
- Headings: weight 750 to 800, tracking -0.02 to -0.04em.
- The homepage only uses *Instrument Serif* italic for one accent word per headline.

### Radius

| Use | Size |
|---|---|
| Steps | 4 / 6 / 8 / 10 / 12 / 16 / pill |
| Cards | 12 |
| Big surfaces | 16 |

### Shadows

- Slate-tinted.
- New `--shadow-lg` for floating layers only.
- Ordinary cards keep hairline borders.

### Brand assets recoloured

- `public/icon.svg`, maskable and logos
- PNG icons
- manifest and `theme-color`
- `Loading`
- transit colours on the map

## Homepage (layout inspired by making.today)

1. **Header.** Thin bar, inline links, cobalt CTA. It collapses to a popover menu (docs/28).
2. **Hero.**
   - Centred copy: badge, headline with a serif-italic accent word, sub, two CTAs, trust row.
   - Headline words rise in one after another.
3. **Map stage** (`src/pages/HeroMap.tsx`).
   - A real map: MapLibre with OpenFreeMap `positron` or `dark` vector tiles (OSM data).
   - It tours a Penang day across four real stops. Leg geometry is real street routing from routing.openstreetmap.de, fetched once and simplified, in `src/pages/homeRoute.ts`.
   - On each leg the camera fits the leg (pitch 45, varied bearing) and the route draws itself. The walk leg is dashed.
   - The pin drops with a ping. The floating itinerary panel highlights the stop and the leg in motion (walk, Bus 204, Grab).
   - At the end it pulls back to the whole day and loops.
   - Camera padding keeps the route clear of the panel. A failed fit never stops the tour, and style loading retries on a flaky network.
   - Pause button (WCAG 2.2.2). It also pauses off screen and in hidden tabs.
   - Reduced motion shows the finished route, framed.
   - MapLibre loads lazily: about 3.4 KB for the hero code, plus the map chunk after first paint.
4. **Sources row** (plain text).
5. **Features.**
   - Centred heading with an accent word.
   - A pill cloud of 12 capabilities.
   - Three alternating rows with HTML product vignettes:
     - link to plan
     - transit leg
     - balances and settle up
   - Three smaller features.
6. **How it works.** Three numbered columns.
7. **Comparison table.** Jelajah against an itinerary app, an expense app and a group chat.
8. **Destinations.** A photo marquee from the Unsplash feed, with credits.
   - Pausable, and paused on hover or focus.
   - Static under reduced motion.
9. **Discover journeys.**
10. **FAQ.** Exclusive accordion.
11. **Closing CTA.** Cobalt gradient with a dotted route.
12. **Footer.** Four columns.

There are no testimonials, because there are no real quotes yet.

## App

- **Overview banner:** cobalt gradient with a faint dotted route.
- **Sign-in carousel:** emoji scenes removed; the gradient shows until the photo loads.
- **Dark mode:** link-buttons keep their own colour. A global `a` colour used to blank out `a.btn` text.
- **Leftover green literals** replaced with tokens:
  - focus rings
  - chips
  - drop zone
  - calendar
  - planner canvas
