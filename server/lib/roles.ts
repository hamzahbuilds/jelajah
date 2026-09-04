// Per-trip roles (spec: docs/06-spec-v0.16-multitenant.md).
// Pure — no Env, no D1 — so the migration mapping and rank logic are unit-testable.

export type TripRole = 'leader' | 'editor' | 'viewer';
export const ROLE_RANK: Record<TripRole, number> = { viewer: 0, editor: 1, leader: 2 };

export function atLeast(role: TripRole | null, min: TripRole): boolean {
  return role != null && ROLE_RANK[role] >= ROLE_RANK[min];
}

/** m001 backfill: how a pre-multitenant membership maps to a role. */
export function migratedRole(m: { isAdminUser: boolean; hasAccount: boolean; memberCanEditPlan: boolean }): TripRole {
  if (m.isAdminUser) return 'leader';
  if (m.hasAccount && m.memberCanEditPlan) return 'editor';
  return 'viewer';
}
