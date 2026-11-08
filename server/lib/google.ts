// v0.33 — Sign in with Google (OAuth 2.0 authorization code + PKCE).
//
// No SDK: three plain calls. The ID token comes straight from Google's token
// endpoint over TLS in exchange for our client secret, so its signature does
// not need verifying here (Google: "if you get the ID token directly from
// Google over HTTPS, you may skip validation of the signature") — the claims
// (issuer, audience, expiry, nonce, verified email) are still checked.

export const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

export interface GoogleState {
  state: string;     // CSRF: echoed back in the callback query
  verifier: string;  // PKCE code_verifier
  nonce: string;     // replay guard inside the ID token
  next: string;      // where to land after sign-in (same-site path)
  invite: string;    // optional /join code: sign up through Google
}

export interface GoogleIdentity { sub: string; email: string; name: string }

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const randomUrlToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** Only same-site paths: "/trips/3" yes; "//evil.com", "https://…", "/\\evil" no. */
export function safeNext(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  return /^\/(?![/\\])[\w\-./?=&%#]*$/.test(s) ? s.slice(0, 200) : '/';
}

export const safeInvite = (v: unknown) => (typeof v === 'string' && /^inv_[0-9a-f]{32}$/.test(v) ? v : '');

export function encodeState(s: GoogleState): string {
  return b64url(new TextEncoder().encode(JSON.stringify(s)));
}
export function decodeState(raw: string | undefined): GoogleState | null {
  if (!raw) return null;
  try {
    const bin = atob(raw.replace(/-/g, '+').replace(/_/g, '/'));
    const o = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))));
    if (typeof o?.state !== 'string' || typeof o.verifier !== 'string' || typeof o.nonce !== 'string') return null;
    return { state: o.state, verifier: o.verifier, nonce: o.nonce, next: safeNext(o.next), invite: safeInvite(o.invite) };
  } catch { return null; }
}

export function authUrl(o: { clientId: string; redirectUri: string; state: string; nonce: string; challenge: string; hint?: string }): string {
  const u = new URL(GOOGLE_AUTH);
  u.search = new URLSearchParams({
    client_id: o.clientId, redirect_uri: o.redirectUri, response_type: 'code',
    scope: 'openid email profile', state: o.state, nonce: o.nonce,
    code_challenge: o.challenge, code_challenge_method: 'S256', prompt: 'select_account',
  }).toString();
  return u.toString();
}

/** Payload of a JWT, no signature check (see header comment for why that is fine here). */
export function jwtPayload(token: string): any | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const bin = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))));
  } catch { return null; }
}

/** Claims check. Returns the identity, or the reason it was refused. */
export function checkIdToken(p: any, o: { clientId: string; nonce: string; now?: number }): GoogleIdentity | { error: string } {
  const now = o.now ?? Math.floor(Date.now() / 1000);
  if (!p || typeof p !== 'object') return { error: 'bad_token' };
  if (p.iss !== 'accounts.google.com' && p.iss !== 'https://accounts.google.com') return { error: 'bad_issuer' };
  if (p.aud !== o.clientId) return { error: 'bad_audience' };
  if (typeof p.exp !== 'number' || p.exp < now - 60) return { error: 'expired' };
  if (p.nonce !== o.nonce) return { error: 'bad_nonce' };
  if (typeof p.sub !== 'string' || !p.sub) return { error: 'bad_token' };
  if (p.email_verified !== true && p.email_verified !== 'true') return { error: 'email_unverified' };
  const email = String(p.email ?? '').trim().toLowerCase();
  if (!email.includes('@')) return { error: 'email_unverified' };
  const name = String(p.name ?? p.given_name ?? email.split('@')[0]).trim().slice(0, 80) || email.split('@')[0];
  return { sub: p.sub, email, name };
}
