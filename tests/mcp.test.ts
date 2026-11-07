// v0.31 MCP v2 (docs/19): real SQLite behind the D1 interface, the real Hono app,
// geocoders mocked at fetch. Covers bulk tools, trip-biased pins, isError results,
// annotations and version negotiation.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import app from '../server/app';
import { SCHEMA } from '../server/lib/schema';
import { hashToken } from '../server/lib/auth';
import { geocode, MAX_KM_FROM_TRIP } from '../server/lib/geocode';
import type { Env } from '../server/env.d';

function database() {
  const sqlite = new DatabaseSync(':memory:');
  class Statement {
    args: any[] = [];
    constructor(public sql: string) {}
    bind(...args: any[]) { const s = new Statement(this.sql); s.args = args; return s; }
    async first() { return sqlite.prepare(this.sql).get(...this.args) ?? null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.args), success: true }; }
    async run() {
      const r = sqlite.prepare(this.sql).run(...this.args);
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql),
    batch: async (stmts: Statement[]) => {
      sqlite.exec('BEGIN');
      try { const out = []; for (const s of stmts) out.push(await s.run()); sqlite.exec('COMMIT'); return out; }
      catch (e) { sqlite.exec('ROLLBACK'); throw e; }
    },
  };
  return { sqlite, db: db as unknown as D1Database };
}
const { sqlite, db } = database();
const env: Env = { DB: db, FILES: {} as KVNamespace };

const TOKENS = { leader: 'tok-leader', viewer: 'tok-viewer', other: 'tok-other' };
let rpcId = 1;
async function rpc(token: string, method: string, params: any = {}) {
  const res = await app.request('/api/mcp', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
  }, env);
  expect(res.status).toBe(200);
  return res.json() as Promise<any>;
}
const call = (token: string, name: string, args: any) => rpc(token, 'tools/call', { name, arguments: args });

// Photon fixture: "Sensoji" exists in Lima and Tokyo — order depends on whether a bias was sent.
const SENSOJI_PERU = { geometry: { coordinates: [-77.01, -12.13] }, properties: { name: 'Sensoji', city: 'Santiago de Surco', country: 'Peru' } };
const SENSOJI_TOKYO = { geometry: { coordinates: [139.7967, 35.7148] }, properties: { name: 'Sensō-ji', city: 'Taito', country: 'Japan' } };
const photonFeatures = (q: string, biased: boolean) => {
  if (/sensoji/i.test(q)) return biased ? [SENSOJI_TOKYO, SENSOJI_PERU] : [SENSOJI_PERU, SENSOJI_TOKYO];
  if (/nowhere/i.test(q)) return [SENSOJI_PERU];
  // Live order seen 2026-11-07: two Tokyo restaurants first, the Osaka street third.
  if (/^dotonbori$/i.test(q)) return [
    { geometry: { coordinates: [139.5540, 35.7319] }, properties: { name: 'Dotonbori', city: 'Nishitokyo', country: 'Japan' } },
    { geometry: { coordinates: [139.6900, 35.7752] }, properties: { name: 'Dotonbori', city: 'Itabashi', country: 'Japan' } },
    { geometry: { coordinates: [135.5013, 34.6687] }, properties: { name: 'Dotonbori', city: 'Osaka', country: 'Japan' } },
  ];
  if (/^dotonbori, osaka$/i.test(q)) return [{ geometry: { coordinates: [135.5013, 34.6687] }, properties: { name: 'Dotonbori', city: 'Osaka', country: 'Japan' } }];
  // Live order seen 2026-11-07 for お花茶屋駅: a bus stop named after the station came first.
  if (/お花茶屋駅/.test(q)) return [
    { geometry: { coordinates: [139.841231, 35.747998] }, properties: { name: 'お花茶屋駅', osm_key: 'highway', osm_value: 'bus_stop', city: 'Katsushika' } },
    { geometry: { coordinates: [139.840226, 35.747628] }, properties: { name: 'Ohanajaya Station', osm_key: 'building', osm_value: 'train_station', city: 'Katsushika' } },
    { geometry: { coordinates: [139.840145, 35.747589] }, properties: { name: 'Ohanajaya', osm_key: 'railway', osm_value: 'station', city: 'Katsushika' } },
  ];
  if (/^ohanajaya cafe$/i.test(q)) return [
    { geometry: { coordinates: [139.8395, 35.7489] }, properties: { name: 'Ohanajaya Cafe', osm_key: 'amenity', osm_value: 'cafe', city: 'Katsushika' } },
    { geometry: { coordinates: [139.840145, 35.747589] }, properties: { name: 'Ohanajaya', osm_key: 'railway', osm_value: 'station', city: 'Katsushika' } },
  ];
  if (/^osaka$/i.test(q)) return [{ geometry: { coordinates: [135.5023, 34.6937] }, properties: { name: 'Osaka', country: 'Japan' } }];
  if (/kuromon/i.test(q)) return [{ geometry: { coordinates: [135.5066, 34.6654] }, properties: { name: 'Kuromon Ichiba Market', city: 'Osaka', country: 'Japan' } }];
  if (/teamlab/i.test(q)) return [{ geometry: { coordinates: [139.7841, 35.6491] }, properties: { name: 'teamLab Planets', city: 'Koto', country: 'Japan' } }];
  return [];
};
function mockGeocoders(opts: { photonDown?: boolean } = {}) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(url);
    const u = new URL(url);
    if (u.hostname.includes('photon')) {
      if (opts.photonDown) return new Response('down', { status: 503 });
      return Response.json({ features: photonFeatures(u.searchParams.get('q') ?? '', u.searchParams.has('lat')) });
    }
    if (u.hostname.includes('nominatim')) {
      return Response.json([{ name: 'Sensō-ji', display_name: 'Sensō-ji, Asakusa, Taito, Tokyo, Japan', lat: '35.7148', lon: '139.7967' }]);
    }
    return new Response('unexpected', { status: 500 });
  }));
  return calls;
}
afterEach(() => {
  vi.unstubAllGlobals();
  try { sqlite.exec('DELETE FROM geocode_cache'); } catch { /* table not created yet */ }
});

