// v0.49 Admin → Dashboard: the admin's landing page. A greeting with the week
// in one line, KPI tiles with trends, daily active users, top features,
// newest trips, things that need a look, and the activity feed.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../../api';
import { useT } from '../../i18n';
import { useSession } from '../../app/session';
import { Icon, type IconName } from '../Icon';
import Loading from '../Loading';
import LfBars from '../charts/LfBars';
import { DailyBars, Sparkline, Trend, greeting, tripStatus, STATUS_NAMES } from './bits';
import { featureName, pctChange } from './featureCatalog';

type AuditRow = { id: number; action: string; user: string | null; at: string };
interface Stats {
  signups: Array<{ day: string; n: number }>; active7: number; active7Prev: number; active30: number;
  trips: number; mcp30: number; features: Array<{ feature: string; n: number }>; audit: AuditRow[];
  users: number; signupsPrev30: number; trips30: number; tripsPrev30: number; activities30: number; activitiesPrev30: number;
  documents30: number; ongoing: number; upcoming: number; aiFailed7: number; aiCost30: number; aiCalls30: number;
  dau: Array<{ day: string; n: number }>; tripsSeries: Array<{ day: string; n: number }>;
  recentTrips: Array<{ id: number; name: string; emoji: string; destination: string | null; start_date: string | null; end_date: string | null; created_at: string; members: number; leaders: string | null }>;
}

/** SQLite datetime('now') is UTC without a zone; ISO strings pass through. */
const utc = (at: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(at) ? at : at.replace(' ', 'T') + 'Z');
const usd = (v: number) => (v === 0 ? '$0' : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);

