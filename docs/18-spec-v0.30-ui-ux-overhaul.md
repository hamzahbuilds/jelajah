# v0.30 — UI/UX overhaul: audit + one-shot spec

Status: **in build** (steps 1–2 partly done, see §9) · Audited 2026-11-07 · Three rounds.
Round 3 re-ran everything on upstream `d6d945e` (journal planning pilot, document
library, journeys/publishing, Discover, Recovery) and reconciles this spec with
upstream's proposal `docs/design-system-v029.md` (palette, type, component contracts)
— where they differ, §0 says which wins.

Rounds 1–2:
(1) visual audit of every page at 390/1280px light+dark, code scan of `src/` and `styles.css`;
(2) end-to-end flows in Chrome at 360/390/1280px — login (good + bad), add expense,
add activity, Plan day/week/month, empty trip, BM language, keyboard Tab order,
slow-network load, plus automated per-page checks (title, lang, landmarks, h1,
overflow, tap targets, input font size, contrast, unnamed controls).

Round 3: same screenshots + automated checks on 13 signed-in routes, 3 public routes
(login, Discover, forgot password) and the four Plan tabs; code/CSS rescan; knowledge
graph refresh (`graphify-out/`, 1,453 nodes) for component reach and import cycles.

Guidance source: `modern-web-guidance` guides (ids cited inline as `[guide-id]`).

---

## 0. Locked decisions

| Decision | Answer |
|---|---|
| Mobile green top bar | **Remove.** Settings / Admin / Log out live in the More sheet only. |
| "Trip Settings" page | **Split** into **People** (`/trips/:id/people`) and **Trip settings** (`/trips/:id/settings`). |
| Chat assistant on desktop | **Floating** button stays; fix overlap (§5.6). |
| Browser support | Baseline Widely available = use freely. Newly/limited features only with a feature-detect + graceful fallback (same policy v0.28 used for `<dialog>`, `popover`, anchor positioning). No polyfill dependencies. |
| Emoji | Emoji only for **user content** (trip emoji, flags, user-typed text, carousel illustration). All controls, labels, statuses, map markers use `<Icon>`. |
| Palette & type (round 3) | **Adopt upstream's v029 palette app-wide** (Forest `#116B58`, Mint `#9FDAC0`, Paper `#F6F5F1`, green-tinted darks) and its type sizes/radii (`docs/design-system-v029.md`). Retire the old teal and the plan-only `.journal-workspace` override so the whole app is one brand. Brand already ships this green (`docs/BRAND.md`, `theme-color`). |
| Trip navigation (round 3) | Upstream proposes one "Trip settings" item; **your decision stands: People + Trip settings**. Add upstream's global **Discover** link next to Trips. Trip header primary action = **Share** (opens the Share sheet; replaces the "Share & export" tab). |
| Breakpoints (round 3) | Follow upstream: single column <768px, compact nav 768–1199px, full sidebar ≥1200px. Component layout still uses container queries. |
| Upstream components | Keep and restyle upstream's `PlanDaySummary`, `TransportLeg`, `TravelNotes`, `ExpandedMap`, `Loading` — no rewrites, they carry routing/privacy logic. |

---

## 1. Findings

Severity: **P0** broken · **P1** blocks/hurts a core task or accessibility · **P2** inconsistency/polish.
"✓R2" = confirmed or found in the round-2 end-to-end pass.

### 1.1 Broken (P0)

| ID | Finding | Evidence / cause |
|---|---|---|
| B1 | Money splits mid-number on mobile: `RM 8,507.` / `27` (Dashboard, Ledger KPIs) | `.stat .v { overflow-wrap: anywhere }` `styles.css:790`, 30px type in 2-col grid |
| B2 | Category chart amounts wrap `RM 6,442.7` / `0`; "Accommoda…" truncated | fixed bar column on 390px |
| B3 | Room occupancy badge stacks `2` / `/` / `4` | badge in narrow flex row, no `nowrap` |
| B4 | "1 flights", "1 Participants", lowercase "committed" | plain string concat, no plural rules (`i18n.tsx:112,269`) |
| B5 | Broken-image glyph on login when photo fails | `AuthCarousel.tsx:141` `<img>` has no `onError` |
| B6 | Trip settings lists all 18 travellers twice (chips + rows) | two renders of one list |
| B7 ✓R2 | **Add activity: "End time" input cut off past the dialog's right edge** at 390px | 3 inputs forced into a 2-col `.mrow` |
| B8 ✓R2 | **People page scrolls sideways 14px at 360px**; empty trip 2px | wide row content, no `min-width: 0` |
| B9 ✓R2 | **Blank white screen for 4s+ on slow network** — no shell, no skeleton | single 1.12 MB JS bundle, nothing rendered until it parses + data loads |
| B10 ✓R2 | Add expense: Save button is below the fold inside a centred modal on mobile; 11 stacked fields | long form in `.modal` with no sticky footer |

