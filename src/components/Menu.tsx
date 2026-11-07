// Jelajah UI refresh — floating action menu (ported from prototype .jmenu / jlMenu).
// popover="auto": top layer, native light dismiss (outside click, Esc) and
// focus return. Positioned with CSS anchor positioning where supported
// (showPopover({ source }) sets the implicit anchor); otherwise the
// viewport-clamped fixed coordinates from clampMenu().
// Keyboard: opened from the keyboard → first item focused; ArrowUp/Down,
// Home/End move between items; Tab closes.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
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

const hasPopover = () => typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;
const hasAnchorPos = () => typeof CSS !== 'undefined' && CSS.supports?.('position-area', 'block-end');

export default function Menu({ open, anchor, items, onClose }: MenuProps) {
  if (!open || !anchor) return null;
  return <MenuPanel anchor={anchor} items={items} onClose={onClose} />;
}

function MenuPanel({ anchor, items, onClose }: Omit<MenuProps, 'open'> & { anchor: HTMLElement }) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const anchored = hasPopover() && hasAnchorPos();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;

    if (hasPopover()) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (menu as any).showPopover({ source: anchor }); // `source` not in TS DOM typings yet
      } catch {
        menu.showPopover(); // older engines reject the options bag
      }
    }
    if (!anchored) {
      setPos(clampMenu(anchor.getBoundingClientRect(), { w: menu.offsetWidth || 230, h: menu.offsetHeight }, { w: innerWidth, h: innerHeight }));
    }
    // Keyboard open (trigger shows a focus ring) → enter the menu. Pointer open → focus stays put.
    if (anchor.matches(':focus-visible')) menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();

    // Light dismiss / Esc → tell the parent.
    let pressedAnchor = false;
    const onDown = (e: PointerEvent) => { pressedAnchor = anchor.contains(e.target as Node); };
    const onToggle = (e: Event) => {
      if ((e as ToggleEvent).newState !== 'closed') return;
      // The press that light-dismissed us was on the trigger: swallow the
      // click that follows, or a toggling trigger would reopen the menu.
      if (pressedAnchor) {
        const swallow = (ev: MouseEvent) => {
          if (anchor.contains(ev.target as Node)) { ev.stopPropagation(); ev.preventDefault(); }
        };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 400);
      }
      onCloseRef.current();
    };
    document.addEventListener('pointerdown', onDown, true);
    menu.addEventListener('toggle', onToggle);

    // No popover support: the old manual outside-click + Esc handling.
    let cleanupLegacy = () => {};
    if (!hasPopover()) {
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
      const onClick = (e: MouseEvent) => {
        if (!menu.contains(e.target as Node) && !anchor.contains(e.target as Node)) onCloseRef.current();
      };
      document.addEventListener('keydown', onKey);
      const t = setTimeout(() => document.addEventListener('click', onClick));
      cleanupLegacy = () => { document.removeEventListener('keydown', onKey); clearTimeout(t); document.removeEventListener('click', onClick); };
    }

    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      menu.removeEventListener('toggle', onToggle);
      cleanupLegacy();
      if (hasPopover() && menu.matches(':popover-open')) menu.hidePopover();
    };
  }, [anchor, anchored]);

  // Re-clamp if the item list changes size while open (fallback positioning only).
  useEffect(() => {
    const menu = menuRef.current;
    if (anchored || !menu) return;
    setPos(clampMenu(anchor.getBoundingClientRect(), { w: menu.offsetWidth || 230, h: menu.offsetHeight }, { w: innerWidth, h: innerHeight }));
  }, [items, anchor, anchored]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const els = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (!els.length) return;
    const i = els.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = i < 0 || i === els.length - 1 ? 0 : i + 1;
    else if (e.key === 'ArrowUp') next = i <= 0 ? els.length - 1 : i - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = els.length - 1;
    else if (e.key === 'Tab') { onCloseRef.current(); return; }
    if (next < 0) return;
    e.preventDefault();
    els[next].focus();
  };

  const style: React.CSSProperties | undefined = anchored
    ? undefined
    : pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 };

  return (
    <div
      className={'menu' + (anchored ? ' anchored' : '')}
      ref={menuRef}
      role="menu"
      popover="auto"
      style={style}
      onKeyDown={onKeyDown}
    >
      {items.map((it, i) =>
        it === '-' ? (
          <div className="sep" key={i} role="separator" />
        ) : (
          <button
            key={i}
            type="button"
            className={'mi' + (it.danger ? ' danger' : '')}
            role="menuitem"
            tabIndex={items.findIndex(x => x !== '-') === i ? 0 : -1}
            onClick={() => { onCloseRef.current(); it.onPick(); }}
          >
            <Icon name={it.icon} className="i" />
            <span><b>{it.label}</b>{it.sub && <small>{it.sub}</small>}</span>
          </button>
        )
      )}
    </div>
  );
}
