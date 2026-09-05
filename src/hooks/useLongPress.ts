// Jelajah UI refresh — long-press machine for the mobile tab bar (T7).
// `createLongPress` is a pure, React-free core (vitest imports it directly,
// no DOM/timers besides the standard setTimeout) so its state transitions
// are trivially unit-testable. `useLongPress` wraps it with pointer-event
// handlers for a React component.
import { useMemo, useRef } from 'react';

export interface LongPressMachine {
  down(): void;
  up(): void;
  leave(): void;
  cancel(): void;
  shouldSuppressClick(): boolean;
}

/** Pure long-press state machine: no React, no JSX — just timers + flags. */
export function createLongPress(onLong: () => void, ms: number): LongPressMachine {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;

  const clear = () => {
    if (timer != null) { clearTimeout(timer); timer = null; }
  };

  return {
    down() {
      fired = false;
      clear();
      timer = setTimeout(() => { fired = true; timer = null; onLong(); }, ms);
    },
    up() {
      clear();
      // `fired` must survive long enough for the click event that follows this
      // pointerup (same interaction, dispatched right after) to see it and
      // suppress itself — but it must not survive past that, or a later
      // keyboard Enter (no pointerdown/up around it) gets wrongly suppressed
      // too (final-review F14). Defer the reset one tick past this decision.
      setTimeout(() => { fired = false; }, 0);
    },
    leave() {
      fired = false;
      clear();
    },
    cancel() {
      fired = false;
      clear();
    },
    shouldSuppressClick() {
      return fired;
    },
  };
}

export interface LongPressHandlers {
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onClick: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

export function useLongPress(onLong: () => void, ms = 450): LongPressHandlers {
  const onLongRef = useRef(onLong);
  onLongRef.current = onLong;

  const machine = useMemo(
    () => createLongPress(() => onLongRef.current(), ms),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ms],
  );

  return {
    onPointerDown: () => machine.down(),
    onPointerUp: () => machine.up(),
    onPointerLeave: () => machine.leave(),
    onPointerCancel: () => machine.cancel(),
    onClick: (e: React.MouseEvent) => {
      if (machine.shouldSuppressClick()) e.preventDefault();
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
    },
  };
}
