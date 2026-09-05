import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from './env.d';
import {
  hashPassword, verifyPassword, createSession, getSessionUser,
  destroySession, sessionCookie, clearCookie, randomToken, hashToken, SessionUser,
} from './lib/auth';
import { parseSuggestions, freeSlots, suggestSystemPrompt, chatSystemPrompt, buildGeminiNativeBody, parseGeminiNativeResponse } from '../shared/assistant';
import { SCHEMA, UPGRADES, JAPAN_TRIP } from './lib/schema';
import { migratedRole, TripRole, atLeast } from './lib/roles';
import { FX_WINDOWS, FxWindow, analyzeRates } from '../shared/fxband';
import { checkInvite, newInviteCode } from '../shared/invites';

type Vars = { user: SessionUser };
const app = new Hono<{ Bindings: Env; Variables: Vars }>().basePath('/api');

const bad = (c: any, msg: string, status = 400) => c.json({ error: msg }, status);

/* ---- file storage adapter: works with either Workers KV (free, no card) or R2 ---- */
const isKV = (s: any): boolean => typeof s.getWithMetadata === 'function';

async function filesPut(env: Env, key: string, buf: ArrayBuffer, contentType: string) {
  const s: any = env.FILES;
  if (isKV(s)) await s.put(key, buf, { metadata: { contentType } });
  else await s.put(key, buf, { httpMetadata: { contentType } });
}
async function filesGet(env: Env, key: string): Promise<ReadableStream | null> {
  const s: any = env.FILES;
  if (isKV(s)) return await s.get(key, 'stream');
  const obj = await s.get(key);
  return obj ? obj.body : null;
}
async function filesDelete(env: Env, key: string) {
  await (env.FILES as any).delete(key);
}

async function audit(env: Env, userId: number | null, action: string, entity?: string, entityId?: number) {
  try {
    await env.DB.prepare('INSERT INTO audit_log (user_id, action, entity, entity_id) VALUES (?,?,?,?)')
      .bind(userId, action, entity ?? null, entityId ?? null).run();
  } catch { /* audit is best-effort */ }
}

async function trackUsage(env: Env, userId: number, feature: string): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO usage_daily (day, user_id, feature, count) VALUES (date('now'), ?, ?, 1)
       ON CONFLICT(day, user_id, feature) DO UPDATE SET count = count + 1`
    ).bind(userId, feature).run();
  } catch { /* tracking is best-effort */ }
}

async function getSettingJSON<T>(env: Env, key: string): Promise<T | null> {
  const row = await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first<any>();
  if (!row) return null;
  try { return JSON.parse(row.value) as T; } catch { return null; }
}
async function setSettingJSON(env: Env, key: string, value: unknown) {
  await env.DB.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, JSON.stringify(value)).run();
}

/** One-time data migrations — run exactly once per deploy, recorded in app_settings.
 *  UPGRADES cannot hold these: its statements re-run on every cold isolate. */
async function runDataMigrations(env: Env): Promise<void> {
  const applied: string[] = (await getSettingJSON<string[]>(env, 'data_migrations')) ?? [];
  if (!applied.includes('m001-trip-roles')) {
    const rows = await env.DB.prepare(
      `SELECT tm.trip_id, tm.participant_id, t.member_can_edit_plan,
              u.id AS user_id, u.role AS user_role
       FROM trip_members tm
       JOIN trips t ON t.id = tm.trip_id
       LEFT JOIN users u ON u.participant_id = tm.participant_id`,
    ).all();
    const stmts = (rows.results as any[]).map(r => env.DB.prepare(
      'UPDATE trip_members SET role = ? WHERE trip_id = ? AND participant_id = ?',
    ).bind(migratedRole({
      isAdminUser: r.user_role === 'admin',
      hasAccount: r.user_id != null,
      memberCanEditPlan: !!r.member_can_edit_plan,
    }), r.trip_id, r.participant_id));
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
    applied.push('m001-trip-roles');
    await setSettingJSON(env, 'data_migrations', applied);
  }
}

/* ---- lazy schema upgrades: idempotent, once per isolate ---- */
let upgraded = false;
app.use('*', async (c, next) => {
  if (!upgraded) {
    upgraded = true;
    for (const s of UPGRADES) {
      try { await c.env.DB.prepare(s).run(); } catch { /* already applied */ }
    }
    try {
      await runDataMigrations(c.env);
    } catch (e) {
      await audit(c.env, null, 'data_migration_failed', undefined, undefined);
    }
  }
  return next();
});

/* ---------------- first-run setup (no CLI needed) ---------------- */

async function setupNeeded(env: Env): Promise<boolean> {
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<any>();
    return !row || row.n === 0;
  } catch {
    return true; // tables don't exist yet
  }
}

app.get('/setup/status', async c => c.json({ needed: await setupNeeded(c.env) }));

app.post('/setup', async c => {
  if (!(await setupNeeded(c.env))) return bad(c, 'already_set_up', 403);
  const { name, email, password, seedJapanTrip } = await c.req.json<any>();
  if (!name?.trim() || !email?.trim() || !password || password.length < 8) return bad(c, 'missing_fields');
  // create all tables, then the admin account (and optionally the Japan trip)
  await c.env.DB.batch(SCHEMA.map(s => c.env.DB.prepare(s)));
  const { hash, salt } = await hashPassword(password);
  await c.env.DB.prepare(
    `INSERT INTO users (email, name, password_hash, salt, role) VALUES (?,?,?,?,'admin')`,
  ).bind(email.trim().toLowerCase(), name.trim(), hash, salt).run();
  if (seedJapanTrip) {
    const tr = await c.env.DB.prepare(
      'INSERT INTO trips (name, destination, start_date, end_date, emoji) VALUES (?,?,?,?,?)',
    ).bind(JAPAN_TRIP.name, JAPAN_TRIP.destination, JAPAN_TRIP.start_date, JAPAN_TRIP.end_date, JAPAN_TRIP.emoji).run();
    const tripId = Number(tr.meta.last_row_id);
    for (const [pname, infant] of JAPAN_TRIP.participants) {
      const p = await c.env.DB.prepare('INSERT INTO participants (name, is_infant) VALUES (?,?)')
        .bind(pname, infant).run();
      await c.env.DB.prepare('INSERT INTO trip_members (trip_id, participant_id) VALUES (?,?)')
        .bind(tripId, Number(p.meta.last_row_id)).run();
    }
  }
  const u = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email.trim().toLowerCase()).first<any>();
  const token = await createSession(c.env, u.id);
  await audit(c.env, u.id, 'setup');
  c.header('Set-Cookie', sessionCookie(token));
  return c.json({ ok: true });
});

/* ---------------- auth ---------------- */

app.post('/auth/login', async c => {
  const { email, password } = await c.req.json<{ email: string; password: string }>();
  if (!email || !password) return bad(c, 'missing_credentials');
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE email = ? AND disabled = 0')
    .bind(email.trim().toLowerCase()).first<any>();
  if (!u || !(await verifyPassword(password, u.salt, u.password_hash))) {
    return bad(c, 'invalid_login', 401);
  }
  const token = await createSession(c.env, u.id);
  await audit(c.env, u.id, 'login');
  await trackUsage(c.env, u.id, 'login');
  c.header('Set-Cookie', sessionCookie(token));
  return c.json({ ok: true });
});

app.post('/auth/logout', async c => {
  const sid = getCookie(c, 'sid');
  if (sid) await destroySession(c.env, sid);
  c.header('Set-Cookie', clearCookie());
  return c.json({ ok: true });
});

/* ------------- auth middleware ------------- */

app.use('*', async (c, next) => {
  if (c.req.path === '/api/auth/login' || c.req.path === '/api/health'
    || c.req.path.startsWith('/api/setup')
    || (c.req.path.startsWith('/api/join/') && c.req.method === 'GET')
    || (c.req.path.startsWith('/api/join/') && c.req.method === 'POST' && !c.req.path.endsWith('/accept'))) return next();
  if (c.req.path.startsWith('/api/mcp')) return next(); // MCP authenticates with its own token (header or path)
  const user = await getSessionUser(c.env, getCookie(c, 'sid'));
  if (!user) return bad(c, 'unauthorized', 401);
  c.set('user', user);
  return next();
});

const requireAdmin = async (c: any, next: any) => {
  if (c.get('user').role !== 'admin') return bad(c, 'forbidden', 403);
  return next();
};

/** Effective role of this user on this trip. Platform admin ⇒ leader everywhere. */
async function tripRole(env: Env, user: SessionUser, tripId: number): Promise<TripRole | null> {
  if (user.role === 'admin') return 'leader';
  if (!user.participant_id) return null;
  const row = await env.DB.prepare(
    'SELECT role FROM trip_members WHERE trip_id = ? AND participant_id = ?',
  ).bind(tripId, user.participant_id).first<any>();
  return (row?.role as TripRole) ?? null;
}

async function needRole(c: any, tripId: number, min: TripRole): Promise<boolean> {
  return atLeast(await tripRole(c.env, c.get('user'), tripId), min);
}

const requireRole = (min: TripRole) => async (c: any, next: any) => {
  if (!(await needRole(c, Number(c.req.param('id')), min))) return bad(c, 'forbidden', 403);
  return next();
};
const requireLeader = requireRole('leader');
const requireEditor = requireRole('editor');

/** Features the admin hid from members on this trip ('documents','ledger','payments','plan'). Leaders see everything. */
async function hiddenFor(c: any, tripId: number): Promise<Set<string>> {
  if (atLeast(await tripRole(c.env, c.get('user'), tripId), 'leader')) return new Set();
  const t: any = await c.env.DB.prepare('SELECT hidden_features FROM trips WHERE id = ?').bind(tripId).first();
  try { return new Set(JSON.parse(t?.hidden_features ?? '[]')); } catch { return new Set(); }
}

async function assertTripAccess(c: any, tripId: number): Promise<boolean> {
  const user: SessionUser = c.get('user');
  if (user.role === 'admin') return true;
  if (!user.participant_id) return false;
  const row = await c.env.DB.prepare(
    'SELECT 1 FROM trip_members WHERE trip_id = ? AND participant_id = ?',
  ).bind(tripId, user.participant_id).first();
  return !!row;
}

app.get('/health', c => c.json({ ok: true, at: new Date().toISOString() }));

/* ---------------- me ---------------- */

app.get('/me', async c => {
  const user = c.get('user');
  const trips = user.role === 'admin'
    ? await c.env.DB.prepare(`SELECT *, 'leader' AS my_role FROM trips ORDER BY start_date DESC`).all()
    : await c.env.DB.prepare(
        `SELECT t.*, tm.role AS my_role FROM trips t JOIN trip_members tm ON tm.trip_id = t.id
         WHERE tm.participant_id = ? ORDER BY t.start_date DESC`,
      ).bind(user.participant_id).all();
  const userPayload = user.role === 'admin' ? { ...user, platform_admin: true } : user;
  return c.json({ user: userPayload, trips: trips.results });
});

app.patch('/me', async c => {
  const user = c.get('user');
  const body = await c.req.json<any>();
  if (body.lang === 'en' || body.lang === 'ms') {
    await c.env.DB.prepare('UPDATE users SET lang = ? WHERE id = ?').bind(body.lang, user.id).run();
  }
  if (typeof body.newPassword === 'string' && body.newPassword.length >= 8) {
    const { hash, salt } = await hashPassword(body.newPassword);
    await c.env.DB.prepare(
      'UPDATE users SET password_hash = ?, salt = ?, must_change_password = 0 WHERE id = ?',
    ).bind(hash, salt, user.id).run();
  }
  return c.json({ ok: true });
});

/* ---------------- users & participants ---------------- */

/** Does this user lead at least one trip? Platform admin trivially does. */
async function leadsAnyTrip(env: Env, user: SessionUser): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (!user.participant_id) return false;
  const row = await env.DB.prepare(
    "SELECT 1 FROM trip_members WHERE participant_id = ? AND role = 'leader'",
  ).bind(user.participant_id).first();
  return !!row;
}

// Global participant directory: platform admin sees every participant;
// a trip leader sees participants of the trips they lead. Members without
// a led trip never reach this — the member list they need comes from
// GET /trips/:id instead.
app.get('/participants', async c => {
  const user: SessionUser = c.get('user');
  if (user.role === 'admin') {
    const rows = await c.env.DB.prepare('SELECT * FROM participants ORDER BY name').all();
    return c.json(rows.results);
  }
  if (!(await leadsAnyTrip(c.env, user))) return bad(c, 'forbidden', 403);
  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT p.* FROM participants p JOIN trip_members m ON m.participant_id = p.id
     WHERE m.trip_id IN (SELECT trip_id FROM trip_members WHERE participant_id = ? AND role = 'leader')
     ORDER BY p.name`,
  ).bind(user.participant_id).all();
  return c.json(rows.results);
});

app.post('/participants', async c => {
  const user: SessionUser = c.get('user');
  if (!(await leadsAnyTrip(c.env, user))) return bad(c, 'forbidden', 403);
  const { name, is_infant } = await c.req.json<any>();
  if (!name?.trim()) return bad(c, 'name_required');
  const r = await c.env.DB.prepare('INSERT INTO participants (name, is_infant) VALUES (?,?)')
    .bind(name.trim(), is_infant ? 1 : 0).run();
  return c.json({ id: r.meta.last_row_id });
});

app.patch('/participants/:id', async c => {
  const user: SessionUser = c.get('user');
  const pid = Number(c.req.param('id'));
  if (user.role !== 'admin') {
    const row = await c.env.DB.prepare(
      `SELECT 1 FROM trip_members tm JOIN trip_members lm ON lm.trip_id = tm.trip_id
       WHERE tm.participant_id = ? AND lm.participant_id = ? AND lm.role = 'leader'`,
    ).bind(pid, user.participant_id).first();
    if (!row) return bad(c, 'forbidden', 403);
  }
  const { name, is_infant } = await c.req.json<any>();
  await c.env.DB.prepare('UPDATE participants SET name = COALESCE(?, name), is_infant = COALESCE(?, is_infant) WHERE id = ?')
    .bind(name ?? null, is_infant ?? null, pid).run();
  return c.json({ ok: true });
});

app.get('/users', requireAdmin, async c => {
  const rows = await c.env.DB.prepare(
    'SELECT id, email, name, role, lang, participant_id, disabled, must_change_password, created_at, referred_by FROM users ORDER BY name',
  ).all();
  return c.json(rows.results);
});

app.post('/users', requireAdmin, async c => {
  const { name, email, password, role, participant_id } = await c.req.json<any>();
  if (!name || !email || !password) return bad(c, 'missing_fields');
  const { hash, salt } = await hashPassword(password);
  try {
    const r = await c.env.DB.prepare(
      `INSERT INTO users (email, name, password_hash, salt, role, participant_id, must_change_password)
       VALUES (?,?,?,?,?,?,1)`,
    ).bind(email.trim().toLowerCase(), name.trim(), hash, salt, role === 'admin' ? 'admin' : 'member', participant_id ?? null).run();
    return c.json({ id: r.meta.last_row_id });
  } catch {
    return bad(c, 'email_exists', 409);
  }
});

app.patch('/users/:id', requireAdmin, async c => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<any>();
  if (typeof body.disabled === 'boolean') {
    await c.env.DB.prepare('UPDATE users SET disabled = ? WHERE id = ?').bind(body.disabled ? 1 : 0, id).run();
    if (body.disabled) await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  }
  if (typeof body.resetPassword === 'string' && body.resetPassword.length >= 8) {
    const { hash, salt } = await hashPassword(body.resetPassword);
    await c.env.DB.prepare(
      'UPDATE users SET password_hash = ?, salt = ?, must_change_password = 1 WHERE id = ?',
    ).bind(hash, salt, id).run();
    await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  }
  return c.json({ ok: true });
});

/* ---------------- trips ---------------- */

app.post('/trips', requireAdmin, async c => {
  const { name, destination, start_date, end_date, emoji, color, base_currency, watch_currencies } = await c.req.json<any>();
  if (!name?.trim()) return bad(c, 'name_required');
  const codes = new Set((await currencyList(c.env)).map(x => x.code));
  const base = base_currency && codes.has(String(base_currency).toUpperCase())
    ? String(base_currency).toUpperCase() : 'MYR';
  const watch = Array.isArray(watch_currencies)
    ? [...new Set(watch_currencies.map((x: any) => String(x).toUpperCase()))]
        .filter(w => codes.has(w) && w !== base).slice(0, 6)
    : [];
  const r = await c.env.DB.prepare(
    'INSERT INTO trips (name, destination, start_date, end_date, emoji, color, base_currency, watch_currencies) VALUES (?,?,?,?,?,?,?,?)',
  ).bind(name.trim(), destination ?? null, start_date ?? null, end_date ?? null,
    emoji ?? '🧳', color ?? '', base, JSON.stringify(watch)).run();
  return c.json({ id: r.meta.last_row_id });
});

