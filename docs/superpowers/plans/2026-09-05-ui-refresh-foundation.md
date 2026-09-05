# UI Refresh Foundation (P1–P3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the v0.19 design system foundation — tokens, dark/light/system theming, icon system, core components (modal/menu/toast/empty/forms), and the new navigation shell (fixed collapsible sidebar + mobile tab bar with trip-switch sheet) — leaving every page functional and the app deployable after each task.

**Architecture:** Pure-presentation refresh on the existing React 19 + hand-rolled CSS stack (Path A). All styling lives in `src/styles.css` as CSS custom properties + classes; behavior lands as small React components/hooks (`Icon`, `Modal`, `Menu`, `Sheet`, `useLongPress`, theme module). No server, schema, or API changes. Page-level restyling (P4) and cleanup (P5) follow in a separate plan once this foundation is merged.

**Tech Stack:** React 19, react-router 7, Vite 7, plain CSS, vitest (pure-logic tests only — no DOM test deps), Playwright e2e via `scripts/e2e.mjs`.

**Spec:** `docs/07-spec-v0.19-design-system.md` (binding). Visual reference: `design/ui-refresh/` prototype v8.

## Global Constraints

- RM0: no new runtime OR dev dependencies; no CDN loads (fonts, scripts, images); system font stack stays.
- Every user-visible string goes through `t()` with EN + BM entries (TypeScript enforces parity in `src/i18n.tsx`).
- No changes under `server/`, `shared/` money logic, or `server/lib/schema.ts`. Zero schema changes.
- Money display math, My-spend privacy, `canLead`/`canEdit` gating, and `hidden_features` behavior unchanged.
- Trip UI says "Leader", never "Admin"; "Admin" only for platform surfaces.
- Icons: every svg carries `viewBox="0 0 24 24"`; no emoji as functional glyphs (user trip emoji stays).
- Dark mode: any `-700` status/brand text color gets a dark override (brand #5FE9D0, success #75E0A7, warning #FDB022, error #F97066).
- `[hidden] { display:none !important; }` stays in global CSS.
- All animation gated by `@media (prefers-reduced-motion: reduce)`.
- Touch targets ≥44px mobile; visible focus rings; `env(safe-area-inset-bottom)` on fixed bottom chrome; no horizontal scroll at 360px.
- After every task: `npm test` green (108+ tests), `npm run build` clean. Task 8 runs the full e2e ritual; e2e selector updates happen there, never skipped. Playwright stays out of package.json.
- Commits by implementer per task; Sage pushes via GitHub Desktop (never push).

---

### Task 1: Design tokens + theme module

**Files:**
- Modify: `src/styles.css` (`:root` block, lines 1–19, and append dark block)
- Create: `src/theme.ts`
- Modify: `index.html` (head: pre-paint theme script)
- Test: `tests/theme.test.ts`

**Interfaces:**
- Produces: CSS variables per spec §2 (gray-25…950, brand-25…950, status, semantic aliases); `theme.ts` exports `type ThemePref = '' | 'dark' | 'system'`, `resolveTheme(pref: ThemePref, systemDark: boolean): '' | 'dark'`, `applyTheme(pref: ThemePref): void`, `getThemePref(): ThemePref`, `setThemePref(pref: ThemePref): void`, `initTheme(): void` (applies + subscribes to `prefers-color-scheme` changes when pref is `'system'`).

- [ ] **Step 1: Write failing tests** — `tests/theme.test.ts` (pure logic, no DOM: test `resolveTheme`):

```ts
import { describe, it, expect } from 'vitest';
import { resolveTheme } from '../src/theme';

describe('resolveTheme', () => {
  it('light pref ignores system', () => expect(resolveTheme('', true)).toBe(''));
  it('dark pref ignores system', () => expect(resolveTheme('dark', false)).toBe('dark'));
  it('system follows OS dark', () => expect(resolveTheme('system', true)).toBe('dark'));
  it('system follows OS light', () => expect(resolveTheme('system', false)).toBe(''));
});
```

- [ ] **Step 2: Run** `npx vitest run tests/theme.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement `src/theme.ts`**:

```ts
export type ThemePref = '' | 'dark' | 'system';
const KEY = 'jl-theme';

export const resolveTheme = (pref: ThemePref, systemDark: boolean): '' | 'dark' =>
  pref === 'system' ? (systemDark ? 'dark' : '') : pref;

export const getThemePref = (): ThemePref => {
  const v = localStorage.getItem(KEY);
  return v === 'dark' || v === 'system' ? v : '';
};

export function applyTheme(pref: ThemePref) {
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = resolveTheme(pref, dark);
}

export function setThemePref(pref: ThemePref) {
  localStorage.setItem(KEY, pref);
  applyTheme(pref);
}

export function initTheme() {
  applyTheme(getThemePref());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (getThemePref() === 'system') applyTheme('system');
  });
}
```

- [ ] **Step 4: Replace `:root` in `src/styles.css`** with the spec §2.1 block VERBATIM (copy from spec), then append the spec §2.2 dark block, then these compatibility aliases inside `:root` (delete list tracked for P5):

```css
  /* migration aliases — remove in P5 */
  --brand:var(--brand-700); --brand-strong:var(--brand-800); --data:var(--brand-600);
  --line:var(--border); --danger:var(--error-700);
  --warn-bg:#FEF0C7; --warn-ink:var(--warning-700);
  --ok-bg:#D1FADF; --ok-ink:var(--success-700);
  --radius:var(--r-lg); --shadow:var(--shadow-xs);
  --r-sm:6px; --r-md:8px; --r-lg:12px; --r-xl:16px;
  --shadow-xs:0 1px 2px rgba(16,24,40,.05);
  --shadow-md:0 4px 8px -2px rgba(16,24,40,.1),0 2px 4px -2px rgba(16,24,40,.06);
