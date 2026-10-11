import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import type { StyleSpecification } from 'maplibre-gl';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useT } from '../i18n';
import 'leaflet/dist/leaflet.css';
setWorkerUrl(workerUrl);

export interface Pin { lat: number; lng: number; label?: string; icon?: string }

export interface Arc { from: Pin; to: Pin; label?: string }

export interface Route { points: [number, number][]; mode: string; color?: string; label?: string }

// v0.19 per-mode route-line styling (ported from design/ui-refresh/ui.css
// .leg-train/.leg-walk/.leg-taxi). Colours are literal hex, not CSS vars —
// Leaflet draws SVG attributes at paint time via its own JS, outside the
// page's stylesheet cascade, so `var(--gray-400)` would not resolve there;
// #A8A69F is that token's actual value (src/styles.css --gray-400).
const ROUTE_STYLE: Record<string, { color: string; dashArray?: string }> = {
  train: { color: '#0E9384' }, metro: { color: '#0E9384' }, transit: { color: '#0E9384' }, intercity: { color: '#0E9384' },
  walk: { color: '#087F8C', dashArray: '2 7' },
  taxi: { color: '#F79009', dashArray: '7 5' }, car: { color: '#F79009', dashArray: '7 5' }, drive: { color: '#F79009', dashArray: '7 5' },
};
const FALLBACK_ROUTE_STYLE = { color: '#A8A69F' };

export default function LeafletMap({ pins, picked, onPick, height = 260, line = false, arcs = [], routes = [], accent, focus = null }: {
  pins: Pin[];
  picked?: Pin | null;
  onPick?: (lat: number, lng: number) => void;
  height?: number | string;
  line?: boolean;
  arcs?: Arc[];               // dashed great-line connections (e.g. flights)
  routes?: Route[];           // per-mode leg polylines (Plan page day map)
  accent?: string;            // trip accent colour for pins/lines
  focus?: number | null;      // index into pins to pan to and open — keeps the
                              // itinerary list and the map pointing at one place
}) {
  const { lang } = useT();
  const [tileFailed, setTileFailed] = useState(false);
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<L.Marker[]>([]);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { attributionControl: true, zoomControl: true, zoomAnimation: false })
      .setView([35.68, 139.76], 10);
    const custom = (window as any).JELAJAH_TILE_URL as string | undefined;
    const controller = new AbortController();
    let disposed = false;
    if (custom) L.tileLayer(custom, {
      maxZoom: 19,
      attribution: (window as any).JELAJAH_TILE_ATTRIBUTION ?? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    else fetch('https://tiles.openfreemap.org/styles/liberty', { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error('map-style'); return r.json() as Promise<StyleSpecification>; })
      .then(style => {
        if (disposed) return;
        for (const layer of style.layers) {
          if (layer.type === 'symbol' && layer.layout?.['text-field'] && JSON.stringify(layer.layout['text-field']).includes('name')) {
            layer.layout['text-field'] = ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];
          }
        }
        const base = maplibreGL({ style, attributionControl: false }).addTo(map);
        map.attributionControl.addAttribution('<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/">OpenMapTiles</a> · &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>');
        base.getMaplibreMap().on('error', () => { if (!disposed) setTileFailed(true); });
      }).catch(() => { if (!disposed) setTileFailed(true); });
    map.on('click', e => onPickRef.current?.(e.latlng.lat, e.latlng.lng));
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    const observer = new ResizeObserver(() => { map.invalidateSize({ animate: false }); });
    observer.observe(divRef.current);
    return () => { disposed = true; controller.abort(); observer.disconnect(); map.stop(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    markersRef.current = [];
    const color = accent || 'var(--brand-600)';
    const all: Pin[] = [...pins, ...(picked ? [picked] : []), ...arcs.flatMap(a => [a.from, a.to])];
    pins.forEach((p, i) => {
      const inner = (p as any).icon ?? String(i + 1);
      // the rotated teardrop's tip sits ~17px below its centre, so the icon
      // box is 26x32 with the anchor exactly on the tip — pins stay planted
      // on the true coordinate at every zoom level
      const popup = document.createElement('span');
      popup.textContent = p.label ?? '';
      const m = L.marker([p.lat, p.lng], {
        icon: L.divIcon({
          className: '',
          html: `<div class="pin-wrap"><div class="pin-dot" style="background:${color}"><span>${inner}</span></div></div>`,
          iconSize: [26, 32], iconAnchor: [13, 30], popupAnchor: [0, -28],
        }),
      }).addTo(layer).bindPopup(popup);
      markersRef.current[i] = m;
    });
    for (const a of arcs) {
      L.polyline([[a.from.lat, a.from.lng], [a.to.lat, a.to.lng]], { color, weight: 2, dashArray: '2 8', opacity: 0.85 }).addTo(layer);
      const mid = { lat: (a.from.lat + a.to.lat) / 2, lng: (a.from.lng + a.to.lng) / 2 };
      const popup = document.createElement('span');
      popup.textContent = a.label ?? '';
      L.marker([mid.lat, mid.lng], {
        icon: L.divIcon({ className: '', html: '<div style="font-size:16px">✈️</div>', iconSize: [20, 20], iconAnchor: [10, 10] }),
      }).addTo(layer).bindPopup(popup);
    }
    if (picked) {
      L.marker([picked.lat, picked.lng], {
        icon: L.divIcon({
          className: '',
          html: '<div class="pin-wrap"><div class="pin-dot picked"><span>✓</span></div></div>',
          iconSize: [26, 32], iconAnchor: [13, 30], popupAnchor: [0, -28],
        }),
      }).addTo(layer);
    }
    if (line && pins.length > 1) {
      L.polyline(pins.map(p => [p.lat, p.lng] as [number, number]), { color, weight: 3, dashArray: '6 6' }).addTo(layer);
    }
    for (const r of routes) {
      const style = { ...(ROUTE_STYLE[r.mode] ?? FALLBACK_ROUTE_STYLE), ...(r.color ? { color: r.color } : {}) };
      // A light casing keeps calculated routes visible over busy street tiles.
      L.polyline(r.points, { color: '#ffffff', weight: 12, opacity: 0.9, interactive: false }).addTo(layer);
      const path = L.polyline(r.points, { color: style.color, weight: 8, opacity: 1, dashArray: style.dashArray }).addTo(layer);
      if (r.label) { const label = document.createElement('span'); label.textContent = r.label; path.bindTooltip(label); }
    }
    if (all.length === 1) map.setView([all[0].lat, all[0].lng], 14);
    else if (all.length > 1) map.fitBounds(L.latLngBounds([...all.map(p => [p.lat, p.lng] as [number, number]), ...routes.flatMap(r => r.points)]), { padding: [30, 30] });
  }, [JSON.stringify(pins), JSON.stringify(picked ?? null), line, JSON.stringify(arcs), JSON.stringify(routes), accent]);

  // Pan to the pin the user tapped in the itinerary list and open its popup.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || focus == null) return;
    const m = markersRef.current[focus];
    if (!m) return;
    map.setView(m.getLatLng(), Math.max(map.getZoom(), 15), { animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches });
    m.openPopup();
  }, [focus, JSON.stringify(pins)]);

  return <div className="map-frame"><div ref={divRef} style={{ height, borderRadius: 16, border: '1px solid var(--border)' }} />
    {tileFailed && <p role="status" className="hint">{lang === 'ms' ? 'Sebahagian peta asas tidak dapat dimuatkan. Cuba muat semula.' : 'Some base-map details could not load. Please refresh to retry.'}</p>}
  </div>;
}
