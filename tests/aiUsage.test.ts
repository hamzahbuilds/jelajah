// v0.48 AI usage log, cost estimates and the Workers AI backup. Gemini is
// mocked via fetch; Workers AI via a fake env.AI binding.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import app from '../server/app';
import { SCHEMA } from '../server/lib/schema';
import { priceFor, costUsd, DEFAULT_AI_PRICES } from '../shared/aiPrices';
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
const aiRuns: any[] = [];
let aiReply: any = { response: '• Backup brief', usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } };
const env: Env = { DB: db, FILES: {} as KVNamespace, AI: { run: async (model: string, input: any) => { aiRuns.push({ model, input }); if (aiReply instanceof Error) throw aiReply; return aiReply; } } };


let gemini: 'ok' | '429' | '500' | 'timeout' = 'ok';
const sent: Array<{ url: string; body: any; signal: boolean }> = [];
vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
  if (String(url).includes(':generateContent')) {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)), signal: !!init?.signal });
    if (gemini === 'timeout') throw Object.assign(new Error('The operation timed out'), { name: 'TimeoutError' });
    if (gemini === '429') return new Response('{}', { status: 429 });
    if (gemini === '500') return Response.json({ error: { message: 'boom' } }, { status: 500 });
    return Response.json({ candidates: [{ content: { parts: [{ text: '• Gemini brief' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 300 } });
  }
  return new Response('not mocked', { status: 500 });
}));

const req = (path: string, init: RequestInit = {}) => app.request(`/api${path}`, {
  ...init, headers: { Cookie: 'sid=s1', 'Content-Type': 'application/json', ...(init.headers ?? {}) },
}, env);
const gemCfg = JSON.stringify({ base_url: 'https://generativelanguage.googleapis.com', api_key: 'k', model: 'gemini-2.5-flash' });
let day = 1;
const nextDay = () => String(day++).padStart(2, "0");
const brief = () => req(`/trips/1/briefs/2026-12-${nextDay()}/ai`, { method: "POST" });
const calls = () => sqlite.prepare('SELECT feature, provider, model, in_tokens, out_tokens, think_tokens, ok, fallback, trip_id FROM ai_calls ORDER BY id').all() as any[];

