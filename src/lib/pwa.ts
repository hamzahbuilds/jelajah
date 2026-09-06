// Jelajah PWA client glue (spec v0.22 §3) — registration, update detection,
// and best-effort cache cleanup on logout. Kept dependency-free and
// defensive: any of this failing (unsupported browser, storage disabled,
// dev server without a real SW) must never break the app.

// A minimal shape so callers can pass a real Headers or a plain {get}
// object (handy in tests / non-fetch contexts) without a DOM dependency.
export interface HeaderLike { get(name: string): string | null }

/** True when a response carries the offline-fallback marker the service
 * worker stamps onto cached API responses (public/sw.js `withOfflineHeader`). */
export function isOfflineResponse(headers: HeaderLike): boolean {
  return headers.get('X-Jelajah-Offline') === '1';
}

/**
 * Registers the service worker (production only — dev serves unbundled
 * modules the SW's asset-caching strategy isn't meant for) and reports
 * when an updated worker is ready to take over.
 *
 * Spec clarification: the spec's §2 lifecycle text says "skipWaiting NOT
 * automatic" but describes the client reacting to `registration.waiting`
 * without saying how the waiting worker is told to activate. A worker left
 * merely "waiting" never calls skipWaiting on its own, so a user who clicks
 * Refresh would just reload onto the OLD worker. We resolve this by adding
 * a tiny message listener to sw.js (`SKIP_WAITING` -> `self.skipWaiting()`)
 * that only fires when the client explicitly asks for it via applyUpdate —
 * this is still user-initiated, not automatic, so the spec's intent (no
 * silent takeover while someone's mid-flow) holds.
 */
let activeRegistration: ServiceWorkerRegistration | null = null;

export function registerSW(onUpdate: () => void): void {
  if (!(import.meta.env.PROD && 'serviceWorker' in navigator)) return;
  try {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      activeRegistration = registration;
      if (registration.waiting && navigator.serviceWorker.controller) {
        onUpdate();
      }
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            onUpdate();
          }
        });
      });
    }).catch(() => { /* registration failed — app still works without offline support */ });
  } catch {
    // Defensive: some environments throw synchronously on access.
  }
}

/**
 * Tells the waiting worker (captured by registerSW) to activate, then
 * reloads once it takes control. Because sw.js's SKIP_WAITING message
 * handler calls self.skipWaiting() and activate() calls clients.claim(),
 * the waiting worker takes over immediately on this explicit request —
 * it does NOT wait for all clients of the old version to close. Any other
 * open tabs keep running their old JS under the new SW; that's safe
 * because built assets are content-hashed and immutable.
 */
export function applyUpdate(): void {
  try {
    const waiting = activeRegistration?.waiting;
    if (!waiting) {
      location.reload();
      return;
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    waiting.postMessage({ type: 'SKIP_WAITING' });
  } catch {
    location.reload();
  }
}

/** Best-effort removal of the API/files caches on logout — mitigates a
 * shared device retaining another user's cached offline data. Never throws. */
export async function clearApiCaches(): Promise<void> {
  try {
    if (!('caches' in window)) return;
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith('jl-api-') || name.startsWith('jl-files-'))
        .map((name) => caches.delete(name).catch(() => {}))
    );
  } catch {
    // Best-effort only.
  }
}
