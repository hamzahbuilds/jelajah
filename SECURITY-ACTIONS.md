# Security actions — Jelajah

**Written 1 Sep 2026.** Do step 1 today. The rest can follow at your pace.

The repo `github.com/hamzahbuilds/jelajah` is **public**, and it contains real
personal data belonging to your family. Nothing here is a break-in — no
attacker is required for this to be a problem, because the data is simply
readable by anyone who finds the repo.

---

## Step 1 — Make the repo private (30 seconds, do this first)

This is the one action that fixes everything below at once.

1. Open <https://github.com/hamzahbuilds/jelajah/settings>
2. Scroll to the bottom, **Danger Zone**
3. **Change repository visibility** → **Make private** → type `hamzahbuilds/jelajah` to confirm

**Nothing breaks.** Cloudflare's GitHub integration keeps building private
repos — it authenticates as an installed GitHub App, not as an anonymous
visitor. Your deploys carry on exactly as before.

✅ **Check:** the repo page shows a `Private` badge next to the name, and your
next push still triggers a Cloudflare build.

---

## What is exposed, and why step 1 handles it

### Real personal data (this is the actual issue)

| Where | What |
|---|---|
| `server/lib/schema.ts` — the `JAPAN_TRIP` seed block | All **16 travellers' full legal names**, exactly as printed on their booking documents |
| `tests/fixtures/*.txt` (13 files) | Real booking documents as extracted text: passenger and guest name lists (5 files), personal email addresses (5 files), passport references (2 files) |
| `docs-samples/*.pdf` (13 files) | The original PDFs those fixtures came from — same content, plus whatever else the vendor printed on them |

These files are not a mistake to delete. The parser test suite reads the
fixtures and asserts against real vendor layouts — that is *why* the parsers
survive contact with actual Trip.com and AirAsia output, and 14 of the 61
original unit tests depend on them. Scrubbing them would cost you the thing
that makes the parsing trustworthy.

**So the fix is to close the repo, not to strip the data.** Private repo,
fixtures intact, tests keep their teeth.

### `wrangler.toml` — lower priority than it looks

The file is committed and contains:

- `SESSION_SECRET` in plaintext under `[vars]`
- the D1 `database_id` and the KV namespace `id`

**The secret is not actually used by the application.** It is declared in
`server/env.d.ts` and read nowhere. Sessions are 256-bit random tokens from
`crypto.getRandomValues()`, stored in the D1 `sessions` table and validated by
looking the token up (`server/lib/auth.ts:42-66`). There is no cookie signing
or HMAC anywhere in the codebase, so knowing that string grants nobody
anything today.

The database and namespace ids are identifiers, not credentials — they are
useless without authenticated access to your Cloudflare account.

It still deserves cleaning up (step 3), for one reason: the comment above it
says *"Change this to any long random string before deploying (cookie signing
secret)"*, which invites a future change to start actually using it. A live
secret that has been public since day one is a bad foundation for that.

---

## Step 2 — Decide about the history (optional, probably skip)

Making the repo private stops anyone new from reading it. It does not erase
what was already public: anyone who cloned or scraped it before today keeps
their copy, and so may search-engine and code-search caches for a while.

Rewriting history to purge the fixtures is possible (`git filter-repo`), but it
means force-pushing a rewritten `main`, which breaks the Cloudflare build link
and every existing clone. For family holiday bookings that were exposed on a
low-traffic repo, that trade is not worth it.

**Recommendation: skip this.** Go private and move on.

The one thing worth doing instead: if any of those emails is reused as a
password-reset address on something important, that is normal hygiene territory
— nothing about this repo made it more urgent.

---

## Step 3 — Remove `SESSION_SECRET` from `wrangler.toml` (housekeeping)

Do this whenever convenient. Because the value is unused, there is **no
ordering trap and no rotation needed** — deleting it cannot log anyone out or
break a deploy.

Delete these three lines from `wrangler.toml`:

```toml
[vars]
# Change this to any long random string before deploying (cookie signing secret)
SESSION_SECRET = "..."
```

Commit and push as usual through GitHub Desktop.

✅ **Check:** after the Cloudflare build finishes, log out and log back in on
the live site. Sessions are unaffected because they never used this value.

> **If a future version ever does start signing cookies**, set the secret in
> the Cloudflare dashboard (Workers → `jelajah` → Settings → Variables and
> Secrets → **Encrypt**), never in `wrangler.toml`. Note the trap for that day:
> a plaintext `[vars]` entry in the config **overwrites** a dashboard secret of
> the same name on the next deploy, so the config must not carry that key at
> all.

---

## Step 4 — Keep it from coming back

Already done, in the `.gitignore` added on 1 Sep 2026: build output,
`node_modules/`, local wrangler state, `e2e-shots/` and `graphify-out/` are no
longer committable by accident.

`wrangler.toml` is deliberately **not** ignored — it is this repo's live
Cloudflare config and must stay tracked. The rule to hold instead: never put a
credential in it. Secrets go in the Cloudflare dashboard as encrypted
variables, and for local `wrangler dev` they go in a `.dev.vars` file, which the
`.gitignore` now excludes.

---

## Summary

| # | Action | Who | Effort | Priority |
|---|---|---|---|---|
| 1 | Make the repo private | you | 30 sec | **Today** |
| 2 | Rewrite history | — | hours | Skip |
| 3 | Delete `SESSION_SECRET` from `wrangler.toml` | you | 1 min | Housekeeping |
| 4 | Keep secrets out of the repo | ongoing | — | Habit |