```

Also append global guards at the end of styles.css:

```css
[hidden] { display: none !important; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```

- [ ] **Step 5: Pre-paint script in `index.html`** head, before the module script (verbatim; no imports — duplicated tiny logic is deliberate):

```html
<script>
  try { var p = localStorage.getItem('jl-theme') || '';
    document.documentElement.dataset.theme =
      p === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : '') : p;
  } catch (e) {}
</script>
```

- [ ] **Step 6: Call `initTheme()`** in `src/main.tsx` before render.
- [ ] **Step 7:** `npx vitest run` (all green) · `npm run build` clean · quick manual check `npm run dev`: app renders identical in light; `localStorage.setItem('jl-theme','dark')` + reload gives readable dark shell (imperfect page styling acceptable until P4).
- [ ] **Step 8: Commit** `feat(ui): design tokens, dark theme, theme module (v0.19 P1)`

### Task 2: Theme + appearance controls in Settings

**Files:**
- Modify: `src/pages/Settings.tsx` (add Appearance card)
- Modify: `src/i18n.tsx` (new keys)
- Test: TypeScript parity (i18n type) + existing tests

**Interfaces:**
- Consumes: `getThemePref/setThemePref` from Task 1.

- [ ] **Step 1: Add i18n keys** to BOTH `en` and `ms` in `src/i18n.tsx`: `appearance` ("Appearance" / "Paparan"), `themeLight` ("Light" / "Cerah"), `themeDark` ("Dark" / "Gelap"), `themeSystem` ("System" / "Ikut sistem"), `themeHint` ("Follows you on this device." / "Ikut peranti ini.").
- [ ] **Step 2: Appearance card in Settings.tsx** — seg control (reuse existing `.tabs`-style buttons until P2 seg class lands):

```tsx
const [pref, setPref] = useState<ThemePref>(getThemePref());
const pick = (p: ThemePref) => { setThemePref(p); setPref(p); };
// …
<div className="card">
  <h2>{t.appearance}</h2>
  <div className="row" role="group">
    {([['', t.themeLight], ['dark', t.themeDark], ['system', t.themeSystem]] as const).map(([v, label]) => (
      <button key={v} className={'btn btn-sm' + (pref === v ? '' : ' btn-ghost')} onClick={() => pick(v)}>{label}</button>
    ))}
  </div>
  <p className="muted">{t.themeHint}</p>
