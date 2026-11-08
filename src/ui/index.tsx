// v0.30 UI primitives (docs/18 §4). Small, token-only, both themes, 44px hit
// areas, no inline styles. Pages compose these instead of hand-rolled markup.
import {
  Children, cloneElement, isValidElement, useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type ReactElement, type ReactNode,
} from 'react';
import { NavLink } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { fmtMYR, fmtMoney } from '../api';
import Dialog from '../components/Dialog';
import Menu, { type MenuItem } from '../components/Menu';
import './ui.css';
import { AnimatePresence, motion } from 'motion/react';
import { spring, useTempoTransition } from '@animate-ui/react/utils/motion';

const cx = (...c: unknown[]) => c.filter(x => typeof x === 'string' && x).join(' ');

/* ---------- Button ---------- */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: IconName;
  loading?: boolean;
}
export function Button({ variant = 'primary', size = 'md', icon, loading, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx('btn ui-btn', variant !== 'primary' && variant, size === 'sm' && 'sm', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="ui-spin" aria-hidden="true" /> : icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  );
}

/* ---------- IconButton (44×44 hit area, name required) ---------- */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  label: string;
  tone?: 'default' | 'danger';
}
export function IconButton({ icon, label, tone = 'default', className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} className={cx('ui-iconbtn', tone === 'danger' && 'danger', className)} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={20} />
    </button>
  );
}

