// Jelajah UI refresh — pure navigation model (T6).
// Drives both the desktop Sidebar (T6) and the mobile tab bar (T7).
// Kept dependency-free (no React, no router) so it is trivially unit-testable.
import type { IconName } from './iconDefs';
import type { Dict } from '../i18n';
import type { TripRole } from '../app/session';

export interface NavItem {
  key: string;
  /** v0.49: label of the group this item starts (shown above it in the sidebar). */
  section?: keyof Dict;
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
    path === `${base}/money/ledger` ||
    path === `${base}/money/payments` ||
    path === `${base}/money/me`
  );
}

/**
 * Money always renders in trip context — `ledger`/`payments` are independent
 * hidden_features keys (a leader can hide one without the other) and My spend
 * was never gate-able (the old TripShell always showed it unconditionally).
 * Its target is the first visible sub-page, in this priority order.
 */
function moneyTarget(base: string, hidden: Set<string>): string {
  if (!hidden.has('ledger')) return `${base}/money/ledger`;
  if (!hidden.has('payments')) return `${base}/money/payments`;
  return `${base}/money/me`;
}

export function navModel(path: string, opts: NavOpts): NavModel {
  const { isAdmin, myRole, hidden, tripId } = opts;
  const foot: NavItem[] = [];
  foot.push({ key: 'settings', to: '/settings', icon: 'settings', label: 'settings', on: path === '/settings' });

  // v0.49: admins get the platform tools first; Home and Discover follow as a
  // secondary "Your trips" group. Members only see Home and Discover.
  const main: NavItem[] = isAdmin ? [
    { key: 'admin', to: '/admin', icon: 'chart', label: 'navAdminDashboard', on: path === '/admin', section: 'navAdminSection' },
    { key: 'admin-trips', to: '/admin/trips', icon: 'map', label: 'navAdminTrips', on: path === '/admin/trips' },
    { key: 'admin-usage', to: '/admin/usage', icon: 'sparkles', label: 'navAdminUsage', on: path === '/admin/usage' },
    { key: 'admin-people', to: '/admin/people', icon: 'users', label: 'navAdminPeople', on: path === '/admin/people' },
    { key: 'admin-settings', to: '/admin/settings', icon: 'shield', label: 'navAdminSettings', on: path === '/admin/settings' },
  ] : [];
  main.push(
    { key: 'home', to: '/', icon: 'folder', label: 'home', on: path === '/', ...(isAdmin ? { section: 'navYourTrips' as const } : {}) },
    // v0.30: Discover is global (docs/18 §0) — public guides, opens outside the app chrome.
    { key: 'discover', to: '/discover', icon: 'globe', label: 'discover', on: path === '/discover' },
  );

  if (tripId != null) {
    const base = `/trips/${tripId}`;

    main.push({ key: 'overview', to: base, icon: 'home', label: 'overview', on: path === base });

    // v0.48: Today (one day of the plan + daily brief) sits next to Plan.
    if (!hidden.has('plan') && !hidden.has('today')) {
      main.push({ key: 'today', to: `${base}/today`, icon: 'sun', label: 'today', on: path === `${base}/today` });
    }

    if (!hidden.has('plan')) {
      main.push({ key: 'plan', to: `${base}/plan`, icon: 'calendar', label: 'plan', on: path === `${base}/plan` });
    }

    main.push({ key: 'money', to: moneyTarget(base, hidden), icon: 'wallet', label: 'money', on: isMoneyPath(path, tripId) });

    if (!hidden.has('documents')) {
      main.push({ key: 'documents', to: `${base}/documents`, icon: 'file', label: 'documents', on: path.startsWith(`${base}/documents`) });
    }

    // v0.21: People is open to every trip role — the page itself gates its
    // leader-only cards (invites/details/danger) while showing a read-only
    // member list + the Rooms card to editors/viewers.
    main.push({ key: 'people', to: `${base}/people`, icon: 'users', label: 'people', on: path === `${base}/people` });

    // v0.30: Trip settings (details, visibility, delete) split from People — leaders only.
    if (myRole === 'leader') {
      main.push({ key: 'tripsettings', to: `${base}/settings`, icon: 'settings', label: 'tripSettings', on: path === `${base}/settings` });
    }
  }

  return { main, foot };
}
