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
  let hidden = new Set<string>();
  if (user.role !== 'admin') {
    try { hidden = new Set(JSON.parse((data.trip as any).hidden_features ?? '[]')); } catch { /* ignore */ }
  }
  const tab = (to: string, label: string, end = false) => (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>
  );

  const accent = (data.trip as any).color || '';
  return (
    <div style={accent ? ({ ['--accent' as any]: accent, ['--brand' as any]: accent, ['--brand-strong' as any]: accent } as any) : undefined}>
      <div className="row" style={{ marginTop: 18 }}>
        <span style={{ fontSize: '1.6rem' }}>{data.trip.emoji}</span>
        <div>
          <h1 style={{ marginBottom: 0 }}>{data.trip.name}</h1>
          <div className="muted">{data.trip.destination}</div>
        </div>
      </div>
      <nav className="tabs">
        {tab(`/trips/${tripId}`, t.dashboard, true)}
        {!hidden.has('plan') && tab(`/trips/${tripId}/plan`, t.plan)}
        {!hidden.has('documents') && tab(`/trips/${tripId}/documents`, t.documents)}
        {!hidden.has('ledger') && tab(`/trips/${tripId}/ledger`, t.ledger)}
        {!hidden.has('payments') && tab(`/trips/${tripId}/payments`, t.payments)}
        {tab(`/trips/${tripId}/myspend`, t.myspend)}
        {user.role === 'admin' && tab(`/trips/${tripId}/people`, t.people)}
      </nav>
      <Outlet context={ctx} />
    </div>
  );
}
