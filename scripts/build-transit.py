"""Compile Malaysia and Singapore public transport into compact routing networks.

Usage:
  python scripts/build-transit.py <feeds-dir> server/data/transit

<feeds-dir> holds the downloads (see docs/26-spec-v0.40-transit.md, "Refresh"):
  * Malaysia: GTFS static zips from https://api.data.gov.my/gtfs-static/... (CC BY 4.0)
      prasarana-rapid-rail-kl.zip, prasarana-rapid-bus-kl.zip, prasarana-rapid-bus-mrtfeeder.zip,
      prasarana-rapid-bus-penang.zip, ktmb.zip, mybas-<city>.zip
  * Singapore: OpenStreetMap route relations via Overpass (ODbL)
      sg-rail-geom.json, sg-bus-geom.json (relations, `out geom`), sg-nodes.json (member node tags)

Output: one JSON per network plus manifest.json. Networks are schedule-free:
each stop-to-stop hop keeps its shortest observed running time (GTFS) or a
distance-based estimate (OSM), and each line keeps a typical headway, so the
router can add an average wait when boarding. Estimates, never timetables.

Compact format (v1):
  stops  flat [lat*1e5, lon*1e5, ...] ints;  names: list (same order)
  lines  [[short, long, colour, mode, headway_s]]
  edges  flat [from, to, line, seconds, shape] ints (shape -1 = straight line)
  shapes Google-encoded polylines (rail only; buses draw stop to stop)
"""
import csv, datetime, hashlib, io, json, math, pathlib, re, sys, zipfile
from collections import defaultdict

FEEDS = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
TODAY = datetime.date.today().isoformat()
MY_LICENSE = 'CC BY 4.0'
MY_ATTR = 'Transit data: data.gov.my (Prasarana, KTMB, BAS.MY), CC BY 4.0'
SG_ATTR = 'Transit data © OpenStreetMap contributors, ODbL'

R = 6371000.0
def dist(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))