### 1.1b Round 3 — new since upstream `d6d945e`

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| R1 | P1 | **Two brand palettes live at once**: app chrome/buttons teal `#0F766E`; Plan area forest `#116B58` via scoped vars on `.journal-workspace` (`styles.css:1411,1447`); `theme-color` forest. Sidebar active state and Plan tabs visibly differ. | screenshots plan-d/m |
| R2 | P1 | **Plan header stack, 6 layers before the first activity**: trip header → "Your next adventure" hero (generic copy, repeats destination) → scope tabs → day summary card → view switcher + Data/Suggest/Add → day strip. First activity at ~720px desktop, ~1,000px mobile. Upstream's own audit names this problem; the pilot added two layers. | plan-d.png, plan-m.png |
| R3 | P1 | Scope tabs overflow on mobile: **"Share & export" is clipped off-screen** with no scroll cue; it is an action, not a plan scope. | plantab-Share_export-m.png |
| R4 | P1 | Day summary says **"0 activities · 0/0 completed"** on a day that shows a booked flight — booking-derived events aren't counted. | plan-d.png |
| R5 | P1 | Travel notes form: **two fields labelled "Day"** (scope select + date) and "Travel notes" labels the visibility select. | plan-d.png |
| R6 | P1 | **`window.confirm()` × 13** for destructive actions (TravelNotes, JournalPlan, Plan, Ledger, Payments, MySpend, People) — unstyled, untranslated buttons, no context, blocks the page. | code scan |
| R7 | P2 | Discover: submit button repeats the field label ("Search title or destination"); Prev/Next shown with zero results; header "Sign in" 46×22px, language toggle 36px tall. | pub-discover-m.png |
| R8 | P2 | Documents: three upload steps (category cards → folder select → dropzone) sit above the library; "Folders & files / List" toggle uses the *primary button* style for the selected state; folder cards use the `file` icon. | docs-d.png |
| R9 | P1 | Bundle **2.40 MB (670 KB gz)**, up from 1.12 MB. Knowledge graph shows **import cycles** `App.tsx → pages → TripShell.tsx → App.tsx` (6 cycles) — page chunks can't split cleanly until shared context/types move out of `App.tsx`/`TripShell.tsx`. | build output, `graphify-out/GRAPH_REPORT.md` |
| R10 | P2 | CSS drift grew: raw hex 148 uses / 91 unique (was 101/54), 58 font sizes, 90 paddings, 83 dark patches, new breakpoints 500/700/760/1100. Upstream pages use their own `journal-*` classes (136 rules) instead of shared components; graph confirms Journal/Publishing/Discover use neither `Empty` nor `src/ui`. | scan, graph query |
| R11 | P2 | Share & publish: "VIEW ONLY" eyebrow + "Guest link" tab + "Guest link" card title repeat; the expiry `datetime-local` field has no hint about time zone. | plantab-Share_export-m.png |

**Resolved upstream since round 2:** B6 (members listed twice → compact avatar card + Manage members dialog), B8 (People sideways scroll, now 0px at 360), loading states partly (shared animated `Loading` for boot, plan, payments, documents).

**Still open from round 2 (re-measured):** A1 titles (all "Jelajah"), A2 `lang` stays `en` in BM, A3 no `<main>` on signed-in pages + 2 × h1, A4 map pins first in Tab order, A7 inputs <16px (People 12, Admin 11, Plan 4, login 2), A8 16–45 targets <44px per page, A9 Add-expense Amount unlabeled + no invalid state, B1 KPI money wrap, B7 Add-activity end time clipped, B9/B10, mobile top bar.

### 1.2 Accessibility (P1)

| ID | Finding | Evidence |
|---|---|---|
| A1 ✓R2 | Every route has `<title>Jelajah</title>` | no `document.title` anywhere |
| A2 ✓R2 | Switching to Bahasa Malaysia leaves `<html lang="en">` | no `lang` sync in `i18n.tsx` — screen readers read BM with English voice |
| A3 ✓R2 | No `<main>` landmark; no skip link; 2 × `<h1>` on every trip page (trip header + page title) | DOM check all pages |
| A4 ✓R2 | Tab order: on Dashboard the first 6+ stops after nav are Leaflet map pins and zoom buttons | Leaflet markers focusable, map before content |
| A5 ✓R2 | **Primary button fails contrast**: white on `--brand-600 #0E9384` = **3.8:1** ("New trip", "Add activity", "Add expense", "Save") | needs 4.5:1 for 14px text |
| A6 | `--ink-3 #A8A69F` = **2.4:1** on white, 2.3:1 on page bg — used for dates, participants, hints, inactive tab labels ("Week", "Month", "Payments") ✓R2 | contrast calc |
| A7 ✓R2 | Inputs below 16px → iOS zooms on focus: login (13px), People 17 inputs, Plan 11, Admin 8 | computed font-size |
| A8 ✓R2 | Tap targets <44px: 16–47 per page. Segmented tabs 36px tall, sidebar collapse 26×26, row edit/delete ~28px, mobile top-bar links 20px tall | bounding boxes |
| A9 ✓R2 | Required/invalid state not exposed: empty Add-expense submit sets no `:user-invalid`, no `aria-invalid`; Amount field has **no label** | form check |
| A10 | ~25 clickable `span/div/td` (Review 7, Plan 6, …) — not keyboard reachable; 2 unnamed icon buttons in Plan | code scan |
| A11 | Colour-only status: FX ▼/▲ red/green, document status tint | screenshots |

### 1.3 Information architecture & navigation (P1)

- Trip identity shown 3× per trip page (trip header, crumb, h1 context) — ~180px on mobile.
- Mobile top bar duplicates More sheet ("Admin" twice) — **decision: remove**.
- "Trip Settings" = `/people`, mixes members, rooms, invites, details, cover, visibility, delete; 3,500px tall — **decision: split**.
- Duplicate entry points: "New trip" button + dashed "Start a new trip" card; Dashboard "Payment due dates" KPI duplicates its own card.
- Plan header on mobile wraps to 3 rows (view switcher · Data + Suggest · Add).
- Chat FAB covers card edges and trailing row actions (Up next, Payment history trash, Directions "Start / end").
- ✓R2 Month view on mobile: a 30-day grid of empty cells where only 2 trip days exist in that month; trip days carry a 4px dot as the only marker.

### 1.4 Layout, content & states (P1/P2)

