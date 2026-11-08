// Airline-style start + end date picker in one calendar (docs/18 §4.1).
//
// Tap 1 = start, tap 2 = end; a tap before the start restarts from there; a
// tap after a complete range starts a new one. Desktop (>=1024px): anchored
// popover with two months side by side. Phones: full-screen native <dialog>
// with months scrolling vertically and a sticky Done bar.
//
// Dates are plain 'YYYY-MM-DD' strings via shared/plainDate — never Date
// objects — so nothing can drift across a time zone.
//
// Keyboard: one Tab stop into the calendar (roving tabindex). Arrows move by
// day/week, PageUp/PageDown by month, Home/End to the week's ends. The move is
// computed by date arithmetic rather than DOM geometry because it has to cross
// month grids that may not be rendered yet; keys we don't handle keep their
// default (page scroll).
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../components/Icon';
import Dialog from '../components/Dialog';
import { useT } from '../i18n';
import {
  addDays, addMonths, compare, firstOfMonth, formatYmd, isYmd, monthGrid, nightsBetween,
  todayYmd, tripDays, weekdayMon0, type Ymd,
} from '../../shared/plainDate';

export interface DateRangePickerProps {
  label: string;
  /** 'trip' counts days inclusive and allows a one-day range; 'stay' counts nights and needs >= 1. */
  mode: 'trip' | 'stay';
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  required?: boolean;
  /** Shaded band (e.g. the trip's dates when picking a hotel stay). */
  highlight?: { start: string; end: string } | null;
  min?: string;
  max?: string;
  /** Form field names for hidden inputs so a surrounding <form> submits the values. */
  names?: [string, string];
  hint?: string;
  error?: string;
}

const DESKTOP = '(min-width: 1024px)';
const hasPopover = () => typeof HTMLElement !== 'undefined' && 'popover' in HTMLElement.prototype;
const hasAnchorPos = () => typeof CSS !== 'undefined' && CSS.supports?.('position-area', 'block-end');