export default function AdminDashboard() {
  const { t, lang } = useT();
  const ms = lang === 'ms';
  const { user } = useSession();
  const [s, setS] = useState<Stats | null>(null);
  const [failed, setFailed] = useState(false);
  const [extra, setExtra] = useState<AuditRow[]>([]);
  const [shown, setShown] = useState(6);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/admin/stats').then(setS).catch(() => setFailed(true)); }, []);

  const first = user.name.trim().split(/\s+/)[0] || user.name;
  const today = new Date().toISOString().slice(0, 10);

  if (failed) return <p className="callout warn" role="alert">{ms ? 'Papan pemuka tidak dapat dimuatkan.' : 'Could not load the dashboard.'}</p>;
  if (!s) return <Loading label={t.loading} />;

  const signups30 = s.signups.reduce((a, d) => a + d.n, 0);
  const list = s.audit.concat(extra);
  const mayHaveMore = !done && list.length > 0 && list.length % 20 === 0;
  const more = async () => {
    if (shown < list.length) { setShown(n => n + 10); return; }
    if (done || busy || !list.length) return;
    setBusy(true);
    try {
      const r = await api.get(`/admin/audit?cursor=${list[list.length - 1].id}`);
      setExtra(x => x.concat(r.items)); if (!r.next_cursor) setDone(true); if (r.items.length) setShown(n => n + 10);
    } catch { /* keep the button for a retry */ } finally { setBusy(false); }
  };

  const summary = ms
    ? `${s.trips30} perjalanan baharu dan ${signups30} pendaftaran dalam 30 hari. ${s.active7} orang aktif minggu ini.`
    : `${s.trips30} new trip${s.trips30 === 1 ? '' : 's'} and ${signups30} sign-up${signups30 === 1 ? '' : 's'} in the last 30 days. ${s.active7} ${s.active7 === 1 ? 'person' : 'people'} active this week.`;

  const tiles: Array<{ icon: IconName; k: string; v: string; sub: React.ReactNode; spark?: number[]; to?: string }> = [
    { icon: 'spark', k: ms ? 'Aktif 7 hari' : 'Active this week', v: String(s.active7), sub: <Trend pct={pctChange(s.active7, s.active7Prev)} suffix={ms ? 'vs minggu lalu' : 'vs last week'} />, spark: s.dau.map(d => d.n).slice(-14), to: '/admin/usage' },
    { icon: 'users', k: ms ? 'Pengguna' : 'Users', v: String(s.users), sub: <><b>+{signups30}</b> {ms ? 'baharu' : 'new'} · <Trend pct={pctChange(signups30, s.signupsPrev30)} /></>, spark: s.signups.map(d => d.n), to: '/admin/people' },
    { icon: 'map', k: ms ? 'Perjalanan' : 'Trips', v: String(s.trips), sub: <><b>+{s.trips30}</b> {ms ? 'baharu' : 'new'} · <Trend pct={pctChange(s.trips30, s.tripsPrev30)} /></>, spark: s.tripsSeries.map(d => d.n), to: '/admin/trips' },
    { icon: 'calendar', k: ms ? 'Aktiviti dirancang' : 'Activities planned', v: String(s.activities30), sub: <Trend pct={pctChange(s.activities30, s.activitiesPrev30)} suffix={ms ? '30 hari' : '30 days'} /> },
    { icon: 'plane', k: ms ? 'Sedang berlangsung' : 'Trips on now', v: String(s.ongoing), sub: <>{s.upcoming} {ms ? 'akan datang' : 'upcoming'}</>, to: '/admin/trips' },
    { icon: 'sparkles', k: ms ? 'Kos AI (30 hari)' : 'AI spend (30 days)', v: usd(s.aiCost30), sub: <>{s.aiCalls30} {ms ? 'panggilan' : 'calls'}</>, to: '/admin/usage' },
  ];

  const attention = [
    s.aiFailed7 > 0 && { icon: 'alert' as IconName, text: ms ? `${s.aiFailed7} panggilan AI gagal dalam 7 hari` : `${s.aiFailed7} AI call${s.aiFailed7 === 1 ? '' : 's'} failed in the last 7 days`, to: '/admin/usage' },
    s.active7 < s.active7Prev && { icon: 'chart' as IconName, text: ms ? 'Pengguna aktif menurun berbanding minggu lalu' : 'Fewer active people than last week', to: '/admin/usage' },
  ].filter(Boolean) as Array<{ icon: IconName; text: string; to: string }>;

  return (
    <div className="adm-dash">
      <section className="adm-hero">
        <div>
          <span className="adm-eyebrow">{new Date().toLocaleDateString(ms ? 'ms-MY' : 'en-MY', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <h1>{greeting(ms)}, {first}</h1>
          <p>{summary}</p>
        </div>
        <nav className="adm-quick" aria-label={ms ? 'Pintasan' : 'Shortcuts'}>
          <Link className="btn sm" to="/admin/trips"><Icon name="map" size={16} /> {ms ? 'Semua perjalanan' : 'All trips'}</Link>
          <Link className="btn secondary sm" to="/admin/usage"><Icon name="chart" size={16} /> {ms ? 'Penggunaan' : 'Usage'}</Link>
          <Link className="btn secondary sm" to="/admin/people"><Icon name="users" size={16} /> {ms ? 'Orang' : 'People'}</Link>
        </nav>
      </section>

      {attention.length > 0 && <section className="adm-attention" aria-label={ms ? 'Perlu perhatian' : 'Needs attention'}>
        {attention.map(a => <Link key={a.text} to={a.to}><Icon name={a.icon} size={16} /> {a.text} <Icon name="arrow-r" size={16} /></Link>)}
      </section>}

      <section className="adm-kpis">
        {tiles.map(k => {
          const body = <>
            <span className="adm-k"><span className="tile sm"><Icon name={k.icon} /></span>{k.k}</span>
            <span className="adm-v">{k.v}</span>
            <span className="adm-sub">{k.sub}</span>
            {k.spark && <Sparkline values={k.spark} />}
          </>;
          return k.to ? <Link key={k.k} to={k.to} className="card adm-kpi">{body}</Link> : <div key={k.k} className="card adm-kpi">{body}</div>;
        })}
      </section>

      <div className="adm-grid">
        <section className="card">
          <div className="cardhead"><h2>{ms ? 'Pengguna aktif sehari' : 'Daily active people'}</h2><span className="badge gray">30d</span></div>
          <DailyBars data={s.dau} label={ms ? 'Pengguna aktif sehari' : 'Daily active people'} unit={ms ? 'orang' : 'people'} />
        </section>
        <LfBars title={ms ? 'Ciri paling digunakan' : 'Most used features'} sub={ms ? 'Jumlah tindakan, 30 hari' : 'Actions in the last 30 days'} badge="30d"
          rows={s.features.slice(0, 7).map(f => ({ key: f.feature, label: featureName(f.feature, ms), value: f.n }))}
          source={ms ? 'Lihat semua di Penggunaan' : 'See all in Usage'} />
      </div>

      <div className="adm-grid">
        <section className="card">
          <div className="cardhead"><h2>{ms ? 'Perjalanan terbaharu' : 'Newest trips'}</h2><Link className="btn ghost sm" to="/admin/trips">{ms ? 'Lihat semua' : 'See all'} <Icon name="arrow-r" size={16} /></Link></div>
          {!s.recentTrips.length ? <p className="muted">{ms ? 'Belum ada perjalanan.' : 'No trips yet.'}</p> : s.recentTrips.map(tr => {
            const st = tripStatus(tr, today);
            return (
              <Link key={tr.id} to={`/trips/${tr.id}`} className="lrow adm-trip-row">
                <span className="adm-emoji" aria-hidden="true">{tr.emoji || <Icon name="bag" />}</span>
                <div className="l-main"><b>{tr.name}</b><small>{[tr.destination, tr.leaders && `${ms ? 'Ketua' : 'Led by'} ${tr.leaders}`, `${tr.members} ${ms ? 'ahli' : tr.members === 1 ? 'member' : 'members'}`].filter(Boolean).join(' · ')}</small></div>
                <div className="l-end"><span className={`badge ${st === 'ongoing' ? 'brand' : 'gray'}`}>{STATUS_NAMES[st][ms ? 1 : 0]}</span><small className="muted">{fmtDate(tr.created_at?.slice(0, 10), lang)}</small></div>
              </Link>
            );
          })}
        </section>
        <section className="card">
          <div className="cardhead"><h2>{t.mFeed}</h2></div>
          {!list.length && <p className="muted">—</p>}
          {list.slice(0, shown).map(a => (
            <div className="lrow" key={a.id}>
              <span className="tile sm"><Icon name="spark" /></span>
              <div className="l-main"><b>{a.user ?? '—'}</b><small>{a.action.replace(/_/g, ' ')}</small></div>
              <div className="l-end"><span className="tiny muted">{utc(a.at).toLocaleString()}</span></div>
            </div>
          ))}
          {(shown < list.length || mayHaveMore) && <button className="btn ghost sm" style={{ marginTop: 10 }} disabled={busy} onClick={() => void more()}>{busy ? '…' : t.showMore}</button>}
        </section>
      </div>
    </div>
  );
}
