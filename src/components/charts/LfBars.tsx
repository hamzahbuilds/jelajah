// lieflat-style capsule bars: top item brand-600, rest a gray ladder, staggered
// grow-in. Style adopted from lieflat-charts (PolyForm Noncommercial) —
// hand-written markup, no code copied.
export interface LfBarsRow { key: string; label: string; value: number }
export interface LfBarsProps {
  title: string;
  sub: string;
  badge: string;
  rows: LfBarsRow[];
  source: string;
}

const LADDER = ['var(--gray-500)', 'var(--gray-500)', 'var(--gray-400)', 'var(--gray-400)', 'var(--gray-300)', 'var(--gray-300)'];

export default function LfBars({ title, sub, badge, rows, source }: LfBarsProps) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <div className="card lf">
      <div className="cardhead"><h3>{title}</h3><span className="badge gray"><span className="d" />{badge}</span></div>
      <div className="lfsub">{sub}</div>
      {rows.length === 0 && <p className="muted">—</p>}
      {rows.map((r, i) => (
        <div className="lfrow" key={r.key}>
          <span className="nm">{r.label}</span>
          <div className="tr">
            <div className="fl" style={{
              width: `${(r.value / max) * 100}%`,
              background: i === 0 ? 'var(--brand-600)' : LADDER[Math.min(i - 1, LADDER.length - 1)],
              animationDelay: `${i * 90}ms`,
            }} />
          </div>
          <span className="vv">{r.value}</span>
        </div>
      ))}
      <div className="lfsrc">{source}</div>
    </div>
  );
}
