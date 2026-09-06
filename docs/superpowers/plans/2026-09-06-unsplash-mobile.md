# v0.23 Unsplash + Mobile Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Runs after v0.22 closes green.

**Goal:** Ship spec v0.23 — mobile overflow fixes (evidence-driven), walk icon, key-optional Unsplash imagery (login carousel, trip-cover auto+gallery) — e2e green at v0.23 marker.
**Spec:** docs/11-spec-v0.23-unsplash-mobile.md (binding; the request round WAS the approval).

## Global Constraints
Standard battery (no deps; no commits; t()/icons/dark/44px; SCHEMA untouched this round — no schema changes needed; money untouched; vitest 167+/tsc/build per task; full ritual final task, marker v0.23; kill pattern ps-aux; wipe .wrangler/state). NEW: UNSPLASH_ACCESS_KEY is a secret — never in wrangler.toml/repo/reports; every Unsplash surface silently degrades keyless (review's automatic-fail check); Unsplash guideline compliance (hotlink only on public carousel, attribution rendered, download_location trigger fired on cover selection).

### Task 1: Mobile overflow fixes + walk icon (keyless, client-only)
**Files:** `src/styles.css`, possibly page-level tweaks (`src/pages/Ledger.tsx`/`Dashboard.tsx`/`FxWidget.tsx` classNames only), `src/components/iconDefs.ts` (+`walk` in ICON_NAMES), `src/pages/Plan.tsx` (🚶 → <Icon name="walk">), `tests/icon.test.ts` count if it asserts 49, `scripts/e2e.mjs` (no-horizontal-scroll asserts on Money+Dashboard at 390px added to the mobile section).
- [ ] REPRODUCE FIRST: Playwright screenshot script (scratchpad) at 360×740 + 390×844 across Money/Ledger, Dashboard (FxWidget), Payments, MySpend, Plan, People(+Rooms), Settings, Admin — seeded data; VIEW the screenshots; list every overflow with its causing element (measure scrollWidth per page).
- [ ] Fix each: min-width:0 / minmax(0,1fr) / overflow-wrap / scroll containers; re-screenshot to prove; before/after noted in report.
- [ ] walk icon: lucide-style walking figure path (head circle r~2 at top, torso, two legs mid-stride, one arm line; 24px grid stroke 2 round); ICON_NAMES + DEFS; replace 🚶 usages (grep repo-wide, incl. transit chips + transport card in Plan.tsx); icon test updated (50 names).
- [ ] Verify trio + updated e2e asserts compile (full ritual is T4).

### Task 2: Server — Unsplash proxy (key-optional)
**Files:** `server/app.ts` only (+ Env type if bindings file exists — check how GEMINI key is typed/read and mirror).
- [ ] Routes per spec §2 verbatim: /api/public/carousel (no-auth, KV cache `unsplash:carousel` TTL 24h via expirationTtl, 5 fixed destinations, hotlink URLs + attribution fields); /trips/:id/unsplash?q= (member, 9 landscape results, trackUsage); POST /trips/:id/cover/unsplash (leader; validate images.unsplash.com https host; fire download_location trigger with key; download w=1280&q=80, ≤600KB, MIME allowlist, EXISTING versioned cover pipeline + credit format `author · Unsplash · link`); trip-create auto-cover via c.executionCtx.waitUntil, silent-fail.
- [ ] EVERY route: key absent → 404 {error:'no_unsplash'} before any external call. Key read env.UNSPLASH_ACCESS_KEY (secret; add to .dev.vars.example if that file exists, else document in report).
- [ ] Guards per v0.20 precedent (integer ids, exists, auth tiers); audit on cover writes.
- [ ] Verify: tsc/build/vitest; `npm run db:local` untouched (no schema); wrangler smoke optional.

### Task 3: Client — carousel images + Unsplash gallery picker
**Files:** `src/components/AuthCarousel.tsx`, `src/pages/People.tsx` (cover block + picker Modal), `src/i18n.tsx`, `src/styles.css` (attribution line, picker grid).
- [ ] Carousel: raw fetch /api/public/carousel on mount (no auth header; catch→null); when images present, photo layer under existing gradient (gradient stays for text), per-slide attribution bottom-right (author link + Unsplash link, rel noopener, tiny, legible on photo); keyless/offline → current gradients byte-identical behavior.
- [ ] People picker: "Choose from Unsplash" btn (leader) → shared Modal: search .fld input prefilled destination, Search btn2 → GET /trips/:id/unsplash → 3×3 lazy thumb grid (btn wrappers, alt author) → tap → POST cover/unsplash → toast + existing refresh chain; 404 no_unsplash on FIRST search → toast t.noUnsplashKey + hide button for session; loading/empty states.
- [ ] i18n en+ms (chooseFromUnsplash, searchPhotos, noUnsplashKey, photoBy…); dark/44px.
- [ ] Verify trio.

### Task 4: e2e + full ritual + closeout
**Files:** `scripts/e2e.mjs`, `docs/build-status.md`.
- [ ] Keyless-behavior asserts per spec §5 (carousel 404 → gradients still render; picker button hidden after probe; no 🚶 in Plan DOM; no-horizontal-scroll checks from T1 wired into the mobile section); NO live Unsplash calls in e2e.
- [ ] Marker v0.23; FULL ritual green; build-status v0.23 section (+ note: Unsplash features await the key, everything degrades clean).

## Self-review notes
- No schema changes — cover pipeline reused as-is.
- Carousel endpoint is the app's first intentionally-unauthenticated data route besides /join — spec-sanctioned; contains only public Unsplash metadata.
- e2e never touches unsplash.com (external-network ban holds).
