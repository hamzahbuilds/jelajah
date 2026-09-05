export type ThemePref = '' | 'dark' | 'system';
const KEY = 'jl-theme';

export const resolveTheme = (pref: ThemePref, systemDark: boolean): '' | 'dark' =>
  pref === 'system' ? (systemDark ? 'dark' : '') : pref;

export const getThemePref = (): ThemePref => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'system' ? v : '';
  } catch {
    return '';
  }
};

export function applyTheme(pref: ThemePref) {
  let dark = false;
  try { dark = matchMedia('(prefers-color-scheme: dark)').matches; } catch { /* ignore */ }
  try { document.documentElement.dataset.theme = resolveTheme(pref, dark); } catch { /* ignore */ }
}

export function setThemePref(pref: ThemePref) {
  try { localStorage.setItem(KEY, pref); } catch { /* ignore write failure — theme still applies below */ }
  applyTheme(pref);
}

export function initTheme() {
  try {
    applyTheme(getThemePref());
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getThemePref() === 'system') applyTheme('system');
    });
  } catch {
    // A throwing storage/matchMedia context must never prevent render.
  }
}
