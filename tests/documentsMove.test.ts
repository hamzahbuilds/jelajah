// v0.49 Documents, Drive-style: moving a file between folders (access follows
// the folder, booking type kept for the way back) and changing its type.
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
const move = (sid: string, id: number, folder: unknown) => req(sid, `/documents/${id}/move`, { method: 'POST', body: JSON.stringify({ folder }) });
const doc = (id: number) => sqlite.prepare('SELECT doc_type, parsed_json FROM documents WHERE id = ?').get(id) as any;
const list = async (sid: string) => ((await (await req(sid, '/trips/1/documents')).json()) as any[]).map(d => d.id).sort();

beforeAll(async () => {
  for (const s of SCHEMA) sqlite.exec(s);
  sqlite.exec(`INSERT INTO participants(id,name) VALUES (1,'Lead'),(2,'Mia'),(3,'Noor');
    INSERT INTO users(id,email,name,password_hash,salt,role,participant_id) VALUES
      (1,'l@x','Lead','x','x','member',1),(2,'m@x','Mia','x','x','member',2),(3,'n@x','Noor','x','x','member',3);
    INSERT INTO sessions(token,user_id,expires_at) VALUES ('s1',1,'2099-01-01 00:00:00'),('s2',2,'2099-01-01 00:00:00'),('s3',3,'2099-01-01 00:00:00');
    INSERT INTO trips(id,name) VALUES (1,'Trip');
    INSERT INTO trip_members(trip_id,participant_id,role) VALUES (1,1,'leader'),(1,2,'editor'),(1,3,'viewer');
    INSERT INTO documents(id,trip_id,filename,r2_key,mime,size,doc_type,parsed_json,uploaded_by) VALUES
      (10,1,'hotel.pdf','k10','application/pdf',1,'confirmation','{"docType":"confirmation","libraryCategory":"accommodation"}',1),
      (11,1,'passport.jpg','k11','image/jpeg',1,'personal','{"docType":"personal","libraryCategory":"other"}',2);`);
  sqlite.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES (?,?)').run('data_migrations', JSON.stringify(['m001-trip-roles', 'm002-multi-currency']));
  await req('s1', '/trips/1/document-library/settings'); // creates the folder tables
  sqlite.exec(`INSERT INTO document_folders(id,trip_id,name,owner_id,visibility) VALUES (5,1,'Lead only',1,'private'),(6,1,'Shared tickets',2,'trip')`);
});

describe('moving documents', () => {
  it('everyone sees the hotel booking at first; the passport is Mia\'s own', async () => {
    expect(await list('s3')).toEqual([10]);
    expect(await list('s2')).toEqual([10, 11]);
  });

  it('a shared booking moved to a private folder disappears for others, and keeps its type for the way back', async () => {
    expect((await move('s1', 10, 5)).status).toBe(200);
    expect(doc(10).doc_type).toBe('personal');
    expect(JSON.parse(doc(10).parsed_json)).toMatchObject({ libraryFolderId: 5, sharedDocType: 'confirmation' });
    expect(await list('s3')).toEqual([]);
    expect((await move('s1', 10, 'trip')).status).toBe(200);
    expect(doc(10).doc_type).toBe('confirmation');
    expect(JSON.parse(doc(10).parsed_json).libraryFolderId).toBeUndefined();
    expect(await list('s3')).toEqual([10]);
  });

  it('a personal file moved into a shared folder becomes visible to the trip', async () => {
    expect((await move('s2', 11, 6)).status).toBe(200);
    expect(doc(11).doc_type).toBe('other');
    expect(await list('s3')).toEqual([10, 11]);
    expect((await move('s2', 11, 'private')).status).toBe(200);
    expect(await list('s3')).toEqual([10]);
  });

  it('only people who may edit the file can move it, and only into folders they can open', async () => {
    expect((await move('s3', 10, 'private')).status).toBe(403); // a viewer, not the uploader
    expect((await move('s2', 11, 5)).status).toBe(400);          // Lead's private folder
    expect((await move('s2', 11, 999)).status).toBe(400);
    expect((await move('s3', 11, 'trip')).status).toBe(404);     // cannot even see it
  });

  it('changing the type keeps the name; renaming keeps the type', async () => {
    expect((await req('s1', '/documents/10', { method: 'PATCH', body: JSON.stringify({ category: 'attractions' }) })).status).toBe(200);
    expect(JSON.parse(doc(10).parsed_json).libraryCategory).toBe('attractions');
    expect((await req('s1', '/documents/10', { method: 'PATCH', body: JSON.stringify({ filename: 'Hotel booking.pdf' }) })).status).toBe(200);
    expect(JSON.parse(doc(10).parsed_json).libraryCategory).toBe('attractions');
    expect((await req('s1', '/documents/10', { method: 'PATCH', body: JSON.stringify({}) })).status).toBe(400);
    expect((await req('s1', '/documents/10', { method: 'PATCH', body: JSON.stringify({ category: 'x'.repeat(81) }) })).status).toBe(400);
  });

  it('bulk move: each file checked on its own, the reply says what moved', async () => {
    const r = await (await req('s2', '/documents/move', { method: 'POST', body: JSON.stringify({ ids: [11, 10, 999], folder: 6 }) })).json() as any;
    // Mia owns 11; 10 is Lead's (Mia is an editor, not a leader) and 999 does not exist.
    expect(r.moved).toEqual([11]);
    expect(r.failed).toEqual([{ id: 10, error: 'forbidden' }, { id: 999, error: 'not_found' }]);
    const lead = await (await req('s1', '/documents/move', { method: 'POST', body: JSON.stringify({ ids: [10, 11], folder: 'trip' }) })).json() as any;
    expect(lead.moved).toEqual([10, 11]);
    expect((await req('s1', '/documents/move', { method: 'POST', body: JSON.stringify({ ids: [], folder: 'trip' }) })).status).toBe(400);
    expect((await req('s1', '/documents/move', { method: 'POST', body: JSON.stringify({ ids: ['10'], folder: 'trip' }) })).status).toBe(400);
  });
});
