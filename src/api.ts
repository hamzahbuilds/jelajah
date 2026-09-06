import { isOfflineResponse, clearApiCaches } from './lib/pwa';

export class ApiError extends Error {
  constructor(public code: string, public status: number, public body?: any) { super(code); }
}

// Additive hook (v0.22 PWA) so the app shell can show/clear an offline
// banner based on whether the last successful response was served from
// the service worker's cache fallback (X-Jelajah-Offline: 1). Error paths
// below are untouched — this only observes successful responses.
let offlineListener: ((offline: boolean) => void) | null = null;
export function setOfflineListener(fn: ((offline: boolean) => void) | null): void {
  offlineListener = fn;
}

async function handle(res: Response): Promise<any> {
  if (res.status === 401 && !location.pathname.startsWith('/login')) {
    // F1 (v0.22 final review, 2026-09-06): fire-and-forget cache clear on
    // session expiry, so the next user on a shared device doesn't inherit
    // this user's cached API/files data. Not awaited — must not delay the
    // redirect — and failure-tolerant (clearApiCaches never throws anyway).
    clearApiCaches().catch(() => {});
    location.href = '/login';
    throw new ApiError('unauthorized', 401);
  }
  if (!res.ok) {
    let code = 'error';
    let body: any;
    try { body = await res.json(); code = body?.error ?? 'error'; } catch { /* ignore */ }
    throw new ApiError(code, res.status, body);
  }
  try { offlineListener?.(isOfflineResponse(res.headers)); } catch { /* ignore */ }
  return res.json();
}

export const api = {
  get: (url: string) => fetch(`/api${url}`).then(handle),
  post: (url: string, body?: unknown) =>
    fetch(`/api${url}`, {
      method: 'POST',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    }).then(handle),
  put: (url: string, body: unknown) =>
    fetch(`/api${url}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(handle),
  patch: (url: string, body: unknown) =>
    fetch(`/api${url}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(handle),
  del: (url: string) => fetch(`/api${url}`, { method: 'DELETE' }).then(handle),
  upload: (url: string, form: FormData) => fetch(`/api${url}`, { method: 'POST', body: form }).then(handle),
};

export const fmtMYR = (n: number) =>
  new Intl.NumberFormat('ms-MY', { style: 'currency', currency: 'MYR' }).format(n);

export const fmtMoney = (n: number, cur: string) =>
  new Intl.NumberFormat('ms-MY', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' }).format(n);

export function fmtDate(d: string | null | undefined, lang: string): string {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString(lang === 'ms' ? 'ms-MY' : 'en-MY', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}
