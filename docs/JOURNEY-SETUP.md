# Journey features: setup and review

The new planning, private notes, sharing, guide discovery and print views work
without paid services. Email recovery and actual walking/driving routes require
the optional credentials below. No secrets belong in Git or `wrangler.toml`.

## Cloudflare dashboard setup

Open the existing Jelajah Worker → Settings → Variables and Secrets. Add these
values using the dashboard; keep the current D1/KV bindings unchanged.

| Name | Type | Value |
| --- | --- | --- |
| RESEND_API_KEY | Secret | A sending key from your Resend account |
| RESET_EMAIL_FROM | Variable | An address on your verified sender domain, e.g. `Jelajah <travel@your-domain.example>` |
| APP_ORIGIN | Variable | The canonical HTTPS app origin, e.g. `https://your-jelajah.example`; no path |
| RESEND_DAILY_LIMIT | Variable, optional | Maximum recovery emails/day, capped at 90; default 90 |
| ORS_API_KEY | Secret | Your openrouteservice key |
| ORS_DAILY_LIMIT | Variable, optional | Maximum upstream route requests/day, capped at 1900; lower this to your account allowance |
| GEOCODER_URL | Variable, optional | HTTPS Photon-compatible `/api/` endpoint; default `https://photon.komoot.io/api/` |

Resend requires verification of a domain you control before emailing arbitrary
recipients. Configure the DNS records shown in its dashboard. Domain ownership
may have an existing cost; the application does not purchase a domain. Missing
mail configuration shows a contact-organiser message on Forgot password.

