export class ApiError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

async function handle(res: Response): Promise<any> {
  if (res.status === 401 && !location.pathname.startsWith('/login')) {
    location.href = '/login';
    throw new ApiError('unauthorized', 401);
  }
  if (!res.ok) {
    let code = 'error';
    try { code = ((await res.json()) as any).error ?? 'error'; } catch { /* ignore */ }
    throw new ApiError(code, res.status);
  }
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
