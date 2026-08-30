/// <reference types="@cloudflare/workers-types" />

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  SESSION_SECRET: string;
}
