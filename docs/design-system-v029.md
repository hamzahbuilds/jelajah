# Jelajah design system and enhancement plan

Status: proposed visual direction, 11 October 2026. This specification and its
interactive HTML concept precede changes to production React screens.

## Product decision

Build a calm travel journal for group organisers, with clear personal ownership.
Keep teal as the brand colour. Use generous white space, editorial headings,
quiet surfaces and destination imagery only where it helps orientation. Make the
trip plan feel like one coherent itinerary rather than a collection of dashboards.

The Figma connector successfully read file `dMkptWU6BRfcgkhpzsfFL2`, page
`0:1` and embedded Dashboard `10825:36`. The accessible file has one Cover page
with an editable dashboard and preview boards, not a full independent screen
library. The dashboard screenshot and design context were inspected.

Observed reference patterns: large SF Pro sans-serif headings, circular utility
buttons, rounded ticket-style cards, endpoint hierarchy, compact date/time chips,
a prominent blue primary action (#0970CD), and near-black dark surfaces. At the
scaled cover size, the heading is about 40px and the CTA radius about 27px; these
are reference observations, not values to paste indiscriminately into the app.

Adopt the hierarchy, generous card spacing, restrained separators and clear
primary action. Retain Jelajah teal and use accessible system fonts. Do not copy
flight-shopping content, airline logos, device status bars or promotional assets.
The local concept is an original adaptation, not a pixel-identical reproduction.

The requested System Design document template was read. Its Word rendering gate
could not run because the document renderer is missing; this repository spec
and HTML concept are the usable deliverables for now.

## Audit of the current implementation

Evidence: current styles and components, and local Day 2 screenshots reviewed
in this conversation. These are observations, not user-research findings.

- Sidebar, plan ownership tabs, Day/Week/Month tabs and day chips compete for
  attention before the first activity appears.
- Timeline activities, transport estimates and transport controls live in
  separate cards. Users must find the same journey twice to change a mode.
- Train routing now works locally, but line names, several estimates, costs and
  action buttons stack densely. Selection and provider availability are unclear.
- The small map competes with budget and note cards. The heavy rail strokes need
  a route-aware scale and selection state, not permanent maximum thickness.
- `.tiny` uses roughly 12px text and low-emphasis colours for meaningful details.
  Contrast must be measured; a muted appearance is not proof of accessibility.
- Emoji, icon-only controls, chip treatments, nested cards and ad hoc inline
  styles create inconsistent emphasis.
- `.styles.css` already has useful semantic colour aliases. Extend these into a
  full token system rather than adding another collection of page overrides.

## Foundation tokens

Proposed values, not Figma-derived. Use semantic names in components.

| Role | Light | Dark |
| --- | --- | --- |
| Canvas | #F6F5F1 | #111B19 |
| Surface | #FFFFFF | #1B2925 |
| Subtle surface | #ECEFE9 | #23372F |
| Primary text | #182B25 | #F1F5EF |
| Secondary text | #52645B | #B9C7BE |
| Border | #DCE4DB | #3D5147 |
| Primary action | #116B58 | #9FDAC0 |
| On primary | #FFFFFF | #13271F |
| Selection | #E2F0E7 | #294C3E |
| Decorative peach | #EDCBB6 | #714C38 |

Status colours are separate from brand and train line colours. Always pair status
with text/icon. Train colours come from route data, with a white/dark casing for
map contrast; they never determine permissions or save status.

- Typography: system sans stack initially; no remote font dependency. Body 16/24,
  supporting 14/20, labels 13/18, section heading 22/28, trip heading 36/40 desktop
  and 28/34 mobile. Use a strong sans-serif trip title, reflecting the inspected reference.
- Spacing: 4, 8, 12, 16, 24, 32, 48, 64px. Prefer 24px between related sections,
  32px between independent sections. No negative-margin alignment patches.
- Radius: 8px inputs, 12px buttons and small panels, 20px feature cards. Pills only
  for dates, statuses and segmented selectors.
- Elevation: borders for ordinary cards; one restrained shadow for floating
  sheets/menus. Avoid shadows on every element.
- Interaction: minimum 44px control targets, visible 2px focus rings with offset,
  120–180ms colour/opacity transitions, reduced-motion support.
- Responsive: <768px single-column; 768–1199px compact navigation and optional
  split; >=1200px 224px sidebar and timeline/map split. Verify 360, 390, 768,
  1024 and 1440px; support 200% zoom without lost actions.

## Navigation and page structure

Trip header: trip name, destination, dates, member count and organiser status.
One primary action: Share. Put editing and secondary actions in labelled menus.

Global navigation: Trips and Discover. Inside a trip: Overview, Plan, Money,
Documents and Trip settings. Account administration stays in the account area.
Avoid two competing sets of identical links.

Plan ownership selector: Group plan / My plan / Shared with me. Keep the current
permission model and show a lock or shared-view label alongside the selector.
Publishing becomes a Share sheet with Guest link and Public guide options.
Do not change visibility merely by opening that sheet.

Desktop plan: concise day strip, then timeline (roughly 56%) and sticky map (44%).
Day/Week/Month becomes a compact view menu. Secondary budget/notes summaries
appear after the itinerary, not between the active timeline and its map.

Mobile plan: compact trip header, horizontal day strip, ownership selector and
Timeline/Map switch. Use a bottom sheet for selected-stop detail on the map.
The switch preserves the day, selected activity and scroll position. Share and
Add stop remain reachable without overlapping device safe areas.

## Component contracts

| Component | Responsibility | Required states |
| --- | --- | --- |
| TripHeader | Title, destination, dates and sharing entry | no cover, long title, viewer |
| PlanScopeSwitch | Ownership and access context | group, own, shared, unavailable |
| DayStrip | Date, title and concise count | current, selected, empty, overflow |
| ActivityCard | Time, title, location and completion | saved, editing, saving, failed |
| TransportLeg | Next stop, mode, route summary and details | loading, rail suggestion, exact geometry, unavailable |
| MapPanel | Selected leg/stop, fit route and legend | loading tiles, missing pins, failed provider |
| NoteComposer | Explicit group/private scope | private default for new personal note, saving, error |
| ShareSheet | Guest link and reviewed guide publishing | private, active link, expired, revoked, published |
| EmptyState | Explain absence and next action | no activities, no coordinates, no viewer grants |
| ToastUndo | Reversible edit feedback | pending undo, restored, failed |

Reuse the existing Icon component, Modal, Toast, permission checks and routing
hook. Introduce components behind existing data contracts; do not migrate the
database merely to make the interface look different.

## Transport interaction

Each activity owns the transport leg directly below it. The leg heading names
its numbered endpoints: “2 → 3 · teamLab Planets to Sensoji”. Show one duration
and distance source at a time. Mark network-based rail suggestions and estimated
fares explicitly. Keep line names and transfer stations collapsed until opened.

A labelled mode selector updates that exact leg. While calculating, retain the
previous geometry with a loading label; replace only when the latest request
succeeds. Discard stale responses. On failure, show a reason and Retry/Open
directions, without relabelling an old line as the new transport mode.

Selecting an activity or leg highlights it on both map and timeline. Fit route
uses all geometry points. Use a 5–6px selected rail line with casing and quieter
unselected lines; dotted access walking stays distinct. A legend identifies
train, walking and selected route. A map must never imply that straight station
connections are real service geometry.

## State and privacy contracts

- Activity actions carry tripId, plan scope and activityId. Changing scope clears
  selection that no longer belongs to the visible plan.
- Route state is keyed by endpoints and mode; distinguish pending, available,
  partially available and failed. Rail suggestions include source and coverage.
- Saved state is explicit. Disable duplicate save submission and retain user
  input on error. Undo uses the current server version, not a blind overwrite.
- Private notes remain author-only; selected viewers remain read-only. Render
  permission-aware controls, but keep server authorization authoritative.
- Public preview and print continue to use allowlisted public responses.
- Do not put secrets, recovery tokens or private-note content in screenshots,
  analytics, URLs or design fixtures. Use synthetic examples in the concept.

## Implementation sequence

1. Foundations: add semantic spacing/type/radius/motion tokens and component
   examples. Bridge existing aliases, audit contrast and avoid broad selectors.
   Exit: both themes and EN/BM pass component review at narrow widths.
2. Plan pilot: rebuild Group plan first using TripHeader, DayStrip, ActivityCard,
   TransportLeg and MapPanel. Cover the Day 2 routing scenario end to end.
   Exit: mode changes affect the correct leg; map selection and route feedback
   are obvious; no duplicated time/distance values or horizontal overflow.
3. Ownership and sharing: apply the same components to personal/shared plans,
   note scopes, guest preview and guide publishing. Exit: access-control and
   public-projection regressions pass; mobile sheets work by keyboard.
4. Navigation and overview: refresh trip list, overview, login/recovery and
   discovery. Use existing user-provided covers with a calm fallback. Exit:
   long titles, no-cover trips, unavailable providers and empty trips work.
5. Consolidation: retire migrated CSS overrides, update documentation and capture
   before/after evidence. Refresh Money only at the presentation boundary;
   preserve all financial calculations and financial regression tests.

## Validation and release gates

Automate keyboard focus, control names, selected states and narrow-screen overflow.
Measure text contrast to WCAG AA targets (4.5:1 normal, 3:1 large) and UI boundaries
(3:1). Verify touch targets, dark mode, reduced motion and EN/BM text expansion.
Inspect real map failures, missing pins, route quotas and stale responses.

Re-run build, all unit/integration tests and the existing browser suite. Use an
isolated fixture database. Capture desktop/mobile screenshots, guest views and
multi-page print output. Screenshots are review evidence, not proof of all
accessibility requirements. Release the pilot behind a reversible client flag;
remove it after the migrated flows pass regression. Production deploy is a
separate action after review.

## Tradeoffs and unresolved reference review

Retaining Leaflet and current React components is the recommended route: map
rendering is now functional and the visible problems are hierarchy and interaction.
A new paid UI kit or full mapping rewrite adds migration work without fixing
these issues. Broad CSS overrides are faster initially but compound drift.

Additional editable Figma screens, if supplied, can refine mobile navigation
and imagery beyond the inspected dashboard. Keep only patterns that serve group
planning; a flight-shopping funnel should not become Jelajah’s information
architecture. The browser concept is an original proposal using synthetic content.

## Review artifacts

- `design/journal-v029/index.html`: original interactive concept with synthetic
  data, illustrative map, ownership states, sharing preview and dark mode.
- `design/journal-v029/tokens.css`: proposed colour and foundation tokens for
  the component pilot; not imported by the live application yet.
- Visually inspected the concept at desktop and 390px mobile; checked dark mode
  and the mobile map switch. This is not a completed accessibility audit.
- Live React pages and all API/data contracts remain unchanged by this design pass.
