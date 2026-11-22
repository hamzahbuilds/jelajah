// v0.47 multi-currency trips: a trip's home currency (trips.base_currency)
// can be BND, SGD, … instead of MYR. Covers the BND↔SGD peg (Frankfurter has
// no BND feed), the lock once money exists, MCP exposing the currency, and
// client formatting. Real SQLite behind the D1 interface, fetch mocked.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import app from '../server/app';
import { SCHEMA } from '../server/lib/schema';
import { hashToken } from '../server/lib/auth';
import { fmtMoney, fmtMYR, homeCurrency, pickCurrencies, setHomeCurrency } from '../src/api';
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

const fetched: string[] = [];
vi.stubGlobal('fetch', vi.fn(async (url: string) => {
  fetched.push(url);
  const u = new URL(url);
  if (u.pathname.endsWith('/currencies')) {
    return Response.json([{ iso_code: 'MYR', name: 'Malaysian Ringgit' }, { iso_code: 'SGD', name: 'Singapore Dollar' }, { iso_code: 'JPY', name: 'Japanese Yen' }]);
  }
  const base = u.searchParams.get('base'), sym = u.searchParams.get('symbols');
  const table: Record<string, number> = { 'SGD>MYR': 3.3, 'JPY>SGD': 0.0088, 'SGD>JPY': 113.6 };
  if (u.pathname.includes('..')) {
    return Response.json({ rates: { '2026-11-20': { JPY: 113.6 }, '2026-11-21': { JPY: 114 } } });
  }
  return Response.json({ date: '2026-11-20', rates: { [sym!]: table[`${base}>${sym}`] } });
}));

