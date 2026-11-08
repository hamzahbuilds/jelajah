// v0.38 perf: the map engine (Leaflet + MapLibre, ~330 KB gzip) loads only
// when a map is about to scroll into view, not with the page. Until then a
// box of the map's height holds its place (no layout shift).
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react';

const LeafletMap = lazy(() => import('./LeafletMap'));
export type { Pin, Arc, Route } from './mapTypes';
export { pinIcon } from './mapTypes';

type Props = ComponentProps<typeof LeafletMap>;

/** Start fetching the map engine early (e.g. on hover of a "show map" button). */
export const preloadMap = () => { void import('./LeafletMap'); };

export default function LazyMap(props: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = box.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === 'undefined') { setNear(true); return; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: '300px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const h = typeof props.height === 'number' ? `${props.height}px` : props.height ?? '260px';
  // Height set from a ref, not an inline style prop (uiGuard ratchet).
  useLayoutEffect(() => { if (box.current) box.current.style.blockSize = h; });
  const ph = <div ref={box} className="map-ph" aria-hidden="true" />;
  if (!near) return ph;
  return <Suspense fallback={ph}><LeafletMap {...props} /></Suspense>;
}