</div>
```

- [ ] **Step 3:** `npx tsc --noEmit` (parity), `npm test`, `npm run build`, manual: switching updates instantly, persists reload, System follows OS.
- [ ] **Step 4: Commit** `feat(ui): appearance setting — light/dark/system`

### Task 3: Icon system

**Files:**
- Create: `src/components/Icon.tsx`
- Modify: `src/main.tsx` (mount sprite once) or render sprite inside App root
- Test: `tests/icon.test.ts`

**Interfaces:**
- Produces: `<Icon name="wallet" size={16|20|24} />`; `ICON_NAMES` const array; `iconPath(name): string`. Sprite `<IconDefs />` rendered once at app root.

- [ ] **Step 1:** Port the ~45 `<g id="i-…">` defs from `design/ui-refresh/icons.js` VERBATIM into `src/components/Icon.tsx` as a template string; strip the `i-` prefix for names. Component:

```tsx
export const ICON_NAMES = ['home','calendar','wallet','receipt','coins','user','users','file','files','settings','shield','pin','plane','hotel','train','car','food','ticket','camera','temple','spark','plus','chev-d','chev-r','check','clock','alert','arrow-r','copy','trash','edit','moon','folder','link','chart','more','globe','logout','upload','gift','key','swap','chat','search','flag','eye','download','grip','bag'] as const;
export type IconName = typeof ICON_NAMES[number];

