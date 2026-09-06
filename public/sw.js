// Jelajah service worker — read-only offline PWA support (spec v0.22 §2).
//
// Versioning: bump V manually whenever the cached shape changes (new
// precache entries, changed cache-key strategy, etc). The build stamps
// nothing into this file — this is a hand-maintained constant.
//
// WARNING: bumping V deletes every cache from the previous version on the
// next activate (activate() only keeps names in CURRENT_CACHES) — that is
// a user's entire offline dataset (jl-api-*, jl-files-*, jl-assets-*,
// jl-shell-*). Only bump V when the cached shape actually breaks (new
// precache entries, a changed cache-key strategy) — never as a routine
// release step, since it silently empties an offline-dependent user's
// cache on their next visit.
//   V=1  2026-09-06  initial PWA rollout (precache shell + manifest + icon,
//                     assets/navigation/api/covers-docs caching strategies)
const V = 1;

const SHELL_CACHE = `jl-shell-v${V}`;
const ASSETS_CACHE = `jl-assets-v${V}`;
const API_CACHE = `jl-api-v${V}`;
const FILES_CACHE = `jl-files-v${V}`;

const CURRENT_CACHES = new Set([SHELL_CACHE, ASSETS_CACHE, API_CACHE, FILES_CACHE]);

// F5 (v0.22 final review, 2026-09-06): '/manifest.webmanifest' and
// '/icon.svg' matched no fetch branch below, so the precached copies were
// never served — pure dead weight on install. Precache the icons the
// manifest and index.html's apple-touch-icon actually reference instead,
// and see the '/icons/' branch in the fetch handler that serves them.
const PRECACHE_URLS = ['/', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png'];

const FILES_CACHE_MAX_ENTRIES = 40;
const API_CACHE_MAX_ENTRIES = 60;

const API_EXCLUDE_PREFIXES = ['/api/auth', '/api/mcp'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            // Log-and-continue: one missing precache entry (e.g. a 404)
            // must not fail install for the rest of the shell.
            console.warn('[sw] precache failed for', url, err);
          })
        )
      )
    )
  );
  // No skipWaiting: the SW waits until all clients of the old version are
  // closed, and the client shows an update toast when a new worker is
  // waiting (registration.waiting + controllerchange reload).
});

// Client-initiated update only: the waiting worker never calls
// skipWaiting on its own (see install handler above) — it does so only
// when a client explicitly asks, via the Refresh action in the update
// banner (src/lib/pwa.ts applyUpdate). This keeps activation user-driven,
// not automatic.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('jl-') && !CURRENT_CACHES.has(name))
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

function isApiExcluded(pathname) {
  return API_EXCLUDE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isCoverOrDocumentPath(pathname) {
  // Matches only the actual binary routes (server/app.ts):
  //   GET /api/trips/:id/cover        -> /\/cover(\/|$)/
  //   GET /api/documents/:id/file     -> /\/file$/
  // Deliberately excludes GET /api/documents/:id (metadata JSON), which
  // should go through the normal network-first API cache instead.
  return /\/cover(\/|$)/.test(pathname) || /\/file$/.test(pathname);
}

async function trimCacheFifo(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const excess = keys.length - maxEntries;
  if (excess > 0) {
    for (let i = 0; i < excess; i++) {
      await cache.delete(keys[i]);
    }
  }
}

function withOfflineHeader(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Jelajah-Offline', '1');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function networkFirstNavigation(request, event) {
  // Fire the real fetch once; if it loses the race against the timeout
  // below, let it keep running unobserved rather than chaining a .then
  // off it — see F3 below for why a late resolution must NOT be allowed
  // to write to the shell cache after the timeout has already won.
  const fetchPromise = fetch(request).catch(() => {});

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('timeout')), 3000);
  });

  try {
    const response = await Promise.race([fetchPromise, timeoutPromise]);
    clearTimeout(timeoutId);
    // The network won in time: this is the ONLY place the shell cache is
    // written from a navigation. response may be undefined if fetchPromise
    // itself failed (caught above) and still won the race before timeout.
    if (response && response.ok) {
      event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put('/', response.clone())));
    }
    if (response) return response;
    throw new Error('network failed');
  } catch (err) {
    clearTimeout(timeoutId);
    // F3 (v0.22 final review, 2026-09-06): deliberately do NOT write a late
    // (post-timeout) network response into the shell cache here. Round 1's
    // "even a LATE one" write meant: deploy lands -> slow nav times out ->
    // old shell served & booted on old hashed assets -> the late response
    // still overwrote jl-shell-v1['/'] with the NEW shell -> that shell now
    // points at asset URLs jl-assets-v1 has never fetched -> next offline
    // load renders the new shell, cacheFirstAssets misses on those assets,
    // fetch rejects, blank page. Only updating the shell when the network
    // actually wins the race keeps the shell and the assets it references
    // always in sync. This supersedes the F3 finding of fix batch
    // 2026-09-06 final-review.md, which superseded part of the T1 fix.
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match('/');
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirstAssets(request) {
  const cache = await caches.open(ASSETS_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

// F5 (v0.22 final review, 2026-09-06): serves the precached PWA icons
// (SHELL_CACHE — see PRECACHE_URLS) cache-first, falling back to network
// and re-caching on a miss, mirroring cacheFirstAssets.
async function cacheFirstIcons(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
      // F4 (v0.22 final review, 2026-09-06): jl-api-* previously grew
      // unbounded — every distinct API GET URL a user ever visited stayed
      // cached forever. Cap it FIFO the same way jl-files-* is capped.
      await trimCacheFifo(API_CACHE, API_CACHE_MAX_ENTRIES);
    }
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return withOfflineHeader(cached);
    throw err;
  }
}

async function cacheOnFetchFiles(request) {
  const cache = await caches.open(FILES_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    await trimCacheFifo(FILES_CACHE, FILES_CACHE_MAX_ENTRIES);
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Writes and non-GET requests are NEVER intercepted.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cross-origin requests pass through untouched.
  if (url.origin !== self.location.origin) return;

  // Navigation requests: network-first (3s timeout) -> '/' shell fallback.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request, event));
    return;
  }

  // Hashed static assets: cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirstAssets(request));
    return;
  }

  // PWA icons (precached into SHELL_CACHE — see PRECACHE_URLS): cache-first.
  if (url.pathname.startsWith('/icons/')) {
    event.respondWith(cacheFirstIcons(request));
    return;
  }

  // API GET requests, excluding auth/mcp: network-first -> cache fallback
  // (marked with X-Jelajah-Offline: 1 when served from cache).
  if (url.pathname.startsWith('/api/')) {
    if (isApiExcluded(url.pathname)) return;
    if (isCoverOrDocumentPath(url.pathname)) {
      event.respondWith(cacheOnFetchFiles(request));
      return;
    }
    event.respondWith(networkFirstApi(request));
    return;
  }

  // Everything else (other same-origin GETs): untouched.
});
