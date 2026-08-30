# Deploying Jelajah to Cloudflare (free tier)

Everything runs on Cloudflare's free plan: **Pages** (the app), **Workers** (the API),
**D1** (database) and **R2** (PDF storage). Expected monthly cost: **RM 0**.

There are two ways to deploy. **Path A needs no terminal at all** — everything
happens in your browser on github.com and dash.cloudflare.com. Path B is the
classic CLI route if you prefer working from a terminal.

> One caveat either way: enabling **R2** asks for a payment card on file, even
> though 10 GB storage is free and family usage stays far below the limits.
> D1, Pages and Workers need no card.

---

## Path A — fully in the browser (recommended, ~20 min)

### A1. Put the code on GitHub
1. Create a free account at github.com (if you don't have one).
2. Click **＋ → New repository**, name it `jelajah`, keep it **Private**, create.
3. On the empty repo page choose **uploading an existing file**, then drag in the
   **contents** of the unzipped `jelajah` folder (all files and folders — you can
   drag the whole selection at once; `node_modules` is not in the zip, don't worry).
4. Commit.

### A2. Create the database and bucket (Cloudflare dashboard)
1. Sign up free at dash.cloudflare.com.
2. Sidebar → **Storage & Databases → D1** → **Create database** → name it
   `jelajah-db`. Open it and copy its **Database ID**.
3. Sidebar → **R2** → enable R2 (this is the card-on-file step) →
   **Create bucket** → name it `jelajah-files`.

### A3. Point the config at your database
Back on GitHub, open `wrangler.toml` in your repo, click the ✏️ edit icon and:
- replace `REPLACE_WITH_YOUR_D1_ID` with the Database ID you copied;
- replace the `SESSION_SECRET` value with a long random string (just mash the
  keyboard, 40+ characters);
then commit the change.

### A4. Connect Pages to the repo
1. Cloudflare sidebar → **Workers & Pages → Create → Pages → Connect to Git**.
2. Authorise GitHub, pick the `jelajah` repo.
3. Build settings: **Build command** `npm run build` · **Build output directory** `dist`.
4. Click **Save and Deploy** and wait ~2 minutes.
5. When it finishes you get your URL: `https://jelajah-xxx.pages.dev`.
   (If the first deploy shows errors about DB bindings, open the project's
   **Settings → Bindings** and confirm `DB` → jelajah-db and `FILES` → jelajah-files
   are listed — they're read from wrangler.toml; add them manually here if not —
   then **Deployments → Retry deployment**.)

### A5. First-run setup (in the app itself)
Open your URL. Because the database is empty, the app shows a one-time
**"Welcome! Set up your admin account"** screen: enter your name, email and
password, leave **"Seed the Jelajah Jepun 2026 trip"** ticked, and click
**Create & start**. That single click creates all database tables, your admin
login, and the Japan trip with its 16 travellers — and signs you in. The screen
never appears again after that.

### A6. Load your documents
Trip → **Documents** → upload the 8 PDFs one at a time and confirm each review
screen. Untick "create expense" for the 3 itinerary PDFs (their receipts carry the
money) and add the ATOME instalment due dates on those two receipts' screens.
Then **People** → create family logins (temporary passwords are shown once —
send via WhatsApp).

**Bonus of Path A:** future updates are automatic — when I give you a new version,
you upload the changed files to GitHub and Cloudflare redeploys itself.

---

## Path B — from a terminal (Mac, ~15 min)

Requires Node.js 20+ (nodejs.org).

```bash
npm install
npx wrangler login                          # opens browser to authorise
npx wrangler d1 create jelajah-db           # copy database_id into wrangler.toml
npx wrangler r2 bucket create jelajah-files
# edit wrangler.toml: database_id + SESSION_SECRET
npm run deploy                              # prints your live URL
```

Then do steps **A5–A6** above in the browser (the setup screen replaces any need
to run seed SQL — though the CLI seed is still available via
`npm run seed:gen && npm run db:remote` if you prefer a preset admin password).

---

## Everyday reference

| What | How |
|---|---|
| Update the app | Path A: commit changed files on GitHub (auto-deploys) · Path B: `npm run deploy` |
| Backup the database | `npx wrangler d1 export jelajah-db --remote --output backup.sql` (CLI), or D1 console in the dashboard |
| Run parser tests | `npm test` |
| Browser e2e test | `npm i -D playwright` once, then `node scripts/e2e.mjs` against `wrangler pages dev` |
| Custom domain (optional) | Pages project → Custom domains (~RM 50/yr, the only possible cost) |

### Free-tier headroom

| Resource | Free limit | Your likely usage |
|---|---|---|
| Workers requests | 100,000/day | a few hundred/day |
| D1 storage | 5 GB | a few MB |
| R2 storage | 10 GB | ~100 MB for hundreds of PDFs |
| Pages bandwidth | unlimited | — |

FX rates come from the free `frankfurter.dev` API (ECB data, MYR/JPY supported),
cached in D1 per date; if it's ever unreachable the rate field is manually editable.
