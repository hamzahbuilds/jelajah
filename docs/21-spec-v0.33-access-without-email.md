# v0.33 — Account access without an email service

Status: built (2026-11-08), verified locally. Jelajah has no email sender in
production, so activation and "forgot password" can't rely on email.

## A. Admin sign-in links
- Admin → Accounts → **Sign-in link** (per user) or **Create account** (no
  password field any more): the server makes a one-time link
  `/reset-password#<token>`, valid **72 hours**, and the admin sends it by hand
  (Copy, or "Send on WhatsApp" with a prefilled BM/EN message).
- Reuses the password-reset machinery (`password_resets`, `/reset-password`,
  `POST /api/journey/recovery/reset`): one use, kills the user's sessions and
  API tokens, invalidates sibling links. Token stays in the URL fragment.
- `POST /api/users/:id/access-link` (admin only; 404 unknown, 409 disabled).
  Audited as `access_link_create`. The old "temporary password" flow is gone.
- Forgot-password page now says to ask an organiser/admin for a sign-in link
  (and offers Google when it's on).

## B. Sign in with Google
- OAuth 2.0 code flow with PKCE, nonce and a `g_oauth` state cookie
  (HttpOnly, Secure, SameSite=Lax, Path=/api/auth/google, 10 min). No SDK.
  ID token comes straight from Google's token endpoint, so only its claims are
  checked (iss, aud, exp, nonce, `email_verified`).
- `GET /api/auth/providers` → `{google}`; `GET /api/auth/google/start?next=&invite=`;
  `GET /api/auth/google/callback`.
- Matching: `users.google_sub` first, then the **verified** email (links the
  Google id on first use). A new person needs an invite: from `/join/<code>`
  the button carries the code and creates the account (counts an invite use;
  trip invites add them to the trip). Otherwise `/login?google=no_account`.
- Disabled users are refused. Google-only accounts get an unguessable random
  password; an admin sign-in link can set a real one later.
- Errors come back as `?google=cancelled|failed|no_account|disabled|unverified|unavailable`
  on `/login` (or the invite page).
- Off unless both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set.

## Setup (production)
1. Google Cloud console → APIs & Services → **OAuth consent screen**: External,
   app name Jelajah, support email; scopes `openid email profile` only (no
   verification review needed); publish the app ("In production").
2. **Credentials → Create OAuth client ID → Web application**. Authorised
   redirect URI: `https://<your-host>/api/auth/google/callback`
   (for local dev also `https://127.0.0.1:8788/api/auth/google/callback`).
3. `npx wrangler secret put GOOGLE_CLIENT_ID` and
   `npx wrangler secret put GOOGLE_CLIENT_SECRET` (each deploys immediately).

## Schema
`users.google_sub TEXT` + unique partial index `idx_users_google` (UPGRADES).

## v0.34 — Google only (owner decision, 2026-11-08)
- With `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` set, Google is the only way in:
  `POST /api/auth/login` → 403 `password_login_disabled`, password sign-up
  `POST /api/join/:code` → 403 `password_signup_disabled`, admin sign-in links
  → 409. `/api/auth/providers` returns `{google, password}`.
- Login, invite and forgot-password pages show only "Continue with Google".
  Sign-up stays invite-only (Google on the invite page).
- Admin → Create account: use the person's Google email; they sign in with
  Google and the account links by verified email. No link to send.
- Fallback / break-glass: without the Google secrets (local dev, tests, or
  `wrangler secret delete` in an emergency) the password forms come back.
- First-run setup (empty database) still uses the password form.
- Production: Google Cloud project `jelajah-514106` (hamzah.builds@gmail.com),
  consent screen In production, web client "Jelajah web", privacy page
  `/privacy.html`.
