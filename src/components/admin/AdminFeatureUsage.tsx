// v0.49 Admin → Usage: which features people use, how many people use each,
// and how that moved against the previous period. Grouped by area.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { useT } from '../../i18n';
import Loading from '../Loading';
import { DailyBars, Sparkline, Trend } from './bits';
import { FEATURE_GROUPS, featureGroup, featureName, pctChange, type FeatureGroup } from './featureCatalog';

interface Usage {
  days: number; users: number; active: number; activePrev: number;
  dau: Array<{ day: string; n: number }>;
  features: Array<{ feature: string; events: number; users: number; prevEvents: number; prevUsers: number; series: number[] }>;
  top: Array<{ id: number; name: string; events: number; features: number; last_day: string }>;
}

export default function AdminFeatureUsage() {
  const { t, lang } = useT();
  const ms = lang === 'ms';
  const [days, setDays] = useState(30);
  const [u, setU] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setU(null); api.get(`/admin/feature-usage?days=${days}`).then(setU).catch(() => setFailed(true)); }, [days]);

  const groups = useMemo(() => {
    const g = new Map<FeatureGroup, Usage['features']>();
    for (const f of u?.features ?? []) {
      const k = featureGroup(f.feature);
      if (!g.has(k)) g.set(k, []);
      g.get(k)!.push(f);
    }
    return (Object.keys(FEATURE_GROUPS) as FeatureGroup[]).filter(k => g.has(k)).map(k => ({ key: k, rows: g.get(k)! }));
  }, [u]);

  const events = u?.features.reduce((a, f) => a + f.events, 0) ?? 0;
  const prevEvents = u?.features.reduce((a, f) => a + f.prevEvents, 0) ?? 0;
  const adoption = u && u.users ? Math.round((u.active / u.users) * 100) : 0;

  return (
    <section className="card adm-usage" aria-labelledby="adm-usage-h" style={{ marginBottom: 20 }}>
      <div className="cardhead">
        <h2 id="adm-usage-h">{ms ? 'Penggunaan ciri' : 'Feature usage'}</h2>
        <div className="seg" role="group" aria-label={ms ? 'Tempoh' : 'Range'}>
          {[7, 30, 90].map(d => <button key={d} type="button" className={days === d ? 'on' : ''} aria-pressed={days === d} onClick={() => setDays(d)}>{d}{ms ? ' hari' : 'd'}</button>)}
        </div>
      </div>
      {failed ? <p className="callout warn" role="alert">{ms ? 'Penggunaan tidak dapat dimuatkan.' : 'Could not load usage.'}</p> : !u ? <Loading label={t.loading} /> : <>
        <div className="ai-usage-tiles">
          <div><span>{ms ? 'Orang aktif' : 'Active people'}</span><b>{u.active}</b><small><Trend pct={pctChange(u.active, u.activePrev)} suffix={ms ? 'vs tempoh lalu' : 'vs previous'} /></small></div>
          <div><span>{ms ? 'Penggunaan akaun' : 'Accounts in use'}</span><b>{adoption}%</b><small>{u.active} / {u.users} {ms ? 'akaun' : 'accounts'}</small></div>
          <div><span>{ms ? 'Tindakan' : 'Actions'}</span><b>{events}</b><small><Trend pct={pctChange(events, prevEvents)} /></small></div>
          <div><span>{ms ? 'Ciri digunakan' : 'Features used'}</span><b>{u.features.length}</b><small>{u.days} {ms ? 'hari' : 'days'}</small></div>
        </div>

        <h3 className="ai-usage-sub">{ms ? 'Orang aktif sehari' : 'Active people per day'}</h3>
        <DailyBars data={u.dau} label={ms ? 'Orang aktif sehari' : 'Active people per day'} unit={ms ? 'orang' : 'people'} />

        {!groups.length ? <p className="muted" style={{ marginTop: 16 }}>{ms ? 'Tiada aktiviti dalam tempoh ini.' : 'No activity in this period.'}</p> : groups.map(g => (
          <div className="table-scroll" key={g.key} style={{ marginTop: 16 }}>
            <table className="ai-usage-table adm-feature-table">
              <caption>{FEATURE_GROUPS[g.key][ms ? 1 : 0]}</caption>
              <thead><tr>
                <th>{ms ? 'Ciri' : 'Feature'}</th><th>{ms ? 'Tindakan' : 'Actions'}</th><th>{ms ? 'Orang' : 'People'}</th>
                <th>{ms ? 'Purata seorang' : 'Per person'}</th><th><span className="sr-only">{ms ? 'Trend harian' : 'Daily trend'}</span></th>
              </tr></thead>
              <tbody>{g.rows.map(f => (
                <tr key={f.feature}>
                  <td>{featureName(f.feature, ms)}</td>
                  <td>{f.events} <Trend pct={pctChange(f.events, f.prevEvents)} /></td>
                  <td>{f.users} <Trend pct={pctChange(f.users, f.prevUsers)} /></td>
                  <td>{f.users ? (f.events / f.users).toFixed(1) : '—'}</td>
                  <td className="adm-spark-cell"><Sparkline values={f.series} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ))}

        <div className="table-scroll" style={{ marginTop: 16 }}>
          <table className="ai-usage-table">
            <caption>{ms ? 'Pengguna paling aktif' : 'Most active people'}</caption>
            <thead><tr><th>{ms ? 'Nama' : 'Name'}</th><th>{ms ? 'Tindakan' : 'Actions'}</th><th>{ms ? 'Ciri' : 'Features'}</th><th>{ms ? 'Terakhir aktif' : 'Last active'}</th></tr></thead>
            <tbody>{u.top.length ? u.top.map(p => <tr key={p.id}><td>{p.name}</td><td>{p.events}</td><td>{p.features}</td><td>{p.last_day}</td></tr>)
              : <tr><td colSpan={4} className="muted">—</td></tr>}</tbody>
          </table>
        </div>
        <p className="hint">{ms ? 'Dikira sehari bagi setiap orang (UTC). Ciri baharu mula dikira dari versi ini.' : 'Counted per person per day (UTC). Newly tracked features start counting from this version.'}</p>
      </>}
    </section>
  );
}