- Masonry imbalance (Plan rail, Trip settings).
- Mobile KPI grid orphans (odd count).
- Ledger row ≈ 260px on mobile (4 meta lines + action row).
- Inconsistent row patterns for the same data (Up next, Payment due dates).
- Text-only actions with no affordance: "Statement", "Mark settled", "Start / end", "Search", "Everyone / Clear".
- Raw data shown: hash-prefixed filenames, ALL-CAPS vendors, `—` placeholders for missing time/date/directions.
- ✓R2 Empty states are bare and inconsistent: "None", "No expenses yet.", "Everything is settled 🎉", "Nothing here yet — add your first task." Empty trip shows RM 0.00 KPI cards and "Payment due dates 0".
- ✓R2 Trip cover photo sits behind the trip header text on mobile; the crumb overlaps the photo with ~1.1:1 contrast.
- ✓R2 Expense form has three date fields ("Date (Check-in/Flights)", "Checkout (optional)", "Payment date") with no grouping or hint about which matters.
- ✓R2 No loading state anywhere (blank → content); no skeletons; mutations give a toast but no inline pending state.

### 1.5 Visual system drift (P2)

`styles.css`: 1,287 lines in 16 version layers. 48 font sizes (px + rem mixed), 64 paddings, 20 radii, 19 shadows, 54 unique raw hex (101 uses) + 47 `rgba()`, 73 `[data-theme="dark"]` patches, breakpoints 620/640/760/1024, z-index 0–150 ad hoc. Inline `style={{}}`: Plan 63, ExpenseForm 23, RoomsCard 20, People 20, Admin 17, Documents 17, Dashboard 14. `Plan.tsx` = 1,662 lines.

### 1.6 Performance (P1)

- ✓R2 One JS chunk **1.12 MB** (343 KB gz): Leaflet, pdf.js glue, Tesseract glue, Admin charts all load before the login screen paints. No `React.lazy` / dynamic `import()` anywhere.
- Login carousel photo has no `fetchpriority`; trip cover images have no `loading`/`decoding` hints.
- Long lists (Ledger, People 18+ rows, Payments) render fully; fine at today's sizes, worth `content-visibility` on below-fold cards only.

---

## 2. Icon audit

**Set:** 50 Lucide-style icons (`iconDefs.ts`), sizes 16 ×127 / 20 ×66 / 24 ×2. Style is consistent — keep it.

### 2.1 Add (v2 set)

`x` · `chev-l` · `chev-u` · `arrow-l` · `sun` · `monitor` · `info` · `external` · `filter` · `map` · `route` · `minus` · `refresh` · `sparkles` · `tag` · `note` · `list-check` · `save` · `inbox` · `baby` · `station` · `bed` · `more-v` · `sort` · `menu`

Remove the `.x-close` hack (`plus` rotated 45°, 6 places) and text `✕ × ← ‹ ▾`.

### 2.2 Emoji → icon map (exact)

| Location | Now | Becomes |
|---|---|---|
| `Plan.tsx:517` Suggest | ✨ | `sparkles` |
| `Plan.tsx:587` day title | ✏️ / 🏷️ | `edit` / `tag` |
| `Plan.tsx:606,1495` budget tooltip/labels | 🚆🏨🍜🎟️📦Σ | `train` `hotel` `food` `ticket` `bag` + text "Total" |
| `Plan.tsx:709` Directions | 🗺️ | `route` |
| `Plan.tsx:792,1305` stay pin | 📌 | `pin` |
| `Plan.tsx:907` checklist | ☑️ | `list-check` |
| `Plan.tsx:1145` stations | 🚉 | `station` |
| `Plan.tsx:1189`, `ExpenseForm` infant | 👶 | `baby` (16px, `aria-label` "infant") |
| `Plan.tsx:1195` save group | 💾 | `save` |
| `Plan.tsx:1281` edit | ✏️ | `edit` |
| `Plan.tsx:1482` CSV | 📥 | `download` |
| `Plan.tsx:1507` preview | 👁️ | `eye` |
| `Plan.tsx:1627` trip scope chip | 🧳 | trip's own emoji (user content) |
| `Plan.tsx:1629` suggesting | 🤖 | `sparkles` + spinner |
| `Plan.tsx:238,243` stay names | `🏨 ` prefix in data strings | drop prefix; render `hotel` icon in UI |
| `MySpend.tsx:18` categories | 🍜🛍️🚇🎟️📌 | same category→icon map as Ledger (`food` `bag` `train` `ticket` `pin`) — one shared `CATEGORY_ICON` in `shared/` |
| `Dashboard.tsx:81` map pins | 🏨 📍 ✈️ | SVG divIcons from the sprite (`hotel`, numbered pin, `plane`) |
| `Review.tsx:103` warning | ℹ️ | `info` in `.callout` |
| `Review.tsx:197` keywords | 🔍 | `search` |
| `Admin.tsx:418` temp password | ✨ | `key` |
| `ChatDrawer.tsx:51,56` | 💬 / ✕ | `chat` / `x` |
| `i18n.tsx` "settled 🎉" | 🎉 | remove; use `EmptyState` with `check` |
| Text arrows `→` in links (~40) | → | `arrow-r` icon after link text; keep `→` only inside data (route "KUL → NRT") |

### 2.3 Size rules

16 = inline with text, list rows, buttons with text · 20 = nav, tiles, icon-only buttons · 24 = empty states. Icon-only buttons always have an accessible name. Icons beside status text are `aria-hidden` (text carries meaning).

---

## 3. Design system v2 (tokens)

Single `:root` block, colours via `light-dark()` so dark mode needs no per-component patches `[dark-mode]`. `:root { color-scheme: light dark }` already in v0.28; `[data-theme]` sets `color-scheme: light|dark` to force a mode `[dark-mode-toggle]`.

