// v0.12 global toast system — every add/save/delete confirms itself.
// success: trip-accent check, auto-dismiss; error: red, stays until tapped.
// v0.19: pill restyle (.toast, ported from prototype .jtoast) — API/logic unchanged.
// The stack is a popover="manual" so it renders in the top layer: modal
// <dialog>s live there too, and a z-indexed div would sit behind them. Manual
// popovers have no light dismiss, so clicking elsewhere never hides a toast.
//
// v0.37 motion (Animate UI toast recipe): each toast rises its own height from
// the bottom edge, grows from scale.toast out of blur.surface on spring.toast;
// the others make room (layout="position"); it leaves in place on
// transition.dismiss. The stack stays shown until the last exit has played.
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ReducedMotionConfig, blur, scale, spring, transition as motionTransition, useTempoTransition,
} from '@animate-ui/react/utils/motion';
import { Icon } from './Icon';

export interface ToastMsg { id: number; text: string; kind: 'ok' | 'error' }

const ToastCtx = createContext<{ toast: (text: string, kind?: 'ok' | 'error') => void }>({ toast: () => {} });
export const useToast = () => useContext(ToastCtx);

const hasPopover = () => typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [list, setList] = useState<ToastMsg[]>([]);
  const [announce, setAnnounce] = useState('');
  const nextId = useRef(1);
  const stackRef = useRef<HTMLDivElement>(null);
  const lastId = list.length ? list[list.length - 1].id : 0;

  // Exits are played by AnimatePresence; the stack hides once they're done.
  const [exiting, setExiting] = useState(false);
  const dismiss = useCallback((id: number) => {
    setExiting(true);
    setList(prev => prev.filter(m => m.id !== id));
  }, []);
  const enter = useTempoTransition(spring.toast);
  const leave = useTempoTransition(motionTransition.dismiss);

  const toast = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = nextId.current++;
    setList(prev => [...prev.slice(-3), { id, text, kind }]);
    setAnnounce(text);
    if (kind === 'ok') setTimeout(() => dismiss(id), 2600);
  }, [dismiss]);

  // Show while non-empty. On every new toast, hide + re-show so the stack is
  // re-appended to the top of the top layer, above any dialog opened since.
  useLayoutEffect(() => {
    const el = stackRef.current;
    if (!el || !hasPopover()) return;
    const isOpen = el.matches(':popover-open');
    if (list.length === 0) { if (isOpen && !exiting) el.hidePopover(); return; }
    if (isOpen) el.hidePopover();
    el.showPopover();
  }, [lastId, list.length === 0, exiting]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      {/* Live region stays outside the popover: toggling the popover's display would swallow announcements. */}
      <div className="sr-only" role="status" aria-live="polite">{announce}</div>
      <div className="toasts" popover="manual" ref={stackRef}>
        <ReducedMotionConfig>
          <AnimatePresence initial={false} onExitComplete={() => setExiting(false)}>
            {list.map(m => (
              <motion.div key={m.id} className={`toast ${m.kind}`} onClick={() => dismiss(m.id)}
                layout="position"
                initial={{ opacity: 0, y: '100%', scale: scale.toast, filter: blur.surface }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: enter }}
                exit={{ opacity: 0, scale: scale.toast, filter: blur.surface, transition: leave }}
                transition={enter}>
                {m.kind === 'ok' ? <Icon name="check" className="i" size={16} /> : <Icon name="alert" className="i" size={16} />}
                {m.text}
              </motion.div>
            ))}
          </AnimatePresence>
        </ReducedMotionConfig>
      </div>
    </ToastCtx.Provider>
  );
}