const SID = 'sid-leader';
const req = (path: string, init: RequestInit = {}) => app.request(`/api${path}`, {
  ...init, headers: { Cookie: `sid=${SID}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
}, env);

beforeAll(async () => {
  for (const s of SCHEMA) sqlite.exec(s);
  sqlite.prepare('INSERT INTO participants(id,name) VALUES (1,?)').run('Leader');
  sqlite.prepare("INSERT INTO users(id,email,name,password_hash,salt,role,participant_id) VALUES (1,'l@x','Leader','x','x','member',1)").run();
  sqlite.exec(`INSERT INTO trips(id,name,start_date,end_date,base_currency) VALUES (1,'Brunei crew','2026-12-01','2026-12-05','BND'),(2,'Empty','2026-12-01','2026-12-05','MYR');
    INSERT INTO trip_members(trip_id,participant_id,role) VALUES (1,1,'leader'),(2,1,'leader');`);
  sqlite.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,1,?)').run(SID, '2099-01-01 00:00:00');
  sqlite.prepare("INSERT OR REPLACE INTO app_settings(key,value) VALUES (?,?)").run('data_migrations', JSON.stringify(['m001-trip-roles']));
  sqlite.prepare('INSERT INTO api_tokens(user_id,name,token_hash) VALUES (1,?,?)').run('t', await hashToken('tok'));
  sqlite.exec(`INSERT INTO expenses(trip_id,category,description,amount_original,currency,fx_rate,amount_myr,payer_participant_id)
    VALUES (1,'food','Nasi katok',5,'BND',1,5,1)`);
  // Trip 3: a MYR trip with money in it, converted to SGD below.
  sqlite.exec(`INSERT INTO participants(id,name) VALUES (2,'B'),(3,'C');
    INSERT INTO trips(id,name,base_currency) VALUES (3,'KL then SG','MYR');
    INSERT INTO trip_members(trip_id,participant_id,role) VALUES (3,1,'leader'),(3,2,'viewer'),(3,3,'viewer');
    INSERT INTO expenses(id,trip_id,category,description,amount_original,currency,fx_rate,amount_myr,payer_participant_id)
      VALUES (31,3,'food','Dinner',100,'MYR',1,100,1),(32,3,'entrance','Zoo',50,'SGD',3.3,165,1);
    INSERT INTO expense_shares(expense_id,participant_id,amount_myr) VALUES (31,1,33.34),(31,2,33.33),(31,3,33.33),(32,1,82.5),(32,2,82.5);
    INSERT INTO due_dates(expense_id,due_date,amount_myr) VALUES (31,'2026-12-01',40);
    INSERT INTO payments(trip_id,from_participant_id,to_participant_id,amount_myr,pay_date) VALUES (3,2,1,20,'2026-12-02');
    INSERT INTO activities(trip_id,title,day,est_cost_myr) VALUES (3,'Tea','2026-12-01',10);
    INSERT INTO trips(id,name,base_currency) VALUES (4,'Japan','MYR');
    INSERT INTO trip_members(trip_id,participant_id,role) VALUES (4,1,'leader');
    INSERT INTO expenses(trip_id,category,description,amount_original,currency,fx_rate,amount_myr,payer_participant_id)
      VALUES (4,'food','Ramen',1000,'JPY',0.03,30,1);`);
});

describe('BND pricing through the SGD peg', () => {
  it('offers BND in the currency list although the feed has none', async () => {
    const list = await (await req('/currencies')).json() as any[];
    expect(list.map(c => c.code)).toContain('BND');
  });
  it('BND↔SGD is par without calling the feed', async () => {
    fetched.length = 0;
    const r = await (await req('/fx?date=2026-11-20&from=SGD&to=BND')).json() as any;
    expect(r).toMatchObject({ rate: 1, source: 'peg' });
    expect(fetched).toHaveLength(0);
  });
  it('JPY→BND is fetched as JPY→SGD', async () => {
    fetched.length = 0;
    const r = await (await req('/fx?date=2026-11-20&from=JPY&to=BND')).json() as any;
    expect(r.rate).toBeCloseTo(0.0088);
    expect(fetched[0]).toContain('base=JPY&symbols=SGD');
  });
  it('the forex widget stores a BND-based series fetched from SGD', async () => {
    sqlite.exec(`UPDATE trips SET watch_currencies='["JPY"]' WHERE id=1`);
    const r = await (await req('/trips/1/fxseries?quote=JPY&window=1m')).json() as any;
    expect(r.base).toBe('BND');
    expect(r.current.rate).toBe(114);
    expect(fetched.some(u => u.includes('base=SGD&symbols=JPY'))).toBe(true);
  });
});

describe('multi-currency switch', () => {
  it('the one-time migration turns it on only for trips already using other currencies', () => {
    const on = (id: number) => (sqlite.prepare('SELECT multi_currency AS m FROM trips WHERE id = ?').get(id) as any).m;
    expect(on(4)).toBe(1); // MYR trip with a JPY expense
    expect(on(3)).toBe(1); // MYR trip with an SGD expense
    expect(on(1)).toBe(0); // BND trip, BND money only
    expect(on(2)).toBe(0); // no money at all
  });
  it('the leader can flip it, and new trips start in basic mode', async () => {
    expect((await req('/trips/2', { method: 'PATCH', body: JSON.stringify({ multi_currency: true }) })).status).toBe(200);
    expect((await (await req('/trips/2')).json() as any).trip.multi_currency).toBe(1);
    await req('/trips/2', { method: 'PATCH', body: JSON.stringify({ multi_currency: false }) });
    expect((await (await req('/trips/2')).json() as any).trip.multi_currency).toBe(0);
    const made = await (await req('/trips', { method: 'POST', body: JSON.stringify({ name: 'Basic', base_currency: 'BND', watch_currencies: ['JPY'] }) })).json() as any;
    const row: any = sqlite.prepare('SELECT base_currency, multi_currency, watch_currencies FROM trips WHERE id = ?').get(made.id ?? made.trip?.id);
    expect(row).toMatchObject({ base_currency: 'BND', multi_currency: 0, watch_currencies: '[]' });
  });
});

describe('changing the trip currency after money exists', () => {
  it('reports money_locked and asks for explicit conversion', async () => {
    const t = await (await req('/trips/1')).json() as any;
    expect(t.trip).toMatchObject({ base_currency: 'BND', money_locked: true });
    const res = await req('/trips/1/currencies', { method: 'PATCH', body: JSON.stringify({ base_currency: 'MYR' }) });
    expect(res.status).toBe(409);
    expect((await res.json() as any).error).toBe('needs_conversion');
  });
  it('still lets the watch list change without conversion', async () => {
    const res = await req('/trips/1/currencies', { method: 'PATCH', body: JSON.stringify({ base_currency: 'BND', watch_currencies: ['JPY', 'MYR'] }) });
    expect(res.status).toBe(200);
  });
  it('an empty trip can switch to SGD or BND freely', async () => {
    expect((await (await req('/trips/2')).json() as any).trip.money_locked).toBe(false);
    for (const code of ['SGD', 'BND']) {
      const res = await req('/trips/2/currencies', { method: 'PATCH', body: JSON.stringify({ base_currency: code }) });
      expect(res.status).toBe(200);
    }
  });
  it('converts every amount, keeps shares adding up, and restores exact amounts paid in the new currency', async () => {
    const res = await req('/trips/3/currencies', { method: 'PATCH', body: JSON.stringify({ base_currency: 'SGD', convert: true, rate: 0.3 }) });
    expect(res.status).toBe(200);
    expect((await res.json() as any).converted).toEqual({ from: 'MYR', to: 'SGD', rate: 0.3 });
    const exp = (id: number) => sqlite.prepare('SELECT amount_myr, fx_rate FROM expenses WHERE id = ?').get(id) as any;
    const shares = (id: number) => (sqlite.prepare('SELECT amount_myr FROM expense_shares WHERE expense_id = ? ORDER BY participant_id').all(id) as any[]).map(r => r.amount_myr);
    expect(exp(31)).toMatchObject({ amount_myr: 30, fx_rate: 0.3 });
    expect(shares(31)).toEqual([10, 10, 10]);
    expect(exp(32)).toMatchObject({ amount_myr: 50, fx_rate: 1 }); // paid in SGD: exact
    expect(shares(32)).toEqual([25, 25]);
    const one = (sql: string) => (sqlite.prepare(sql).get() as any).v;
    expect(one('SELECT amount_myr AS v FROM due_dates WHERE expense_id = 31')).toBe(12);
    expect(one('SELECT amount_myr AS v FROM payments WHERE trip_id = 3')).toBe(6);
    expect(one('SELECT est_cost_myr AS v FROM activities WHERE trip_id = 3')).toBe(3);
    expect(one('SELECT base_currency AS v FROM trips WHERE id = 3')).toBe('SGD');
  });
});

describe('MCP exposes the trip currency', () => {
  const call = async (name: string, args: any) => {
    const res = await app.request('/api/mcp', {
      method: 'POST', headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    }, env);
    return JSON.parse(((await res.json()) as any).result.content[0].text);
  };
  it('list_trips and get_balances carry currency', async () => {
    const { trips } = await call('list_trips', {});
    expect(trips.find((t: any) => t.id === 1).currency).toBe('BND');
    const b = await call('get_balances', { trip_id: 1 });
    expect(b).toMatchObject({ currency: 'BND', trip_total_myr: 5 });
  });
});

describe('client formatting follows the open trip', () => {
  it('formats in the home currency and never shows a bare $ for BND/SGD', () => {
    setHomeCurrency('BND');
    expect(homeCurrency()).toBe('BND');
    expect(fmtMYR(12.5)).toBe('B$12.50');
    expect(fmtMoney(-3, 'SGD')).toBe('-S$3.00');
    expect(pickCurrencies()[0]).toBe('BND');
    setHomeCurrency(null);
    expect(fmtMYR(1)).toMatch(/RM/);
  });
});
