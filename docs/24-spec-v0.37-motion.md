# v0.37 — Motion with Animate UI

Status: built locally (2026-11-08), not deployed.

Owner choices: replace "everything that moves" with Animate UI's motion
(Motion library + its tokens), level **subtle**; keep the static icon sprite
but animate a dozen key icons.

## Setup
- Packages: `motion@^14`, `@animate-ui/react@^2` (path C: Jelajah has no
  Radix/shadcn/Tailwind, so Motion is wired into our own components with
  Animate UI's tokens from `@animate-ui/react/utils/motion`).
- Agent skill: `.claude/skills/animate-ui` (+ `skills-lock.json`), installed
  with `npx skills add imskyleen/animate-ui`.
- `ReducedMotionConfig` at the root (`src/main.tsx`): transforms and layout
  moves are dropped under reduced motion; fades and blurs stay.
- Main bundle: ~148 KB → ~212 KB gzip.

## What moves, and on which token
| Where | Motion |
| --- | --- |
| Every dialog (`Dialog.tsx`: Modal, FormSheet, Confirm, onboarding, sheets, date sheet) | Centered: tips up from `scale.dialog`, un-blurs on `spring.dialog`, fade ahead on `transition.dialogFade`. Phone sheets: slide up on `transition.sheet`. Exit: `transition.dismiss` (needs `<AnimatePresence>` at the call site). Backdrop colour fades on `transition.overlay`. |
| Date range popover (desktop) | Grows from its trigger from `scale.popover` on `spring.pop`, leaves the same way. |
| Toasts | Rise from the edge, from `scale.toast` out of `blur.surface` on `spring.toast`; others reflow; leave on `transition.dismiss`. |
| Segmented tabs | One surface slides on `spring.selection` (shared `layoutId`). |
| Trip brief / onboarding steps | `StepSwap`: `shift.step` + `blur.panel`, `transition.panelOut` → `panelIn`, mirrored going back. |
| Chips, tags, suggestions | Pop in on `spring.pop` from 0.8, out on `transition.popOut`, neighbours on `spring.reflow`. |
| Country cards, chat messages | List recipe: rise 8px, `spring.reflow` + `transition.fade`. |
| Ticket | Route draws (pathLength), plane flies (transforms), day count rolls on `spring.number`. |
| Onboarding | Icon swaps on `transition.swap` (`scale.icon`, `blur.icon`); active dot slides (`layoutId`). |
| Buttons, chips, cards (CSS) | Press to `scale.press` (0.97; cards `scale.choice` 0.985) on `spring.press` as CSS `linear()`; colours on `ease`. |
| Menus | `transition.menu` from `scale.menu` (CSS `@starting-style`). |
| Page changes | View transition: old page fades on `ease.leave` (0.2s), new fades in + rises 8px on `ease.out` (0.35s); reduced motion = crossfade. |

## Animated icons
`src/components/animate-ui/icons/` (Animate UI registry, Lucide): sparkles,
check, calendar, trash-2, plus, refresh-cw, copy, link, arrow-right, x — plus
our own `plane` (sprite drawing, take-off hop). `Icon` renders these names
animated and plays them while the surrounding button/link is hovered, pressed
or keyboard-focused; `still` forces the sprite. All other icons: sprite.

## Added after review (same day)
- Bottom tab bar: the active dot slides between tabs (`layoutId`, `spring.selection`).
- Sidebar: one highlight glides to the active item (`layoutId`, `spring.selection`).
- Plan: activity rows rise in / leave and the rest close the gap (list recipe);
  keyed by day, so switching days doesn't animate every row.
- Dashboard: money figures roll to their value on `spring.number` (`RollingValue`;
  screen readers get the final value).
- Country flags: `flag-icons` SVGs (`Flag` in TripBrief.tsx) in the country
  search, cards, the chat's brief bar and the ticket. Emoji flags are banned by
  the UI rules and don't render on Windows; only the flags shown are fetched.
- Plane: sprite and animated icon now use Lucide's plane; on the ticket it's
  turned 45° so its nose follows the route (climb, level, descend) and it
  lands short of the destination flag.

## Not done / later
- Animate UI's Page Transition component needs React ≥ 19.3 (we're on
  19.2.8); CSS view transitions used instead.
- Bundle: could move to `LazyMotion` + `m` to save ~20 KB (registry icons use
  `motion.*`, so they'd need converting).