def rdp(points, eps=8.0):
    """Douglas-Peucker in metres (local equirectangular)."""
    if len(points) < 3:
        return points
    lat0 = math.radians(points[0][0])
    xy = [(p[1] * 111320 * math.cos(lat0), p[0] * 110540) for p in points]
    keep = [False] * len(points); keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        s, e = stack.pop()
        ax, ay = xy[s]; bx, by = xy[e]
        dx, dy = bx - ax, by - ay; L = math.hypot(dx, dy) or 1e-9
        best, idx = 0.0, -1
        for i in range(s + 1, e):
            px, py = xy[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / L
            if d > best:
                best, idx = d, i
        if best > eps and idx > 0:
            keep[idx] = True; stack += [(s, idx), (idx, e)]
    return [p for p, k in zip(points, keep) if k]

def encode(points):
    out, plat, plon = [], 0, 0
    for lat, lon in points:
        ilat, ilon = round(lat * 1e5), round(lon * 1e5)
        for v in (ilat - plat, ilon - plon):
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20:
                out.append(chr((0x20 | (v & 0x1f)) + 63)); v >>= 5
            out.append(chr(v + 63))
        plat, plon = ilat, ilon
    return ''.join(out)

def secs(v):
    h, m, s = (int(x) for x in v.strip().split(':'))
    return h * 3600 + m * 60 + s

def tidy(name):
    """ALL-CAPS names to Title Case, keeping acronyms (KL, KLCC, LRT, MRT) and short codes."""
    name = (name or '').strip()
    if not name or not name.isupper():
        return name
    def word(w):
        core = re.sub(r'[^A-Za-z]', '', w)
        if len(core) <= 2 or not re.search(r'[AEIOU]', core):  # KL, SA, KLCC, TMN, KTM
            return w
        return w[:1] + w[1:].lower()
    return re.sub(r"[A-Za-z][A-Za-z']*", lambda m: word(m.group(0)), name)

class Net:
    def __init__(self, nid, name, country, kind, source, attribution, license_):
        self.id, self.name, self.country, self.kind = nid, name, country, kind
        self.source, self.attribution, self.license = source, attribution, license_
        self.stops, self.names, self.stop_index = [], [], {}
        self.lines, self.edges, self.shapes = [], {}, []
        self.sha = hashlib.sha256()

    def stop(self, key, name, lat, lon):
        if key not in self.stop_index:
            self.stop_index[key] = len(self.names)
            self.names.append(tidy(name))
            self.stops.append((lat, lon))
        return self.stop_index[key]

    def line(self, short, long, colour, mode, headway):
        # OSM names carry the direction, e.g. "MRT East-West Line (Changi Airport → Tanah Merah)"
        long = re.sub(r'\s*\([^)]*(→|->|↻|↺|Loop)[^)]*\)\s*$', '', tidy(long or '')).strip() or short
        self.lines.append([short.strip(), long, (colour or '').lstrip('#').upper()[:6], mode, int(headway)])
        return len(self.lines) - 1

    def edge(self, a, b, line, seconds, shape=None):
        if a == b:
            return
        seconds = max(20, int(seconds))
        k = (a, b, line)
        if k not in self.edges or seconds < self.edges[k][0]:
            self.edges[k] = (seconds, shape)

    def write(self):
        shape_index, shapes = {}, []
        flat_edges = []
        for (a, b, line), (seconds, shape) in sorted(self.edges.items()):
            si = -1
            if shape:
                if shape not in shape_index:
                    shape_index[shape] = len(shapes); shapes.append(shape)
                si = shape_index[shape]
            flat_edges += [a, b, line, seconds, si]
        lats = [s[0] for s in self.stops]; lons = [s[1] for s in self.stops]
        data = {
            'v': 1, 'id': self.id, 'name': self.name, 'country': self.country, 'kind': self.kind,
            'source': self.source, 'attribution': self.attribution, 'license': self.license, 'built': TODAY,
            'bbox': [round(min(lats), 4), round(min(lons), 4), round(max(lats), 4), round(max(lons), 4)],
            'stops': [v for s in self.stops for v in (round(s[0] * 1e5), round(s[1] * 1e5))],
            'names': self.names, 'lines': self.lines, 'edges': flat_edges, 'shapes': shapes,
        }
        text = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        digest = hashlib.sha256(text.encode()).hexdigest()[:12]
        (OUT / f'{self.id}.json').write_text(text, encoding='utf-8')
        meta = {k: data[k] for k in ('id', 'name', 'country', 'kind', 'attribution', 'license', 'built', 'bbox')}
        meta.update({'key': f'transit/{self.id}@{digest}', 'bytes': len(text.encode()),
                     'stops': len(self.names), 'lines': len(self.lines), 'edges': len(self.edges)})
        print(f"{self.id:28} {meta['stops']:6} stops {meta['lines']:4} lines {meta['edges']:6} edges {meta['bytes']/1024:8.0f} KB")
        return meta

# ---------- GTFS (Malaysia) ----------

def gtfs(net, path, mode_of, keep_shapes):
    z = zipfile.ZipFile(path)
    names = {pathlib.PurePath(i.filename).name: i.filename for i in z.infolist()
             if i.filename.endswith('.txt') and '__MACOSX' not in i.filename}
    def rows(n):
        if n not in names:
            return []
        return list(csv.DictReader(io.TextIOWrapper(z.open(names[n]), encoding='utf-8-sig')))
    raw_stops = {r['stop_id']: r for r in rows('stops.txt') if r.get('location_type', '0') in ('', '0', None)}
    routes = {r['route_id']: r for r in rows('routes.txt')}
    trips = {r['trip_id']: r for r in rows('trips.txt')}
    # stop_times.route_id isn't standard; trips.txt is the source of truth
    shapes = defaultdict(list)
    if keep_shapes:
        for r in rows('shapes.txt'):
            shapes[r['shape_id']].append((int(float(r['shape_pt_sequence'])), float(r['shape_pt_lat']), float(r['shape_pt_lon'])))
        for k in shapes:
            shapes[k] = [(p[1], p[2]) for p in sorted(shapes[k])]
    freq = defaultdict(list)
    for r in rows('frequencies.txt'):
        trip = trips.get(r['trip_id'])
        if trip:
            freq[trip['route_id']].append(int(r['headway_secs']))
    by_trip = defaultdict(list)
    for r in rows('stop_times.txt'):
        if r['trip_id'] in trips and r['stop_id'] in raw_stops and r.get('departure_time'):
            by_trip[r['trip_id']].append(r)
    starts = defaultdict(list)  # (route, direction) -> first departures
    line_of = {}
    def line_for(route_id):
        if route_id not in line_of:
            rt = routes.get(route_id, {})
            mode = mode_of(rt)
            hw = freq.get(route_id)
            line_of[route_id] = net.line(rt.get('route_short_name') or route_id, rt.get('route_long_name') or rt.get('route_short_name') or route_id,
                                         rt.get('route_color'), mode, (sum(hw) / len(hw)) if hw else 0)
        return line_of[route_id]
    for trip_id, st in by_trip.items():
        st.sort(key=lambda r: int(r['stop_sequence']))
        trip = trips[trip_id]
        li = line_for(trip['route_id'])
        starts[(trip['route_id'], trip.get('direction_id', '0'))].append(secs(st[0]['departure_time']))
        shape = shapes.get(trip.get('shape_id', '')) if keep_shapes else None
        for p, q in zip(st, st[1:]):
            if p['stop_id'] == q['stop_id']:
                continue
            ps, qs = raw_stops[p['stop_id']], raw_stops[q['stop_id']]
            a = net.stop(p['stop_id'], ps['stop_name'], float(ps['stop_lat']), float(ps['stop_lon']))
            b = net.stop(q['stop_id'], qs['stop_name'], float(qs['stop_lat']), float(qs['stop_lon']))
            dur = secs(q['arrival_time'] or q['departure_time']) - secs(p['departure_time'])
            if dur <= 0:  # some feeds give identical times: estimate from distance
                dur = dist(net.stops[a], net.stops[b]) / (11 if net.kind == 'rail' else 5) + 20
            enc = None
            if shape:
                ia = min(range(len(shape)), key=lambda i: dist(shape[i], net.stops[a]))
                ib = min(range(len(shape)), key=lambda i: dist(shape[i], net.stops[b]))
                if ib > ia + 1:
                    enc = encode(rdp([net.stops[a]] + shape[ia + 1:ib] + [net.stops[b]]))
            net.edge(a, b, li, dur, enc)
    # Headway without frequencies.txt: daytime spread of first departures.
    for route_id, li in line_of.items():
        if net.lines[li][4]:
            continue
        best = []
        for (rid, _), deps in starts.items():
            if rid != route_id:
                continue
            day = sorted(d for d in deps if 6 * 3600 <= d <= 22 * 3600) or sorted(deps)
            if len(day) > 1:
                best.append((day[-1] - day[0]) / (len(day) - 1))
        net.lines[li][4] = int(min(3600, max(120, min(best)))) if best else 3600
    for chunk in (path.read_bytes(),):
        net.sha.update(chunk)

def rail_mode(rt):
    return 'bus' if (rt.get('category') == 'BRT' or rt.get('route_type') == '3') else 'train'

# ---------- OSM (Singapore) ----------

def osm(net, geom_file, node_file, mode, speed, dwell, factor, headway):
    rels = json.load(open(FEEDS / geom_file))['elements']
    tags = {n['id']: n.get('tags', {}) for n in json.load(open(FEEDS / node_file))['elements']}
    stop_roles = ('stop', 'stop_entry_only', 'stop_exit_only') if mode == 'train' else ('platform', 'platform_entry_only', 'platform_exit_only')
    for rel in rels:
        t = rel.get('tags', {})
        if t.get('disused') or t.get('abandoned'):
            continue
        members = [m for m in rel['members'] if m['type'] == 'node' and m.get('role') in stop_roles and 'lat' in m]
        if mode == 'bus' and len(members) < 2:  # some bus routes only tag stop positions
            members = [m for m in rel['members'] if m['type'] == 'node' and (m.get('role') or '').startswith('stop') and 'lat' in m]
        if len(members) < 2:
            continue
        ref = t.get('ref') or t.get('name', '')
        li = net.line(ref, t.get('name') or ref, t.get('colour'), mode, headway)
        prev = None
        for m in members:
            name = tags.get(m['ref'], {}).get('name') or ref
            s = net.stop(m['ref'], name, m['lat'], m['lon'])
            if prev is not None and prev != s:
                d = dist(net.stops[prev], net.stops[s]) * factor
                net.edge(prev, s, li, d / speed + dwell)
            prev = s
    net.sha.update((FEEDS / geom_file).read_bytes())

# ---------- build ----------

manifest = []
def build(nid, name, country, kind, attribution, license_, source, fill):
    net = Net(nid, name, country, kind, source, attribution, license_)
    fill(net)
    if net.names:
        manifest.append(net.write())

MY_SRC = 'https://api.data.gov.my/gtfs-static'
f = lambda n: FEEDS / n
build('my-klang-valley-rail', 'Klang Valley rail (LRT, MRT, Monorail, BRT)', 'MY', 'rail', MY_ATTR, MY_LICENSE, MY_SRC + '/prasarana?category=rapid-rail-kl',
      lambda n: gtfs(n, f('prasarana-rapid-rail-kl.zip'), rail_mode, True))
build('my-ktmb', 'KTMB (Komuter, ETS, intercity)', 'MY', 'rail', MY_ATTR, MY_LICENSE, MY_SRC + '/ktmb',
      lambda n: gtfs(n, f('ktmb.zip'), lambda rt: 'train', False))
def kl_bus(n):
    gtfs(n, f('prasarana-rapid-bus-kl.zip'), lambda rt: 'bus', False)
    gtfs(n, f('prasarana-rapid-bus-mrtfeeder.zip'), lambda rt: 'bus', False)
build('my-klang-valley-bus', 'Rapid KL buses and MRT feeders', 'MY', 'bus', MY_ATTR, MY_LICENSE, MY_SRC + '/prasarana', kl_bus)
build('my-penang-bus', 'Rapid Penang buses', 'MY', 'bus', MY_ATTR, MY_LICENSE, MY_SRC + '/prasarana?category=rapid-bus-penang',
      lambda n: gtfs(n, f('prasarana-rapid-bus-penang.zip'), lambda rt: 'bus', False))
for city in ['alor-setar', 'ipoh', 'johor', 'kangar', 'kota-bharu', 'kuala-terengganu', 'kuching', 'melaka', 'seremban-a', 'seremban-b']:
    if (FEEDS / f'mybas-{city}.zip').exists():
        label = city.replace('-a', ' A').replace('-b', ' B').replace('-', ' ').title()
        build(f'my-{city}-bus', f'BAS.MY {label}', 'MY', 'bus', MY_ATTR, MY_LICENSE, f'{MY_SRC}/mybas-{city}',
              lambda n, c=city: gtfs(n, f(f'mybas-{c}.zip'), lambda rt: 'bus', False))
# Singapore: OSM has no timetables, so times come from distance (rail ~40 km/h
# with dwell; buses ~18 km/h on a road-distance factor) and a typical headway.
build('sg-rail', 'Singapore MRT and LRT', 'SG', 'rail', SG_ATTR, 'ODbL', 'https://www.openstreetmap.org (Overpass)',
      lambda n: osm(n, 'sg-rail-geom.json', 'sg-nodes.json', 'train', 11.1, 30, 1.15, 300))
build('sg-bus', 'Singapore buses', 'SG', 'bus', SG_ATTR, 'ODbL', 'https://www.openstreetmap.org (Overpass)',
      lambda n: osm(n, 'sg-bus-geom.json', 'sg-nodes.json', 'bus', 5.0, 20, 1.3, 600))

(OUT / 'manifest.json').write_text(json.dumps({'built': TODAY, 'networks': manifest}, indent=1), encoding='utf-8')
# Lazy loaders: each network is its own module, parsed only when a route needs it.
loaders = '\n'.join(f"  '{m['id']}': () => import('./{m['id']}.json')," for m in manifest)
(OUT / 'index.ts').write_text(
    '// Generated by scripts/build-transit.py. Do not edit.\n'
    "import manifest from './manifest.json';\n"
    'export { manifest };\n'
    'export const loaders: Record<string, () => Promise<{ default: unknown }>> = {\n' + loaders + '\n};\n',
    encoding='utf-8')
total = sum(m['bytes'] for m in manifest)
print(f'{len(manifest)} networks, {total/1024/1024:.1f} MB total')
