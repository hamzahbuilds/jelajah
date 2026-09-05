// Jelajah UI refresh — fixed collapsible desktop sidebar (T6).
// Ported from design/ui-refresh/nav.js (structure) + ui.css (`.sidebar` / `html.side-min`).
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useT, Lang } from '../i18n';
import { useSession, useTripNav, TripRole } from '../App';
import { Icon } from './Icon';
import Sheet from './Sheet';
import { navModel } from './navModel';

const SIDE_KEY = 'jl-side';

function roleLabel(t: ReturnType<typeof useT>['t'], role?: TripRole) {
  if (role === 'leader') return t.roleLeader;
  if (role === 'editor') return t.roleEditor;
  if (role === 'viewer') return t.roleViewer;
  return t.youChip;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Sidebar() {
  const { t, lang, setLang } = useT();
  const { user, trips, logout } = useSession();
  const nav = useTripNav();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);

  useEffect(() => {
    let min = false;
    try { min = localStorage.getItem(SIDE_KEY) === 'min'; } catch { /* ignore */ }
    setCollapsed(min);
    document.documentElement.classList.toggle('side-min', min);
  }, []);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    document.documentElement.classList.toggle('side-min', next);
    try { localStorage.setItem(SIDE_KEY, next ? 'min' : ''); } catch { /* ignore write failure */ }
  };

  const changeLang = async (l: Lang) => { setLang(l); await api.patch('/me', { lang: l }); };

  const model = navModel(pathname, {
    isAdmin: user.role === 'admin',
    myRole: nav?.myRole,
    hidden: nav?.hidden ?? new Set(),
    tripId: nav?.trip?.id,
  });

  const trip = nav?.trip;

  return (
    <aside className="sidebar">
      <div className="side-brand">
        <div className="logo"><Icon name="pin" size={16} /></div>
        <strong>{t.appName}</strong>
        <button className="side-collapse" onClick={toggleCollapse} title={t.collapseNav} aria-label={t.collapseNav}>
          <Icon name="chev-r" size={16} />
        </button>
      </div>

      {model.main.map(item => (
        item.key === 'overview' && trip ? (
          <div key="trip-switch-group">
            <button className="trip-switch" onClick={() => setSwitcherOpen(true)} title={t.switchTrip}>
              <span className="em">{trip.emoji}</span>
              <div className="t">
                <b>{trip.name}</b>
                <span>{trip.start_date} – {trip.end_date}</span>
              </div>
              <Icon name="chev-d" size={16} className="tsw-chev" />
            </button>
            <Link key={item.key} to={item.to} className={'nav-item' + (item.on ? ' on' : '')} title={t[item.label] as string}>
              <span className="ic"><Icon name={item.icon} size={20} /></span>
              <span className="lbl">{t[item.label] as string}</span>
              {item.pill && <span className="pill badge warning">{item.pill}</span>}
            </Link>
          </div>
        ) : (
          <Link key={item.key} to={item.to} className={'nav-item' + (item.on ? ' on' : '')} title={t[item.label] as string}>
            <span className="ic"><Icon name={item.icon} size={20} /></span>
            <span className="lbl">{t[item.label] as string}</span>
            {item.pill && <span className="pill badge warning">{item.pill}</span>}
          </Link>
        )
      ))}

      <div className="side-foot">
        {model.foot.map(item => (
          <Link key={item.key} to={item.to} className={'nav-item' + (item.on ? ' on' : '')} title={t[item.label] as string}>
            <span className="ic"><Icon name={item.icon} size={20} /></span>
            <span className="lbl">{t[item.label] as string}</span>
          </Link>
        ))}

        <div className="nav-item side-user" title={user.name}>
          <span className="avatar">{initials(user.name)}</span>
          <span className="lbl">{user.name}</span>
          <span className="pill badge gray">{roleLabel(t, nav?.trip ? nav.myRole : undefined)}</span>
        </div>

        <div className="row" style={{ gap: 6, padding: '4px 12px' }}>
          <select value={lang} onChange={e => changeLang(e.target.value as Lang)} aria-label={t.language} className="side-lang">
            <option value="en">EN</option>
            <option value="ms">BM</option>
          </select>
          <button className="btn sm ghost" onClick={logout} title={t.logout}>
            <Icon name="logout" size={16} />
          </button>
        </div>
      </div>

      <Sheet open={switcherOpen} onClose={() => setSwitcherOpen(false)} title={t.switchTrip}>
        {trips.map(tr => (
          <button key={tr.id} className="srow" onClick={() => { setSwitcherOpen(false); navigate(`/trips/${tr.id}`); }}>
            <span className="em">{tr.emoji}</span>
            <div className="t">
              <b>{tr.name}</b>
              <small>{tr.start_date} – {tr.end_date}</small>
            </div>
            {tr.my_role && <span className="badge gray">{roleLabel(t, tr.my_role)}</span>}
          </button>
        ))}
      </Sheet>
    </aside>
  );
}