export function DateRangePicker(p: DateRangePickerProps) {
  const { t, lang } = useT();
  const locale = lang === 'ms' ? 'ms-MY' : 'en-MY';
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [desktop, setDesktop] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(DESKTOP).matches);
  useEffect(() => {
    const mq = matchMedia(DESKTOP);
    const on = () => setDesktop(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const s = isYmd(p.start) ? p.start : '';
  const e = isYmd(p.end) ? p.end : '';
  const count = s && e ? (p.mode === 'stay' ? t.nNights(nightsBetween(s, e)) : t.nDays(tripDays(s, e))) : '';
  const fmt = (d: string) => formatYmd(d, locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const summary = s ? `${fmt(s)} → ${e ? fmt(e) : '…'}${count ? ` · ${count}` : ''}` : '';
  const hintId = p.hint ? `${id}-hint` : undefined;
  const errId = p.error ? `${id}-err` : undefined;

  return (
    <div className={'ui-field ui-drp' + (p.error ? ' has-error' : '')}>
      <span className="ui-field-label" id={`${id}-lbl`}>
        {p.label}{p.required && <span className="ui-req" aria-hidden="true"> *</span>}
      </span>
      {p.hint && <span className="ui-field-hint" id={hintId}>{p.hint}</span>}
      <button
        ref={triggerRef}
        type="button"
        className="ui-drp-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${id}-lbl ${id}-val`}
        aria-describedby={[hintId, errId].filter(Boolean).join(' ') || undefined}
        aria-invalid={p.error ? true : undefined}
        onClick={() => setOpen(o => !o)}
      >
        <Icon name="calendar" size={20} />
        <span id={`${id}-val`} className={summary ? '' : 'placeholder'}>{summary || t.addDates}</span>
      </button>
      {p.names && <>
        <input type="hidden" name={p.names[0]} value={s} />
        <input type="hidden" name={p.names[1]} value={e} />
      </>}
      {p.error && <span className="ui-field-error" id={errId}><Icon name="alert" size={16} /> {p.error}</span>}
      {open && (desktop
        ? <DesktopPanel {...p} anchor={triggerRef.current} onDone={(a, b) => { p.onChange(a, b); setOpen(false); }} onCancel={() => setOpen(false)} />
        : <Dialog onClose={() => setOpen(false)} className="ui-sheet ui-drp-sheet" label={p.label} initialFocus="self">
            <RangeCalendar {...p} months="scroll" onDone={(a, b) => { p.onChange(a, b); setOpen(false); }} onCancel={() => setOpen(false)} />
          </Dialog>)}
    </div>
  );
}

function DesktopPanel(p: DateRangePickerProps & { anchor: HTMLElement | null; onDone: (a: string, b: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(p.onCancel);
  cancelRef.current = p.onCancel;
  const anchored = hasPopover() && hasAnchorPos();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !p.anchor) return;
    if (hasPopover()) {
      try { (el as any).showPopover({ source: p.anchor }); } catch { el.showPopover(); }
    }
    if (!anchored) {
      const r = p.anchor.getBoundingClientRect();
      const w = el.offsetWidth, h = el.offsetHeight;
      // No anchor positioning: open on the side with more room; CSS caps the height.
      const below = innerHeight - r.bottom, above = r.top;
      setPos({
        top: below >= h + 18 || below >= above ? r.bottom + 6 : Math.max(12, r.top - 6 - Math.min(h, above - 18)),
        left: Math.max(12, Math.min(r.left, innerWidth - w - 12)),
      });
    }
    // Light dismiss / Esc close the popover natively — treat as cancel. A
    // press on the trigger itself must not reopen it via the trigger's click.
    let pressedAnchor = false;
    const onDown = (ev: PointerEvent) => { pressedAnchor = !!p.anchor?.contains(ev.target as Node); };
    const onToggle = (ev: Event) => {
      if ((ev as ToggleEvent).newState !== 'closed') return;
      if (pressedAnchor) {
        const swallow = (c: MouseEvent) => { if (p.anchor?.contains(c.target as Node)) { c.stopPropagation(); c.preventDefault(); } };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 400);
      }
      cancelRef.current();
    };
    document.addEventListener('pointerdown', onDown, true);
    el.addEventListener('toggle', onToggle);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('toggle', onToggle);
      if (hasPopover() && el.matches(':popover-open')) el.hidePopover();
    };
  }, [p.anchor, anchored]);

  return (
    <div
      ref={ref}
      popover="auto"
      role="dialog"
      aria-label={p.label}
      className={'ui-drp-pop' + (anchored ? ' anchored' : '')}
      style={anchored ? undefined : pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
    >
      <RangeCalendar {...p} months="pair" />
    </div>
  );
}

function RangeCalendar(p: DateRangePickerProps & { months: 'pair' | 'scroll'; onDone: (a: string, b: string) => void; onCancel: () => void }) {
  const { t, lang } = useT();
  const locale = lang === 'ms' ? 'ms-MY' : 'en-MY';
  const today = todayYmd();
  const [ds, setDs] = useState<string>(isYmd(p.start) ? p.start : '');
  const [de, setDe] = useState<string>(isYmd(p.end) ? p.end : '');
  const [hover, setHover] = useState<string>('');
  const [hint, setHint] = useState('');
  const initial = ds || (p.highlight && isYmd(p.highlight.start) ? p.highlight.start : '') || today;
  const [view, setView] = useState<Ymd>(firstOfMonth(initial));
  const [focusDay, setFocusDay] = useState<Ymd>(initial);
  const gridRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);

  const disabled = (d: Ymd) => (!!p.min && isYmd(p.min) && compare(d, p.min) < 0) || (!!p.max && isYmd(p.max) && compare(d, p.max) > 0);

  const monthsShown = useMemo<Ymd[]>(() => {
    if (p.months === 'pair') return [view, addMonths(view, 1)];
    // Phones: a scrolling year around the initial month.
    const startM = addMonths(firstOfMonth(initial), -2);
    return Array.from({ length: 15 }, (_, i) => addMonths(startM, i));
  }, [p.months, view, initial]);

  const pick = (d: Ymd) => {
    setHint('');
    if (!ds || de) { setDs(d); setDe(''); return; }
    const c = compare(d, ds);
    if (c < 0) { setDs(d); return; }
    if (c === 0) {
      if (p.mode === 'trip') setDe(d);
      else setHint(t.checkoutAfterCheckin);
      return;
    }
    setDe(d);
  };

  // Keep the focused day rendered (desktop pair view) and focused after a key
  // move. Runs on focus-day changes only: the month buttons move view and focus
  // day together, and re-checking on a view change would snap the view back to
  // a stale focus day (the Next button visibly "jittered").
  useEffect(() => {
    if (p.months === 'pair') {
      setView(v => compare(focusDay, v) < 0 ? firstOfMonth(focusDay)
        : compare(focusDay, addMonths(v, 2)) >= 0 ? addMonths(firstOfMonth(focusDay), -1) : v);
    }
    if (!moved.current) return;
    moved.current = false;
    requestAnimationFrame(() => {
      const b = gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`);
      b?.focus();
      b?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }, [focusDay, p.months]);

  // Phones: start scrolled to the initial month. Wait a frame: this runs before
  // the parent Dialog's layout effect calls showModal(), and a closed <dialog>
  // has no layout to scroll. Set scrollTop directly so only the month list moves.
  useLayoutEffect(() => {
    if (p.months !== 'scroll') return;
    const raf = requestAnimationFrame(() => {
      const list = gridRef.current;
      const m = list?.querySelector<HTMLElement>(`[data-month="${firstOfMonth(initial)}"]`);
      if (list && m) list.scrollTop = m.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Month buttons: shift the view and the roving focus day together. */
  const page = (n: number) => { setView(v => addMonths(v, n)); setFocusDay(f => addMonths(f, n)); };

  const onKey = (ev: React.KeyboardEvent) => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const k = ev.key;
    let next: Ymd | null = null;
    if (k === 'ArrowRight') next = addDays(focusDay, 1);
    else if (k === 'ArrowLeft') next = addDays(focusDay, -1);
    else if (k === 'ArrowDown') next = addDays(focusDay, 7);
    else if (k === 'ArrowUp') next = addDays(focusDay, -7);
    else if (k === 'PageDown') next = addMonths(focusDay, ev.shiftKey ? 12 : 1);
    else if (k === 'PageUp') next = addMonths(focusDay, ev.shiftKey ? -12 : -1);
    else if (k === 'Home') next = addDays(focusDay, -weekdayMon0(focusDay));
    else if (k === 'End') next = addDays(focusDay, 6 - weekdayMon0(focusDay));
    if (!next) return;
    if (p.months === 'scroll' && !monthsShown.some(m => m === firstOfMonth(next!))) return; // outside the rendered year: let it scroll
    ev.preventDefault();
    // Move focus now if the day is rendered, so an immediate Enter/Space acts on
    // it; otherwise (another month in the desktop pair) the effect focuses it
    // after the view shifts.
    const btn = gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`);
    if (btn) {
      btn.tabIndex = 0;
      btn.focus();
      btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else {
      moved.current = true;
    }
    setFocusDay(next);
    if (ds && !de) setHover(next);
  };

  const fmtLong = (d: Ymd) => formatYmd(d, locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const fmtShort = (d: Ymd) => formatYmd(d, locale, { day: 'numeric', month: 'short' });
  const startWord = p.mode === 'stay' ? t.checkIn : t.startDate;
  const endWord = p.mode === 'stay' ? t.checkOut : t.endDate;
  const count = ds && de ? (p.mode === 'stay' ? t.nNights(nightsBetween(ds, de)) : t.nDays(tripDays(ds, de))) : '';
  const status = !ds ? (p.mode === 'stay' ? t.selectCheckIn : t.selectStart)
    : !de ? (p.mode === 'stay' ? t.selectCheckOut : t.selectEnd)
    : `${fmtShort(ds)} – ${fmtShort(de)} · ${count}`;
  const announce = hint || (!ds ? '' : !de ? `${startWord} ${fmtLong(ds)}. ${status}.` : `${startWord} ${fmtLong(ds)}, ${endWord} ${fmtLong(de)}, ${count}.`);

  const previewEnd = ds && !de && hover && compare(hover, ds) > 0 ? hover : '';
  const rangeEnd = de || previewEnd;
  const hl = p.highlight && isYmd(p.highlight.start) && isYmd(p.highlight.end) ? p.highlight : null;
  const weekdays = useMemo(() => Array.from({ length: 7 }, (_, i) =>
    formatYmd(addDays('2026-11-30', i), locale, { weekday: 'narrow' })), [locale]); // 2026-11-30 is a Monday

  return (
    <div className={'ui-cal ' + p.months}>
      <div className="ui-cal-status">
        <span className="ui-cal-status-text">{status}</span>
        {p.months === 'pair' && (
          <span className="ui-cal-nav">
            <button type="button" className="ui-iconbtn" aria-label={t.prevMonth} onClick={() => page(-1)}><Icon name="chev-l" size={20} /></button>
            <button type="button" className="ui-iconbtn" aria-label={t.nextMonth} onClick={() => page(1)}><Icon name="chev-r" size={20} /></button>
          </span>
        )}
      </div>
      {p.months === 'scroll' && (
        <div className="ui-cal-dow sticky" aria-hidden="true">{weekdays.map((w, i) => <span key={i}>{w}</span>)}</div>
      )}
      <div className="ui-cal-months" ref={gridRef} onKeyDown={onKey} onPointerLeave={() => setHover('')}>
        {monthsShown.map(m => {
          const cells = monthGrid(m);
          // Desktop pair: always 6 week rows, so the panel keeps its height when
          // paging months — otherwise a panel opened above the field shifts and
          // the Next button jumps out from under the pointer.
          if (p.months === 'pair') while (cells.length < 42) cells.push(null);
          const headId = `m-${m}`;
          return (
            <div className="ui-cal-month" key={m} data-month={m}>
              <h3 className="ui-cal-mtitle" id={headId}>{formatYmd(m, locale, { month: 'long', year: 'numeric' })}</h3>
              {p.months === 'pair' && <div className="ui-cal-dow" aria-hidden="true">{weekdays.map((w, i) => <span key={i}>{w}</span>)}</div>}
              <div role="grid" aria-labelledby={headId} className="ui-cal-grid">
                {Array.from({ length: cells.length / 7 }, (_, r) => (
                  <div role="row" key={r} className="ui-cal-row">
                    {cells.slice(r * 7, r * 7 + 7).map((d, c) => {
                      if (!d) return <div role="gridcell" key={c} className="ui-cal-cell ui-cal-blank" />;
                      const isS = d === ds, isE = d === de;
                      const inR = !!(ds && rangeEnd && compare(d, ds) > 0 && compare(d, rangeEnd) < 0);
                      const inHl = !!(hl && compare(d, hl.start) >= 0 && compare(d, hl.end) <= 0);
                      const dis = disabled(d);
                      const cls = ['ui-cal-cell',
                        inR && 'in', isS && 'start', (isE || (d === previewEnd)) && 'end',
                        ds && rangeEnd && isS && 'has-range', inHl && 'trip', d === today && 'today', dis && 'dis',
                        c === 0 && 'col0', c === 6 && 'col6'].filter(Boolean).join(' ');
                      const role = isS ? `, ${startWord}` : isE ? `, ${endWord}` : inR ? `, ${t.inSelectedRange}` : '';
                      return (
                        <div role="gridcell" key={c} className={cls} aria-selected={isS || isE || inR || undefined}>
                          <button
                            type="button"
                            data-day={d}
                            tabIndex={d === focusDay ? 0 : -1}
                            aria-label={fmtLong(d) + role}
                            aria-pressed={isS || isE}
                            aria-disabled={dis || undefined}
                            onClick={() => { if (!dis) { setFocusDay(d); pick(d); } }}
                            onPointerEnter={() => { if (ds && !de) setHover(d); }}
                          >
                            {+d.slice(8)}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="ui-cal-foot">
        {hint ? <span className="ui-cal-hint"><Icon name="info" size={16} /> {hint}</span>
          : <span className="ui-cal-count">{count}</span>}
        <span className="ui-cal-actions">
          <button type="button" className="btn ghost sm" onClick={() => { setDs(''); setDe(''); setHover(''); setHint(''); }} disabled={!ds}>{t.clear}</button>
          <button type="button" className="btn ghost sm" onClick={p.onCancel}>{t.cancel}</button>
          <button type="button" className="btn sm" disabled={!ds || (!de && !(p.mode === 'trip'))}
            onClick={() => p.onDone(ds, de || ds)}>{t.done}</button>
        </span>
      </div>
      <span className="sr-only" role="status" aria-live="polite">{announce}</span>
    </div>
  );
}
