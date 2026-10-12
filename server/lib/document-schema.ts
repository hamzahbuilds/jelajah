import type { Env } from '../env.d';
export const DOCUMENT_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS document_categories (trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id), name TEXT NOT NULL COLLATE NOCASE, PRIMARY KEY(trip_id,user_id,name))`,
  `CREATE TABLE IF NOT EXISTS document_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE, name TEXT NOT NULL, owner_id INTEGER NOT NULL REFERENCES users(id))`,
  `CREATE TABLE IF NOT EXISTS document_group_members (group_id INTEGER NOT NULL REFERENCES document_groups(id) ON DELETE CASCADE, participant_id INTEGER NOT NULL REFERENCES participants(id), PRIMARY KEY(group_id,participant_id))`,
  `CREATE TABLE IF NOT EXISTS document_folders (id INTEGER PRIMARY KEY AUTOINCREMENT, trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE, name TEXT NOT NULL, owner_id INTEGER NOT NULL REFERENCES users(id), visibility TEXT NOT NULL CHECK(visibility IN ('private','group','trip')), group_id INTEGER REFERENCES document_groups(id))`,
];
export async function ensureDocumentSchema(env: Env) {
  for (const sql of DOCUMENT_SCHEMA) await env.DB.prepare(sql).run();
}