```css
:root {
  /* type — rem so user font-size is honoured [typography]; sizes from design-system-v029 */
  --fs-xs: .75rem;   /* 12 meta (badges only) */
  --fs-sm: .8125rem; /* 13 labels */
  --fs-md: .875rem;  /* 14 supporting text */
  --fs-base: 1rem;   /* 16 body, inputs */
  --fs-lg: 1.375rem; /* 22 section heading */
  --fs-xl: clamp(1.75rem, 1.2rem + 2vw, 2.25rem); /* trip/page title 28 → 36 */
  --fs-num: clamp(1.375rem, 1rem + 2.2vw, 1.875rem); /* KPI money 22→30 */
  --lh-tight: 1.2; --lh: 1.5;
  /* space (4px grid) */
  --s-1: 4px; --s-2: 8px; --s-3: 12px; --s-4: 16px; --s-5: 20px; --s-6: 24px; --s-8: 32px; --s-12: 48px; --s-16: 64px;
  /* 24px between related sections, 32px between independent ones (v029) */
  /* radius */
  --r-sm: 6px; --r-md: 8px /* inputs */; --r-lg: 12px /* buttons, small panels */; --r-xl: 20px /* feature cards */; --r-pill: 999px /* dates, status, segmented only */;
  /* elevation */
  --e-1: 0 1px 2px rgb(16 24 40 / .06);
  --e-2: 0 4px 12px rgb(16 24 40 / .08);
  --e-overlay: 0 20px 48px rgb(16 24 40 / .25);
  /* colour (light, dark) — upstream v029 palette, contrast-checked 2026-11-07 */
  --bg:        light-dark(#F6F5F1, #111B19); /* paper */
  --surface:   light-dark(#FFFFFF, #1B2925);
  --subtle:    light-dark(#ECEFE9, #23372F);
  --ink:       light-dark(#182B25, #F1F5EF); /* 13.6:1 on paper */
  --ink-2:     light-dark(#52645B, #B9C7BE); /* 6.3:1 white, 8.6:1 dark */
  --ink-3:     var(--ink-2);                 /* no lighter text tier: it failed AA */
  --line:      light-dark(#DCE4DB, #3D5147); /* decorative dividers only (1.3:1) */
  --line-strong: light-dark(#7A8B82, #6F857A); /* input/control borders ≥3:1 (3.6 / 3.8) */
  --brand:     light-dark(#116B58, #9FDAC0); /* Forest / Mint */
  --brand-ink: light-dark(#116B58, #9FDAC0); /* 5.9:1 on paper, 9.5:1 on dark surface */
  --on-brand:  light-dark(#FFFFFF, #13271F); /* 6.4:1 / 9.9:1 */
  --selected:  light-dark(#E2F0E7, #294C3E); /* forest text on it 5.5:1 */
  --peach:     light-dark(#EDCBB6, #714C38); /* decorative only */
  --danger: light-dark(#B42318, #F97066);
  --success: light-dark(#027A48, #75E0A7);
  --warning: light-dark(#B54708, #FDB022);
  /* z (non-top-layer only; dialogs/popovers use the top layer) */
  --z-sticky: 20; --z-nav: 30; --z-fab: 40;
}
```

Rules: no raw hex/rgba outside the token block; breakpoints only `1024px` (shell) — component layout uses **container queries** `[size-aware-styling]`; spacing between a label and its input < spacing between fields `[forms]`.

---

## 4. Components (new `src/ui/`)

Every component: no inline styles, tokens only, both themes, keyboard + 44px targets. Container-query aware where noted.

| Component | Spec | Acceptance |
|---|---|---|
| `Button` | `variant: primary\|secondary\|ghost\|danger`, `size: sm(36)\|md(44)`, `icon?`, `loading?` (spinner, `aria-busy`, disabled after valid submit only `[forms]`) | primary text ≥4.5:1; `sm` keeps a 44px hit area via padding/`::after` |
| `IconButton` | required `label` → `aria-label`; 20px icon; 44×44 hit area | axe "button-name" passes |
| `Card` / `CardHeader` | title (h2/h3 per context), optional action slot, `container-type: inline-size` | no nested card padding drift |
| `Stat` | label, value (`white-space: nowrap; font-variant-numeric: tabular-nums; font-size: var(--fs-num)`), sub | B1 fixed at 320px wide |
| `Money` | formats via `Intl.NumberFormat`, never wraps, optional original currency line | used by Stat, ListRow, tables |
| `Badge` | `tone`, always icon **or** text — never tint only | A11 fixed |
| `ListRow` | leading icon tile · title + one meta line · trailing value · optional `Menu` (overflow) · whole row is one `<a>`/`<button>` when it navigates | Ledger row ≤ 76px at 390px |
| `Field` | label above, hint above input, error below with `info` icon + text; syncs `aria-invalid` on blur/submit `[required-field-feedback][accessible-error-announcement]`; input ≥16px | A7, A9 fixed |
| `Segmented` | radio-group semantics (`role="radiogroup"` + arrow keys) or real links when it navigates; 44px tall on mobile; inactive label ≥4.5:1 | A6/A8 |
| `EmptyState` | 24px icon, one sentence, one action | replaces all bare "None"/"—" |
| `Skeleton` | `Card`-shaped shimmer (static under reduced motion) | shown within 100ms of route change |
| `FormSheet` | Dialog variant: full-screen on <1024px with **sticky header + sticky footer** (Cancel / primary), body scrolls; centred modal ≥1024px | B10 fixed; Save always visible |
| `PageHeader` | trip chip (emoji + name → opens switcher) + h1 + actions slot; actions collapse to one primary + overflow `Menu` in narrow containers | A3 single h1; Plan header = 1 row on mobile |
| `DateRangePicker` | one control for start + end, airline-style — full spec §4.1 | 2 taps pick a range; replaces every start/end input pair |

