// Jelajah UI refresh — centered modal dialog (ported from prototype .jmwrap/.jmodal).
// Built on the native <dialog> (see Dialog.tsx): the browser handles the
// backdrop, inert page, focus containment, Esc/back-gesture and focus return.
// The top layer also replaces the old createPortal + z-index escape hatch.
import { useId } from 'react';
import { Icon, type IconName } from './Icon';
import Dialog from './Dialog';

export interface ModalProps {
  /** Extra class on the dialog box (e.g. "expanded-map-dialog"). */
  className?: string;
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

export default function Modal({ open, onClose, icon, title, sub, children, footer, closeLabel = 'Close', className = '' }: ModalProps) {
  const titleId = useId();
  if (!open) return null;

  return (
    <Dialog onClose={onClose} className={`modalwrap modal ${className}`.trim()} labelledBy={titleId}>
      <div className="mhead">
        {icon && <span className="tile sm"><Icon name={icon} /></span>}
        <div><h3 id={titleId}>{title}</h3>{sub && <p>{sub}</p>}</div>
        <button type="button" className="x" onClick={onClose} aria-label={closeLabel}>
          <Icon name="x" />
        </button>
      </div>
      {children}
      {footer && <div className="mfoot">{footer}</div>}
    </Dialog>
  );
}