export function IconDefs() {
  return <svg style={{ display: 'none' }} dangerouslySetInnerHTML={{ __html: DEFS }} />;
}
export function Icon({ name, size = 20, className = '' }: { name: IconName; size?: 16 | 20 | 24; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={'icon ' + className} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}
```

CSS in styles.css: `.icon { fill:none; stroke:currentColor; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; flex:0 0 auto; vertical-align:-4px; overflow:visible; }`

- [ ] **Step 2: Test** `tests/icon.test.ts` (pure): every name in `ICON_NAMES` appears as `id="i-<name>"` in `DEFS` (export DEFS for the test); no duplicate ids; DEFS contains no `fill="#` hardcoded colors. Run — FAIL first, then pass after implementation.
- [ ] **Step 3:** Render `<IconDefs />` once at the top of `Shell`'s returned tree in `App.tsx`.
- [ ] **Step 4:** `npm test`, `npm run build`. Do NOT replace existing emoji usages yet (P4).
- [ ] **Step 5: Commit** `feat(ui): inline SVG icon system with viewBox guardrail`

### Task 4: Core component CSS

**Files:**
- Modify: `src/styles.css` (append component layer)
- Test: visual + build only (CSS)

**Interfaces:**
- Produces classes (consumed from P2 onward; old classes untouched and coexisting): `.btn2` primary/`.btn2.secondary`/`.btn2.ghost`/`.btn2.sm`, `.badge2` + `gray|brand|success|warning|error` + `.d` dot, `.card2`, `.cardhead`, `.stat`, `.lrow .l-main .l-amt .l-end`, `.seg`, `.fld`, `.empty .etile`, `.table2`.

- [ ] **Step 1:** Port these blocks from `design/ui-refresh/ui.css` into `src/styles.css` under a `/* ===== v0.19 components ===== */` banner, renaming to the `2`-suffixed names above where an old class name collides (`.btn`, `.badge`, `.card`, `.table` collide; `.lrow .seg .fld .empty .stat .cardhead` do not): buttons, badges (+dark overrides), cards+cardhead+stat, lrow (+640px wrap), seg, fld (label-above-input, 44px min-height, focus ring), empty state, dark-legibility block (badge/trend/pos overrides from prototype v3).
- [ ] **Step 2:** The `2` suffix is a MIGRATION name only — P5 renames back once old classes die. Add a comment saying exactly that.
- [ ] **Step 3:** `npm run build`; dev-server spot check that existing pages are visually unchanged (new classes unused so far).
- [ ] **Step 4: Commit** `feat(ui): core component styles (buttons, badges, cards, rows, forms, empty states)`

### Task 5: Modal / Menu / Toast / Sheet system

**Files:**
- Create: `src/components/Modal.tsx`, `src/components/Menu.tsx`, `src/components/Sheet.tsx`
- Modify: `src/components/Toast.tsx` (pill restyle only — keep API), `src/styles.css` (port `.jmwrap .jmodal .jmenu .jtoast` + sheet styles from prototype, s/jmodal/modal/ naming)
- Test: `tests/focus.test.ts`

**Interfaces:**
- Produces:
  - `Modal({ open, onClose, icon, title, sub, children, footer }: …)` — scrim click + Escape close, focus moved to dialog on open and restored on close, `role="dialog" aria-modal="true"`, body scroll locked while open.
  - `useMenu()` + `<Menu items anchor onClose>` where `items: { icon: IconName; label: string; sub?: string; onPick: () => void }[] | '-'` — fixed-position, viewport-clamped (pure helper `clampMenu(anchor: DOMRect, menu: {w:number;h:number}, vp: {w:number;h:number}): {top:number;left:number}`), closes on outside click/Escape.
  - `Sheet({ open, onClose, title, children })` — bottom sheet <1024px, centered dialog ≥1024px (CSS media, same component).
  - Toast keeps `useToast().toast(text, kind)` API; new pill look.
- Focus trap: pure `nextFocusIndex(count: number, current: number, shiftKey: boolean): number` exported for tests; component wires it to Tab keydown over `dialog.querySelectorAll('button,[href],input,select,textarea')`.

- [ ] **Step 1: Tests first** — `tests/focus.test.ts`: `nextFocusIndex(3,2,false)===0` (wraps), `nextFocusIndex(3,0,true)===2` (shift wraps back), `nextFocusIndex(1,0,false)===0`; `clampMenu` clamps left ≥12, top so menu bottom ≤ vp.h−12, prefers `anchor.bottom+6`. Run: FAIL.
- [ ] **Step 2:** Implement components + helpers; port CSS. Run tests: PASS.
- [ ] **Step 3:** Wire NOTHING into pages yet except one proof: replace the `confirm()`-style delete in `src/pages/Settings.tsx` token revoke (or the nearest existing confirm) with `Modal` destructive pattern (red primary, "no undo" copy via new i18n keys `deleteNoUndo`, `cancel` reuse).
- [ ] **Step 4:** `npm test`, `npm run build`, manual: modal opens, Escape closes, Tab cycles inside, background inert.
- [ ] **Step 5: Commit** `feat(ui): modal, menu, sheet and toast system with focus management`

### Task 6: Desktop navigation shell

**Files:**
- Create: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx` (`Chrome` → sidebar layout), `src/pages/TripShell.tsx` (drop `.tabs` nav; keep data/ctx/accent/ChatDrawer), `src/styles.css` (port sidebar/shell/collapse CSS: `--sidew`, `html.side-min`, `.sidebar .side-brand .side-collapse .nav-item .nav-label .trip-switch .side-foot`), `src/i18n.tsx` (keys: `home`, `overview`, `money`, `collapseNav`, `switchTrip`)
- Test: `tests/nav.test.ts`

**Interfaces:**
- Consumes: `Icon` (T3), `Sheet` (T5 — trip switcher dialog), session trips list, `useLocation`.
- Produces: `navModel(path: string, opts: { isAdmin: boolean; myRole?: TripRole; hidden: Set<string>; tripId?: number }): NavItem[]` in `src/components/navModel.ts` — PURE, drives both Sidebar and (T7) tab bar. `NavItem = { key: string; to: string; icon: IconName; label: keyof Dict; on: boolean; pill?: string }`.
- Behavior: account context (no tripId): Home, then foot Admin?/Settings. Trip context: Home · switcher · Overview `/trips/:id` · Plan · **Money → `/trips/:id/ledger`** · Documents · People(leader) honoring `hidden` set; foot same. Collapse toggle persists `jl-side`; `myspend` and `payments` remain routed but live under Money's in-page tabs (P4 wires those tabs; until then old links inside pages still work).
- Trip accent override changes from `--brand/--brand-strong` to `--brand-600/--brand-700` locally in TripShell.

- [ ] **Step 1: Tests first** — `tests/nav.test.ts`: account path `/` yields keys `[home]` + foot `[admin,settings]` when isAdmin (no admin when not); trip path `/trips/5/ledger` marks `money.on===true`; `hidden` containing `'plan'` removes plan for non-leader; people present only for leader; `/trips/5/payments` and `/trips/5/myspend` also mark money on. FAIL first.
- [ ] **Step 2:** Implement `navModel.ts` → tests PASS.
- [ ] **Step 3:** Build `Sidebar.tsx` (renders model, brand row + collapse button + trip-switch button opening `Sheet` with session trips: emoji, name, dates, `my_role` badge; picking one navigates to `/trips/:id`). Rewrite `Chrome` to `.shell` layout: sidebar ≥1024px, keep topbar ONLY as the <1024px `.mtop` (T7 replaces bottom nav); move lang select + logout into sidebar foot user chip area for now.
- [ ] **Step 4:** Strip `.tabs` nav from TripShell (keep header row, accent, ctx, ChatDrawer); fix accent variable names.
- [ ] **Step 5:** `npm test`, `npm run build`; manual: navigate all routes both contexts, collapse persists, People hidden for editor (test with second seeded account), `hidden_features` respected, Leader label never says Admin.
- [ ] **Step 6: Commit** `feat(ui): fixed collapsible sidebar, Home-first navigation`

### Task 7: Mobile tab bar + long-press trip switch + More sheet

**Files:**
- Create: `src/components/TabBar.tsx`, `src/hooks/useLongPress.ts`
- Modify: `src/App.tsx` (mount TabBar in Chrome <1024px), `src/styles.css` (port `.tabbar .tab` + safe-area + sheet styles), `src/i18n.tsx` (`more`, `allTrips`, `logout` reuse)
- Test: `tests/longpress.test.ts`

**Interfaces:**
- Consumes: `navModel` (money/plan/docs `to` links), `Sheet`, session trips.
- Produces: `useLongPress(onLong: () => void, ms = 450)` returning `{ onPointerDown, onPointerUp, onPointerLeave, onPointerCancel, onClick, onContextMenu }`; pure core `longPressMachine` exported: given event timeline returns whether click should be suppressed.
- Tabs: Home `/` · Plan · Money · Docs · More(sheet: People, Settings, Admin?, Log out). Long-press on Plan/Money/Docs opens trip-switch sheet; in account context those three link to the LAST trip (session trips[0] fallback) — store `jl-last-trip` in localStorage on TripShell mount.

- [ ] **Step 1: Tests first** — `tests/longpress.test.ts` on `longPressMachine`: down→(500ms)→up ⇒ long fired once, click suppressed; down→(200ms)→up ⇒ no long, click allowed; down→leave ⇒ cancelled. Use vitest fake timers. FAIL first.
- [ ] **Step 2:** Implement hook + machine → PASS.
- [ ] **Step 3:** Build TabBar + wire sheets; suppress `contextmenu` on long-press tabs; active tab = brand + dot; 48px min height; `padding-bottom: calc(6px + env(safe-area-inset-bottom))`.
- [ ] **Step 4:** `npm test`, `npm run build`; manual at 390px: tab nav works, long-press Money opens switcher, More sheet lists correct items per role, no horizontal scroll at 360px.
- [ ] **Step 5: Commit** `feat(ui): mobile tab bar with long-press trip switcher and More sheet`

### Task 8: e2e repair + full ritual + build-status

**Files:**
- Modify: `scripts/e2e.mjs` (selectors that referenced `.topbar`/`.tabs` navigation), `docs/build-status.md`
- Test: the ritual itself

- [ ] **Step 1:** `grep -n "topbar\|tabs\|nav" scripts/e2e.mjs` — update every navigation selector to the new shell (sidebar `.nav-item` by href, tab bar fallback). Keep assertions' INTENT identical; do not delete steps.
- [ ] **Step 2:** Full ritual (DEV-RUNBOOK): kill workerd + wrangler parent, `sleep 3`, `rm -rf .wrangler/state`, `npm run db:local`, `npm run build`, background `npx wrangler dev --port 8788`, poll `/api/health`, `node scripts/e2e.mjs`. Expect `E2E PASSED`. Fix regressions found (UI-side only) and re-run until green.
- [ ] **Step 3:** Update `docs/build-status.md`: v0.19 P1–P3 shipped, P4 pages pending, alias-token debt note for P5.
- [ ] **Step 4: Commit** `feat(ui): v0.19 foundation — e2e green, build status updated`

---

## Not in this plan (follow-up plan after foundation merges)

- **P4** page-by-page restyle: Trips folder cards+covers, Dashboard, Plan (day rail, pin sync visuals, per-mode route lines), Money merge (Ledger/Payments/MySpend under one page with seg tabs + empty states), Documents (+Receipts empty state), People, Settings cards, Admin lieflat charts, Auth carousel (needs 5–6 licensed images sourced first — Sage input).
- **P5** cleanup: delete alias tokens + `2`-suffix renames + dead CSS, BM copy audit, contrast pass, final adversarial review.

## Self-review notes

- Old `.btn/.card/.badge/.tabs` classes stay functional through T8 — pages untouched until P4, so every task leaves the app shippable. Verified no task deletes a class another file still uses (T6 removes `.tabs` usage in the only file that renders it; the CSS class itself stays until P5).
- Type coverage: `navModel` label typed `keyof Dict` keeps i18n parity compile-checked.
- No new deps anywhere; all tests are pure-logic vitest (fake timers only), honoring the no-DOM-test-deps constraint.
