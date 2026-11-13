// v0.41 onboarding illustrations: one small animated scene per step, drawn in
// SVG with theme tokens so it follows light/dark. Each scene plays once on
// entry (staggered), then idles with a gentle loop. With reduced motion on,
// the scene renders in its finished state and nothing loops.
import { motion, type Transition } from 'motion/react';
import { useShouldReduceMotion } from '@animate-ui/react/utils/motion';

export type ArtKind = 'route' | 'ai' | 'together' | 'chat' | 'link' | 'checklist';

const W = 240, H = 120;

function useAnim() {
  const reduce = useShouldReduceMotion();
  /** Enter at `delay` seconds; reduced motion shows the end state at once. */
  const at = (delay: number, extra?: Transition): Transition =>
    reduce ? { duration: 0 } : { delay, type: 'spring', stiffness: 260, damping: 24, ...extra };
  const loop = (delay: number, duration: number): Transition | undefined =>
    reduce ? undefined : { delay, duration, repeat: Infinity, repeatType: 'mirror', ease: 'easeInOut' };
  return { reduce, at, loop };
}

function Route() {
  const { reduce, at, loop } = useAnim();
  const d = 'M30 88 C 70 20, 120 110, 160 50 S 205 30, 212 34';
  return (
    <>
      <motion.path d={d} fill="none" className="oba-trail" strokeWidth={3} strokeDasharray="1 7" strokeLinecap="round"
        initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }}
        transition={reduce ? { duration: 0 } : { duration: 1.1, ease: 'easeInOut', delay: .2 }} />
      {[[30, 88, 0], [160, 50, .7], [212, 34, 1.2]].map(([x, y, dl], k) => (
        <motion.g key={k} initial={{ scale: reduce ? 1 : 0, opacity: reduce ? 1 : 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={at(dl)}>
          <circle cx={x} cy={y} r={9} className={k === 2 ? 'oba-brand' : 'oba-soft'} />
          <circle cx={x} cy={y} r={3.5} className={k === 2 ? 'oba-on-brand' : 'oba-brand'} />
        </motion.g>
      ))}
      <motion.g initial={{ opacity: reduce ? 1 : 0 }} animate={{ opacity: 1, y: [0, -4] }}
        transition={{ opacity: at(1.4), y: loop(1.6, 1.6) }}>
        <rect x={86} y={8} width={68} height={22} rx={11} className="oba-card" />
        <rect x={96} y={16} width={34} height={6} rx={3} className="oba-line" />
        <circle cx={142} cy={19} r={4} className="oba-brand" />
      </motion.g>
    </>
  );
}

function Ai() {
  const { reduce, at, loop } = useAnim();
  return (
    <>
      <motion.g initial={{ opacity: reduce ? 1 : 0, x: reduce ? 0 : -12 }} animate={{ opacity: 1, x: 0 }} transition={at(.1)}>
        <rect x={24} y={14} width={108} height={28} rx={14} className="oba-card" />
        <rect x={38} y={25} width={64} height={6} rx={3} className="oba-line" />
      </motion.g>
      {[0, 1, 2].map(k => (
        <motion.g key={k} initial={{ opacity: reduce ? 1 : 0, y: reduce ? 0 : 10 }} animate={{ opacity: 1, y: 0 }} transition={at(.5 + k * .22)}>
          <rect x={92} y={52 + k * 21} width={124} height={17} rx={6} className="oba-card" />
          <circle cx={103} cy={60.5 + k * 21} r={4} className="oba-brand" />
          <rect x={114} y={57.5 + k * 21} width={[70, 52, 84][k]} height={6} rx={3} className="oba-line" />
        </motion.g>
      ))}
      <motion.g initial={{ scale: reduce ? 1 : 0 }} animate={{ scale: 1, rotate: reduce ? 0 : [0, 14] }}
        transition={{ scale: at(.3), rotate: loop(1.2, 1.4) }}>
        <path d="M52 66 l5 13 13 5 -13 5 -5 13 -5 -13 -13 -5 13 -5 z" className="oba-brand" />
      </motion.g>
    </>
  );
}

function Together() {
  const { reduce, at, loop } = useAnim();
  const people = [[84, 'oba-p1'], [120, 'oba-p2'], [156, 'oba-p3']] as const;
  return (
    <>
      {people.map(([x, c], k) => (
        <motion.g key={k} initial={{ opacity: reduce ? 1 : 0, y: reduce ? 0 : 16 }} animate={{ opacity: 1, y: 0 }} transition={at(.1 + k * .15)}>
          <circle cx={x} cy={52} r={20} className={c} />
          <circle cx={x} cy={46} r={7} className="oba-face" />
          <path d={`M${x - 11} 66 a11 9 0 0 1 22 0`} className="oba-face" />
        </motion.g>
      ))}
      <motion.g initial={{ opacity: reduce ? 1 : 0 }} animate={{ opacity: 1, y: [0, -3] }}
        transition={{ opacity: at(.8), y: loop(1, 1.5) }}>
        <rect x={70} y={86} width={100} height={22} rx={11} className="oba-card" />
        <rect x={82} y={94} width={46} height={6} rx={3} className="oba-line" />
        <path d="M144 97 l5 5 9 -10" fill="none" className="oba-tick" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      </motion.g>
    </>
  );
}

