/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB: D1Database;
  /** File store: a KV namespace (free, no card) or an R2 bucket — auto-detected at runtime. */
  FILES: KVNamespace | R2Bucket;
  SESSION_SECRET: string;
}
