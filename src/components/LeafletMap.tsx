import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface Pin { lat: number; lng: number; label?: string }

export default function LeafletMap({ pins, picked, onPick, height = 260, line = false }: {
  pins: Pin[];
  picked?: Pin | null;
  onPick?: (lat: number, lng: number) => void;
  height?: number;
  line?: boolean;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;
    const map = L.map(divRef.current, { attributionControl: true, zoomControl: true })
      .setView([35.68, 139.76], 10);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    map.on('click', e => onPickRef.current?.(e.latlng.lat, e.latlng.lng));
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current, layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    const all: Pin[] = [...pins, ...(picked ? [picked] : [])];
    pins.forEach((p, i) => {
      L.marker([p.lat, p.lng], {
        icon: L.divIcon({ className: '', html: `<div class="pin-dot"><span>${i + 1}</span></div>`, iconSize: [26, 26], iconAnchor: [13, 26] }),
      }).addTo(layer).bindPopup(p.label ?? '');
    });
    if (picked) {
      L.marker([picked.lat, picked.lng], {
        icon: L.divIcon({ className: '', html: '<div class="pin-dot picked"><span>✓</span></div>', iconSize: [26, 26], iconAnchor: [13, 26] }),
      }).addTo(layer);
    }
    if (line && pins.length > 1) {
      L.polyline(pins.map(p => [p.lat, p.lng] as [number, number]), { color: '#0d9488', weight: 3, dashArray: '6 6' }).addTo(layer);
    }
    if (all.length === 1) map.setView([all[0].lat, all[0].lng], 14);
    else if (all.length > 1) map.fitBounds(L.latLngBounds(all.map(p => [p.lat, p.lng] as [number, number])), { padding: [30, 30] });
  }, [JSON.stringify(pins), JSON.stringify(picked ?? null), line]);

  return <div ref={divRef} style={{ height, borderRadius: 8, border: '1px solid var(--line)' }} />;
}