app.get('/trips/:id', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  const trip = await c.env.DB.prepare('SELECT * FROM trips WHERE id = ?').bind(id).first();
  if (!trip) return bad(c, 'not_found', 404);
  const user = c.get('user');
  const my_role = user.role === 'admin' ? 'leader' : await tripRole(c.env, user, id);
  const members = await c.env.DB.prepare(
    `SELECT p.*, m.role AS trip_role FROM participants p JOIN trip_members m ON m.participant_id = p.id WHERE m.trip_id = ? ORDER BY p.name`,
  ).bind(id).all();
  return c.json({ trip: { ...trip, my_role }, members: members.results });
});

app.patch('/trips/:id', requireLeader, async c => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<any>();
  await c.env.DB.prepare(
    `UPDATE trips SET name = COALESCE(?, name), destination = COALESCE(?, destination),
     start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date), emoji = COALESCE(?, emoji),
     color = COALESCE(?, color), hidden_features = COALESCE(?, hidden_features),
     member_can_edit_plan = COALESCE(?, member_can_edit_plan) WHERE id = ?`,
  ).bind(b.name ?? null, b.destination ?? null, b.start_date ?? null, b.end_date ?? null, b.emoji ?? null,
    b.color ?? null, Array.isArray(b.hidden_features) ? JSON.stringify(b.hidden_features) : null,
    b.member_can_edit_plan === undefined ? null : (b.member_can_edit_plan ? 1 : 0), id).run();
  // Back-compat column keeps being written above; authorization no longer reads it —
  // instead, flipping it now bulk-sets every non-leader linked member's role.
  if (b.member_can_edit_plan !== undefined) {
    await c.env.DB.prepare(
      `UPDATE trip_members SET role = ? WHERE trip_id = ? AND role != 'leader'
       AND participant_id IN (SELECT participant_id FROM users WHERE participant_id IS NOT NULL)`,
    ).bind(b.member_can_edit_plan ? 'editor' : 'viewer', id).run();
  }
  return c.json({ ok: true });
});

app.put('/trips/:id/members', requireLeader, async c => {
  const id = Number(c.req.param('id'));
  const { participant_ids } = await c.req.json<{ participant_ids: number[] }>();
  const incoming = participant_ids ?? [];
  if (incoming.length) {
    const placeholders = incoming.map(() => '?').join(',');
    const remainingLeaders = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM trip_members WHERE trip_id = ? AND role = 'leader' AND participant_id IN (${placeholders})`,
    ).bind(id, ...incoming).first<any>();
    const totalLeaders = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM trip_members WHERE trip_id = ? AND role = 'leader'").bind(id).first<any>();
    if ((totalLeaders?.n ?? 0) > 0 && (remainingLeaders?.n ?? 0) === 0) return bad(c, 'last_leader');
  } else {
    const totalLeaders = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM trip_members WHERE trip_id = ? AND role = 'leader'").bind(id).first<any>();
    if ((totalLeaders?.n ?? 0) > 0) return bad(c, 'last_leader');
  }
  const stmts = [];
  if (incoming.length) {
    const placeholders = incoming.map(() => '?').join(',');
    stmts.push(c.env.DB.prepare(
      `DELETE FROM trip_members WHERE trip_id = ? AND participant_id NOT IN (${placeholders})`,
    ).bind(id, ...incoming));
  } else {
    stmts.push(c.env.DB.prepare('DELETE FROM trip_members WHERE trip_id = ?').bind(id));
  }
  for (const pid of incoming) {
    stmts.push(c.env.DB.prepare('INSERT OR IGNORE INTO trip_members (trip_id, participant_id) VALUES (?,?)').bind(id, pid));
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

app.patch('/trips/:id/members/:pid/role', requireLeader, async c => {
  const tripId = Number(c.req.param('id')), pid = Number(c.req.param('pid'));
  const b = await c.req.json<any>();
  const role = String(b.role) as TripRole;
  if (!['leader', 'editor', 'viewer'].includes(role)) return bad(c, 'bad_role');
  const cur = await c.env.DB.prepare('SELECT role FROM trip_members WHERE trip_id = ? AND participant_id = ?')
    .bind(tripId, pid).first<any>();
  if (!cur) return bad(c, 'not_member', 404);
  if (cur.role === 'leader' && role !== 'leader') {
    const leaders = await c.env.DB.prepare(
      "SELECT COUNT(*) AS n FROM trip_members WHERE trip_id = ? AND role = 'leader'").bind(tripId).first<any>();
    if ((leaders?.n ?? 0) <= 1) return bad(c, 'last_leader');
  }
  await c.env.DB.prepare('UPDATE trip_members SET role = ? WHERE trip_id = ? AND participant_id = ?')
    .bind(role, tripId, pid).run();
  await audit(c.env, (c.get('user') as SessionUser).id, 'role_change', 'trip', tripId);
  return c.json({ ok: true, role });
});

/* ---------------- documents ---------------- */

app.get('/trips/:id/documents', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  if ((await hiddenFor(c, id)).has('documents')) return bad(c, 'feature_hidden', 403);
  const rows = await c.env.DB.prepare(
    `SELECT d.*, e.id AS expense_id FROM documents d
     LEFT JOIN expenses e ON e.document_id = d.id
     WHERE d.trip_id = ? ORDER BY d.created_at DESC`,
  ).bind(id).all();
  return c.json(rows.results);
});

app.post('/trips/:id/documents', requireLeader, async c => {
  const tripId = Number(c.req.param('id'));
  const form = await c.req.formData();
  const file = form.get('file') as unknown as File | null;
  const metaRaw = form.get('meta');
  if (!file) return bad(c, 'file_required');
  if (file.size > 10 * 1024 * 1024) return bad(c, 'file_too_large');
  const meta = metaRaw ? JSON.parse(String(metaRaw)) : {};
  const key = `trips/${tripId}/${randomToken().slice(0, 16)}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
  await filesPut(c.env, key, await file.arrayBuffer(), file.type || 'application/octet-stream');
  let duplicate = false;
  if (meta.bookingNo) {
    const dup = await c.env.DB.prepare(
      'SELECT id FROM documents WHERE trip_id = ? AND booking_no = ?',
    ).bind(tripId, meta.bookingNo).first();
    duplicate = !!dup;
  }
  const r = await c.env.DB.prepare(
    `INSERT INTO documents (trip_id, filename, r2_key, mime, size, vendor, doc_type, booking_no, parsed_json, uploaded_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    tripId, file.name, key, file.type || 'application/pdf', file.size,
    meta.vendor ?? null, meta.docType ?? null, meta.bookingNo ?? null,
    JSON.stringify(meta), c.get('user').id,
  ).run();
  await audit(c.env, c.get('user').id, 'document_upload', 'document', Number(r.meta.last_row_id));
  await trackUsage(c.env, c.get('user').id, 'doc_upload');
  return c.json({ id: r.meta.last_row_id, duplicate });
});

app.get('/documents/:id/file', async c => {
  const id = Number(c.req.param('id'));
  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<any>();
  if (!doc) return bad(c, 'not_found', 404);
  if (!(await assertTripAccess(c, doc.trip_id))) return bad(c, 'forbidden', 403);
  if ((await hiddenFor(c, doc.trip_id)).has('documents')) return bad(c, 'feature_hidden', 403);
  const body = await filesGet(c.env, doc.r2_key);
  if (!body) return bad(c, 'file_missing', 404);
  return new Response(body as any, {
    headers: {
      'Content-Type': doc.mime,
      'Content-Disposition': `inline; filename="${encodeURIComponent(doc.filename)}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

app.get('/documents/:id', async c => {
  const id = Number(c.req.param('id'));
  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<any>();
  if (!doc) return bad(c, 'not_found', 404);
  if (!(await assertTripAccess(c, doc.trip_id))) return bad(c, 'forbidden', 403);
  return c.json(doc);
});

app.delete('/documents/:id', async c => {
  const id = Number(c.req.param('id'));
  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<any>();
  if (!doc) return bad(c, 'not_found', 404);
  if (!(await needRole(c, doc.trip_id, 'leader'))) return bad(c, 'forbidden', 403);
  // A linked expense survives — it is just unlinked from the deleted file.
  const linked = await c.env.DB.prepare('SELECT id FROM expenses WHERE document_id = ?').bind(id).first<any>();
  if (linked) {
    await c.env.DB.prepare('UPDATE expenses SET document_id = NULL WHERE document_id = ?').bind(id).run();
  }
  await filesDelete(c.env, doc.r2_key);
  await c.env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(id).run();
  await audit(c.env, c.get('user').id, 'document_delete', 'document', id);
  return c.json({ ok: true, unlinked_expense_id: linked?.id ?? null });
});

/* -------- expense payload helpers -------- */

interface ExpensePayload {
  category: string; description: string; vendor?: string; location?: string;
  expense_date?: string; end_date?: string; payment_date?: string;
  amount_original: number; currency: string; fx_rate: number; amount_myr: number;
  payer_participant_id: number;
  shares: Array<{ participant_id: number; amount_myr: number }>;
  due_dates?: Array<{ due_date: string; amount_myr?: number; note?: string; participant_id?: number | null }>;
  payment_status?: 'paid' | 'pay_at_hotel';
  meta?: unknown;
}

function validExpense(p: ExpensePayload): string | null {
  if (!p.description?.trim()) return 'description_required';
  if (!(p.amount_myr > 0)) return 'amount_required';
  if (!p.payer_participant_id) return 'payer_required';
  if (!p.shares?.length) return 'shares_required';
  const sum = p.shares.reduce((a, s) => a + s.amount_myr, 0);
  if (Math.abs(sum - p.amount_myr) > 0.05) return 'shares_must_sum_to_total';
  return null;
}

async function insertExpense(env: Env, tripId: number, documentId: number | null, p: ExpensePayload): Promise<number> {
  const r = await env.DB.prepare(
    `INSERT INTO expenses (trip_id, document_id, category, description, vendor, location,
      expense_date, end_date, payment_date, amount_original, currency, fx_rate, amount_myr,
      payer_participant_id, meta_json, payment_status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    tripId, documentId, p.category, p.description.trim(), p.vendor ?? null, p.location ?? null,
    p.expense_date ?? null, p.end_date ?? null, p.payment_date ?? null,
    p.amount_original, p.currency, p.fx_rate, p.amount_myr,
    p.payer_participant_id, p.meta ? JSON.stringify(p.meta) : null,
    p.payment_status === 'pay_at_hotel' ? 'pay_at_hotel' : 'paid',
  ).run();
  const eid = Number(r.meta.last_row_id);
  const stmts = p.shares.map(s =>
    env.DB.prepare('INSERT INTO expense_shares (expense_id, participant_id, amount_myr) VALUES (?,?,?)')
      .bind(eid, s.participant_id, s.amount_myr));
  for (const d of p.due_dates ?? []) {
    stmts.push(env.DB.prepare('INSERT INTO due_dates (expense_id, due_date, amount_myr, note, participant_id) VALUES (?,?,?,?,?)')
      .bind(eid, d.due_date, d.amount_myr ?? null, d.note ?? null, d.participant_id ?? null));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return eid;
}

app.post('/documents/:id/confirm', async c => {
  const id = Number(c.req.param('id'));
  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<any>();
  if (!doc) return bad(c, 'not_found', 404);
  if (!(await needRole(c, doc.trip_id, 'leader'))) return bad(c, 'forbidden', 403);
  const body = await c.req.json<{ expense?: ExpensePayload; vendor?: string; docType?: string; bookingNo?: string }>();
  let expenseId: number | null = null;
  if (body.expense) {
    const err = validExpense(body.expense);
    if (err) return bad(c, err);
    expenseId = await insertExpense(c.env, doc.trip_id, id, body.expense);
  }
  await c.env.DB.prepare(
    `UPDATE documents SET status = 'confirmed', vendor = COALESCE(?, vendor),
     doc_type = COALESCE(?, doc_type), booking_no = COALESCE(?, booking_no) WHERE id = ?`,
  ).bind(body.vendor ?? null, body.docType ?? null, body.bookingNo ?? null, id).run();
  await audit(c.env, c.get('user').id, 'document_confirm', 'document', id);
  return c.json({ ok: true, expense_id: expenseId });
});

/* ---------------- expenses ---------------- */

app.get('/trips/:id/expenses', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  if ((await hiddenFor(c, id)).has('ledger')) return bad(c, 'feature_hidden', 403);
  const expenses = await c.env.DB.prepare(
    'SELECT * FROM expenses WHERE trip_id = ? ORDER BY expense_date, id',
  ).bind(id).all();
  const shares = await c.env.DB.prepare(
    `SELECT s.* FROM expense_shares s JOIN expenses e ON e.id = s.expense_id WHERE e.trip_id = ?`,
  ).bind(id).all();
  const dues = await c.env.DB.prepare(
    `SELECT d.* FROM due_dates d JOIN expenses e ON e.id = d.expense_id WHERE e.trip_id = ? ORDER BY d.due_date`,
  ).bind(id).all();
  return c.json({ expenses: expenses.results, shares: shares.results, due_dates: dues.results });
});

app.post('/trips/:id/expenses', requireLeader, async c => {
  const id = Number(c.req.param('id'));
  const p = await c.req.json<ExpensePayload>();
  const err = validExpense(p);
  if (err) return bad(c, err);
  const eid = await insertExpense(c.env, id, null, p);
  await audit(c.env, c.get('user').id, 'expense_create', 'expense', eid);
  await trackUsage(c.env, c.get('user').id, 'expense_add');
  return c.json({ id: eid });
});

app.put('/expenses/:id', async c => {
  const id = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first<any>();
  if (!old) return bad(c, 'not_found', 404);
  if (!(await needRole(c, old.trip_id, 'leader'))) return bad(c, 'forbidden', 403);
  const p = await c.req.json<ExpensePayload>();
  const err = validExpense(p);
  if (err) return bad(c, err);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE expenses SET category=?, description=?, vendor=?, location=?, expense_date=?, end_date=?,
       payment_date=?, amount_original=?, currency=?, fx_rate=?, amount_myr=?, payer_participant_id=?,
       payment_status=COALESCE(?, payment_status) WHERE id=?`,
    ).bind(p.category, p.description.trim(), p.vendor ?? null, p.location ?? null, p.expense_date ?? null,
      p.end_date ?? null, p.payment_date ?? null, p.amount_original, p.currency, p.fx_rate, p.amount_myr,
      p.payer_participant_id, p.payment_status ?? null, id),
    c.env.DB.prepare('DELETE FROM expense_shares WHERE expense_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM due_dates WHERE expense_id = ?').bind(id),
  ]);
  const stmts = p.shares.map(s =>
    c.env.DB.prepare('INSERT INTO expense_shares (expense_id, participant_id, amount_myr) VALUES (?,?,?)')
      .bind(id, s.participant_id, s.amount_myr));
  for (const d of p.due_dates ?? []) {
    stmts.push(c.env.DB.prepare('INSERT INTO due_dates (expense_id, due_date, amount_myr, note, participant_id) VALUES (?,?,?,?,?)')
      .bind(id, d.due_date, d.amount_myr ?? null, d.note ?? null, d.participant_id ?? null));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  await audit(c.env, c.get('user').id, 'expense_update', 'expense', id);
  return c.json({ ok: true });
});

app.delete('/expenses/:id', async c => {
  const id = Number(c.req.param('id'));
  const exp = await c.env.DB.prepare('SELECT trip_id FROM expenses WHERE id = ?').bind(id).first<any>();
  if (!exp) return bad(c, 'not_found', 404);
  if (!(await needRole(c, exp.trip_id, 'leader'))) return bad(c, 'forbidden', 403);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM expense_shares WHERE expense_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM due_dates WHERE expense_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(id),
  ]);
  await audit(c.env, c.get('user').id, 'expense_delete', 'expense', id);
  return c.json({ ok: true });
});

/* ---------------- payments ---------------- */

