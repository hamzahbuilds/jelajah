import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env } from './env.d';
import {
  hashPassword, verifyPassword, createSession, getSessionUser,
  destroySession, sessionCookie, clearCookie, randomToken, SessionUser,
} from './lib/auth';
import { SCHEMA, UPGRADES, JAPAN_TRIP } from './lib/schema';

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

/* ---- lazy schema upgrades: idempotent, once per isolate ---- */
let upgraded = false;
app.use('*', async (c, next) => {
  if (!upgraded) {
    upgraded = true;
    for (const s of UPGRADES) {
      try { await c.env.DB.prepare(s).run(); } catch { /* already applied */ }
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
  if (c.req.path === '/api/auth/login' || c.req.path === '/api/health' || c.req.path.startsWith('/api/setup')) return next();
  const user = await getSessionUser(c.env, getCookie(c, 'sid'));
  if (!user) return bad(c, 'unauthorized', 401);
  c.set('user', user);
  return next();
});

const requireAdmin = async (c: any, next: any) => {
  if (c.get('user').role !== 'admin') return bad(c, 'forbidden', 403);
  return next();
};

/** Features the admin hid from members on this trip ('documents','ledger','payments','plan'). Admins see everything. */
async function hiddenFor(c: any, tripId: number): Promise<Set<string>> {
  if (c.get('user').role === 'admin') return new Set();
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
    ? await c.env.DB.prepare('SELECT * FROM trips ORDER BY start_date DESC').all()
    : await c.env.DB.prepare(
        `SELECT t.* FROM trips t JOIN trip_members m ON m.trip_id = t.id
         WHERE m.participant_id = ? ORDER BY t.start_date DESC`,
      ).bind(user.participant_id).all();
  return c.json({ user, trips: trips.results });
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

/* ---------------- users & participants (admin) ---------------- */

app.get('/participants', async c => {
  const rows = await c.env.DB.prepare('SELECT * FROM participants ORDER BY name').all();
  return c.json(rows.results);
});

app.post('/participants', requireAdmin, async c => {
  const { name, is_infant } = await c.req.json<any>();
  if (!name?.trim()) return bad(c, 'name_required');
  const r = await c.env.DB.prepare('INSERT INTO participants (name, is_infant) VALUES (?,?)')
    .bind(name.trim(), is_infant ? 1 : 0).run();
  return c.json({ id: r.meta.last_row_id });
});

app.patch('/participants/:id', requireAdmin, async c => {
  const { name, is_infant } = await c.req.json<any>();
  await c.env.DB.prepare('UPDATE participants SET name = COALESCE(?, name), is_infant = COALESCE(?, is_infant) WHERE id = ?')
    .bind(name ?? null, is_infant ?? null, Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

app.get('/users', requireAdmin, async c => {
  const rows = await c.env.DB.prepare(
    'SELECT id, email, name, role, lang, participant_id, disabled, must_change_password, created_at FROM users ORDER BY name',
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
  const { name, destination, start_date, end_date, emoji } = await c.req.json<any>();
  if (!name?.trim()) return bad(c, 'name_required');
  const r = await c.env.DB.prepare(
    'INSERT INTO trips (name, destination, start_date, end_date, emoji) VALUES (?,?,?,?,?)',
  ).bind(name.trim(), destination ?? null, start_date ?? null, end_date ?? null, emoji ?? '🧳').run();
  return c.json({ id: r.meta.last_row_id });
});

app.get('/trips/:id', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  const trip = await c.env.DB.prepare('SELECT * FROM trips WHERE id = ?').bind(id).first();
  if (!trip) return bad(c, 'not_found', 404);
  const members = await c.env.DB.prepare(
    `SELECT p.* FROM participants p JOIN trip_members m ON m.participant_id = p.id WHERE m.trip_id = ? ORDER BY p.name`,
  ).bind(id).all();
  return c.json({ trip, members: members.results });
});

app.patch('/trips/:id', requireAdmin, async c => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<any>();
  await c.env.DB.prepare(
    `UPDATE trips SET name = COALESCE(?, name), destination = COALESCE(?, destination),
     start_date = COALESCE(?, start_date), end_date = COALESCE(?, end_date), emoji = COALESCE(?, emoji),
     hidden_features = COALESCE(?, hidden_features) WHERE id = ?`,
  ).bind(b.name ?? null, b.destination ?? null, b.start_date ?? null, b.end_date ?? null, b.emoji ?? null,
    Array.isArray(b.hidden_features) ? JSON.stringify(b.hidden_features) : null, id).run();
  return c.json({ ok: true });
});

app.put('/trips/:id/members', requireAdmin, async c => {
  const id = Number(c.req.param('id'));
  const { participant_ids } = await c.req.json<{ participant_ids: number[] }>();
  const stmts = [c.env.DB.prepare('DELETE FROM trip_members WHERE trip_id = ?').bind(id)];
  for (const pid of participant_ids ?? []) {
    stmts.push(c.env.DB.prepare('INSERT INTO trip_members (trip_id, participant_id) VALUES (?,?)').bind(id, pid));
  }
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
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

app.post('/trips/:id/documents', requireAdmin, async c => {
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

app.delete('/documents/:id', requireAdmin, async c => {
  const id = Number(c.req.param('id'));
  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<any>();
  if (!doc) return bad(c, 'not_found', 404);
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
      payer_participant_id, meta_json)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    tripId, documentId, p.category, p.description.trim(), p.vendor ?? null, p.location ?? null,
    p.expense_date ?? null, p.end_date ?? null, p.payment_date ?? null,
    p.amount_original, p.currency, p.fx_rate, p.amount_myr,
    p.payer_participant_id, p.meta ? JSON.stringify(p.meta) : null,
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

app.post('/documents/:id/confirm', requireAdmin, async c => {
  const id = Number(c.req.param('id'));
  const doc = await c.env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first<any>();
  if (!doc) return bad(c, 'not_found', 404);
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

app.post('/trips/:id/expenses', requireAdmin, async c => {
  const id = Number(c.req.param('id'));
  const p = await c.req.json<ExpensePayload>();
  const err = validExpense(p);
  if (err) return bad(c, err);
  const eid = await insertExpense(c.env, id, null, p);
  await audit(c.env, c.get('user').id, 'expense_create', 'expense', eid);
  return c.json({ id: eid });
});

app.put('/expenses/:id', requireAdmin, async c => {
  const id = Number(c.req.param('id'));
  const old = await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first<any>();
  if (!old) return bad(c, 'not_found', 404);
  const p = await c.req.json<ExpensePayload>();
  const err = validExpense(p);
  if (err) return bad(c, err);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE expenses SET category=?, description=?, vendor=?, location=?, expense_date=?, end_date=?,
       payment_date=?, amount_original=?, currency=?, fx_rate=?, amount_myr=?, payer_participant_id=? WHERE id=?`,
    ).bind(p.category, p.description.trim(), p.vendor ?? null, p.location ?? null, p.expense_date ?? null,
      p.end_date ?? null, p.payment_date ?? null, p.amount_original, p.currency, p.fx_rate, p.amount_myr,
      p.payer_participant_id, id),
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

app.delete('/expenses/:id', requireAdmin, async c => {
  const id = Number(c.req.param('id'));
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

app.post('/trips/:id/payments', requireAdmin, async c => {
  const id = Number(c.req.param('id'));
  const { from_participant_id, to_participant_id, amount_myr, pay_date, note, expense_id } = await c.req.json<any>();
  if (!from_participant_id || !to_participant_id || !(amount_myr > 0) || !pay_date) return bad(c, 'missing_fields');
  const r = await c.env.DB.prepare(
    `INSERT INTO payments (trip_id, from_participant_id, to_participant_id, amount_myr, pay_date, note, expense_id, created_by)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).bind(id, from_participant_id, to_participant_id, amount_myr, pay_date, note ?? null, expense_id ?? null, c.get('user').id).run();
  await audit(c.env, c.get('user').id, 'payment_create', 'payment', Number(r.meta.last_row_id));
  return c.json({ id: r.meta.last_row_id });
});

app.delete('/payments/:id', requireAdmin, async c => {
  await c.env.DB.prepare('DELETE FROM payments WHERE id = ?').bind(Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

/* ---------------- balances ---------------- */

app.get('/trips/:id/balances', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  if ((await hiddenFor(c, id)).has('payments')) return bad(c, 'feature_hidden', 403);
  const [expenses, shares, payments, parts] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM expenses WHERE trip_id = ? ORDER BY expense_date, id').bind(id).all(),
    c.env.DB.prepare('SELECT s.* FROM expense_shares s JOIN expenses e ON e.id = s.expense_id WHERE e.trip_id = ?').bind(id).all(),
    c.env.DB.prepare('SELECT * FROM payments WHERE trip_id = ? ORDER BY pay_date, id').bind(id).all(),
    c.env.DB.prepare('SELECT p.* FROM participants p JOIN trip_members m ON m.participant_id = p.id WHERE m.trip_id = ?').bind(id).all(),
  ]);
  const exps = expenses.results as any[];
  const byExpense = new Map<number, any>(exps.map(e => [e.id, e]));

  // debts[from][to] = list of {expense, amount, remaining}
  type Item = { expense_id: number; description: string; category: string; date: string | null; amount: number; remaining: number };
  const items = new Map<string, Item[]>(); // key `${from}->${to}`
  for (const s of shares.results as any[]) {
    const e = byExpense.get(s.expense_id);
    if (!e || e.payer_participant_id === s.participant_id || !e.payer_participant_id) continue;
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
  // per-item summary for chart tooltips / by-item breakdown
  const expenseItems = exps.map(e => ({
    id: e.id, description: e.description, category: e.category,
    amount_myr: e.amount_myr, expense_date: e.expense_date, vendor: e.vendor,
  }));

  const user = c.get('user');
  const visible = user.role === 'admin' ? balances : balances.filter(b => b.participant.id === user.participant_id);
  return c.json({ balances: visible, totalsByCategory, tripTotal, expenseCount: exps.length, expenseItems });
});

/* ---------------- planner ---------------- */

interface AutoEvent {
  day: string; time: string | null; end_time: string | null;
  kind: 'flight' | 'checkin' | 'checkout';
  title: string; subtitle: string | null; expense_id: number;
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

  return c.json({
    autoEvents,
    activities: (acts.results as any[]).map(a => ({ ...a, participant_ids: partsByAct.get(a.id) ?? [] })),
    groups: (groups.results as any[]).map(g => ({ ...g, member_ids: membersByGroup.get(g.id) ?? [] })),
    stays,
    daySettings: daySettings.results,
    legOverrides: legOverrides.results,
  });
});

/* ---- day start/end settings & leg overrides (admin) ---- */

app.put('/trips/:id/daysettings', requireAdmin, async c => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<any>();
  if (!b.day) return bad(c, 'day_required');
  await c.env.DB.prepare(
    `INSERT INTO day_settings (trip_id, day, start_name, start_lat, start_lng, end_name, end_lat, end_lng)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT (trip_id, day) DO UPDATE SET start_name=excluded.start_name, start_lat=excluded.start_lat,
       start_lng=excluded.start_lng, end_name=excluded.end_name, end_lat=excluded.end_lat, end_lng=excluded.end_lng`,
  ).bind(id, b.day, b.start_name ?? null, b.start_lat ?? null, b.start_lng ?? null,
    b.end_name ?? null, b.end_lat ?? null, b.end_lng ?? null).run();
  return c.json({ ok: true });
});

app.delete('/trips/:id/daysettings/:day', requireAdmin, async c => {
  await c.env.DB.prepare('DELETE FROM day_settings WHERE trip_id = ? AND day = ?')
    .bind(Number(c.req.param('id')), c.req.param('day')).run();
  return c.json({ ok: true });
});

app.put('/trips/:id/legs', requireAdmin, async c => {
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

app.patch('/expenses/:id/coords', requireAdmin, async c => {
  const { lat, lng } = await c.req.json<any>();
  await c.env.DB.prepare('UPDATE expenses SET lat = ?, lng = ? WHERE id = ?')
    .bind(lat ?? null, lng ?? null, Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

/* ---- My spend: private per-user tracker. Every query is scoped to the session
   user; there is deliberately NO endpoint that reads another user's items. ---- */

app.get('/trips/:id/myspend', async c => {
  const id = Number(c.req.param('id'));
  if (!(await assertTripAccess(c, id))) return bad(c, 'forbidden', 403);
  const rows = await c.env.DB.prepare(
    'SELECT * FROM personal_expenses WHERE trip_id = ? AND user_id = ? ORDER BY spend_date DESC, id DESC',
  ).bind(id, c.get('user').id).all();
  return c.json(rows.results);
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
  return c.json({ id: r.meta.last_row_id });
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
  await c.env.DB.prepare('DELETE FROM personal_expenses WHERE id = ?').bind(row.id).run();
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
  await c.env.DB.prepare('DELETE FROM personal_expenses WHERE id = ?').bind(row.id).run();
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

app.post('/trips/:id/activities', requireAdmin, async c => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<any>();
  if (!b.title?.trim() || !b.day) return bad(c, 'missing_fields');
  const r = await c.env.DB.prepare(
    `INSERT INTO activities (trip_id, title, day, start_time, end_time, notes, location_name, lat, lng, est_cost_myr)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).bind(id, b.title.trim(), b.day, b.start_time ?? null, b.end_time ?? null, b.notes ?? null,
    b.location_name ?? null, b.lat ?? null, b.lng ?? null, b.est_cost_myr ?? null).run();
  const aid = Number(r.meta.last_row_id);
  await saveActivityParticipants(c.env, aid, b.participant_ids ?? []);
  await audit(c.env, c.get('user').id, 'activity_create', 'activity', aid);
  return c.json({ id: aid });
});

app.put('/activities/:id', requireAdmin, async c => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<any>();
  await c.env.DB.prepare(
    `UPDATE activities SET title=?, day=?, start_time=?, end_time=?, notes=?, location_name=?, lat=?, lng=?, est_cost_myr=? WHERE id=?`,
  ).bind(b.title?.trim(), b.day, b.start_time ?? null, b.end_time ?? null, b.notes ?? null,
    b.location_name ?? null, b.lat ?? null, b.lng ?? null, b.est_cost_myr ?? null, id).run();
  await saveActivityParticipants(c.env, id, b.participant_ids ?? []);
  return c.json({ ok: true });
});

app.patch('/activities/:id', requireAdmin, async c => {
  const { done } = await c.req.json<any>();
  await c.env.DB.prepare('UPDATE activities SET done = ? WHERE id = ?')
    .bind(done ? 1 : 0, Number(c.req.param('id'))).run();
  return c.json({ ok: true });
});

app.delete('/activities/:id', requireAdmin, async c => {
  const id = Number(c.req.param('id'));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM activity_participants WHERE activity_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM activities WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

/** Bulk upsert from the CSV template. Rows with an id update that activity
    (must belong to this trip); rows without create new ones. Never deletes. */
app.post('/trips/:id/activities/bulk', requireAdmin, async c => {
  const id = Number(c.req.param('id'));
  const { rows } = await c.req.json<{ rows: any[] }>();
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 300) return bad(c, 'rows_required');
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
          `UPDATE activities SET title=?, day=?, start_time=?, end_time=?, notes=?, location_name=?, lat=?, lng=?, est_cost_myr=?, done=? WHERE id=?`,
        ).bind(r.title.trim(), r.day, r.start_time ?? null, r.end_time ?? null, r.notes ?? null,
          r.location_name ?? null, r.lat ?? null, r.lng ?? null, r.est_cost_myr ?? null,
          r.done ? 1 : 0, Number(r.id)).run();
        await saveActivityParticipants(c.env, Number(r.id), r.participant_ids ?? []);
        updated++;
      } else {
        const ins = await c.env.DB.prepare(
          `INSERT INTO activities (trip_id, title, day, start_time, end_time, notes, location_name, lat, lng, est_cost_myr, done)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        ).bind(id, r.title.trim(), r.day, r.start_time ?? null, r.end_time ?? null, r.notes ?? null,
          r.location_name ?? null, r.lat ?? null, r.lng ?? null, r.est_cost_myr ?? null, r.done ? 1 : 0).run();
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

app.post('/trips/:id/groups', requireAdmin, async c => {
  const id = Number(c.req.param('id'));
  const { name, member_ids } = await c.req.json<any>();
  if (!name?.trim() || !member_ids?.length) return bad(c, 'missing_fields');
  const r = await c.env.DB.prepare('INSERT INTO groups (trip_id, name) VALUES (?,?)').bind(id, name.trim()).run();
  const gid = Number(r.meta.last_row_id);
  await c.env.DB.batch(member_ids.map((pid: number) =>
    c.env.DB.prepare('INSERT INTO group_members (group_id, participant_id) VALUES (?,?)').bind(gid, pid)));
  return c.json({ id: gid });
});

app.delete('/groups/:id', requireAdmin, async c => {
  const id = Number(c.req.param('id'));
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

app.patch('/duedates/:id', requireAdmin, async c => {
  const { settled } = await c.req.json<any>();
  await c.env.DB.prepare('UPDATE due_dates SET settled = ? WHERE id = ?')
    .bind(settled ? 1 : 0, Number(c.req.param('id'))).run();
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

export default app;