beforeAll(async () => {
  for (const s of SCHEMA) sqlite.exec(s);
  for (let id = 1; id <= 3; id++) {
    sqlite.prepare('INSERT INTO participants(id,name) VALUES (?,?)').run(id, `Person ${id}`);
    sqlite.prepare('INSERT INTO users(id,email,name,password_hash,salt,role,participant_id) VALUES (?,?,?,?,?,?,?)')
      .run(id, `u${id}@example.test`, `Person ${id}`, 'x', 'y', 'member', id);
  }
  sqlite.exec(`INSERT INTO trips(id,name,destination,start_date,end_date) VALUES (1,'Tokyo','Tokyo, Japan','2026-11-29','2026-12-03'),(2,'Other','Malaysia','2026-11-29','2026-12-03');
    INSERT INTO trip_members(trip_id,participant_id,role) VALUES (1,1,'leader'),(1,2,'viewer'),(2,3,'leader');`);
  // pinned Tokyo stops give the trip its centre
  sqlite.exec(`INSERT INTO activities(id,trip_id,title,day,lat,lng,location_name) VALUES
    (1,1,'Hotel breakfast','2026-11-29',35.69,139.70,'Shinjuku'),
    (2,1,'Shibuya walk','2026-11-30',35.66,139.70,'Shibuya'),
    (3,1,'Ramen','2026-11-30',NULL,NULL,'teamLab Planets'),
    (4,1,'Tower','2026-12-01',35.65,139.74,'Tokyo Tower'),
    (9,2,'Other trip stop','2026-11-30',3.1,101.7,'KL');
    INSERT INTO day_notes(trip_id,day,content) VALUES (1,'2026-11-30','Bring IC card');
    INSERT INTO day_settings(trip_id,day,title) VALUES (1,'2026-11-30','Shibuya day');`);
  sqlite.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES (?,?)").run('data_migrations', JSON.stringify(['m001-trip-roles']));
  for (const [user, tok] of [[1, TOKENS.leader], [2, TOKENS.viewer], [3, TOKENS.other]] as const) {
    sqlite.prepare('INSERT INTO api_tokens(user_id,name,token_hash) VALUES (?,?,?)').run(user, 't', await hashToken(tok));
  }
});