### 4.1 `DateRangePicker` (airline-style start + end in one calendar)

**Why:** today every range is two separate native date inputs (trip dates, stay check-in/out, room stays) — two pickers, two opens, no view of the span, and nothing stops end < start.

**Where it replaces paired inputs**

| Screen | Now | Becomes |
|---|---|---|
| New trip (`Trips.tsx:139,143`) | Start date + End date | one "Trip dates" picker |
| Trip settings → Details (`People.tsx:459,463` today) | Start date + End date | one "Trip dates" picker; keeps the "shortening never deletes" hint |
| Add/Edit expense (`ExpenseForm.tsx:430,433`) | "Date (Check-in/Flights)" + "Checkout (optional)" | Accommodation → "Stay dates" range picker; every other category → single-date mode (end hidden) |
| Rooms → stay (`RoomsCard.tsx:275,277`) | Check-in + Check-out | "Stay dates" range picker |

Single dates stay **native `type="date"`** (payment date, spend date, due date) — the OS picker is fast and accessible for one tap. Exception: activity day in Add activity becomes a row of the trip's day chips (D1 Sun 29 Nov…) plus "Other date…" — picking from the trip's days is one tap.

**Trigger (closed state)**
- Looks like a `Field`: label, then one button showing `Sun, 29 Nov → Mon, 7 Dec · 8 nights` (locale-formatted, BM supported), `calendar` icon. Empty: "Add dates".
- Hidden `<input name="start_date">` / `<input name="end_date">` carry the values so the surrounding `<form>` submits normally `[forms]`.
- Required + empty on submit → `Field` error "Choose dates" with `aria-invalid` `[required-field-feedback]`.

**Panel (open state)**
- ≥1024px: anchored `popover="auto"` panel below the trigger, **two months side by side**, ← / → month buttons; positioned with anchor positioning + JS fallback (same as `Menu`) `[viewport-aware-dropdowns]`.
- <1024px: `FormSheet` full screen, **months scroll vertically** (current trip month first), weekday header sticky, footer sticky with summary + "Clear" + "Done".
- Header line shows the live state: "Select start date" → "Select end date" → "29 Nov – 7 Dec · 8 nights" (nights for stays, days for trips: trips count days inclusive, stays count nights).

**Selection rules**
1. First tap = start. Second tap = end. Range fills between them.
2. Second tap **before** the start → it becomes the new start (no error).
3. Tapping the start day again: **trip mode** → one-day trip (start = end, "1 day"); **stay mode** → ignored with the hint "Check-out must be after check-in" (stays need ≥ 1 night).
4. Third tap after a complete range → starts a new range.
5. Desktop hover after the start shows a preview fill to the hovered day.
6. "Done" commits; Esc / backdrop / back gesture cancels and restores the previous range (Dialog/popover already route these).
7. Optional quick chips row (trip dates only): "Weekend", "1 week", "2 weeks" from the chosen start.

**Context overlays**
- Expense stay and Rooms pickers shade the **trip's dates** as a subtle band and open on the trip's first month, so picking inside the trip is obvious; dates outside stay selectable (early arrivals).
- `min` / `max` props disable days (e.g. nothing before 2000, max 365-day span); disabled days are `aria-disabled`, skipped by arrow keys.
- Today marked with a ring, not a fill.

**Visuals**
- Day cell ≥ 44×44 (A8). Start and end: solid `--brand` circle, `--on-brand` text. In-range: `color-mix(in srgb, var(--brand) 14%, var(--surface))` band joining start→end (rounded ends). Outside-month days hidden, not greyed.
- Week starts Monday (matches current Plan month view).
- Both themes via tokens; reduced motion = no slide between months.

**Accessibility**
- Each month is a `role="grid"` with `aria-labelledby` = month heading; days are `<button>`s with full `aria-label` ("Sunday, 29 November 2026, check-in") and `aria-pressed` for start/end, `aria-describedby` "in selected range" for range days.
- One Tab stop into the grid (roving `tabindex`); Arrow keys move by day/week, PageUp/PageDown by month, Home/End to week start/end; Enter/Space selects. Arrow keys only act inside the grid and never block page scroll when there's no target `[spatial-navigation]`.
- A polite live region announces "Check-in 29 November selected. Choose check-out." and the final range.

**Dates & maths**
- New `shared/plainDate.ts`: works on `YYYY-MM-DD` strings only. Uses `Temporal.PlainDate` when available (`since(..., { largestUnit: 'day' })` for nights); otherwise pure integer day arithmetic (days-from-civil) — no `Date` objects, no polyfill dependency `[capture-location-agnostic-data][calculate-event-differentials]`. Migrate `shared/days.ts` callers that build `new Date(str + 'T00:00:00')` to it.
- Unit tests: month boundaries, leap day 2028-02-29, end-before-start swap, nights vs days count, DST-irrelevance (no Date).

**Acceptance**
- New trip: open → tap 29 Nov → tap 7 Dec → Done = 3 interactions (was 2 pickers × open + navigate + tap).
- Keyboard-only range selection works; screen reader announces both ends and the count.
- Expense with category Accommodation submits `expense_date` + `end_date`; other categories submit `expense_date` only.
- Picker fits 320px wide with no horizontal scroll; panel never covers its trigger on desktop.

---

## 5. Shell & navigation