/* ---------- Card ---------- */
export function Card({ title, icon, action, children, className, as: Tag = 'section', headingLevel = 2 }: {
  title?: ReactNode; icon?: IconName; action?: ReactNode; children?: ReactNode; className?: string;
  as?: 'section' | 'div' | 'article'; headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <Tag className={cx('card ui-card', className)}>
      {(title || action) && (
        <div className="ui-card-head">
          {title && <H className="ui-card-title">{icon && <Icon name={icon} size={20} />}{title}</H>}
          {action && <div className="ui-card-action">{action}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}

/* ---------- Money (never wraps) ---------- */
export function Money({ value, currency = 'MYR', className }: { value: number; currency?: string; className?: string }) {
  return <span className={cx('ui-money', className)}>{currency === 'MYR' ? fmtMYR(value) : fmtMoney(value, currency)}</span>;
}

/* ---------- Stat ---------- */
export function Stat({ label, icon, value, sub, tone }: {
  label: string; icon?: IconName; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'success' | 'danger';
}) {
  return (
    <div className={cx('ui-stat', tone && tone !== 'default' && `tone-${tone}`)}>
      <div className="ui-stat-k">{icon && <span className="tile sm"><Icon name={icon} /></span>}{label}</div>
      <div className="ui-stat-v">{typeof value === 'number' ? <Money value={value} /> : value}</div>
      {sub && <div className="ui-stat-sub">{sub}</div>}
    </div>
  );
}

/* ---------- Badge (icon or text — never tint alone) ---------- */
export type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';
const TONE_ICON: Record<Tone, IconName | undefined> = { neutral: undefined, brand: undefined, success: 'check', warning: 'clock', danger: 'alert' };
export function Badge({ tone = 'neutral', icon, children }: { tone?: Tone; icon?: IconName | null; children: ReactNode }) {
  const ic = icon === null ? undefined : icon ?? TONE_ICON[tone];
  return <span className={cx('ui-badge', `tone-${tone}`)}>{ic && <Icon name={ic} size={16} />}{children}</span>;
}

/* ---------- ListRow ---------- */
export interface ListRowProps {
  icon?: IconName;
  lead?: ReactNode; // custom leading (avatar, emoji)
  title: ReactNode;
  meta?: ReactNode;
  value?: ReactNode;
  badge?: ReactNode;
  to?: string;
  onClick?: () => void;
  menu?: (MenuItem | '-')[];
  menuLabel?: string;
  trailing?: ReactNode;
  className?: string;
}
export function ListRow({ icon, lead, title, meta, value, badge, to, onClick, menu, menuLabel = 'More actions', trailing, className }: ListRowProps) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const body = (
    <>
      {lead ?? (icon && <span className="tile sm"><Icon name={icon} /></span>)}
      <span className="ui-row-main">
        <span className="ui-row-title">{title}</span>
        {meta && <span className="ui-row-meta">{meta}</span>}
      </span>
      {(value || badge) && <span className="ui-row-end">{value && <span className="ui-row-value">{value}</span>}{badge}</span>}
    </>
  );
  return (
    <li className={cx('ui-row', className)}>
      {to ? <NavLink to={to} className="ui-row-hit">{body}<Icon name="chev-r" size={16} className="ui-row-chev" /></NavLink>
        : onClick ? <button type="button" className="ui-row-hit" onClick={onClick}>{body}<Icon name="chev-r" size={16} className="ui-row-chev" /></button>
        : <div className="ui-row-hit static">{body}</div>}
      {trailing}
      {menu && menu.length > 0 && (
        <>
          <IconButton icon="more-v" label={menuLabel} aria-haspopup="menu" aria-expanded={!!anchor}
            onClick={e => setAnchor(anchor ? null : e.currentTarget)} />
          <Menu open={!!anchor} anchor={anchor} items={menu} onClose={() => setAnchor(null)} />
        </>
      )}
    </li>
  );
}
export function List({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return <ul className={cx('ui-list', className)} aria-label={label}>{children}</ul>;
}

/* ---------- Field (label above, hint above input, error below, aria-invalid bridge) ---------- */
export function Field({ label, hint, error, required, children, className }: {
  label: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; children: ReactElement; className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = `${id}-err`;
  const wrap = useRef<HTMLDivElement>(null);
  const [invalid, setInvalid] = useState(false);
  const [msg, setMsg] = useState('');

  // :user-invalid is visual only — mirror it into aria-invalid + a visible
  // message once the user has blurred the field or tried to submit.
  useEffect(() => {
    const el = wrap.current?.querySelector<HTMLInputElement>('input,select,textarea');
    if (!el) return;
    // validity.valid, not checkValidity(): the latter fires another `invalid`
    // event, and we are inside an `invalid` listener (infinite recursion).
    const check = () => {
      const bad = !el.validity.valid;
      setInvalid(bad);
      setMsg(bad ? el.validationMessage : '');
    };
    const onInvalid = (e: Event) => { e.preventDefault(); check(); }; // suppress the native bubble; we show text
    const onInput = () => { if (el.getAttribute('aria-invalid') === 'true') check(); };
    el.addEventListener('blur', check);
    el.addEventListener('invalid', onInvalid);
    el.addEventListener('input', onInput);
    el.addEventListener('change', onInput);
    return () => {
      el.removeEventListener('blur', check);
      el.removeEventListener('invalid', onInvalid);
      el.removeEventListener('input', onInput);
      el.removeEventListener('change', onInput);
    };
  }, []);

  const shownError = error || (invalid ? msg : '');
  const child = Children.only(children);
  const control = isValidElement(child)
    ? cloneElement(child as ReactElement<any>, {
        id: (child.props as any).id ?? id,
        required: (child.props as any).required ?? required,
        'aria-describedby': cx(hintId, shownError && errId) || undefined,
        'aria-invalid': shownError ? true : undefined,
      })
    : child;

  return (
    <div className={cx('ui-field', shownError && 'has-error', className)} ref={wrap}>
      <label className="ui-field-label" htmlFor={(isValidElement(child) && (child.props as any).id) || id}>
        {label}{required && <span className="ui-req" aria-hidden="true"> *</span>}
      </label>
      {hint && <span className="ui-field-hint" id={hintId}>{hint}</span>}
      {control}
      <span className="ui-field-error" id={errId} role="alert" aria-live="polite">
        {shownError && <><Icon name="alert" size={16} /> {shownError}</>}
      </span>
    </div>
  );
}

/* ---------- Segmented ---------- */
export interface SegOption<V extends string> { value: V; label: ReactNode; icon?: IconName; to?: string }
export function Segmented<V extends string>({ options, value, onChange, label, className }: {
  options: SegOption<V>[]; value?: V; onChange?: (v: V) => void; label: string; className?: string;
}) {
  // v0.37 motion (Animate UI indicator recipe): one surface slides to the
  // selected item on spring.selection (shared layoutId); labels stay above it.
  const pillId = useId();
  const slide = useTempoTransition(spring.selection);
  const pill = <motion.span className="ui-seg-pill" layoutId={pillId} transition={slide} aria-hidden="true" />;
  if (options.every(o => o.to)) {
    return (
      <nav className={cx('ui-seg', className)} aria-label={label}>
        {options.map(o => (
          <NavLink key={o.value} to={o.to!} end viewTransition className={({ isActive }) => cx('ui-seg-item', isActive && 'on')}>
            {({ isActive }) => <>{isActive && pill}<span className="ui-seg-label">{o.icon && <Icon name={o.icon} size={16} />}{o.label}</span></>}
          </NavLink>
        ))}
      </nav>
    );
  }
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = options[(i + d + options.length) % options.length];
    onChange?.(n.value);
    (e.currentTarget.parentElement?.children[(i + d + options.length) % options.length] as HTMLElement | undefined)?.focus();
  };
  return (
    <div className={cx('ui-seg', className)} role="radiogroup" aria-label={label}>
      {options.map((o, i) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1} className={cx('ui-seg-item', o.value === value && 'on')}
          onClick={() => onChange?.(o.value)} onKeyDown={e => onKey(e, i)}>
          {o.value === value && pill}
          <span className="ui-seg-label">{o.icon && <Icon name={o.icon} size={16} />}{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- EmptyState ---------- */
export function EmptyState({ icon, title, text, action, compact }: {
  icon: IconName; title?: ReactNode; text: ReactNode; action?: ReactNode; compact?: boolean;
}) {
  return (
    <div className={cx('ui-empty', compact && 'compact')}>
      <span className="ui-empty-tile"><Icon name={icon} size={compact ? 20 : 24} /></span>
      {title && <p className="ui-empty-title">{title}</p>}
      <p className="ui-empty-text">{text}</p>
      {action}
    </div>
  );
}

/* ---------- Skeleton ---------- */
export function Skeleton({ lines = 3, card = true }: { lines?: number; card?: boolean }) {
  const body = (
    <div className="ui-skel" aria-hidden="true">
      <span className="ui-skel-bar w40" />
      {Array.from({ length: lines }, (_, i) => <span key={i} className={cx('ui-skel-bar', i % 3 === 2 ? 'w60' : 'w100')} />)}
    </div>
  );
  return card ? <div className="card ui-card">{body}</div> : body;
}
export function PageSkeleton({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="ui-page-skel" role="status" aria-label={label}>
      <span className="ui-skel-bar ui-skel-title" aria-hidden="true" />
      <div className="ui-skel-grid"><Skeleton lines={2} /><Skeleton lines={2} /><Skeleton lines={2} /></div>
      <Skeleton lines={5} />
    </div>
  );
}

/* ---------- FormSheet (full-screen on phones, centred ≥1024px, sticky head + foot) ---------- */
export function FormSheet({ open, onClose, title, icon, sub, children, footer, onSubmit, closeLabel = 'Close', dismissible = true, wide }: {
  open: boolean; onClose: () => void; title: string; icon?: IconName; sub?: ReactNode;
  children: ReactNode; footer?: ReactNode; onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void;
  closeLabel?: string; dismissible?: boolean; wide?: boolean;
}) {
  const titleId = useId();
  const inner = (
    <>
      <header className="ui-sheet-head">
        {icon && <span className="tile sm"><Icon name={icon} /></span>}
        <div className="ui-sheet-titles"><h2 id={titleId}>{title}</h2>{sub && <p>{sub}</p>}</div>
        <IconButton icon="x" label={closeLabel} onClick={onClose} />
      </header>
      <div className="ui-sheet-body">{children}</div>
      {footer && <footer className="ui-sheet-foot">{footer}</footer>}
    </>
  );
  return (
    <AnimatePresence>
      {open && (
    <Dialog onClose={onClose} dismissible={dismissible} className={cx('ui-sheet', wide && 'wide')} labelledBy={titleId}>
      {onSubmit
        ? <form className="ui-sheet-form" noValidate={false} onSubmit={e => { e.preventDefault(); onSubmit(e); }}>{inner}</form>
        : <div className="ui-sheet-form">{inner}</div>}
    </Dialog>
      )}
    </AnimatePresence>
  );
}

/* ---------- PageHeader ---------- */
export function PageHeader({ title, sub, actions, overflow, overflowLabel = 'More actions', lead }: {
  title: ReactNode; sub?: ReactNode; actions?: ReactNode; overflow?: (MenuItem | '-')[]; overflowLabel?: string; lead?: ReactNode;
}) {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <header className="ui-pagehead">
      <div className="ui-pagehead-titles">
        {lead}
        <h1>{title}</h1>
        {sub && <p className="ui-pagehead-sub">{sub}</p>}
      </div>
      {(actions || overflow) && (
        <div className="ui-pagehead-actions">
          {overflow && overflow.length > 0 && (
            <>
              <IconButton icon="more" label={overflowLabel} aria-haspopup="menu" aria-expanded={!!anchor}
                onClick={e => setAnchor(anchor ? null : e.currentTarget)} />
              <Menu open={!!anchor} anchor={anchor} items={overflow} onClose={() => setAnchor(null)} />
            </>
          )}
          {actions}
        </div>
      )}
    </header>
  );
}

export { DateRangePicker } from './DateRangePicker';
export type { MenuItem };
