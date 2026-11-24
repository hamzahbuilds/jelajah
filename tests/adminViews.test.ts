// v0.49 admin views: dashboard stats, all-trips list, feature usage, and the
// new usage tracking points. Admin-only. Real SQLite behind the D1 interface.
import { beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import app from '../server/app';
import { SCHEMA } from '../server/lib/schema';
import type { Env } from '../server/env.d';

const sqlite = new DatabaseSync(':memory:');
class Statement {
  args: any[] = [];
  constructor(public sql: string) {}
  bind(...args: any[]) { const s = new Statement(this.sql); s.args = args; return s; }
  async first(col?: string) {
    const row: any = sqlite.prepare(this.sql).get(...this.args) ?? null;
    return col && row ? row[col] : row;
  }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args), success: true }; }
  async run() {
    const r = sqlite.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}
const db = {
  prepare: (sql: string) => new Statement(sql),
  batch: async (stmts: Statement[]) => { const out = []; for (const s of stmts) out.push(await s.run()); return out; },
} as unknown as D1Database;
const env: Env = { DB: db, FILES: {} as KVNamespace };


const req = (sid: string, path: string, init: RequestInit = {}) => app.request(`/api${path}`, {
  ...init, headers: { Cookie: `sid=${sid}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
}, env);
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

beforeAll(() => {
  for (const s of SCHEMA) sqlite.exec(s);
  sqlite.exec(`INSERT INTO participants(id,name) VALUES (1,'Ada'),(2,'Ben'),(3,'Cy');
    INSERT INTO users(id,email,name,password_hash,salt,role,participant_id) VALUES
      (1,'a@x','Ada Admin','x','x','admin',1),(2,'b@x','Ben','x','x','member',2),(3,'c@x','Cy','x','x','member',3);
    INSERT INTO sessions(token,user_id,expires_at) VALUES ('sa',1,'2099-01-01 00:00:00'),('sb',2,'2099-01-01 00:00:00');
    INSERT INTO trips(id,name,destination,start_date,end_date,created_at) VALUES
      (1,'Tokyo','Japan','${daysAgo(2)}','${daysAgo(-3)}','${daysAgo(1)} 10:00:00'),
      (2,'Bali','Indonesia','${daysAgo(-40)}','${daysAgo(-45)}','${daysAgo(45)} 10:00:00'),
      (3,'Undated',NULL,NULL,NULL,'${daysAgo(3)} 10:00:00');
    INSERT INTO trip_members(trip_id,participant_id,role) VALUES (1,2,'leader'),(1,3,'viewer'),(2,3,'leader');
    INSERT INTO activities(trip_id,title,day) VALUES (1,'A','${today}'),(1,'B','${today}'),(2,'C','${today}');
    INSERT INTO usage_daily(day,user_id,feature,count) VALUES
      ('${today}',2,'plan_view',5),('${today}',3,'plan_view',1),('${daysAgo(1)}',2,'expense_add',2),
      ('${daysAgo(40)}',2,'plan_view',2);`);
  sqlite.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES (?,?)').run('data_migrations', JSON.stringify(['m001-trip-roles', 'm002-multi-currency']));
});

describe('admin views', () => {
  it('are admin-only', async () => {
    for (const p of ['/admin/stats', '/admin/trips', '/admin/feature-usage']) {
      expect((await req('sb', p)).status).toBe(403);
      expect((await req('sa', p)).status).toBe(200);
    }
  });

  it('lists every trip with leader, member and planning counts', async () => {
    const { trips } = await (await req('sa', '/admin/trips')).json() as any;
    expect(trips.map((t: any) => t.id)).toEqual([3, 2, 1]);
    expect(trips.find((t: any) => t.id === 1)).toMatchObject({ name: 'Tokyo', leaders: 'Ben', members: 2, activities: 2, documents: 0, expenses: 0 });
  });

  it('dashboard stats carry 30-day trends, series and the newest trips', async () => {
    const s = await (await req('sa', '/admin/stats')).json() as any;
    expect(s).toMatchObject({ users: 3, trips: 3, trips30: 2, tripsPrev30: 1, ongoing: 1, upcoming: 1, aiFailed7: 0, aiCost30: 0 });
    expect(s.dau).toHaveLength(30);
    expect(s.dau.at(-1)).toEqual({ day: today, n: 2 });
    expect(s.recentTrips[0]).toMatchObject({ id: 3, name: 'Undated' });
  });

  it('feature usage: events, unique people and the previous period', async () => {
    const u = await (await req('sa', '/admin/feature-usage?days=30')).json() as any;
    expect(u).toMatchObject({ days: 30, users: 3, active: 2, activePrev: 1 });
    const plan = u.features.find((f: any) => f.feature === 'plan_view');
    expect(plan).toMatchObject({ events: 6, users: 2, prevEvents: 2, prevUsers: 1 });
    expect(plan.series).toHaveLength(30);
    expect(plan.series.at(-1)).toBe(6);
    expect(u.top[0]).toMatchObject({ name: 'Ben', events: 7, features: 2 });
  });

  it('creating a trip is now counted', async () => {
    const r = await req('sb', '/trips', { method: 'POST', body: JSON.stringify({ name: 'New one' }) });
    expect(r.status).toBe(200);
    const row = sqlite.prepare("SELECT count FROM usage_daily WHERE user_id = 2 AND feature = 'trip_create'").get() as any;
    expect(row?.count).toBe(1);
  });
});
