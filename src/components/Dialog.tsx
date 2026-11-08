// Native modal <dialog> primitive shared by Modal, Sheet and the inline
// overlays (FxWidget, Payments, Documents).
//
// showModal() gives us, for free: top-layer rendering, an inert page behind,
// focus containment, Esc + Android back-gesture close requests, and focus
// restored to the invoker on close(). So there is no manual focus trap, no
// role/aria-modal, and no body overflow lock here.
//
// React stays the source of truth: callers mount this only while open, every
// native close request is cancelled and routed to `onClose`, and the parent
// unmounting us is what actually closes the dialog.
//
// v0.37 motion (Animate UI tokens, docs/24): it animates its own entrance and,
// when the caller wraps it in <AnimatePresence>, its exit (usePresence keeps it
// mounted until the box and its backdrop have gone). Centered boxes tip up and
// un-blur on spring.dialog with a quick fade ahead (transition.dialogFade);
// full-screen sheets on phones slide up on transition.sheet; both leave on
// transition.dismiss. The ::backdrop colour fades on transition.overlay (a Web
// Animation on the pseudo-element). Reduced motion: fades only.
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { animate, usePresence } from 'motion/react';
import {
  blur, ease, scale, spring, transition as motionTransition, useShouldReduceMotion, useTempoTransition,
} from '@animate-ui/react/utils/motion';

const FOCUSABLE = 'button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  onClose: () => void;
  /** false = Esc / backdrop click do nothing (e.g. while an upload is running). */
  dismissible?: boolean;
  className?: string;
  style?: CSSProperties;
  /** id of the visible heading that names the dialog. */
  labelledBy?: string;
  /** Accessible name when there is no visible heading. */
  label?: string;
  /** false: Esc/back still close (when dismissible) but a click outside does not. */
  lightDismiss?: boolean;
  /** 'first' focuses the first control (unless one has autofocus); 'self' focuses the dialog box. */
  initialFocus?: 'first' | 'self';
  children?: ReactNode;
}

const supportsClosedBy = () =>
  typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;