0. **Break the import cycles first** (R9): move `useSession`, `useTripNav`, `TripRole`, `User`, `Trip` out of `App.tsx` into `src/app/session.tsx`, and `TripCtx`/`Participant` out of `TripShell.tsx` into `src/app/tripContext.ts`. Pages import from there; `App.tsx` imports pages only lazily.
1. **Remove mobile top bar** (`App.tsx:163` `.mobile-topbar`). More sheet keeps Settings, Admin (admins), Log out.
2. **Landmarks**: `<header>` (sidebar brand / mobile page header), `<nav aria-label>` (sidebar, tab bar — distinct names), one `<main id="main" tabindex="-1">`; skip link "Skip to content" first in DOM `[accessibility]`.
3. **Route titles + focus**: `useDocumentTitle(\`${page} · ${trip} · Jelajah\`)`; after a route change, focus `#main` (preventScroll) so the view transition doesn't strand focus `[same-document-transitions][faster-spa-view-transitions]`.
4. **`lang` sync**: `document.documentElement.lang = lang === 'ms' ? 'ms' : 'en'` on language change and at boot `[accessibility]`.
4b. **Global nav** = Trips · Discover (upstream decision). **Trip header** = trip chip, destination + dates, member count, and one primary **Share** button opening the Share sheet (§6.11).
5. **Trip routes**: `/trips/:id` Overview · `/plan` · `/money/{ledger,payments,me}` · `/documents` · `/people` · `/settings` (new). Sidebar + More sheet list: Overview, Plan, Money, Documents, People, Trip settings. Redirect old `/trips/:id/ledger|payments|myspend` → new money paths.
6. **Chat FAB (floating, desktop + mobile)**: `bottom` = tab bar height + 16px on mobile; pages get `padding-block-end` = FAB size + 24px so trailing actions are never under it; on mobile hide on scroll-down, show on scroll-up (scroll-driven class toggle, respects reduced motion).
7. **Sticky page header** on scroll with "stuck" shadow via `scroll-state` container query, fallback = always-on hairline `[state-aware-sticky-headers]`.

---

## 6. Page specs

### 6.1 Login
- Inputs 16px, `autocomplete="username"/"current-password"`, `autocorrect=off autocapitalize=off spellcheck=false` on email, password show/hide toggle, `enterkeyhint="go"` `[forms]`.
- Error: `Field`-level message + `aria-live` region; keep email value.
- Carousel `<img onError>` → gradient fallback; first slide `fetchpriority="high"`, hidden slides `fetchpriority="low"` `[optimize-image-priority]`.
- Mobile: carousel shrinks to a 30vh header, not removed.

### 6.2 Trips (home)
- New trip `FormSheet`: name, destination, **trip dates via `DateRangePicker`** (§4.1), emoji.
- One "New trip" primary in `PageHeader`; dashed card only when the user has **zero** trips (as `EmptyState`).
- Uniform cover: photo or brand gradient; trip emoji/flag bottom-left; countdown `Badge` on solid scrim (≥4.5:1).
- Invite card → compact `ListRow` with `gift` icon + "Copy link".

### 6.3 Overview (Dashboard)
- Hero = countdown + dates + 3 `Stat`s inside it (Trip total, Outstanding, Next payment due *date*, not a count). Removes the separate KPI row and the orphan card.
- Order: Up next → Journey map → Money (category bars + top balances) → Payment due → Currency → Checklist.
- Up next / Payment due as `ListRow`s; "Mark settled" = `Button secondary sm`.
- Category chart: label + amount on one line, bar below at <480px container width.
- Map: Leaflet markers `keyboard: false`, map container `tabindex="0"` with label "Journey map, N places" — one Tab stop (A4).
- Empty trip: `EmptyState`s ("No expenses yet — Add expense"), hide money widgets until there is data.

### 6.4 Plan (round 3: built on upstream's journal pilot)
- Keep upstream's `PlanDaySummary`, `TransportLeg`, `ExpandedMap`, `TravelNotes` and the Group / My plan / Shared with me scopes.
- **Collapse the header stack (R2) to three layers**: (1) trip header with Share; (2) one sticky bar = scope `Segmented` (Group · Mine · Shared) + view menu (Day/Week/Month) + "Add activity"; Data and Suggest with AI in an overflow `Menu`; (3) day strip. Remove the "Your next adventure" hero from Plan (it duplicates the trip header); fold the day summary's counts into the selected day chip and the day heading row. Target: first activity within 360px of the top on desktop and within one screen on a 390×844 phone.
- **Share & export leaves the tab row** (R3) → Share sheet from the trip header.
- Day summary counts booking events (flights, stays) as activities (R4).
- Travel notes form (R5): one "Applies to" `Segmented` (This day · Whole trip), a date field only when "This day" and the date isn't the selected day, a "Visible to" select (Private · Group), and a labelled textarea.
- **Split `Plan.tsx` first** into `PlanHeader`, `DayStrip`, `DayList`, `ActivityRow`, `DayRail` (map, budget, notes), `ActivitySheet`, `ImportWizard`, `SuggestSheet`. No behaviour change in that commit.
- Header: `Segmented` Day/Week/Month + "Add activity" primary; "Data" and "Suggest with AI" in an overflow `Menu`.
- DayStrip: horizontal `scroll-snap-type: x mandatory`, selected day scrolled into view, arrow keys move selection; snapped-item highlight under `prefers-reduced-motion: no-preference` `[carousel-snap-highlights]`.
- Activity row: time column shows "Any time" (muted) instead of `—`; category icon tile; participants as avatar stack (max 3 + "+n").
- Directions / budget / notes empty → `EmptyState`.
- Desktop: `DayRail` `position: sticky; top: var(--s-6)`.
- Month view on mobile: show only weeks that contain trip days; trip days get filled tile + day number in brand colour + activity count.
- Add/Edit activity → `FormSheet`; day = trip day chips + "Other date…" (§4.1); time row = Start / End on one row at ≥360px container, stacked below (fixes B7); place search field with `search` icon button; map below.

