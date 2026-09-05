import { describe, it, expect } from 'vitest';
import { checkInvite, newInviteCode } from '../shared/invites';

const base = { revoked: 0, expires_at: '2026-12-31T00:00:00Z', max_uses: 10, used_count: 0 };
const NOW = '2026-09-05T00:00:00Z';

describe('invites', () => {
  it('a live invite is ok', () => expect(checkInvite(base, NOW)).toBe('ok'));
  it('revoked wins over everything', () =>
    expect(checkInvite({ ...base, revoked: 1, used_count: 99 }, NOW)).toBe('revoked'));
  it('expired when past expires_at', () =>
    expect(checkInvite({ ...base, expires_at: '2026-09-04T23:59:59Z' }, NOW)).toBe('expired'));
  it('boundary: expiring exactly now is expired', () =>
    expect(checkInvite({ ...base, expires_at: NOW }, NOW)).toBe('expired'));
  it('null expires_at never expires (referral codes)', () =>
    expect(checkInvite({ ...base, expires_at: null }, '2030-01-01T00:00:00Z')).toBe('ok'));
  it('exhausted at max_uses', () =>
    expect(checkInvite({ ...base, used_count: 10 }, NOW)).toBe('exhausted'));
  it('one use left is still ok', () =>
    expect(checkInvite({ ...base, used_count: 9 }, NOW)).toBe('ok'));
  it('code format: inv_ + 32 lowercase hex from the given bytes', () => {
    const code = newInviteCode(new Uint8Array(16).fill(0xab));
    expect(code).toBe('inv_' + 'ab'.repeat(16));
    expect(code).toMatch(/^inv_[0-9a-f]{32}$/);
  });
});
