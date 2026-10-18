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

## Document library

Categories and visibility are independent. Uploads use Accommodation, Transport & logistics, or Other with a reusable custom category. Categories are saved per user and trip and survive file deletion. Folder mode shows default Private/Whole trip locations and named folders; list mode is a table with file name, category, folder/visibility, date and actions, with horizontal scrolling on mobile.

Every trip member can create groups and named private, group or whole-trip folders. A group creator and trip leaders may edit its name and participant list. The creator is always part of the group; other access follows its current membership. Leaders can manage group membership but are not silently granted access to group documents. Private folders remain owner-only, including against application administrators. Removed trip members lose document access. File uploaders can rename/delete their accessible files; leaders also manage whole-trip documents.

Only organiser uploads to Whole trip using a booking category run OCR/review and can feed the shared plan. Restricted files are stored without parsed booking metadata and cannot be confirmed into expenses; the upload form explains this. Existing personal documents retain private ownership, and existing shared files remain Whole trip. The internal legacy personal doc_type is retained as a restricted-storage marker; it is no longer a user-facing category.

Schema: server/lib/document-schema.ts applies four repeatable CREATE TABLE statements before library operations: document_groups, document_group_members, document_folders, and document_categories. The same DDL is in migrations/0002_document_library.sql for CLI use. No existing rows are rewritten and failed schema work is retried on the next request. Folder assignment/category are server-controlled parsed_json metadata. Document and library routes bypass offline caches and return no-store.

Deleting a booking document atomically unlinks expenses and marks their metadata source_document_removed, then removes the file. Group planner, live guest projection and suggested stays exclude those derived bookings. Accounting records, manual activities, independent personal copies and published snapshots remain. External storage deletion cannot share a D1 transaction; a storage failure can leave an inaccessible orphan object and reports an error.

Validation: production build and 269 tests pass, covering owner/admin/other-member/removed-member access, group revocation and leadership management, custom category persistence, rename validation, and deletion preserving money/manual activities. Browser checks cover local group/folder creation, desktop table and mobile horizontal scrolling. Local preview data includes a Travel research group (creator only) and its Research notes folder. Production deployment must be verified separately after merging.

## Tokyo transit directions restoration

The Geoapify/Google preview popup had omitted the existing Tokyo network result and the compact timeline hid station information inside disclosures. Transit options now receives the existing rail result and displays it with its route map. Both group and personal transport rows show boarding/transfer/exit steps, with the station chain visible even when collapsed. Rail API responses carry contiguous line steps with departure/arrival stations and ride durations. The routing hook publishes available rail geometry/instructions before optional walking enrichment finishes.

Verified against local Jelajah Jepun Day 2, teamLab Planets to Sensoji: boarding Shin-toyosu, changing at Toyosu, Tsukishima and Shin-Okachimachi, exiting Asakusa. The popup and day map both render the route. This restores the bundled Tokyo coverage, not all-Japan live routing; durations remain estimates. Production build and all 269 tests pass, including assertions for the transfer steps. Screenshot: output/ui/restored-tokyo-transit.png. Not deployed.

## Experimental transit flags

Admin > Experimental features has three independent, platform-wide switches: Geoapify preview, Google transit embed, and the external Google Maps link inside the transit popup. All default off. Settings are stored in app_settings.feature_flags; admin-only updates require booleans and are audited. The signed-in /journey/features read endpoint returns only these flags with no-store. The popup reloads flags each time it opens and fails closed if settings cannot load. Preview endpoints reject disabled providers before making upstream requests. Tokyo station directions and route geometry remain visible. Existing directions links elsewhere are unchanged.

Build and 270 tests passed, including default-off, admin authorization, validation, persistence, and server-side provider rejection. Local browser confirmed the popup retains boarding/exit guidance without preview controls. No deployment performed.


### Document review and feedback (October 2026)

Confirming a document stays on the review page and shows a saved confirmation. Leaders can use **Review again** on confirmed accommodation and logistics files; the form loads the linked expense, participants, custom shares and due dates. Saving replaces the existing shares and due dates in a D1 transaction, reusing the expense ID. Equal splits stay automatic when participants change; unequal splits remain custom. Room-based splits must still be edited in the ledger. Legacy documents with multiple linked expenses are blocked from review updates to avoid silently modifying the wrong record.

The shared Loading component animates the Jelajah J and travelling dot, with a static mark for reduced-motion preferences. It is used in app/trip boot, joining, plan loading, payment loading, document fetching and review saves. Document loading, request errors, empty folders and searches with no results have distinct feedback; failed requests never appear as an empty library. English and Bahasa Malaysia labels follow the current language.

Validation: production build and 271 tests passed, including real-SQLite document re-review, participant replacement, repeated saves, member authorization and protected room splits. No schema migration or provider setup is required.


### OCR initialization recovery

The tessdata_fast CDN supplies uncompressed `.traineddata` files; requesting `.gz` returned 404. Tesseract's createWorker initialization did not reject that language-load failure, leaving the modal locked. OCR now owns its native worker from startup, uses the bundled worker message protocol, loads compressed local English/Malay packs separately from uncompressed CDN Japanese/Chinese packs, and terminates on failure, cancellation, unmount or a 90-second per-stage timeout. Preserve the adapter contract when updating `public/tess/worker.min.js`.

PDF OCR rendering is capped at four megapixels per page, with canvas and PDF resources released. The UI distinguishes preparing pages from preparing language packs and allows cancellation before upload. Failed/cancelled processing restores retry and upload-as-is. Browser verification completed a synthetic image with all four languages enabled and verified startup cancellation. Build and 275 tests passed, including download format, initialization rejection, timeout, retry and worker cleanup. No migration is needed.


### Release detection and loading direction

The loading dot now follows the J's curve from its left tip to the top dot, using an SVG motion path rather than interpolating straight segments. Reduced motion retains the complete stationary logo.

Vite stamps the built service worker with the index/asset fingerprint. Application changes now produce a waiting worker and Refresh banner even when the cache schema does not change. Offline API/file cache names stay unchanged. Visible tabs check on return, reconnect and every five minutes; update availability is retained if the banner mounts after detection.

Production trip 5 diagnostics: driving and walking return `unconfigured` because production lacks ORS_API_KEY. Configure it as a runtime Worker secret (a build variable alone is insufficient). Greater Tokyo rail geometry is independent of ORS; outside that dataset the app explicitly reports unavailable rail coverage. Local live API and map checks passed for driving plus Tokyo train lines and station instructions.


## Activity cleanup (2026-10-18)

In Group plan → Day, editors and organisers can use **Select activities**,
select individual rows or **Select all**, then **Delete selected**. Selection
clears when changing days or trips. Failed deletions retain the selection.

**Reset day** clears all manually added/imported group activities and custom
transport choices for the selected date, after confirmation. Booking-derived
flight/stay events, documents, expenses, personal plans, travel notes, day
settings (including title/start/end) and budgets remain. Both actions are
permanent and show a warning. Reset uses one database transaction, supports
repeat requests, and needs no schema migration. Hidden-plan restrictions apply.

Validation: `npm test` (279 tests) and `npm run build`; API tests cover role and
trip boundaries, invalid dates, preservation of notes/settings, repeated reset,
and bulk selections exceeding D1's per-query parameter limit.
