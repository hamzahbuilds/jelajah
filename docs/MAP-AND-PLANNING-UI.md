# Planning UI and expanded maps

The live planning page now applies the approved journal concept's heading hierarchy, green ownership tabs and day cards, generous rounded surfaces, and wider desktop map. This is a planning-page pilot, not a claim that every screen matches the Figma reference. Money, administration and other workflows retain their existing layouts.

## English base maps

Leaflet still owns the pins, route overlays and user interactions. The default base layer now uses OpenFreeMap Liberty vector tiles through the MapLibre GL Leaflet bridge. Named features prefer `name:en`, then `name_en`, Latin names, and finally the original name. Missing translations may still appear in the local language. User-entered activity names and TokyoGTFS station names are not translated.

There is no API key. Attribution remains visible. Hosted tiles require an internet connection and a browser with WebGL. Provider errors produce a visible message without replacing calculated routes with straight lines. Existing `JELAJAH_TILE_URL` / `JELAJAH_TILE_ATTRIBUTION` overrides remain supported, but custom raster tiles cannot be translated by the app.

The Vite build emits a local MapLibre worker asset; this explicit worker configuration is required. Provider documentation: https://openfreemap.org/quick_start/

## Expanded view

Group and personal plans offer Expand map / Besarkan peta. The dialog contains the selected day's routes and itinerary cards below the map. Selecting a located activity focuses its numbered pin. Unlocated items stay visible with a missing-pin label. Close, Escape, scroll locking and keyboard focus restoration use the shared Modal component, now portalled to the document body to avoid clipping by page layouts.

Validation: production build; existing 252 unit tests; desktop and 390px mobile checks of Day 2, English base labels, train geometry, itinerary selection, close/focus restoration and horizontal overflow. Screenshots are in `design/journal-v029/expanded-map-desktop.png` and `expanded-map-mobile.png`.


## Connected planner refresh — 11 October 2026

The local planning screen now uses shared `PlanDaySummary` and `TransportLeg` components for group and personal plans. Transport details and mode actions appear between their matching activities, with start/end connections retained. Summaries show next unfinished activity (not a live destination-time prediction), completion progress and known/estimated route minutes. Existing group/personal data contracts and financial calculations remain intact.

Green journal headers, selected activity cards, accessible native disclosure controls and responsive day cards replace the earlier dense transport listing. Map-pin clicks highlight the corresponding activity. Leaflet defers vector rendering while a mobile map has zero dimensions, avoiding the day-switch crash found in browser checks.

Travel notes live beneath the current day's workspace. The unified note editor preserves group checklist items and completion, supports private notes and fixes the date field. Group checklist access follows existing organiser/editor permissions. Personal-plan mode controls update only the personal owner's plan. A local admin personal copy was created for browser verification.

Validation: 264 tests across 30 files pass; production build succeeds with the existing bundle-size warning. Browser checks cover 390px mobile, desktop, day switching with a hidden map, keyboard transport disclosure and map-to-activity selection. Provider activation remains separate: Geoapify/Google Embed keys are still required for live preview calls. This is the planning-screen release; broader Today/onboarding/ideas work remains on the proposed roadmap.

## Compact trip settings

Trip details appear first. The member card uses compact initials avatars with name tooltips on hover and keyboard focus. Organisers can select an avatar to find that traveller, or open Manage members for the searchable, paginated directory, membership checkboxes, role controls, leadership transfer, and add-traveller form. Membership writes are serialized to avoid overlapping whole-list updates.

Validated the production build, all 264 tests, keyboard tooltip, member popup, and search/pagination against the local 18-member trip. Screenshots remain local under output/ui.
