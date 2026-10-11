import { useMemo } from 'react';
import { avatarDataUri } from '../lib/avatar';

/** Decorative next to the visible person's name, so screen readers avoid repetition. */
export default function Avatar({ identity, size = 32 }: { identity: string; size?: number }) {
  const src = useMemo(() => avatarDataUri(identity), [identity]);
  return <img className="avatar" src={src} width={size} height={size}
    style={{ width: size, height: size }} alt="" aria-hidden="true" />;
}
