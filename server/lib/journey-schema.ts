import type { Env } from "../env.d";
export const JOURNEY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS journey_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS itineraries (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    owner_id INTEGER REFERENCES users(id), content TEXT NOT NULL DEFAULT '{"stops":[],"days":[]}', version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_group_itinerary ON itineraries(trip_id) WHERE owner_id IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_personal_itinerary ON itineraries(trip_id, owner_id) WHERE owner_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS itinerary_viewers (itinerary_id INTEGER NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id), PRIMARY KEY(itinerary_id,user_id))`,
  `CREATE TABLE IF NOT EXISTS private_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id), day TEXT NOT NULL, content TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS idx_private_notes_owner ON private_notes(trip_id,user_id)`,
  `CREATE TABLE IF NOT EXISTS password_resets (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL, claimed TEXT, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS journey_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS route_cache (key TEXT PRIMARY KEY, content TEXT NOT NULL, expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS guest_links (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE, note_ids TEXT NOT NULL DEFAULT '[]', expires_at INTEGER, revoked INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS journey_guides (id TEXT PRIMARY KEY, trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    draft TEXT NOT NULL, published TEXT, title TEXT NOT NULL, destination TEXT NOT NULL, duration INTEGER NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')), taken_down INTEGER NOT NULL DEFAULT 0)`,
];

// No swallowed ALTER errors or prematurely committed migration markers. Each
// operation is safe to retry after interruption or a concurrent cold start.
export async function ensureJourneySchema(env: Env) {
  for (const sql of JOURNEY_SCHEMA) await env.DB.prepare(sql).run();
  const trips = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='trips'",
  ).first();
  if (!trips) return false;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO itineraries(trip_id) SELECT id FROM trips",
    ),
    env.DB.prepare(
      "INSERT OR IGNORE INTO journey_migrations(name) VALUES ('journey-v1')",
    ),
  ]);
  return true;
}
