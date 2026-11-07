import Loading from './components/Loading';
import BrandMark from './components/BrandMark';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { SessionCtx, TripNavCtx, TripNavSetCtx, useSession, useTripNav, type TripNavInfo, type User, type Trip } from './app/session';
export type { TripRole, User, Trip, TripNavInfo } from './app/session';
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import { PageSkeleton } from './ui';
import { ConfirmProvider } from './ui/Confirm';
import { api, setOfflineListener } from './api';
import { applyUpdate, clearApiCaches, hasPendingUpdate } from './lib/pwa';
import { I18nProvider, useT, Lang } from './i18n';
import { getThemePref, setThemePref } from './theme';
import Login from './pages/Login';
const Join = lazy(() => import('./pages/Join'));
const Trips = lazy(() => import('./pages/Trips'));
const NewPlan = lazy(() => import('./pages/NewPlan'));
const TripShell = lazy(() => import('./pages/TripShell'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Plan = lazy(() => import('./pages/JournalPlan'));
const Recovery = lazy(() => import('./pages/Recovery'));
const PublicJourneys = lazy(() => import('./pages/PublicJourneys'));
const MySpend = lazy(() => import('./pages/MySpend'));
const Documents = lazy(() => import('./pages/Documents'));
const Review = lazy(() => import('./pages/Review'));
const Ledger = lazy(() => import('./pages/Ledger'));
const Payments = lazy(() => import('./pages/Payments'));
const People = lazy(() => import('./pages/People'));
const Settings = lazy(() => import('./pages/Settings'));
const Admin = lazy(() => import('./pages/Admin'));
import { ToastProvider } from './components/Toast';
import { IconDefs } from './components/Icon';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import { AppBanner } from './components/AppBanner';

const DevGallery = lazy(() => import('./pages/DevGallery'));

function Shell() {
  const { t } = useT();
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

  if (state === 'loading') return <Loading label={t.loading} />;
  if (!state) return <Navigate to="/login" replace />;

  const logout = async () => {
    // F2 (v0.22 final review, 2026-09-06): the logout POST can fail offline
    // or on a 5xx — that must never block clearing caches or navigating
    // away, or a borrowed-device user pressing Log out offline would see
    // nothing happen while their cached data stays on the device.
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore — best-effort, we still clear caches and navigate below
    }
    try {
      await clearApiCaches(); // best-effort — shared-device mitigation (spec v0.22 §2)
    } catch {
      // clearApiCaches() is already internally defensive; belt-and-braces here
    }
    navigate('/login');
  };

  return (
    <I18nProvider initial={state.user.lang}>
      <IconDefs />
      <SessionCtx.Provider value={{ ...state, refresh, logout }}>
        <TripNavCtx.Provider value={tripNav}>
        <TripNavSetCtx.Provider value={setTripNav}>
        <ToastProvider>
        <ConfirmProvider>
        <Chrome>
          <Suspense fallback={<PageSkeleton label={t.loading} />}>
          <Routes>
            <Route path="/" element={<Trips />} />
            <Route path="/new" element={<NewPlan />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/admin" element={<Admin />} />
            {state.user.role === 'admin' && (
              <Route path="/dev/ui" element={<DevGallery />} />
            )}
            <Route path="/trips/:tripId" element={<TripShell />}>
              <Route index element={<Dashboard />} />
              <Route path="plan" element={<Plan />} />
              <Route path="money/ledger" element={<Ledger />} />
              <Route path="money/payments" element={<Payments />} />
              <Route path="money/me" element={<MySpend />} />
              <Route path="documents" element={<Documents />} />
              <Route path="documents/:docId/review" element={<Review />} />
              <Route path="people" element={<People />} />
              <Route path="settings" element={<People section="settings" />} />
              {/* v0.30 route moves — keep old links (bookmarks, e2e, shared URLs) working */}
              <Route path="ledger" element={<KeepSearchRedirect to="money/ledger" />} />
              <Route path="payments" element={<KeepSearchRedirect to="money/payments" />} />
              <Route path="myspend" element={<KeepSearchRedirect to="money/me" />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </Chrome>
        </ConfirmProvider>
        </ToastProvider>
        </TripNavSetCtx.Provider>
        </TripNavCtx.Provider>
      </SessionCtx.Provider>
    </I18nProvider>
  );
}

function Chrome({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  const { user } = useSession();
  const [offline, setOffline] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  // v0.22 PWA — offline banner tracks the most recent API response; it
  // clears itself the instant a fresh (online) response arrives.
  useEffect(() => {
    setOfflineListener(setOffline);
    return () => setOfflineListener(null);
  }, []);

  // Update banner: main.tsx's registerSW dispatches this window event once
  // a new service worker is waiting (see src/main.tsx).
  useEffect(() => {
    const onUpdate = () => setUpdateAvailable(true);
    window.addEventListener('jl-sw-update', onUpdate);
    if (hasPendingUpdate()) onUpdate();
    return () => window.removeEventListener('jl-sw-update', onUpdate);
  }, []);

  return (
    <div className="shell">
      <a className="skip-link" href="#main">{t.skipToContent}</a>
      <RouteEffects />
      <Sidebar />
      <div className="main">
        <AppBanner offline={offline} updateAvailable={updateAvailable} onRefresh={applyUpdate} />
        <main id="main" className="container" tabIndex={-1}>
          {user.must_change_password ? <PasswordNudge /> : null}
          {children}
        </main>
      </div>
      {/* mobile-only bottom tab bar (T7) — CSS-hidden at >=1024px; always mounted */}
      <TabBar />
    </div>
  );
}

/** Old trip sub-routes redirect relative to the trip, keeping ?query (e.g. payments deep links). */
function KeepSearchRedirect({ to }: { to: string }) {
  const { tripId } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/trips/${tripId}/${to}${search}`} replace />;
}

/**
 * Per-route document title and focus management (docs/18 §5.3, A1). After a
 * client-side navigation, focus moves to <main> (without scrolling) so
 * keyboard and screen-reader users land on the new page instead of a stale
 * nav link; the first render is left alone so autofocus/browser restore win.
 */
function RouteEffects() {
  const { t } = useT();
  const { pathname } = useLocation();
  const tripNav = useTripNav();
  const first = useRef(true);
  useEffect(() => {
    const seg = pathname.split('/').filter(Boolean);
    let page: string = t.myTrips;
    if (seg[0] === 'settings') page = t.settings;
    else if (seg[0] === 'admin') page = t.adminTitle;
    else if (seg[0] === 'dev') page = 'Component gallery';
    else if (seg[0] === 'new') page = t.newPlanTitle;
    else if (seg[0] === 'trips') {
      const sub = seg[2] === 'money' ? seg[3] : seg[2];
      const map: Record<string, string> = {
        plan: t.plan, ledger: t.ledger, payments: t.payments, me: t.myspend,
        documents: t.documents, people: t.people, settings: t.tripSettings,
      };
      page = sub ? (map[sub] ?? t.overview) : t.overview;
    }
    const trip = seg[0] === 'trips' && tripNav?.trip?.name ? ` · ${tripNav.trip.name}` : '';
    document.title = `${page}${trip} · ${t.appName}`;
  }, [pathname, tripNav?.trip?.name, t]);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname]);
  return null;
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
    <Suspense fallback={<Loading />}>
    <Routes>
      <Route path="/forgot-password" element={<I18nProvider><Recovery /></I18nProvider>} />
      <Route path="/reset-password" element={<I18nProvider><Recovery reset /></I18nProvider>} />
      <Route path="/discover" element={<I18nProvider><PublicJourneys /></I18nProvider>} />
      <Route path="/guides/:id" element={<I18nProvider><PublicJourneys detail /></I18nProvider>} />
      <Route path="/share/:token" element={<I18nProvider><PublicJourneys guest /></I18nProvider>} />
      <Route path="/login" element={<I18nProvider><Login /></I18nProvider>} />
      <Route path="/join/:code" element={<I18nProvider><Join /></I18nProvider>} />
      <Route path="*" element={<Shell />} />
    </Routes>
    </Suspense>
  );
}
