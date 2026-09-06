/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB: D1Database;
  /** File store: a KV namespace (free, no card) or an R2 bucket — auto-detected at runtime. */
  FILES: KVNamespace | R2Bucket;
  /**
   * Unsplash API access key (secret; `wrangler secret put UNSPLASH_ACCESS_KEY`,
   * or a `.dev.vars` line locally — NEVER a wrangler.toml [vars] entry).
   * Optional: every Unsplash-backed route/feature is key-optional and 404s
   * with {error:'no_unsplash'} (or silently no-ops) when this is unset.
   */
  UNSPLASH_ACCESS_KEY?: string;
}

// No SESSION_SECRET binding: sessions are opaque 256-bit random tokens stored
// server-side in the `sessions` table (see server/lib/auth.ts) — nothing is
// signed, so there is no secret to hold. If cookie signing is ever added, bind
// the secret as an ENCRYPTED variable in the Cloudflare dashboard, never as a
// plaintext [vars] entry in wrangler.toml (a [vars] key overwrites a dashboard
// secret of the same name on deploy).