describe('MCP v2 protocol', () => {
  it('negotiates the protocol version and sends instructions', async () => {
    const r = await rpc(TOKENS.leader, 'initialize', { protocolVersion: '2025-06-18' });
    expect(r.result.protocolVersion).toBe('2025-06-18');
    expect(r.result.instructions).toMatch(/clear_day/);
    const newer = await rpc(TOKENS.leader, 'initialize', { protocolVersion: '2099-01-01' });
    expect(newer.result.protocolVersion).toBe('2025-11-25');
  });

  it('lists tools with titles and annotations; deletes are marked destructive', async () => {
    const { result } = await rpc(TOKENS.leader, 'tools/list');
    const byName = Object.fromEntries(result.tools.map((t: any) => [t.name, t]));
    for (const t of result.tools) { expect(t.title).toBeTruthy(); expect(t.annotations).toBeTruthy(); }
    for (const n of ['clear_day', 'delete_activities', 'delete_activity', 'delete_note']) expect(byName[n].annotations.destructiveHint).toBe(true);
    for (const n of ['list_trips', 'get_itinerary', 'search_place']) expect(byName[n].annotations.readOnlyHint).toBe(true);
  });

  it('unknown tool is a protocol error; business errors come back as isError results', async () => {
    const unknown = await call(TOKENS.leader, 'no_such_tool', {});
    expect(unknown.error.code).toBe(-32602);
    const bad = await call(TOKENS.leader, 'clear_day', { trip_id: 1, day: '30-11-2026' });
    expect(bad.result.isError).toBe(true);
    expect(bad.result.content[0].text).toMatch(/YYYY-MM-DD/);
    const noAccess = await call(TOKENS.other, 'get_itinerary', { trip_id: 1 });
    expect(noAccess.result.isError).toBe(true);
    expect(noAccess.result.content[0].text).toMatch(/list_trips/);
  });

  it('returns structuredContent alongside the JSON text', async () => {
    const r = await call(TOKENS.leader, 'get_itinerary', { trip_id: 1, day: '2026-11-30', detail: 'concise' });
    expect(r.result.isError).toBe(false);
    expect(r.result.structuredContent.unlocated_count).toBe(1);
    expect(JSON.parse(r.result.content[0].text)).toEqual(r.result.structuredContent);
  });
});

describe('MCP v2 bulk tools', () => {
  it('clear_day removes only that day\'s activities and keeps notes and the day title', async () => {
    const r = await call(TOKENS.leader, 'clear_day', { trip_id: 1, day: '2026-11-30' });
    const out = r.result.structuredContent;
    expect(out.deleted_count).toBe(2);
    expect(out.deleted.map((d: any) => d.title).sort()).toEqual(['Ramen', 'Shibuya walk']);
    expect(sqlite.prepare("SELECT COUNT(*) n FROM activities WHERE trip_id=1 AND day='2026-11-30'").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) n FROM activities WHERE trip_id=1").get()).toEqual({ n: 2 });
    expect(sqlite.prepare("SELECT COUNT(*) n FROM day_notes WHERE trip_id=1").get()).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT title FROM day_settings WHERE trip_id=1 AND day='2026-11-30'").get()).toEqual({ title: 'Shibuya day' });
    expect(sqlite.prepare("SELECT action FROM audit_log WHERE action LIKE 'mcp_clear_day%'").get()).toEqual({ action: 'mcp_clear_day: 2026-11-30' });
  });

  it('viewers cannot clear a day', async () => {
    const r = await call(TOKENS.viewer, 'clear_day', { trip_id: 1, day: '2026-12-01' });
    expect(r.result.isError).toBe(true);
    expect(sqlite.prepare("SELECT COUNT(*) n FROM activities WHERE trip_id=1 AND day='2026-12-01'").get()).toEqual({ n: 1 });
  });

  it('delete_activities touches only this trip\'s ids and names what it removed', async () => {
    const r = await call(TOKENS.leader, 'delete_activities', { trip_id: 1, activity_ids: [4, 9, 999] });
    const out = r.result.structuredContent;
    expect(out.deleted).toEqual([{ id: 4, title: 'Tower', day: '2026-12-01' }]);
    expect([...out.not_found_on_this_trip].sort((a: number, b: number) => a - b)).toEqual([9, 999]);
    expect(sqlite.prepare('SELECT COUNT(*) n FROM activities WHERE id=9').get()).toEqual({ n: 1 });
  });
});

