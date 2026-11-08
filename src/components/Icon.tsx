// Jelajah UI refresh — inline SVG icon system.
// DEFS + ICON_NAMES live in ./iconDefs (a pure module, no JSX) so the
// vitest node tests can assert against the sprite without importing React.
//
// v0.37 (docs/24): a dozen icons that mark key actions are Animate UI animated
// icons (src/components/animate-ui/icons/, Lucide registry + our own plane).
// They play their one gesture when the button/link around them is hovered or
// tapped (or focused from the keyboard), at the "subtle" level; everything
// else stays on the static sprite. Reduced motion is handled by the icon core.
import { useEffect, useRef, useState, type ComponentType } from 'react';
export { DEFS, ICON_NAMES } from './iconDefs';
export type { IconName } from './iconDefs';
import { DEFS, type IconName } from './iconDefs';
import { Sparkles } from './animate-ui/icons/sparkles';
import { Check } from './animate-ui/icons/check';
import { Calendar } from './animate-ui/icons/calendar';
import { Trash2 } from './animate-ui/icons/trash-2';
import { Plus } from './animate-ui/icons/plus';
import { RefreshCw } from './animate-ui/icons/refresh-cw';
import { Copy } from './animate-ui/icons/copy';
import { Link } from './animate-ui/icons/link';
import { ArrowRight } from './animate-ui/icons/arrow-right';
import { X } from './animate-ui/icons/x';
import { Plane } from './animate-ui/icons/plane';

type Animated = ComponentType<{ size?: number; className?: string; animate?: boolean; ref?: React.Ref<SVGSVGElement>; 'aria-hidden'?: boolean }>;
const ANIMATED: Partial<Record<IconName, Animated>> = {
  sparkles: Sparkles as Animated, check: Check as Animated, calendar: Calendar as Animated, trash: Trash2 as Animated,
  plus: Plus as Animated, refresh: RefreshCw as Animated, copy: Copy as Animated, link: Link as Animated,
  'arrow-r': ArrowRight as Animated, x: X as Animated, plane: Plane as Animated,
};

export function IconDefs() {
  return <svg style={{ display: 'none' }} dangerouslySetInnerHTML={{ __html: DEFS }} />;
}

export function Icon({ name, size = 20, className = '', still }: {
  name: IconName; size?: 16 | 20 | 24; className?: string;
  /** Force the static sprite (e.g. inside a dense list). */
  still?: boolean;
}) {
  const A = still ? undefined : ANIMATED[name];
  if (A) return <PlayOnHost Comp={A} size={size} className={'icon ' + className} />;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={'icon ' + className} aria-hidden="true">
      <use href={`#i-${name}`} />
    </svg>
  );
}

/** Plays the icon while its host control (button, link, label) is hovered, pressed or keyboard-focused. */
function PlayOnHost({ Comp, size, className }: { Comp: Animated; size: number; className: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [play, setPlay] = useState(false);
  useEffect(() => {
    const host = ref.current?.closest<HTMLElement>('button, a, [role="button"], [role="radio"], label, summary');
    if (!host) return;
    const on = () => setPlay(true);
    const off = () => setPlay(false);
    const onFocus = () => { if (host.matches(':focus-visible')) on(); };
    host.addEventListener('pointerenter', on);
    host.addEventListener('pointerleave', off);
    host.addEventListener('pointerdown', on);
    host.addEventListener('focus', onFocus);
    host.addEventListener('blur', off);
    return () => {
      host.removeEventListener('pointerenter', on);
      host.removeEventListener('pointerleave', off);
      host.removeEventListener('pointerdown', on);
      host.removeEventListener('focus', onFocus);
      host.removeEventListener('blur', off);
    };
  }, []);
  return <Comp ref={ref} size={size} className={className} animate={play} aria-hidden />;
}
