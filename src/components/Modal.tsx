// Jelajah UI refresh — centered modal dialog (ported from prototype .jmwrap/.jmodal).
// Scrim + Escape close, focus trapped inside while open, focus restored to the
// invoking element on close, body scroll locked while open.
import { useEffect, useRef } from 'react';
import { Icon, type IconName } from './Icon';
import { nextFocusIndex, lockScroll, unlockScroll } from './uiHelpers';

const FOCUSABLE = 'button,[href],input,select,textarea';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  icon?: IconName;
  title: string;
  sub?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** Accessible label for the close (X) button. Modal has no i18n of its own — pass `t.close` from callers. */
  closeLabel?: string;
}

export default function Modal({ open, onClose, icon, title, sub, children, footer, closeLabel = 'Close' }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    prevFocus.current = document.activeElement as HTMLElement | null;
    lockScroll();

    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const current = items.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      const next = nextFocusIndex(items.length, current < 0 ? 0 : current, e.shiftKey);
      items[next]?.focus();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      unlockScroll();
      prevFocus.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="modalwrap open">
      <div className="scrim" onClick={onClose} />
      <div className="modal" ref={dialogRef} role="dialog" aria-modal="true" aria-label={title}>
        <div className="mhead">
          {icon && <span className="tile sm"><Icon name={icon} /></span>}
          <div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
          <button className="x" onClick={onClose} aria-label={closeLabel}>
            <Icon name="plus" className="x-close" />
          </button>
        </div>
        {children}
        {footer && <div className="mfoot">{footer}</div>}
      </div>
    </div>
  );
}
