#!/usr/bin/env bash
# Download Japan rail route relations from OpenStreetMap (Overpass, ODbL),
# one file pair per region, then build (v0.45, docs/26):
#   bash scripts/fetch-japan-rail.sh /tmp/jp-feeds
#   python3 scripts/build-japan-rail.py /tmp/jp-feeds server/data/transit
# Each region is ~50 MB of JSON; Overpass may answer 504 when busy, so every
# query retries, and a re-run skips the files already downloaded.
set -u
DIR="${1:?usage: fetch-japan-rail.sh <dir>}"; mkdir -p "$DIR"; cd "$DIR"
UA="Jelajah/1.0 (trip planner)"
OP=https://overpass-api.de/api/interpreter
F='["type"="route"]["route"~"^(train|subway|light_rail|monorail|tram)$"]'
q() { for i in 1 2 3 4; do curl -fsS -m 900 -A "$UA" --data-urlencode "data=[out:json][timeout:800];$1" $OP -o "$2.tmp" && mv "$2.tmp" "$2" && return 0; sleep 60; done; echo "FAIL $2"; }
while read id box; do
  [ -s "jp-$id-geom.json" ] || q "rel($box)$F;out geom;" "jp-$id-geom.json"
  [ -s "jp-$id-nodes.json" ] || q "rel($box)$F->.r;node(r.r);out tags;" "jp-$id-nodes.json"
  echo "done $id"
done <<'R'
kanto 34.8,138.3,37.2,141.0
kansai 33.4,134.2,36.0,136.9
chubu 34.5,135.8,38.6,139.9
tohoku 36.8,139.0,41.6,142.2
hokkaido 41.3,139.3,45.6,146.0
chugoku 33.7,130.8,35.7,134.5
shikoku 32.7,132.0,34.6,134.8
kyushu 30.9,129.4,34.3,132.1
okinawa 24.0,122.9,27.9,131.4
R
