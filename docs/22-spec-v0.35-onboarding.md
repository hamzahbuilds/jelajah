# v0.35 — Onboarding

Status: built (2026-11-08), verified locally.

## Welcome tour (first sign-up)
- Shown once, anywhere in the app, right after someone's account is created
  (Google sign-up through an invite, password sign-up when Google is off, or
  an admin creating the account).
- 3 steps: Welcome (what Jelajah is) → Plan with AI → Travel together.
- Skip (or Esc) on any step; last step offers **Plan my first trip** (goes to
  `/new`) or **Look around**. Every way out marks it seen.

## Plan intro (starting a new plan)
- Shown when `/new` opens on a fresh plan (not when resuming a saved draft).
  If the plan was started from the home composer, the first message is sent
  only after the intro closes.
- 3 steps: Describe your trip → Or bring a link → Pick and save.
- **Skip** / **Continue**, and a **Don't show this again** checkbox. Ticking it
  (then Skip or Start planning) saves it on the account, so it applies on
  every device. Without the tick it shows again next time.
- When it closes, focus lands in the chat box.

## Data
- `users.welcome_pending` (1 for new sign-ups; existing accounts 0) and
  `users.skip_plan_intro`, added by UPGRADES.
- `GET /api/me` → `user.onboarding = { welcome, skip_plan_intro }`.
- `PATCH /api/me` accepts `welcome_done: true` and `skip_plan_intro: boolean`.
- Admin-created accounts no longer get the "set your password" nudge while
  Google sign-in is on (there is no password to set).

## UI
- `src/components/Onboarding.tsx` (`StepsDialog`, `WelcomeTour`, `PlanIntro`),
  `onboarding.css` (tokens only). Native modal `<dialog>` via `Dialog.tsx`
  with a new `lightDismiss={false}`: Esc closes (= Skip), a tap outside does not.
- Step changes are announced through an `aria-live` region; focus stays on
  the primary button.
