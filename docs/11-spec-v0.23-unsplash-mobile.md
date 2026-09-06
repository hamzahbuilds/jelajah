# Spec v0.23 — Unsplash Imagery + Mobile Overflow Fixes + Walk Icon

**Status:** requested by Sage 6 Sep 2026 (this round IS the approval — items are direct feedback).
**Dependency:** `UNSPLASH_ACCESS_KEY` secret (Sage creates free demo app; no card). EVERY Unsplash feature is key-optional: absent key → feature hidden/falls back (Wikipedia auto + gradients), zero errors.

## 1 · Mobile overflow fixes (no key needed)

Reported: Money page + currencies (FxWidget) overflow horizontally on phones. Fix approach: reproduce FIRST with Playwright screenshots at 360×740 and 390×844 (Money/Ledger with seeded data, Dashboard with FxWidget, Payments, MySpend, Plan, People+Rooms, Settings, Admin), diagnose each overflow (suspects: stat value long strings, FxWidget rate rows/watch-currency chips, tables, tabular-nums wide amounts), fix CSS-only where possible (min-width:0, overflow-wrap, minmax(0,1fr), horizontal scroll containers for genuinely wide content). Screenshot evidence before/after committed to the task report (not the repo).

## 2 · Server: Unsplash proxy (key-optional)

server/app.ts additions (key read from env; ALL routes 404 `{error:'no_unsplash'}` when key absent):
- `GET /api/public/carousel` — NO auth (login page). Serves cached JSON from KV key `unsplash:carousel` (TTL 24h via KV expirationTtl): for the 5 fixed carousel destinations (Kyoto, Santorini, Cappadocia, Banff, Kuala Lumpur) one image each: {url (regular, hotlinked per Unsplash guidelines), author_name, author_link, photo_link}. Cache-miss path: 5 Unsplash search calls (landscape orientation, 1 per destination) then KV put. Rate-safe: worst case 5 calls/day.
- `GET /trips/:id/unsplash?q=<query>` — member-gated, editor+ not needed (read-only search); proxies Unsplash search (9 results, landscape): [{id, thumb, regular, author_name, author_link, download_location}]. No KV cache (interactive search). trackUsage('unsplash_search').
- `POST /trips/:id/cover/unsplash` — leader; body {regular_url, download_location, author_name, author_link}: server validates URL host is images.unsplash.com (https), fires the download_location trigger (Unsplash guideline compliance, with the key), downloads the image bytes (≤600KB guard — request w=1280&q=80 params), stores via the EXISTING versioned cover pipeline (cover/<id>/<ts> KV key), cover_credit = `${author_name} · Unsplash · ${author_link}` (client's credit parser already handles last-'·'-URL). Existing MIME allowlist + nosniff untouched.
- Auto-on-create: in the trip-create handler, after insert, IF key present AND destination set: fire-and-forget (c.executionCtx.waitUntil) Unsplash search(destination)→store first result as cover via the same pipeline; failures silent (gradient remains). Wikipedia auto endpoint stays untouched as the keyless path.
Constraint notes: hotlinking allowed ONLY for the login carousel (Unsplash guidelines require their CDN there; pre-auth page, no member privacy at stake); trip covers store BYTES in KV (privacy precedent v0.20) — the download trigger satisfies attribution/tracking guidelines.

## 3 · Client

- Login (AuthCarousel): fetch /api/public/carousel (raw fetch, no auth); when it returns images, render each slide with the photo as background layer under the existing gradient/caption; attribution line bottom-right ("Photo: <author> / Unsplash", links) per guidelines; fallback (404/no key/offline): current gradients exactly as today. SW note: /api/public/carousel is GET api → already cached by the PWA SW network-first — fine.
- People cover block: add "Choose from Unsplash" button (leader, shown only when a probe search or a capability flag says key exists — simplest: attempt search on open; 404 no_unsplash → hide/toast). Opens shared Modal: search input prefilled with trip destination, grid of 9 thumbs (lazy), tap → POST cover/unsplash → toast + refresh (existing chain). Keep Upload + Wikipedia buttons.
- Trips page: no change needed beyond covers appearing (auto-on-create + existing rendering).

## 4 · Walk icon (no key needed)

Add `walk` to the icon sprite (src/components/iconDefs.ts + ICON_NAMES): hand-drawn lucide-style walking figure (head circle + torso/leg strokes, 24px grid, stroke 2). Replace the 🚶 fallback in Plan.tsx transit chips + transport card mode map with <Icon name="walk"/>. Consistency grep for any other 🚶/walk-emoji usage.

## 5 · e2e

Mobile-overflow: assert no horizontal scroll (document.scrollingElement.scrollWidth <= innerWidth+1) on Money + Dashboard at 390px in the existing mobile section. Unsplash routes: e2e SKIPS live Unsplash (external network) — assert key-absent behavior instead: /api/public/carousel → 404 no_unsplash and login still renders gradients; cover picker button hidden. Walk icon: assert no 🚶 in Plan DOM. Marker → v0.23.

## 6 · Constraints

Standard battery. New: Unsplash key is a SECRET (never in wrangler.toml/repo); guideline compliance (hotlink+attribution+download-trigger) documented in code comments; all features degrade silently keyless.
