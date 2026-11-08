// v0.37 motion kit (docs/24): small wrappers over Motion with Animate UI's
// tokens, so app code says what moves, not how. Reduced motion comes from the
// ReducedMotionConfig at the root (main.tsx): transforms and layout moves are
// dropped there, fades and blurs stay.
import { useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, animate, motion, type HTMLMotionProps } from 'motion/react';
import {
  blur, scale, shift, spring, transition as tk, useShouldReduceMotion, useTempoTransition,
} from '@animate-ui/react/utils/motion';

/**
 * Steps of a flow (Animate UI "steps" recipe): the leaving step slides
 * shift.step toward the start as it fades into blur.panel (panelOut), then
 * the next comes in from the other side (panelIn). `dir` mirrors it going back.
 */
export function StepSwap({ stepKey, dir = 'fwd', className, children, distance = shift.step }: {
  stepKey: string; dir?: 'fwd' | 'back'; className?: string; children: ReactNode; distance?: number;
}) {
  const out = useTempoTransition(tk.panelOut);
  const inn = useTempoTransition(tk.panelIn);
  // Reduced motion: Motion snaps transforms to their target, so slide nowhere (fade + blur only).
  const reduce = useShouldReduceMotion();
  const sign = reduce ? 0 : dir === 'fwd' ? 1 : -1;
  return (
    <AnimatePresence mode="wait" initial={false} custom={sign}>
      <motion.div key={stepKey} className={className} custom={sign}
        variants={{
          enter: (s: number) => ({ opacity: 0, x: s * distance, filter: blur.panel }),
          shown: { opacity: 1, x: 0, filter: 'blur(0px)', transition: inn, transitionEnd: { filter: 'none' } },
          leave: (s: number) => ({ opacity: 0, x: -s * distance, filter: blur.panel, transition: out }),
        }}
        initial="enter" animate="shown" exit="leave">
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/** Props for a tag/chip in a list: pops in on spring.pop, shrinks out on popOut, neighbours reflow. */
export function usePopItem(): Pick<HTMLMotionProps<'span'>, 'layout' | 'initial' | 'animate' | 'exit' | 'transition'> {
  const pop = useTempoTransition(spring.pop);
  const out = useTempoTransition(tk.popOut);
  const reflow = useTempoTransition(spring.reflow);
  return {
    layout: 'position',
    initial: { opacity: 0, scale: scale.popover },
    animate: { opacity: 1, scale: 1, transition: pop },
    exit: { opacity: 0, scale: scale.popover, transition: out },
    transition: reflow,
  };
}

/** Props for a row/card in a list (Animate UI list recipe): rises 8px and fades in; leaves on fade. */
export function useListItem(): Pick<HTMLMotionProps<'li'>, 'layout' | 'initial' | 'animate' | 'exit' | 'transition'> {
  const move = useTempoTransition(spring.reflow);
  const fade = useTempoTransition(tk.fade);
  return {
    layout: 'position',
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0, transition: { ...move, opacity: fade } },
    exit: { opacity: 0, scale: 0.96, transition: fade },
    transition: move,
  };
}

/**
 * A small count rolling to its value (at once under reduced motion). On
 * spring.progress (90% in ~230ms, no overshoot): spring.number took ~1.5s,
 * too slow for a 1–30 day count.
 */
export function useRollingNumber(to: number, from = 0): number {
  const reduce = useShouldReduceMotion();
  const roll = useTempoTransition(spring.progress);
  const [v, setV] = useState(reduce ? to : from);
  useEffect(() => {
    if (reduce) { setV(to); return; }
    const c = animate(from, to, { ...roll, onUpdate: x => setV(Math.round(x)) });
    return () => c.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [to, reduce]);
  return v;
}

export { AnimatePresence, motion };
