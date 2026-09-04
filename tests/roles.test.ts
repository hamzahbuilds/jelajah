import { describe, it, expect } from 'vitest';
import { ROLE_RANK, atLeast, migratedRole } from '../server/lib/roles';

describe('roles', () => {
  it('ranks leader > editor > viewer', () => {
    expect(ROLE_RANK.leader).toBeGreaterThan(ROLE_RANK.editor);
    expect(ROLE_RANK.editor).toBeGreaterThan(ROLE_RANK.viewer);
  });

  it('atLeast: exact and above pass, below and null fail', () => {
    expect(atLeast('leader', 'editor')).toBe(true);
    expect(atLeast('editor', 'editor')).toBe(true);
    expect(atLeast('viewer', 'editor')).toBe(false);
    expect(atLeast(null, 'viewer')).toBe(false);
  });

  // the m001 mapping table from the spec, one test per row
  it('admin user becomes leader regardless of flags', () => {
    expect(migratedRole({ isAdminUser: true, hasAccount: true, memberCanEditPlan: false })).toBe('leader');
  });
  it('account holder on an editable-plan trip becomes editor', () => {
    expect(migratedRole({ isAdminUser: false, hasAccount: true, memberCanEditPlan: true })).toBe('editor');
  });
  it('account holder on a locked-plan trip becomes viewer', () => {
    expect(migratedRole({ isAdminUser: false, hasAccount: true, memberCanEditPlan: false })).toBe('viewer');
  });
  it('account-less traveller is viewer either way', () => {
    expect(migratedRole({ isAdminUser: false, hasAccount: false, memberCanEditPlan: true })).toBe('viewer');
    expect(migratedRole({ isAdminUser: false, hasAccount: false, memberCanEditPlan: false })).toBe('viewer');
  });
});
