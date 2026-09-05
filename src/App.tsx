import { createContext, useContext, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { api } from './api';
import { I18nProvider, useT, Lang } from './i18n';
import { getThemePref, setThemePref } from './theme';
import Login from './pages/Login';
import Join from './pages/Join';
import Trips from './pages/Trips';
import TripShell from './pages/TripShell';
import Dashboard from './pages/Dashboard';
import Plan from './pages/Plan';
import MySpend from './pages/MySpend';
import Documents from './pages/Documents';
import Review from './pages/Review';
import Ledger from './pages/Ledger';
import Payments from './pages/Payments';
import People from './pages/People';
import Settings from './pages/Settings';
import Admin from './pages/Admin';
import { ToastProvider } from './components/Toast';
import { Icon, IconDefs } from './components/Icon';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';

export type TripRole = 'leader' | 'editor' | 'viewer';

export interface User {
  id: number; email: string; name: string; role: 'admin' | 'member';
  lang: Lang; theme?: string; participant_id: number | null; must_change_password: number;
  platform_admin?: boolean;
}
export interface Trip {
  id: number; name: string; destination: string | null;
  start_date: string | null; end_date: string | null; emoji: string;
  my_role?: TripRole;
  cover_key?: string | null; cover_credit?: string | null;
}

interface Session {
  user: User; trips: Trip[];
  refresh: () => Promise<void>; logout: () => Promise<void>;
}
const SessionCtx = createContext<Session | null>(null);
export const useSession = () => useContext(SessionCtx)!;

// Lightweight bridge so the Sidebar (rendered once, in Chrome, above the
// router Outlet) can know about the *current trip*'s role + hidden-features
// set, which only TripShell has loaded. TripShell publishes into this via
// `useSetTripNav()` (a plain setter, stable identity) inside a useEffect —
// keeping the setter out of the read context avoids a render loop where
// Sidebar re-rendering would re-trigger the effect that feeds it.
export interface TripNavInfo {
  trip: Trip;
  myRole: TripRole;
  hidden: Set<string>;
}
const TripNavCtx = createContext<TripNavInfo | null>(null);
const TripNavSetCtx = createContext<(info: TripNavInfo | null) => void>(() => {});
export const useTripNav = () => useContext(TripNavCtx);
export const useSetTripNav = () => useContext(TripNavSetCtx);

function Shell() {
  const [state, setState] = useState<{ user: User; trips: Trip[] } | null | 'loading'>('loading');
  const [tripNav, setTripNav] = useState<TripNavInfo | null>(null);
  const navigate = useNavigate();

  const refresh = async () => {
    try {
      const me = await api.get('/me');
      setState({ user: me.user, trips: me.trips });
      // Sync theme if it differs from current preference (skip if undefined on stale local DBs)
      if ((me.user.theme === '' || me.user.theme === 'dark' || me.user.theme === 'system')
        && me.user.theme !== getThemePref()) {
        setThemePref(me.user.theme);
      }
    } catch {
      setState(null);
    }
  };
  useEffect(() => { refresh(); }, []);

  if (state === 'loading') return <div className="container"><p className="muted" style={{ padding: 40 }}>…</p></div>;
  if (!state) return <Navigate to="/login" replace />;

  const logout = async () => { await api.post('/auth/logout'); navigate('/login'); };

  return (
    <I18nProvider initial={state.user.lang}>
      <IconDefs />
      <SessionCtx.Provider value={{ ...state, refresh, logout }}>
        <TripNavCtx.Provider value={tripNav}>
        <TripNavSetCtx.Provider value={setTripNav}>
        <ToastProvider>
        <Chrome>
          <Routes>
            <Route path="/" element={<Trips />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/trips/:tripId" element={<TripShell />}>
              <Route index element={<Dashboard />} />
              <Route path="plan" element={<Plan />} />
              <Route path="myspend" element={<MySpend />} />
              <Route path="documents" element={<Documents />} />
              <Route path="documents/:docId/review" element={<Review />} />
              <Route path="ledger" element={<Ledger />} />
              <Route path="payments" element={<Payments />} />
              <Route path="people" element={<People />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Chrome>
        </ToastProvider>
        </TripNavSetCtx.Provider>
        </TripNavCtx.Provider>
      </SessionCtx.Provider>
    </I18nProvider>
  );
}

function Chrome({ children }: { children: React.ReactNode }) {
  const { t, lang, setLang } = useT();
  const { user, logout } = useSession();
  const changeLang = async (l: Lang) => { setLang(l); await api.patch('/me', { lang: l }); };
  return (
    <div className="shell">
      <Sidebar />
      {/* mobile-only chrome (<1024px) — replaced by a bottom tab bar in T7 */}
      <div className="topbar mobile-topbar">
        <div className="topbar-inner">
          <a className="logo" href="/"><Icon name="pin" size={16} /> {t.appName}</a>
          <div className="spacer" />
          <a href="/settings" style={{ color: '#fff', textDecoration: 'none', fontSize: '.85rem', display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}><Icon name="settings" size={16} /> {t.settings}</a>
          {user.role === 'admin' && (
            <a href="/admin" style={{ color: '#fff', textDecoration: 'none', fontSize: '.85rem', display: 'inline-flex', alignItems: 'center', gap: '.3rem' }}><Icon name="shield" size={16} /> {t.adminTitle}</a>
          )}
          <select value={lang} onChange={e => changeLang(e.target.value as Lang)} aria-label={t.language}>
            <option value="en">EN</option>
            <option value="ms">BM</option>
          </select>
          <span style={{ fontSize: '.85rem', opacity: .9 }}>{user.name}</span>
          <button onClick={logout}>{t.logout}</button>
        </div>
      </div>
      <div className="main">
        <div className="container">
          {user.must_change_password ? <PasswordNudge /> : null}
          {children}
        </div>
      </div>
      {/* mobile-only bottom tab bar (T7) — CSS-hidden at >=1024px; always mounted */}
      <TabBar />
    </div>
  );
}

function PasswordNudge() {
  const { t } = useT();
  const { refresh } = useSession();
  const [pw, setPw] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.length < 8) return;
    await api.patch('/me', { newPassword: pw });
    await refresh();
  };
  return (
    <form className="callout warn row" onSubmit={submit} style={{ marginTop: 12 }}>
      <span style={{ flex: 1 }}>{t.mustChange}</span>
      <input type="password" value={pw} onChange={e => setPw(e.target.value)}
        placeholder={t.newPassword} style={{ maxWidth: 220 }} minLength={8} required />
      <button className="btn sm" type="submit">{t.save}</button>
    </form>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<I18nProvider><Login /></I18nProvider>} />
      <Route path="/join/:code" element={<I18nProvider><Join /></I18nProvider>} />
      <Route path="*" element={<Shell />} />
    </Routes>
  );
}
