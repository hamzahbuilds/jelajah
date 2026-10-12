import { DEFAULT_FEATURE_FLAGS, featureFlags } from '../../shared/featureFlags';
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { api } from '../api';
import Modal from './Modal';
import RailDirections from './RailDirections';
import type { RouteResult } from '../hooks/useJourneyRoutes';
import LeafletMap from './LeafletMap';
import type { geoapifyTransit } from '../../server/lib/geoapify-transit';

export default function TransitOptions({ tripId, from, to, railRoute }: {
  railRoute?: RouteResult; tripId: number; from: {lat:number;lng:number;name?:string;title?:string}; to: {lat:number;lng:number;name?:string;title?:string};
}) {
  const { t, lang } = useT();
  const ms = lang === 'ms';
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [route, setRoute] = useState<ReturnType<typeof geoapifyTransit> | null>(null);
  const [embed, setEmbed] = useState<string | null>(null);
  const request = useRef(0);
  const [flags,setFlags] = useState(DEFAULT_FEATURE_FLAGS);
  useEffect(() => {
    let active = true;
    setFlags(DEFAULT_FEATURE_FLAGS);
    if (open) api.get('/journey/features').then(r => { if(active) setFlags(featureFlags(r)); }).catch(() => {});
    return () => { active = false; };
  }, [open, tripId]);
  useEffect(() => {
    request.current++; setRoute(null); setEmbed(null); setMessage(''); setBusy(false);
    return () => { request.current++; };
  }, [tripId, from.lat, from.lng, to.lat, to.lng, open]);
  const label = ms ? 'Pilihan transit' : 'Transit options';
  const external = new URL('https://www.google.com/maps/dir/');
  external.search = new URLSearchParams({api:'1',origin:`${from.lat},${from.lng}`,destination:`${to.lat},${to.lng}`,travelmode:'transit'}).toString();
  async function search(provider: 'geoapify' | 'google') {
    const id = ++request.current;
    setBusy(true); setMessage(''); setEmbed(null); setRoute(null);
    try {
      const r = await api.post(`/journey/trips/${tripId}/transit-preview`, {provider, points:[[from.lat,from.lng],[to.lat,to.lng]]});
      if (id !== request.current) return;
      if (provider === 'google') {
        if (r.embedUrl) setEmbed(r.embedUrl);
        else setMessage(ms ? 'Google Maps Embed belum disediakan. Gunakan pautan Google Maps di bawah.' : 'Google Maps Embed is not configured yet. Use the Google Maps link below.');
      } else if (r.available) setRoute(r);
      else setMessage(r.reason === 'setup'
        ? (ms ? 'Kunci Geoapify belum disediakan. Cuba Google Maps.' : 'Geoapify is not configured yet. Try Google Maps.')
        : r.reason === 'quota' ? t.j.routeQuota
        : (ms ? 'Laluan Geoapify tidak tersedia. Cuba Google Maps.' : 'Geoapify route unavailable. Try Google Maps.'));
    } catch { if (id === request.current) setMessage(t.j.failed); }
    finally { if (id === request.current) setBusy(false); }
  }
  return <>
    <button className="btn secondary sm" onClick={() => setOpen(true)}>{label}</button>
    {open && <Modal open title={label} onClose={() => {request.current++;setOpen(false);}} closeLabel={t.close} className="expanded-map-dialog">
      <p>{from.name || from.title} → {to.name || to.title}</p>
      <RailDirections route={railRoute} />
      {railRoute?.available && railRoute.source === 'tokyo-gtfs' && <LeafletMap pins={[{...from,label:from.name || from.title},{...to,label:to.name || to.title}]} routes={railRoute.segments || []} height={300} />}
      {(flags.transitGeoapify || flags.transitGoogleEmbed || flags.transitGoogleLink) && <p className="hint">{ms ? 'Semak alternatif Geoapify atau Google Maps jika diperlukan. Pratonton tidak mengubah jadual atau perbelanjaan.' : 'Check Geoapify or Google Maps for alternatives if needed. Previews do not change your itinerary or expenses.'}</p>}
      <div className="map-itinerary">
        {flags.transitGeoapify && <button className="btn" disabled={busy} onClick={() => search('geoapify')}>{ms ? 'Cuba Geoapify' : 'Try Geoapify'}</button>}
        {flags.transitGoogleEmbed && <button className="btn secondary" disabled={busy} onClick={() => search('google')}>{ms ? 'Lihat dalam Google Maps' : 'View Google transit map'}</button>}
      </div>
      {busy && <p role="status">{t.loading}</p>}
      {message && <p role="status">{message}</p>}
      {flags.transitGeoapify && route && <>
        <h3>{ms ? 'Laluan anggaran' : 'Approximate route'}</h3>
        <p>{Math.round(route.duration / 60)} {t.j.minutes} · {(route.distance / 1000).toFixed(1)} km</p>
        <p className="hint">{ms ? 'Berdasarkan data transit OpenStreetMap. Tempoh ialah anggaran, bukan jadual berlepas. Tambang tidak tersedia; sahkan perkhidmatan dengan operator.' : 'Based on OpenStreetMap transit data. Duration is an estimate, not a departure schedule. Fare unavailable; confirm services with the operator.'}</p>
        <LeafletMap pins={[{...from,label:from.name || from.title},{...to,label:to.name || to.title}]} routes={route.segments} height={360} />
        <p className="hint"><a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Powered by Geoapify</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></p>
      </>}
      {flags.transitGoogleEmbed && embed && <>
        <p className="hint">{ms ? 'Paparan Google berasingan. Pilihan laluan, masa dan tambang tidak diimport ke Jelajah.' : 'Separate Google view. Route selections, times and fares are not imported into Jelajah.'}</p>
        <iframe title={ms ? 'Peta transit Google' : 'Google transit directions'} src={embed} width="100%" height="450" style={{border:0,borderRadius:16}} loading="lazy" allowFullScreen referrerPolicy="no-referrer-when-downgrade" />
      </>}
      {flags.transitGoogleLink && <p><a href={external.toString()} target="_blank" rel="noreferrer">{ms ? 'Buka Google Maps dalam tab baharu' : 'Open Google Maps in a new tab'}</a></p>}
    </Modal>}
  </>;
}
