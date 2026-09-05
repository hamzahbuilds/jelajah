// Jelajah UI refresh — floating action menu (ported from prototype .jmenu / jlMenu).
// Fixed-position, viewport-clamped, closes on outside click or Escape.
import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { clampMenu } from './uiHelpers';

export interface MenuItem {
  icon: IconName;
  label: string;
  sub?: string;
  onPick: () => void;
  danger?: boolean;
}

export interface MenuProps {
  open: boolean;
  anchor: HTMLElement | null;
  items: (MenuItem | '-')[];
  onClose: () => void;
}

export default function Menu({ open, anchor, items, onClose }: MenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open || !anchor) { setPos(null); return; }
    const menu = menuRef.current;
    const w = menu?.offsetWidth ?? 230;
    const h = menu?.offsetHeight ?? 0;
    setPos(clampMenu(anchor.getBoundingClientRect(), { w, h }, { w: innerWidth, h: innerHeight }));
  }, [open, anchor, items]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && e.target !== anchor) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    // deferred so the click that opened the menu doesn't immediately close it
    const t = setTimeout(() => document.addEventListener('click', onClick));
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      clearTimeout(t);
      document.removeEventListener('click', onClick);
    };
  }, [open, anchor, onClose]);

  if (!open || !anchor) return null;

  return (
    <div
      className="menu"
      ref={menuRef}
      role="menu"
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
    >
      {items.map((it, i) =>
        it === '-' ? (
          <div className="sep" key={i} role="separator" />
        ) : (
          <button
            key={i}
            className={'mi' + (it.danger ? ' danger' : '')}
            role="menuitem"
            onClick={() => { onClose(); it.onPick(); }}
          >
            <Icon name={it.icon} className="i" />
            <span><b>{it.label}</b>{it.sub && <small>{it.sub}</small>}</span>
          </button>
        )
      )}
    </div>
  );
}