### 6.5 Money
- Tabs = real links (`/money/ledger|payments|me`), `Segmented` styling.
- **Ledger**: `ListRow` per expense — category icon · description · `date · payer · N people` (plural-correct) · `Money` · overflow menu (Edit, Delete). Group by date with sticky date headers. Filters in a `Menu`. Status `Badge` only when not "Paid".
- **Add expense** → `FormSheet` with `<fieldset>` groups: *What* (category, description, vendor, location) · *When* (Accommodation: `DateRangePicker` "Stay dates" §4.1; other categories: single date; payment date under "More options" `<details>`) · *Money* (amount `inputmode="decimal"` with labelled currency select, paid by, status) · *Who* (participants). Required marked; errors per `Field`.
- **Payments**: balances as `ListRow` → "View statement" chevron opens `FormSheet` statement; record-payment form = `Field`s; history single amount column, overflow menu for delete.
- **My spend**: shared category icons; same `ListRow`.

### 6.6 Documents
- Friendly title = vendor + doc type ("AirAsia invoice"), filename as meta without hash prefix.
- Bulk-select bar appears only after first selection (sticky bottom on mobile).
- One trailing action per row: "Review" (needs review) or overflow menu; status `Badge` with icon.
- Upload zone: whole zone is a `<label>` for the file input; drag-over state; progress per file in a list.

- Round 3 (R8): upload becomes one "Upload" button + dropzone; category and folder are chosen in the upload `FormSheet` after picking a file (defaults: category from OCR guess, folder = last used). "Folders & files / List" = `Segmented`, not a primary button. Folder cards use the `folder` icon.

### 6.7 People (new split)
- One member list (`ListRow`: avatar · name · "Account"/"Traveller only"/"Infant" · role `Select` or badge). Search when >10. "Add traveller" row with infant checkbox.
- Rooms: compact cards, occupancy `Badge` "2/4" `nowrap`, assign via `Menu`; stay check-in/out via `DateRangePicker` with the trip band shown.
- Invite links: `ListRow` with role badge, uses, expiry, Copy `IconButton`.
- Fix 360px overflow (B8): all flex children `min-width: 0`, long names `overflow-wrap: anywhere` (names only, never money).

### 6.8 Trip settings (new split)
- Sections: Details (name, destination, trip dates via `DateRangePicker`) · Cover photo · Member visibility (checkbox `<fieldset>` + "Members can edit the plan") · Danger zone (delete).
- Each section its own `<form>` with its own Save; Danger zone `closedby="none"` confirm `Dialog`.

### 6.9 Settings (account)
- Order: Appearance (Light `sun` / Dark `moon` / System `monitor`) · Language · Referral link · Developer (Access tokens + MCP) in a collapsed `<details>` `[search-hidden-content]`.
- Access tokens inside a `Card` like the rest.

### 6.10b Share & publish (Share sheet, replaces the "Share & export" tab)
- Opened from the trip header **Share** button; `FormSheet` with `Segmented` Guest link · Public guide. Opening it never changes visibility (upstream rule).
- One heading per view (R11): drop the "VIEW ONLY" eyebrow and the repeated "Guest link" card title; state chips use `Badge` (Private / Active link / Expired / Revoked / Published).
- Expiry uses a date + time pair with the trip's time zone named in the hint.

### 6.10c Discover, guide pages, Recovery (public)
- Same tokens/components as the app; a skip link and `<main>` (already present on these routes).
- Search: field label "Search title or destination", button "Search". Hide Prev/Next when there are no results; `EmptyState` with a "Clear filters" action.
- Header controls ≥44px (Sign in, language).

### 6.10 Admin
- Same `Card`/`Stat`/`ListRow` primitives; inputs 16px; charts keep `LfBars`/`LfLine` but token colours.

---

## 7. Forms (all)

- Wrap in `<form>`, submit `type="submit"`, labels via `for/id`, no placeholder-as-label `[forms]`.
- Money: `type="text" inputmode="decimal"` (not `type=number`); dates native `type="date"`; times `type="time"`.
- `:user-invalid` styling (v0.28) + JS bridge sets `aria-invalid` and reveals the `Field` error on blur/submit `[required-field-feedback]`.
- Don't disable submit to block validation; disable only after a valid submit while pending.
- Textareas (notes, chat) `field-sizing: content` with `min-block-size`/`max-block-size`, fallback = fixed rows `[form-fields-automatically-fit-contents]`.
- Chat input: Enter sends only when `!e.isComposing` (IME-safe).
- `scroll-padding-block-end` on `FormSheet` body so the mobile keyboard never hides the focused field.

---

## 8. Performance

1. Route-level code splitting: `React.lazy` for Plan (Leaflet), Documents/Review (pdf.js, Tesseract), Admin, Settings; Leaflet CSS loaded with the Plan/Overview chunk. Target: initial JS < 250 KB gz.
2. App shell renders immediately (sidebar/tab bar + `Skeleton` page) — B9 acceptance: on "Slow 4G" emulation, something meaningful paints < 1.5s and no blank frame > 300ms after first paint.
3. Images: login slide 1 + trip-card covers above fold `fetchpriority="high"` (max 2); others `loading="lazy" decoding="async"` `[optimize-image-priority]`.
4. `content-visibility: auto; contain-intrinsic-size: auto 400px` only on below-fold Overview cards (Currency, Checklist) and Ledger date groups after the first `[defer-rendering-heavy-content]`; verify Tab order still reaches them.
5. Typography: `text-wrap: balance` on h1/h2/card titles, `text-wrap: pretty` on paragraph hints `[improve-text-layout-and-legibility]`.