app.get('/trips/:id/payments', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  if ((await hiddenFor(c, id)).has('payments')) return bad(c, 'feature_hidden', 403);
  const rows = await c.env.DB.prepare(
    'SELECT * FROM payments WHERE trip_id = ? ORDER BY pay_date DESC, id DESC',
  ).bind(id).all();
  return c.json(rows.results);
});

app.post('/trips/:id/payments', requireLeader, async c => {
  const id = Number(c.req.param('id'));
  const { from_participant_id, to_participant_id, amount_myr, pay_date, note, expense_id } = await c.req.json<any>();
  if (!from_participant_id || !to_participant_id || !(amount_myr > 0) || !pay_date) return bad(c, 'missing_fields');
  const r = await c.env.DB.prepare(
    `INSERT INTO payments (trip_id, from_participant_id, to_participant_id, amount_myr, pay_date, note, expense_id, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).bind(id, from_participant_id, to_participant_id, amount_myr, pay_date, note ?? null, expense_id ?? null, c.get('user').id).run();
  await audit(c.env, c.get('user').id, 'payment_create', 'payment', Number(r.meta.last_row_id));
  await trackUsage(c.env, c.get('user').id, 'payment_add');
  return c.json({ id: r.meta.last_row_id });
});

app.delete('/payments/:id', async c => {
  const id = Number(c.req.param('id'));
  const pay = await c.env.DB.prepare('SELECT trip_id FROM payments WHERE id = ?').bind(id).first<any>();
  if (!pay) return bad(c, 'not_found', 404);
  if (!(await needRole(c, pay.trip_id, 'leader'))) return bad(c, 'forbidden', 403);
  await c.env.DB.prepare('DELETE FROM payments WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

/* ---------------- balances ---------------- */

/** Full balance computation for one trip — used by the API route and MCP. */
async function computeBalances(env: Env, id: number) {
  const [expenses, shares, payments, parts] = await Promise.all([
    env.DB.prepare('SELECT * FROM expenses WHERE trip_id = ? ORDER BY expense_date, id').bind(id).all(),
    env.DB.prepare('SELECT s.* FROM expense_shares s JOIN expenses e ON e.id = s.expense_id WHERE e.trip_id = ?').bind(id).all(),
    env.DB.prepare('SELECT * FROM payments WHERE trip_id = ? ORDER BY pay_date, id').bind(id).all(),
    env.DB.prepare('SELECT p.* FROM participants p JOIN trip_members m ON m.participant_id = p.id WHERE m.trip_id = ?').bind(id).all(),
  ]);
  const exps = expenses.results as any[];
  const byExpense = new Map<number, any>(exps.map(e => [e.id, e]));

  // debts[from][to] = list of {expense, amount, remaining}
  type Item = { expense_id: number; description: string; category: string; date: string | null; amount: number; remaining: number };
  const items = new Map<string, Item[]>(); // key `${from}->${to}`
  for (const s of shares.results as any[]) {
    const e = byExpense.get(s.expense_id);
    if (!e || e.payer_participant_id === s.participant_id || !e.payer_participant_id) continue;
    if (e.payment_status === 'pay_at_hotel') continue; // committed, not owed — enters balances once marked paid
    const key = `${s.participant_id}->${e.payer_participant_id}`;
    if (!items.has(key)) items.set(key, []);
    items.get(key)!.push({
      expense_id: e.id, description: e.description, category: e.category,
      date: e.expense_date, amount: s.amount_myr, remaining: s.amount_myr,
    });
  }
  // apply payments per (from,to): targeted payments hit their expense's item first,
  // then any remainder — and all untargeted payments — flow oldest-item-first.
  // Track credit if overpaid.
  const credit = new Map<string, number>();
  for (const p of payments.results as any[]) {
    const key = `${p.from_participant_id}->${p.to_participant_id}`;
    let left = p.amount_myr;
    const list = items.get(key) ?? [];
    if (p.expense_id) {
      const target = list.find(it => it.expense_id === p.expense_id);
      if (target && left > 0) {
        const take = Math.min(left, target.remaining);
        target.remaining = Math.round((target.remaining - take) * 100) / 100;
        left = Math.round((left - take) * 100) / 100;
      }
    }
    for (const it of list) {
      if (left <= 0) break;
      const take = Math.min(left, it.remaining);
      it.remaining = Math.round((it.remaining - take) * 100) / 100;
      left = Math.round((left - take) * 100) / 100;
    }
    if (left > 0.004) credit.set(key, (credit.get(key) ?? 0) + left);
  }

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const balances = (parts.results as any[]).map(p => {
    let owed = 0, outstanding = 0;
    const byPayee: any[] = [];
    for (const [key, list] of items) {
      const [from, to] = key.split('->').map(Number);
      if (from !== p.id) continue;
      const total = list.reduce((a, i) => a + i.amount, 0);
      const rem = list.reduce((a, i) => a + i.remaining, 0);
      owed += total; outstanding += rem;
      byPayee.push({ to_participant_id: to, total: r2(total), remaining: r2(rem), credit: r2(credit.get(key) ?? 0), items: list });
    }
    const paid = (payments.results as any[])
      .filter(x => x.from_participant_id === p.id)
      .reduce((a, x) => a + x.amount_myr, 0);
    return { participant: p, owed: r2(owed), paid: r2(paid), outstanding: r2(outstanding), byPayee };
  });

  const totalsByCategory: Record<string, number> = {};
  for (const e of exps) totalsByCategory[e.category] = r2((totalsByCategory[e.category] ?? 0) + e.amount_myr);
  const tripTotal = r2(exps.reduce((a, e) => a + e.amount_myr, 0));
  const committedTotal = r2(exps.filter(e => e.payment_status === 'pay_at_hotel').reduce((a, e) => a + e.amount_myr, 0));
  // per-item summary for chart tooltips / by-item breakdown
  const expenseItems = exps.map(e => ({
    id: e.id, description: e.description, category: e.category,
    amount_myr: e.amount_myr, expense_date: e.expense_date, vendor: e.vendor,
    payment_status: e.payment_status ?? 'paid',
  }));

  return { balances, totalsByCategory, tripTotal, committedTotal, expenseCount: exps.length, expenseItems };
}

app.get('/trips/:id/balances', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  if ((await hiddenFor(c, id)).has('payments')) return bad(c, 'feature_hidden', 403);
  const data = await computeBalances(c.env, id);
  const user = c.get('user');
  const balances = atLeast(await tripRole(c.env, user, id), 'leader')
    ? data.balances : data.balances.filter((b: any) => b.participant.id === user.participant_id);
  return c.json({ ...data, balances });
});

app.patch('/expenses/:id/status', async c => {
  const id = Number(c.req.param('id'));
  const exp = await c.env.DB.prepare('SELECT trip_id FROM expenses WHERE id = ?').bind(id).first<any>();
  if (!exp) return bad(c, 'not_found', 404);
  if (!(await needRole(c, exp.trip_id, 'leader'))) return bad(c, 'forbidden', 403);
  const { payment_status } = await c.req.json<any>();
  if (payment_status !== 'paid' && payment_status !== 'pay_at_hotel') return bad(c, 'bad_status');
  await c.env.DB.prepare('UPDATE expenses SET payment_status = ?, payment_date = COALESCE(payment_date, date(\'now\')) WHERE id = ?')
    .bind(payment_status, id).run();
  await audit(c.env, c.get('user').id, 'expense_status', 'expense', id);
  return c.json({ ok: true });
});

/* ---------------- planner ---------------- */

interface AutoEvent {
  day: string; time: string | null; end_time: string | null;
  kind: 'flight' | 'checkin' | 'checkout';
  title: string; subtitle: string | null; expense_id: number;
  participant_ids?: number[]; // who is on this booking (from expense shares)
}

app.get('/trips/:id/plan', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  if ((await hiddenFor(c, id)).has('plan')) return bad(c, 'feature_hidden', 403);

  // Auto events from confirmed bookings (flights + stays), enriched from parsed documents.
  // Receipts carry no departure times, so legs are enriched from any uploaded itinerary
  // that shares the same booking number.
  const exps = await c.env.DB.prepare(
    `SELECT e.*, d.parsed_json, d.booking_no FROM expenses e LEFT JOIN documents d ON d.id = e.document_id
     WHERE e.trip_id = ? AND e.category IN ('flight','accommodation')`,
  ).bind(id).all();
  // who is on each booking — so multi-flight days show who flies on what
  const evShares = await c.env.DB.prepare(
    `SELECT s.expense_id, s.participant_id FROM expense_shares s JOIN expenses e ON e.id = s.expense_id
     WHERE e.trip_id = ? AND e.category IN ('flight','accommodation')`,
  ).bind(id).all();
  const sharesByExp = new Map<number, number[]>();
  for (const s of evShares.results as any[]) {
    if (!sharesByExp.has(s.expense_id)) sharesByExp.set(s.expense_id, []);
    sharesByExp.get(s.expense_id)!.push(s.participant_id);
  }
  const itinDocs = await c.env.DB.prepare(
    `SELECT booking_no, parsed_json FROM documents WHERE trip_id = ? AND doc_type = 'itinerary' AND booking_no IS NOT NULL`,
  ).bind(id).all();
  const itinByBooking = new Map<string, any>();
  for (const dcc of itinDocs.results as any[]) {
    try { itinByBooking.set(dcc.booking_no, JSON.parse(dcc.parsed_json)); } catch { /* ignore */ }
  }
  const autoEvents: AutoEvent[] = [];
  for (const e of exps.results as any[]) {
    let parsed: any = null;
    try { parsed = e.parsed_json ? JSON.parse(e.parsed_json) : null; } catch { /* ignore */ }
    if (e.category === 'flight') {
      let legs = (parsed?.legs ?? []).filter((l: any) => l.date);
      const itin = e.booking_no ? itinByBooking.get(e.booking_no) : null;
      if (itin?.legs?.length) {
        legs = legs.map((l: any) => {
          const match = itin.legs.find((il: any) => il.flightNo === l.flightNo && il.date === l.date);
          return match ? { ...l, ...Object.fromEntries(Object.entries(match).filter(([, v]) => v != null)) } : l;
        });
        if (!legs.length) legs = itin.legs.filter((l: any) => l.date);
      }
      if (legs.length) {
        for (const l of legs) {
          autoEvents.push({
            day: l.date, time: l.depTime ?? null, end_time: l.arrTime ?? null, kind: 'flight',
            title: `${l.from ?? '?'} → ${l.to ?? '?'}${l.flightNo ? ` (${l.flightNo})` : ''}`,
            subtitle: [l.depPlace, l.arrPlace].filter(Boolean).join(' → ') || e.vendor,
            expense_id: e.id,
          });
        }
      } else if (e.expense_date) {
        autoEvents.push({ day: e.expense_date, time: null, end_time: null, kind: 'flight', title: e.description, subtitle: e.vendor, expense_id: e.id });
      }
    } else {
      if (e.expense_date) {
        autoEvents.push({
          day: e.expense_date, time: parsed?.checkInTime ?? null, end_time: null, kind: 'checkin',
          title: e.description, subtitle: e.location ?? parsed?.location ?? null, expense_id: e.id,
        });
      }
      if (e.end_date) {
        autoEvents.push({
          day: e.end_date, time: parsed?.checkOutTime ?? null, end_time: null, kind: 'checkout',
          title: e.description, subtitle: e.location ?? parsed?.location ?? null, expense_id: e.id,
        });
      }
    }
  }

  for (const ev of autoEvents) ev.participant_ids = sharesByExp.get(ev.expense_id) ?? [];

  const acts = await c.env.DB.prepare(
    'SELECT * FROM activities WHERE trip_id = ? ORDER BY day, start_time, sort, id',
  ).bind(id).all();
  const aps = await c.env.DB.prepare(
    `SELECT ap.* FROM activity_participants ap JOIN activities a ON a.id = ap.activity_id WHERE a.trip_id = ?`,
  ).bind(id).all();
  const groups = await c.env.DB.prepare('SELECT * FROM groups WHERE trip_id = ? ORDER BY name').bind(id).all();
  const gms = await c.env.DB.prepare(
    `SELECT gm.* FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE g.trip_id = ?`,
  ).bind(id).all();

  const partsByAct = new Map<number, number[]>();
  for (const r of aps.results as any[]) {
    if (!partsByAct.has(r.activity_id)) partsByAct.set(r.activity_id, []);
    partsByAct.get(r.activity_id)!.push(r.participant_id);
  }
  const membersByGroup = new Map<number, number[]>();
  for (const r of gms.results as any[]) {
    if (!membersByGroup.has(r.group_id)) membersByGroup.set(r.group_id, []);
    membersByGroup.get(r.group_id)!.push(r.participant_id);
  }

  const stays = (exps.results as any[])
    .filter(e => e.category === 'accommodation')
    .map(e => ({ expense_id: e.id, description: e.description, location: e.location, lat: e.lat, lng: e.lng, checkin: e.expense_date, checkout: e.end_date }));
  const daySettings = await c.env.DB.prepare('SELECT * FROM day_settings WHERE trip_id = ?').bind(id).all();
  const legOverrides = await c.env.DB.prepare('SELECT * FROM leg_overrides WHERE trip_id = ?').bind(id).all();
  const dayBudgets = await c.env.DB.prepare('SELECT * FROM day_budgets WHERE trip_id = ? ORDER BY day').bind(id).all();
  const dayNotes = await c.env.DB.prepare('SELECT * FROM day_notes WHERE trip_id = ? ORDER BY day, sort, id').bind(id).all();

  await trackUsage(c.env, c.get('user').id, 'plan_view');
  return c.json({
    dayBudgets: dayBudgets.results,
    dayNotes: dayNotes.results,
    autoEvents,
    activities: (acts.results as any[]).map(a => ({ ...a, participant_ids: partsByAct.get(a.id) ?? [] })),
    groups: (groups.results as any[]).map(g => ({ ...g, member_ids: membersByGroup.get(g.id) ?? [] })),
    stays,
    daySettings: daySettings.results,
    legOverrides: legOverrides.results,
  });
});

/* ---- day start/end settings & leg overrides (admin) ---- */

const DAY_SETTING_COLS = ['start_name', 'start_lat', 'start_lng', 'end_name', 'end_lat', 'end_lng', 'title'] as const;

app.put('/trips/:id/daysettings', requireEditor, async c => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<any>();
  if (!b.day) return bad(c, 'day_required');
  // Only the columns actually present in the body are written, so the day-title
  // editor and the start/end editor can each save without clobbering the other.
  // An explicit null still clears a column — that is how "use the stay" resets it.
  const cols = DAY_SETTING_COLS.filter(k => k in b);
  if (!cols.length) return bad(c, 'nothing_to_update');
  const vals = cols.map(k => (k === 'title'
    ? (b.title == null || !String(b.title).trim() ? null : String(b.title).trim().slice(0, 80))
    : b[k] ?? null));
  await c.env.DB.prepare(
    `INSERT INTO day_settings (trip_id, day, ${cols.join(', ')}) VALUES (?,?${',?'.repeat(cols.length)})
     ON CONFLICT (trip_id, day) DO UPDATE SET ${cols.map(k => `${k}=excluded.${k}`).join(', ')}`,
  ).bind(id, b.day, ...vals).run();
  return c.json({ ok: true });
});

app.delete('/trips/:id/daysettings/:day', requireEditor, async c => {
  await c.env.DB.prepare('DELETE FROM day_settings WHERE trip_id = ? AND day = ?')
    .bind(Number(c.req.param('id')), c.req.param('day')).run();
  return c.json({ ok: true });
});

app.put('/trips/:id/legs', requireEditor, async c => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<any>();
  if (!b.day || !b.leg_key) return bad(c, 'missing_fields');
  if (b.mode === null && b.fare_jpy == null) {
    await c.env.DB.prepare('DELETE FROM leg_overrides WHERE trip_id = ? AND day = ? AND leg_key = ?')
      .bind(id, b.day, b.leg_key).run();
    return c.json({ ok: true, cleared: true });
  }
  await c.env.DB.prepare(
    `INSERT INTO leg_overrides (trip_id, day, leg_key, mode, fare_jpy, note) VALUES (?,?,?,?,?,?)
     ON CONFLICT (trip_id, day, leg_key) DO UPDATE SET mode=excluded.mode, fare_jpy=excluded.fare_jpy, note=excluded.note`,
  ).bind(id, b.day, b.leg_key, b.mode ?? null, b.fare_jpy ?? null, b.note ?? null).run();
  return c.json({ ok: true });
});

app.patch('/expenses/:id/coords', async c => {
  const id = Number(c.req.param('id'));
  const exp = await c.env.DB.prepare('SELECT trip_id FROM expenses WHERE id = ?').bind(id).first<any>();
  if (!exp) return bad(c, 'not_found', 404);
  if (!(await needRole(c, exp.trip_id, 'leader'))) return bad(c, 'forbidden', 403);
  const { lat, lng } = await c.req.json<any>();
  await c.env.DB.prepare('UPDATE expenses SET lat = ?, lng = ? WHERE id = ?')
    .bind(lat ?? null, lng ?? null, id).run();
  return c.json({ ok: true });
});

/* ---- My spend: private per-user tracker. Every query is scoped to the session
   user; there is deliberately NO endpoint that reads another user's items. ---- */

/** Equal split in sen, remainder to the first shares. */
function splitSen(total: number, n: number): number[] {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  let rem = cents - base * n;
  return Array.from({ length: n }, () => (base + (rem-- > 0 ? 1 : 0)) / 100);
}

/** Replace the tagged-participant shares of one personal expense. */
async function savePersonalShares(env: Env, personalId: number, amountMyr: number, participantIds: number[], includeSelf: boolean) {
  await env.DB.prepare('DELETE FROM personal_shares WHERE personal_expense_id = ?').bind(personalId).run();
  const ids = [...new Set(participantIds)].filter(n => Number.isFinite(n));
  if (!ids.length) return;
  const parts = splitSen(amountMyr, ids.length + (includeSelf ? 1 : 0));
  const stmts = ids.map((pid, i) =>
    env.DB.prepare('INSERT INTO personal_shares (personal_expense_id, participant_id, amount_myr) VALUES (?,?,?)')
      .bind(personalId, pid, parts[includeSelf ? i + 1 : i]));
  await env.DB.batch(stmts);
}

app.get('/trips/:id/myspend', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  const rows = await c.env.DB.prepare(
    'SELECT * FROM personal_expenses WHERE trip_id = ? AND user_id = ? ORDER BY spend_date DESC, id DESC',
  ).bind(id, c.get('user').id).all();
  const shares = await c.env.DB.prepare(
    `SELECT ps.*, p.name AS participant_name FROM personal_shares ps
     JOIN personal_expenses pe ON pe.id = ps.personal_expense_id
     JOIN participants p ON p.id = ps.participant_id
     WHERE pe.trip_id = ? AND pe.user_id = ?`,
  ).bind(id, c.get('user').id).all();
  return c.json({ items: rows.results, shares: shares.results });
});

/** Items OTHER people tagged me in — what I owe them, peer to peer. */
app.get('/trips/:id/myspend/tagged', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  const me = c.get('user');
  if (!me.participant_id) return c.json([]);
  const rows = await c.env.DB.prepare(
    `SELECT ps.id AS share_id, ps.amount_myr, ps.settled, ps.settled_at,
            pe.spend_date, pe.description, pe.category, u.name AS owner_name
     FROM personal_shares ps
     JOIN personal_expenses pe ON pe.id = ps.personal_expense_id
     JOIN users u ON u.id = pe.user_id
     WHERE pe.trip_id = ? AND ps.participant_id = ? AND pe.user_id != ?
     ORDER BY ps.settled, pe.spend_date DESC`,
  ).bind(id, me.participant_id, me.id).all();
  return c.json(rows.results);
});

/** The item's OWNER confirms a tagged share was paid back (or unmarks it). */
app.patch('/myspend/shares/:id/settle', async c => {
  const shareId = Number(c.req.param('id'));
  const row = await c.env.DB.prepare(
    `SELECT ps.id, pe.user_id FROM personal_shares ps JOIN personal_expenses pe ON pe.id = ps.personal_expense_id WHERE ps.id = ?`,
  ).bind(shareId).first<any>();
  if (!row || row.user_id !== c.get('user').id) return bad(c, 'not_found', 404);
  const { settled } = await c.req.json<any>();
  await c.env.DB.prepare(`UPDATE personal_shares SET settled = ?, settled_at = CASE WHEN ? THEN datetime('now') ELSE NULL END WHERE id = ?`)
    .bind(settled ? 1 : 0, settled ? 1 : 0, shareId).run();
  return c.json({ ok: true });
});

app.post('/trips/:id/myspend', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  const b = await c.req.json<any>();
  if (!b.description?.trim() || !(b.amount_original > 0) || !b.spend_date) return bad(c, 'missing_fields');
  const r = await c.env.DB.prepare(
    `INSERT INTO personal_expenses (trip_id, user_id, spend_date, category, description,
      amount_original, currency, fx_rate, amount_myr, behalf_note)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).bind(id, c.get('user').id, b.spend_date, b.category ?? 'other', b.description.trim(),
    b.amount_original, b.currency ?? 'JPY', b.fx_rate ?? 1, b.amount_myr ?? b.amount_original,
    b.behalf_note ?? null).run();
  const pid = Number(r.meta.last_row_id);
  if (Array.isArray(b.participant_ids) && b.participant_ids.length) {
    await savePersonalShares(c.env, pid, b.amount_myr ?? b.amount_original, b.participant_ids.map(Number), b.include_self !== false);
  }
  await trackUsage(c.env, c.get('user').id, 'myspend_add');
  return c.json({ id: pid });
});