Check current account quotas before enabling providers:
[Resend pricing](https://resend.com/pricing) and
[openrouteservice account plans](https://account.heigit.org/info/plans).
The application caps reset email at 90/day and 2800/calendar month, requests at
3/address/hour and 10/IP/hour, and routes at 35/minute and 1900/calendar day by
default. These are application caps, not a promise of the provider's allowance.
Use dedicated keys/accounts or reserve headroom for other applications. Do not
enable billing upgrades if maintaining RM0 recurring service use is required.

Route cache hits do not consume upstream quota. A quota or provider failure
shows Route unavailable and an external directions link. Tokyo public transport draws suggested rail routes from bundled TokyoGTFS shapes.
Outside the dataset coverage, external directions remain available. Neither
rail suggestions nor fare estimates claim live timetables or fares.
Standard OpenStreetMap tiles are used directly, with attribution and no API key. Hosted map tiles and Photon
are shared services with usage policies; configure a suitable provider as usage
grows. Open-source software does not imply unlimited free hosted infrastructure.

## Local development

Use Node 24+ for the SQLite-backed integration tests (the application build
continues to use the existing Cloudflare toolchain). Run `npm ci`, then
`npm run build` and `npm test`.

The existing browser suite uses Playwright as a local-only test tool. Install it
without saving it to the application manifest and install Chromium. Since npm
may re-resolve the dependency tree during a no-save install, restore locked
application dependencies before treating results as the final release baseline.

Use a fresh local `--persist-to .wrangler/<test-run-name>` directory when seeding
and running Wrangler. Seed `migrations/0001_init.sql`, then `scripts/seed.sql`,
then the deterministic FX seed against that same directory. Never use `--remote`
for tests. Start the local Worker on port 8788.

Run `node scripts/e2e.mjs` first. It changes the seeded admin password to
`kata-laluan-baru-99`. Then run `node scripts/journey-e2e.mjs` against the same
local server. The latter creates a synthetic Tokyo trip; screenshots and PDF
checks go to ignored `e2e-shots/journey/`. Optional environment variables are
`JELAJAH_TEST_URL` and `JELAJAH_TEST_PASSWORD`. Use only an isolated local fixture
server: these scripts create and modify test records.

For local provider checks use an ignored `.dev.vars` file. Verify a real recovery
email only with an address you control, and check one walking and driving route
after credentials are configured. Mocked tests verify provider response handling;
they do not prove live email delivery or regional routing coverage.

## Migration and release review

The migration adds separate journey tables, indexes and a group registry. It
does not rewrite existing activities, day settings, financial records or private
spending. Schema and backfill are repeatable; completion is recorded after a
successful backfill. Existing group API paths remain compatible.

Before production deployment, export a D1 backup and review the source diff.
The release archive excludes `wrangler.toml`, local data, dependencies, secrets
and test screenshots. Upload the reviewed source through the normal existing
GitHub/Cloudflare workflow. No deployment or push is performed by this change.

If rollback is needed, redeploy the previous application version; additive
journey tables can remain. Previously issued public links will stop resolving
under the old app. Do not delete journey tables to roll back UI code.

New personal/shared/guest data is excluded from the service-worker offline
cache. Existing group offline reading remains. Users should apply the app's
normal update prompt before using the new release. Revoking access affects
future server reads; already downloaded PDFs or screenshots cannot be recalled.

Check Cloudflare logs for journey request failures, migration errors, repeated
quota responses and the generic recovery-delivery-failed event. Reset addresses,
tokens and provider credentials are never logged by the new module. Admin's
Manage public guides card supplies takedown/restore controls.

## Existing dependency advisories

The locked baseline dependency tree has existing npm audit advisories. The
11 October review identified production advisories in `hono` (JSX boundary
escaping) and `pdfjs-dist` (malicious PDF execution), plus development-tool
advisories. This feature release does not perform a broad dependency upgrade.
Review and patch those dependencies before production release; the new public
views use React text rendering and strict public DTOs, but that is not a fix for
the existing PDF upload/extraction dependency advisory.

### Enable local routing

Create a free API key at https://openrouteservice.org/log-in/ and put
`ORS_API_KEY=your-key` in an untracked `.dev.vars` file in the repository root.
Restart the local Wrangler process with the **same** `--persist-to` directory
(`.wrangler/final-v028` for the current review server), then reload the trip.
Do not put this key in browser code, commit it, or change the database directory.
Select Walking or Driving between stops with coordinates. Tokyo transit draws rail geometry from the bundled dataset; walking connections
use ORS. Missing, rejected, and quota-limited keys now have
distinct messages. Tiles and routing are separate services: working map tiles
alone do not enable routing.

Custom tile deployments may set `window.JELAJAH_TILE_URL` and
`window.JELAJAH_TILE_ATTRIBUTION` together. Follow the
[OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/):
retain attribution and browser caching; do not bulk download or prefetch tiles.

## Tokyo train routes

Train, metro, intercity and personal-plan transit selections use a bundled
MIT-licensed TokyoGTFS network. Coloured lines follow feed rail shapes, with
ORS walking routes for station access, transfers and egress. Route details show
line names and transfer stations. The same implementation serves group and
personal plans. No additional provider key or recurring service is needed for
the rail segments themselves.

This is a **network-based route suggestion**, not a timetable journey planner:
observed directed service edges, estimated running times, a five-minute initial
wait, five-minute transfer allowance, and calculated walking connections are
used. It does not check the trip's departure date/time, cancellations, frequency,
opening hours, accessibility, or fares. It may choose a service that does not
run at your chosen time; check departures via the external directions link.
Station transfers use feed parent-station membership; transfers between distinct
station complexes are not inferred. Coverage is greater Tokyo, not all Japan;
endpoints must be within 1.4 km of represented stops. Unavailable walking
connections are explicitly reported and never drawn as invented straight lines.

Data provenance, download date and source archive SHA-256 are in
`server/data/tokyo-rail.json`. To update, download the feed from
https://mkuran.pl/gtfs/tokyo/rail.zip and run
`python scripts/build-tokyo-rail.py <downloaded-zip>`; review the resulting diff,
run `npm test`, and rebuild. This imports data, not the upstream generator code.
The dataset license is preserved in `docs/TOKYO-RAIL-LICENSE.txt`.

Validation: the exact Day 2 teamLab Planets → Sensoji leg was tested live with
Public transport selected and visually checked. Unit tests cover real rail
geometry, reverse direction, walking endpoints, and unsupported regions.
