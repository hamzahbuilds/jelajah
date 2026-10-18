import {
  beforeAll,
  afterAll,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { journey, consumeLimit } from "../server/journey";
import legacyApp from "../server/app";
import { ensureJourneySchema } from "../server/lib/journey-schema";
import { SCHEMA } from "../server/lib/schema";
import { hashPassword, hashToken, verifyPassword } from "../server/lib/auth";
import {
  cleanJourney,
  cleanPublicJourney,
  publicJourney,
  directionsUrl,
} from "../shared/journey";
import type { Env } from "../server/env.d";

// Real SQLite SQL and transactions behind the small D1 interface. No permissive
// SQL mocks: malformed queries, uniqueness and rollback fail as in production.
function database() {
  const sqlite = new DatabaseSync(":memory:");
  class Statement {
    args: any[] = [];
    constructor(public sql: string) {}
    bind(...args: any[]) {
      const s = new Statement(this.sql);
      s.args = args;
      return s;
    }
    async first() {
      return sqlite.prepare(this.sql).get(...this.args) ?? null;
    }
    async all() {
      return {
        results: sqlite.prepare(this.sql).all(...this.args),
        success: true,
      };
    }
    async run() {
      const r = sqlite.prepare(this.sql).run(...this.args);
      return {
        success: true,
        meta: {
          changes: Number(r.changes),
          last_row_id: Number(r.lastInsertRowid),
        },
      };
    }
  }
  const db = {
    prepare: (sql: string) => new Statement(sql),
    batch: async (stmts: Statement[]) => {
      sqlite.exec("BEGIN");
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        sqlite.exec("COMMIT");
        return out;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { sqlite, db: db as unknown as D1Database };
}
const { sqlite, db } = database();
const env: Env = { DB: db, FILES: {} as KVNamespace };
const app = new Hono().route("/api/journey", journey);
const req = (
  path: string,
  user: number | null = 1,
  method = "GET",
  body?: unknown,
  extra: Partial<Env> = {},
) =>
  app.request(
    `/api/journey${path}`,
    {
      method,
      headers: {
        ...(user ? { Cookie: `sid=session-${user}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    },
    { ...env, ...extra },
  );
const json = async (r: Response | Promise<Response>) => {
  const res = await r;
  expect(res.status).toBe(200);
  return res.json() as Promise<any>;
};
let personal: number, guest: string, guide: string;
beforeAll(async () => {
  for (const s of SCHEMA) sqlite.exec(s);
  const pw = await hashPassword("old-password");
  for (let id = 1; id <= 5; id++) {
    sqlite
      .prepare("INSERT INTO participants(id,name) VALUES (?,?)")
      .run(id, `Person ${id}`);
    sqlite
      .prepare(
        "INSERT INTO users(id,email,name,password_hash,salt,role,participant_id) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        id,
        `u${id}@example.test`,
        `Person ${id}`,
        pw.hash,
        pw.salt,
        id === 1 ? "admin" : "member",
        id,
      );
    sqlite
      .prepare("INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)")
      .run(`session-${id}`, id, "2099-01-01");
  }
  sqlite.exec(
    "INSERT INTO trips(id,name,destination,start_date,end_date) VALUES (1,'Tokyo Days','Japan','2026-11-29','2026-12-01'),(2,'Other trip','Malaysia','2026-11-29','2026-12-01');",
  );
  for (let id = 1; id <= 4; id++)
    sqlite
      .prepare(
        "INSERT INTO trip_members(trip_id,participant_id,role) VALUES (1,?,?)",
      )
      .run(id, id === 1 ? "leader" : id === 4 ? "editor" : "viewer");
  sqlite.exec(
    "INSERT INTO trip_members VALUES (2,5,'leader'); INSERT INTO activities(id,trip_id,title,day,start_time,end_time,notes,lat,lng) VALUES (1,1,'Garden','2026-11-29','10:00','11:00','DO NOT PUBLISH',35.1,139.1),(2,1,'Cafe','2026-11-29','12:00','13:00','',35.2,139.2); INSERT INTO day_settings(trip_id,day,title,start_name,start_lat,start_lng) VALUES (1,'2026-11-29','Gardens and cafes','Hotel',35,139); INSERT INTO day_notes(id,trip_id,day,content) VALUES (1,1,'2026-11-29','Bring water'),(2,1,'2026-11-29','GROUP SECRET');",
  );
  await ensureJourneySchema(env);
  // Fixtures already specify migrated roles; do not run the legacy role backfill.
  sqlite.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES (?,?)").run("data_migrations", JSON.stringify(["m001-trip-roles"]));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(() => sqlite.close());

describe('document library ownership and cleanup', () => {
  const storage = { put: vi.fn(async () => {}), delete: vi.fn(async () => {}), get: vi.fn(async () => ({ body: new ReadableStream({start(c) { c.enqueue(new TextEncoder().encode('private')); c.close(); }}) })) };
  const rest = (path: string, user = 2, method = 'GET', body?: any) => legacyApp.request(`/api${path}`, {
    method, headers: { Cookie: `sid=session-${user}`, ...(body && !(body instanceof FormData) ? {'Content-Type':'application/json'} : {}) },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  }, {...env, FILES: storage as any});
  it('reopens a reviewed booking and replaces participants without duplicating its expense', async () => {
    const form = new FormData(); form.append('file', new File(['booking'], 'flight.txt', {type:'text/plain'}));
    form.append('category','logistics'); form.append('visibility','trip'); form.append('meta',JSON.stringify({docType:'itinerary'}));
    const {id} = await json(rest('/trips/1/documents',1,'POST',form));
    const expense = {category:'transport',description:'Flight review',amount_original:100,currency:'MYR',fx_rate:1,amount_myr:100,payer_participant_id:1,shares:[{participant_id:1,amount_myr:100}],due_dates:[{due_date:'2026-11-01',amount_myr:100}]};
    const first = await json(rest(`/documents/${id}/confirm`,1,'POST',{expense}));
    const loaded = await json(rest(`/documents/${id}`,1));
    expect(loaded.expense.id).toBe(first.expense_id); expect(loaded.shares[0].participant_id).toBe(1); expect(loaded.due_dates).toHaveLength(1);
    sqlite.prepare('UPDATE due_dates SET settled=1 WHERE expense_id=?').run(first.expense_id);
    await json(rest(`/documents/${id}/confirm`,1,'POST',{expense:{...expense,due_dates:loaded.due_dates}}));
    expect((await json(rest(`/documents/${id}`,1))).due_dates[0].settled).toBe(1);
    const changed = {...expense,shares:[{participant_id:2,amount_myr:100}],due_dates:[]};
    for (let i=0;i<2;i++) expect((await json(rest(`/documents/${id}/confirm`,1,'POST',{expense:changed}))).expense_id).toBe(first.expense_id);
    const updated = await json(rest(`/documents/${id}`,1));
    expect(updated.shares).toHaveLength(1); expect(updated.shares[0].participant_id).toBe(2); expect(updated.expense.amount_myr).toBe(100); expect(updated.due_dates).toHaveLength(0);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM expenses WHERE document_id=?').get(id)?.n).toBe(1);
    expect((await rest(`/documents/${id}/confirm`,2,'POST',{expense})).status).toBe(403);
    expect((await rest(`/documents/${id}/confirm`,1,'POST',{expense:{...expense,shares:[{participant_id:9999,amount_myr:100}]}})).status).toBe(400);
    sqlite.prepare("UPDATE expenses SET split_json='{}' WHERE id=?").run(first.expense_id);
    expect((await rest(`/documents/${id}/confirm`,1,'POST',{expense})).status).toBe(409);
    await json(rest(`/documents/${id}`,1,'DELETE'));
    sqlite.prepare('DELETE FROM due_dates WHERE expense_id=?').run(first.expense_id);
    sqlite.prepare('DELETE FROM expense_shares WHERE expense_id=?').run(first.expense_id);
    sqlite.prepare('DELETE FROM expenses WHERE id=?').run(first.expense_id);
  });
  it('keeps personal files owner-only including against admins and bypasses OCR', async () => {
    const form = new FormData(); form.append('file', new File(['private'], 'notes.txt', {type:'text/plain'}));
    form.append('category','personal'); form.append('meta',JSON.stringify({docType:'itinerary',bookingNo:'SECRET',legs:[{date:'2026-11-29'}]}));
    const {id} = await json(rest('/trips/1/documents',2,'POST',form));
    const own = await json(rest(`/documents/${id}`));
    expect(own.doc_type).toBe('personal'); expect(own.booking_no).toBeNull(); expect(own.parsed_json).not.toContain('SECRET');
    expect((await rest(`/documents/${id}/file`)).headers.get('Cache-Control')).toBe('no-store');
    for (const other of [1,3,5]) {
      expect((await rest(`/documents/${id}`,other)).status).toBe(404);
      expect((await rest(`/documents/${id}/file`,other)).status).toBe(404);
      expect((await rest(`/documents/${id}`,other,'PATCH',{filename:'stolen'})).status).toBe(404);
      expect((await rest(`/documents/${id}`,other,'DELETE')).status).toBe(404);
    }
    expect(JSON.stringify(await json(rest('/trips/1/documents',1)))).not.toContain('notes.txt');
    await json(rest(`/documents/${id}`,2,'PATCH',{filename:'My packing list.txt'}));
    expect((await json(rest(`/documents/${id}`))).filename).toBe('My packing list.txt');
    expect((await rest(`/documents/${id}`,2,'PATCH',{filename:'../bad'})).status).toBe(400);
    expect((await rest(`/documents/${id}/confirm`,2,'POST',{})).status).not.toBe(200);
    sqlite.exec('DELETE FROM trip_members WHERE trip_id=1 AND participant_id=2');
    expect((await rest(`/documents/${id}/file`)).status).toBe(404);
    sqlite.exec("INSERT INTO trip_members VALUES(1,2,'viewer')");
    await json(rest(`/documents/${id}`,2,'DELETE'));
  });
  it('removes source-derived events but preserves accounting and manual activities', async () => {
    sqlite.exec(`INSERT INTO documents(id,trip_id,filename,r2_key,mime,size,doc_type,uploaded_by,status) VALUES(900,1,'hotel.pdf','hotel','application/pdf',1,'confirmation',1,'confirmed');
      INSERT INTO expenses(id,trip_id,document_id,category,description,expense_date,end_date,amount_original,currency,fx_rate,amount_myr) VALUES(900,1,900,'accommodation','Source hotel','2026-11-29','2026-11-30',100,'MYR',1,100)`);
    expect(JSON.stringify(await json(rest('/trips/1/plan',1)))).toContain('Source hotel');
    expect((await rest('/documents/900',2,'DELETE')).status).toBe(403);
    await json(rest('/documents/900',1,'DELETE'));
    expect(JSON.stringify(await json(rest('/trips/1/plan',1)))).not.toContain('Source hotel');
    expect(JSON.stringify(await json(req('/trips/1/group',1)))).not.toContain('Source hotel');
    const expense: any = sqlite.prepare('SELECT * FROM expenses WHERE id=900').get();
    expect(expense.amount_myr).toBe(100); expect(expense.document_id).toBeNull();
    expect(sqlite.prepare('SELECT id FROM activities WHERE id=1').get()).toBeTruthy();
    sqlite.exec('DELETE FROM expenses WHERE id=900');
  });
  it('enforces group folder access and immediate membership revocation', async () => {
    const group = await json(rest('/trips/1/document-library/groups',2,'POST',{name:'Rail friends',participant_ids:[3]}));
    const folder = await json(rest('/trips/1/document-library/folders',2,'POST',{name:'Tickets',visibility:'group',group_id:group.id}));
    const form = new FormData(); form.append('file',new File(['ticket'],'rail.txt')); form.append('category','Rail reservations'); form.append('visibility','group'); form.append('folder_id',String(folder.id));
    const {id} = await json(rest('/trips/1/documents',2,'POST',form));
    expect((await rest(`/documents/${id}`,3)).status).toBe(200);
    expect((await rest(`/documents/${id}/file`,3)).status).toBe(200);
    expect((await rest(`/documents/${id}`,1)).status).toBe(404);
    expect((await rest(`/documents/${id}`,4)).status).toBe(404);
    expect((await rest(`/documents/${id}`,3,'DELETE')).status).toBe(403);
    expect((await rest(`/trips/1/document-library/groups/${group.id}`,3,'PUT',{name:'Hijacked',participant_ids:[4]})).status).toBe(403);
    await json(rest(`/trips/1/document-library/groups/${group.id}`,1,'PUT',{name:'Rail friends',participant_ids:[4]}));
    expect((await rest(`/documents/${id}/file`,3)).status).toBe(404);
    expect((await rest(`/documents/${id}`,4)).status).toBe(200);
    expect(JSON.stringify(await json(rest('/trips/1/documents',3)))).not.toContain('rail.txt');
    expect((await rest(`/documents/${id}/confirm`,1,'POST',{})).status).not.toBe(200);
    const settings = await json(rest('/trips/1/document-library/settings',2));
    expect(settings.folders.find((f:any)=>f.id===folder.id)).toBeTruthy();
    expect((await rest('/trips/1/document-library/folders',5,'POST',{name:'Wrong trip',visibility:'group',group_id:group.id})).status).toBe(403);
    await json(rest(`/documents/${id}`,2,'DELETE'));
  });
  it('allows individual private folders and whole-trip files with custom categories', async () => {
    const f = await json(rest('/trips/1/document-library/folders',2,'POST',{name:'My research',visibility:'private'}));
    expect((await json(rest('/trips/1/document-library/settings',1))).folders.some((x:any)=>x.id===f.id)).toBe(false);
    const form = new FormData(); form.append('file',new File(['guide'],'food.txt')); form.append('category','Food guides'); form.append('visibility','trip');
    const {id} = await json(rest('/trips/1/documents',2,'POST',form));
    expect(JSON.parse((await json(rest(`/documents/${id}`,3))).parsed_json).libraryCategory).toBe('Food guides');
    expect((await rest(`/documents/${id}`,5)).status).toBe(404);
    await json(rest(`/documents/${id}`,2,'PATCH',{filename:'Food favourites.txt'}));
    await json(rest(`/documents/${id}`,2,'DELETE'));
    expect((await json(rest('/trips/1/document-library/settings',2))).categories).toContain('Food guides');
  });
  it('rejects shared uploads by viewers', async () => {
    const form = new FormData(); form.append('file',new File(['x'],'hotel.pdf')); form.append('category','accommodation');
    expect((await rest('/trips/1/documents',2,'POST',form)).status).toBe(403);
  });
});

describe('transit feature flags', () => {
  it('defaults off, rejects non-admin writes and blocks preview endpoints', async () => {
    sqlite.exec("DELETE FROM app_settings WHERE key='feature_flags'");
    expect(await json(req('/features'))).toEqual({transitGeoapify:false,transitGoogleEmbed:false,transitGoogleLink:false});
    for (const provider of ['geoapify','google']) expect((await req('/trips/1/transit-preview',1,'POST',{provider,points:[[35,139],[35.1,139.1]]})).status).toBe(403);
    const flags={transitGeoapify:true,transitGoogleEmbed:false,transitGoogleLink:true};
    const update=(user:number,body:any)=>legacyApp.request('/api/settings/features',{method:'PUT',headers:{Cookie:`sid=session-${user}`,'Content-Type':'application/json'},body:JSON.stringify(body)},env);
    expect((await update(2,flags)).status).toBe(403);
    expect((await update(1,{...flags,transitGoogleEmbed:'true'})).status).toBe(400);
    expect(await json(update(1,flags))).toEqual(flags);
    expect(await json(req('/features'))).toEqual(flags);
    await json(update(1,{transitGeoapify:false,transitGoogleEmbed:false,transitGoogleLink:false}));
  });
});

describe('Geoapify transit previews', () => {
  beforeAll(() => { sqlite.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES('feature_flags',?)").run(JSON.stringify({transitGeoapify:true,transitGoogleEmbed:true,transitGoogleLink:true})); });
  afterAll(() => { sqlite.exec("DELETE FROM app_settings WHERE key='feature_flags'"); });
  const body = {provider:'geoapify', points:[[51.5,-0.1],[51.51,-0.12]]};
  it('requires membership, validates coordinates and handles missing keys', async () => {
    expect((await req('/trips/1/transit-preview',5,'POST',body)).status).toBe(403);
    expect((await req('/trips/1/transit-preview',1,'POST',{...body,points:[[100,0],[0,0]]})).status).toBe(400);
    expect(await json(req('/trips/1/transit-preview',1,'POST',body))).toEqual({available:false,reason:'setup'});
    expect(await json(req('/trips/1/transit-preview',1,'POST',{...body,provider:'google'}))).toEqual({embedUrl:null});
  });
  it('normalizes geometry, caches results, and never returns the provider key', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({features:[{geometry:{type:'MultiLineString',coordinates:[[[-0.1,51.5],[-0.11,51.505],[-0.12,51.51]]]},properties:{time:600,distance:1500}}]}));
    vi.stubGlobal('fetch',fetcher);
    const extra={GEOAPIFY_API_KEY:'secret-test-key'};
    const r=await json(req('/trips/1/transit-preview',1,'POST',body,extra));
    expect(r.segments[0].points[1]).toEqual([51.505,-0.11]);
    expect(r.approximate).toBe(true);
    expect(JSON.stringify(r)).not.toContain('secret-test-key');
    expect(new URL(String(fetcher.mock.calls[0][0])).searchParams.get('mode')).toBe('approximated_transit');
    await json(req('/trips/1/transit-preview',1,'POST',body,extra));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('returns safe failures and stops requests at the configured cap', async () => {
    sqlite.exec("DELETE FROM journey_limits WHERE key LIKE 'geo-%'");
    const fetcher=vi.fn().mockResolvedValue(new Response('',{status:429}));
    vi.stubGlobal('fetch',fetcher);
    const extra={GEOAPIFY_API_KEY:'test',GEOAPIFY_DAILY_LIMIT:'1'};
    const fresh={...body,points:[[48.85,2.3],[48.9,2.4]]};
    expect((await json(req('/trips/1/transit-preview',1,'POST',fresh,extra))).reason).toBe('quota');
    await json(req('/trips/1/transit-preview',1,'POST',fresh,extra));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('builds a separate Google embed with correct endpoints and no server fetch', async () => {
    const fetcher=vi.fn(); vi.stubGlobal('fetch',fetcher);
    const response=await req('/trips/1/transit-preview',1,'POST',{...body,provider:'google'},{GOOGLE_MAPS_EMBED_KEY:'restricted-browser-key'});
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const url=new URL((await response.json() as any).embedUrl);
    expect(url.origin).toBe('https://www.google.com');
    expect(url.searchParams.get('origin')).toBe('51.5,-0.1');
    expect(url.searchParams.get('mode')).toBe('transit');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('unified planner checklists', () => {
  it('preserves group checklist items and completion while denying viewer writes', async () => {
    const note=await json(req('/trips/1/notes',1,'POST',{day:'2026-11-30',visibility:'group',content:'Pack water for Day 2',is_check:true}));
    const items=(await json(req('/trips/1/notes',1))).items;
    expect(items.find((n:any)=>n.id===note.id && n.visibility==='group').is_check).toBe(1);
    expect((await req(`/trips/1/notes/group/${note.id}`,3,'PATCH',{content:'Pack water for Day 2',done:true})).status).toBe(403);
    await json(req(`/trips/1/notes/group/${note.id}`,1,'PATCH',{content:'Pack water for Day 2',done:true}));
    const saved=(await json(req('/trips/1/notes',1))).items.find((n:any)=>n.id===note.id && n.visibility==='group');
    expect(saved.done).toBe(1);
    expect(saved.is_check).toBe(1);
    await json(req(`/trips/1/notes/group/${note.id}`,1,'DELETE'));
  });
});

describe("additive migrations", () => {
  it("is repeatable and associates existing group records without rewriting them", async () => {
    await ensureJourneySchema(env);
    await ensureJourneySchema(env);
    expect(
      sqlite
        .prepare("SELECT COUNT(*) AS n FROM itineraries WHERE owner_id IS NULL")
        .get()?.n,
    ).toBe(2);
    expect(
      sqlite.prepare("SELECT notes FROM activities WHERE id=1").get()?.notes,
    ).toBe("DO NOT PUBLISH");
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM journey_migrations").get()?.n,
    ).toBe(1);
  });
  it("does not record completion after a failed backfill; a retry succeeds", async () => {
    const d = database();
    d.sqlite.exec(
      "CREATE TABLE trips(id INTEGER PRIMARY KEY); CREATE TABLE users(id INTEGER PRIMARY KEY)",
    );
    const failure = {
      ...env,
      DB: {
        ...d.db,
        batch: async () => {
          throw new Error("interrupted");
        },
      } as unknown as D1Database,
    };
    await expect(ensureJourneySchema(failure)).rejects.toThrow("interrupted");
    expect(
      d.sqlite.prepare("SELECT COUNT(*) AS n FROM journey_migrations").get()?.n,
    ).toBe(0);
    await ensureJourneySchema({ ...env, DB: d.db });
    expect(
      d.sqlite.prepare("SELECT COUNT(*) AS n FROM journey_migrations").get()?.n,
    ).toBe(1);
    d.sqlite.close();
  });
});
describe("personal plans and notes", () => {
  it("requires membership and clones once without expense or participant fields", async () => {
    expect((await req("/trips/1/clone", 5, "POST")).status).toBe(403);
    personal = (await json(req("/trips/1/clone", 2, "POST"))).id;
    expect((await json(req("/trips/1/clone", 2, "POST"))).id).toBe(personal);
    const p = await json(req(`/plans/${personal}`, 2));
    expect(p.content.stops).toHaveLength(2);
    expect(p.content.days[0].title).toBe("Gardens and cafes");
    expect(JSON.stringify(p)).not.toMatch(
      /participant_ids|expense_id|booking_no/,
    );
  });
  it("does not let platform admins read or edit another user’s plan", async () => {
    expect((await req(`/plans/${personal}`, 1)).status).toBe(404);
    expect(
      (
        await req(`/plans/${personal}`, 1, "PUT", {
          version: 1,
          content: { stops: [], days: [] },
        })
      ).status,
    ).toBe(404);
  });
  it("edits independently, detects conflicts and explicitly replaces copied activities", async () => {
    const p = await json(req(`/plans/${personal}`, 2));
    p.content.stops[0].title = "My garden";
    await json(
      req(`/plans/${personal}`, 2, "PUT", {
        version: p.version,
        content: p.content,
      }),
    );
    expect(
      sqlite.prepare("SELECT title FROM activities WHERE id=1").get()?.title,
    ).toBe("Garden");
    expect(
      (
        await req(`/plans/${personal}`, 2, "PUT", {
          version: p.version,
          content: p.content,
        })
      ).status,
    ).toBe(409);
    sqlite.exec("UPDATE activities SET title='New group garden' WHERE id=1");
    expect(
      (await json(req(`/plans/${personal}`, 2))).content.stops[0].title,
    ).toBe("My garden");
    await json(
      req(`/plans/${personal}/copy`, 2, "POST", {
        version: p.version + 1,
        ids: [1],
      }),
    );
    expect(
      (await json(req(`/plans/${personal}`, 2))).content.stops[0].title,
    ).toBe("New group garden");
  });
  it("shares read-only with selected active members and revokes access", async () => {
    expect((await req(`/plans/${personal}`, 3)).status).toBe(404);
    expect(
      (await req(`/plans/${personal}/viewers`, 2, "PUT", { ids: [5] })).status,
    ).toBe(400);
    await json(req(`/plans/${personal}/viewers`, 2, "PUT", { ids: [3] }));
    expect((await req(`/plans/${personal}`, 3)).status).toBe(200);
    expect(
      (
        await req(`/plans/${personal}`, 3, "PUT", {
          version: 3,
          content: { stops: [], days: [] },
        })
      ).status,
    ).toBe(404);
    sqlite.exec(
      "DELETE FROM trip_members WHERE trip_id=1 AND participant_id=3",
    );
    expect((await req(`/plans/${personal}`, 3)).status).toBe(404);
    sqlite.exec("INSERT INTO trip_members VALUES(1,3,'viewer')");
    await json(req(`/plans/${personal}/viewers`, 2, "PUT", { ids: [] }));
    expect((await req(`/plans/${personal}`, 3)).status).toBe(404);
  });
  it("private notes are owner-only and cannot be changed through a group note route", async () => {
    const n = await json(
      req("/trips/1/notes", 2, "POST", {
        visibility: "private",
        day: "*",
        content: "PRIVATE SECRET",
      }),
    );
    expect(JSON.stringify(await json(req("/trips/1/notes", 2)))).toContain(
      "PRIVATE SECRET",
    );
    expect(JSON.stringify(await json(req("/trips/1/notes", 1)))).not.toContain(
      "PRIVATE SECRET",
    );
    expect(
      (await req(`/trips/1/notes/private/${n.id}`, 1, "DELETE")).status,
    ).toBe(404);
    expect(
      (
        await req("/trips/1/notes", 2, "POST", {
          visibility: "group",
          day: "*",
          content: "Group",
        })
      ).status,
    ).toBe(403);
    await json(
      req("/trips/1/notes", 4, "POST", {
        visibility: "group",
        day: "*",
        content: "Trip-wide note",
      }),
    );
  });
  it("honours hidden plan permissions", async () => {
    sqlite.exec(`UPDATE trips SET hidden_features='["plan"]' WHERE id=1`);
    expect((await req(`/plans/${personal}`, 2)).status).toBe(404);
    expect((await req("/trips/1/notes", 2)).status).toBe(403);
    sqlite.exec("UPDATE trips SET hidden_features='[]' WHERE id=1");
  });
  it("keeps private content out of legacy REST and MCP group projections", async () => {
    const rest = await legacyApp.request(
      "/api/trips/1/plan",
      { headers: { Cookie: "sid=session-1" } },
      env,
    );
    expect(rest.status).toBe(200);
    expect(await rest.text()).not.toMatch(/PRIVATE SECRET|My garden/);
    const token = "integration-mcp";
    sqlite
      .prepare("INSERT INTO api_tokens(user_id,name,token_hash) VALUES(?,?,?)")
      .run(1, "integration", await hashToken(token));
    for (const name of ["get_itinerary", "get_notes"]) {
      const response = await legacyApp.request(
        "/api/mcp",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name, arguments: { trip_id: 1 } },
          }),
        },
        env,
      );
      const payload: any = await response.json();
      expect(payload.error).toBeUndefined();
      expect(JSON.stringify(payload)).not.toContain("PRIVATE SECRET");
    }
  });
});
describe("public projections and publishing", () => {
  it("only leaders can publish and preview is a strict allowlist", async () => {
    expect(
      (await req("/trips/1/publishing/preview", 4, "POST", {})).status,
    ).toBe(403);
    const p = await json(
      req("/trips/1/publishing/preview", 1, "POST", {
        noteIds: [1],
        guide: true,
      }),
    );
    const s = JSON.stringify(p);
    expect(s).toContain("Bring water");
    expect(s).not.toMatch(
      /SECRET|2026-11-29|participant|expense|booking|sourceId/,
    );
    expect(p.days[0].label).toBe("1");
  });
  it("guest links work anonymously, expire, and revoke", async () => {
    const link = await json(
      req("/trips/1/publishing/links", 1, "POST", { noteIds: [1] }),
    );
    guest = link.path.split("/").pop();
    const res = await req(`/guest/${guest}`, null);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(JSON.stringify(await res.json())).not.toMatch(
      /SECRET|expense|booking|participant/,
    );
    sqlite.prepare("UPDATE guest_links SET expires_at=?").run(Date.now() - 1);
    expect((await req(`/guest/${guest}`, null)).status).toBe(404);
    sqlite.exec("UPDATE guest_links SET expires_at=NULL");
    const links = await json(req("/trips/1/publishing/links", 1));
    await json(
      req(`/trips/1/publishing/links/${links.items[0].id}`, 1, "DELETE"),
    );
    expect((await req(`/guest/${guest}`, null)).status).toBe(404);
  });
  it("publishes immutable reviewed snapshots, supports discovery, unpublish and takedown", async () => {
    const draft = await json(
      req("/trips/1/publishing/preview", 1, "POST", { guide: true }),
    );
    draft.title = "Reviewed Tokyo";
    draft.secret = "NEVER";
    guide = (
      await json(req("/trips/1/publishing/guides", 1, "POST", { draft }))
    ).id;
    expect((await req(`/guides/${guide}`, null)).status).toBe(404);
    await json(
      req(`/trips/1/publishing/guides/${guide}`, 1, "PUT", {
        draft,
        publish: true,
      }),
    );
    sqlite.exec("UPDATE activities SET title='Changed privately' WHERE id=1");
    const live = await json(req(`/guides/${guide}`, null));
    expect(JSON.stringify(live)).not.toMatch(/Changed privately|NEVER/);
    expect(
      (await json(req("/guides?q=tokyo&duration=3", null))).items,
    ).toHaveLength(1);
    await json(req(`/admin/guides/${guide}`, 1, "PATCH", { takenDown: true }));
    expect((await req(`/guides/${guide}`, null)).status).toBe(404);
    expect(
      (
        await req(`/trips/1/publishing/guides/${guide}`, 1, "PUT", {
          draft,
          publish: true,
        })
      ).status,
    ).toBe(403);
    await json(req(`/admin/guides/${guide}`, 1, "PATCH", { takenDown: false }));
    await json(req(`/trips/1/publishing/guides/${guide}`, 1, "DELETE"));
    expect((await json(req("/guides", null))).items).toHaveLength(0);
  });
});
describe("routing and recovery", () => {
  it("uses atomic bounded counters across concurrent requests", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () => consumeLimit(env, "test-budget", 3, 60)),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
  });
  it("returns explicit routing fallbacks and validates coordinates", async () => {
    expect(
      (
        await req("/trips/1/routes", 2, "POST", {
          points: [
            [91, 0],
            [0, 0],
          ],
          mode: "walk",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await json(
          req("/trips/1/routes", 2, "POST", {
            points: [
              [35, 139],
              [35.1, 139.1],
            ],
            mode: "transit",
          }),
        )
      ).reason,
    ).toBe("transit_coverage");
    expect(
      (
        await json(
          req("/trips/1/routes", 2, "POST", {
            points: [
              [35, 139],
              [35.1, 139.1],
            ],
            mode: "walk",
          }),
        )
      ).reason,
    ).toBe("unconfigured");
  });
  it("converts ORS coordinates and caches the route without repeated upstream calls", async () => {
    const upstream = vi.fn().mockResolvedValue(
      Response.json({
        features: [
          {
            geometry: {
              coordinates: [
                [139, 35],
                [139.1, 35.1],
              ],
            },
            properties: { summary: { distance: 1200, duration: 900 } },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", upstream);
    const body = {
      points: [
        [35, 139],
        [35.1, 139.1],
      ],
      mode: "walk",
    };
    const r = await json(
      req("/trips/1/routes", 2, "POST", body, { ORS_API_KEY: "test" }),
    );
    expect(r.points[0]).toEqual([35, 139]);
    await json(
      req("/trips/1/routes", 2, "POST", body, { ORS_API_KEY: "test" }),
    );
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it.each([[401, "credentials"], [403, "credentials"], [429, "quota"], [503, "provider"]])(
    "reports routing provider HTTP %s accurately", async (status, reason) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: Number(status) })));
      const result = await json(req("/trips/1/routes", 2, "POST", {
        points: [[34, 138], [34.01, 138.01]], mode: "drive",
      }, { ORS_API_KEY: "test" }));
      expect(result).toEqual({ available: false, reason });
    },
  );
  it("recovers gracefully from provider failures and quotas", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const body = {
      points: [
        [36, 139],
        [36.1, 139.1],
      ],
      mode: "drive",
    };
    expect(
      (
        await json(
          req("/trips/1/routes", 2, "POST", body, { ORS_API_KEY: "test" }),
        )
      ).reason,
    ).toBe("provider");
    sqlite.exec(
      "UPDATE journey_limits SET count=1900 WHERE key LIKE 'routes-day:%'",
    );
    expect(
      (
        await json(
          req("/trips/1/routes", 2, "POST", body, { ORS_API_KEY: "test" }),
        )
      ).reason,
    ).toBe("quota");
  });
  it("does not claim email recovery is configured when credentials are absent", async () => {
    expect((await json(req("/recovery/status", null))).available).toBe(false);
    expect(
      (
        await req("/recovery/request", null, "POST", {
          email: "u2@example.test",
        })
      ).status,
    ).toBe(503);
  });
  it("handles delivery failures and unknown emails with the same response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("", { status: 503 })),
    );
    const cfg = {
      RESEND_API_KEY: "test",
      RESET_EMAIL_FROM: "reset@example.test",
      APP_ORIGIN: "https://example.test",
    };
    const known = await json(
      req("/recovery/request", null, "POST", { email: "u2@example.test" }, cfg),
    );
    const unknown = await json(
      req(
        "/recovery/request",
        null,
        "POST",
        { email: "unknown@example.test" },
        cfg,
      ),
    );
    expect(known).toEqual(unknown);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM password_resets").get()?.n,
    ).toBe(0);
  });
  it("emails a fragment token, stores only its hash, and gives it a 30-minute lifetime", async () => {
    let sent: any;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: any, init: any) => {
        sent = JSON.parse(init.body);
        return Response.json({ id: "mail" });
      }),
    );
    const cfg = {
      RESEND_API_KEY: "test",
      RESET_EMAIL_FROM: "reset@example.test",
      APP_ORIGIN: "https://example.test",
    };
    await json(
      req("/recovery/request", null, "POST", { email: "u3@example.test" }, cfg),
    );
    const token = sent.text.match(/reset-password#([a-f0-9]{64})/)[1];
    const row: any = sqlite
      .prepare("SELECT * FROM password_resets WHERE user_id=3")
      .get();
    expect(row.token_hash).toBe(await hashToken(token));
    expect(row.token_hash).not.toBe(token);
    expect(row.expires_at - row.created_at).toBe(1800);
  });
  it("rejects expired tokens and consumes valid tokens once, revoking sessions and API tokens", async () => {
    const now = Math.floor(Date.now() / 1000),
      token = "a".repeat(64),
      digest = await hashToken(token);
    sqlite
      .prepare("INSERT INTO password_resets VALUES (?,?,?,NULL,?)")
      .run(digest, 2, now - 1, now);
    expect(
      (
        await req("/recovery/reset", null, "POST", {
          token,
          password: "new-password",
        })
      ).status,
    ).toBe(400);
    sqlite.prepare("UPDATE password_resets SET expires_at=?").run(now + 1800);
    sqlite.exec(
      "INSERT INTO api_tokens(user_id,name,token_hash) VALUES(2,'test','test')",
    );
    await json(
      req("/recovery/reset", null, "POST", { token, password: "new-password" }),
    );
    expect(
      (
        await req("/recovery/reset", null, "POST", {
          token,
          password: "new-password",
        })
      ).status,
    ).toBe(400);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id=2").get()
        ?.n,
    ).toBe(0);
    expect(
      sqlite.prepare("SELECT revoked FROM api_tokens WHERE user_id=2").get()
        ?.revoked,
    ).toBe(1);
    const u: any = sqlite.prepare("SELECT * FROM users WHERE id=2").get();
    expect(await verifyPassword("new-password", u.salt, u.password_hash)).toBe(
      true,
    );
  });
});
describe("public types", () => {
  it("drops unexpected fields and rejects impossible days and duplicate ids", () => {
    const stop = { id: "1", title: "A", day: "2026-02-30" };
    expect(() => cleanJourney({ stops: [stop], days: [] })).toThrow();
    stop.day = "2026-02-28";
    expect(() => cleanJourney({ stops: [stop, stop], days: [] })).toThrow();
    const plan = cleanJourney({
      stops: [{ ...stop, expense_id: 9 }],
      days: [],
    });
    expect(plan.stops[0]).not.toHaveProperty("expense_id");
    expect(
      cleanPublicJourney({
        ...publicJourney("A", "B", plan, [], true),
        secret: "bad",
      }),
    ).not.toHaveProperty("secret");
  });
  it("hands off using the requested travel mode", () => {
    const a = { lat: 35, lng: 139 },
      b = { lat: 36, lng: 140 };
    expect(directionsUrl(a, b, "walk")).toContain("travelmode=walking");
    expect(directionsUrl(a, b, "taxi")).toContain("travelmode=driving");
    expect(directionsUrl(a, b, "train")).toContain("travelmode=transit");
  });
});


describe('group activity deletion boundaries', () => {
  const rest = (path: string, user: number, body: any) => legacyApp.request(`/api${path}`, {
    method: 'POST', headers: {Cookie: `sid=session-${user}`, 'Content-Type': 'application/json'}, body: JSON.stringify(body),
  }, env);
  beforeAll(() => {
    for (const id of [1,2,4,5]) sqlite.prepare('INSERT OR REPLACE INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(`session-${id}`,id,'2099-01-01');
    sqlite.exec(`INSERT INTO trips(id,name) VALUES(90,'Deletion sandbox'),(91,'Other sandbox');
      INSERT INTO trip_members VALUES(90,1,'leader'),(90,4,'editor'),(90,2,'viewer');
      INSERT INTO activities(id,trip_id,title,day) VALUES(9000,90,'Remove','2026-12-01'),(9001,90,'Keep next day','2026-12-02'),(9002,91,'Keep other trip','2026-12-01');
      INSERT INTO activity_participants VALUES(9000,1);
      INSERT INTO day_settings(trip_id,day,title) VALUES(90,'2026-12-01','Keep title');
      INSERT INTO day_notes(trip_id,day,content) VALUES(90,'2026-12-01','Keep note');
      INSERT INTO leg_overrides(trip_id,day,leg_key,mode) VALUES(90,'2026-12-01','act:9000->end','car'),(90,'2026-12-02','start->end','walk');`);
  });
  it('rejects viewers, non-members, hidden plans and invalid days', async () => {
    for (const user of [2,5]) expect((await rest('/trips/90/activities/reset-day',user,{day:'2026-12-01'})).status).toBe(403);
    for (const day of ['*','2026-02-30','2026-12-01 OR 1=1',null]) expect((await rest('/trips/90/activities/reset-day',4,{day})).status).toBe(400);
    sqlite.exec(`UPDATE trips SET hidden_features='["plan"]' WHERE id=90`);
    expect((await rest('/trips/90/activities/reset-day',4,{day:'2026-12-01'})).status).toBe(403);
    sqlite.exec(`UPDATE trips SET hidden_features='[]' WHERE id=90`);
  });
  it('resets exactly one day atomically, preserves other content and supports retries', async () => {
    expect(await (await rest('/trips/90/activities/reset-day',4,{day:'2026-12-01'})).json()).toEqual({deleted:1});
    expect(sqlite.prepare('SELECT id FROM activities WHERE id=9000').get()).toBeUndefined();
    expect(sqlite.prepare('SELECT activity_id FROM activity_participants WHERE activity_id=9000').get()).toBeUndefined();
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM activities WHERE id IN (9001,9002)').get()?.n).toBe(2);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM leg_overrides WHERE trip_id=90').get()?.n).toBe(1);
    expect(sqlite.prepare('SELECT title FROM day_settings WHERE trip_id=90').get()?.title).toBe('Keep title');
    expect(sqlite.prepare('SELECT content FROM day_notes WHERE trip_id=90').get()?.content).toBe('Keep note');
    expect(await (await rest('/trips/90/activities/reset-day',1,{day:'2026-12-01'})).json()).toEqual({deleted:0});
  });
  it('bulk deletes only requested activities in this trip, with more than 100 IDs', async () => {
    const ids = Array.from({length:120},(_,i)=>9100+i);
    for (const id of ids) sqlite.prepare("INSERT INTO activities(id,trip_id,title,day) VALUES(?,90,'Bulk','2026-12-03')").run(id);
    expect((await rest('/trips/90/activities/delete',2,{ids})).status).toBe(403);
    expect((await rest('/trips/90/activities/delete',4,{ids:['9001']})).status).toBe(400);
    expect(await (await rest('/trips/90/activities/delete',4,{ids:[...ids,ids[0],9002]})).json()).toEqual({deleted:120});
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM activities WHERE id IN (9001,9002)').get()?.n).toBe(2);
  });
});
