// lieflat-style cumulative line: draw-in stroke + big counter, viewBox-contained.
// Style adopted from lieflat-charts (PolyForm Noncommercial) — hand-written SVG,
// no code copied (see design/ui-refresh/04-admin.html for the visual reference).
import { useEffect, useState } from 'react';
import { linePoints } from './chartData';

export interface LfLineProps {
  title: string;
  sub: string;
  badge: string;
  series: number[]; // already-cumulative values, oldest -> newest
  unitLabel: string; // e.g. "accounts"
  firstLabel: string; // e.g. "7 AUG"
  lastLabel: string; // e.g. "5 SEP"
  source: string;
}

export default function LfLine({ title, sub, badge, series, unitLabel, firstLabel, lastLabel, source }: LfLineProps) {
  const W = 300, H = 90, P = 4;
  const total = series.length ? series[series.length - 1] : 0;
  const pts = linePoints(series, W, H, P);
  const d = pts.length ? 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ') : '';

  // Counter animates up to the real total — no fabricated numbers, just a tween.
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    if (total <= 0) return;
    let n = 0;
    const step = Math.max(1, Math.round(total / 30));
    const id = setInterval(() => {
      n = Math.min(total, n + step);
      setCount(n);
      if (n >= total) clearInterval(id);
    }, 30);
    return () => clearInterval(id);
  }, [total]);

  return (
    <div className="card lf">
      <div className="cardhead"><h3>{title}</h3><span className="badge gray"><span className="d" />{badge}</span></div>
      <div className="lfsub">{sub}</div>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end' }}>
        <div>
          <div className="bigv">{count}</div>
          <div className="bigv"><small>{unitLabel}</small></div>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} style={{ flex: 1, minWidth: 0 }} preserveAspectRatio="none" aria-hidden>
          {d && <path className="draw" d={d} fill="none" stroke="var(--brand-600)" strokeWidth={2.5} strokeLinecap="round" />}
        </svg>
      </div>
      {(firstLabel || lastLabel) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: 'var(--ink-3)', marginTop: 6 }}>
          <span>{firstLabel}</span><span>{lastLabel}</span>
        </div>
      )}
      <div className="lfsrc">{source}</div>
    </div>
  );
}
