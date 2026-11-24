// v0.49 Trip switcher: the trip header at the top of every trip page is the
// switcher (phone and desktop alike), replacing the hidden long-press on the
// tab bar and the separate sidebar switcher. Trips are grouped the same way as
// Home: happening now, upcoming, still planning, completed.
import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { fmtDate } from '../api';
import { useT } from '../i18n';
import { useSession, type Trip } from '../app/session';
import { todayYmd } from '../../shared/days';
import { PHASES, phaseOf, sortTrips, type Phase } from '../../shared/tripPhase';
import { Icon } from './Icon';
import Sheet from './Sheet';

export default function TripSwitcher({ trip }: { trip: Trip }) {
  const { t, lang } = useT();
  const ms = lang === 'ms';
  const { trips } = useSession();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Keep the same section when switching (Plan stays Plan). A single document's review page falls back to Documents.
  const section = (() => {
    const rest = pathname.replace(/^\/trips\/\d+/, '');
    return rest.startsWith('/documents/') ? '/documents' : rest;
  })();
  const [open, setOpen] = useState(false);
  const names: Record<Phase, string> = {
    now: ms ? 'Sedang berlangsung' : 'Happening now', upcoming: ms ? 'Akan datang' : 'Upcoming',
    undated: ms ? 'Masih dirancang' : 'Still planning', done: ms ? 'Selesai' : 'Completed',
  };
  const today = todayYmd();
  const groups = useMemo(() => PHASES.map(ph => ({ ph, list: sortTrips(trips.filter(tr => phaseOf(tr, today) === ph), 'date', ph, lang) })).filter(g => g.list.length), [trips, today, lang]);
  const go = (to: string) => { setOpen(false); navigate(to, { viewTransition: true }); };
  const dates = (tr: Trip) => tr.start_date ? `${fmtDate(tr.start_date, lang)}${tr.end_date && tr.end_date !== tr.start_date ? ` – ${fmtDate(tr.end_date, lang)}` : ''}` : (ms ? 'Tiada tarikh' : 'No dates yet');

  return (
    <>
      <button type="button" className="trip-switcher" onClick={() => setOpen(true)} aria-haspopup="dialog"
        aria-label={`${trip.name}. ${ms ? 'Tukar perjalanan' : 'Switch trip'}`}>
        <span className="trip-emoji" aria-hidden="true">{trip.emoji}</span>
        <span className="trip-switcher-text">
          <span className="trip-title">{trip.name}</span>
          <span className="trip-dest">{[trip.destination, dates(trip)].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="trip-switcher-cue" aria-hidden="true">{trips.length > 1 && <span className="trip-switcher-label">{ms ? 'Tukar' : 'Switch'}</span>}<Icon name="chev-d" size={16} /></span>
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t.switchTrip}>
        {groups.map(g => (
          <div key={g.ph} className="ts-group">
            <div className="ts-group-h">{names[g.ph]}</div>
            {g.list.map(tr => {
              const current = tr.id === trip.id;
              return (
                <button key={tr.id} type="button" className={`srow${current ? ' current' : ''}`} aria-current={current ? 'page' : undefined} onClick={() => current ? setOpen(false) : go(`/trips/${tr.id}${section === '/settings' && tr.my_role !== 'leader' ? '' : section}`)}>
                  <span className="em">{tr.emoji}</span>
                  <div className="t"><b>{tr.name}</b><small>{dates(tr)}</small></div>
                  {current ? <span className="badge brand">{ms ? 'Sekarang' : 'Current'}</span> : <Icon name="chev-r" size={16} />}
                </button>
              );
            })}
          </div>
        ))}
        <div className="ts-group">
          <button type="button" className="srow" onClick={() => go('/')}>
            <span className="em"><Icon name="folder" size={20} /></span>
            <div className="t"><b>{t.allTrips}</b></div>
            <Icon name="chev-r" size={16} />
          </button>
          <button type="button" className="srow" onClick={() => go('/new')}>
            <span className="em"><Icon name="plus" size={20} /></span>
            <div className="t"><b>{t.newTrip}</b></div>
            <Icon name="chev-r" size={16} />
          </button>
        </div>
      </Sheet>
    </>
  );
}
