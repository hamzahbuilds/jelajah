import { useEffect, useState } from 'react';
import { Link, Outlet, useParams } from 'react-router-dom';
import { api } from '../api';
import { useT } from '../i18n';
import { useSetTripNav, Trip, TripRole } from '../App';
import ChatDrawer from '../components/ChatDrawer';
import { Icon } from '../components/Icon';

export interface Participant {
  id: number; name: string; is_infant: number;
  trip_role?: 'leader' | 'editor' | 'viewer'; has_account?: number;
}
export interface TripCtx {
  trip: Trip; members: Participant[]; tripId: number;
  reload: () => Promise<void>;
  myRole: TripRole; canLead: boolean; canEdit: boolean;
}

export default function TripShell() {
  const { t } = useT();
  const setTripNav = useSetTripNav();
  const tripId = Number(useParams().tripId);
  const [data, setData] = useState<{ trip: Trip; members: Participant[] } | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = async () => {
    try {
      const d = await api.get(`/trips/${tripId}`);
      setFailed(false);
      setData(d);
    } catch {
      setData(null);
      setFailed(true);
    }
  };
  useEffect(() => { setFailed(false); reload(); }, [tripId]);
  useEffect(() => {
    try { localStorage.setItem('jl-last-trip', String(tripId)); } catch { /* ignore write failure */ }
  }, [tripId]);

  const myRole: TripRole = (data?.trip as any)?.my_role ?? 'viewer';
  const canLead = myRole === 'leader';
  const canEdit = myRole !== 'viewer';
  let hidden = new Set<string>();
  if (data && !canLead) {
    try { hidden = new Set(JSON.parse((data.trip as any).hidden_features ?? '[]')); } catch { /* ignore */ }
  }

  // Publish this trip's nav context so the Sidebar (rendered up in Chrome,
  // outside this route) can build its trip-scoped nav items and honour the
  // hidden-features set. Split into two effects on purpose: the publish runs
  // on every data/role/hidden change (e.g. a background reload() after an
  // edit), while the null-out only runs on unmount or when the route's
  // tripId itself changes — otherwise every reload would briefly clear the
  // context (the cleanup of the *previous* run of a combined effect fires
  // before the new value is set), flashing the sidebar back to its
  // account-context state for a render.
  useEffect(() => {
    if (data) setTripNav({ trip: data.trip, myRole, hidden });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, myRole, JSON.stringify([...hidden])]);

  useEffect(() => {
    return () => setTripNav(null);
  }, [tripId]);

  if (failed) {
    return (
      <div className="card" style={{ margin: '24px 0', textAlign: 'center' }}>
        <p style={{ marginTop: 0 }}><Icon name="alert" /></p>
        <p>{t.tripLoadFailed}</p>
        <Link to="/" className="btn secondary">{t.backToTrips}</Link>
      </div>
    );
  }
  if (!data) return <p className="muted" style={{ padding: 30 }}>{t.loading}</p>;

  const ctx: TripCtx = { ...data, tripId, reload, myRole, canLead, canEdit };

  const accent = (data.trip as any).color || '';
  return (
    <div style={accent ? ({
      ['--accent' as any]: accent,
      ['--brand-600' as any]: accent, ['--brand-700' as any]: accent,
    } as any) : undefined}>
      <div className="trip-header" style={{ marginTop: 18 }}>
        {data.trip.cover_key && (
          <div className="trip-header-backdrop" aria-hidden="true">
            <img src={`/api/trips/${tripId}/cover?v=${encodeURIComponent(data.trip.cover_key ?? '')}`} alt="" loading="lazy" />
          </div>
        )}
        <div className="row trip-header-row">
          <span style={{ fontSize: '1.6rem' }}>{data.trip.emoji}</span>
          <div>
            <h1 style={{ marginBottom: 0 }}>{data.trip.name}</h1>
            <div className="muted">{data.trip.destination}</div>
          </div>
        </div>
      </div>
      <Outlet context={ctx} />
      {!hidden.has('assistant') && <ChatDrawer tripId={tripId} />}
    </div>
  );
}
