// v0.49 admin chart pieces. One series each, so one hue (--brand-600) and no
// legend: the card title names the series. Text stays in ink tokens; trends
// carry an arrow and a sign, never colour alone.
import { useState } from 'react';

/** Tiny trend line for a KPI tile. Decorative: the tile states the number. */
export function Sparkline({ values, label }: { values: number[]; label?: string }) {
  const W = 120, H = 32, P = 2;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (W - P * 2) / (values.length - 1) : 0;
  const pts = values.map((v, i) => `${(P + i * step).toFixed(1)},${(H - P - (v / max) * (H - P * 2)).toFixed(1)}`).join(' ');
  return (
    <svg className="adm-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      {values.length > 1 && <polyline points={pts} fill="none" stroke="var(--brand-600)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/** "▲ 12%" / "▼ 8%" / "—" against the previous period. */
export function Trend({ pct, suffix }: { pct: number | null; suffix?: string }) {
  if (pct == null) return <span className="adm-trend flat">—{suffix ? ` ${suffix}` : ''}</span>;
  const up = pct > 0, down = pct < 0;
  return (
    <span className={`adm-trend ${up ? 'up' : down ? 'down' : 'flat'}`}>
      <span aria-hidden="true">{up ? '▲' : down ? '▼' : '■'}</span> {up ? '+' : ''}{pct}%{suffix ? ` ${suffix}` : ''}
    </span>
  );
}

/** Daily bars: baseline-anchored, 2px gaps, 4px rounded tops, hover/tap tooltip. */
export function DailyBars({ data, label, format = String, unit }: {
  data: Array<{ day: string; n: number }>; label: string; format?: (n: number) => string; unit: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, H = 140, top = 8;
  const max = Math.max(0, ...data.map(d => d.n));
  const slot = data.length ? W / data.length : W;
  const bw = Math.max(1, slot - 2);
  const hv = hover != null ? data[hover] : null;
  const fmtDay = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return (
    <div className="adm-bars" onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`${label}: ${data.length} days, highest ${format(max)}`}>
        <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--border)" strokeWidth="1" />
        {data.map((d, i) => {
          const bh = max > 0 ? Math.max(d.n > 0 ? 2 : 0, (d.n / max) * (H - top)) : 0;
          const x = i * slot + 1, y = H - bh, r = Math.min(4, bw / 2, bh);
          return (
            <g key={d.day}>
              {bh > 0 && <path d={`M${x} ${H}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + bw - r}Q${x + bw} ${y} ${x + bw} ${y + r}V${H}Z`}
                fill="var(--brand-600)" opacity={hover == null || hover === i ? 1 : 0.45} />}
              <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hv && <div className="adm-tip" style={{ left: `${Math.min(85, Math.max(15, ((hover! + 0.5) / data.length) * 100))}%` }}>
        <b>{fmtDay(hv.day)}</b><span>{format(hv.n)} {unit}</span>
      </div>}
      <div className="adm-axis"><span>{data[0] ? fmtDay(data[0].day) : ''}</span><span>max {format(max)}</span><span>{data.at(-1) ? fmtDay(data.at(-1)!.day) : ''}</span></div>
    </div>
  );
}

export const greeting = (ms: boolean, d = new Date()) => {
  const h = d.getHours();
  if (ms) return h < 12 ? 'Selamat pagi' : h < 15 ? 'Selamat tengah hari' : h < 19 ? 'Selamat petang' : 'Selamat malam';
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

export const tripStatus = (t: { start_date?: string | null; end_date?: string | null }, today: string): 'ongoing' | 'upcoming' | 'past' | 'undated' => {
  if (!t.start_date) return 'undated';
  const end = t.end_date || t.start_date;
  return today < t.start_date ? 'upcoming' : today > end ? 'past' : 'ongoing';
};
export const STATUS_NAMES: Record<ReturnType<typeof tripStatus>, [string, string]> = {
  ongoing: ['On now', 'Sedang berlangsung'], upcoming: ['Upcoming', 'Akan datang'], past: ['Finished', 'Selesai'], undated: ['No dates', 'Tiada tarikh'],
};
