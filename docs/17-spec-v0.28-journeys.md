# v0.28 — Personal journeys and organiser publishing

Implemented from the plan approved on 11 October 2026. The user explicitly
approved free services requiring API keys, superseding the older keyless-only
constraint in HANDOVER.md. Production deployment is a separate review step.

## Product behaviour

- Plan has Group plan, My plan, Shared with me, and leader-only Share & publish.
- My plan is one independent copy per user/trip. It copies schedule data and
  day start/end settings, including sanitised flight/stay events. It does not
  copy money records, booking references, documents, or participant identities.
- Personal plans use optimistic version checks; stale saves return 409. A
  selected group-activity copy explicitly replaces its earlier personal copy.
  An Undo action restores the previous personal schedule.
- Owners can grant read-only access to signed-in trip members. Every read checks
  current membership, feature visibility, owner status and grants. Platform
  admins cannot bypass personal ownership. Existing platform-admin trip access
  semantics remain in place for group data.
- Group notes retain existing permissions. Private notes belong exclusively to
  their author. Notes can apply to a day or the whole trip. Copying a private
  note to the group requires an explicit confirmation.
- Guest links are live, revocable, optionally expiring, unlisted, and noindex.
  Public guides are reviewed snapshots with day numbers and no live trip dates.
  Public views contain only title, destination, day titles, activity names,
  places, times, transport mode, visit duration and explicitly selected group
  notes. Activity free-text notes are excluded from publication.
- Guide drafts are editable. Publishing/re-publishing is explicit. Discovery
  searches published titles/destinations and filters maximum duration, 24/page.
  Admin can take down/restore guides; a taken-down guide cannot be republished
  by an organiser. No comments, open registration, or automated publishing.
- Guest and guide views provide browser Print / Save as PDF with repeating
  headers and the same public data projection as the screen.

## Architecture and compatibility

The existing group API remains authoritative. `itineraries` registers one group
per trip; group schedules read through to existing `activities`, `day_settings`
and `leg_overrides`. This avoids a second mutable group copy drifting out of
sync with the legacy UI, imports, AI or MCP. Personal rows store a bounded,
validated schedule JSON document with an owner and version. Group records and
financial tables are not re-keyed or rewritten.

New modules: `server/journey.ts`, `server/lib/journey-schema.ts`, and the shared
allowlist/validation types in `shared/journey.ts`. New routes are mounted under
`/api/journey`, before legacy session middleware. Public routes are registered
before the module's own authentication middleware; everything else requires
session auth and object-level authorisation.

New tables: itineraries, itinerary_viewers, private_notes, password_resets,
journey_limits, route_cache, guest_links, journey_guides, journey_migrations.
Schema creation is additive/idempotent. The group registry backfill and migration
marker share a transaction. Failed initialisation is retried rather than marked
successful. Tables are created automatically on first journey request on both
fresh and upgraded installations; no manual SQL or live binding changes.

Private data is deliberately absent from legacy REST group responses, AI context
and MCP group tools. Those tools continue to operate on the group plan only.
All new journey API responses are no-store and excluded from service-worker
caching. Existing offline group reading is preserved. New personal/shared plans
require a connection. Revoking a link cannot erase a PDF already downloaded.

## API overview

All paths below are relative to `/api/journey`.

| Area | Routes |
| --- | --- |
| Recovery | GET recovery/status; POST recovery/request, recovery/reset |
| Plans | GET trips/:id/plans, trips/:id/group; POST trips/:id/clone; GET/PUT plans/:id |
| Explicit updates | POST plans/:id/copy with selected source activity IDs and expected version |
| Selected viewers | GET/PUT plans/:id/viewers |
| Notes | GET/POST trips/:id/notes; PATCH/DELETE trips/:id/notes/:visibility/:noteId |
| Maps | POST trips/:id/routes; GET geocode |
| Publishing | POST trips/:id/publishing/preview; GET/POST publishing/links and publishing/guides; DELETE a link; PUT/DELETE a guide |
| Public | GET guest/:token, guides, guides/:id |
| Moderation | GET admin/guides; PATCH admin/guides/:id |

Recovery uses SHA-256 token hashes, 30-minute expiry, atomic single-use
consumption, IP/address rate limits, and password-reset session/API-token
invalidation. Reset tokens are carried in the URL fragment, removed from the
address bar on load, and never logged. Responses do not reveal whether an email
exists or claim confirmed delivery. Missing service configuration is explicit.

Leaflet remains the renderer. ORS walking/driving responses supply actual
geometry, distance and duration. Per-leg client cancellation avoids stale
responses. Server caches successful routes for seven days and applies shared
minute/day quotas. Transit uses an explicit external handoff; failed or
unconfigured road/walking routing is labelled unavailable. Geocoding uses a
configurable Photon-compatible endpoint, with no public Nominatim fallback.

## Verification

- Unit/integration tests use real SQLite with a D1 adapter, testing migration
  retries, ownership, membership removal, hidden features, private-note isolation,
  read-only grants, conflicts, public allowlists, expiry, revocation, immutable
  publication, takedown, provider failure/caching/quotas, and password recovery.
- Legacy REST and MCP privacy assertions ensure private notes never enter group
  projections. The existing full browser suite covers AI context and money paths.
- `scripts/journey-e2e.mjs` covers new UI flows, responsive screenshots, dark
  mode, BM publication, guest revocation, discovery, and multi-page print output.
- `scripts/e2e.mjs` uses the OS temporary directory instead of `/tmp`, allowing
  the existing suite to run on Windows without changing its assertions.

See `docs/JOURNEY-SETUP.md` for provider setup and operations. Build-status records
actual final verification results; historical test counts are not a substitute.

## Research behind the choices

- [Wanderlog](https://wanderlog.com/): linked map/itinerary planning and guides.
- [TripIt privacy](https://help.tripit.com/en/support/solutions/articles/103000063426-trip-privacy): private by default.
- [TripMapper permissions](https://help.tripmapper.co/en/articles/5646798-can-you-invite-others-to-view-and-edit-your-trip-itinerary): distinct viewers and editors.
- [TripMapper itinerary delivery](https://business.tripmapper.co/features/itinerary-builder): web and PDF delivery.
- [OpenTripPlanner](https://www.opentripplanner.org/): hosted OSM/GTFS processing is
  needed for in-app transit; deferred in favour of the approved maps handoff.
- [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/):
  public-service restrictions make an automatic autocomplete fallback unsuitable.
