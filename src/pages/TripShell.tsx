import { useEffect, useState } from 'react';
import { NavLink, Outlet, useParams } from 'react-router-dom';
import { api } from '../api';
import { useT } from '../i18n';
import { useSession, Trip } from '../App';

export interface Participant { id: number; name: string; is_infant: number }
export interface TripCtx {
  trip: Trip; members: Participant[]; tripId: number;
  reload: () => Promise<void>;
}

export default function TripShell() {
  const { t } = useT();
  const { user } = useSession();
  const tripId = Number(useParams().tripId);
  const [data, setData] = useState<{ trip: Trip; members: Participant[] } | null>(null);

  const reload = async () => setData(await api.get(`/trips/${tripId}`));
  useEffect(() => { reload(); }, [tripId]);

  if (!data) return <p className="muted" style={{ padding: 30 }}>{t.loading}</p>;

  const ctx: TripCtx = { ...data, tripId, reload };
  const tab = (to: string, label: string, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
  );

  return (
    <div>
      <div className="row" style={{ marginTop: 18 }}>
        <span style={{ fontSize: '1.6rem' }}>{data.trip.emoji}</span>
        <div>
          <h1 style={{ marginBottom: 0 }}>{data.trip.name}</h1>
          <div className="muted">{data.trip.destination}</div>
        </div>
      </div>
      <nav className="tabs">
        {tab(`/trips/${tripId}`, t.dashboard, true)}
        {tab(`/trips/${tripId}/documents`, t.documents)}
        {tab(`/trips/${tripId}/ledger`, t.ledger)}
        {tab(`/trips/${tripId}/payments`, t.payments)}
        {user.role === 'admin' && tab(`/trips/${tripId}/people`, t.people)}
      </nav>
      <Outlet context={ctx} />
    </div>
  );
}
