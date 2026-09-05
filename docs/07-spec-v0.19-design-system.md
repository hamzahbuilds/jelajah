# Spec v0.19 — Jelajah Design System (UI Refresh, Path A)

**Status:** draft for Sage review · 5 Sep 2026
**Decision:** Path A — Untitled UI-inspired token system layered onto the existing
hand-rolled CSS + React 19 stack. No Tailwind, no component-library dependency,
no build-chain changes. `design/ui-refresh/` (prototype v8) is the visual
reference; this spec is the binding authority where they differ.

---

## 1 · Scope

**In:** design tokens, dark/light/system theming, icon system, navigation shell
(desktop sidebar + mobile tab bar), core components (buttons, badges, cards,
list rows, modals, dropdowns, toasts, empty states, forms, seg tabs), chart
grammar for admin/dashboard, auth page, motion rules, and the guardrails below.

**Out (unchanged by this refresh):** all server code, DB schema, API shapes,
money math, role gating logic, i18n dictionary structure, MCP. The refresh is
presentational — a PR that touches `server/` or `shared/` money logic to make
UI work is wrong by definition.

**Out (explicitly rejected):** Path B (Untitled UI React + Tailwind v4 +
React Aria migration). Revisit only if the hand-rolled component count becomes
unmanageable.

## 2 · Design tokens (`src/styles.css` `:root`)

Replace the current 17-variable block with the full scale. Names below are
canonical — components reference tokens, never raw hex.

### 2.1 Color

```css
:root {
  /* gray (Untitled UI gray, warmed) */
  --gray-25:#FCFCFB; --gray-50:#F9F9F8; --gray-100:#F2F2F0; --gray-200:#E7E5E0;
  --gray-300:#D5D3CD; --gray-400:#A8A69F; --gray-500:#7A786F; --gray-600:#5B594F;
  --gray-700:#44423A; --gray-800:#2A2924; --gray-900:#1C1B17; --gray-950:#121110;

  /* brand (teal; 700 = current #0F766E kept exactly) */
  --brand-25:#F4FBFA; --brand-50:#E6F7F4; --brand-100:#C7EEE8; --brand-300:#5FD4C2;
  --brand-500:#14A899; --brand-600:#0E9384; --brand-700:#0F766E; --brand-800:#0B5A54;
  --brand-950:#083D39;

  /* status (Untitled UI success/warning/error) */
  --success-500:#12B76A; --success-700:#027A48;
  --warning-500:#F79009; --warning-700:#B54708;
  --error-500:#F04438;   --error-700:#B42318;

  /* semantic aliases — components use ONLY these + scales above */
  --bg:var(--gray-50); --surface:#fff; --nav-bg:#fff;
  --ink:var(--gray-900); --ink-2:var(--gray-600); --ink-3:var(--gray-400);
  --border:var(--gray-200);
  --tile:var(--brand-50); --tile-ring:var(--brand-100);
}
```

Old aliases (`--brand`, `--line`, `--danger`, `--ok-bg`…) stay as one-line
mappings during migration and are deleted in the final phase.

### 2.2 Dark theme

```css
[data-theme="dark"] {
  --bg:var(--gray-950); --surface:var(--gray-900); --nav-bg:var(--gray-900);
  --ink:var(--gray-50); --ink-2:var(--gray-300); --ink-3:var(--gray-500);
  --border:var(--gray-800);
  --tile:rgba(15,118,110,.18); --tile-ring:rgba(15,118,110,.32);
}
```

**GUARDRAIL — dark legibility:** any `-700` status/brand color used as *text or
icon* must have a dark-mode override to its `-300`-equivalent tint (prototype
values: brand `#5FE9D0`, success `#75E0A7`, warning `#FDB022`, error `#F97066`).
A new component that sets colored text without a `[data-theme="dark"]` variant
fails review. Chart fills on tinted grounds use `var(--tile)`, never `-50`
values (they render white-ish in dark).

### 2.3 Type, spacing, radius, shadow

- Font: keep system stack (`-apple-system … 'Inter', sans-serif`). **GUARDRAIL:
  no Google Fonts `<link>` in the app** — external font requests are a privacy
  + offline + free-tier cost; the prototype's hosted Inter is prototype-only.
- Scale (px): 11 caption · 12 small · 13 secondary · 14 body-tight · 15 body ·
  16 card-title · 18/20 section · 24 page-h1 · 30/34 display. Weights 400/500/600/700
  (800 only inside charts).
- Spacing: 8px grid (4 allowed for icon gaps). Card padding 20px; page gutter
  32px desktop / 16px mobile.
