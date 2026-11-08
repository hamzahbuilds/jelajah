// v0.36 Trip brief (docs/23): where / when / who before Plan with AI.
// CountryPicker (step 1, also the Home hero), WhenStep, YouStep, Ticket,
// BriefWizard (steps 2–4 on /new, or all 4 when editing) and BriefBar (the
// pinned summary above the chat). Plain form controls; motion lives in CSS
// behind prefers-reduced-motion.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useT, type Lang } from '../i18n';
import { Icon } from './Icon';
import type { IconName } from './iconDefs';
import { DateRangePicker } from '../ui/DateRangePicker';
import { addDays, formatYmd, todayYmd } from '../../shared/plainDate';
import {
  BRIEF_LIMITS, COUNTRY_CODES, INTERESTS, briefDays, rangeDays,
  type BriefPlace, type BriefWhen, type Interest, type Pace, type TripBrief,
} from '../../shared/brief';
import { AnimatePresence, StepSwap, motion, useListItem, usePopItem, useRollingNumber } from '../lib/motionKit';
import { useTempoTransition } from '@animate-ui/react/utils/motion';
// Country flags as SVG files (flag-icons): emoji flags are banned by the UI
// rules and Windows doesn't draw them. Only the URL table is bundled (no 400 KB
// stylesheet); each flag is fetched when it's shown.
const FLAG_URLS = import.meta.glob('../../node_modules/flag-icons/flags/4x3/*.svg', { query: '?no-inline', import: 'default', eager: true }) as Record<string, string>;
const flagUrl = (code: string) => FLAG_URLS[`../../node_modules/flag-icons/flags/4x3/${code.toLowerCase()}.svg`];
import './tripBrief.css';

/* ---------- flags ---------- */

/** A country's flag (decorative: the country name is always next to it). */
export function Flag({ code, size = 'md' }: { code: string; size?: 'md' | 'lg' }) {
  const src = flagUrl(code);
  return src
    ? <img src={src} alt="" aria-hidden="true" loading="lazy" decoding="async" width={20} height={15} className={`tb-flag${size === 'lg' ? ' lg' : ''}`} />
    : null;
}

/* ---------- names & summaries ---------- */

const displayNames = new Map<string, Intl.DisplayNames | null>();
export function countryName(code: string, lang: Lang): string {
  const key = lang === 'ms' ? 'ms' : 'en';
  if (!displayNames.has(key)) {
    try { displayNames.set(key, new Intl.DisplayNames([key, 'en'], { type: 'region' })); } catch { displayNames.set(key, null); }
  }
  try { return displayNames.get(key)?.of(code) ?? code; } catch { return code; }
}

function useCountryList(lang: Lang) {
  return useMemo(() => COUNTRY_CODES
    .map(code => ({ code, name: countryName(code, lang) }))
    .sort((a, b) => a.name.localeCompare(b.name)), [lang]);
}

const localeOf = (lang: Lang) => (lang === 'ms' ? 'ms-MY' : 'en-MY');
const monthLabel = (ym: string, lang: Lang) => formatYmd(`${ym}-01`, localeOf(lang), { month: 'long', year: 'numeric' });

/** "Tokyo, Kyoto (Japan); Seoul (South Korea)" — or just the countries. */
export function placesText(places: BriefPlace[], lang: Lang): string {
  return places.map(p => {
    const name = countryName(p.country, lang);
    return p.areas.length ? `${p.areas.join(', ')} (${name})` : name;
  }).join('; ');
}

