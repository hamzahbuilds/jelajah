// v0.43 homepage hero map (docs/29): a real OpenStreetMap map (OpenFreeMap
// vector tiles, MapLibre) that tours a Penang day. The camera eases from stop
// to stop while the route draws itself along real streets, pins drop in, and
// the itinerary panel highlights the stop being reached. MapLibre loads on
// its own after first paint; the hero copy never waits for it.
//
// Motion: a Pause button stops the tour (WCAG 2.2.2); reduced motion shows the
// finished route, framed, with no tour; it also pauses while off screen.
import { useEffect, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import type { HomeCopy } from './homeCopy';
import { LEGS, STOPS, type LngLat } from './homeRoute';

type Maplibre = typeof import('maplibre-gl');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const dist = (a: LngLat, b: LngLat) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** The first `t` (0..1) of a polyline, by length. */
function slice(line: LngLat[], t: number): LngLat[] {
  const seg = line.slice(1).map((p, i) => dist(line[i], p));
  let left = seg.reduce((a, b) => a + b, 0) * t;
  const out: LngLat[] = [line[0]];
  for (let i = 0; i < seg.length; i++) {
    if (left >= seg[i]) { out.push(line[i + 1]); left -= seg[i]; continue; }
    const f = seg[i] ? left / seg[i] : 0;
    out.push([line[i][0] + (line[i + 1][0] - line[i][0]) * f, line[i][1] + (line[i + 1][1] - line[i][1]) * f]);
    break;
  }
  return out;
}
const ease = (t: number) => (t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

export default function HeroMap({ c }: { c: HomeCopy }) {
  const box = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(-1);   // stop reached; -1 = all (static)
  const [leg, setLeg] = useState(-1);         // leg being travelled
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(true);
  const playingRef = useRef(true);
  const visibleRef = useRef(true);
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  useEffect(() => { playingRef.current = playing; }, [playing]);

  useEffect(() => {
    let dead = false;
    let map: import('maplibre-gl').Map | null = null;
    const io = new IntersectionObserver(([e]) => { visibleRef.current = e.isIntersecting; });
    if (box.current) io.observe(box.current);

    (async () => {
      const [ml, worker] = await Promise.all([
        import('maplibre-gl') as Promise<Maplibre>,
        import('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url').then(m => m.default as string),
        import('maplibre-gl/dist/maplibre-gl.css'),
      ]);
      if (dead || !box.current) return;
      ml.setWorkerUrl(worker);
      const dark = document.documentElement.dataset.theme === 'dark';
      const css = getComputedStyle(document.documentElement);
      const brand = css.getPropertyValue('--brand').trim() || '#2557E8';
      const casing = dark ? '#0B111C' : '#FFFFFF';
      const all = LEGS.flat();
      const bounds = all.reduce((b, p) => b.extend(p), new ml.LngLatBounds(all[0], all[0]));

      const styleUrl = `https://tiles.openfreemap.org/styles/${dark ? 'dark' : 'positron'}`;
      map = new ml.Map({
        container: box.current,
        style: styleUrl,
        center: STOPS[1], zoom: 12,
        interactive: false,
        attributionControl: false,
        fadeDuration: 0,
      });
      const m = map;
      // A flaky network can drop the style request; retry a few times before giving up.
      let tries = 0;
      m.on('error', () => {
        if (!dead && !m.isStyleLoaded() && tries < 4) { tries++; setTimeout(() => { if (!dead) m.setStyle(styleUrl); }, 1200 * tries); }
      });
      m.addControl(new ml.AttributionControl({ compact: true }), 'top-left');
      // Keep the route clear of the itinerary panel: beside it when wide, above it when narrow.
      const panel = box.current.parentElement?.querySelector<HTMLElement>('.hm-panel');
      const pad = () => {
        const mapBox = box.current?.getBoundingClientRect(), pb = panel?.getBoundingClientRect();
        if (!mapBox || !pb) return { top: 48, bottom: 48, left: 48, right: 48 };
        const beside = pb.top < mapBox.top + mapBox.height / 2; // panel spans the height: route goes beside it
        return beside
          ? { top: 56, bottom: 56, left: Math.max(48, pb.right - mapBox.left + 32), right: 56 }
          : { top: 72, bottom: Math.max(48, mapBox.bottom - pb.top + 24), left: 32, right: 32 };
      };
      /** Camera moves are decoration: a fit that can't work must never stop the tour. */
      const fit = (b: import('maplibre-gl').LngLatBoundsLike, o: import('maplibre-gl').FitBoundsOptions) => {
        try { m.fitBounds(b, { ...o, padding: pad() }); } catch { try { m.fitBounds(b, { ...o, padding: 24 }); } catch { /* keep going */ } }
      };
      await new Promise<void>(r => m.once('load', () => r()));
      if (dead) return;
      // Compact attribution starts expanded, which covers the chips on a phone; start it collapsed (the (i) button opens it).
      const attrib = box.current?.querySelector('.maplibregl-ctrl-attrib');
      attrib?.removeAttribute('open'); attrib?.classList.remove('maplibregl-compact-show');
      try { m.setPadding(pad()); } catch { /* ignore */ }

      m.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': casing, 'line-width': 9, 'line-opacity': .9 } });
      m.addLayer({
        id: 'route-line', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': brand, 'line-width': 4.5, 'line-dasharray': ['case', ['==', ['get', 'mode'], 'walk'], ['literal', [.6, 1.8]], ['literal', [1, 0]]] },
      });
      const pins = STOPS.map((p, i) => {
        const wrap = document.createElement('div'), el = document.createElement('div');
        wrap.className = 'hm-pin-wrap'; el.className = 'hm-pin';
        el.textContent = String(i + 1);
        wrap.appendChild(el);
        new ml.Marker({ element: wrap }).setLngLat(p).addTo(m);
        return el;
      });
      const draw = (parts: LngLat[][]) => {
        const src = m.getSource('route') as import('maplibre-gl').GeoJSONSource | undefined;
        src?.setData({
          type: 'FeatureCollection',
          features: parts.filter(p => p.length > 1).map((coords, k) => ({ type: 'Feature', properties: { mode: k === 0 ? 'walk' : 'ride' }, geometry: { type: 'LineString', coordinates: coords } })),
        });
      };
      setReady(true);

      if (reduce) {
        fit(bounds, { duration: 0 });
        draw(LEGS);
        pins.forEach(p => p.classList.add('on'));
        return;
      }

      const gate = async () => { while (!dead && (!playingRef.current || !visibleRef.current || document.hidden)) await sleep(250); };
      const animateLeg = (k: number, done: LngLat[][]) => new Promise<void>(resolve => {
        const t0 = performance.now(), D = 2400;
        const step = async (now: number) => {
          if (dead) return resolve();
          if (!playingRef.current || !visibleRef.current) { await gate(); return requestAnimationFrame(step); }
          const t = Math.min(1, (now - t0) / D);
          draw([...done, slice(LEGS[k], ease(t))]);
          if (t < 1) requestAnimationFrame(step); else resolve();
        };
        requestAnimationFrame(step);
      });

      while (!dead) {
        // reset to the first stop, close in
        pins.forEach(p => p.classList.remove('on'));
        draw([]);
        setLeg(-1); setActive(0);
        try { m.setPadding(pad()); } catch { /* ignore */ }
        m.jumpTo({ center: STOPS[0], zoom: 14.6, pitch: 42, bearing: -12 });
        pins[0].classList.add('on');
        await sleep(900); await gate();
        const done: LngLat[][] = [];
        for (let k = 0; k < LEGS.length && !dead; k++) {
          setLeg(k);
          const line = LEGS[k];
          const lb = line.reduce((b, p) => b.extend(p), new ml.LngLatBounds(line[0], line[0]));
          fit(lb, { maxZoom: 15.2, pitch: 45, bearing: [-12, 18, -20][k], duration: 1600, easing: ease });
          await animateLeg(k, done);
          done.push(line);
          pins[k + 1].classList.add('on');
          setActive(k + 1); setLeg(-1);
          await sleep(1100); await gate();
        }
        // pull back to show the whole day, then go again
        fit(bounds, { pitch: 0, bearing: 0, duration: 2200 });
        setActive(-1);
        await sleep(4200); await gate();
      }
    })().catch(() => { /* map is decoration: the panel still tells the story */ });

    return () => { dead = true; io.disconnect(); map?.remove(); };
  }, [reduce]);

  const m = c.mock;
  return (
    <figure className="hm" aria-label={m.mapLabel}>
      <div className={`hm-map${ready ? ' ready' : ''}`} ref={box} />
      <div className="hm-panel" aria-hidden="true">
        <div className="hm-panel-head">
          <div>
            <strong>{m.trip}</strong>
            <span>{m.dates}</span>
          </div>
          <span className="hm-avatars"><i /><i /><i /><b>{m.people}</b></span>
        </div>
        <span className="hm-day">{m.day}</span>
        <ol>
          {m.stops.map(([time, name], k) => (
            <li key={k} className={active === -1 || k <= active ? (k === active ? 'now' : 'done') : ''}>
              <span className="hm-n">{k + 1}</span>
              <span className="hm-t">{time}</span>
              <span className="hm-name">{name}</span>
              {k < m.legs.length && <span className={`hm-leg${leg === k ? ' moving' : ''}`}>{m.legs[k]}</span>}
            </li>
          ))}
        </ol>
      </div>
      <div className="hm-owe" aria-hidden="true"><Icon name="wallet" size={16} /> {m.owe}</div>
      {!reduce && (
        <button type="button" className="hm-play" onClick={() => setPlaying(p => !p)} aria-label={playing ? m.pause : m.play}>
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
            {playing ? <><rect x="3.5" y="2.5" width="3" height="11" rx="1" /><rect x="9.5" y="2.5" width="3" height="11" rx="1" /></> : <path d="M4.5 2.8v10.4a.8.8 0 0 0 1.2.7l8.3-5.2a.8.8 0 0 0 0-1.4L5.7 2.1a.8.8 0 0 0-1.2.7z" />}
          </svg>
        </button>
      )}
    </figure>
  );
}
