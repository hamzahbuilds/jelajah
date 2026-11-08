import { useEffect, useState } from 'react';

// v0.38 perf: the avatar generator (@dicebear, ~400 KB of source) loads on
// demand in its own chunk instead of with every page; until it's in, the
// same-size circle shows the avatar's first background colour.
type Gen = typeof import('../lib/avatar');
let gen: Promise<Gen> | null = null;
const cache = new Map<string, string>();

/** Decorative next to the visible person's name, so screen readers avoid repetition. */
export default function Avatar({ identity, size = 32 }: { identity: string; size?: number }) {
  const [src, setSrc] = useState(() => cache.get(identity) ?? '');
  useEffect(() => {
    if (cache.has(identity)) { setSrc(cache.get(identity)!); return; }
    let live = true;
    (gen ??= import('../lib/avatar')).then(m => {
      const uri = m.avatarDataUri(identity);
      cache.set(identity, uri);
      if (live) setSrc(uri);
    }).catch(() => { gen = null; });
    return () => { live = false; };
  }, [identity]);
  return src
    ? <img className="avatar" src={src} width={size} height={size} style={{ width: size, height: size }} alt="" aria-hidden="true" />
    : <svg className="avatar avatar-ph" width={size} height={size} aria-hidden="true" />;
}