async function ownPersonal(c: any, id: number): Promise<any | null> {
  const row = await c.env.DB.prepare('SELECT * FROM personal_expenses WHERE id = ?').bind(id).first();
  if (!row || (row as any).user_id !== c.get('user').id) return null; // even admins see only their own
  return row;
}

app.patch('/myspend/:id', async c => {
  const row = await ownPersonal(c, Number(c.req.param('id')));
  if (!row) return bad(c, 'not_found', 404);
  const b = await c.req.json<any>();
  await c.env.DB.prepare(
    `UPDATE personal_expenses SET spend_date=COALESCE(?,spend_date), category=COALESCE(?,category),
      description=COALESCE(?,description), amount_original=COALESCE(?,amount_original),
      currency=COALESCE(?,currency), fx_rate=COALESCE(?,fx_rate), amount_myr=COALESCE(?,amount_myr),
      behalf_note=COALESCE(?,behalf_note) WHERE id=?`,
  ).bind(b.spend_date ?? null, b.category ?? null, b.description ?? null, b.amount_original ?? null,
    b.currency ?? null, b.fx_rate ?? null, b.amount_myr ?? null, b.behalf_note ?? null, row.id).run();
  return c.json({ ok: true });
});

app.delete('/myspend/:id', async c => {
  const row = await ownPersonal(c, Number(c.req.param('id')));
  if (!row) return bad(c, 'not_found', 404);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM personal_shares WHERE personal_expense_id = ?').bind(row.id),
    c.env.DB.prepare('DELETE FROM personal_expenses WHERE id = ?').bind(row.id),
  ]);
  return c.json({ ok: true });
});

app.post('/myspend/:id/promote', async c => {
  const row = await ownPersonal(c, Number(c.req.param('id')));
  if (!row) return bad(c, 'not_found', 404);
  const user = c.get('user');
  if (!user.participant_id) return bad(c, 'no_linked_participant', 400);
  const members = await c.env.DB.prepare(
    'SELECT participant_id FROM trip_members WHERE trip_id = ?',
  ).bind(row.trip_id).all();
  const ids = (members.results as any[]).map(m => m.participant_id);
  if (!ids.length) return bad(c, 'no_members', 400);
  const cents = Math.round(row.amount_myr * 100);
  const base = Math.floor(cents / ids.length);
  let rem = cents - base * ids.length;
  const shares = ids.map(pid => {
    const amt = (base + (rem > 0 ? 1 : 0)) / 100;
    if (rem > 0) rem--;
    return { participant_id: pid, amount_myr: amt };
  });
  const eid = await insertExpense(c.env, row.trip_id, null, {
    category: row.category, description: row.description, vendor: undefined,
    location: undefined, expense_date: row.spend_date, payment_date: row.spend_date,
    amount_original: row.amount_original, currency: row.currency, fx_rate: row.fx_rate,
    amount_myr: row.amount_myr, payer_participant_id: user.participant_id, shares,
  } as any);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM personal_shares WHERE personal_expense_id = ?').bind(row.id),
    c.env.DB.prepare('DELETE FROM personal_expenses WHERE id = ?').bind(row.id),
  ]);
  await audit(c.env, user.id, 'myspend_promote', 'expense', eid);
  return c.json({ expense_id: eid });
});

async function saveActivityParticipants(env: Env, activityId: number, ids: number[]) {
  const stmts = [env.DB.prepare('DELETE FROM activity_participants WHERE activity_id = ?').bind(activityId)];
  for (const pid of ids ?? []) {
    stmts.push(env.DB.prepare('INSERT INTO activity_participants (activity_id, participant_id) VALUES (?,?)').bind(activityId, pid));
  }
  await env.DB.batch(stmts);
}

/** Leaders always; editors too, unless the plan feature is hidden on this trip. */
async function canEditPlan(c: any, tripId: number): Promise<boolean> {
  if ((await hiddenFor(c, tripId)).has('plan')) return false;
  return needRole(c, tripId, 'editor');
}
async function canEditActivity(c: any, activityId: number): Promise<any | null> {
  const row: any = await c.env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(activityId).first();
  if (!row) return null;
  return (await canEditPlan(c, row.trip_id)) ? row : null;
}

app.post('/trips/:id/activities', async c => {
  const id = Number(c.req.param('id'));
  if (!(await canEditPlan(c, id))) return bad(c, 'forbidden', 403);
  const b = await c.req.json<any>();
  if (!b.title?.trim() || !b.day) return bad(c, 'missing_fields');
  const r = await c.env.DB.prepare(
    `INSERT INTO activities (trip_id, title, day, start_time, end_time, notes, location_name, lat, lng, est_cost_myr, category)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(id, b.title.trim(), b.day, b.start_time ?? null, b.end_time ?? null, b.notes ?? null,
    b.location_name ?? null, b.lat ?? null, b.lng ?? null, b.est_cost_myr ?? null, b.category ?? null).run();
  const aid = Number(r.meta.last_row_id);
  await saveActivityParticipants(c.env, aid, b.participant_ids ?? []);
  await audit(c.env, c.get('user').id, 'activity_create', 'activity', aid);
  return c.json({ id: aid });
});

app.put('/activities/:id', async c => {
  const id = Number(c.req.param('id'));
  if (!(await canEditActivity(c, id))) return bad(c, 'forbidden', 403);
  const b = await c.req.json<any>();
  await c.env.DB.prepare(
    `UPDATE activities SET title=?, day=?, start_time=?, end_time=?, notes=?, location_name=?, lat=?, lng=?, est_cost_myr=?, category=? WHERE id=?`,
  ).bind(b.title?.trim(), b.day, b.start_time ?? null, b.end_time ?? null, b.notes ?? null,
    b.location_name ?? null, b.lat ?? null, b.lng ?? null, b.est_cost_myr ?? null, b.category ?? null, id).run();
  await saveActivityParticipants(c.env, id, b.participant_ids ?? []);
  return c.json({ ok: true });
});

app.patch('/activities/:id', async c => {
  const id = Number(c.req.param('id'));
  if (!(await canEditActivity(c, id))) return bad(c, 'forbidden', 403);
  const { done } = await c.req.json<any>();
  await c.env.DB.prepare('UPDATE activities SET done = ? WHERE id = ?')
    .bind(done ? 1 : 0, id).run();
  return c.json({ ok: true });
});

app.delete('/activities/:id', async c => {
  const id = Number(c.req.param('id'));
  if (!(await canEditActivity(c, id))) return bad(c, 'forbidden', 403);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM activity_participants WHERE activity_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM activities WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

/** v0.13 bulk delete — one permission check, one batch, only this trip's rows. */
app.post('/trips/:id/activities/delete', async c => {
  const id = Number(c.req.param('id'));
  if (!(await canEditPlan(c, id))) return bad(c, 'forbidden', 403);
  const { ids } = await c.req.json<{ ids: number[] }>();
  if (!Array.isArray(ids) || !ids.length || ids.length > 300) return bad(c, 'ids_required');
  const marks = ids.map(() => '?').join(',');
  const rows = await c.env.DB.prepare(`SELECT id FROM activities WHERE trip_id = ? AND id IN (${marks})`)
    .bind(id, ...ids.map(Number)).all();
  const own = (rows.results as any[]).map(r => r.id);
  if (own.length) {
    const stmts: any[] = [];
    for (const aid of own) {
      stmts.push(c.env.DB.prepare('DELETE FROM activity_participants WHERE activity_id = ?').bind(aid));
      stmts.push(c.env.DB.prepare('DELETE FROM activities WHERE id = ?').bind(aid));
    }
    await c.env.DB.batch(stmts);
  }
  await audit(c.env, c.get('user').id, 'activities_bulk_delete', 'trip', id);
  return c.json({ deleted: own.length });
});

/* ---- v0.13 day notes: per-day notes & checklist under the plan ---- */

app.post('/trips/:id/daynotes', async c => {
  const id = Number(c.req.param('id'));
  if (!(await canEditPlan(c, id))) return bad(c, 'forbidden', 403);
  const b = await c.req.json<any>();
  if (!b.content?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(b.day ?? '')) return bad(c, 'missing_fields');
  const mx: any = await c.env.DB.prepare('SELECT COALESCE(MAX(sort),0) AS m FROM day_notes WHERE trip_id = ? AND day = ?').bind(id, b.day).first();
  const r = await c.env.DB.prepare('INSERT INTO day_notes (trip_id, day, content, is_check, sort) VALUES (?,?,?,?,?)')
    .bind(id, b.day, b.content.trim().slice(0, 500), b.is_check ? 1 : 0, (mx?.m ?? 0) + 1).run();
  return c.json({ id: r.meta.last_row_id });
});

app.patch('/daynotes/:id', async c => {
  const nid = Number(c.req.param('id'));
  const row: any = await c.env.DB.prepare('SELECT * FROM day_notes WHERE id = ?').bind(nid).first();
  if (!row || !(await canEditPlan(c, row.trip_id))) return bad(c, 'forbidden', 403);
  const b = await c.req.json<any>();
  await c.env.DB.prepare('UPDATE day_notes SET content = COALESCE(?, content), is_check = COALESCE(?, is_check), done = COALESCE(?, done) WHERE id = ?')
    .bind(b.content?.trim().slice(0, 500) ?? null, b.is_check != null ? (b.is_check ? 1 : 0) : null,
      b.done != null ? (b.done ? 1 : 0) : null, nid).run();
  return c.json({ ok: true });
});

app.delete('/daynotes/:id', async c => {
  const nid = Number(c.req.param('id'));
  const row: any = await c.env.DB.prepare('SELECT * FROM day_notes WHERE id = ?').bind(nid).first();
  if (!row || !(await canEditPlan(c, row.trip_id))) return bad(c, 'forbidden', 403);
  await c.env.DB.prepare('DELETE FROM day_notes WHERE id = ?').bind(nid).run();
  return c.json({ ok: true });
});

/** Atomic reorder + reflow persist: new sort AND recomputed times for one day. */
app.put('/trips/:id/reorder', async c => {
  const id = Number(c.req.param('id'));
  if (!(await canEditPlan(c, id))) return bad(c, 'forbidden', 403);
  const { day, items } = await c.req.json<{ day: string; items: Array<{ id: number; start_time: string | null; end_time: string | null; sort: number }> }>();
  if (!day || !Array.isArray(items) || !items.length) return bad(c, 'missing_fields');
  const stmts = items.map(it =>
    c.env.DB.prepare('UPDATE activities SET start_time = ?, end_time = ?, sort = ? WHERE id = ? AND trip_id = ? AND day = ?')
      .bind(it.start_time, it.end_time, it.sort, it.id, id, day));
  await c.env.DB.batch(stmts);
  await audit(c.env, c.get('user').id, 'activities_reorder', 'trip', id);
  return c.json({ ok: true });
});

/** Cache nearest-station lookup results on an activity (fetched client-side from Overpass). */
app.patch('/activities/:id/stations', async c => {
  if (!(await canEditActivity(c, Number(c.req.param('id'))))) return bad(c, 'forbidden', 403);
  const { stations_json, station_idx } = await c.req.json<any>();
  await c.env.DB.prepare('UPDATE activities SET stations_json = COALESCE(?, stations_json), station_idx = ? WHERE id = ?')
    .bind(stations_json != null ? JSON.stringify(stations_json) : null, station_idx ?? null, Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

app.put('/trips/:id/daybudgets', requireLeader, async c => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<any>();
  if (!b.day) return bad(c, 'day_required');
  await c.env.DB.prepare(
    `INSERT INTO day_budgets (trip_id, day, currency, transport, accommodation, food, attractions, misc, total, myr_estimate)
     VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT (trip_id, day) DO UPDATE SET currency=excluded.currency, transport=excluded.transport,
       accommodation=excluded.accommodation, food=excluded.food, attractions=excluded.attractions,
       misc=excluded.misc, total=excluded.total, myr_estimate=excluded.myr_estimate`,
  ).bind(id, b.day, b.currency ?? 'JPY', b.transport ?? null, b.accommodation ?? null, b.food ?? null,
    b.attractions ?? null, b.misc ?? null, b.total ?? null, b.myr_estimate ?? null).run();
  return c.json({ ok: true });
});

app.delete('/trips/:id/daybudgets/:day', requireLeader, async c => {
  await c.env.DB.prepare('DELETE FROM day_budgets WHERE trip_id = ? AND day = ?')
    .bind(Number(c.req.param('id')), c.req.param('day')).run();
  return c.json({ ok: true });
});

app.get('/trips/:id/importprofiles', requireEditor, async c => {
  const rows = await c.env.DB.prepare('SELECT * FROM import_profiles WHERE trip_id = ? ORDER BY id DESC')
    .bind(Number(c.req.param('id'))).all();
  return c.json(rows.results);
});

app.post('/trips/:id/importprofiles', requireEditor, async c => {
  const { name, mapping } = await c.req.json<any>();
  if (!name?.trim() || !mapping) return bad(c, 'missing_fields');
  const r = await c.env.DB.prepare('INSERT INTO import_profiles (trip_id, name, mapping_json) VALUES (?,?,?)')
    .bind(Number(c.req.param('id')), name.trim(), JSON.stringify(mapping)).run();
  return c.json({ id: r.meta.last_row_id });
});

/** Bulk upsert from the CSV template. Rows with an id update that activity
    (must belong to this trip); rows without create new ones. Never deletes. */
app.post('/trips/:id/activities/bulk', requireEditor, async c => {
  const id = Number(c.req.param('id'));
  const { rows, budgets } = await c.req.json<{ rows: any[]; budgets?: any[] }>();
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 300) return bad(c, 'rows_required');
  for (const b of (budgets ?? []).slice(0, 60)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.day ?? '')) continue;
    await c.env.DB.prepare(
      `INSERT INTO day_budgets (trip_id, day, currency, transport, accommodation, food, attractions, misc, total, myr_estimate)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (trip_id, day) DO UPDATE SET currency=excluded.currency, transport=excluded.transport,
         accommodation=excluded.accommodation, food=excluded.food, attractions=excluded.attractions,
         misc=excluded.misc, total=excluded.total, myr_estimate=excluded.myr_estimate`,
    ).bind(id, b.day, b.currency ?? 'JPY', b.transport ?? null, b.accommodation ?? null, b.food ?? null,
      b.attractions ?? null, b.misc ?? null, b.total ?? null, b.myr_estimate ?? null).run();
  }
  let created = 0, updated = 0;
  const errors: Array<{ row: number; error: string }> = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r.title?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(r.day ?? '')) {
      errors.push({ row: i + 1, error: 'title/day invalid' });
      continue;
    }
    try {
      if (r.id) {
        const own = await c.env.DB.prepare('SELECT id FROM activities WHERE id = ? AND trip_id = ?')
          .bind(Number(r.id), id).first();
        if (!own) { errors.push({ row: i + 1, error: 'unknown id' }); continue; }
        await c.env.DB.prepare(
          `UPDATE activities SET title=?, day=?, start_time=?, end_time=?, notes=?, location_name=?, lat=?, lng=?, est_cost_myr=?, done=?, category=COALESCE(?, category) WHERE id=?`,
        ).bind(r.title.trim(), r.day, r.start_time ?? null, r.end_time ?? null, r.notes ?? null,
          r.location_name ?? null, r.lat ?? null, r.lng ?? null, r.est_cost_myr ?? null,
          r.done ? 1 : 0, r.category ?? null, Number(r.id)).run();
        await saveActivityParticipants(c.env, Number(r.id), r.participant_ids ?? []);
        updated++;
      } else {
        const ins = await c.env.DB.prepare(
          `INSERT INTO activities (trip_id, title, day, start_time, end_time, notes, location_name, lat, lng, est_cost_myr, done, category)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).bind(id, r.title.trim(), r.day, r.start_time ?? null, r.end_time ?? null, r.notes ?? null,
          r.location_name ?? null, r.lat ?? null, r.lng ?? null, r.est_cost_myr ?? null, r.done ? 1 : 0, r.category ?? null).run();
        await saveActivityParticipants(c.env, Number(ins.meta.last_row_id), r.participant_ids ?? []);
        created++;
      }
    } catch {
      errors.push({ row: i + 1, error: 'save failed' });
    }
  }
  await audit(c.env, c.get('user').id, 'activities_bulk', 'trip', id);
  return c.json({ created, updated, errors });
});

