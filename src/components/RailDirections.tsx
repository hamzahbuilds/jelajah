import type { RouteResult } from '../hooks/useJourneyRoutes';
import { useT } from '../i18n';

/** Offline network suggestions: Tokyo rail, and (v0.40) Malaysia + Singapore rail and buses. */
export const isNetworkRoute = (route?: RouteResult) =>
  !!route?.available && (route.source === 'tokyo-gtfs' || route.source === 'my-sg-transit');

export default function RailDirections({route}: {route?: RouteResult}) {
  const {lang} = useT(); const ms = lang === 'ms';
  if (!route || !isNetworkRoute(route)) return null;
  const tokyo = route.source === 'tokyo-gtfs';
  const hasBus = route.steps?.some(s => s.mode === 'bus');
  const title = hasBus ? (ms ? 'Panduan pengangkutan awam' : 'Public transport directions') : (ms ? 'Panduan kereta api' : 'Train directions');
  const board = (bus: boolean, first: boolean) => first
    ? (bus ? (ms ? 'Naik bas di' : 'Take the bus at') : (ms ? 'Naik di' : 'Board at'))
    : (bus ? (ms ? 'Tukar ke bas di' : 'Change to a bus at') : (ms ? 'Tukar di' : 'Change at'));
  return <section className="rail-directions" aria-label={title}>
    <h2>{title}</h2>
    {route.steps?.length ? <ol>{route.steps.map((step,i) => <li key={i}>
      <strong>{board(step.mode === 'bus', i === 0)} {step.fromStation}</strong>
      <span>{step.line} → {step.toStation} · ~{Math.round(step.duration / 60)} min</span>
    </li>)}<li><strong>{ms ? 'Turun di' : 'Get off at'} {route.steps.at(-1)?.toStation}</strong></li></ol> : <p>{route.lines?.join(' → ')}<br />{route.stations?.join(' → ')}</p>}
    <p className="hint">{tokyo
      ? (ms ? 'Cadangan rangkaian Tokyo; tempoh anggaran, bukan jadual langsung. Semak platform, perkhidmatan dan tambang sebelum bertolak.' : 'Tokyo network suggestion; estimated duration, not a live timetable. Check platforms, services and fares before departure.')
      : (ms ? 'Tempoh anggaran termasuk masa menunggu biasa, bukan jadual langsung. Semak perkhidmatan dan tambang sebelum bertolak.' : 'Estimated duration including a typical wait, not a live timetable. Check services and fares before you go.')}
      {route.attribution && <><br />{route.attribution}</>}</p>
  </section>;
}
