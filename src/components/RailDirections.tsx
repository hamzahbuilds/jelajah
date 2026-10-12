import type { RouteResult } from '../hooks/useJourneyRoutes';
import { useT } from '../i18n';

export default function RailDirections({route}: {route?: RouteResult}) {
  const {lang} = useT(); const ms = lang === 'ms';
  if (!route?.available || route.source !== 'tokyo-gtfs') return null;
  return <section className="rail-directions" aria-label={ms ? 'Panduan kereta api' : 'Train directions'}>
    <h3>{ms ? 'Panduan kereta api' : 'Train directions'}</h3>
    {route.steps?.length ? <ol>{route.steps.map((step,i) => <li key={i}>
      <strong>{i ? (ms ? 'Tukar di' : 'Change at') : (ms ? 'Naik di' : 'Board at')} {step.fromStation}</strong>
      <span>{step.line} → {step.toStation} · ~{Math.round(step.duration / 60)} min</span>
    </li>)}<li><strong>{ms ? 'Turun di' : 'Exit at'} {route.steps.at(-1)?.toStation}</strong></li></ol> : <p>{route.lines?.join(' → ')}<br />{route.stations?.join(' → ')}</p>}
    <p className="hint">{ms ? 'Cadangan rangkaian Tokyo; tempoh anggaran, bukan jadual langsung. Semak platform, perkhidmatan dan tambang sebelum bertolak.' : 'Tokyo network suggestion; estimated duration, not a live timetable. Check platforms, services and fares before departure.'}</p>
  </section>;
}
