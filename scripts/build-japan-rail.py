"""Compile Japan-wide rail (OpenStreetMap, ODbL) into routing networks (v0.45).

Usage:
  bash scripts/fetch-japan-rail.sh /tmp/jp-feeds
  python3 scripts/build-japan-rail.py /tmp/jp-feeds server/data/transit

Inputs per region (see fetch-japan-rail.sh): jp-<region>-geom.json (route
relations with `out geom`) and jp-<region>-nodes.json (member node tags).

Output: one network per region (JR, private railways, subways, monorails,
trams) plus one national Shinkansen network, in the same compact v1 format
as scripts/build-transit.py, merged into server/data/transit/manifest.json
(existing non-jp networks are kept) and index.ts regenerated.

Times are estimates: a relation's own `duration`/`distance` tags when both
are present, else a typical speed for the kind of line. Shapes follow the
real track: each hop is sliced out of the relation's chained ways. A hop
whose track was already stored the other way round reuses it reversed
(shape index -2 - i), which roughly halves the size.
"""
import datetime, hashlib, json, math, pathlib, re, sys

FEEDS = pathlib.Path(sys.argv[1])
OUT = pathlib.Path(sys.argv[2])
TODAY = datetime.date.today().isoformat()
ATTR = 'Japan rail data © OpenStreetMap contributors, ODbL'
SRC = 'https://www.openstreetmap.org (Overpass)'
BOXES = {
    'kanto': (34.8, 138.3, 37.2, 141.0), 'kansai': (33.4, 134.2, 36.0, 136.9), 'chubu': (34.5, 135.8, 38.6, 139.9),
    'tohoku': (36.8, 139.0, 41.6, 142.2), 'hokkaido': (41.3, 139.3, 45.6, 146.0), 'chugoku': (33.7, 130.8, 35.7, 134.5),
    'shikoku': (32.7, 132.0, 34.6, 134.8), 'kyushu': (30.9, 129.4, 34.3, 132.1), 'okinawa': (24.0, 122.9, 27.9, 131.4),
}
REGIONS = [
    ('kanto', 'Kanto (Tokyo, Yokohama)'), ('kansai', 'Kansai (Osaka, Kyoto, Kobe, Nara)'),
    ('chubu', 'Chubu (Nagoya, Kanazawa, Niigata)'), ('tohoku', 'Tohoku (Sendai)'),
    ('hokkaido', 'Hokkaido (Sapporo)'), ('chugoku', 'Chugoku (Hiroshima, Okayama)'),
    ('shikoku', 'Shikoku (Matsuyama, Takamatsu)'), ('kyushu', 'Kyushu (Fukuoka, Kagoshima)'),
    ('okinawa', 'Okinawa (Naha)'),
]
# (speed m/s on the track, dwell s per stop, default headway s)
KIND = {
    'shinkansen': (50.0, 60, 900), 'train': (14.0, 30, 600), 'subway': (10.0, 30, 300),
    'light_rail': (9.0, 25, 420), 'monorail': (9.0, 25, 420), 'tram': (5.5, 20, 480),
}

R = 6371000.0
def dist(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))

def rdp(points, eps):
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

def en(tags, *fallback):
    for k in ('name:en', 'name:ja-Latn', 'name:ja_rm', *fallback, 'name'):
        if tags.get(k):
            return tags[k].strip()
    return ''

def line_name(tags):
    # "JR Yamanote Line (Outer)", "Ginza Line (Shibuya → Asakusa)" -> the line itself
    name = en(tags)
    return re.sub(r'\s*[\(（][^)）]*[\)）]\s*$', '', name).strip() or name

def minutes(v):
    v = (v or '').strip()
    if re.fullmatch(r'\d+(\.\d+)?', v):
        return float(v)
    m = re.fullmatch(r'(\d+):(\d{2})(?::\d{2})?', v)
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None

# Shinkansen services are often mapped under the train's name, not the line's.
SHIN = {'のぞみ': 'Nozomi', 'ひかり': 'Hikari', 'こだま': 'Kodama', 'みずほ': 'Mizuho', 'さくら': 'Sakura',
        'つばめ': 'Tsubame', 'かがやき': 'Kagayaki', 'はくたか': 'Hakutaka', 'つるぎ': 'Tsurugi',
        'あさま': 'Asama', 'とき': 'Toki', 'たにがわ': 'Tanigawa', 'はやぶさ': 'Hayabusa', 'やまびこ': 'Yamabiko',
        'なすの': 'Nasuno', 'こまち': 'Komachi', 'つばさ': 'Tsubasa', 'はやて': 'Hayate', 'かもめ': 'Kamome'}

def shin_service(tags):
    base = re.sub(r'\s*[\(（].*$', '', tags.get('name', '')).replace('列車', '').replace('号', '').strip()
    return SHIN.get(base) or SHIN.get(tags.get('network', '').strip())

def kind_of(tags):
    name = tags.get('name', '') + tags.get('name:en', '')
    if ('新幹線' in name or 'Shinkansen' in name or tags.get('service') == 'high_speed'
            or tags.get('highspeed') == 'yes' or shin_service(tags)):
        return 'shinkansen'
    return tags.get('route') if tags.get('route') in KIND else 'train'

