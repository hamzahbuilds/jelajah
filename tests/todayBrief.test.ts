// v0.48 Today: the daily brief. The AI summary is written from the day's own
// data (Gemini native API, fetch mocked), cached until that data changes, and
// sits beside a leader-only summary. Real SQLite behind the D1 interface.
import { beforeAll, describe, expect, it, vi } from 'vitest';
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

const prompts: string[] = [];
vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
  if (String(url).includes(':generateContent')) {
    const body = JSON.parse(String(init?.body));
    prompts.push(body.contents.at(-1).parts.at(-1).text);
    return Response.json({ candidates: [{ content: { parts: [{ text: `• Brief ${prompts.length}` }] }, finishReason: 'STOP' }] });
  }
  return new Response('not mocked', { status: 500 });
}));

const req = (sid: string, path: string, init: RequestInit = {}) => app.request(`/api${path}`, {
  ...init, headers: { Cookie: `sid=${sid}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
}, env);
const DAY = '2026-12-02';

beforeAll(() => {
  for (const s of SCHEMA) sqlite.exec(s);
  sqlite.exec(`INSERT INTO participants(id,name) VALUES (1,'Leader'),(2,'Member'),(3,'Outsider');
    INSERT INTO users(id,email,name,password_hash,salt,role,participant_id) VALUES
      (1,'l@x','Leader','x','x','member',1),(2,'m@x','Member','x','x','member',2),(3,'o@x','Outsider','x','x','member',3);
    INSERT INTO sessions(token,user_id,expires_at) VALUES ('s1',1,'2099-01-01 00:00:00'),('s2',2,'2099-01-01 00:00:00'),('s3',3,'2099-01-01 00:00:00');
    INSERT INTO trips(id,name,destination,start_date,end_date) VALUES (1,'Tokyo crew','Tokyo','2026-12-01','2026-12-05');
    INSERT INTO trip_members(trip_id,participant_id,role) VALUES (1,1,'leader'),(1,2,'viewer');
    INSERT INTO day_settings(trip_id,day,title) VALUES (1,'${DAY}','Asakusa day');
    INSERT INTO activities(trip_id,title,day,start_time,location_name) VALUES (1,'Senso-ji','${DAY}','09:00','Asakusa'),(1,'Lunch','${DAY}','12:30',NULL);
    INSERT INTO day_notes(trip_id,day,content,is_check) VALUES (1,'${DAY}','Buy Suica cards',1);`);
  sqlite.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES (?,?)').run('data_migrations', JSON.stringify(['m001-trip-roles', 'm002-multi-currency']));
  sqlite.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES (?,?)').run('ai_provider',
    JSON.stringify({ base_url: 'https://generativelanguage.googleapis.com', api_key: 'test-key', model: 'gemini-2.5-flash' }));
});

describe('daily brief', () => {
  it('starts empty and is closed to people outside the trip', async () => {
    const r = await (await req('s2', `/trips/1/briefs/${DAY}`)).json() as any;
    expect(r).toMatchObject({ day: DAY, items: 3, ai_available: true, ai: null, note: null });
    expect((await req('s3', `/trips/1/briefs/${DAY}`)).status).toBe(403);
    expect((await req('s2', '/trips/1/briefs/02-12-2026')).status).toBe(400);
  });

  it('writes the AI brief once from the day data only, then never again', async () => {
    const r = await (await req('s2', `/trips/1/briefs/${DAY}/ai`, { method: 'POST' })).json() as any;
    expect(r.ai).toMatchObject({ text: '• Brief 1' });
    expect(prompts[0]).toContain('09:00 Senso-ji at Asakusa');
    expect(prompts[0]).toContain('Day theme: Asakusa day');
    expect(prompts[0]).toContain('To do: Buy Suica cards');
    // Asking again, by the leader, with force, or after the plan changes: same brief, no new AI call.
    await req('s1', `/trips/1/briefs/${DAY}/ai?force=1`, { method: 'POST' });
    sqlite.exec(`INSERT INTO activities(trip_id,title,day,start_time) VALUES (1,'Skytree','${DAY}','16:00')`);
    const after = await (await req('s1', `/trips/1/briefs/${DAY}/ai?lang=ms`, { method: 'POST' })).json() as any;
    expect(after.ai.text).toBe('• Brief 1');
    expect(prompts).toHaveLength(1);
  });

  it('refuses an empty day', async () => {
    const r = await req('s1', '/trips/1/briefs/2026-12-04/ai', { method: 'POST' });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toBe('empty_day');
  });

  it('only the leader can write the summary; empty text clears it', async () => {
    expect((await req('s2', `/trips/1/briefs/${DAY}/note`, { method: 'PUT', body: JSON.stringify({ text: 'Hi' }) })).status).toBe(403);
    const r = await (await req('s1', `/trips/1/briefs/${DAY}/note`, { method: 'PUT', body: JSON.stringify({ text: ' Lobby at 8:30. ' }) })).json() as any;
    expect(r.note).toMatchObject({ text: 'Lobby at 8:30.', by: 'Leader' });
    expect(r.ai.text).toBe('• Brief 1'); // the AI brief is kept
    const cleared = await (await req('s1', `/trips/1/briefs/${DAY}/note`, { method: 'PUT', body: JSON.stringify({ text: '' }) })).json() as any;
    expect(cleared.note).toBeNull();
    expect((await req('s1', `/trips/1/briefs/${DAY}/note`, { method: 'PUT', body: JSON.stringify({ text: 'x'.repeat(1501) }) })).status).toBe(400);
  });

  it('is hidden from members when the leader hides Today', async () => {
    sqlite.exec(`UPDATE trips SET hidden_features='["today"]' WHERE id=1`);
    expect((await req('s2', `/trips/1/briefs/${DAY}`)).status).toBe(403);
    expect((await req('s1', `/trips/1/briefs/${DAY}`)).status).toBe(200);
    sqlite.exec(`UPDATE trips SET hidden_features='[]' WHERE id=1`);
  });
});

describe('AI chat feature flag', () => {
  it('is off by default and refuses chat calls until the admin turns it on', async () => {
    const off = await req('s1', '/trips/1/assistant/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
    expect(off.status).toBe(403);
    expect(((await off.json()) as any).error).toBe('feature_off');
    sqlite.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES ('feature_flags',?)").run(JSON.stringify({ aiChat: true }));
    const on = await req('s1', '/trips/1/assistant/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
    expect(on.status).toBe(200);
    sqlite.exec("DELETE FROM app_settings WHERE key='feature_flags'");
  });
});
