// v0.49 Admin → All trips: every trip on the platform. Search, filter by
// status, sort; each row opens the trip. Published-guide moderation sits below.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, fmtDate } from '../../api';
import { useT } from '../../i18n';
import { Icon } from '../Icon';
import Loading from '../Loading';
import Empty from '../Empty';
import { GuideModeration } from '../../pages/Publishing';
import { tripStatus, STATUS_NAMES } from './bits';

interface Row {
  id: number; name: string; emoji: string; destination: string | null; start_date: string | null; end_date: string | null;
  created_at: string; base_currency: string; members: number; leaders: string | null;
  activities: number; documents: number; expenses: number; last_planned: string | null;
}
type Status = 'all' | ReturnType<typeof tripStatus>;
type Sort = 'newest' | 'start' | 'activities' | 'members';

export default function AdminTrips() {
  const { t, lang } = useT();
  const ms = lang === 'ms';
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const status = (params.get('status') as Status) || 'all';
  const sort = (params.get('sort') as Sort) || 'newest';
  const set = (k: string, v: string, def: string) => { const p = new URLSearchParams(params); if (!v || v === def) p.delete(k); else p.set(k, v); setParams(p, { replace: k === 'q' }); };
  useEffect(() => { api.get('/admin/trips').then(r => setRows(r.trips)).catch(() => setFailed(true)); }, []);

  const today = new Date().toISOString().slice(0, 10);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, ongoing: 0, upcoming: 0, past: 0, undated: 0 };
    for (const r of rows ?? []) { c.all++; c[tripStatus(r, today)]++; }
    return c;
  }, [rows, today]);

  const shown = useMemo(() => {
    const needle = q.trim().toLocaleLowerCase();
    const list = (rows ?? []).filter(r => (status === 'all' || tripStatus(r, today) === status)
      && (!needle || `${r.name} ${r.destination ?? ''} ${r.leaders ?? ''}`.toLocaleLowerCase().includes(needle)));
    const by: Record<Sort, (a: Row, b: Row) => number> = {
      newest: (a, b) => b.id - a.id,
      start: (a, b) => (a.start_date ?? '9999').localeCompare(b.start_date ?? '9999'),
      activities: (a, b) => b.activities - a.activities,
      members: (a, b) => b.members - a.members,
    };
    return list.sort(by[sort]);
  }, [rows, q, status, sort, today]);

  return (
    <div className="adm-trips">
      <section className="card">
        <div className="adm-filters">
          <input type="search" aria-label={ms ? 'Cari perjalanan' : 'Search trips'} placeholder={ms ? 'Cari nama, destinasi atau ketua…' : 'Search name, destination or leader…'} value={q} onChange={e => set('q', e.target.value, '')} />
          <select aria-label={ms ? 'Susun' : 'Sort'} value={sort} onChange={e => set('sort', e.target.value, 'newest')}>
            <option value="newest">{ms ? 'Terbaharu' : 'Newest first'}</option>
            <option value="start">{ms ? 'Tarikh mula' : 'Start date'}</option>
            <option value="activities">{ms ? 'Paling banyak aktiviti' : 'Most activities'}</option>
            <option value="members">{ms ? 'Paling ramai ahli' : 'Most members'}</option>
          </select>
        </div>
        <div className="chips adm-status" role="group" aria-label={ms ? 'Status' : 'Status'}>
          {(['all', 'ongoing', 'upcoming', 'past', 'undated'] as Status[]).map(k => (
            <button key={k} type="button" className={`chip ${status === k ? 'on' : ''}`} aria-pressed={status === k} onClick={() => set('status', k, 'all')}>
              {k === 'all' ? (ms ? 'Semua' : 'All') : STATUS_NAMES[k][ms ? 1 : 0]} <span className="badge gray">{counts[k] ?? 0}</span>
            </button>
          ))}
        </div>

        {failed ? <p className="callout warn" role="alert">{ms ? 'Senarai perjalanan tidak dapat dimuatkan.' : 'Could not load trips.'}</p>
          : !rows ? <Loading label={t.loading} />
          : !shown.length ? <Empty icon="map" title={q || status !== 'all' ? (ms ? 'Tiada padanan' : 'No matching trips') : (ms ? 'Belum ada perjalanan' : 'No trips yet')} sub={q || status !== 'all' ? (ms ? 'Cuba carian atau status lain.' : 'Try another search or status.') : (ms ? 'Perjalanan baharu akan muncul di sini.' : 'New trips show up here.')} />
          : <div className="table-scroll">
            <table className="table adm-table">
              <caption className="sr-only">{ms ? 'Semua perjalanan' : 'All trips'}</caption>
              <thead><tr>
                <th>{ms ? 'Perjalanan' : 'Trip'}</th><th>{ms ? 'Tarikh' : 'Dates'}</th><th>{ms ? 'Ketua' : 'Leader'}</th>
                <th className="num">{ms ? 'Ahli' : 'Members'}</th><th className="num">{ms ? 'Aktiviti' : 'Activities'}</th>
                <th className="num">{ms ? 'Dokumen' : 'Docs'}</th><th className="num">{ms ? 'Belanja' : 'Expenses'}</th><th>{ms ? 'Dicipta' : 'Created'}</th>
              </tr></thead>
              <tbody>{shown.map(r => {
                const st = tripStatus(r, today);
                return (
                  <tr key={r.id}>
                    <td><Link to={`/trips/${r.id}`} className="adm-trip-link"><span aria-hidden="true">{r.emoji || <Icon name="bag" size={16} />}</span> <b>{r.name}</b></Link>
                      <small>{[r.destination, r.base_currency].filter(Boolean).join(' · ')}</small></td>
                    <td><span className={`badge ${st === 'ongoing' ? 'brand' : 'gray'}`}>{STATUS_NAMES[st][ms ? 1 : 0]}</span>
                      {r.start_date && <small>{fmtDate(r.start_date, lang)}{r.end_date && r.end_date !== r.start_date ? ` → ${fmtDate(r.end_date, lang)}` : ''}</small>}</td>
                    <td>{r.leaders || '—'}</td>
                    <td className="num">{r.members}</td><td className="num">{r.activities}</td><td className="num">{r.documents}</td><td className="num">{r.expenses}</td>
                    <td><small>{fmtDate(r.created_at?.slice(0, 10), lang)}</small></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>}
        {rows && <p className="hint">{ms ? `${shown.length} daripada ${rows.length} perjalanan` : `Showing ${shown.length} of ${rows.length} trips`}</p>}
      </section>
      <div style={{ marginTop: 16 }}><GuideModeration /></div>
      <p className="hint"><Icon name="info" size={16} /> {ms ? 'Membuka perjalanan memberi anda akses penuh sebagai pentadbir.' : 'Opening a trip gives you full access as admin.'}</p>
    </div>
  );
}
