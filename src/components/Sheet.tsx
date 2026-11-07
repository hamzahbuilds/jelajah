// Jelajah UI refresh — bottom sheet on mobile, centered dialog >=1024px (ported
// from prototype .sheetwrap/.sheet; CSS media query handles the breakpoint).
// Native modal <dialog> underneath (see Dialog.tsx). Focus lands on the sheet
// itself rather than its first row, so opening it never looks like a selection.
import Dialog from './Dialog';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children?: React.ReactNode;
}

export default function Sheet({ open, onClose, title, children }: SheetProps) {
  if (!open) return null;

  return (
    <Dialog onClose={onClose} className="sheet" label={title} initialFocus="self">
      <div className="grab" />
      {title && <h4>{title}</h4>}
      {children}
    </Dialog>
  );
}
