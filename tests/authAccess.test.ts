// v0.33 account access without email (docs/21): admin sign-in links and
// Sign in with Google, against real SQLite with Google mocked at fetch.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import app from '../server/app';
import { SCHEMA } from '../server/lib/schema';
import { checkIdToken, decodeState, encodeState, safeNext, jwtPayload } from '../server/lib/google';
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
const CLIENT = 'client-123.apps.googleusercontent.com';
const env: Env = { DB: db, FILES: {} as KVNamespace, GOOGLE_CLIENT_ID: CLIENT, GOOGLE_CLIENT_SECRET: 'shh' };
const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;
const BASE = 'https://jelajah.test';

const noGoogle: Env = { ...env, GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined };
let cur: Env = env;
const call = (path: string, init: RequestInit & { cookie?: string } = {}) => app.request(`${BASE}/api${path}`, {
  ...init, redirect: 'manual',
  headers: { ...(init.cookie ? { Cookie: init.cookie } : {}), ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
}, cur, ctx);
const admin = (path: string, method = 'GET', body?: unknown) =>
  call(path, { method, cookie: 'sid=session-1', body: body ? JSON.stringify(body) : undefined });

const INVITE = 'inv_' + 'a'.repeat(32);
const TRIP_INVITE = 'inv_' + 'b'.repeat(32);

beforeAll(() => {
  for (const s of SCHEMA) sqlite.exec(s);
  sqlite.prepare('INSERT INTO users(id,email,name,password_hash,salt,role) VALUES (1,?,?,?,?,?)').run('admin@example.test', 'Admin', 'x', 'y', 'admin');
  sqlite.prepare('INSERT INTO users(id,email,name,password_hash,salt,role) VALUES (2,?,?,?,?,?)').run('aina@gmail.com', 'Aina', 'x', 'y', 'member');
  sqlite.prepare('INSERT INTO users(id,email,name,password_hash,salt,role,disabled) VALUES (3,?,?,?,?,?,1)').run('gone@gmail.com', 'Gone', 'x', 'y', 'member');
  sqlite.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run('session-1', 1, '2099-01-01');
  sqlite.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES (?,?,?)').run('session-2', 2, '2099-01-01');
  sqlite.exec(`INSERT INTO trips(id,name,destination,start_date,end_date) VALUES (1,'Tokyo','Tokyo','2026-12-01','2026-12-05')`);
  sqlite.prepare(`INSERT INTO invites(code,kind,created_by,expires_at,max_uses) VALUES (?,'platform',1,NULL,5)`).run(INVITE);
  sqlite.prepare(`INSERT INTO invites(code,kind,trip_id,role,created_by,expires_at,max_uses) VALUES (?,'trip',1,'editor',1,NULL,5)`).run(TRIP_INVITE);
  sqlite.prepare('INSERT OR REPLACE INTO app_settings(key,value) VALUES (?,?)').run('data_migrations', JSON.stringify(['m001-trip-roles']));
});
afterEach(() => vi.unstubAllGlobals());

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims: Record<string, unknown>) => `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;

/** Run start → (Google) → callback. `claims` override the ID token Google returns. */
async function googleFlow(claims: Record<string, unknown>, query = '') {
  const start = await call(`/auth/google/start${query}`);
  expect(start.status).toBe(302);
  const to = new URL(start.headers.get('location')!);
  const cookie = start.headers.get('set-cookie')!.split(';')[0];
  const tokenCalls: URLSearchParams[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    expect(String(input)).toBe('https://oauth2.googleapis.com/token');
    tokenCalls.push(new URLSearchParams(String(init.body)));
    return Response.json({ id_token: idToken({
      iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600,
      nonce: to.searchParams.get('nonce'), email_verified: true, ...claims,
    }) });
  }));
  const cb = await call(`/auth/google/callback?code=abc&state=${to.searchParams.get('state')}`, { cookie });
  return { start: to, cb, tokenCalls, location: cb.headers.get('location') ?? '', cookies: cb.headers.getSetCookie?.() ?? [cb.headers.get('set-cookie') ?? ''] };
}

describe('google helpers', () => {
  it('safeNext keeps same-site paths only', () => {
    expect(safeNext('/trips/3?x=1')).toBe('/trips/3?x=1');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'trips', undefined]) expect(safeNext(bad)).toBe('/');
  });
  it('state round-trips and rejects junk', () => {
    const s = { state: 'a', verifier: 'b', nonce: 'c', next: '/x', invite: '' };
    expect(decodeState(encodeState(s))).toEqual(s);
    expect(decodeState('not-base64!')).toBeNull();
  });
  it('checkIdToken refuses wrong audience, nonce, expiry and unverified email', () => {
    const ok = { iss: 'accounts.google.com', aud: CLIENT, exp: 2e9, nonce: 'n', sub: '1', email: 'A@Gmail.com', email_verified: true, name: 'A' };
    expect(checkIdToken(ok, { clientId: CLIENT, nonce: 'n', now: 1e9 })).toEqual({ sub: '1', email: 'a@gmail.com', name: 'A' });
    expect(checkIdToken({ ...ok, aud: 'other' }, { clientId: CLIENT, nonce: 'n', now: 1e9 })).toEqual({ error: 'bad_audience' });
    expect(checkIdToken({ ...ok, nonce: 'x' }, { clientId: CLIENT, nonce: 'n', now: 1e9 })).toEqual({ error: 'bad_nonce' });
    expect(checkIdToken({ ...ok, exp: 1 }, { clientId: CLIENT, nonce: 'n', now: 1e9 })).toEqual({ error: 'expired' });
    expect(checkIdToken({ ...ok, email_verified: false }, { clientId: CLIENT, nonce: 'n', now: 1e9 })).toEqual({ error: 'email_unverified' });
    expect(jwtPayload('a.' + b64({ x: 1 }) + '.c')).toEqual({ x: 1 });
  });
});

describe('Sign in with Google', () => {
  it('providers is public and reports Google', async () => {
    expect(await (await call('/auth/providers')).json()).toEqual({ google: true, password: false });
  });

  it('start sends PKCE, nonce and a short-lived state cookie', async () => {
    const r = await call('/auth/google/start?next=/trips/1');
    const to = new URL(r.headers.get('location')!);
    expect(to.origin + to.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
    expect(to.searchParams.get('redirect_uri')).toBe(`${BASE}/api/auth/google/callback`);
    expect(r.headers.get('set-cookie')).toMatch(/g_oauth=.+HttpOnly; Secure; SameSite=Lax; Path=\/api\/auth\/google; Max-Age=600/);
  });

  it('links an existing account by verified email and signs in', async () => {
    const f = await googleFlow({ sub: 'g-aina', email: 'Aina@gmail.com', name: 'Aina G' }, '?next=/trips/1');
    expect(f.cb.status).toBe(302);
    expect(f.location).toBe('/trips/1');
    expect(f.cookies.join('\n')).toMatch(/sid=[0-9a-f]{64}/);
    expect(f.tokenCalls[0].get('code_verifier')).toBeTruthy();
    expect(sqlite.prepare('SELECT google_sub FROM users WHERE id=2').get()).toEqual({ google_sub: 'g-aina' });
    // Next time the Google id alone is enough, even if the Gmail address changed.
    const again = await googleFlow({ sub: 'g-aina', email: 'aina.new@gmail.com' });
    expect(again.location).toBe('/');
  });

  it('refuses a state mismatch, disabled users, and strangers without an invite', async () => {
    const start = await call('/auth/google/start');
    const cookie = start.headers.get('set-cookie')!.split(';')[0];
    const forged = await call('/auth/google/callback?code=abc&state=forged', { cookie });
    expect(forged.headers.get('location')).toBe('/login?google=failed');
    expect((await googleFlow({ sub: 'g-gone', email: 'gone@gmail.com' })).location).toBe('/login?google=disabled');
    expect((await googleFlow({ sub: 'g-new', email: 'stranger@gmail.com' })).location).toBe('/login?google=no_account');
    expect((await googleFlow({ sub: 'g-x', email: 'x@gmail.com', email_verified: false })).location).toBe('/login?google=unverified');
  });

  it('signs a new person up through an invite', async () => {
    const f = await googleFlow({ sub: 'g-ben', email: 'ben@gmail.com', name: 'Ben' }, `?invite=${INVITE}`);
    expect(f.location).toBe('/');
    const u: any = sqlite.prepare("SELECT name, google_sub, referred_by, must_change_password FROM users WHERE email='ben@gmail.com'").get();
    expect(u).toEqual({ name: 'Ben', google_sub: 'g-ben', referred_by: 1, must_change_password: 0 });
    expect(sqlite.prepare('SELECT used_count FROM invites WHERE code=?').get(INVITE)).toEqual({ used_count: 1 });
  });

  it('a trip invite puts the person on the trip (new or existing account)', async () => {
    const f = await googleFlow({ sub: 'g-cara', email: 'cara@gmail.com', name: 'Cara' }, `?invite=${TRIP_INVITE}`);
    expect(f.location).toBe('/trips/1');
    const member: any = sqlite.prepare(`SELECT tm.role FROM trip_members tm JOIN users u ON u.participant_id = tm.participant_id WHERE u.email='cara@gmail.com' AND tm.trip_id=1`).get();
    expect(member).toEqual({ role: 'editor' });
    const existing = await googleFlow({ sub: 'g-aina', email: 'aina@gmail.com' }, `?invite=${TRIP_INVITE}`);
    expect(existing.location).toBe('/trips/1');
    expect(sqlite.prepare('SELECT used_count FROM invites WHERE code=?').get(TRIP_INVITE)).toEqual({ used_count: 2 });
  });

  it('a failed invite sign-up returns to the invite page', async () => {
    const f = await googleFlow({ sub: 'g-dan', email: 'dan@gmail.com', email_verified: false }, `?invite=${INVITE}`);
    expect(f.location).toBe(`/join/${INVITE}?google=unverified`);
  });

  it('is off without a client id', async () => {
    const off = { ...env, GOOGLE_CLIENT_ID: undefined };
    const r = await app.request(`${BASE}/api/auth/google/start`, { redirect: 'manual' }, off, ctx);
    expect(r.headers.get('location')).toBe('/login?google=unavailable');
    expect(await (await app.request(`${BASE}/api/auth/providers`, {}, off, ctx)).json()).toEqual({ google: false, password: true });
  });
});

describe('Google only (v0.34)', () => {
  it('refuses password login, password sign-up and sign-in links while Google is on', async () => {
    const login = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'aina@gmail.com', password: 'whatever-pass' }) });
    expect(login.status).toBe(403);
    expect(login.headers.get('set-cookie')).toBeNull();
    const join = await call(`/join/${INVITE}`, { method: 'POST', body: JSON.stringify({ name: 'Eve', email: 'eve@example.test', password: 'long-enough-pass' }) });
    expect(join.status).toBe(403);
    expect(sqlite.prepare('SELECT 1 FROM users WHERE email=?').get('eve@example.test')).toBeUndefined();
    expect((await admin('/users/2/access-link', 'POST')).status).toBe(409);
  });
});

describe('admin sign-in links (password fallback, Google off)', () => {
  beforeAll(() => { cur = noGoogle; });
  afterAll(() => { cur = env; });
  it('admin creates a user without a password, makes a link, and the link sets the password', async () => {
    const created = await (await admin('/users', 'POST', { name: 'Dina', email: 'dina@example.test' })).json() as any;
    const link = await (await admin(`/users/${created.id}/access-link`, 'POST')).json() as any;
    expect(link.url).toMatch(/^\/reset-password#[0-9a-f]{64}$/);
    expect(new Date(link.expires_at).getTime() - Date.now()).toBeGreaterThan(71 * 3600 * 1000);
    const token = link.url.split('#')[1];
    const used = await call('/journey/recovery/reset', { method: 'POST', body: JSON.stringify({ token, password: 'brand-new-pass' }) });
    expect(used.status).toBe(200);
    const login = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email: 'dina@example.test', password: 'brand-new-pass' }) });
    expect(login.status).toBe(200);
    // One use only.
    const again = await call('/journey/recovery/reset', { method: 'POST', body: JSON.stringify({ token, password: 'another-pass' }) });
    expect(again.status).toBe(400);
  });

  it('only admins can make links; disabled users cannot get one', async () => {
    expect((await call('/users/2/access-link', { method: 'POST', cookie: 'sid=session-2' })).status).toBe(403);
    expect((await admin('/users/3/access-link', 'POST')).status).toBe(409);
    expect((await admin('/users/999/access-link', 'POST')).status).toBe(404);
  });
});

describe('onboarding flags (v0.35)', () => {
  const me = async (cookie: string) => ((await (await call('/me', { cookie })).json()) as any).user.onboarding;

  it('existing accounts get no welcome tour; new Google sign-ups do', async () => {
    expect(await me('sid=session-2')).toEqual({ welcome: false, skip_plan_intro: false });
    expect(sqlite.prepare("SELECT welcome_pending FROM users WHERE email='ben@gmail.com'").get()).toEqual({ welcome_pending: 1 });
  });

  it('admin-created accounts get the tour and, with Google on, no password nudge', async () => {
    const created = await (await admin('/users', 'POST', { name: 'Fara', email: 'fara@gmail.com' })).json() as any;
    expect(sqlite.prepare('SELECT welcome_pending, must_change_password FROM users WHERE id=?').get(created.id))
      .toEqual({ welcome_pending: 1, must_change_password: 0 });
  });

  it('PATCH /me clears the tour and saves "don\'t show the plan intro again"', async () => {
    sqlite.prepare('UPDATE users SET welcome_pending=1 WHERE id=2').run();
    expect((await me('sid=session-2')).welcome).toBe(true);
    const patch = (body: unknown) => call('/me', { method: 'PATCH', cookie: 'sid=session-2', body: JSON.stringify(body) });
    expect((await patch({ welcome_done: true })).status).toBe(200);
    expect((await patch({ skip_plan_intro: true })).status).toBe(200);
    expect(await me('sid=session-2')).toEqual({ welcome: false, skip_plan_intro: true });
    await patch({ skip_plan_intro: false });
    expect((await me('sid=session-2')).skip_plan_intro).toBe(false);
  });
});