export default function Dialog({
  onClose, dismissible = true, lightDismiss = true, className, style, labelledBy, label, initialFocus = 'first', children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissRef = useRef(dismissible);
  dismissRef.current = dismissible;
  const lightRef = useRef(dismissible && lightDismiss);
  lightRef.current = dismissible && lightDismiss;

  const [isPresent, safeToRemove] = usePresence();
  const reduce = useShouldReduceMotion();
  const tip = useTempoTransition(spring.dialog);
  const fade = useTempoTransition(motionTransition.dialogFade);
  const sheetIn = useTempoTransition(motionTransition.sheet);
  const overlay = useTempoTransition(motionTransition.overlay);
  const dismiss = useTempoTransition(motionTransition.dismiss);
  const tokens = useRef({ reduce, tip, fade, sheetIn, overlay, dismiss });
  tokens.current = { reduce, tip, fade, sheetIn, overlay, dismiss };
  // The backdrop's resting colour, read once it's in the top layer.
  const backdropColor = useRef('');

  // Layout effect: runs before paint on open, and its cleanup runs before
  // React removes the node — so close() still restores focus to the invoker.
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    playEnter(d);
    if (initialFocus === 'self') d.focus();
    else if (!d.querySelector('[autofocus]')) d.querySelector<HTMLElement>(FOCUSABLE)?.focus();

    // Esc, back gesture and (with closedby="any") backdrop clicks all arrive
    // as `cancel`. Keep the dialog open and let the parent decide.
    const onCancel = (e: Event) => {
      e.preventDefault();
      if (dismissRef.current) onCloseRef.current();
    };
    // Repeated Esc without user activation can't be cancelled — keep React in sync.
    const onNativeClose = () => onCloseRef.current();
    d.addEventListener('cancel', onCancel);
    d.addEventListener('close', onNativeClose);

    // Light-dismiss fallback where `closedby` is missing (Safari). Test the
    // pointer position, not just the target: the dialog is also the target
    // for its own padding. Require press AND release outside so a text
    // selection drag that ends on the backdrop doesn't dismiss.
    let pressedOutside = false;
    const outside = (e: PointerEvent) => {
      if (e.target !== d) return false;
      const r = d.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    const onDown = (e: PointerEvent) => { pressedOutside = outside(e); };
    const onUp = (e: PointerEvent) => {
      if (pressedOutside && outside(e) && lightRef.current) onCloseRef.current();
      pressedOutside = false;
    };
    const fallback = !supportsClosedBy();
    if (fallback) {
      d.addEventListener('pointerdown', onDown);
      d.addEventListener('pointerup', onUp);
    }

    return () => {
      d.removeEventListener('cancel', onCancel);
      d.removeEventListener('close', onNativeClose);
      if (fallback) {
        d.removeEventListener('pointerdown', onDown);
        d.removeEventListener('pointerup', onUp);
      }
      if (d.open) d.close();
    };
    // initialFocus is a mount-time choice only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Phone sheets (full-screen .ui-sheet below the desktop breakpoint) slide; everything else tips up. */
  function isEdgeSheet(d: HTMLDialogElement) {
    return (d.classList.contains('ui-sheet') || d.classList.contains('sheet')) && !matchMedia('(min-width: 1024px)').matches;
  }

  function playEnter(d: HTMLDialogElement) {
    const { reduce, tip, fade, sheetIn, overlay } = tokens.current;
    backdropColor.current = getComputedStyle(d, '::backdrop').backgroundColor;
    fadeBackdrop(d, 'in', overlay.duration as number);
    if (reduce) { animate(d, { opacity: [0, 1] }, fade); return; }
    if (isEdgeSheet(d)) {
      animate(d, { opacity: [0, 1], transform: ['translateY(100%)', 'translateY(0%)'] }, sheetIn);
      return;
    }
    // Drop the blur at rest: a filter would make the box the containing block of its fixed children.
    animate(d, {
      opacity: [0, 1], filter: [blur.surface, 'blur(0px)'],
      transformPerspective: 500, rotateX: [-20, 0], scale: [scale.dialog, 1],
    }, { ...tip, opacity: fade }).then(() => {
      // At rest no filter or transform: either would make the box the containing block of its fixed children.
      if (tokens.current && d.isConnected) { d.style.filter = ''; d.style.transform = ''; }
    });
  }

  async function playExit(d: HTMLDialogElement) {
    const { reduce, dismiss, overlay } = tokens.current;
    d.style.pointerEvents = 'none';
    const box = reduce
      ? animate(d, { opacity: 0 }, dismiss)
      : isEdgeSheet(d)
        ? animate(d, { opacity: 0, transform: 'translateY(100%)' }, dismiss)
        : animate(d, { opacity: 0, filter: blur.surface, transformPerspective: 500, rotateX: -20, scale: scale.dialog }, dismiss);
    // Whatever unmounts the modal waits for the overlay to be clear.
    await Promise.all([box, fadeBackdrop(d, 'out', overlay.duration as number)]);
  }

  /** ::backdrop colour from/to transparent (its opacity would fade the box with it). */
  function fadeBackdrop(d: HTMLDialogElement, dir: 'in' | 'out', seconds: number): Promise<unknown> {
    const to = backdropColor.current;
    if (!to || typeof d.animate !== 'function') return Promise.resolve();
    try {
      const a = d.animate(
        { backgroundColor: dir === 'in' ? ['transparent', to] : [to, 'transparent'] },
        { duration: seconds * 1000, easing: `cubic-bezier(${ease.soft.join(', ')})`, pseudoElement: '::backdrop', fill: 'forwards' },
      );
      return a.finished.catch(() => {});
    } catch { return Promise.resolve(); } // no pseudo-element animations: the backdrop just appears
  }

  // Exit under <AnimatePresence>: play it, then let React unmount us.
  useLayoutEffect(() => {
    if (isPresent || !ref.current) return;
    let live = true;
    playExit(ref.current).finally(() => { if (live) safeToRemove?.(); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresent]);

  // `closedby` isn't in React's DOM typings yet; React 19 passes it through.
  const closedBy = { closedby: !dismissible ? 'none' : lightDismiss ? 'any' : 'closerequest' } as Record<string, string>;

  return (
    <dialog
      ref={ref}
      className={className}
      style={style}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      tabIndex={initialFocus === 'self' ? -1 : undefined}
      {...closedBy}
    >
      {children}
    </dialog>
  );
}
