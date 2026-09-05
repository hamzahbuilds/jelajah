// Invite/referral validity (spec: docs/06-spec-v0.16-multitenant.md §Registration
// + Addendum 1). Pure — the caller supplies now and randomness.

export type InviteStatus = 'ok' | 'expired' | 'revoked' | 'exhausted';

export function checkInvite(
  inv: { revoked: number; expires_at: string | null; max_uses: number; used_count: number },
  nowIso: string,
): InviteStatus {
  if (inv.revoked) return 'revoked';
  if (inv.expires_at != null && inv.expires_at <= nowIso) return 'expired';
  if (inv.used_count >= inv.max_uses) return 'exhausted';
  return 'ok';
}

/** 'inv_' + 32 hex chars from 16 caller-provided random bytes. */
export function newInviteCode(rand: Uint8Array): string {
  return 'inv_' + [...rand].map(b => b.toString(16).padStart(2, '0')).join('');
}
