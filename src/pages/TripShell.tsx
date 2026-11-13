import Loading from '../components/Loading';
import { useEffect, useState } from 'react';
import { Link, Outlet, useParams } from 'react-router-dom';
import { api } from '../api';
import { useT } from '../i18n';
import { useSetTripNav, type Trip, type TripRole } from '../app/session';
import ChatDrawer from '../components/ChatDrawer';
import { Icon } from '../components/Icon';

export type { Participant, TripCtx } from '../app/tripContext';
import type { Participant, TripCtx } from '../app/tripContext';

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
  if (!data) return <Loading label={t.loading} />;

  const ctx: TripCtx = { ...data, tripId, reload, myRole, canLead, canEdit };

  const accent = (data.trip as any).color || '';
  return (
    <div className={accent ? 'trip-accent' : undefined} style={accent ? ({
      ['--accent' as any]: accent,
    } as any) : undefined}>
      <div className="trip-header">
        {data.trip.cover_key && (
          <div className="trip-header-backdrop" aria-hidden="true">
            <img src={`/api/trips/${tripId}/cover?v=${encodeURIComponent(data.trip.cover_key ?? '')}`} alt="" loading="lazy" />
          </div>
        )}
        <div className="row trip-header-row">
          <span className="trip-emoji" aria-hidden="true">{data.trip.emoji}</span>
          <div>
            <p className="trip-title">{data.trip.name}</p>
            <div className="trip-dest">{data.trip.destination}</div>
          </div>
        </div>
      </div>
      <Outlet context={ctx} />
      {!hidden.has('assistant') && <ChatDrawer tripId={tripId} />}
    </div>
  );
}
