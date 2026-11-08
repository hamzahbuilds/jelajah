// v0.30: session + trip-nav contexts live here, not in App.tsx, so pages and
// nav components can import them without importing App (which imports every
// page) — that cycle blocked per-page code splitting (docs/18 R9).
import { createContext, useContext } from 'react';
import type { Lang } from '../i18n';

export type TripRole = 'leader' | 'editor' | 'viewer';

export interface User {
  id: number; email: string; name: string; role: 'admin' | 'member';
  lang: Lang; theme?: string; participant_id: number | null; must_change_password: number;
  platform_admin?: boolean;
  /** v0.35: welcome = show the first-sign-up tour; skip_plan_intro = user ticked "Don't show again". */
  onboarding?: { welcome: boolean; skip_plan_intro: boolean };
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
export const SessionCtx = createContext<Session | null>(null);
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
export const TripNavCtx = createContext<TripNavInfo | null>(null);
export const TripNavSetCtx = createContext<(info: TripNavInfo | null) => void>(() => {});
export const useTripNav = () => useContext(TripNavCtx);
export const useSetTripNav = () => useContext(TripNavSetCtx);

