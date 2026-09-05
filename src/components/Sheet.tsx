// Jelajah UI refresh — bottom sheet on mobile, centered dialog >=1024px (ported
// from prototype .sheetwrap/.sheet; CSS media query handles the breakpoint).
import { useEffect, useRef } from 'react';
import { lockScroll, unlockScroll } from './uiHelpers';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: React.ReactNode;
}

export default function Sheet({ open, onClose, title, children }: SheetProps) {
  const prevFocus = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    prevFocus.current = document.activeElement as HTMLElement | null;
    lockScroll();
    // No full tab trap (unlike Modal) — just take focus so keyboard/AT users
    // land on the sheet instead of tabbing straight through to the page
    // behind the scrim (final-review F13).
    panelRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      unlockScroll();
      prevFocus.current?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="sheetwrap open">
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={panelRef} tabIndex={-1}>
        <div className="grab" />
        {title && <h4>{title}</h4>}
        {children}
      </div>
    </div>
  );
}
