import { describe, it, expect } from 'vitest';
import { navModel } from '../src/components/navModel';

describe('navModel', () => {
  it('account context: home + discover, admin foot when isAdmin', () => {
    const admin = navModel('/', { isAdmin: true, hidden: new Set() });
    expect(admin.main.map(i => i.key)).toEqual(['home', 'discover']);
    expect(admin.foot.map(i => i.key)).toEqual(['admin', 'settings']);

    const nonAdmin = navModel('/', { isAdmin: false, hidden: new Set() });
    expect(nonAdmin.foot.map(i => i.key)).toEqual(['settings']);
  });

  it('trip context: money is on for the ledger path', () => {
    const model = navModel('/trips/5/money/ledger', { isAdmin: false, myRole: 'leader', hidden: new Set(), tripId: 5 });
    const money = model.main.find(i => i.key === 'money');
    expect(money?.on).toBe(true);
  });

  it('trip context: money is also on for payments and myspend paths', () => {
    for (const path of ['/trips/5/money/payments', '/trips/5/money/me']) {
      const model = navModel(path, { isAdmin: false, myRole: 'leader', hidden: new Set(), tripId: 5 });
      const money = model.main.find(i => i.key === 'money');
      expect(money?.on).toBe(true);
    }
  });

  it('hidden set removes plan for a non-leader', () => {
    const model = navModel('/trips/5', {
      isAdmin: false, myRole: 'editor', hidden: new Set(['plan']), tripId: 5,
    });
    expect(model.main.find(i => i.key === 'plan')).toBeUndefined();
  });

  it('money always renders in trip context and targets the first visible sub-page', () => {
    const ledgerHidden = navModel('/trips/5', {
      isAdmin: false, myRole: 'leader', hidden: new Set(['ledger']), tripId: 5,
    });
    expect(ledgerHidden.main.find(i => i.key === 'money')?.to).toBe('/trips/5/money/payments');

    const ledgerAndPaymentsHidden = navModel('/trips/5', {
      isAdmin: false, myRole: 'leader', hidden: new Set(['ledger', 'payments']), tripId: 5,
    });
    expect(ledgerAndPaymentsHidden.main.find(i => i.key === 'money')?.to).toBe('/trips/5/money/me');
  });

  // v0.21: People widened to all trip roles — the Rooms card must be visible
  // to everyone, so the nav item itself is no longer leader-gated (the page
  // still gates its leader-only cards internally). Was
  // "people is present only for the leader" pre-v0.21.
  it('people is present for every trip role', () => {
    const leader = navModel('/trips/5', { isAdmin: false, myRole: 'leader', hidden: new Set(), tripId: 5 });
    expect(leader.main.find(i => i.key === 'people')).toBeTruthy();

    const editor = navModel('/trips/5', { isAdmin: false, myRole: 'editor', hidden: new Set(), tripId: 5 });
    expect(editor.main.find(i => i.key === 'people')).toBeTruthy();

    const viewer = navModel('/trips/5', { isAdmin: false, myRole: 'viewer', hidden: new Set(), tripId: 5 });
    expect(viewer.main.find(i => i.key === 'people')).toBeTruthy();
  });

  // v0.30: Trip settings split from People — only leaders get the nav item.
  it('trip settings is present only for the leader', () => {
    const leader = navModel('/trips/5/settings', { isAdmin: false, myRole: 'leader', hidden: new Set(), tripId: 5 });
    const item = leader.main.find(i => i.key === 'tripsettings');
    expect(item?.to).toBe('/trips/5/settings');
    expect(item?.on).toBe(true);
    for (const myRole of ['editor', 'viewer'] as const) {
      const m = navModel('/trips/5', { isAdmin: false, myRole, hidden: new Set(), tripId: 5 });
      expect(m.main.find(i => i.key === 'tripsettings')).toBeUndefined();
    }
  });
});
