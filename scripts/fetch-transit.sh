#!/usr/bin/env bash
# Download the Malaysia (data.gov.my GTFS, CC BY 4.0) and Singapore
# (OpenStreetMap via Overpass, ODbL) transit sources into <dir>, then build:
#   bash scripts/fetch-transit.sh /tmp/transit-feeds
#   python3 scripts/build-transit.py /tmp/transit-feeds server/data/transit
set -euo pipefail
DIR="${1:?usage: fetch-transit.sh <dir>}"; mkdir -p "$DIR"; cd "$DIR"
API=https://api.data.gov.my/gtfs-static
for c in rapid-rail-kl rapid-bus-kl rapid-bus-mrtfeeder rapid-bus-penang; do
  curl -fsSL -o "prasarana-$c.zip" "$API/prasarana/?category=$c"
done
for a in ktmb mybas-alor-setar mybas-ipoh mybas-johor mybas-kangar mybas-kota-bharu \
         mybas-kuala-terengganu mybas-kuching mybas-melaka mybas-seremban-a mybas-seremban-b; do
  curl -fsSL -o "$a.zip" "$API/$a/"
done
UA="Jelajah/1.0 (family trip planner; github.com/hamzahbuilds/jelajah)"
OVERPASS=https://overpass-api.de/api/interpreter
SG='area["ISO3166-1"="SG"][admin_level=2]->.sg;'
q() { curl -fsS -m 600 -A "$UA" -H "Accept: application/json" --data-urlencode "data=[out:json][timeout:300];$SG$1" "$OVERPASS" -o "$2"; }
q 'rel(area.sg)["type"="route"]["route"~"^(subway|light_rail|monorail)$"];out geom;' sg-rail-geom.json
q 'rel(area.sg)["type"="route"]["route"~"^bus$"];out geom;' sg-bus-geom.json
q 'rel(area.sg)["type"="route"]["route"~"^(subway|light_rail|monorail|bus)$"]->.r;node(r.r);out tags;' sg-nodes.json
ls -la "$DIR"
