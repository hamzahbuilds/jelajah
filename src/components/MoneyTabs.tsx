// Jelajah UI refresh — Money section segmented control (fix for final-review F1).
// Ledger/Payments were only reachable via navModel's single "Money" nav item,
// which never linked myspend unless both ledger and payments were hidden. This
// renders all three as an in-page .seg, gated the same way navModel gates the
// Sidebar/TabBar Money item: hidden_features hides Ledger/Payments individually,
// My spend is never gate-able.
import { NavLink, useParams } from 'react-router-dom';
import { useTripNav } from '../App';
import { useT } from '../i18n';

export default function MoneyTabs() {
  const { t } = useT();
  const tripId = useParams().tripId;
  const nav = useTripNav();
  const hidden = nav?.hidden ?? new Set<string>();
  const base = `/trips/${tripId}`;

  return (
    <div className="seg" style={{ marginBottom: 12 }}>
      {!hidden.has('ledger') && (
        <NavLink to={`${base}/ledger`} className={({ isActive }) => (isActive ? 'on' : '')}>
          {t.ledger}
        </NavLink>
      )}
      {!hidden.has('payments') && (
        <NavLink to={`${base}/payments`} className={({ isActive }) => (isActive ? 'on' : '')}>
          {t.payments}
        </NavLink>
      )}
      <NavLink to={`${base}/myspend`} className={({ isActive }) => (isActive ? 'on' : '')}>
        {t.myspend}
      </NavLink>
    </div>
  );
}