---

## 9. Build order (one PR per step, each green before the next)

| # | Step | Files (main) | Done when | Progress (2026-11-07) |
|---|---|---|---|---|
| 1 | Tokens + icon set v2 + shared category icons + guard test | `styles.css`, `iconDefs.ts`, `src/lib/categoryIcons.ts`, `tests/uiGuard.test.ts` | guard passes; one palette app-wide | **Done.** v029 palette app-wide (light + dark, contrast-checked), `.journal-workspace` override removed, brand fills/text via `--brand`/`--on-brand`/`--brand-ink`, dark tint scale, `--line-strong` on inputs, trip accents darkened for AA, 12px buttons / 20px cards, 25 new icons, emoji → icons, guard ratchet (raw hex 94). |
| 2 | `src/ui/` primitives (§4) incl. `DateRangePicker`, `shared/plainDate.ts` | `src/ui/*`, `shared/plainDate.ts` | dev gallery renders every variant both themes; tests pass | **Done.** 14 primitives + `DateRangePicker` + `shared/plainDate.ts` (7 tests); admin gallery at `/dev/ui`. Browser-verified: 2-tap ranges, hover preview, stay ≥1 night, keyboard-only, Esc cancel, focus return, phone full-screen sheet, popover flips/scrolls to stay on screen. Fixed: `Field` invalid-event recursion, key focus race, sheet height. |
| 3 | Shell: break import cycles, remove top bar, landmarks + skip link, titles, `lang`, People/Trip settings split, money routes, Discover in nav, Share in trip header, chat button rules | `App.tsx` → `src/app/*`, `TripShell.tsx`, `Sidebar.tsx`, `TabBar.tsx`, `navModel.ts`, `i18n.tsx` | A1–A4 pass; old routes redirect; 0 import cycles in graph | **Mostly done.** Session/trip contexts moved to `src/app/` (0 page→App cycles), mobile top bar removed, skip link + single `<main>`, one `<h1>` per page, per-route titles, focus to `<main>` after navigation, `<html lang>` follows EN/BM, People / Trip settings split (`/people`, `/settings`), `/money/{ledger,payments,me}` with redirects, Discover in nav + More sheet, chat-button clearance. **Left:** trip-header Share button (with step 7), map pins out of Tab order (A4). |
| 4 | Code splitting + page skeletons | `App.tsx`, `main.tsx` | initial JS < 250 KB gz; no blank frame >300 ms on slow 4G | **Mostly done.** All pages lazy-loaded; initial JS 2.40 MB → 511 KB (670 → 139 KB gz). Route fallback = `PageSkeleton`. **Left:** slow-4G measurement, image `fetchpriority`. |
| 5 | Remaining P0s (B1, B2, B3, B4, B5, B7) + `ConfirmDialog` replacing 13 × `window.confirm` (R6) | Dashboard, RoomsCard, i18n plurals, AuthCarousel, Plan, + 7 confirm sites | each P0 fixed in screenshot run | **Done.** B1 KPI money one line; B2 category bars stack on narrow cards (container query); B3 nights badges never wrap + labelled steppers; B4 plural strings (flights/stays/places/people, EN + BM) and "Committed" casing; B5 carousel falls back to gradient on image error, slide 1 `fetchpriority=high`, hidden slides low; B7 activity date / start / end each labelled, nothing clipped at 390px; A9 currency + amount named; R6 `ConfirmDialog` (`useConfirm`) replaces all 12 `window.confirm` calls — Cancel first and focused, Esc/backdrop cancel, stacks over open dialogs. Browser-verified, no native dialogs left. |
| 6 | Pages: Login → Trips → Overview → Money → Documents → People → Trip settings → Settings → Admin → Discover/Recovery | per page | §6 section met | not started |
| 7 | Plan: split `Plan.tsx` (no behaviour change), then header collapse + Share sheet + notes form (R2–R5) | `src/pages/plan/*`, `JournalPlan.tsx`, `Publishing.tsx` | e2e green after split; §6.4 + §6.10b met | not started |
| 8 | Polish: empty states, `text-wrap`, `content-visibility`, contrast re-check, retire `journal-*` duplicates | all | §10 all green | not started |

---

## 10. Verification (definition of done)

Run after every step; all must pass at the end:

- `npx tsc -b` · `npx vitest run` · `node scripts/e2e.mjs` (on a reset local DB per DEV-RUNBOOK).
- Screenshot audit (`scripts/responsive.mjs` extended): 360 / 390 / 768 / 1280 × light/dark × every route, plus: add-expense, add-activity, empty trip, BM language, slow-network.
- Automated per-page checks (port the round-2 script into `scripts/ux-audit.mjs`), thresholds:
  - unique `document.title` per route; `<html lang>` matches UI language
  - exactly one `<main>`, one `<h1>`; skip link present
  - `scrollWidth − innerWidth = 0` at 360px
  - 0 interactive elements < 44×44 (inline text links exempt)
  - 0 inputs < 16px
  - 0 text nodes below 4.5:1 (3:1 for ≥24px / ≥18.66px bold)
  - 0 buttons/links without accessible name; 0 clickable non-interactive elements
  - empty required field + submit → `aria-invalid="true"` + visible message
  - date ranges: e2e picks a trip range and a stay range with 2 taps each (mouse) and with keyboard only; end < start is impossible to submit
- Keyboard: Tab from top reaches page content within 3 stops (skip link → main); focus ring visible on every stop; Esc closes every overlay.
- Manual: iOS Safari + Android Chrome on a phone — no zoom on focus, FormSheet footer above keyboard, back gesture closes sheets.
