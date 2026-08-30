import type { Env } from '../env.d';

const ITERATIONS = 100_000; // Workers PBKDF2 iteration cap
const enc = new TextEncoder();

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}

export async function hashPassword(password: string, saltB64?: string) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: ITERATIONS },
    key, 256,
  );
  return { hash: b64(bits), salt: b64(salt) };
}

export async function verifyPassword(password: string, saltB64: string, hashB64: string): Promise<boolean> {
  const { hash } = await hashPassword(password, saltB64);
  // constant-time compare
  const a = unb64(hash), b = unb64(hashB64);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface SessionUser {
  id: number; email: string; name: string; role: 'admin' | 'member';
  lang: 'en' | 'ms'; participant_id: number | null; must_change_password: number;
}

export async function createSession(env: Env, userId: number): Promise<string> {
  const token = randomToken();
  const expires = new Date(Date.now() + 30 * 86400000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)')
    .bind(token, userId, expires).run();
  return token;
}

export async function getSessionUser(env: Env, token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.lang, u.participant_id, u.must_change_password
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > datetime('now') AND u.disabled = 0`,
  ).bind(token).first<SessionUser>();
  return row ?? null;
}

export async function destroySession(env: Env, token: string) {
  await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

export function sessionCookie(token: string, expires?: Date): string {
  const exp = expires ?? new Date(Date.now() + 30 * 86400000);
  return `sid=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=${exp.toUTCString()}`;
}
export function clearCookie(): string {
  return 'sid=; HttpOnly; Secure; SameSite=Lax; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
}