app.post('/trips/:id/groups', requireLeader, async c => {
  const id = Number(c.req.param('id'));
  const { name, member_ids } = await c.req.json<any>();
  if (!name?.trim() || !member_ids?.length) return bad(c, 'missing_fields');
  const r = await c.env.DB.prepare('INSERT INTO groups (trip_id, name) VALUES (?,?)').bind(id, name.trim()).run();
  const gid = Number(r.meta.last_row_id);
  await c.env.DB.batch(member_ids.map((pid: number) =>
    c.env.DB.prepare('INSERT INTO group_members (group_id, participant_id) VALUES (?,?)').bind(gid, pid)));
  return c.json({ id: gid });
});

app.delete('/groups/:id', async c => {
  const id = Number(c.req.param('id'));
  const grp = await c.env.DB.prepare('SELECT trip_id FROM groups WHERE id = ?').bind(id).first<any>();
  if (!grp) return bad(c, 'not_found', 404);
  if (!(await needRole(c, grp.trip_id, 'leader'))) return bad(c, 'forbidden', 403);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM group_members WHERE group_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

/* ---------------- dashboard extras ---------------- */

app.get('/trips/:id/duedates', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  const rows = await c.env.DB.prepare(
    `SELECT d.*, e.description, e.vendor, p.name AS participant_name FROM due_dates d
     JOIN expenses e ON e.id = d.expense_id
     LEFT JOIN participants p ON p.id = d.participant_id
     WHERE e.trip_id = ? ORDER BY d.due_date`,
  ).bind(id).all();
  return c.json(rows.results);
});

app.patch('/duedates/:id', async c => {
  const id = Number(c.req.param('id'));
  const due = await c.env.DB.prepare(
    'SELECT e.trip_id FROM due_dates d JOIN expenses e ON e.id = d.expense_id WHERE d.id = ?',
  ).bind(id).first<any>();
  if (!due) return bad(c, 'not_found', 404);
  if (!(await needRole(c, due.trip_id, 'leader'))) return bad(c, 'forbidden', 403);
  const { settled } = await c.req.json<any>();
  await c.env.DB.prepare('UPDATE due_dates SET settled = ? WHERE id = ?')
    .bind(settled ? 1 : 0, id).run();
  return c.json({ ok: true });
});

/* ---------------- checklist (private per user) ---------------- */

app.get('/trips/:id/checklist', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  const rows = await c.env.DB.prepare(
    'SELECT * FROM checklist_items WHERE trip_id = ? AND user_id = ? ORDER BY done, sort, id',
  ).bind(id, c.get('user').id).all();
  return c.json(rows.results);
});

app.post('/trips/:id/checklist', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  const { text } = await c.req.json<any>();
  if (!text?.trim()) return bad(c, 'text_required');
  const r = await c.env.DB.prepare(
    'INSERT INTO checklist_items (trip_id, user_id, text) VALUES (?,?,?)',
  ).bind(id, c.get('user').id, text.trim()).run();
  return c.json({ id: r.meta.last_row_id });
});

app.patch('/checklist/:id', async c => {
  const id = Number(c.req.param('id'));
  const item = await c.env.DB.prepare('SELECT * FROM checklist_items WHERE id = ?').bind(id).first<any>();
  if (!item || item.user_id !== c.get('user').id) return bad(c, 'not_found', 404);
  const { done, text } = await c.req.json<any>();
  await c.env.DB.prepare('UPDATE checklist_items SET done = COALESCE(?, done), text = COALESCE(?, text) WHERE id = ?')
    .bind(done === undefined ? null : (done ? 1 : 0), text ?? null, id).run();
  return c.json({ ok: true });
});

app.delete('/checklist/:id', async c => {
  const id = Number(c.req.param('id'));
  const item = await c.env.DB.prepare('SELECT * FROM checklist_items WHERE id = ?').bind(id).first<any>();
  if (!item || item.user_id !== c.get('user').id) return bad(c, 'not_found', 404);
  await c.env.DB.prepare('DELETE FROM checklist_items WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

/* ---------------- FX ---------------- */

app.get('/fx', async c => {
  const date = c.req.query('date');
  const from = (c.req.query('from') ?? 'JPY').toUpperCase();
  const to = (c.req.query('to') ?? 'MYR').toUpperCase();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad(c, 'date_required');
  if (from === to) return c.json({ rate: 1, source: 'identity' });
  const cached = await c.env.DB.prepare(
    'SELECT rate FROM fx_rates WHERE rate_date = ? AND base = ? AND quote = ?',
  ).bind(date, from, to).first<any>();
  if (cached) return c.json({ rate: cached.rate, source: 'cache' });
  // future dates can't have a historical rate — use latest
  const today = new Date().toISOString().slice(0, 10);
  const q = date > today ? 'latest' : date;
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/${q}?base=${from}&symbols=${to}`);
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json<any>();
    const rate = data?.rates?.[to];
    if (!rate) throw new Error('no_rate');
    await c.env.DB.prepare(
      'INSERT OR REPLACE INTO fx_rates (rate_date, base, quote, rate) VALUES (?,?,?,?)',
    ).bind(date, from, to, rate).run();
    return c.json({ rate, source: q === 'latest' ? 'latest' : 'historical', rate_date: data.date });
  } catch {
    return bad(c, 'fx_unavailable', 502);
  }
});

/* ================================================================== */
/* v0.15 — trip forex widget (spec: docs/05-spec-v0.15-forex.md)      */
/* ================================================================== */

/** Frankfurter currency catalogue, cached in app_settings for 7 days. */
async function currencyList(env: Env): Promise<Array<{ code: string; name: string }>> {
  const cached = await getSettingJSON<{ at: string; list: Array<{ code: string; name: string }> }>(env, 'currency_list');
  if (cached && Date.now() - new Date(cached.at).getTime() < 7 * 86400000) return cached.list;
  try {
    const res = await fetch('https://api.frankfurter.dev/v2/currencies');
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json<any[]>();
    const list = data.map(x => ({ code: String(x.iso_code), name: String(x.name) }));
    if (!list.length) throw new Error('empty');
    await setSettingJSON(env, 'currency_list', { at: new Date().toISOString(), list });
    return list;
  } catch {
    // offline / upstream change: serve the stale cache, else a minimal set so
    // the pickers still work
    return cached?.list ?? [
      { code: 'MYR', name: 'Malaysian Ringgit' }, { code: 'JPY', name: 'Japanese Yen' },
      { code: 'USD', name: 'US Dollar' }, { code: 'EUR', name: 'Euro' },
    ];
  }
}

app.get('/currencies', async c => c.json(await currencyList(c.env)));

/** One Frankfurter range call per base per day fills a year of daily rates
 *  for every watched currency into fx_rates; all reads then hit D1 only. */
const fxFetchInFlight = new Map<string, Promise<void>>();
async function ensureFxSeries(env: Env, base: string, quotes: string[]): Promise<void> {
  if (!quotes.length) return;
  const today = new Date().toISOString().slice(0, 10); // server-side UTC day is fine here
  const key = `fx_series_fetched:${base}`;
  const state = await getSettingJSON<{ date: string; quotes: string[] }>(env, key);
  if (state?.date === today && quotes.every(q => state.quotes.includes(q))) return;
  const existing = fxFetchInFlight.get(base);
  if (existing) return existing;
  const work = (async () => {
    const all = [...new Set([...(state?.quotes ?? []), ...quotes])];
    const start = new Date(); start.setUTCDate(start.getUTCDate() - 370);
    const res = await fetch(
      `https://api.frankfurter.dev/v1/${start.toISOString().slice(0, 10)}..${today}?base=${base}&symbols=${all.join(',')}`);
    if (!res.ok) throw new Error('fx_unavailable');
    const data = await res.json<any>();
    const stmts: D1PreparedStatement[] = [];
    for (const [date, rates] of Object.entries<any>(data?.rates ?? {})) {
      for (const [q, r] of Object.entries<any>(rates)) {
        if (typeof r === 'number') {
          stmts.push(env.DB.prepare(
            'INSERT OR REPLACE INTO fx_rates (rate_date, base, quote, rate) VALUES (?,?,?,?)').bind(date, base, q, r));
        }
      }
    }
    for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50)); // D1 batch politeness
    if (stmts.length) await setSettingJSON(env, key, { date: today, quotes: all });
  })();
  fxFetchInFlight.set(base, work);
  try {
    await work;
  } finally {
    fxFetchInFlight.delete(base);
  }
}

app.get('/trips/:id/fxseries', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  const trip = await c.env.DB.prepare('SELECT base_currency, watch_currencies FROM trips WHERE id = ?').bind(id).first<any>();
  if (!trip) return bad(c, 'not_found', 404);
  let watch: string[] = [];
  try { watch = JSON.parse(trip.watch_currencies ?? '[]'); } catch { /* treat as empty */ }
  const quote = String(c.req.query('quote') ?? '').toUpperCase();
  const window = String(c.req.query('window') ?? '1m') as FxWindow;
  if (!watch.includes(quote)) return bad(c, 'not_watched');
  if (!(window in FX_WINDOWS)) return bad(c, 'bad_window');
  try { await ensureFxSeries(c.env, trip.base_currency, watch); } catch { /* stale cache below still serves */ }
  const start = new Date(); start.setUTCDate(start.getUTCDate() - FX_WINDOWS[window]);
  const rows = await c.env.DB.prepare(
    'SELECT rate_date, rate FROM fx_rates WHERE base = ? AND quote = ? AND rate_date >= ? ORDER BY rate_date',
  ).bind(trip.base_currency, quote, start.toISOString().slice(0, 10)).all();
  const points = (rows.results as any[]).map(r => ({ date: r.rate_date, rate: r.rate }));
  if (!points.length) return bad(c, 'fx_unavailable', 502);
  const { band, signal } = analyzeRates(points.map(p => p.rate));
  await trackUsage(c.env, c.get('user').id, 'fx_view');
  return c.json({ base: trip.base_currency, quote, window, points, band, signal, current: points[points.length - 1] });
});

app.patch('/trips/:id/currencies', requireLeader, async c => {
  const id = Number(c.req.param('id'));
  const trip = await c.env.DB.prepare('SELECT base_currency, watch_currencies FROM trips WHERE id = ?').bind(id).first<any>();
  if (!trip) return bad(c, 'not_found', 404);
  const b = await c.req.json<any>();
  const codes = new Set((await currencyList(c.env)).map(x => x.code));
  let base: string = trip.base_currency;
  if (b.base_currency !== undefined) {
    base = String(b.base_currency).toUpperCase();
    if (!codes.has(base)) return bad(c, 'bad_currency');
  }
  let watch: string[];
  try { watch = JSON.parse(trip.watch_currencies ?? '[]'); } catch { watch = []; }
  const watchCurrencies = b.watch_currencies;
  if (watchCurrencies !== undefined) {
    if (!Array.isArray(watchCurrencies)) return bad(c, 'bad_watch');
    watch = [...new Set(watchCurrencies.map((x: any) => String(x).toUpperCase()))];
    if (watch.some(w => !codes.has(w))) return bad(c, 'bad_currency');
  }
  watch = watch.filter(w => w !== base);           // never watch the reference itself
  if (watch.length > 6) return bad(c, 'too_many_currencies');
  await c.env.DB.prepare('UPDATE trips SET base_currency = ?, watch_currencies = ? WHERE id = ?')
    .bind(base, JSON.stringify(watch), id).run();
  return c.json({ ok: true, base_currency: base, watch_currencies: watch });
});

