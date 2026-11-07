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
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';

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
  /** 'first' focuses the first control (unless one has autofocus); 'self' focuses the dialog box. */
  initialFocus?: 'first' | 'self';
  children?: ReactNode;
}

const supportsClosedBy = () =>
  typeof HTMLDialogElement !== 'undefined' && 'closedBy' in HTMLDialogElement.prototype;

export default function Dialog({
  onClose, dismissible = true, className, style, labelledBy, label, initialFocus = 'first', children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissRef = useRef(dismissible);
  dismissRef.current = dismissible;

  // Layout effect: runs before paint on open, and its cleanup runs before
  // React removes the node — so close() still restores focus to the invoker.
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
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
      if (pressedOutside && outside(e) && dismissRef.current) onCloseRef.current();
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

  // `closedby` isn't in React's DOM typings yet; React 19 passes it through.
  const closedBy = { closedby: dismissible ? 'any' : 'none' } as Record<string, string>;

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
