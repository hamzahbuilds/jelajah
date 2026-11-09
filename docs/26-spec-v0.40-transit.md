# v0.40 — Public transport for Malaysia and Singapore

Status: built locally (2026-11-09).

## What it does
A "train" leg in the plan now gets an offline, estimated route in **all of
Malaysia** and **Singapore** (Tokyo keeps its own network). The server tries
rail first (LRT, MRT, Monorail, KTM Komuter/ETS, BRT counts as bus), then rail +
bus where rail can't connect the two points (e.g. Ipoh, Kuching, Penang).
Directions list each line, where to board, change and get off, with an
estimated duration that includes a typical wait. Never a live timetable.

## Sources and licences (credit shown with every result)
| Network | Source | Licence |
| --- | --- | --- |
| Klang Valley rail (LRT, MRT, Monorail, BRT) | data.gov.my GTFS, Prasarana `rapid-rail-kl` | CC BY 4.0 |
| KTMB (Komuter, ETS, intercity, JB–Woodlands shuttle) | data.gov.my GTFS `ktmb` | CC BY 4.0 |
| Rapid KL buses + MRT feeders | Prasarana `rapid-bus-kl`, `rapid-bus-mrtfeeder` | CC BY 4.0 |
| Rapid Penang | Prasarana `rapid-bus-penang` | CC BY 4.0 |
| BAS.MY: Alor Setar, Ipoh, Johor, Kangar, Kota Bharu, Kuala Terengganu, Kuching, Melaka, Seremban A/B | data.gov.my GTFS `mybas-*` | CC BY 4.0 |
| Singapore MRT/LRT, buses | OpenStreetMap route relations (Overpass) | ODbL |

Not available as open data: Rapid Kuantan (endpoint listed but empty), Sabah.

## How it works
- `scripts/build-transit.py` compiles each feed into a compact network in
  `server/data/transit/` (1.8 MB for all 16): stops, lines with a typical
  headway, and stop-to-stop hops with the shortest observed running time (GTFS)
  or a distance estimate (OSM: rail ~40 km/h + 30 s dwell, bus ~18 km/h on a
  1.3 road factor + 20 s). Rail keeps simplified track shapes (Douglas–Peucker,
  8 m); buses draw stop to stop.
- `server/lib/transit.ts` loads only the networks whose box holds both points
  (each is its own lazily imported module, cached per isolate) and runs one
  Dijkstra across them: board = half the headway (≤15 min) on a line change;
  walk ≤1 km to/from stops and ≤400 m between stops (any network).
  Typical query 4–20 ms.
- `/api/journey/trips/:id/routes` (train modes) → MY/SG rail → MY/SG rail+bus →
  Tokyo. Response `source: 'my-sg-transit'` with `attribution` and `networks`.

## Refresh
```
bash scripts/fetch-transit.sh /tmp/transit-feeds
python3 scripts/build-transit.py /tmp/transit-feeds server/data/transit
npx vitest run tests/transit.test.ts
```
