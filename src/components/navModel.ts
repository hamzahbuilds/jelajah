// Jelajah UI refresh — pure navigation model (T6).
// Drives both the desktop Sidebar (T6) and the mobile tab bar (T7).
// Kept dependency-free (no React, no router) so it is trivially unit-testable.
import type { IconName } from './iconDefs';
import type { Dict } from '../i18n';
import type { TripRole } from '../App';

export interface NavItem {
  key: string;
  to: string;
  icon: IconName;
  label: keyof Dict;
  on: boolean;
  pill?: string;
}

export interface NavOpts {
  isAdmin: boolean;
  myRole?: TripRole;
  hidden: Set<string>;
  tripId?: number;
}

export interface NavModel {
  main: NavItem[];
  foot: NavItem[];
}

/** Money's in-page tabs (ledger/payments/myspend) all light up the Money nav item. */
function isMoneyPath(path: string, tripId: number): boolean {
  const base = `/trips/${tripId}`;
  return (
    path === `${base}/ledger` ||
    path === `${base}/payments` ||
    path === `${base}/myspend`
  );
}

/**
 * Money always renders in trip context — `ledger`/`payments` are independent
 * hidden_features keys (a leader can hide one without the other) and My spend
 * was never gate-able (the old TripShell always showed it unconditionally).
 * Its target is the first visible sub-page, in this priority order.
 */
function moneyTarget(base: string, hidden: Set<string>): string {
  if (!hidden.has('ledger')) return `${base}/ledger`;
  if (!hidden.has('payments')) return `${base}/payments`;
  return `${base}/myspend`;
}

export function navModel(path: string, opts: NavOpts): NavModel {
  const { isAdmin, myRole, hidden, tripId } = opts;
  const foot: NavItem[] = [];
  if (isAdmin) foot.push({ key: 'admin', to: '/admin', icon: 'shield', label: 'adminTitle', on: path === '/admin' });
  foot.push({ key: 'settings', to: '/settings', icon: 'settings', label: 'settings', on: path === '/settings' });

  const main: NavItem[] = [
    { key: 'home', to: '/', icon: 'folder', label: 'home', on: path === '/' },
  ];

  if (tripId != null) {
    const base = `/trips/${tripId}`;
    const isLeader = myRole === 'leader';

    main.push({ key: 'overview', to: base, icon: 'home', label: 'overview', on: path === base });

    if (!hidden.has('plan')) {
      main.push({ key: 'plan', to: `${base}/plan`, icon: 'calendar', label: 'plan', on: path === `${base}/plan` });
    }

    main.push({ key: 'money', to: moneyTarget(base, hidden), icon: 'wallet', label: 'money', on: isMoneyPath(path, tripId) });

    if (!hidden.has('documents')) {
      main.push({ key: 'documents', to: `${base}/documents`, icon: 'file', label: 'documents', on: path.startsWith(`${base}/documents`) });
    }

    if (isLeader) {
      main.push({ key: 'people', to: `${base}/people`, icon: 'users', label: 'people', on: path === `${base}/people` });
    }
  }

  return { main, foot };
}
