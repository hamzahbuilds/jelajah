import type { RouteResult } from '../hooks/useJourneyRoutes';
import { useT } from '../i18n';
import { lineColors } from './transitLines';

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
  // v0.45: each ride carries its map colour, and every change of line spells
  // out where to get off, whether to walk to another station, and what to board.
  const colors = lineColors(route.segments);
  const seen = new Map<string, number>();
  const colorOf = (line: string) => { const n = seen.get(line) ?? 0; seen.set(line, n + 1); const c = colors.get(line); return c?.[n]?.color ?? c?.at(-1)?.color; };
  const steps = route.steps ?? [];
  // Stops per step: walk the station hops in order until the step's last station.
  const hops = (route.segments ?? []).filter(s => s.mode !== 'walk' && s.label?.includes(' → '));
  let h = 0;
  const stopCounts = steps.map(step => {
    let n = 0;
    while (h < hops.length) { n++; if (hops[h++].label!.endsWith(` → ${step.toStation}`)) break; }
    return n;
  });
  const mins = (s: number) => Math.max(1, Math.round(s / 60));
  const stopsText = (n: number) => ms ? `${n} hentian` : `${n} stop${n === 1 ? '' : 's'}`;
  return <section className="rail-directions" aria-label={title}>
    <h2>{title}</h2>
    {steps.length ? <ol className="rd-steps">{steps.map((step, i) => {
      const color = colorOf(step.line), stops = stopCounts[i];
      const prev = steps[i - 1];
      const walk = prev && prev.toStation !== step.fromStation;
      const sameLine = prev && prev.line === step.line;
      return <li key={i} className="rd-step" style={color ? { ['--line' as string]: color } : undefined}>
        {prev && <p className="rd-change">
          {walk
            ? (ms ? <>Turun di <b>{prev.toStation}</b>, jalan kaki ke <b>{step.fromStation}</b></> : <>Get off at <b>{prev.toStation}</b>, walk to <b>{step.fromStation}</b></>)
            : sameLine
              ? (ms ? <>Di <b>{step.fromStation}</b>, tukar ke kereta api menuju <b>{step.toStation}</b></> : <>At <b>{step.fromStation}</b>, change to the train towards <b>{step.toStation}</b></>)
              : (ms ? <>Tukar di <b>{step.fromStation}</b> — ikut papan tanda ke {step.line}</> : <>Change at <b>{step.fromStation}</b> — follow signs for {step.line}</>)}
        </p>}
        <strong className="rd-line"><span className="rd-swatch" aria-hidden="true" />{step.line}</strong>
        <span>{i === 0 ? `${board(step.mode === 'bus', true)} ${step.fromStation}` : step.fromStation} → {step.toStation}</span>
        <span className="rd-meta">~{mins(step.duration)} min{stops ? ` · ${stopsText(stops)}` : ''}</span>
      </li>;
    })}<li className="rd-step rd-end"><strong>{ms ? 'Turun di' : 'Get off at'} {steps.at(-1)?.toStation}</strong></li></ol>
      : <p>{route.lines?.join(' → ')}<br />{route.stations?.join(' → ')}</p>}
    <p className="hint">{tokyo
      ? (ms ? 'Cadangan rangkaian Tokyo; tempoh anggaran, bukan jadual langsung. Semak platform, perkhidmatan dan tambang sebelum bertolak.' : 'Tokyo network suggestion; estimated duration, not a live timetable. Check platforms, services and fares before departure.')
      : (ms ? 'Tempoh anggaran termasuk masa menunggu biasa, bukan jadual langsung. Semak perkhidmatan dan tambang sebelum bertolak.' : 'Estimated duration including a typical wait, not a live timetable. Check services and fares before you go.')}
      {route.attribution && <><br />{route.attribution}</>}</p>
  </section>;
}
