# Transit previews: Geoapify and Google Maps

The current **Transit options** dialog in group and personal plans offers:
- **Try Geoapify**: approximate OSM transit geometry and estimated duration/distance on the existing map. This is not a timetable or fare quote. Unsupported routes show an unavailable message, never an invented straight line.
- **View Google transit map**: a separate Google Maps Embed directions iframe, loaded only when selected. Its route selection cannot be imported into Jelajah. No departure date is passed; check the journey date/time with Google or the operator.
- **Open Google Maps in a new tab**: works without either API key.

Both previews leave saved plans and financial records unchanged. Existing Tokyo routing and walking/driving routing remain unchanged.

## Setup

Add locally to ignored `.dev.vars`; use `wrangler secret put NAME` for production after deployment approval:

```
GEOAPIFY_API_KEY=<your key>
GEOAPIFY_DAILY_LIMIT=100
GOOGLE_MAPS_EMBED_KEY=<restricted browser key>
```

Geoapify: create a free project at https://myprojects.geoapify.com/. The key stays in the Worker. Free plan currently includes 3,000 credits/day; route length affects credit cost. The app caps requests at 100/day (configurable downwards), 10/minute globally and 6/minute/user. This is a request budget, not a guarantee of credit usage across other apps sharing the key. Results cache for one hour. Keep the account on its free plan and monitor provider usage.

Google: enable **Maps Embed API** in a billing-enabled Cloud project. Embed usage is no-charge. This key is necessarily visible to browsers: restrict it to Maps Embed API and HTTP referrers for the production domain and local development origin. The iframe uses a referrer policy compatible with Google's key checks. No Google Routes API calls are made. Provider errors inside Google's cross-origin frame cannot be inspected by Jelajah; the external link remains available.

Missing keys, quotas and provider failures are explicit. Live coverage and iframe display still need checking with configured keys in London, Paris, Madrid, Rome and Tokyo. No complete country coverage or fare support is claimed.

Sources: https://apidocs.geoapify.com/docs/routing/ ; https://www.geoapify.com/pricing/ ; https://developers.google.com/maps/documentation/embed/embedding-map ; https://developers.google.com/maps/documentation/embed/usage-and-billing

## Previous MOTIS integration (inactive)

The `/transit-options` endpoint is retained for a future approved MOTIS provider. The current UI uses `/transit-preview`. Do not enable hosted Transitous for this closed-source project: its hosted policy requires open-source licensing. The historical integration notes below describe that unused endpoint.

---

# European public transport: integration preview

## What is ready

Group and personal plan legs have **Find transit schedules**. It searches explicitly for a departure date/time and timezone, previews up to three returned timetable journeys, their duration and transfers, individual leg times, available geometry, and named ticket products with currencies. It does not change saved activities or expenses. Selecting an option changes the preview map only; saving a selected service to the itinerary is not implemented.

The Worker exposes an authenticated, trip-membership-checked `/api/journey/trips/:id/transit-options` endpoint using the MOTIS v6 plan contract. Requests are cached for five minutes and limited to six per user per minute, ten globally per minute and 100 globally per day by default. There are no automatic schedule requests during ordinary planning. Secrets or operational trip details are not sent: only endpoint coordinates and requested departure time.

The original Tokyo geometry routing remains available. Legacy Japanese price/duration estimates are no longer shown for European coordinates, and their automatic fare-to-ledger actions are disabled there. Users can still enter confirmed expenses through the money workflow.

## Activation is outstanding

No live provider is enabled and no routing requests have been sent to Transitous. User confirmed non-commercial use for now. Transitous requires an appropriate open-source licence, attribution and project contact before routing use. A public GitHub repository alone does not establish its open-source licence; this repository's licence must be resolved before activation.

1. Contact the Transitous maintainers in their linked Matrix channel and arrange routing usage.
2. Resolve the app's open-source licence with the owner.
3. After agreement, configure server-side `TRANSIT_PLAN_URL` to the approved MOTIS **v6** plan URL and `TRANSIT_CONTACT` to a project contact URL or email. Confirm supported API version with the provider. `TRANSIT_DAILY_LIMIT` can reduce the default 100 requests/day. Self-hosted MOTIS is another option, with hosting costs.
4. Verify real dated routes in London, Paris, Madrid/Barcelona and Rome/Milan, plus desired intercity journeys, before describing those regions as supported in production.

Provider feeds are listed for GB, FR, ES and IT; this does not prove every city, operator, future date or cross-border route is covered. UK source coverage must be checked separately for Northern Ireland. No blanket country-wide coverage claim is made.

## Fares

MOTIS can return GTFS fare products where feeds supply them. Products may cover only some legs and may include child rates, passes, discounts or transfer adjustments. They are shown as named products, never summed into a purported journey total. Missing prices say Fare unavailable. Dynamic intercity prices and guaranteed ticket quotes need an operator/ticketing provider. Tokyo fare estimates remain estimates, not live quotes.

## Contact draft (not sent)

Hello Transitous team, I maintain Jelajah, a non-commercial group travel-planning app: https://github.com/hamzahbuilds/jelajah. We would like to offer user-initiated timetable route previews, initially for the UK, France, Spain and Italy. Our planned limits are 10 requests/minute globally and 100/day, with five-minute caching, a contact User-Agent and visible source attribution. We are resolving the repository's open-source licence before activation. Would this use fit your capacity and policy, and which stable MOTIS plan endpoint should we use? We can lower the limits to suit your guidance.

## Sources checked 2026-10-11

- https://transitous.org/api/ — usage, contact and attribution requirements.
- https://transitous.org/sources/ — source/operator listings.
- https://github.com/public-transport/transitous/tree/main/feeds — GB, FR, ES and IT feed definitions.
- https://github.com/motis-project/motis/blob/master/openapi.yaml — v6 plan, geometry precision, fare alternatives and transfer rules.

Validation uses synthetic provider fixtures, geometry decoding, daylight-saving edge cases and currency-estimate boundaries. Live provider coverage, prices and end-to-end searches remain unverified pending activation.
