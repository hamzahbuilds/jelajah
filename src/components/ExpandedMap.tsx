import { useState } from 'react';
import LeafletMap, { type Pin, type Route } from './LeafletMap';
import Modal from './Modal';
import { useT } from '../i18n';

export interface MapStop { key: string; title: string; time?: string | null; detail?: string | null; pinIndex: number }

export default function ExpandedMap({ pins, routes, stops, title }: {
  pins: Pin[]; routes: Route[]; stops: MapStop[]; title: string;
}) {
  const { t, lang } = useT();
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<number | null>(null);
  return <>
    <button className="btn secondary sm" onClick={() => { setFocus(null); setOpen(true); }}>
      ⛶ {lang === 'ms' ? 'Besarkan peta' : 'Expand map'}
    </button>
    {open && <Modal open onClose={() => setOpen(false)} title={title} closeLabel={t.close} className="expanded-map-dialog">
      <LeafletMap pins={pins} routes={routes} height="min(55dvh, 640px)" focus={focus} />
      <h4>{t.plan}</h4>
      <div className="map-itinerary" aria-label={t.plan}>
        {stops.length === 0 && <p>{t.noEvents}</p>}
        {stops.map(stop => <button key={stop.key} className={`map-stop ${focus === stop.pinIndex && focus !== null ? 'active' : ''}`}
          disabled={stop.pinIndex < 0} onClick={() => setFocus(stop.pinIndex)}>
          <span className="map-stop-number">{stop.pinIndex >= 0 ? stop.pinIndex + 1 : '—'}</span>
          <span><small>{stop.time || '—'}</small><strong>{stop.title}</strong><small>{stop.detail}</small>
          {stop.pinIndex < 0 && <small>{t.noPinYet}</small>}</span>
        </button>)}
      </div>
    </Modal>}
  </>;
}