def chain(rel):
    """Join the relation's track ways into one ordered polyline."""
    ways = [m['geometry'] for m in rel['members']
            if m['type'] == 'way' and m.get('role', '') in ('', 'forward', 'backward', 'main') and m.get('geometry')]
    ways = [[(p['lat'], p['lon']) for p in w] for w in ways if len(w) >= 2]
    if not ways:
        return []
    line = list(ways[0])
    if len(ways) > 1:
        nxt = ways[1]
        d_end = min(dist(line[-1], nxt[0]), dist(line[-1], nxt[-1]))
        d_start = min(dist(line[0], nxt[0]), dist(line[0], nxt[-1]))
        if d_start < d_end:
            line.reverse()
    for w in ways[1:]:
        if dist(line[-1], w[-1]) < dist(line[-1], w[0]):
            w = list(reversed(w))
        line += w[1:] if dist(line[-1], w[0]) < 1 else w
    return line


class Net:
    def __init__(self, nid, name):
        self.id, self.name = nid, name
        self.stops, self.names, self.stop_index = [], [], {}
        self.lines, self.line_index, self.edges = [], {}, {}

    def stop(self, key, name, lat, lon):
        if key not in self.stop_index:
            self.stop_index[key] = len(self.names)
            self.names.append(name)
            self.stops.append((lat, lon))
        return self.stop_index[key]

    def line(self, short, long, colour, headway):
        k = (short, long, colour)
        if k not in self.line_index:
            self.line_index[k] = len(self.lines)
            self.lines.append([short, long, colour, 'train', headway])
        else:  # both directions of a line share one entry; keep the shorter headway
            li = self.line_index[k]
            self.lines[li][4] = min(self.lines[li][4], headway)
        return self.line_index[k]

    def edge(self, a, b, line, seconds, shape):
        if a == b:
            return
        seconds = max(30, int(seconds))
        k = (a, b, line)
        if k not in self.edges or seconds < self.edges[k][0]:
            self.edges[k] = (seconds, shape)

    def write(self):
        index, shapes, flat = {}, [], []
        for (a, b, line), (seconds, shape) in sorted(self.edges.items()):
            si = -1
            if shape and len(shape) >= 2:
                fwd, rev = encode(shape), encode(list(reversed(shape)))
                if fwd in index:
                    si = index[fwd]
                elif rev in index:
                    si = -2 - index[rev]
                else:
                    index[fwd] = len(shapes); shapes.append(fwd); si = index[fwd]
            flat += [a, b, line, seconds, si]
        lats = [s[0] for s in self.stops]; lons = [s[1] for s in self.stops]
        data = {
            'v': 1, 'id': self.id, 'name': self.name, 'country': 'JP', 'kind': 'rail',
            'source': SRC, 'attribution': ATTR, 'license': 'ODbL', 'built': TODAY,
            'bbox': [round(min(lats), 4), round(min(lons), 4), round(max(lats), 4), round(max(lons), 4)],
            'stops': [v for s in self.stops for v in (round(s[0] * 1e5), round(s[1] * 1e5))],
            'names': self.names, 'lines': self.lines, 'edges': flat, 'shapes': shapes,
        }
        text = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
        digest = hashlib.sha256(text.encode()).hexdigest()[:12]
        (OUT / f'{self.id}.json').write_text(text, encoding='utf-8')
        meta = {k: data[k] for k in ('id', 'name', 'country', 'kind', 'attribution', 'license', 'built', 'bbox')}
        meta.update({'key': f'transit/{self.id}@{digest}', 'bytes': len(text.encode()),
                     'stops': len(self.names), 'lines': len(self.lines), 'edges': len(self.edges)})
        print(f"{self.id:16} {meta['stops']:6} stops {meta['lines']:4} lines {meta['edges']:6} edges {meta['bytes']/1024:8.0f} KB")
        return meta


ROMAJI = {}  # Japanese station name -> English, learnt from every node that has both