beforeAll(() => {
  for (const s of SCHEMA) sqlite.exec(s);
  sqlite.exec(`INSERT INTO participants(id,name) VALUES (1,'Admin');
    INSERT INTO users(id,email,name,password_hash,salt,role,participant_id) VALUES (1,'a@x','Admin','x','x','admin',1);
    INSERT INTO sessions(token,user_id,expires_at) VALUES ('s1',1,'2099-01-01 00:00:00');
    INSERT INTO trips(id,name,start_date,end_date) VALUES (1,'T','2026-12-01','2026-12-20');
    INSERT INTO trip_members(trip_id,participant_id,role) VALUES (1,1,'leader');`);
  for (let d = 1; d <= 20; d++) sqlite.exec(`INSERT INTO activities(trip_id,title,day,start_time) VALUES (1,'Stop','2026-12-${String(d).padStart(2, '0')}','10:00')`);
  sqlite.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES (?,?)').run('data_migrations', JSON.stringify(['m001-trip-roles', 'm002-multi-currency']));
});
beforeEach(() => { gemini = 'ok'; aiRuns.length = 0; sent.length = 0; sqlite.exec('DELETE FROM ai_calls'); sqlite.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES ('ai_provider',?)").run(gemCfg); sqlite.exec("DELETE FROM app_settings WHERE key='ai_fallback'"); });

describe('prices', () => {
  it('matches a model by its longest known prefix and bills thinking at the output rate', () => {
    expect(priceFor('models/gemini-2.5-flash-preview-09-2025', DEFAULT_AI_PRICES)).toEqual({ in: 0.30, out: 2.50 });
    expect(priceFor('gemini-2.5-flash-lite', DEFAULT_AI_PRICES)).toEqual({ in: 0.10, out: 0.40 });
    expect(priceFor('mystery-model', DEFAULT_AI_PRICES)).toBeNull();
    expect(costUsd({ in: 1, out: 2 }, { in: 1_000_000, out: 500_000, think: 500_000 })).toBeCloseTo(3);
  });
});

describe('AI call log', () => {
  it('records feature, trip, model and Gemini token counts', async () => {
    expect((await (await brief()).json() as any).ai.text).toBe('• Gemini brief');
    expect(calls()).toEqual([{ feature: 'today_brief', provider: 'gemini', model: 'gemini-2.5-flash', in_tokens: 1000, out_tokens: 200, think_tokens: 300, ok: 1, fallback: 0, trip_id: 1 }]);
    expect(aiRuns).toHaveLength(0);
  });

  it('falls back to Workers AI when Gemini is rate-limited, and logs both attempts', async () => {
    gemini = '429';
    expect((await (await brief()).json() as any).ai.text).toBe('• Backup brief');
    const [first, second] = calls();
    expect(first).toMatchObject({ provider: 'gemini', ok: 0, fallback: 0 });
    expect(second).toMatchObject({ provider: 'workers-ai', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', ok: 1, fallback: 1, in_tokens: 100, out_tokens: 20 });
    expect(aiRuns[0].input.messages[0].role).toBe('system');
    expect(aiRuns[0].input.max_tokens).toBeGreaterThan(256);
  });

  it('reads OpenAI-shaped Workers AI replies too (GLM, gpt-oss)', async () => {
    gemini = '500';
    sqlite.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES ('ai_fallback',?)").run(JSON.stringify({ enabled: true, model: '@cf/zai-org/glm-4.7-flash' }));
    aiReply = { choices: [{ message: { content: '• GLM brief' } }], usage: { prompt_tokens: 50, completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 10 } } };
    expect((await (await brief()).json() as any).ai.text).toBe('• GLM brief');
    expect(calls()[1]).toMatchObject({ model: '@cf/zai-org/glm-4.7-flash', in_tokens: 50, out_tokens: 20, think_tokens: 10 });
    aiReply = { response: '• Backup brief', usage: { prompt_tokens: 100, completion_tokens: 20 } };
  });

  it('uses Workers AI alone when no primary provider is set up', async () => {
    sqlite.exec("DELETE FROM app_settings WHERE key='ai_provider'");
    expect((await (await brief()).json() as any).ai.text).toBe('• Backup brief');
    expect(calls()).toEqual([expect.objectContaining({ provider: 'workers-ai', ok: 1, fallback: 0 })]);
  });

  it('shows the primary error when the backup is off or also fails', async () => {
    gemini = '429';
    sqlite.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES ('ai_fallback',?)").run(JSON.stringify({ enabled: false, model: '@cf/x/y' }));
    expect((await brief()).status).toBe(429);
    expect(aiRuns).toHaveLength(0);
    sqlite.exec("DELETE FROM app_settings WHERE key='ai_fallback'");
    aiReply = new Error('3036: daily free allocation of neurons used up');
    const r = await brief();
    expect(r.status).toBe(429);
    expect(calls().map(c => [c.provider, c.ok])).toEqual([['gemini', 0], ['gemini', 0], ['workers-ai', 0]]);
    aiReply = { response: '• Backup brief', usage: { prompt_tokens: 100, completion_tokens: 20 } };
  });
});

describe('speed and usage knobs', () => {
  it('the Today brief skips Gemini thinking, caps output and has a deadline', async () => {
    await brief();
    expect(sent[0].body.generationConfig).toMatchObject({ maxOutputTokens: 600, thinkingConfig: { thinkingBudget: 0 } });
    expect(sent[0].signal).toBe(true);
  });

  it('uses the light model for the brief when the admin sets one', async () => {
    sqlite.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES ('ai_provider',?)").run(JSON.stringify({ ...JSON.parse(gemCfg), light_model: 'gemini-2.5-flash-lite' }));
    await brief();
    expect(sent[0].url).toContain('/models/gemini-2.5-flash-lite:generateContent');
    expect(calls()[0]).toMatchObject({ model: 'gemini-2.5-flash-lite', ok: 1 });
  });

  it('a slow Gemini call times out and the backup answers', async () => {
    gemini = 'timeout';
    expect((await (await brief()).json() as any).ai.text).toBe('• Backup brief');
    expect(calls().map(c => [c.provider, c.ok])).toEqual([['gemini', 0], ['workers-ai', 1]]);
    expect((sqlite.prepare('SELECT error FROM ai_calls ORDER BY id LIMIT 1').get() as any).error).toBe('ai_timeout');
  });

  it('Gemini 3 gets minimal thinking (3.8 Flash and Gemini 4 only go down to low)', async () => {
    const set = (m: string) => sqlite.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES ('ai_provider',?)").run(JSON.stringify({ ...JSON.parse(gemCfg), model: m, light_model: '' }));
    for (const [m, level] of [['gemini-3.6-flash', 'minimal'], ['gemini-3.5-flash-lite', 'minimal'], ['gemini-3.8-flash', 'low'], ['gemini-4-hydrogen', 'low']]) {
      set(m); sent.length = 0;
      await brief();
      expect(sent[0].body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: level });
    }
  });

  it('the admin test is tiny: 64 tokens, no thinking', async () => {
    await req('/settings/ai/test', { method: 'POST' });
    expect(sent[0].body.generationConfig).toMatchObject({ maxOutputTokens: 64, thinkingConfig: { thinkingBudget: 0 } });
  });
});

describe('admin AI usage', () => {
  it('totals calls, tokens and estimated cost by feature and model', async () => {
    await brief(); // Gemini: 1000 in, 200 out + 300 thinking
    gemini = '429';
    await brief(); // failed Gemini + Workers AI 100 in / 20 out
    const u = await (await req('/admin/ai-usage?days=7')).json() as any;
    expect(u.total).toMatchObject({ calls: 3, failed: 1, fallbacks: 1, in: 1100, out: 220, think: 300 });
    const gem = (1000 * 0.30 + 500 * 2.50) / 1e6, wai = (100 * 0.293 + 20 * 2.253) / 1e6;
    expect(u.total.cost).toBeCloseTo(gem + wai, 10);
    expect(u.features[0]).toMatchObject({ feature: 'today_brief', calls: 3 });
    expect(u.models.map((m: any) => m.model).sort()).toEqual(['@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'gemini-2.5-flash']);
    expect(u.series).toHaveLength(7);
    expect(u.failures[0]).toMatchObject({ provider: 'gemini', error: 'ai_rate_limited' });
  });

  it('custom prices change the estimate; a free-tier price of 0 means $0', async () => {
    await brief();
    const r = await req('/settings/ai-prices', { method: 'PUT', body: JSON.stringify({ prices: { 'gemini-2.5-flash': { in: 0, out: 0 } } }) });
    expect(r.status).toBe(200);
    expect(((await (await req('/admin/ai-usage?days=7')).json()) as any).total.cost).toBe(0);
    expect((await req('/settings/ai-prices', { method: 'PUT', body: JSON.stringify({ prices: { x: { in: -1, out: 0 } } }) })).status).toBe(400);
  });

  it('saves the backup model, rejecting anything that is not a Workers AI model id', async () => {
    expect((await req('/settings/ai-fallback', { method: 'PUT', body: JSON.stringify({ enabled: true, model: 'https://evil' }) })).status).toBe(400);
    const r = await (await req('/settings/ai-fallback', { method: 'PUT', body: JSON.stringify({ enabled: true, model: '@cf/google/gemma-3-12b-it' }) })).json() as any;
    expect(r).toEqual({ enabled: true, model: '@cf/google/gemma-3-12b-it', bound: true });
    const t = await (await req('/settings/ai-fallback/test', { method: 'POST' })).json() as any;
    expect(t).toMatchObject({ ok: true, model: '@cf/google/gemma-3-12b-it' });
    expect(calls().at(-1)).toMatchObject({ feature: 'admin_test', provider: 'workers-ai' });
  });
});