/* ================================================================== */
/* v0.17 — invites, join & referrals (spec §Registration + Addendum 1) */
/* ================================================================== */

const inviteUrl = (code: string) => `/join/${code}`;
const makeCode = () => newInviteCode(crypto.getRandomValues(new Uint8Array(16)));
const inviteRow = (i: any) => ({
  id: i.id, code: i.code, url: inviteUrl(i.code), kind: i.kind, role: i.role,
  expires_at: i.expires_at, max_uses: i.max_uses, used_count: i.used_count,
  revoked: !!i.revoked, created_at: i.created_at,
});

app.post('/trips/:id/invites', requireLeader, async c => {
  const tripId = Number(c.req.param('id'));
  const b = await c.req.json<any>().catch(() => ({}));
  const role = b.role === 'editor' ? 'editor' : 'viewer';
  const days = Math.min(Math.max(Number(b.expires_days) || 14, 1), 90);
  const maxUses = Math.min(Math.max(Number(b.max_uses) || 10, 1), 50);
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  const code = makeCode();
  const user: SessionUser = c.get('user');
  const r = await c.env.DB.prepare(
    `INSERT INTO invites (code, kind, trip_id, role, created_by, expires_at, max_uses) VALUES (?,?,?,?,?,?,?)`,
  ).bind(code, 'trip', tripId, role, user.id, expires, maxUses).run();
  await audit(c.env, user.id, 'invite_create', 'trip', tripId);
  return c.json({ id: Number(r.meta.last_row_id), code, url: inviteUrl(code), role, expires_at: expires, max_uses: maxUses });
});

app.get('/trips/:id/invites', requireLeader, async c => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM invites WHERE kind = 'trip' AND trip_id = ? ORDER BY revoked, id DESC",
  ).bind(Number(c.req.param('id'))).all();
  return c.json((rows.results as any[]).map(inviteRow));
});

app.post('/invites/platform', requireAdmin, async c => {
  const b = await c.req.json<any>().catch(() => ({}));
  const days = Math.min(Math.max(Number(b.expires_days) || 14, 1), 90);
  const maxUses = Math.min(Math.max(Number(b.max_uses) || 5, 1), 50);
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  const code = makeCode();
  const user: SessionUser = c.get('user');
  const r = await c.env.DB.prepare(
    `INSERT INTO invites (code, kind, created_by, expires_at, max_uses) VALUES (?,?,?,?,?)`,
  ).bind(code, 'platform', user.id, expires, maxUses).run();
  await audit(c.env, user.id, 'invite_create', 'platform', Number(r.meta.last_row_id));
  return c.json({ id: Number(r.meta.last_row_id), code, url: inviteUrl(code), expires_at: expires, max_uses: maxUses });
});

app.get('/invites/platform', requireAdmin, async c => {
  const rows = await c.env.DB.prepare(
    `SELECT i.*, u.name AS created_by_name FROM invites i JOIN users u ON u.id = i.created_by
     WHERE i.kind IN ('platform','referral') ORDER BY i.revoked, i.id DESC`).all();
  return c.json((rows.results as any[]).map(i => ({ ...inviteRow(i), created_by_name: i.created_by_name })));
});

const referralsEnabled = async (env: Env) =>
  (await getSettingJSON<{ enabled: boolean }>(env, 'referrals_enabled'))?.enabled ?? true;

app.get('/invites/referral', async c => {
  const user: SessionUser = c.get('user');
  let row = await c.env.DB.prepare(
    "SELECT * FROM invites WHERE kind = 'referral' AND created_by = ? AND revoked = 0").bind(user.id).first<any>();
  if (!row) {
    const code = makeCode();
    await c.env.DB.prepare(
      `INSERT INTO invites (code, kind, created_by, expires_at, max_uses) VALUES (?,'referral',?,NULL,20)`,
    ).bind(code, user.id).run();
    row = await c.env.DB.prepare('SELECT * FROM invites WHERE code = ?').bind(code).first<any>();
  }
  return c.json({ ...inviteRow(row), enabled: await referralsEnabled(c.env) });
});

app.delete('/invites/:id', async c => {
  const user: SessionUser = c.get('user');
  const inv = await c.env.DB.prepare('SELECT * FROM invites WHERE id = ?').bind(Number(c.req.param('id'))).first<any>();
  if (!inv) return bad(c, 'not_found', 404);
  const isIssuer = inv.created_by === user.id;
  const isTripLeader = inv.kind === 'trip' && inv.trip_id != null && await needRole(c, inv.trip_id, 'leader');
  if (!isIssuer && !isTripLeader && user.role !== 'admin') return bad(c, 'forbidden', 403);
  await c.env.DB.prepare('UPDATE invites SET revoked = 1 WHERE id = ?').bind(inv.id).run();
  await audit(c.env, user.id, 'invite_revoke', 'invite', inv.id);
  return c.json({ ok: true });
});

app.get('/settings/referrals', requireAdmin, async c => c.json({ enabled: await referralsEnabled(c.env) }));
app.put('/settings/referrals', requireAdmin, async c => {
  const b = await c.req.json<any>();
  await setSettingJSON(c.env, 'referrals_enabled', { enabled: !!b.enabled });
  return c.json({ ok: true, enabled: !!b.enabled });
});

/** KV counter: max N join attempts per IP per hour. FILES doubles as the store. */
async function joinRateLimited(c: any): Promise<boolean> {
  try {
    const ip = c.req.header('CF-Connecting-IP') ?? 'local';
    const key = `rl:join:${ip}:${new Date().toISOString().slice(0, 13)}`; // per-hour bucket
    const store = c.env.FILES;
    if (!isKV(store)) return false; // R2-bound: skip limiting
    const n = Number((await store.get(key)) ?? 0) + 1;
    await store.put(key, String(n), { expirationTtl: 7200 });
    return n > 20;
  } catch { return false; } // limiter must never take the door down
}

async function loadInvite(env: Env, code: string): Promise<any | null> {
  if (!/^inv_[0-9a-f]{32}$/.test(code)) return null;
  const inv = await env.DB.prepare('SELECT * FROM invites WHERE code = ?').bind(code).first<any>();
  if (!inv) return null;
  if (checkInvite(inv, new Date().toISOString()) !== 'ok') return null;
  if (inv.kind === 'referral' && !(await referralsEnabled(env))) return null;
  const issuer = await env.DB.prepare('SELECT disabled FROM users WHERE id = ?').bind(inv.created_by).first<any>();
  if (!issuer || issuer.disabled) return null; // a disabled account's links die with it
  return inv;
}

app.get('/join/:code', async c => {
  const inv = await loadInvite(c.env, c.req.param('code'));
  if (!inv) return c.json({ valid: false }, 404);
  const inviter = await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(inv.created_by).first<any>();
  if (inv.kind === 'trip') {
    const trip = await c.env.DB.prepare('SELECT name FROM trips WHERE id = ?').bind(inv.trip_id).first<any>();
    return c.json({ valid: true, kind: inv.kind, trip_name: trip?.name ?? null, inviter_name: inviter?.name ?? null, role: inv.role });
  }
  return c.json({ valid: true, kind: inv.kind, inviter_name: inviter?.name ?? null });
});

app.post('/join/:code', async c => {
  const inv = await loadInvite(c.env, c.req.param('code'));
  if (!inv) return c.json({ valid: false }, 404);
  if (await joinRateLimited(c)) return bad(c, 'rate_limited', 429);

  const body = await c.req.json<any>().catch(() => ({}));
  const name = String(body.name ?? '').trim().slice(0, 80);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!name || !email) return bad(c, 'missing_fields');

  const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<any>();
  if (existing) return bad(c, 'email_taken');
  if (password.length < 8) return bad(c, 'weak_password');

  const inc = await c.env.DB.prepare(
    'UPDATE invites SET used_count = used_count + 1 WHERE id = ? AND used_count < max_uses',
  ).bind(inv.id).run();
  if (!inc.meta.changes) return c.json({ valid: false }, 404);

  const lang = body.lang === 'ms' ? 'ms' : 'en';
  const { hash, salt } = await hashPassword(password);
  const r = await c.env.DB.prepare(
    `INSERT INTO users (email, name, password_hash, salt, lang, referred_by, referral_invite_id, must_change_password)
     VALUES (?,?,?,?,?,?,?,0)`,
  ).bind(email, name, hash, salt, lang, inv.created_by, inv.id).run();
  const userId = Number(r.meta.last_row_id);

  let tripId: number | undefined;
  if (inv.kind === 'trip') {
    const p = await c.env.DB.prepare('INSERT INTO participants (name) VALUES (?)').bind(name).run();
    const participantId = Number(p.meta.last_row_id);
    await c.env.DB.prepare('UPDATE users SET participant_id = ? WHERE id = ?').bind(participantId, userId).run();
    await c.env.DB.prepare('INSERT OR IGNORE INTO trip_members (trip_id, participant_id, role) VALUES (?,?,?)')
      .bind(inv.trip_id, participantId, inv.role).run();
    tripId = inv.trip_id;
  }

  const token = await createSession(c.env, userId);
  await audit(c.env, userId, 'join_register', 'invite', inv.id);
  await trackUsage(c.env, userId, 'join_register');
  c.header('Set-Cookie', sessionCookie(token));
  return c.json({ ok: true, ...(tripId != null ? { trip_id: tripId } : {}) });
});

app.post('/join/:code/accept', async c => {
  const inv = await loadInvite(c.env, c.req.param('code'));
  if (!inv) return c.json({ valid: false }, 404);
  const user: SessionUser = c.get('user');
  if (inv.kind !== 'trip') return c.json({ ok: true });

  let participantId = user.participant_id;
  if (!participantId) {
    const p = await c.env.DB.prepare('INSERT INTO participants (name) VALUES (?)').bind(user.name).run();
    participantId = Number(p.meta.last_row_id);
    await c.env.DB.prepare('UPDATE users SET participant_id = ? WHERE id = ?').bind(participantId, user.id).run();
  }

  const existingMember = await c.env.DB.prepare(
    'SELECT 1 FROM trip_members WHERE trip_id = ? AND participant_id = ?',
  ).bind(inv.trip_id, participantId).first();
  if (existingMember) return c.json({ ok: true, already: true });

  const inc = await c.env.DB.prepare(
    'UPDATE invites SET used_count = used_count + 1 WHERE id = ? AND used_count < max_uses',
  ).bind(inv.id).run();
  if (!inc.meta.changes) return c.json({ valid: false }, 404);

  await c.env.DB.prepare('INSERT OR IGNORE INTO trip_members (trip_id, participant_id, role) VALUES (?,?,?)')
    .bind(inv.trip_id, participantId, inv.role).run();
  await audit(c.env, user.id, 'join_accept', 'invite', inv.id);
  return c.json({ ok: true });
});

/* ================================================================== */
/* v0.12 — AI provider settings, assistant proxy, API tokens, MCP     */
/* ================================================================== */

interface AiConfig { base_url: string; api_key: string; model: string }
const aiConfig = (env: Env) => getSettingJSON<AiConfig>(env, 'ai_provider');

class AiError extends Error { code: string; detail?: string; constructor(code: string, detail?: string) { super(code); this.code = code; this.detail = detail; } }

/** OpenAI-compatible chat call — works with Gemini's compat endpoint, OpenRouter, Groq, Ollama…
 *  maxTokens is generous because "thinking" models (e.g. gemini-2.5-flash) spend
 *  part of the budget on internal reasoning before any visible text appears. */
/** Shared error-detail extraction for a non-OK provider response. */
async function aiHttpError(res: Response): Promise<AiError> {
  if (res.status === 429) return new AiError('ai_rate_limited');
  let detail = `HTTP ${res.status}`;
  try {
    const body: any = await res.json();
    const msg = body?.error?.message ?? body?.error ?? body?.message;
    if (msg) detail = `HTTP ${res.status}: ${String(typeof msg === 'string' ? msg : JSON.stringify(msg)).slice(0, 300)}`;
  } catch { /* keep the status */ }
  return new AiError('ai_error', detail);
}

/** Gemini's native generateContent API — works with both AIza… and the new
 *  AQ.… key formats (the OpenAI-compat layer rejects many AQ. keys). */