function Chat() {
  const { reduce, at } = useAnim();
  return (
    <>
      <motion.g initial={{ opacity: reduce ? 1 : 0, x: reduce ? 0 : 12 }} animate={{ opacity: 1, x: 0 }} transition={at(.1)}>
        <rect x={104} y={14} width={112} height={28} rx={14} className="oba-brand" />
        <rect x={118} y={25} width={70} height={6} rx={3} className="oba-on-brand" opacity={.8} />
      </motion.g>
      <motion.g initial={{ opacity: reduce ? 1 : 0, x: reduce ? 0 : -12 }} animate={{ opacity: 1, x: 0 }} transition={at(.6)}>
        <rect x={24} y={52} width={132} height={52} rx={14} className="oba-card" />
        {[0, 1, 2].map(k => (
          <motion.rect key={k} x={38} y={64 + k * 12} height={6} rx={3} className="oba-line"
            initial={{ width: reduce ? [96, 72, 84][k] : 0 }} animate={{ width: [96, 72, 84][k] }}
            transition={reduce ? { duration: 0 } : { delay: .9 + k * .2, duration: .4, ease: 'easeOut' }} />
        ))}
      </motion.g>
    </>
  );
}

function LinkArt() {
  const { reduce, at, loop } = useAnim();
  return (
    <>
      <motion.g initial={{ opacity: reduce ? 1 : 0 }} animate={{ opacity: 1 }} transition={at(.1)}>
        <rect x={20} y={36} width={80} height={48} rx={10} className="oba-card" />
        <rect x={20} y={36} width={80} height={22} rx={10} className="oba-soft" />
        <rect x={30} y={66} width={52} height={6} rx={3} className="oba-line" />
      </motion.g>
      <motion.path d="M108 60 h22" className="oba-trail" strokeWidth={3} strokeLinecap="round"
        initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1, x: reduce ? 0 : [0, 4] }}
        transition={{ pathLength: reduce ? { duration: 0 } : { delay: .5, duration: .35 }, x: loop(1.2, .9) }} />
      <motion.path d="M124 53 l8 7 -8 7" fill="none" className="oba-trail" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"
        initial={{ opacity: reduce ? 1 : 0 }} animate={{ opacity: 1, x: reduce ? 0 : [0, 4] }}
        transition={{ opacity: at(.8), x: loop(1.2, .9) }} />
      {[0, 1, 2].map(k => (
        <motion.g key={k} initial={{ opacity: reduce ? 1 : 0, x: reduce ? 0 : -8 }} animate={{ opacity: 1, x: 0 }} transition={at(.9 + k * .18)}>
          <rect x={144} y={28 + k * 22} width={76} height={18} rx={6} className="oba-card" />
          <circle cx={155} cy={37 + k * 22} r={4} className="oba-brand" />
          <rect x={164} y={34 + k * 22} width={[44, 34, 48][k]} height={6} rx={3} className="oba-line" />
        </motion.g>
      ))}
    </>
  );
}

function Checklist() {
  const { reduce, at } = useAnim();
  return (
    <>
      {[0, 1, 2].map(k => (
        <motion.g key={k} initial={{ opacity: reduce ? 1 : 0, y: reduce ? 0 : 8 }} animate={{ opacity: 1, y: 0 }} transition={at(.1 + k * .15)}>
          <rect x={52} y={14 + k * 32} width={136} height={26} rx={8} className="oba-card" />
          <circle cx={68} cy={27 + k * 32} r={7} className="oba-brand" />
          <motion.path d={`M64.5 ${27.5 + k * 32} l2.5 2.5 4.5 -5`} fill="none" className="oba-on-brand-stroke"
            strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: 1 }}
            transition={reduce ? { duration: 0 } : { delay: .7 + k * .3, duration: .3 }} />
          <rect x={84} y={24 + k * 32} width={[80, 60, 92][k]} height={6} rx={3} className="oba-line" />
        </motion.g>
      ))}
    </>
  );
}

const SCENES: Record<ArtKind, () => React.JSX.Element> = {
  route: Route, ai: Ai, together: Together, chat: Chat, link: LinkArt, checklist: Checklist,
};

export default function ObArt({ kind }: { kind: ArtKind }) {
  const Scene = SCENES[kind];
  return (
    <svg className="oba" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" focusable="false">
      <Scene />
    </svg>
  );
}
