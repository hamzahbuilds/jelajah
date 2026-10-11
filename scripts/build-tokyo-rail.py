"""Compile TokyoGTFS rail shapes into a schedule-independent directed network.
Usage: python scripts/build-tokyo-rail.py path/to/rail.zip
Source: https://mkuran.pl/gtfs/tokyo/rail.zip (see docs/TOKYO-RAIL-LICENSE.txt).
No source generator code is copied. Only MIT-licensed output data is consumed.
"""
import bisect, csv, datetime, hashlib, io, json, pathlib, sys, zipfile
z = zipfile.ZipFile(sys.argv[1])
def rows(name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), encoding='utf-8-sig'))
def seconds(value):
    h,m,s=map(int,value.split(':'));return h*3600+m*60+s
stops={r['stop_id']:r for r in rows('stops.txt') if r['location_type'] != '1'}
routes={r['route_id']:r for r in rows('routes.txt')}
trips={r['trip_id']:r for r in rows('trips.txt')}
shapes={}
for r in rows('shapes.txt'):
    shapes.setdefault(r['shape_id'],[]).append((float(r['shape_dist_traveled']),float(r['shape_pt_lat']),float(r['shape_pt_lon'])))
for shape in shapes.values(): shape.sort()
# Retain each directed, observed station pair per line, selecting the shortest
# observed running time. This is an estimate, never a departure-time timetable.
edges={};prev=None
for r in rows('stop_times.txt'):
    if prev and prev['trip_id']==r['trip_id'] and prev['stop_id']!=r['stop_id']:
        trip=trips[r['trip_id']]; key=(prev['stop_id'],r['stop_id'],trip['route_id'])
        duration=seconds(r['arrival_time'])-seconds(prev['departure_time'])
        shape=shapes.get(trip['shape_id'])
        if duration>0 and shape and key[0] in stops and key[1] in stops and (key not in edges or duration<edges[key][0]):
            start=float(prev['shape_dist_traveled']);end=float(r['shape_dist_traveled'])
            a=max(0,bisect.bisect_left(shape,(start,))-1);b=min(len(shape),bisect.bisect_right(shape,(end,999,999))+1)
            points=[[round(p[1],6),round(p[2],6)] for p in shape[a:b]]
            if end>start and len(points)>2: edges[key]=(duration,points)
    prev=r
ids=sorted(stops); index={sid:i for i,sid in enumerate(ids)}
lines=sorted(routes);lineIndex={sid:i for i,sid in enumerate(lines)}
output={'source':'https://mkuran.pl/gtfs/tokyo/rail.zip','downloaded':datetime.date.today().isoformat(),'sha256':hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest(),
 'stops':[[s,stops[s]['stop_name'],float(stops[s]['stop_lat']),float(stops[s]['stop_lon']),stops[s]['parent_station']] for s in ids],
 'lines':[[s,routes[s]['route_long_name'],routes[s]['route_color']] for s in lines],
 'edges':[[index[a],index[b],lineIndex[line],duration,points] for (a,b,line),(duration,points) in sorted(edges.items())]}
path=pathlib.Path('server/data/tokyo-rail.json');path.parent.mkdir(exist_ok=True);path.write_text(json.dumps(output,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
print(len(ids),'stops',len(edges),'edges',path.stat().st_size,'bytes')