async function callGeminiNative(cfg: AiConfig, messages: Array<{ role: string; content: string }>, maxTokens: number): Promise<string> {
  const origin = (() => { try { return new URL(cfg.base_url).origin; } catch { return 'https://generativelanguage.googleapis.com'; } })();
  const model = cfg.model.replace(/^models\//, '');
  let res: Response;
  try {
    res = await fetch(`${origin}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.api_key },
      body: JSON.stringify(buildGeminiNativeBody(messages, maxTokens)),
    });
  } catch { throw new AiError('ai_unreachable'); }
  if (!res.ok) throw await aiHttpError(res);
  const data: any = await res.json().catch(() => null);
  const { text, finishReason } = parseGeminiNativeResponse(data);
  if (!text.trim()) {
    throw new AiError('ai_error', finishReason === 'MAX_TOKENS'
      ? 'The model spent the whole token budget thinking and returned no text — try again.'
      : `The provider returned an empty reply${finishReason ? ` (${finishReason})` : ''}.`);
  }
  return text;
}

async function callAI(env: Env, messages: Array<{ role: string; content: string }>, maxTokens = 3000): Promise<string> {
  const cfg = await aiConfig(env);
  if (!cfg?.base_url || !cfg.api_key || !cfg.model) throw new AiError('ai_not_configured');
  // Gemini goes through its native API (new AQ. keys break on the compat layer)
  if (/generativelanguage\.googleapis\.com/i.test(cfg.base_url)) return callGeminiNative(cfg, messages, maxTokens);
  let res: Response;
  try {
    res = await fetch(`${cfg.base_url.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.api_key}` },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.7, max_tokens: maxTokens }),
    });
  } catch { throw new AiError('ai_unreachable'); }
  if (!res.ok) throw await aiHttpError(res);
  const data: any = await res.json().catch(() => null);
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) {
    const fin = data?.choices?.[0]?.finish_reason;
    throw new AiError('ai_error', fin === 'length'
      ? 'The model spent the whole token budget thinking and returned no text — try again or use a larger budget.'
      : 'The provider returned an empty reply.');
  }
  return text;
}

const aiFail = (c: any, e: any) => {
  const code = e?.code ?? 'ai_error';
  const status = code === 'ai_rate_limited' ? 429 : code === 'ai_not_configured' ? 503 : 502;
  return c.json({ error: code, detail: e?.detail }, status);
};

/* ---- AI provider settings (admin) ---- */

app.get('/settings/ai', requireAdmin, async c => {
  const cfg = await aiConfig(c.env);
  return c.json({
    configured: !!(cfg?.base_url && cfg.api_key && cfg.model),
    base_url: cfg?.base_url ?? '', model: cfg?.model ?? '',
    key_hint: cfg?.api_key ? `••••${cfg.api_key.slice(-4)}` : '',
  });
});

app.put('/settings/ai', requireAdmin, async c => {
  const b = await c.req.json<any>();
  const prev = await aiConfig(c.env);
  const cfg: AiConfig = {
    base_url: String(b.base_url ?? '').trim(),
    model: String(b.model ?? '').trim(),
    api_key: b.api_key ? String(b.api_key).trim() : prev?.api_key ?? '', // omit to keep the stored key
  };
  await setSettingJSON(c.env, 'ai_provider', cfg);
  await audit(c.env, c.get('user').id, 'ai_settings_update');
  return c.json({ ok: true });
});

app.post('/settings/ai/test', requireAdmin, async c => {
  try {
    // generous budget: thinking models consume tokens before emitting text
    const reply = await callAI(c.env, [{ role: 'user', content: 'Reply with the single word OK.' }], 1024);
    return c.json({ ok: true, reply: reply.slice(0, 80) });
  } catch (e: any) { return aiFail(c, e); }
});

/* ---- per-user trip context for the assistant ---- */

function tripDays(start?: string | null, end?: string | null): string[] {
  if (!start || !end) return [];
  const out: string[] = [];
  const d = new Date(start + 'T00:00:00Z');
  const stop = new Date(end + 'T00:00:00Z');
  while (d <= stop && out.length < 60) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Build the text context the model sees — mirrors what THIS user can see in the UI. */
async function tripContext(c: any, tripId: number, includeMoney: boolean): Promise<string> {
  const env: Env = c.env;
  const user: SessionUser = c.get('user');
  const hidden = await hiddenFor(c, tripId);
  const trip = await env.DB.prepare('SELECT * FROM trips WHERE id = ?').bind(tripId).first<any>();
  const parts = await env.DB.prepare(
    'SELECT p.* FROM participants p JOIN trip_members m ON m.participant_id = p.id WHERE m.trip_id = ? ORDER BY p.name',
  ).bind(tripId).all();
  const blocks: string[] = [];
  blocks.push(`TRIP: ${trip.name} — ${trip.destination ?? ''} (${trip.start_date} to ${trip.end_date}). Today is ${new Date().toISOString().slice(0, 10)}.`);
  blocks.push(`TRAVELLERS (${parts.results.length}): ${(parts.results as any[]).map(p => p.name + (p.is_infant ? ' (infant)' : '')).join(', ')}`);

  if (!hidden.has('plan')) {
    const acts = await env.DB.prepare(
      'SELECT * FROM activities WHERE trip_id = ? ORDER BY day, sort, start_time, id',
    ).bind(tripId).all();
    const dayTitles = await env.DB.prepare(
      `SELECT day, title FROM day_settings WHERE trip_id = ? AND title IS NOT NULL AND title <> ''`,
    ).bind(tripId).all();
    const titleOf = new Map((dayTitles.results as any[]).map(d => [d.day, d.title]));
    const lines = (acts.results as any[]).slice(0, 120).map(a =>
      `${a.day}${titleOf.has(a.day) ? ` [${titleOf.get(a.day)}]` : ''} ${a.start_time ?? '--:--'}${a.end_time ? '-' + a.end_time : ''} ${a.title}${a.location_name ? ` @ ${a.location_name}` : ''}${a.notes ? ` (${String(a.notes).slice(0, 80)})` : ''}${a.done ? ' [done]' : ''}`);
    blocks.push(`ITINERARY:\n${lines.join('\n') || '(empty)'}`);
    const titledEmptyDays = (dayTitles.results as any[])
      .filter(d => d.day !== '*' && !(acts.results as any[]).some(a => a.day === d.day));
    if (titledEmptyDays.length) {
      blocks.push(`DAY THEMES (no activities planned yet):\n${titledEmptyDays.map(d => `${d.day}: ${d.title}`).join('\n')}`);
    }
    // Day notes & checklist — the free-text intentions and to-dos the planner
    // jots under each day. Same 'plan' visibility gate as the itinerary above.
    const notes = await env.DB.prepare(
      'SELECT day, content, is_check, done FROM day_notes WHERE trip_id = ? ORDER BY day, sort, id',
    ).bind(tripId).all();
    if (notes.results.length) {
      const byDay = new Map<string, string[]>();
      for (const n of (notes.results as any[]).slice(0, 150)) {
        const mark = n.is_check ? (n.done ? '[x]' : '[ ]') : '-';
        if (!byDay.has(n.day)) byDay.set(n.day, []);
        byDay.get(n.day)!.push(`${mark} ${String(n.content).slice(0, 160)}`);
      }
      const noteLines = [...byDay.entries()].map(([day, ls]) =>
        `${day}${titleOf.has(day) ? ` [${titleOf.get(day)}]` : ''}:\n  ${ls.join('\n  ')}`);
      blocks.push(`DAY NOTES & CHECKLIST (things the planner wrote down; [ ] = still to do):\n${noteLines.join('\n')}`);
    }
    const bookings = await env.DB.prepare(
      `SELECT description, category, expense_date, end_date, location FROM expenses WHERE trip_id = ? AND category IN ('flight','accommodation') ORDER BY expense_date`,
    ).bind(tripId).all();
    if (bookings.results.length) {
      blocks.push(`BOOKINGS:\n${(bookings.results as any[]).map(b =>
        `${b.category} ${b.expense_date ?? ''}${b.end_date ? '→' + b.end_date : ''} ${b.description}${b.location ? ` @ ${b.location}` : ''}`).join('\n')}`);
    }
    const budgets = await env.DB.prepare('SELECT * FROM day_budgets WHERE trip_id = ? ORDER BY day').bind(tripId).all();
    if (budgets.results.length) {
      blocks.push(`DAY BUDGETS (display-only):\n${(budgets.results as any[]).map(b => `${b.day}: ${b.currency}${b.total ?? 0}`).join('\n')}`);
    }
  }

  if (includeMoney && !hidden.has('payments') && !hidden.has('ledger')) {
    const data = await computeBalances(env, tripId);
    const isLeader = atLeast(await tripRole(env, user, tripId), 'leader');
    const visible = isLeader ? data.balances : data.balances.filter((b: any) => b.participant.id === user.participant_id);
    const nameOf = new Map((parts.results as any[]).map(p => [p.id, p.name]));
    const lines = (visible as any[]).map(b =>
      `${b.participant.name}: owes RM${b.outstanding} outstanding (paid RM${b.paid})` +
      b.byPayee.map((bp: any) => ` → RM${bp.remaining} to ${nameOf.get(bp.to_participant_id) ?? '?'}`).join(''));
    blocks.push(`MONEY (MYR): trip total RM${data.tripTotal}${data.committedTotal ? `, committed (pay at hotel, not yet owed) RM${data.committedTotal}` : ''}\n${lines.join('\n')}`);
    if (isLeader) {
      blocks.push(`EXPENSES:\n${(data.expenseItems as any[]).slice(0, 60).map((e: any) =>
        `${e.expense_date ?? ''} ${e.description} RM${e.amount_myr}${e.payment_status === 'pay_at_hotel' ? ' [pay at hotel]' : ''}`).join('\n')}`);
    }
    const dues = await env.DB.prepare(
      `SELECT d.due_date, d.amount_myr, d.note, d.participant_id, e.description FROM due_dates d
       JOIN expenses e ON e.id = d.expense_id WHERE e.trip_id = ? ORDER BY d.due_date`,
    ).bind(tripId).all();
    const myDues = (dues.results as any[]).filter(d =>
      isLeader || d.participant_id == null || d.participant_id === user.participant_id);
    if (myDues.length) {
      blocks.push(`PAYMENT DUE DATES:\n${myDues.map(d =>
        `${d.due_date} ${d.description}${d.amount_myr ? ` RM${d.amount_myr}` : ''}${d.participant_id ? ` (for ${nameOf.get(d.participant_id) ?? '?'})` : ' (whole payment)'}`).join('\n')}`);
    }
  }

  if (includeMoney) {
    const mine = await env.DB.prepare(
      'SELECT spend_date, description, amount_myr FROM personal_expenses WHERE trip_id = ? AND user_id = ? ORDER BY spend_date',
    ).bind(tripId, user.id).all();
    if (mine.results.length) {
      blocks.push(`MY PRIVATE SPEND (only ${user.name} can see this):\n${(mine.results as any[]).slice(0, 40).map((m: any) =>
        `${m.spend_date} ${m.description} RM${m.amount_myr}`).join('\n')}`);
    }
  }
  let ctx = blocks.join('\n\n');
  if (ctx.length > 9000) ctx = ctx.slice(0, 9000) + '\n…(truncated)';
  return ctx;
}

const assistantHidden = async (c: any, tripId: number) => (await hiddenFor(c, tripId)).has('assistant');

/* ---- assistant endpoints ---- */

app.post('/trips/:id/assistant/suggest', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  if (await assistantHidden(c, id)) return bad(c, 'feature_hidden', 403);
  const { prompt, day } = await c.req.json<any>();
  if (!prompt?.trim()) return bad(c, 'prompt_required');
  const trip = await c.env.DB.prepare('SELECT start_date, end_date FROM trips WHERE id = ?').bind(id).first<any>();
  const validDays = tripDays(trip?.start_date, trip?.end_date);
  const ctx = await tripContext(c, id, false);
  // free slots for the focus day (or each day when unscoped)
  const acts = await c.env.DB.prepare('SELECT day, start_time, end_time FROM activities WHERE trip_id = ?').bind(id).all();
  const byDay = new Map<string, any[]>();
  for (const a of acts.results as any[]) {
    if (!byDay.has(a.day)) byDay.set(a.day, []);
    byDay.get(a.day)!.push(a);
  }
  const slotDays = day ? [day] : validDays;
  const slotLines = slotDays.slice(0, 30).map(d => {
    const slots = freeSlots(byDay.get(d) ?? []);
    return `${d}: ${slots.length ? slots.map(s => `${s.start}-${s.end}`).join(', ') : 'fully booked'}`;
  });
  try {
    const text = await callAI(c.env, [
      { role: 'system', content: suggestSystemPrompt() },
      { role: 'user', content: `${ctx}\n\nFREE SLOTS:\n${slotLines.join('\n')}\n\nREQUEST: ${String(prompt).slice(0, 500)}${day ? ` (focus on day ${day})` : ''}` },
    ]);
    await trackUsage(c.env, c.get('user').id, 'ai_suggest');
    return c.json({ suggestions: parseSuggestions(text, validDays) });
  } catch (e: any) { return aiFail(c, e); }
});

app.post('/trips/:id/assistant/chat', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  if (await assistantHidden(c, id)) return bad(c, 'feature_hidden', 403);
  const b = await c.req.json<any>();
  const lang = b.lang === 'ms' || b.lang === 'ms-swk' ? b.lang : 'en';
  const history = Array.isArray(b.messages) ? b.messages.slice(-12) : [];
  const msgs = history
    .filter((m: any) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
    .map((m: any) => ({ role: m.role, content: m.content.slice(0, 2000) }));
  if (!msgs.length) return bad(c, 'messages_required');
  const ctx = await tripContext(c, id, true);
  try {
    const reply = await callAI(c.env, [
      { role: 'system', content: `${chatSystemPrompt(lang)}\n\nTRIP CONTEXT:\n${ctx}` },
      ...msgs,
    ], 900);
    await trackUsage(c.env, c.get('user').id, 'ai_chat');
    return c.json({ reply });
  } catch (e: any) { return aiFail(c, e); }
});

/* ---- personal access tokens (for MCP clients) ---- */

app.get('/tokens', async c => {
  const rows = await c.env.DB.prepare(
    'SELECT id, name, created_at, last_used_at, revoked FROM api_tokens WHERE user_id = ? ORDER BY id DESC',
  ).bind(c.get('user').id).all();
  return c.json(rows.results);
});

app.post('/tokens', async c => {
  const { name } = await c.req.json<any>();
  if (!name?.trim()) return bad(c, 'name_required');
  const token = `jlj_${randomToken()}`;
  const r = await c.env.DB.prepare(
    'INSERT INTO api_tokens (user_id, name, token_hash) VALUES (?,?,?)',
  ).bind(c.get('user').id, name.trim().slice(0, 60), await hashToken(token)).run();
  await audit(c.env, c.get('user').id, 'token_create', 'token', Number(r.meta.last_row_id));
  return c.json({ id: Number(r.meta.last_row_id), token }); // token is shown ONCE
});

app.delete('/tokens/:id', async c => {
  const id = Number(c.req.param('id'));
  await c.env.DB.prepare('UPDATE api_tokens SET revoked = 1 WHERE id = ? AND user_id = ?')
    .bind(id, c.get('user').id).run();
  await audit(c.env, c.get('user').id, 'token_revoke', 'token', id);
  return c.json({ ok: true });
});

/* ---- MCP server: Streamable HTTP, JSON-RPC 2.0 ---- */

async function mcpUser(env: Env, authHeader: string | undefined): Promise<SessionUser | null> {
  const m = authHeader?.match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const hash = await hashToken(m[1]);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.lang, u.participant_id, u.must_change_password, t.id AS token_id
     FROM api_tokens t JOIN users u ON u.id = t.user_id
     WHERE t.token_hash = ? AND t.revoked = 0 AND u.disabled = 0`,
  ).bind(hash).first<any>();
  if (!row) return null;
  env.DB.prepare(`UPDATE api_tokens SET last_used_at = datetime('now') WHERE id = ?`)
    .bind(row.token_id).run().catch(() => { /* best-effort */ });
  const { token_id: _t, ...user } = row;
  return user as SessionUser;
}

async function mcpTripAccess(env: Env, user: SessionUser, tripId: number): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (!user.participant_id) return false;
  return !!(await env.DB.prepare('SELECT 1 FROM trip_members WHERE trip_id = ? AND participant_id = ?')
    .bind(tripId, user.participant_id).first());
}

async function mcpHidden(env: Env, user: SessionUser, tripId: number): Promise<Set<string>> {
  if (atLeast(await tripRole(env, user, tripId), 'leader')) return new Set();
  const t: any = await env.DB.prepare('SELECT hidden_features FROM trips WHERE id = ?').bind(tripId).first();
  try { return new Set(JSON.parse(t?.hidden_features ?? '[]')); } catch { return new Set(); }
}

const MCP_TOOLS = [
  { name: 'list_trips', description: 'List the trips this token can see.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'get_itinerary',
    description: 'Get the itinerary for a trip: activities (with times, places, notes), flight/stay bookings, and per-day budgets. Optionally filter to one day (YYYY-MM-DD).',
    inputSchema: { type: 'object', properties: { trip_id: { type: 'number' }, day: { type: 'string' } }, required: ['trip_id'] },
  },
  {
    name: 'get_balances',
    description: 'Read-only: who owes whom for a trip (outstanding amounts in MYR, targeted-settlement aware).',
    inputSchema: { type: 'object', properties: { trip_id: { type: 'number' } }, required: ['trip_id'] },
  },
  {
    name: 'get_expenses',
    description: 'Read-only: the trip expense ledger (a member token sees only expenses it shares in).',
    inputSchema: { type: 'object', properties: { trip_id: { type: 'number' } }, required: ['trip_id'] },
  },
  {
    name: 'suggest_free_slots',
    description: 'Gaps between timed activities on one day — where new activities fit.',
    inputSchema: { type: 'object', properties: { trip_id: { type: 'number' }, day: { type: 'string' } }, required: ['trip_id', 'day'] },
  },
  {
    name: 'add_activity',
    description: 'Add an itinerary activity (needs an editor role on the trip). If "place" is given it is geocoded so the activity gets a map pin.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number' }, day: { type: 'string', description: 'YYYY-MM-DD' },
        title: { type: 'string' }, start_time: { type: 'string', description: 'HH:MM' },
        duration_min: { type: 'number' }, notes: { type: 'string' }, place: { type: 'string' },
        category: { type: 'string', enum: ['sightseeing', 'food', 'transport', 'lodging', 'shopping', 'other'] },
      },
      required: ['trip_id', 'day', 'title'],
    },
  },
  {
    name: 'update_activity',
    description: 'Update fields of an activity by id (needs an editor role on the trip). Only provided fields change.',
    inputSchema: {
      type: 'object',
      properties: {
        activity_id: { type: 'number' }, day: { type: 'string' }, title: { type: 'string' },
        start_time: { type: 'string' }, end_time: { type: 'string' }, notes: { type: 'string' },
        done: { type: 'boolean' },
      },
      required: ['activity_id'],
    },
  },
  {
    name: 'delete_activity',
    description: 'Delete an activity by id (needs an editor role on the trip).',
    inputSchema: { type: 'object', properties: { activity_id: { type: 'number' } }, required: ['activity_id'] },
  },
  {
    name: 'get_notes',
    description: "Read the day notes and checklist items written under the plan — the planner's free-text intentions and to-dos. Optionally filter to one day (YYYY-MM-DD). Checklist items carry a done flag; plain notes do not.",
    inputSchema: { type: 'object', properties: { trip_id: { type: 'number' }, day: { type: 'string' } }, required: ['trip_id'] },
  },
  {
    name: 'add_note',
    description: 'Add a note or checklist item under a day of the plan (needs an editor role on the trip). Set is_check true for a tickable to-do, false for a plain note.',
    inputSchema: {
      type: 'object',
      properties: {
        trip_id: { type: 'number' }, day: { type: 'string', description: 'YYYY-MM-DD' },
        content: { type: 'string' }, is_check: { type: 'boolean' },
      },
      required: ['trip_id', 'day', 'content'],
    },
  },
  {
    name: 'update_note',
    description: 'Update a note by id (needs an editor role on the trip): change its text, or tick/untick a checklist item. Only provided fields change.',
    inputSchema: {
      type: 'object',
      properties: { note_id: { type: 'number' }, content: { type: 'string' }, done: { type: 'boolean' }, is_check: { type: 'boolean' } },
      required: ['note_id'],
    },
  },
  {
    name: 'delete_note',
    description: 'Delete a day note by id (needs an editor role on the trip).',
    inputSchema: { type: 'object', properties: { note_id: { type: 'number' } }, required: ['note_id'] },
  },
  {
    name: 'set_day_title',
    description: "Name what a day of the trip is about (needs an editor role on the trip) — e.g. 'Arrival & Shinjuku night walk'. Shown on the day tab. Pass an empty title to clear it.",
    inputSchema: {
      type: 'object',
      properties: { trip_id: { type: 'number' }, day: { type: 'string', description: 'YYYY-MM-DD' }, title: { type: 'string' } },
      required: ['trip_id', 'day', 'title'],
    },
  },
];

