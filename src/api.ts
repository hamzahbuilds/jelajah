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
  // Public pages (v0.39: Discover and guides) check the session too; a 401 there
  // just means "not signed in", not "send me to the login page".
  const publicPage = location.pathname === '/' || location.pathname === '/discover' || location.pathname.startsWith('/guides/');
  if (res.status === 401 && !location.pathname.startsWith('/login') && !publicPage) {
    // F1 (v0.22 final review, 2026-09-06): fire-and-forget cache clear on
    // session expiry, so the next user on a shared device doesn't inherit
    // this user's cached API/files data. Not awaited — must not delay the
    // redirect — and failure-tolerant (clearApiCaches never throws anyway).
    clearApiCaches().catch(() => {});
    location.href = '/login';
    throw new ApiError('unauthorized', 401);
  }
  if (res.status === 401) throw new ApiError('unauthorized', 401);
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

// The trip's home currency (trips.base_currency). Every *_myr column in the
// ledger holds amounts in this currency; the name predates multi-currency.
// TripShell publishes it before rendering a trip's pages.
let home = 'MYR';
let multi = false;
export const homeCurrency = () => home;
/** Leader switch (trips.multi_currency). Off = basic mode: one currency, no FX. */
export const multiCurrency = () => multi;
/** Currencies offered in amount pickers: the trip's own first. BND has no
 *  market feed of its own; the server prices it at par with SGD (official peg). */
export const pickCurrencies = () => !multi ? [home] :
  [...new Set([home, 'MYR', 'SGD', 'BND', 'JPY', 'USD', 'EUR', 'GBP', 'AUD', 'THB', 'IDR', 'PHP', 'KRW', 'CNY', 'HKD'])];
export const setHomeCurrency = (c: string | null | undefined, multiOn = multi) => {
  home = (c || 'MYR').toUpperCase(); multi = !!multiOn;
};

/** Format an amount in the open trip's home currency. */
export const fmtMYR = (n: number) =>
  home === 'MYR'
    ? new Intl.NumberFormat('ms-MY', { style: 'currency', currency: 'MYR' }).format(n)
    : fmtMoney(n, home);

// Codes whose narrow symbol is a bare "$" are shown with a prefix so a BND
// or SGD trip never reads like US dollars.
const DOLLAR_PREFIX: Record<string, string> = { BND: 'B$', SGD: 'S$', AUD: 'A$', NZD: 'NZ$', HKD: 'HK$', CAD: 'C$', TWD: 'NT$' };
export function fmtMoney(n: number, cur: string): string {
  const prefix = DOLLAR_PREFIX[cur];
  if (prefix) {
    const num = new Intl.NumberFormat('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
    return `${n < 0 ? '-' : ''}${prefix}${num}`;
  }
  try {
    return new Intl.NumberFormat('ms-MY', { style: 'currency', currency: cur, currencyDisplay: 'narrowSymbol' }).format(n);
  } catch {
    return `${cur} ${n.toFixed(2)}`; // unknown code
  }
}

export function fmtDate(d: string | null | undefined, lang: string): string {
  if (!d) return '—';
  return new Date(d + 'T00:00:00').toLocaleDateString(lang === 'ms' ? 'ms-MY' : 'en-MY', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}
