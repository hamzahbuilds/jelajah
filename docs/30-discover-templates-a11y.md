# 30. Discover redesign, starter templates, accessibility pass (v0.44)

## Discover (`src/pages/PublicJourneys.tsx`, `src/pages/discover.css`)

### Page layout

- **Header:** "Find a trip to start from" plus intro text.
- **Search:** one `<search>` form (labelled field and Search button).
- **Length filter:** chips (`aria-pressed` buttons) for any length, or up to 3, 5 or 7 days. Choosing a chip filters at once. It does not submit a form.

### Sections

- **Starter templates:** the bundled templates, filtered by the same search and length.
- **Shared by travellers:** published guides, with paging.

### Preview page (`/guides/:id`)

- Also used for `/guides/template-<id>`.
- Hero with flag, destination, facts, and actions:
  - "Use this template" (signed out: "Sign in to use")
  - Print / Save as PDF
- Each day is a timeline (`ol`, time first). It replaces the six-column table, reads better on a phone and still prints.

## Starter templates (`shared/templates.ts`)

Six hand-written plans:

1. Penang food weekend
2. Kuala Lumpur city break
3. Singapore with the family
4. Tokyo for first-timers
5. Bali slow week
6. Langkawi island escape

How they are stored:

- Each one is a plan `Draft`.
- Places are written as "Venue, Area" so place search finds them.
- Times and durations are suggestions.

### "Use this template"

1. It navigates to `/new` with `state.template`.
2. NewPlan opens straight in the review with every place picked, and a note in the chat.
3. "Create trip" goes through `/plan/commit`. That asks for dates, creates the trip and pins every place.

### Shared journeys as templates

Any shared journey can be used the same way, via `journeyAsDraft()`.

### Tests

`tests/templates.test.ts` checks:

- every template survives `cleanDraft` unchanged and within `DRAFT_LIMITS`
- ids are unique
- countries are real

## Accessibility

An axe-core sweep covers public and app pages, phone and desktop, light and dark. It went to 0 violations across all 38 page/size checks.

| Issue | Fix |
|---|---|
| Card titles jumped from h1 to h3 | Now h2 on pages without other h2s. CSS covers both levels. |
| Login had no `main`, no `h1`, and content outside landmarks | Carousel is an `aside`, the form pane is `main`, and the logo is the `h1`. |
| Checklist checkbox had no label | Wrapped in a `label`. The delete button names its task. |
| Ledger category filter had no name | Named. |
| Scrollable lists on the overview were not keyboard reachable | Focusable regions with names. |
| Map markers had no name | `title`/`alt` from the stop label. |
| Member avatars | `role="group"` on the list. The name comes from screen-reader-only text, and the hover tooltip is hidden from screen readers. |
| Documents drop zone: name did not match its visible text | Name now comes from the visible text, with `aria-disabled` while busy. |
| Homepage: two landmarks shared the comparison heading | Distinct names. |
| Map attribution links: low contrast in dark mode | Fixed. |

## Visual consistency

- Uppercase, letter-spaced labels are now sentence case: table heads, eyebrows, legends, onboarding count.
  The boarding-pass ticket and photo captions keep uppercase on purpose.
- Boxed page "hero" cards (Plan, publishing) are now flat page headers with a hairline divider.
- On trip pages the trip name is a compact context line, so each page's own `h1` leads.

## Trip pages pass (v0.44, part 2)

### One page-title scale

`.pagehead h1` is now the same size as the Plan header: `--fs-xl`, weight 800, tight tracking. Subtitles are base size.

### One segmented style

The grey track with a white active segment is now used for:

- Plan's Group plan / My plan / Shared / Share & export tabs (was solid blue)
- Documents' Folders & files / List toggle (was two mismatched buttons)
- the phone-only Timeline / Map toggle

### Day pills

The active day is a tint with a ring, not a solid block. It reads correctly in dark mode too.

### Trip settings

- Visibility checkboxes use `.check-row`: the box and label stay on one line, and long labels wrap beside the box.
- This removed four inline styles. The ratchet is now 250.

### Travel notes form

| Before | After |
|---|---|
| Two dropdowns both labelled "Day" | "Applies to" (Whole trip / One day) and "Who can see it" (Private / Group) |
| — | Both are real radio groups styled as segmented controls (`.seg-radio`, `fieldset` + `legend`) |
| — | A labelled Date field when "One day" is chosen |
| — | A labelled Note field with an example |
| Unclear submit button | "Add note" |

### Overview: payment due dates

Rows share one grid: title and meta on the left, amount and Mark settled on the right. Before, the first row broke onto two lines.

### Trip maps

The base-map style request retries with backoff. A single failed tile no longer shows "could not load"; the message appears only if the style never loads. This is the same resilience as the homepage map.

### Phone

The Plan header is flat on phones too, with no leftover card edge.

The axe sweep is still at 0 violations, and tests pass (373).
