# 28. Public homepage and site header (v0.42)

## Routes when signed out

| Path | Shows |
|---|---|
| `/` | `Home` (public homepage). Signed in, `/` is still My trips. |
| `/discover`, `/guides/:id` | `PublicJourneys` under the shared `SiteHeader`. |
| `/login` | Has a "Home" link back to `/`. |

`api.ts` no longer redirects a 401 on `/` to the login page.

## SiteHeader (`src/components/SiteHeader.tsx`)

- One `<nav>` at every width.
- When the row fits, the links sit inline. When it doesn't, the same `<ul>` becomes a `popover="auto"` menu behind the Menu button.
- There is no fixed breakpoint: a ResizeObserver measures the row. While the menu is collapsed, it only re-measures when the header grows.
- The menu is positioned with `anchor()`, with a fixed offset before it for browsers that don't support anchors.
- The header's logo always goes to `/`. The header renders its own `IconDefs`, because public pages sit outside the app shell.

## Home (`src/pages/Home.tsx`, `home.css`, `homeCopy.ts`)

Sections, in order:

1. Hero, with a drawn product mock. It shows no real trip data.
2. A "Plans from" strip.
3. Six feature cards.
4. Three steps.
5. Comparison table. It scrolls inside its own frame on phones, with the row labels kept in view.
6. Destination photos from `/api/public/carousel` (Unsplash, credited). Each one opens `/discover?q=<place>`.
7. Up to three fresh Discover journeys.
8. FAQ.
9. A closing call to action.
10. Footer.

Behaviour:

- Copy is in English and Bahasa Malaysia (`homeCopy.ts`).
- Sections fade up as they scroll into view, using Motion `whileInView`. Under reduced motion the transforms drop.
- The floating chips only animate with `prefers-reduced-motion: no-preference`.
- The page is lazy-loaded (about 3 KB JS gzip).

## Local test account

Local D1 only. It is not in the migrations or in production.

- **Email:** `onboarding@jelajah.test`
- **Password:** `onboard-local-2026`

To replay the welcome tour and the plan intro:

```sh
npx wrangler d1 execute DB --local --command "UPDATE users SET welcome_pending=1, skip_plan_intro=0 WHERE email='onboarding@jelajah.test'"
```
