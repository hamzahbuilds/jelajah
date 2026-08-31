import { createContext, useContext, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { api } from './api';
import { I18nProvider, useT, Lang } from './i18n';
import Login from './pages/Login';
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
import { ToastProvider } from './components/Toast';

export interface User {
  id: number; email: string; name: string; role: 'admin' | 'member';
  lang: Lang; participant_id: number | null; must_change_password: number;
}
export interface Trip {
  id: number; name: string; destination: string | null;
  start_date: string | null; end_date: string | null; emoji: string;
}

interface Session {
  user: User; trips: Trip[];
  refresh: () => Promise<void>; logout: () => Promise<void>;
}
const SessionCtx = createContext<Session | null>(null);
export const useSession = () => useContext(SessionCtx)!;

function Shell() {
  const [state, setState] = useState<{ user: User; trips: Trip[] } | null | 'loading'>('loading');
  const navigate = useNavigate();

  const refresh = async () => {
    try {
      const me = await api.get('/me');
      setState({ user: me.user, trips: me.trips });
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
      <SessionCtx.Provider value={{ ...state, refresh, logout }}>
        <ToastProvider>
        <Chrome>
          <Routes>
            <Route path="/" element={<Trips />} />
            <Route path="/settings" element={<Settings />} />
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
      </SessionCtx.Provider>
    </I18nProvider>
  );
}

function Chrome({ children }: { children: React.ReactNode }) {
  const { t, lang, setLang } = useT();
  const { user, logout } = useSession();
  const changeLang = async (l: Lang) => { setLang(l); await api.patch('/me', { lang: l }); };
  return (
    <>
      <div className="topbar">
        <div className="topbar-inner">
          <a className="logo" href="/">🧭 {t.appName}</a>
          <div className="spacer" />
          {user.role === 'admin' && <a href="/settings" style={{ color: '#fff', textDecoration: 'none', fontSize: '.85rem' }}>⚙️ {t.settings}</a>}
          <select value={lang} onChange={e => changeLang(e.target.value as Lang)} aria-label={t.language}>
            <option value="en">EN</option>
            <option value="ms">BM</option>
          </select>
          <span style={{ fontSize: '.85rem', opacity: .9 }}>{user.name}</span>
          <button onClick={logout}>{t.logout}</button>
        </div>
      </div>
      <div className="container">
        {user.must_change_password ? <PasswordNudge /> : null}
        {children}
      </div>
    </>
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
      <button className="btn btn-sm" type="submit">{t.save}</button>
    </form>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<I18nProvider><Login /></I18nProvider>} />
      <Route path="*" element={<Shell />} />
    </Routes>
  );
}