describe('MCP v2 pins', () => {
  it('add_activities pins from coordinates and from a trip-biased place lookup, in one call', async () => {
    const calls = mockGeocoders();
    const r = await call(TOKENS.leader, 'add_activities', {
      trip_id: 1,
      activities: [
        { day: '2026-12-02', title: 'Temple', place: 'Sensoji', start_time: '09:00', duration_min: 90 },
        { day: '2026-12-02', title: 'Lunch', place: 'Somewhere I know', lat: 35.71, lng: 139.79 },
        { day: '2026-12-02', title: 'Mystery', place: 'Nowhere special' },
      ],
    });
    const out = r.result.structuredContent;
    expect(out.added).toBe(3);
    expect(out.located).toBe(2);
    const temple = sqlite.prepare("SELECT lat, lng, end_time, location_name FROM activities WHERE title='Temple'").get() as any;
    expect(temple.lat).toBeCloseTo(35.7148, 3); // Tokyo, not Lima
    expect(temple.end_time).toBe('10:30');
    expect(temple.location_name).toBe('Sensoji'); // the user's words are kept
    expect(sqlite.prepare("SELECT lat FROM activities WHERE title='Lunch'").get()).toEqual({ lat: 35.71 });
    expect(out.unlocated).toHaveLength(1);
    expect(out.unlocated[0].title).toBe('Mystery');
    expect(out.unlocated[0].reason).toMatch(String(MAX_KM_FROM_TRIP));
    expect(out.unlocated[0].candidates[0].distance_km).toBeGreaterThan(MAX_KM_FROM_TRIP);
    const photonCall = calls.find(c => c.includes('Sensoji'))!;
    expect(new URL(photonCall).searchParams.get('lang')).toBe('en');
    expect(new URL(photonCall).searchParams.has('lat')).toBe(true);
  });

  it('rejects the whole batch with a fixable message when an item is invalid', async () => {
    const before = (sqlite.prepare('SELECT COUNT(*) n FROM activities').get() as any).n;
    const r = await call(TOKENS.leader, 'add_activities', { trip_id: 1, activities: [{ day: '2026-12-02', title: 'ok' }, { day: 'tomorrow', title: '' }] });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/#2: title is required; #2: day must be YYYY-MM-DD/);
    expect((sqlite.prepare('SELECT COUNT(*) n FROM activities').get() as any).n).toBe(before);
  });

  it('falls back to Nominatim when Photon is down', async () => {
    const calls = mockGeocoders({ photonDown: true });
    const r = await geocode(env, 'Sensoji', { lat: 35.69, lng: 139.7 });
    expect(r.hit?.lat).toBeCloseTo(35.7148, 3);
    expect(calls.some(c => c.includes('nominatim'))).toBe(true);
  });

  it('update_activity re-pins from a new place, and lat/lng set the pin directly', async () => {
    mockGeocoders();
    const id = (sqlite.prepare("INSERT INTO activities(trip_id,title,day) VALUES (1,'Art','2026-12-03') RETURNING id").get() as any).id;
    const a = await call(TOKENS.leader, 'update_activity', { activity_id: id, place: 'teamLab Planets' });
    expect(a.result.structuredContent.located).toBe(true);
    const b = await call(TOKENS.leader, 'update_activity', { activity_id: id, lat: 35.6, lng: 139.8 });
    expect(sqlite.prepare('SELECT lat, lng FROM activities WHERE id=?').get(id)).toEqual({ lat: 35.6, lng: 139.8 });
    expect(b.result.structuredContent.located).toBe(true);
  });

  it('pin_activities fixes unlocated stops that have a place name', async () => {
    mockGeocoders();
    sqlite.exec("INSERT INTO activities(trip_id,title,day,location_name) VALUES (1,'Old stop','2026-12-03','teamLab Planets'),(1,'No place','2026-12-03',NULL)");
    const r = await call(TOKENS.leader, 'pin_activities', { trip_id: 1, day: '2026-12-03' });
    const out = r.result.structuredContent;
    expect(out.pinned.map((p: any) => p.title)).toContain('Old stop');
    expect(out.unlocated.find((u: any) => u.title === 'No place').reason).toMatch(/no place name/);
  });

  it('a multi-city trip accepts places near any of its cities, not just the centre', async () => {
    mockGeocoders();
    sqlite.exec(`INSERT INTO trips(id,name,destination,start_date,end_date) VALUES (3,'Two cities','Tokyo & Osaka, Japan','2026-11-29','2026-12-03');
      INSERT INTO trip_members(trip_id,participant_id,role) VALUES (3,1,'leader');
      INSERT INTO activities(trip_id,title,day,lat,lng) VALUES (3,'Tokyo a','2026-11-29',35.69,139.70),(3,'Tokyo b','2026-11-29',35.66,139.70);`);
    const r = await call(TOKENS.leader, 'add_activities', { trip_id: 3, activities: [{ day: '2026-12-01', title: 'Market', place: 'Kuromon Market' }] });
    const out = r.result.structuredContent;
    expect(out.located).toBe(1); // ~400 km from the Tokyo pins, but next to the "Osaka" anchor
    expect(out.activities[0].lat).toBeCloseTo(34.6654, 3);
  });

  it('a name that matches in two different cities is ambiguous, and adding the area resolves it', async () => {
    mockGeocoders();
    const vague = await call(TOKENS.leader, 'add_activities', { trip_id: 3, activities: [{ day: '2026-12-01', title: 'Food street', place: 'Dotonbori' }] });
    expect(vague.result.structuredContent.located).toBe(0);
    expect(vague.result.structuredContent.unlocated[0].reason).toMatch(/add the area/);
    const clear = await call(TOKENS.leader, 'add_activities', { trip_id: 3, activities: [{ day: '2026-12-01', title: 'Food street', place: 'Dotonbori, Osaka' }] });
    expect(clear.result.structuredContent.activities[0].lat).toBeCloseTo(34.6687, 3);
  });

  it('a station query lands on the railway station, not a bus stop named after it, and says what it matched', async () => {
    mockGeocoders();
    const r = await call(TOKENS.leader, 'add_activities', { trip_id: 1, activities: [
      { day: '2026-12-02', title: 'Meet', place: 'お花茶屋駅' },
      { day: '2026-12-02', title: 'Coffee', place: 'Ohanajaya Cafe' },
    ] });
    const [station, cafe] = r.result.structuredContent.activities;
    expect(station.lat).toBeCloseTo(35.747589, 6);
    expect(station.lng).toBeCloseTo(139.840145, 6);
    expect(station.matched.kind).toBe('railway=station');
    // without a station word, the geocoder's own first match stands
    expect(cafe.matched.kind).toBe('amenity=cafe');
  });

  it('explicit coordinates are stored exactly as given', async () => {
    const r = await call(TOKENS.leader, 'add_activities', { trip_id: 1, activities: [{ day: '2026-12-02', title: 'Exact', place: 'Ohanajaya Station', lat: 35.7475891, lng: 139.8401453 }] });
    const a = r.result.structuredContent.activities[0];
    expect(a.pinned_from).toBe('coordinates');
    expect(sqlite.prepare('SELECT lat, lng FROM activities WHERE id=?').get(a.id)).toEqual({ lat: 35.7475891, lng: 139.8401453 });
  });

  it('accepts coordinates sent as numeric strings (connectors with a cached schema do this)', async () => {
    const id = (sqlite.prepare("INSERT INTO activities(trip_id,title,day) VALUES (1,'Strings','2026-12-03') RETURNING id").get() as any).id;
    const r = await call(TOKENS.leader, 'update_activity', { activity_id: id, place: 'Kyoto Station', lat: '34.985849', lng: '135.758767' });
    expect(r.result.structuredContent.matched).toBeUndefined(); // pinned from the coordinates, not geocoded
    expect(sqlite.prepare('SELECT lat, lng FROM activities WHERE id=?').get(id)).toEqual({ lat: 34.985849, lng: 135.758767 });
    const bad = await call(TOKENS.leader, 'add_activities', { trip_id: 1, activities: [{ day: '2026-12-03', title: 'Junk', lat: '12abc', lng: 'x' }] });
    expect(bad.result.structuredContent.activities[0].located).toBe(false);
  });
});
