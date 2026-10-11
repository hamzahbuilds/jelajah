import { useState } from 'react';
import { useT } from '../i18n';
import { api } from '../api';
import Modal from './Modal';
import LeafletMap from './LeafletMap';
import type { normalizeTransitOptions } from '../../server/lib/transit-provider';
import { transitDeparture } from '../../shared/transit-time';

/** Explicit-offset input keeps destination times independent of the device timezone. */
export default function TransitOptions({ tripId, from, to }: {
  tripId: number; from: {lat:number;lng:number;name?:string;title?:string}; to: {lat:number;lng:number;name?:string;title?:string};
}) {
  const { t, lang } = useT();
  const ms = lang === 'ms';
  const [open, setOpen] = useState(false), [departure, setDeparture] = useState('');
  const [zone,setZone] = useState('Europe/London');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [options, setOptions] = useState<ReturnType<typeof normalizeTransitOptions>>([]);
  const [selected, setSelected] = useState(0);
  const label = ms ? 'Cari jadual transit' : 'Find transit schedules';
  return <>
    <button className="btn secondary sm" onClick={() => setOpen(true)}>{label}</button>
    {open && <Modal open title={label} onClose={() => setOpen(false)} closeLabel={t.close} className="expanded-map-dialog">
      <p>{from.name || from.title} → {to.name || to.title}</p>
      <p className="hint">{ms ? 'Liputan bergantung pada operator dan tarikh. Harga tiket mungkin tidak tersedia.' : 'Coverage depends on the operator and travel date. Ticket prices may not be available.'}</p>
      <form onSubmit={async e => {
        e.preventDefault(); setBusy(true); setMessage(''); setOptions([]); setSelected(0);
        try {
          let time: string;
          try { time = transitDeparture(departure, zone); }
          catch { setMessage(ms ? 'Waktu ini tidak sah atau berulang semasa pertukaran waktu musim panas. Pilih waktu lain.' : 'This local time is invalid or ambiguous during a clock change. Choose another departure time.'); return; }
          const r = await api.post(`/journey/trips/${tripId}/transit-options`, { points: [[from.lat,from.lng],[to.lat,to.lng]], departure: time });
          if (r.available) setOptions(r.options);
          else setMessage(r.reason === 'transit_setup'
            ? (ms ? 'Sambungan jadual belum diaktifkan. Akses penyedia perlu disediakan dahulu.' : 'Schedule routing is not activated yet. Provider access must be arranged first.')
            : r.reason === 'quota' ? t.j.routeQuota : (ms ? 'Tiada jadual tersedia untuk carian ini. Semak dengan operator.' : 'No schedule is available for this search. Please check with the operator.'));
        } catch { setMessage(t.j.failed); } finally { setBusy(false); }
      }}>
        <label>{ms ? 'Waktu berlepas tempatan' : 'Local departure time'}
          <input type="datetime-local" required value={departure} onChange={e => { setDeparture(e.target.value); setOptions([]); }} />
        </label>
        <label>{ms ? 'Zon masa tempat berlepas' : 'Departure timezone'}<select value={zone} onChange={e=>{setZone(e.target.value);setOptions([]);}}>
          {['Europe/London','Europe/Paris','Europe/Madrid','Atlantic/Canary','Europe/Rome','Asia/Tokyo'].map(z=><option key={z}>{z}</option>)}
        </select></label>
        <button className="btn" disabled={busy}>{busy ? t.loading : label}</button>
      </form>
      {message && <p role="status">{message}</p>}
      {!!options.length && <>
        <p className="hint">{ms ? 'Pratonton sahaja; jadual perjalanan dan perbelanjaan tidak diubah.' : 'Preview only; your itinerary and expenses are not changed.'}</p>
        <div className="map-itinerary">{options.map((option, i) => <button key={option.id} className={`map-stop ${i === selected ? 'active' : ''}`} onClick={() => setSelected(i)}>
          <span><strong>{Math.round(option.duration / 60)} {t.j.minutes}</strong><small>{option.transfers ?? '—'} {ms ? 'pertukaran' : 'transfers'}</small>
          <small>{new Date(option.departure).toLocaleString(lang, {timeZone:zone})} → {new Date(option.arrival).toLocaleString(lang, {timeZone:zone})}</small></span>
        </button>)}</div>
        <LeafletMap pins={[{...from,label:from.name || from.title},{...to,label:to.name || to.title}]} routes={options[selected].segments} height={320} />
        {!options[selected].segments.length && <p>{ms ? 'Geometri laluan tidak tersedia.' : 'Route geometry unavailable.'}</p>}
        <ol>{options[selected].legs.map((leg,i)=><li key={i}>{leg.line || leg.mode}: {leg.from} → {leg.to}<br /><small>{leg.departure} → {leg.arrival} · {leg.realTime ? (ms ? 'Dikemas kini secara langsung' : 'Realtime update') : (ms ? 'Jadual terancang' : 'Scheduled')}</small></li>)}</ol>
        <h4>{ms ? 'Produk tiket daripada penyedia' : 'Ticket products supplied by provider'}</h4>
        <p className="hint">{ms ? 'Ini bukan jumlah keseluruhan perjalanan. Semak kelayakan, liputan tiket dan harga dengan operator.' : 'These are not a whole-journey price. Check eligibility, ticket coverage and current prices with the operator.'}</p>
        {options[selected].fareProducts.length ? <ul>{options[selected].fareProducts.map((p,i)=><li key={i}>{p.name} · {p.currency} {p.amount.toFixed(2)}</li>)}</ul> : <p>{ms ? 'Tambang tidak tersedia.' : 'Fare unavailable.'}</p>}
      </>}
      <p className="hint"><a href="https://transitous.org/sources/" target="_blank" rel="noreferrer">Transitous data sources</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></p>
    </Modal>}
  </>;
}
