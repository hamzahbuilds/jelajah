// v0.38 perf: trip cards use a small (960px) copy of the cover.
import { beforeAll, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import app from '../server/app';
import { SCHEMA } from '../server/lib/schema';
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
// R2-shaped fake bucket
const store = new Map<string, { buf: Uint8Array; type: string }>();
const FILES = {
  put: async (k: string, buf: ArrayBuffer, o: any) => { store.set(k, { buf: new Uint8Array(buf), type: o?.httpMetadata?.contentType }); },
  get: async (k: string) => { const v = store.get(k); return v ? { body: new Response(v.buf as unknown as BodyInit).body, httpMetadata: { contentType: v.type } } : null; },
  delete: async (k: string) => { store.delete(k); },
};
const env = { DB: db, FILES } as unknown as Env;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
const call = (path: string, init: RequestInit & { sid?: string } = {}) => app.request(`https://j.test/api${path}`, {
  ...init, headers: { Cookie: `sid=${init.sid ?? 'leader'}`, ...(init.headers as any) },
}, env, ctx);

beforeAll(() => {
  for (const s of SCHEMA) sqlite.exec(s);
  sqlite.exec(`INSERT INTO participants(id,name) VALUES (1,'Lead'),(2,'Viewer');
    INSERT INTO users(id,email,name,password_hash,salt,role,participant_id) VALUES (1,'l@x.test','Lead','x','y','member',1),(2,'v@x.test','Viewer','x','y','member',2);
    INSERT INTO sessions(token,user_id,expires_at) VALUES ('leader',1,'2099-01-01'),('viewer',2,'2099-01-01');
    INSERT INTO trips(id,name,destination,start_date,end_date,cover_key) VALUES (1,'T','Tokyo','2026-12-01','2026-12-03','cover/1/111');
    INSERT INTO trip_members(trip_id,participant_id,role) VALUES (1,1,'leader'),(1,2,'viewer');`);
  sqlite.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES (?,?)').run('data_migrations', JSON.stringify(['m001-trip-roles']));
  store.set('cover/1/111', { buf: new Uint8Array(300_000), type: 'image/jpeg' });
});

describe('small trip covers (v0.38)', () => {
  it('?size=sm falls back to the full cover and says the small copy is missing', async () => {
    const r = await call('/trips/1/cover?size=sm');
    expect(r.status).toBe(200);
    expect(r.headers.get('X-Cover-Small')).toBe('missing');
    expect((await r.arrayBuffer()).byteLength).toBe(300_000);
    expect((await call('/trips/1/cover')).headers.get('X-Cover-Small')).toBeNull();
  });

  it('a leader stores the small copy for the current cover; then it is served', async () => {
    const small = new Uint8Array(40_000);
    const put = await call('/trips/1/cover/small?v=cover%2F1%2F111', { method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: small });
    expect(put.status).toBe(200);
    const r = await call('/trips/1/cover?size=sm');
    expect(r.headers.get('X-Cover-Small')).toBeNull();
    expect(r.headers.get('Content-Type')).toBe('image/webp');
    expect((await r.arrayBuffer()).byteLength).toBe(40_000);
  });

  it('refuses viewers, a stale cover key, other types and big files', async () => {
    const body = new Uint8Array(10);
    expect((await call('/trips/1/cover/small?v=cover%2F1%2F111', { sid: 'viewer', method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body })).status).toBe(403);
    expect((await call('/trips/1/cover/small?v=cover%2F1%2F999', { method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body })).status).toBe(409);
    expect((await call('/trips/1/cover/small?v=cover%2F1%2F111', { method: 'PUT', headers: { 'Content-Type': 'image/svg+xml' }, body })).status).toBe(415);
    expect((await call('/trips/1/cover/small?v=cover%2F1%2F111', { method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: new Uint8Array(300_000) })).status).toBe(413);
  });

  it('removing the cover removes its small copy too', async () => {
    expect(store.has('cover/1/111-sm')).toBe(true);
    expect((await call('/trips/1/cover', { method: 'DELETE' })).status).toBe(200);
    expect(store.has('cover/1/111')).toBe(false);
    expect(store.has('cover/1/111-sm')).toBe(false);
  });
});
