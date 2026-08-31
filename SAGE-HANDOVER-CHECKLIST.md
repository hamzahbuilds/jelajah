# Handover Checklist — for Sage

Follow these steps to move Jelajah development to your other Claude account
without losing anything. Total time: ~15 minutes.

## Step 1 — Update GitHub with the handover build (5 min)

Upload the contents of **jelajah-v0.12.2-handover.zip** to your GitHub repo the
same way you always deploy (it contains no wrangler.toml, so your config is
safe). This bakes the complete documentation — HANDOVER.md and the docs/
folder — into the repo itself, which is the one thing every future session can
always read.

✅ Check: after Cloudflare finishes deploying, the site works as before, and
on GitHub you can see HANDOVER.md at the repo root and a docs/ folder.

## Step 2 — Prepare the new Claude account (5 min)

In the NEW account:
1. Create a Project (e.g. "Travels") so context persists across chats.
2. Add these files to the project's knowledge (download them from GitHub, or
   keep a copy of the handover zip and pull them from it):
   - HANDOVER.md
   - docs/build-status.md
   - docs/DEV-RUNBOOK.md
   - the spec files in docs/ (00–04) and travel-platform-spec.md
3. Keep the handover zip somewhere handy — for the first working session,
   attaching the whole zip to the chat gives the new Claude the entire
   codebase to test against.

## Step 3 — First message to the new Claude (copy-paste this)

---
You are taking over an existing project from a previous Claude session:
**Jelajah**, my family travel planner + expense splitter, live on Cloudflare
(free tier), currently v0.12.2. I'm attaching the full codebase as a zip; the
project knowledge also contains HANDOVER.md, docs/build-status.md,
docs/DEV-RUNBOOK.md and all feature specs.

Before doing anything else:
1. Read HANDOVER.md, then docs/build-status.md, then docs/DEV-RUNBOOK.md.
2. Set up the dev environment and run BOTH test suites per the runbook
   (61 unit tests + the 40-step e2e). Tell me the results.
3. Summarise back to me: what the app does today, the hard constraints
   (free tier / no card / browser-only deploys / never ship wrangler.toml),
   how we work together (questions → plan → approval → spec → approval →
   build → full test run → zip + screenshots + build-status update), and
   what the agreed backlog is.

Only after that will I give you the next feature request. Do not change any
code until the summary and green test run are done.
---

## Step 4 — Verify the handover took (5 min)

The new Claude's summary should mention, at minimum: RM0/no-credit-card
constraint · you deploy via GitHub upload with wrangler.toml never in zips ·
the schema auto-upgrade rule (columns in BOTH SCHEMA and UPGRADES) · My-spend
privacy guarantees · the approval cadence · backlog = rooms allocation,
PWA/offline, insights, BM copy pass. If anything is missing, point it at the
specific doc — everything is written down.

## Things only YOU hold (the new Claude must ask, never guess)

- GitHub repo access & the live wrangler.toml (D1 id, KV id, SESSION_SECRET)
- Cloudflare account (Worker "jelajah", D1 "jelajah-db", KV namespace)
- Your Gemini API key (already stored in the app's Settings)
- Admin login for the live site

## Also worth doing (optional, 2 min)

In the app itself, nothing changes — the handover is purely about who helps
you develop it. But since your old chat threads won't follow you: if there are
any delivered zips or screenshots in the old account you want to keep,
download them before you stop using it. The GitHub repo already contains
everything needed to rebuild any of it.