/** Short "when" text: "1–7 Dec 2026", "in December 2026", or ''. */
export function whenText(w: BriefWhen | null, lang: Lang, t: { briefInMonth: (m: string) => string }): string {
  if (!w) return '';
  if (w.kind === 'dates') {
    const loc = localeOf(lang);
    const sameMonth = w.start.slice(0, 7) === w.end.slice(0, 7);
    const a = formatYmd(w.start, loc, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
    return `${a}–${formatYmd(w.end, loc, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  if (w.kind === 'month') return t.briefInMonth(monthLabel(w.month, lang));
  return '';
}

/** One line for the first chat message and the "brief changed" message. */
export function briefSummary(b: TripBrief, lang: Lang, t: ReturnType<typeof useT>['t']): string {
  const days = briefDays(b);
  const parts = [
    [days ? t.nDays(days) : '', b.places.length ? placesText(b.places, lang) : ''].filter(Boolean).join(lang === 'ms' ? ' di ' : ' in '),
    whenText(b.when, lang, t),
    b.party ? t.briefParty(b.party.adults, b.party.kids, b.party.seniors) : '',
    b.pace ? `${t.briefPace.toLowerCase()}: ${{ relaxed: t.paceRelaxed, balanced: t.paceBalanced, packed: t.pacePacked }[b.pace].toLowerCase()}` : '',
    b.interests?.length ? b.interests.map(i => t.briefInterest[i]).join(', ') : '',
    b.from ? `${t.briefFrom.toLowerCase()} ${b.from}` : '',
  ];
  return parts.filter(Boolean).join(' · ');
}

/** Destination text for "Create trip": "Tokyo, Kyoto · Japan". */
export function briefDestination(b: TripBrief, lang: Lang): string {
  const areas = b.places.flatMap(p => p.areas);
  const countries = b.places.map(p => countryName(p.country, lang)).join(', ');
  return [areas.join(', '), countries].filter(Boolean).join(' · ').slice(0, 120);
}

/* ---------- step 1: where ---------- */

export function CountryPicker({ value, onChange, autoFocus }: {
  value: BriefPlace[]; onChange: (v: BriefPlace[]) => void; autoFocus?: boolean;
}) {
  const { t, lang } = useT();
  const id = useId();
  const list = useCountryList(lang);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [msg, setMsg] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const chosen = new Set(value.map(p => p.country));
  const listItem = useListItem();

  // Our own listbox (not <datalist>): the browser's datalist popup reopens on
  // its own after a pick and can't be closed from script.
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const free = list.filter(c => !chosen.has(c.code));
    const starts = free.filter(c => c.name.toLowerCase().startsWith(s) || c.code.toLowerCase() === s);
    const has = free.filter(c => !starts.includes(c) && c.name.toLowerCase().includes(s));
    return [...starts, ...has].slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, list, value]);
  const showList = open && matches.length > 0;

  const add = (code: string) => {
    if (value.length >= BRIEF_LIMITS.countries) { setMsg(t.briefMaxCountries); return; }
    onChange([...value, { country: code, areas: [] }]);
    setQ(''); setMsg(''); setOpen(false); setActive(0);
    inputRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!matches.length) return;
      e.preventDefault();
      setOpen(true);
      setActive(a => (a + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const hit = matches[active] ?? matches[0];
      if (hit) add(hit.code); else if (q.trim()) setMsg(t.briefNoMatch);
    } else if (e.key === 'Escape' && showList) {
      e.preventDefault(); e.stopPropagation(); // don't close a surrounding dialog
      setOpen(false);
    }
  };

  return (
    <div className="tb-where">
      <label className="tb-label" htmlFor={`${id}-q`}>{t.briefCountry}</label>
      <div className="tb-combo">
        <div className="tb-search">
          <Icon name="search" size={20} />
          <input ref={inputRef} id={`${id}-q`} value={q} placeholder={t.briefCountryPh} autoFocus={autoFocus}
            role="combobox" aria-expanded={showList} aria-controls={`${id}-list`} aria-autocomplete="list"
            aria-activedescendant={showList ? `${id}-o${active}` : undefined} aria-describedby={`${id}-msg`}
            autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="done"
            onChange={e => { setQ(e.target.value); setOpen(true); setActive(0); setMsg(''); }}
            onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} />
        </div>
        <ul className="tb-options" id={`${id}-list`} role="listbox" aria-label={t.briefCountry} hidden={!showList}>
          {matches.map((c, k) => (
            <li key={c.code} id={`${id}-o${k}`} role="option" aria-selected={k === active}
              className={k === active ? 'on' : undefined}
              // mousedown, not click: keep focus in the input so blur doesn't close the list first
              onMouseDown={e => { e.preventDefault(); add(c.code); }}
              onMouseEnter={() => setActive(k)}>
              <Flag code={c.code} />{c.name}
            </li>
          ))}
        </ul>
      </div>
      <p className="tb-msg" id={`${id}-msg`} aria-live="polite">{msg}</p>
      {/* Always mounted, so the first country animates in too (AnimatePresence initial={false}). */}
      {(
        <ul className="tb-countries">
          <AnimatePresence mode="popLayout" initial={false}>
          {value.map((p, i) => {
            const name = countryName(p.country, lang);
            return (
              <motion.li key={p.country} className="tb-country" {...listItem}>
                <div className="tb-country-head">
                  <Flag code={p.country} size="lg" />
                  <b>{name}</b>
                  <button type="button" className="tb-x" aria-label={t.briefRemove(name)}
                    onClick={() => onChange(value.filter((_, k) => k !== i))}><Icon name="x" size={16} /></button>
                </div>
                <ChipInput label={t.briefAreasLabel(name)} placeholder={t.briefAreasPh} values={p.areas} max={BRIEF_LIMITS.areas}
                  onChange={areas => onChange(value.map((x, k) => (k === i ? { ...x, areas } : x)))} />
              </motion.li>
            );
          })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}

/** Free-text chips: Enter or comma adds, Backspace on empty removes the last. */
function ChipInput({ label, placeholder, values, onChange, max }: {
  label: string; placeholder: string; values: string[]; onChange: (v: string[]) => void; max: number;
}) {
  const { t } = useT();
  const id = useId();
  const [text, setText] = useState('');
  const popItem = usePopItem();
  const commit = () => {
    const v = text.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (v && !values.some(x => x.toLowerCase() === v.toLowerCase()) && values.length < max) onChange([...values, v]);
    setText('');
  };
  return (
    <div className="tb-chipinput">
      <label className="sr-only" htmlFor={id}>{label}</label>
      <AnimatePresence mode="popLayout" initial={false}>
        {values.map((v, i) => (
          <motion.span key={v} className="tb-chip" {...popItem}>
            {v}
            <button type="button" aria-label={t.briefRemove(v)} onClick={() => onChange(values.filter((_, k) => k !== i))}>
              <Icon name="x" size={16} />
            </button>
          </motion.span>
        ))}
      </AnimatePresence>
      {values.length < max && (
        <input id={id} value={text} placeholder={values.length ? '' : placeholder} enterKeyHint="done"
          onChange={e => { if (e.target.value.endsWith(',')) { setText(e.target.value.slice(0, -1)); setTimeout(commit); } else setText(e.target.value); }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); commit(); }
            else if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1));
          }}
          onBlur={commit} />
      )}
    </div>
  );
}

/* ---------- step 2: when ---------- */

function DayStepper({ label, value, onChange, min = BRIEF_LIMITS.minDays, max = BRIEF_LIMITS.maxDays, unit }: {
  label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; unit?: string;
}) {
  const { t } = useT();
  const id = useId();
  return (
    <div className="tb-stepper" role="group" aria-labelledby={`${id}-l`}>
      <span className="tb-stepper-label" id={`${id}-l`}>{label}</span>
      <button type="button" className="tb-step-btn" aria-label={t.briefFewer(label.toLowerCase())}
        disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}><Icon name="minus" size={20} /></button>
      <output className="tb-step-val" aria-live="polite">{value}{unit && <small> {unit}</small>}</output>
      <button type="button" className="tb-step-btn" aria-label={t.briefMore(label.toLowerCase())}
        disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Icon name="plus" size={20} /></button>
    </div>
  );
}

function nextMonths(n = 12): string[] {
  const now = todayYmd();
  let y = +now.slice(0, 4), m = +now.slice(5, 7);
  return Array.from({ length: n }, () => {
    const s = `${y}-${String(m).padStart(2, '0')}`;
    if (++m > 12) { m = 1; y++; }
    return s;
  });
}

export function WhenStep({ when, onChange }: { when: BriefWhen | null; onChange: (w: BriefWhen) => void }) {
  const { t, lang } = useT();
  const id = useId();
  const kind = when?.kind ?? 'unsure';
  const days = when ? (when.kind === 'dates' ? rangeDays(when.start, when.end) : when.days) : 3;
  const months = useMemo(() => nextMonths(12), []);
  const options: { k: BriefWhen['kind']; icon: IconName; label: string; sub: string }[] = [
    { k: 'dates', icon: 'calendar', label: t.briefWhenExact, sub: t.briefWhenExactSub },
    { k: 'month', icon: 'clock', label: t.briefWhenMonth, sub: t.briefWhenMonthSub },
    { k: 'unsure', icon: 'info', label: t.briefWhenUnsure, sub: t.briefWhenUnsureSub },
  ];
  const pick = (k: BriefWhen['kind']) => {
    if (k === 'dates') onChange(when?.kind === 'dates' ? when : { kind: 'dates', start: '', end: '' } as BriefWhen);
    else if (k === 'month') onChange({ kind: 'month', month: when?.kind === 'month' ? when.month : months[1], days });
    else onChange({ kind: 'unsure', days });
  };
  return (
    <div className="tb-when">
      <div className="tb-cards" role="radiogroup" aria-labelledby={`${id}-t`}>
        <span className="sr-only" id={`${id}-t`}>{t.briefWhenTitle}</span>
        {options.map(o => (
          <label key={o.k} className={'tb-card' + (kind === o.k ? ' on' : '')}>
            <input type="radio" name={`${id}-k`} className="sr-only" checked={kind === o.k} onChange={() => pick(o.k)} />
            <Icon name={o.icon} size={24} />
            <b>{o.label}</b>
            <small>{o.sub}</small>
          </label>
        ))}
      </div>
      <StepSwap stepKey={kind} className="tb-when-body" distance={12}>
        {kind === 'dates' && (
          <DateRangePicker label={t.briefDates} mode="trip"
            start={when?.kind === 'dates' ? when.start : ''} end={when?.kind === 'dates' ? when.end : ''}
            min={todayYmd()}
            onChange={(s, e) => onChange({ kind: 'dates', start: s, end: e || (s ? addDays(s, Math.max(1, days) - 1) : '') })} />
        )}
        {kind === 'month' && (
          <>
            <span className="tb-label">{t.briefMonth}</span>
            <div className="tb-months" role="radiogroup" aria-label={t.briefMonth}>
              {months.map(m => {
                const on = when?.kind === 'month' && when.month === m;
                return (
                  <button key={m} type="button" role="radio" aria-checked={on} className={'tb-month' + (on ? ' on' : '')}
                    onClick={() => onChange({ kind: 'month', month: m, days })}>
                    <small>{formatYmd(`${m}-01`, localeOf(lang), { year: 'numeric' })}</small>
                    {formatYmd(`${m}-01`, localeOf(lang), { month: 'short' })}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {kind !== 'dates' && (
          <DayStepper label={t.briefHowLong} value={days} unit={t.briefDaysWord}
            onChange={n => onChange(kind === 'month' && when?.kind === 'month' ? { ...when, days: n } : { kind: 'unsure', days: n })} />
        )}
      </StepSwap>
    </div>
  );
}

/* ---------- step 3: you ---------- */

export function YouStep({ brief, onChange }: { brief: TripBrief; onChange: (b: TripBrief) => void }) {
  const { t } = useT();
  const id = useId();
  const party = brief.party ?? { adults: 0, kids: 0, seniors: 0 };
  const setParty = (k: keyof typeof party, n: number) => onChange({ ...brief, party: { ...party, [k]: n } });
  const paces: { v: Pace; label: string; sub: string }[] = [
    { v: 'relaxed', label: t.paceRelaxed, sub: t.paceRelaxedSub },
    { v: 'balanced', label: t.paceBalanced, sub: t.paceBalancedSub },
    { v: 'packed', label: t.pacePacked, sub: t.pacePackedSub },
  ];
  const interests = new Set(brief.interests ?? []);
  const toggle = (i: Interest) => {
    const n = new Set(interests); n.has(i) ? n.delete(i) : n.add(i);
    onChange({ ...brief, interests: INTERESTS.filter(x => n.has(x)) });
  };
  return (
    <div className="tb-you">
      <fieldset className="tb-group">
        <legend className="tb-label">{t.briefWho}</legend>
        <div className="tb-party">
          <DayStepper label={t.briefAdults} value={party.adults} min={0} max={BRIEF_LIMITS.people} onChange={n => setParty('adults', n)} />
          <DayStepper label={t.briefKids} value={party.kids} min={0} max={BRIEF_LIMITS.people} onChange={n => setParty('kids', n)} />
          <DayStepper label={t.briefSeniors} value={party.seniors} min={0} max={BRIEF_LIMITS.people} onChange={n => setParty('seniors', n)} />
        </div>
      </fieldset>
      <fieldset className="tb-group">
        <legend className="tb-label">{t.briefPace}</legend>
        <div className="tb-paces">
          {paces.map(p => (
            <label key={p.v} className={'tb-pill' + (brief.pace === p.v ? ' on' : '')}>
              <input type="radio" name={`${id}-pace`} className="sr-only" checked={brief.pace === p.v}
                onChange={() => onChange({ ...brief, pace: p.v })} />
              <b>{p.label}</b><small>{p.sub}</small>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="tb-group">
        <legend className="tb-label">{t.briefInterests}</legend>
        <div className="tb-interests">
          {INTERESTS.map(i => (
            <label key={i} className={'tb-tag' + (interests.has(i) ? ' on' : '')}>
              <input type="checkbox" className="sr-only" checked={interests.has(i)} onChange={() => toggle(i)} />
              {interests.has(i) && <Icon name="check" size={16} />}{t.briefInterest[i]}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="tb-group">
        <label className="tb-label" htmlFor={`${id}-from`}>{t.briefFrom}</label>
        <input id={`${id}-from`} className="tb-text" value={brief.from ?? ''} placeholder={t.briefFromPh} maxLength={60}
          autoComplete="address-level2" onChange={e => onChange({ ...brief, from: e.target.value })} />
      </div>
    </div>
  );
}

/* ---------- step 4: the ticket ---------- */

export function Ticket({ brief }: { brief: TripBrief }) {
  const { t, lang } = useT();
  const days = briefDays(brief);
  const shown = useRollingNumber(days ?? 0);
  // The route draws itself and the plane flies along it once (delight, own motion).
  const draw = useTempoTransition({ duration: 1.2, delay: 0.2, ease: [0.6, 0, 0.3, 1] });
  // Flight distance in px (transforms only, never `left`): from 18% to 76% of the card, short of the flag.
  const mainRef = useRef<HTMLDivElement>(null);
  const [span, setSpan] = useState(0);
  useEffect(() => { setSpan((mainRef.current?.clientWidth ?? 0) * 0.58); }, []);
  const to = brief.places[brief.places.length - 1];
  const toCode = to ? to.country : '';
  const when = whenText(brief.when, lang, t) || t.briefDatesTbd;
  return (
    <div className="tb-ticket">
      <div className="tb-ticket-main" ref={mainRef}>
        <div className="tb-end">
          <span className="tb-iata tb-home"><Icon name="home" size={24} /></span>
          <small>{brief.from || t.briefFrom}</small>
        </div>
        <svg className="tb-route" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true">
          <path className="tb-route-line" d="M4 32 Q100 -8 196 32" />
          <motion.path className="tb-route-trail" d="M4 32 Q100 -8 196 32"
            initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={draw} />
        </svg>
        {span > 0 && (
          <motion.span className="tb-plane" aria-hidden="true"
            // Lucide's plane points up-right (45°): turn it so the nose follows the route,
            // climbing (-25°), level, then descending (+25°).
            initial={{ x: 0, y: 20, rotate: 20, opacity: 0 }}
            animate={{ x: [0, span / 2, span], y: [20, 0, 20], rotate: [20, 45, 70], opacity: [0, 1, 1] }}
            transition={draw}><Icon name="plane" size={20} /></motion.span>
        )}
        <div className="tb-end to">
          <span className="tb-iata">{to && <Flag code={toCode} size="lg" />}{toCode}</span>
          <small>{brief.places.map(p => countryName(p.country, lang)).join(', ')}</small>
        </div>
      </div>
      <dl className="tb-ticket-stub">
        <div><dt>{t.briefStepNames[0]}</dt><dd>{placesText(brief.places, lang)}</dd></div>
        <div><dt>{t.briefStepNames[1]}</dt><dd>{when}</dd></div>
        {days ? <div><dt>{t.briefDaysWord}</dt><dd className="tb-days">{shown}</dd></div> : null}
        {brief.party && <div><dt>{t.briefWho}</dt><dd>{t.briefParty(brief.party.adults, brief.party.kids, brief.party.seniors)}</dd></div>}
      </dl>
    </div>
  );
}

/* ---------- the wizard ---------- */

export type BriefStep = 'where' | 'when' | 'you' | 'ready';
const STEPS: BriefStep[] = ['where', 'when', 'you', 'ready'];

/**
 * Steps where → when → you → ready. `onDone(brief, extra)` on "Start planning"
 * (or "Save changes" when `editing`). Each step slides in from the side it
 * comes from (CSS, reduced-motion aware).
 */
export function BriefWizard({ initial, startAt = 'where', editing, onDone, onCancel, header, onProgress, doneLabel, cancelLabel, onReturn, returnLabel }: {
  initial: TripBrief; startAt?: BriefStep; editing?: boolean;
  /** Labels when coming back from an existing chat ("Back to chat"). */
  doneLabel?: string; cancelLabel?: string;
  /** A way back to an existing chat from any step (shown next to Next). */
  onReturn?: () => void; returnLabel?: string;
  /** Called as the brief and step change, so a reload can pick up where they were. */
  onProgress?: (b: TripBrief, step: BriefStep) => void;
  onDone: (b: TripBrief, extra: string) => void; onCancel?: () => void; header?: ReactNode;
}) {
  const { t } = useT();
  const [b, setB] = useState<TripBrief>(initial);
  const [step, setStep] = useState<BriefStep>(startAt);
  const [dir, setDir] = useState<'fwd' | 'back'>('fwd');
  const [extra, setExtra] = useState('');
  const headRef = useRef<HTMLHeadingElement>(null);
  const i = STEPS.indexOf(step);
  const datesIncomplete = b.when?.kind === 'dates' && !(b.when.start && b.when.end);
  const canNext = step === 'where' ? b.places.length > 0 : step === 'when' ? !datesIncomplete : true;

  const go = (n: number) => {
    const next = STEPS[Math.max(0, Math.min(STEPS.length - 1, n))];
    setDir(n > i ? 'fwd' : 'back');
    setStep(next);
  };
  const progress = useRef(onProgress);
  progress.current = onProgress;
  useEffect(() => { progress.current?.(b, step); }, [b, step]);
  // Move focus to the new step's heading so screen readers hear where they are.
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } headRef.current?.focus(); }, [step]);

  const clean = (x: TripBrief): TripBrief => ({ ...x, from: x.from?.trim() || undefined, when: x.when ?? { kind: 'unsure', days: 3 } });
  const titles: Record<BriefStep, string> = { where: t.briefWhereTitle, when: t.briefWhenTitle, you: t.briefYouTitle, ready: t.briefReadyTitle };

  return (
    <form className="tb-wizard" onSubmit={e => { e.preventDefault(); if (step === 'ready' || editing) onDone(clean(b), extra.trim()); else if (canNext) go(i + 1); }}>
      {header}
      <ol className="tb-progress" aria-label={t.briefStepOf(i + 1, STEPS.length, t.briefStepNames[i])}>
        {STEPS.map((s, k) => (
          <li key={s} className={k < i ? 'done' : k === i ? 'on' : ''} aria-current={k === i ? 'step' : undefined}>
            <button type="button" disabled={!editing && k > i && !(k === i + 1 && canNext)} onClick={() => go(k)}>
              <span className="tb-dot">{k < i ? <Icon name="check" size={16} /> : k + 1}</span>
              <span className="tb-pname">{t.briefStepNames[k]}</span>
            </button>
          </li>
        ))}
      </ol>
      <StepSwap stepKey={step} dir={dir} className="tb-step">
        <h2 ref={headRef} tabIndex={-1}>{titles[step]}</h2>
        {step === 'where' && <><p className="tb-sub">{t.briefWhereHint}</p><CountryPicker value={b.places} onChange={places => setB({ ...b, places })} autoFocus /></>}
        {step === 'when' && <WhenStep when={b.when} onChange={when => setB({ ...b, when })} />}
        {step === 'you' && <><p className="tb-sub">{t.briefYouSub}</p><YouStep brief={b} onChange={setB} /></>}
        {step === 'ready' && (
          <>
            <Ticket brief={clean(b)} />
            {!editing && (
              <div className="tb-group">
                <label className="tb-label" htmlFor="tb-extra">{t.briefExtra}</label>
                <textarea id="tb-extra" className="tb-text" rows={2} value={extra} maxLength={400}
                  placeholder={t.briefExtraPh} onChange={e => setExtra(e.target.value)} />
              </div>
            )}
          </>
        )}
      </StepSwap>
      <div className="tb-foot">
        {i > 0 ? <button type="button" className="btn ghost" onClick={() => go(i - 1)}><Icon name="arrow-l" size={16} /> {t.briefBack}</button>
          : onCancel ? <button type="button" className="btn ghost" onClick={onCancel}>{cancelLabel ?? t.cancel}</button> : <span />}
        <span className="tb-foot-right">
          {onReturn && step !== 'ready' && <button type="button" className="btn secondary" onClick={onReturn}>{returnLabel}</button>}
          {step === 'you' && <button type="button" className="btn secondary" onClick={() => go(i + 1)}>{t.briefSkip}</button>}
          {editing && step !== 'ready' && <button type="button" className="btn secondary" disabled={!b.places.length} onClick={() => onDone(clean(b), '')}>{t.briefSave}</button>}
          {step === 'ready'
            // Separate keys: reusing one <button> and flipping it to type="submit"
            // mid-click would submit the form from the step before Ready.
            ? <button key="go" type="submit" className="btn tb-go"><Icon name="sparkles" size={16} /> {doneLabel ?? (editing ? t.briefSave : t.briefStart)}</button>
            : <button key="next" type="button" className="btn" disabled={!canNext} onClick={() => go(i + 1)}>{step === 'where' ? t.briefNextWhen : t.briefNext} <Icon name="arrow-r" size={16} /></button>}
        </span>
      </div>
    </form>
  );
}

/* ---------- pinned summary above the chat ---------- */

export function BriefBar({ brief, onEdit, note }: { brief: TripBrief; onEdit: () => void; note?: boolean }) {
  const { t, lang } = useT();
  const popItem = usePopItem();
  const days = briefDays(brief);
  const when = whenText(brief.when, lang, t);
  return (
    <div className="tb-bar">
      <button type="button" className="tb-bar-btn" onClick={onEdit} aria-label={t.briefEdit}>
        {brief.places.map(p => (
          <motion.span key={p.country} className="tb-bar-chip" {...popItem}>
            <Flag code={p.country} />
            {p.areas.length ? p.areas.join(', ') : countryName(p.country, lang)}
          </motion.span>
        ))}
        {when && <span className="tb-bar-chip"><Icon name="calendar" size={16} /> {when}</span>}
        {days ? <span className="tb-bar-chip">{t.nDays(days)}</span> : null}
        {brief.party && <span className="tb-bar-chip"><Icon name="users" size={16} /> {t.briefParty(brief.party.adults, brief.party.kids, brief.party.seniors)}</span>}
        <span className="tb-bar-edit"><Icon name="edit" size={16} /></span>
      </button>
      {note && <p className="tb-bar-note">{t.briefFoundNote}</p>}
    </div>
  );
}

/* ---------- Home hero: step 1 inline ---------- */

/** "Where to next?" on Home: pick countries here, the rest continues on /new. */
export function HomeBriefStart({ onNext }: { onNext: (places: BriefPlace[]) => void }) {
  const { t } = useT();
  const [places, setPlaces] = useState<BriefPlace[]>([]);
  return (
    <div className="tb-hero">
      <CountryPicker value={places} onChange={setPlaces} />
      <button type="button" className="btn tb-hero-go" disabled={!places.length} onClick={() => onNext(places)}>
        {t.briefNextWhen} <Icon name="arrow-r" size={16} />
      </button>
    </div>
  );
}
