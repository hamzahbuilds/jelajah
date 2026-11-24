// v0.49 Release notes: admin drafts (by hand or AI from GitHub commits),
// publishes; each person sees a release once; new sign-ups skip older ones.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import app, { parseLooseJson } from '../server/app';
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


let aiPrompt = '';
let githubUrl = '';
vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
  if (String(url).startsWith('https://api.github.com/')) {
    githubUrl = String(url);
    expect((init?.headers as any)['User-Agent']).toBe('jelajah-release-notes');
    return Response.json([
      { parents: [{}], commit: { author: { date: '2026-11-25T01:00:00Z' }, message: 'Documents: bulk move\n\nCo-Authored-By: Bot <b@x>' } },
      { parents: [{}, {}], commit: { author: { date: '2026-11-25T02:00:00Z' }, message: 'Merge branch x' } },
    ]);
  }
  if (String(url).includes(':generateContent')) {
    aiPrompt = JSON.parse(String(init?.body)).contents.at(-1).parts.at(-1).text;
    return Response.json({ candidates: [{ content: { parts: [{ text: '```json\n{"title_en":"Tidier documents","title_ms":"Dokumen lebih kemas","body_en":"## New\n- Move many files at once.","body_ms":"## Baharu\n- Pindah banyak fail sekali gus."}\n```' }] }, finishReason: 'STOP' }] });
  }
  return new Response('not mocked', { status: 500 });
}));

const req = (sid: string, path: string, init: RequestInit = {}) => app.request(`/api${path}`, {
  ...init, headers: { Cookie: `sid=${sid}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
}, env);
const json = async (r: Response | Promise<Response>) => (await r).json() as any;

beforeAll(() => {
  for (const s of SCHEMA) sqlite.exec(s);
  sqlite.exec(`INSERT INTO users(id,email,name,password_hash,salt,role,created_at) VALUES
      (1,'a@x','Admin','x','x','admin','2026-01-01 00:00:00'),(2,'m@x','Mia','x','x','member','2026-01-01 00:00:00');
    INSERT INTO sessions(token,user_id,expires_at) VALUES ('sa',1,'2099-01-01 00:00:00'),('sm',2,'2099-01-01 00:00:00');`);
  sqlite.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES (?,?)').run('data_migrations', JSON.stringify(['m001-trip-roles', 'm002-multi-currency']));
  sqlite.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES (?,?)').run('ai_provider', JSON.stringify({ base_url: 'https://generativelanguage.googleapis.com', api_key: 'k', model: 'gemini-3.6-flash' }));
});

describe('release notes', () => {
  it('admin endpoints are admin-only', async () => {
    expect((await req('sm', '/admin/releases')).status).toBe(403);
    expect((await req('sm', '/admin/releases', { method: 'POST', body: '{}' })).status).toBe(403);
    expect((await req('sm', '/admin/releases/draft', { method: 'POST' })).status).toBe(403);
  });

  it('drafts are invisible to users until published, then shown once', async () => {
    const d = await json(req('sa', '/admin/releases', { method: 'POST', body: JSON.stringify({ version: 'v1', title_en: 'Hello', body_en: '- First' }) }));
    expect(d).toMatchObject({ status: 'draft', version: 'v1' });
    expect(await json(req('sm', '/releases'))).toMatchObject({ releases: [], latest_id: 0 });
    expect((await req('sa', `/admin/releases/${d.id}/publish`, { method: 'POST' })).status).toBe(200);
    expect((await req('sa', `/admin/releases/${d.id}/publish`, { method: 'POST' })).status).toBe(404); // already live
    expect((await json(req('sa', '/releases'))).seen_id).toBe(d.id); // the publisher is not shown it again
    const r = await json(req('sm', '/releases'));
    expect(r.latest_id).toBe(d.id);
    expect(r.seen_id).toBe(0); // new for Mia
    await req('sm', '/releases/seen', { method: 'POST', body: JSON.stringify({ id: d.id }) });
    expect((await json(req('sm', '/releases'))).seen_id).toBe(d.id);
    await req('sm', '/releases/seen', { method: 'POST', body: JSON.stringify({ id: 1 }) }); // never goes backwards
    expect((await json(req('sm', '/releases'))).seen_id).toBe(d.id);
  });

  it('someone who signs up after a release is not shown it as new', async () => {
    sqlite.exec(`INSERT INTO users(id,email,name,password_hash,salt,role,created_at) VALUES (3,'n@x','New','x','x','member','2099-01-01 00:00:00');
      INSERT INTO sessions(token,user_id,expires_at) VALUES ('sn',3,'2099-01-01 00:00:00');`);
    const r = await json(req('sn', '/releases'));
    expect(r.seen_id).toBe(r.latest_id);
    expect(r.releases).toHaveLength(1); // history is still there
  });

  it('AI draft reads commits since the last release, skips merges and trailers, saves a draft', async () => {
    const r = await json(req('sa', '/admin/releases/draft', { method: 'POST' }));
    expect(r.commits).toBe(1);
    expect(r.release).toMatchObject({ status: 'draft', ai_drafted: 1, title_en: 'Tidier documents', title_ms: 'Dokumen lebih kemas' });
    expect(githubUrl).toContain('/repos/hamzahbuilds/jelajah/commits');
    expect(githubUrl).toContain('since=');
    expect(aiPrompt).toContain('Documents: bulk move');
    expect(aiPrompt).not.toContain('Co-Authored-By');
    expect(aiPrompt).not.toContain('Merge branch');
    expect((await json(req('sm', '/releases'))).releases).toHaveLength(1); // still a draft
  });

  it('editing validates; deleting removes it from history', async () => {
    const { releases } = await json(req('sa', '/admin/releases'));
    const draft = releases.find((x: any) => x.status === 'draft');
    expect((await req('sa', `/admin/releases/${draft.id}`, { method: 'PUT', body: JSON.stringify({ version: '', title_en: 'x', body_en: 'y' }) })).status).toBe(400);
    expect((await req('sa', `/admin/releases/${draft.id}`, { method: 'PUT', body: JSON.stringify({ version: 'v2', title_en: 'Tidier', body_en: '- ok' }) })).status).toBe(200);
    expect((await req('sa', `/admin/releases/${draft.id}`, { method: 'DELETE' })).status).toBe(200);
    expect((await json(req('sa', '/admin/releases'))).releases).toHaveLength(1);
  });

  it('reads model JSON with fences, chatter and raw line breaks inside strings', () => {
    expect(parseLooseJson('Sure!\n```json\n{"a":"line 1\nline 2","b":"x \\"q\\""}\n```')).toEqual({ a: 'line 1\nline 2', b: 'x "q"' });
    expect(parseLooseJson('no json here')).toBeNull();
  });
});
