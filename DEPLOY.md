# Deploying Jelajah to Cloudflare (free tier)

Everything runs on Cloudflare's free plan as a single **Worker** (the API plus the
app's static files), with **D1** (database) and **Workers KV** (PDF storage).
Expected monthly cost: **RM 0**, and **no credit card is required for anything**.

KV's free tier gives 1 GB of file storage (≈700 PDFs the size of yours) and
1,000 writes/day — far beyond family use. If you ever outgrow it, the app also
supports R2 (10 GB free but requires a card on file): swap the binding in
`wrangler.toml` as noted there; the code auto-detects which store is bound.

There are two ways to deploy. **Path A needs no terminal at all** — everything
happens in your browser on github.com and dash.cloudflare.com. Path B is the
classic CLI route if you prefer working from a terminal.

---

## Path A — fully in the browser (recommended, ~20 min)

### A1. Put the code on GitHub
1. Create a free account at github.com (if you don't have one).
2. Click **＋ → New repository**, name it `jelajah`, keep it **Private**, create.
3. On the empty repo page choose **uploading an existing file**, then drag in the
   **contents** of the unzipped `jelajah` folder (all files and folders — you can
   drag the whole selection at once; `node_modules` is not in the zip, don't worry).
4. Commit.

### A2. Create the database and file store (Cloudflare dashboard)
1. Sign up free at dash.cloudflare.com — no card at any point.
2. Sidebar → **Storage & Databases → D1** → **Create database** → name it
   `jelajah-db`. Open it and copy its **Database ID**.
3. Sidebar → **Storage & Databases → KV** → **Create namespace** → name it
   `jelajah-files`. Copy its **Namespace ID**.

### A3. Point the config at your database and namespace
Back on GitHub, open `wrangler.toml` in your repo, click the ✏️ edit icon and:
- replace `REPLACE_WITH_YOUR_D1_ID` with the D1 Database ID;
- replace `REPLACE_WITH_YOUR_KV_ID` with the KV Namespace ID;
- replace the `SESSION_SECRET` value with a long random string (just mash the
  keyboard, 40+ characters);
then commit the change.

### A4. Connect the repo to a Worker
1. Cloudflare sidebar → **Workers & Pages → Create** → import/connect your
   GitHub repository (the default Workers git flow).
2. Settings when asked: **Build command** `npm run build` · **Deploy command**
   `npx wrangler deploy` (this is the default — leave it).
3. Save and deploy, wait ~2 minutes.
4. You get your URL: `https://jelajah.<your-subdomain>.workers.dev`.
   Bindings (DB, FILES) and the session secret are read from `wrangler.toml`,
   so nothing else to configure. If a deploy fails after a config change, fix
   the file on GitHub and it redeploys on commit (or use **Retry deployment**).

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
npx wrangler kv namespace create FILES      # copy the id into wrangler.toml
# edit wrangler.toml: database_id + kv id + SESSION_SECRET
npm run deploy                              # builds then `wrangler deploy`; prints your live URL
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
| Browser e2e test | `npm i -D playwright` once, then `node scripts/e2e.mjs` against `npm run dev:full` |
| Custom domain (optional) | the Worker → Settings → Domains & Routes (~RM 50/yr, the only possible cost) |

### Free-tier headroom

| Resource | Free limit | Your likely usage |
|---|---|---|
| Workers requests | 100,000/day | a few hundred/day |
| D1 storage | 5 GB | a few MB |
| KV file storage | 1 GB, 1,000 writes/day | ~100 MB, a handful of writes/day |
| Pages bandwidth | unlimited | — |

FX rates come from the free `frankfurter.dev` API (ECB data, MYR/JPY supported),
cached in D1 per date; if it's ever unreachable the rate field is manually editable.
