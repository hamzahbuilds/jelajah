// Jelajah UI refresh — mobile bottom tab bar (T7).
// Ported from design/ui-refresh/nav.js (`.tabbar`/`.tab` structure, long-press
// trip switcher, "More" sheet) onto the live route tree. CSS-hidden at
// >=1024px (see `.tabbar` in styles.css) — always mounted so the media query
// alone controls visibility.
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useSession, useTripNav, TripRole } from '../App';
import { useT } from '../i18n';
import { Icon } from './Icon';
import Sheet from './Sheet';
import { useLongPress } from '../hooks/useLongPress';
import { navModel } from './navModel';

const LAST_TRIP_KEY = 'jl-last-trip';

function roleLabel(t: ReturnType<typeof useT>['t'], role?: TripRole) {
  if (role === 'leader') return t.roleLeader;
  if (role === 'editor') return t.roleEditor;
  if (role === 'viewer') return t.roleViewer;
  return t.youChip;
}

export default function TabBar() {
  const { t } = useT();
  const { user, trips, logout } = useSession();
  const nav = useTripNav();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const tripId = nav?.trip?.id;
  const myRole = nav?.myRole;
  const hidden = nav?.hidden ?? new Set<string>();
  const isAdmin = user.role === 'admin';

  // In account context (no active trip route) the trip tabs fall back to the
  // last-visited trip: TripShell writes `jl-last-trip` to localStorage on
  // mount. That id may be stale (trip deleted, access revoked, etc.) so it's
  // only trusted when it still names a trip in the session's list; otherwise
  // fall back to the first trip in the session's list.
  let effectiveTripId: number | null = null;
  try {
    effectiveTripId = tripId ?? (() => {
      const stored = localStorage.getItem(LAST_TRIP_KEY);
      const storedId = stored ? Number(stored) : null;
      if (storedId != null && trips.some(tr => tr.id === storedId)) return storedId;
      return trips[0]?.id ?? null;
    })();
  } catch {
    effectiveTripId = tripId ?? trips[0]?.id ?? null;
  }

  // Trip-tab targets/active-state come straight from navModel — it already
  // encodes hidden-features gating and the Money fallback priority. This is
  // only trustworthy while a trip route is actually mounted (`tripId` set):
  // that's the only time `hidden` reflects the trip being routed to. In
  // account context there's no hidden-features data for the fallback trip
  // (it isn't the mounted TripShell) — rather than fabricate an all-visible
  // gate and deep-link into a trip whose leader may have hidden that very
  // page (final-review F2), Plan/Money/Documents all route to the fallback
  // trip's Overview; once inside, TripShell's real gating applies.
  const model = tripId != null
    ? navModel(pathname, { isAdmin, myRole, hidden, tripId })
    : null;
  const overviewTo = effectiveTripId != null ? `/trips/${effectiveTripId}` : null;

  const tabInfo = (key: 'plan' | 'money' | 'documents') => {
    const item = model?.main.find(i => i.key === key);
    // Tab bar always shows 5 slots; if navModel omitted the item (hidden by
    // the trip's leader) — or there's no mounted trip at all (account
    // context) — the tab still renders but routes to the overview.
    return item ? { to: item.to, on: item.on } : { to: overviewTo, on: false };
  };

  const planInfo = tabInfo('plan');
  const moneyInfo = tabInfo('money');
  const docsInfo = tabInfo('documents');
  const planTo = planInfo.to;
  const moneyTo = moneyInfo.to;
  const docsTo = docsInfo.to;
  const planOn = planInfo.on;
  const moneyOn = moneyInfo.on;
  const docsOn = docsInfo.on;

  const homeOn = pathname === '/' || Boolean(model?.main.find(i => i.key === 'overview')?.on);
  const tripBase = tripId != null ? `/trips/${tripId}` : null;
  const moreOn = pathname === '/settings' || pathname === '/admin' || (tripBase != null && pathname === `${tripBase}/people`);

  const openSwitcher = () => setSwitcherOpen(true);
  const planLP = useLongPress(openSwitcher);
  const moneyLP = useLongPress(openSwitcher);
  const docsLP = useLongPress(openSwitcher);

  const goTrip = (id: number) => { setSwitcherOpen(false); navigate(`/trips/${id}`); };

  const tripTab = (
    key: string, to: string | null, icon: Parameters<typeof Icon>[0]['name'],
    label: string, on: boolean, lp: ReturnType<typeof useLongPress>,
  ) => {
    const inner = (
      <>
        <span className="ic"><Icon name={icon} size={20} /></span>
        {label}
        {on && <span className="dot" />}
      </>
    );
    if (!to) {
      return (
        <button
          key={key} type="button" className={'tab' + (on ? ' on' : '')}
          onPointerDown={lp.onPointerDown} onPointerUp={lp.onPointerUp}
          onPointerLeave={lp.onPointerLeave} onPointerCancel={lp.onPointerCancel}
          onContextMenu={lp.onContextMenu}
          onClick={(e) => { lp.onClick(e); if (!e.defaultPrevented) openSwitcher(); }}
        >
          {inner}
        </button>
      );
    }
    return (
      <Link
        key={key} to={to} className={'tab' + (on ? ' on' : '')}
        onPointerDown={lp.onPointerDown} onPointerUp={lp.onPointerUp}
        onPointerLeave={lp.onPointerLeave} onPointerCancel={lp.onPointerCancel}
        onContextMenu={lp.onContextMenu} onClick={lp.onClick}
      >
        {inner}
      </Link>
    );
  };

  return (
    <>
      <nav className="tabbar">
        <Link to="/" className={'tab' + (homeOn ? ' on' : '')}>
          <span className="ic"><Icon name="folder" size={20} /></span>
          {t.home}
          {homeOn && <span className="dot" />}
        </Link>
        {tripTab('plan', planTo, 'calendar', t.plan, planOn, planLP)}
        {tripTab('money', moneyTo, 'wallet', t.money, moneyOn, moneyLP)}
        {tripTab('docs', docsTo, 'file', t.documents, docsOn, docsLP)}
        <button type="button" className={'tab' + (moreOn ? ' on' : '')} onClick={() => setMoreOpen(true)}>
          <span className="ic"><Icon name="more" size={20} /></span>
          {t.more}
          {moreOn && <span className="dot" />}
        </button>
      </nav>

      <Sheet open={switcherOpen} onClose={() => setSwitcherOpen(false)} title={t.switchTrip}>
        {trips.map(tr => (
          <button key={tr.id} className="srow" onClick={() => goTrip(tr.id)}>
            <span className="em">{tr.emoji}</span>
            <div className="t">
              <b>{tr.name}</b>
              <small>{tr.start_date} – {tr.end_date}</small>
            </div>
            {tr.my_role && <span className="badge gray">{roleLabel(t, tr.my_role)}</span>}
          </button>
        ))}
        <button className="srow" onClick={() => { setSwitcherOpen(false); navigate('/'); }}>
          <span className="em"><Icon name="folder" size={20} /></span>
          <div className="t"><b>{t.allTrips}</b></div>
          <Icon name="chev-r" size={16} />
        </button>
      </Sheet>

      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title={t.more}>
        {tripId != null && (
          <button className="srow" onClick={() => { setMoreOpen(false); navigate(`/trips/${tripId}`); }}>
            <span className="em"><Icon name="home" size={20} /></span>
            <div className="t"><b>{t.overview}</b></div>
            <Icon name="chev-r" size={16} />
          </button>
        )}
        {tripId != null && (
          <button className="srow" onClick={() => { setMoreOpen(false); navigate(`/trips/${tripId}/people`); }}>
            <span className="em"><Icon name="users" size={20} /></span>
            <div className="t"><b>{t.people}</b></div>
            <Icon name="chev-r" size={16} />
          </button>
        )}
        <button className="srow" onClick={() => { setMoreOpen(false); navigate('/settings'); }}>
          <span className="em"><Icon name="settings" size={20} /></span>
          <div className="t"><b>{t.settings}</b></div>
          <Icon name="chev-r" size={16} />
        </button>
        {user.role === 'admin' && (
          <button className="srow" onClick={() => { setMoreOpen(false); navigate('/admin'); }}>
            <span className="em"><Icon name="shield" size={20} /></span>
            <div className="t"><b>{t.adminTitle}</b></div>
            <Icon name="chev-r" size={16} />
          </button>
        )}
        <button className="srow" onClick={() => { setMoreOpen(false); logout(); }}>
          <span className="em"><Icon name="logout" size={20} /></span>
          <div className="t"><b>{t.logout}</b></div>
        </button>
      </Sheet>
    </>
  );
}