def add_relation(net, rel, tags_of):
    t = rel.get('tags', {})
    if t.get('disused') or t.get('abandoned') or t.get('construction') or t.get('proposed'):
        return
    kind = kind_of(t)
    speed, dwell, headway = KIND[kind]
    members = [m for m in rel['members'] if m['type'] == 'node' and (m.get('role') or '').startswith('stop') and 'lat' in m]
    if len(members) < 2:  # older tagging: platforms only
        members = [m for m in rel['members'] if m['type'] == 'node' and (m.get('role') or '').startswith('platform') and 'lat' in m]
    if len(members) < 2:
        return
    interval = minutes(t.get('interval'))
    if interval:
        headway = int(min(max(interval * 60, 120), 3600))
    # Calibrate on the relation's own timing when it has one.
    total_min, total_km = minutes(t.get('duration')), t.get('distance')
    calibrated = None
    try:
        if total_min and total_km and float(total_km) > 0:
            calibrated = float(total_km) * 1000 / (total_min * 60)
            if not (3 <= calibrated <= 80):
                calibrated = None
    except ValueError:
        pass
    ref = (t.get('ref') or '').strip()
    long = line_name(t) or ref
    # "Rapid Express" alone doesn't say whose train: add the operator.
    if re.match(r'(?i)^(rapid|express|local|limited|semi|sub|commuter|special|section)\b', long):
        op = (t.get('operator:en') or t.get('network:en') or '').strip()
        if op:
            long = f"{re.sub(r'(?i)\s*(Co\.?,?\s*Ltd\.?|Corporation|Company)$', '', op).strip()} {long}"
    svc = shin_service(t) if kind == 'shinkansen' else None
    if svc:  # "はやぶさ列車" / "Nozomi (Tokyo => Hakata)" -> "Nozomi Shinkansen"
        ref, long = '', f'{svc} Shinkansen'
    li = net.line(ref if ref and ref != long else long, long, (t.get('colour') or '').lstrip('#').upper()[:6], headway)
    track = chain(rel)
    prev, prev_i = None, 0
    for m in members:
        tags = tags_of.get(m['ref'], {})
        name = en(tags) or long
        name = ROMAJI.get(name, name)  # 池袋 -> Ikebukuro when another node of that station says so
        s = net.stop(m['ref'], name, m['lat'], m['lon'])
        here = (m['lat'], m['lon'])
        # nearest track vertex at or after the previous stop's
        cur_i = prev_i
        if track:
            best = math.inf
            for i in range(prev_i, len(track)):
                d = dist(here, track[i])
                if d < best:
                    best, cur_i = d, i
            if best > 300:
                cur_i = prev_i
        if prev is not None and prev != s:
            a = net.stops[prev]
            shape = None
            if track and cur_i > prev_i:
                shape = rdp([a] + track[prev_i + 1:cur_i] + [here], 12.0)
                shape = [(round(p[0], 5), round(p[1], 5)) for p in shape]
            length = sum(dist(shape[i], shape[i + 1]) for i in range(len(shape) - 1)) if shape else dist(a, here) * 1.15
            seconds = length / calibrated if calibrated else length / speed + dwell
            net.edge(prev, s, li, seconds, shape)
        prev, prev_i = s, cur_i


def home_of(rel):
    """The region holding most of a line's stations, so each line is built once
    and a region's box stays near the region (long lines no longer stretch it)."""
    pts = [(m['lat'], m['lon']) for m in rel['members'] if m['type'] == 'node' and 'lat' in m] or \
          [(p['lat'], p['lon']) for m in rel['members'] if m['type'] == 'way' for p in (m.get('geometry') or [])[:1]]
    best, home = -1, None
    for rid, (a, b, c, d) in BOXES.items():
        n = sum(1 for la, lo in pts if a <= la <= c and b <= lo <= d)
        if n > best:
            best, home = n, rid
    return home


def main():
    regional = {}
    shinkansen = Net('jp-shinkansen', 'Japan Shinkansen')
    seen_shin, seen = set(), set()
    for rid, label in REGIONS:
        g, n = FEEDS / f'jp-{rid}-geom.json', FEEDS / f'jp-{rid}-nodes.json'
        if not g.exists() or not n.exists():
            print('skip', rid); continue
        rels = json.load(open(g))['elements']
        tags_of = {e['id']: e.get('tags', {}) for e in json.load(open(n))['elements']}
        for tg in tags_of.values():
            if tg.get('name') and tg.get('name:en'):
                ROMAJI.setdefault(tg['name'].strip(), tg['name:en'].strip())
        net = Net(f'jp-{rid}-rail', f'Japan rail: {label}')
        for rel in rels:
            if kind_of(rel.get('tags', {})) == 'shinkansen':
                if rel['id'] not in seen_shin:
                    seen_shin.add(rel['id']); add_relation(shinkansen, rel, tags_of)
            elif home_of(rel) == rid and rel['id'] not in seen:
                seen.add(rel['id']); add_relation(net, rel, tags_of)
        regional[rid] = net
    metas = [net.write() for net in regional.values() if net.names]
    if shinkansen.names:
        metas.append(shinkansen.write())

    mf = OUT / 'manifest.json'
    manifest = json.loads(mf.read_text()) if mf.exists() else {'networks': []}
    keep = [m for m in manifest['networks'] if m.get('country') != 'JP']
    manifest = {'built': TODAY, 'networks': keep + metas}
    mf.write_text(json.dumps(manifest, indent=1), encoding='utf-8')
    loaders = '\n'.join(f"  '{m['id']}': () => import('./{m['id']}.json')," for m in manifest['networks'])
    (OUT / 'index.ts').write_text(
        '// Generated by scripts/build-transit.py and scripts/build-japan-rail.py. Do not edit.\n'
        "import manifest from './manifest.json';\n"
        'export { manifest };\n'
        'export const loaders: Record<string, () => Promise<{ default: unknown }>> = {\n' + loaders + '\n};\n',
        encoding='utf-8')
    print(f"{len(metas)} Japan networks, {sum(m['bytes'] for m in metas)/1024/1024:.1f} MB")


main()