- Radius: `--r-sm:6px --r-md:8px --r-lg:12px --r-xl:16px`, pills `999px`.
- Shadows: `--shadow-xs` (cards), `--shadow-md` (hover/menus), modal `0 20px
  48px rgba(16,24,40,.25)`. Nothing heavier.

## 3 · Theming behavior

- Three states: light (default), dark, system. Stored in `localStorage`
  `jl-theme`; `''`=light, `'dark'`, `'system'` (resolved via
  `prefers-color-scheme`, re-resolved on change event).
- Set as `data-theme` on `<html>` before first paint (inline script in
  `index.html` head — avoids flash).
- Settings page: Light/Dark/System seg control (prototype 08).
- Later (separate ticket, not this refresh): persist per-user in
  `app_settings`-style user pref so theme follows logins.

## 4 · Icons

- Single inline SVG sprite module (`src/icons.tsx` or equivalent): Lucide-style,
  24px grid, `stroke-width:2`, round caps/joins, `currentColor`. Prototype
  `icons.js` sprite is the source; port as a React `<Icon name>` component.
- Sizes: 16 (`sm`), 20 (default), 24 (`lg`).
- **GUARDRAIL — viewBox:** every rendered icon svg MUST carry
  `viewBox="0 0 24 24"` (the component hard-codes it). The prototype shipped a
  bug where `<use>` without viewBox spilled strokes outside 20px boxes — do not
  reintroduce. `overflow:visible` stays on the icon class as stroke-edge
  insurance, not as a scaling fix.
- **GUARDRAIL — no emoji as UI glyphs.** Emoji allowed only as user content
  (trip flag/emblem). Everything functional uses the sprite.

## 5 · Navigation shell

Desktop (≥1024px):
- Fixed left sidebar, `--sidew:264px`, collapsible to 72px icon rail
  (chevron button; state in `localStorage jl-side`; labels/pills hidden,
  `title` tooltips). Content offset `margin-left:var(--sidew)`.
- IA: **Home** (trips folder) always first → trip switcher (opens centered
  switch dialog) → Overview / Plan / Money / Documents / People → footer:
  Admin (platform admins only) / Settings / user chip.
- **Money is ONE nav item**; Ledger/Payments/My-spend are in-page seg tabs.
- Sidebar must fit 100vh without scrolling at every breakpoint ≥600px tall.

Mobile (<1024px):
- Bottom tab bar, 5 slots: Home · Plan · Money · Docs · More. Active = brand
  color + dot. Sticky top bar with page icon + title + avatar.
- **Long-press (450ms) on Plan/Money/Docs opens the trip-switch bottom sheet**
  (trips with role badges + "All trips" row). `contextmenu` suppressed on
  those tabs; the held click must not navigate.
- **More opens a sheet**: People, Settings, Admin (if admin), Log out.
- Sheets: bottom-anchored <1024px, centered dialog ≥1024px; scrim click
  closes; grab handle on mobile.
- **GUARDRAIL — role naming:** trip UI says **Leader**, never Admin. "Admin"
  appears only for platform administration surfaces.

## 6 · Components (canonical set)

Buttons (primary/secondary/ghost/danger-text; sm 32px, default 40px), badges
(pill + status dot; gray/brand/success/warning/error), cards (+`cardhead`),
stat cards, list rows (`lrow`: tile/avatar · main+sub · amount · badge+action;
wraps at ≤640px), seg tabs, form fields (label-above-input `.fld`, 44px min
height, brand focus ring `outline:2px`), modals (440px, icon tile header,
Cancel+primary right, destructive Delete left in error color → confirm dialog
with "no undo" copy), dropdown menus (230px min, icon + bold label + sub-line,
fixed-position with viewport clamping), toasts (bottom pill, auto-dismiss
~2.6s, above tab bar on mobile), empty states (icon tile · title · ≤2-line
guidance · one primary action — REQUIRED for: no trips, empty plan day, empty
My-spend, no documents/receipts, no tokens, empty admin lists).

**GUARDRAIL — hidden attr:** keep `[hidden]{display:none!important}` in the
global stylesheet (display classes otherwise beat the attribute).

**GUARDRAIL — one modal system.** No page-local modal/dropdown implementations;
everything goes through the shared components so focus trapping, Escape-to-close
and scrim behavior stay uniform. (Prototype `ux.js` is the behavioral reference;
the React versions add focus trap + `aria-modal` + Escape, which the mock skipped.)

## 7 · Charts (dashboard + admin)

- Grammar adopted from lieflat-charts' Glance family: capsule horizontal bars,
  dot waffle for composition, punch card for weekday×daypart, single-stroke
  cumulative line + 800-weight counter, quota progress bars. Card anatomy:
  title (16.5/700) · sub-line (11.5) · chart · uppercase `SOURCE ·` line (9.5,
  .08em tracking).