/** Server-side geocode (Photon → Nominatim) for MCP add_activity. */
async function geocodeServer(q: string): Promise<{ name: string; lat: number; lng: number } | null> {
  try {
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=1`);
    if (res.ok) {
      const data: any = await res.json();
      const f = data.features?.[0];
      if (f) {
        return {
          name: [f.properties.name, f.properties.city ?? f.properties.county].filter(Boolean).join(', '),
          lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0],
        };
      }
    }
  } catch { /* fall through */ }
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': 'jelajah-app' } });
    const data: any = await res.json();
    if (data?.[0]) return { name: String(data[0].display_name).split(',').slice(0, 2).join(','), lat: Number(data[0].lat), lng: Number(data[0].lon) };
  } catch { /* no coords */ }
  return null;
}

class McpError extends Error { code: number; constructor(code: number, message: string) { super(message); this.code = code; } }

async function mcpToolCall(env: Env, user: SessionUser, name: string, args: any): Promise<unknown> {
  const needTrip = async (tripId: number) => {
    if (!Number.isFinite(tripId)) throw new McpError(-32602, 'trip_id required');
    if (!(await mcpTripAccess(env, user, tripId))) throw new McpError(-32000, 'No access to that trip');
  };
  const needTripRole = async (tripId: number, min: TripRole) => {
    await needTrip(tripId);
    if (!atLeast(await tripRole(env, user, tripId), min)) throw new McpError(-32000, `This tool needs a ${min} role on the trip`);
  };

  switch (name) {
    case 'list_trips': {
      const rows = user.role === 'admin'
        ? await env.DB.prepare('SELECT id, name, destination, start_date, end_date, emoji FROM trips ORDER BY start_date DESC').all()
        : await env.DB.prepare(
            `SELECT t.id, t.name, t.destination, t.start_date, t.end_date, t.emoji FROM trips t
             JOIN trip_members m ON m.trip_id = t.id WHERE m.participant_id = ? ORDER BY t.start_date DESC`,
          ).bind(user.participant_id ?? -1).all();
      return rows.results;
    }
    case 'get_itinerary': {
      await needTrip(args.trip_id);
      if ((await mcpHidden(env, user, args.trip_id)).has('plan')) throw new McpError(-32000, 'The plan is hidden for this account');
      const dayFilter = typeof args.day === 'string' ? ' AND day = ?' : '';
      const q = env.DB.prepare(`SELECT id, day, start_time, end_time, title, notes, location_name, lat, lng, done, sort FROM activities WHERE trip_id = ?${dayFilter} ORDER BY day, sort, start_time, id`);
      const acts = await (dayFilter ? q.bind(args.trip_id, args.day) : q.bind(args.trip_id)).all();
      const bookings = await env.DB.prepare(
        `SELECT category, description, expense_date, end_date, location FROM expenses WHERE trip_id = ? AND category IN ('flight','accommodation') ORDER BY expense_date`,
      ).bind(args.trip_id).all();
      const budgets = await env.DB.prepare('SELECT day, currency, total, myr_estimate FROM day_budgets WHERE trip_id = ? ORDER BY day').bind(args.trip_id).all();
      const titleQ = env.DB.prepare(
        `SELECT day, title FROM day_settings WHERE trip_id = ? AND title IS NOT NULL AND title <> ''${dayFilter}`);
      const titles = await (dayFilter ? titleQ.bind(args.trip_id, args.day) : titleQ.bind(args.trip_id)).all();
      const noteQ = env.DB.prepare(
        `SELECT id, day, content, is_check, done FROM day_notes WHERE trip_id = ?${dayFilter} ORDER BY day, sort, id`);
      const notes = await (dayFilter ? noteQ.bind(args.trip_id, args.day) : noteQ.bind(args.trip_id)).all();
      return {
        activities: acts.results, bookings: bookings.results, day_budgets: budgets.results,
        day_titles: titles.results,
        notes: (notes.results as any[]).map(n => ({
          id: n.id, day: n.day, content: n.content,
          is_checklist: !!n.is_check, done: n.is_check ? !!n.done : null,
        })),
      };
    }
    case 'get_balances': {
      await needTrip(args.trip_id);
      if ((await mcpHidden(env, user, args.trip_id)).has('payments')) throw new McpError(-32000, 'Payments are hidden for this account');
      const data = await computeBalances(env, args.trip_id);
      const isLeader = atLeast(await tripRole(env, user, args.trip_id), 'leader');
      const balances = isLeader ? data.balances : data.balances.filter((b: any) => b.participant.id === user.participant_id);
      return {
        trip_total_myr: data.tripTotal, committed_myr: data.committedTotal,
        balances: (balances as any[]).map((b: any) => ({
          participant: b.participant.name, owed_myr: b.owed, paid_myr: b.paid, outstanding_myr: b.outstanding,
        })),
      };
    }
    case 'get_expenses': {
      await needTrip(args.trip_id);
      if ((await mcpHidden(env, user, args.trip_id)).has('ledger')) throw new McpError(-32000, 'The ledger is hidden for this account');
      if (atLeast(await tripRole(env, user, args.trip_id), 'leader')) {
        const rows = await env.DB.prepare(
          'SELECT id, category, description, vendor, expense_date, amount_myr, currency, amount_original, payment_status FROM expenses WHERE trip_id = ? ORDER BY expense_date, id',
        ).bind(args.trip_id).all();
        return rows.results;
      }
      const rows = await env.DB.prepare(
        `SELECT e.id, e.category, e.description, e.expense_date, e.amount_myr, e.payment_status, s.amount_myr AS my_share_myr
         FROM expenses e JOIN expense_shares s ON s.expense_id = e.id
         WHERE e.trip_id = ? AND s.participant_id = ? ORDER BY e.expense_date, e.id`,
      ).bind(args.trip_id, user.participant_id ?? -1).all();
      return rows.results;
    }
    case 'suggest_free_slots': {
      await needTrip(args.trip_id);
      if (typeof args.day !== 'string') throw new McpError(-32602, 'day required (YYYY-MM-DD)');
      const acts = await env.DB.prepare('SELECT start_time, end_time FROM activities WHERE trip_id = ? AND day = ?')
        .bind(args.trip_id, args.day).all();
      return { day: args.day, free_slots: freeSlots(acts.results as any[]) };
    }
    case 'add_activity': {
      await needTripRole(args.trip_id, 'editor');
      const title = String(args.title ?? '').trim();
      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(String(args.day ?? ''))) throw new McpError(-32602, 'title and day (YYYY-MM-DD) required');
      let geo: { name: string; lat: number; lng: number } | null = null;
      if (typeof args.place === 'string' && args.place.trim()) geo = await geocodeServer(args.place.trim());
      let end: string | null = null;
      if (typeof args.start_time === 'string' && /^\d{2}:\d{2}$/.test(args.start_time) && Number(args.duration_min) > 0) {
        const m = Number(args.start_time.slice(0, 2)) * 60 + Number(args.start_time.slice(3, 5)) + Math.min(Number(args.duration_min), 720);
        end = `${String(Math.floor(Math.min(m, 1435) / 60)).padStart(2, '0')}:${String(Math.min(m, 1435) % 60).padStart(2, '0')}`;
      }
      const cat = ['sightseeing', 'food', 'transport', 'lodging', 'shopping', 'other'].includes(String(args.category)) ? String(args.category) : null;
      const r = await env.DB.prepare(
        `INSERT INTO activities (trip_id, title, day, start_time, end_time, notes, location_name, lat, lng, category)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).bind(args.trip_id, title.slice(0, 120), args.day,
        typeof args.start_time === 'string' && /^\d{2}:\d{2}$/.test(args.start_time) ? args.start_time : null, end,
        typeof args.notes === 'string' ? args.notes.slice(0, 500) : null,
        geo?.name ?? (typeof args.place === 'string' ? args.place.slice(0, 120) : null),
        geo?.lat ?? null, geo?.lng ?? null, cat).run();
      await audit(env, user.id, 'mcp_activity_create', 'activity', Number(r.meta.last_row_id));
      return { id: Number(r.meta.last_row_id), located: !!geo, location_name: geo?.name ?? null };
    }
    case 'update_activity': {
      const act = await env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(Number(args.activity_id)).first<any>();
      if (!act) throw new McpError(-32000, 'Activity not found');
      await needTripRole(act.trip_id, 'editor');
      const val = (k: string, cur: any) => (args[k] !== undefined ? args[k] : cur);
      await env.DB.prepare(
        'UPDATE activities SET title=?, day=?, start_time=?, end_time=?, notes=?, done=? WHERE id=?',
      ).bind(String(val('title', act.title)).slice(0, 120), val('day', act.day), val('start_time', act.start_time),
        val('end_time', act.end_time), val('notes', act.notes), args.done !== undefined ? (args.done ? 1 : 0) : act.done, act.id).run();
      await audit(env, user.id, 'mcp_activity_update', 'activity', act.id);
      return { ok: true };
    }
    case 'get_notes': {
      await needTrip(args.trip_id);
      if ((await mcpHidden(env, user, args.trip_id)).has('plan')) throw new McpError(-32000, 'The plan is hidden for this account');
      const dayFilter = typeof args.day === 'string' ? ' AND day = ?' : '';
      const q = env.DB.prepare(
        `SELECT id, day, content, is_check, done FROM day_notes WHERE trip_id = ?${dayFilter} ORDER BY day, sort, id`);
      const rows = await (dayFilter ? q.bind(args.trip_id, args.day) : q.bind(args.trip_id)).all();
      return (rows.results as any[]).map(n => ({
        id: n.id, day: n.day, content: n.content,
        is_checklist: !!n.is_check, done: n.is_check ? !!n.done : null,
      }));
    }
    case 'add_note': {
      await needTripRole(args.trip_id, 'editor');
      const content = String(args.content ?? '').trim();
      if (!content || !/^\d{4}-\d{2}-\d{2}$/.test(String(args.day ?? ''))) throw new McpError(-32602, 'content and day (YYYY-MM-DD) required');
      const mx = await env.DB.prepare('SELECT COALESCE(MAX(sort),0) AS m FROM day_notes WHERE trip_id = ? AND day = ?')
        .bind(args.trip_id, args.day).first<any>();
      const r = await env.DB.prepare('INSERT INTO day_notes (trip_id, day, content, is_check, sort) VALUES (?,?,?,?,?)')
        .bind(args.trip_id, args.day, content.slice(0, 500), args.is_check ? 1 : 0, (mx?.m ?? 0) + 1).run();
      await audit(env, user.id, 'mcp_note_create', 'day_note', Number(r.meta.last_row_id));
      return { id: Number(r.meta.last_row_id) };
    }
    case 'update_note': {
      const nid = Number(args.note_id);
      const note = await env.DB.prepare('SELECT * FROM day_notes WHERE id = ?').bind(nid).first<any>();
      if (!note) throw new McpError(-32000, 'Note not found');
      await needTripRole(note.trip_id, 'editor');
      const isCheck = args.is_check !== undefined ? (args.is_check ? 1 : 0) : note.is_check;
      await env.DB.prepare('UPDATE day_notes SET content=?, is_check=?, done=? WHERE id=?').bind(
        args.content !== undefined ? String(args.content).trim().slice(0, 500) : note.content,
        isCheck,
        args.done !== undefined ? (args.done ? 1 : 0) : note.done,
        nid).run();
      await audit(env, user.id, 'mcp_note_update', 'day_note', nid);
      return { ok: true };
    }
    case 'delete_note': {
      const nid = Number(args.note_id);
      const note = await env.DB.prepare('SELECT trip_id FROM day_notes WHERE id = ?').bind(nid).first<any>();
      if (!note) throw new McpError(-32000, 'Note not found');
      await needTripRole(note.trip_id, 'editor');
      await env.DB.prepare('DELETE FROM day_notes WHERE id = ?').bind(nid).run();
      await audit(env, user.id, 'mcp_note_delete', 'day_note', nid);
      return { ok: true };
    }
    case 'set_day_title': {
      await needTripRole(args.trip_id, 'editor');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(args.day ?? ''))) throw new McpError(-32602, 'day (YYYY-MM-DD) required');
      const title = String(args.title ?? '').trim().slice(0, 80) || null;
      await env.DB.prepare(
        `INSERT INTO day_settings (trip_id, day, title) VALUES (?,?,?)
         ON CONFLICT (trip_id, day) DO UPDATE SET title=excluded.title`,
      ).bind(args.trip_id, args.day, title).run();
      await audit(env, user.id, 'mcp_day_title', 'trip', Number(args.trip_id));
      return { ok: true, title };
    }
    case 'delete_activity': {
      const id = Number(args.activity_id);
      const act = await env.DB.prepare('SELECT trip_id FROM activities WHERE id = ?').bind(id).first<any>();
      if (!act) throw new McpError(-32000, 'Activity not found');
      await needTripRole(act.trip_id, 'editor');
      await env.DB.batch([
        env.DB.prepare('DELETE FROM activity_participants WHERE activity_id = ?').bind(id),
        env.DB.prepare('DELETE FROM activities WHERE id = ?').bind(id),
      ]);
      await audit(env, user.id, 'mcp_activity_delete', 'activity', id);
      return { ok: true };
    }
    default:
      throw new McpError(-32601, `Unknown tool: ${name}`);
  }
}

async function mcpHandleOne(env: Env, user: SessionUser, msg: any): Promise<any | null> {
  const id = msg?.id;
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return err(-32600, 'Invalid request');
  if (id === undefined || id === null) return null; // notification — nothing to send back
  try {
    switch (msg.method) {
      case 'initialize':
        return reply({
          protocolVersion: msg.params?.protocolVersion ?? '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'jelajah', version: '0.12.0' },
        });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: MCP_TOOLS });
      case 'tools/call': {
        const data = await mcpToolCall(env, user, msg.params?.name, msg.params?.arguments ?? {});
        return reply({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      }
      default:
        return err(-32601, `Method not found: ${msg.method}`);
    }
  } catch (e: any) {
    if (e instanceof McpError) return err(e.code, e.message);
    console.error('mcp tool error:', e?.message ?? e);
    return err(-32000, 'Internal error');
  }
}

async function mcpHttp(c: any, rawToken: string | null): Promise<Response> {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version',
  };
  if (c.req.method === 'OPTIONS') return c.body(null, 204, cors);
  if (c.req.method === 'GET') return c.json({ error: 'SSE stream not supported; POST JSON-RPC messages here' }, 405, cors);
  if (c.req.method === 'DELETE') return c.body(null, 200, cors);
  if (c.req.method !== 'POST') return c.json({ error: 'method_not_allowed' }, 405, cors);

  const user = await mcpUser(c.env, rawToken ? `Bearer ${rawToken}` : c.req.header('authorization'));
  if (!user) return c.json({ error: 'invalid_token' }, 401, cors);
  await trackUsage(c.env, user.id, 'mcp_call');

  let body: any;
  try { body = await c.req.json(); } catch {
    return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400, cors);
  }
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m: any) => mcpHandleOne(c.env, user, m)))).filter((r: any) => r !== null);
    return replies.length ? c.json(replies, 200, cors) : c.body(null, 202, cors);
  }
  const reply = await mcpHandleOne(c.env, user, body);
  return reply ? c.json(reply, 200, cors) : c.body(null, 202, cors);
}

// Header-auth endpoint — Claude Code / Claude Desktop / Codex (Authorization: Bearer).
app.all('/mcp', c => mcpHttp(c, null));

// Token-in-URL endpoint — for clients that cannot send custom headers, e.g.
// claude.ai custom connectors (which only support open or full-OAuth servers).
// The token is the same revocable personal access token, just carried in the
// path: https://<host>/api/mcp/t/<token>. Treat the URL as a secret.
app.all('/mcp/t/:token', c => mcpHttp(c, c.req.param('token')));

export default app;
