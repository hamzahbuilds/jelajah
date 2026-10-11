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