- Color: most important series `--brand-600`, everything else the gray ladder
  (400→300). One accent per chart.
- **GUARDRAIL — license:** lieflat-charts is PolyForm Noncommercial. Its
  *style* is adopted; its *code* is never copied into this repo. All charts are
  hand-written SVG (or existing sparkline code). If Chart.js/ECharts are ever
  wanted, import from npm under their own MIT/Apache licenses.
- **GUARDRAIL — honesty:** every chart card names its real data source; no
  chart ships without the `SOURCE` line. Values from `usage_daily` are UTC
  domain — bucket before display, per the timezone rules in DEV-RUNBOOK.

## 8 · Motion

- Durations: menus/toasts 120–180ms, modals 160ms, bars/dots stagger 80–130ms,
  chart draw-in ≤1.1s. Easing `cubic-bezier(.25,1,.3,1)`-family; pop
  `(.2,.7,.3,1.3)` for dots only. Sidebar collapse 180ms.
- **GUARDRAIL — reduced motion:** every keyframe/transition group ships inside
  or alongside a `prefers-reduced-motion: reduce` kill switch (charts render
  final state; carousel stops auto-advancing).

## 9 · Auth page

Split layout ≥1024px: left destination carousel (Ken Burns crossfade 6s,
eyebrow/headline/hook caption, progress dots, frosted brand chip), right pane
with Log in / Join-a-trip tabs; join tab shows invite context badge (trip,
inviter, role). Mobile: 200px banner (caption only) + full-width form.
- **GUARDRAIL — images:** 5–6 curated, licensed destination photos bundled as
  static assets (~≤120KB each, AVIF/WebP). No picsum, no runtime image APIs.
- **GUARDRAIL — join flow:** `/join/:code` keeps its security behavior exactly
  (constant-shape invalid response, rate limiting, guarded `used_count`). The
  redesign changes markup only; it must keep using raw fetch, not the
  authed api helper.

## 10 · Cross-cutting guardrails

1. **RM0:** no new runtime dependencies, no paid or keyed APIs, no CDN asset
   loads in the app (fonts, scripts, images all bundled/self-hosted).
2. **i18n parity:** every new string goes through the `t()` dictionary, EN +
   Bahasa Malaysia both, TypeScript-enforced. No hardcoded copy in components.
   Microcopy voice: plain verbs, sentence case, buttons say what happens
   ("Record payment", not "Submit"); BM equally natural, not literal.
3. **Money sacred:** UI refresh must not alter split math display logic, and
   My-spend privacy stays absolute — no shared surface may render My-spend
   data. Leader-only money writes keep their gating (`canLead`).
4. **Touch/a11y:** interactive targets ≥44px on mobile; visible focus ring on
   every focusable; text contrast ≥4.5:1 in BOTH themes; `env(safe-area-inset-*)`
   honored on fixed bottom chrome.
5. **Responsive floor:** no horizontal page scroll at 360px; tables that can't
   fit become `lrow` lists (never squished tables); wide content scrolls inside
   its own container.
6. **Schema:** this refresh needs zero schema changes. If any phase thinks it
   needs one (e.g. server-side theme pref), it's a separate spec addendum
   following the SCHEMA+UPGRADES idempotency rules.
7. **Tests:** 108 unit tests + full e2e ritual (`scripts/e2e.mjs`) must pass
   after every phase; e2e selectors that break due to markup changes are
   updated in the same phase, never skipped. Playwright stays OUT of
   package.json.
8. **Delivery:** phased, each phase leaves the app shippable (auto-deploy on
   push means main is always deployable). Sage commits via GitHub Desktop.

## 11 · Phasing (preview — implementation plan will detail)

- **P1 Tokens + theming** — new `:root` scales, dark theme, theme switcher in
  Settings, alias shims. App looks near-identical after this phase.
- **P2 Icons + core components** — Icon component, buttons/badges/cards/forms/
  lrow/empty states restyled; modal/menu/toast system.
- **P3 Navigation shell** — sidebar (fixed, collapsible), mobile tab bar,
  trip-switch + More sheets, Home-first routing.
- **P4 Pages** — Trips folder, Dashboard, Plan, Money, Documents, People,
  Settings, Admin (with chart grammar), Auth carousel. Several sub-phases.
- **P5 Cleanup** — delete alias tokens, dead CSS, BM copy audit, full e2e.

---
*Prototype reference: `design/ui-refresh/` v8 · lieflat style study:
scratchpad clone, not vendored.*
