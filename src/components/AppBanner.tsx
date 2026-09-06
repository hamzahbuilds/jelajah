// v0.22 PWA — slim, non-blocking status banner mounted above the page
// content in Chrome (App.tsx). Two variants, mutually exclusive by design
// (an update takes priority — it's the more actionable state):
//   - offline: shown while the most recent API response was served from
//     the service worker's cache fallback; clears automatically the
//     moment a fresh (online) response comes back (see setOfflineListener
//     wiring in App.tsx).
//   - update: shown once a new service worker is waiting; Refresh applies
//     it (src/lib/pwa.ts applyUpdate).
// No dismiss control — both states auto-clear or are resolved by the
// button, per spec (banner is "non-blocking", not "closeable").
import { Icon } from './Icon';
import { useT } from '../i18n';

export function AppBanner({ offline, updateAvailable, onRefresh }: {
  offline: boolean;
  updateAvailable: boolean;
  onRefresh: () => void;
}) {
  const { t } = useT();
  if (updateAvailable) {
    return (
      <div className="app-banner app-banner-update" role="status">
        <Icon name="spark" size={16} />
        <span>{t.updateBanner}</span>
        <button type="button" className="btn sm" onClick={onRefresh}>{t.refresh}</button>
      </div>
    );
  }
  if (offline) {
    return (
      <div className="app-banner app-banner-offline" role="status">
        <Icon name="globe" size={16} />
        <span>{t.offlineBanner}</span>
      </div>
    );
  }
  return null;
}
