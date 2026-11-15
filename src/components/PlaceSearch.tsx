// v0.46 one place search for every "where is this?" field (activities, day
// start/end, personal-plan stops, accommodation pins). The four older pickers
// each behaved differently: Enter in the location box submitted the form with
// no pin, typing a name silently dropped the pin, results were mouse-only
// divs, and one picker called Nominatim straight from the browser. Here the
// input is an ARIA combobox: results appear as you type, arrows + Enter pick
// one, Enter never submits the surrounding form, and a status line always
// says whether the place is actually on the map.
import { useEffect, useId, useRef, useState } from 'react';
import { geocode, type GeoResult } from '../geo';
import { useT } from '../i18n';
import { Icon } from './Icon';
import LeafletMap from './LazyMap';

export interface PlaceValue { name: string; lat: number | null; lng: number | null }

const MIN_CHARS = 3, DEBOUNCE_MS = 400;
export const isPinned = (v: PlaceValue | null | undefined) => v?.lat != null && v?.lng != null;

/**
 * Save-time safety net: a typed name with no pin gets the best match's
 * coordinates (the typed name is kept). Returns the value unchanged when it is
 * already pinned, empty, or nothing matches.
 */
export async function pinFirst<T extends PlaceValue>(v: T, bias?: { lat: number; lng: number }): Promise<T> {
  if (isPinned(v) || !v.name.trim()) return v;
  const [top] = await geocode(v.name, bias).catch(() => [] as GeoResult[]);
  return top ? { ...v, lat: top.lat, lng: top.lng } : v;
}

export default function PlaceSearch({ value, onChange, label, bias, mapHeight = 180, autoFocus }: {
  value: PlaceValue;
  onChange: (v: PlaceValue) => void;
  label?: string;
  /** Rank results near here first (e.g. the trip's other stops). */
  bias?: { lat: number; lng: number };
  mapHeight?: number;
  autoFocus?: boolean;
}) {
  const { t, lang } = useT();
  const ms = lang === 'ms';
  const id = useId(), listId = `${id}-list`;
  const [results, setResults] = useState<GeoResult[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [state, setState] = useState<'idle' | 'searching' | 'empty'>('idle');
  const seq = useRef(0), timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const typed = useRef(false);
  const pinned = isPinned(value);
  const biasKey = bias ? `${bias.lat},${bias.lng}` : '';

  const run = async (q: string) => {
    clearTimeout(timer.current);
    if (q.trim().length < MIN_CHARS) { setResults([]); setOpen(false); setState('idle'); return; }
    const mine = ++seq.current;
    setState('searching');
    const found = await geocode(q.trim(), bias).catch(() => [] as GeoResult[]);
    if (mine !== seq.current) return; // a newer keystroke won
    setResults(found); setActive(found.length ? 0 : -1);
    setOpen(found.length > 0); setState(found.length ? 'idle' : 'empty');
  };

  // Search as the user types (debounced); never for a value set from outside.
  useEffect(() => {
    if (!typed.current) return;
    typed.current = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => run(value.name), DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [value.name, biasKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (r: GeoResult) => {
    seq.current++; clearTimeout(timer.current);
    onChange({ name: r.name, lat: r.lat, lng: r.lng });
    setResults([]); setOpen(false); setActive(-1); setState('idle');
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!results.length) return;
      e.preventDefault();
      setOpen(true);
      setActive(i => (e.key === 'ArrowDown' ? (i + 1) % results.length : (i - 1 + results.length) % results.length));
    } else if (e.key === 'Enter') {
      // Enter picks a place; it must never submit the form with no pin.
      e.preventDefault();
      if (open && results[active]) choose(results[active]);
      else if (!pinned) run(value.name);
    } else if (e.key === 'Escape' && open) {
      e.preventDefault(); e.stopPropagation(); // close the list, not the dialog
      setOpen(false);
    }
  };

  const status = state === 'searching' ? { tone: 'busy', text: t.loading }
    : pinned ? { tone: 'ok', text: ms ? 'Dipin pada peta' : 'Pinned on the map' }
    : state === 'empty' ? { tone: 'warn', text: ms ? 'Tiada padanan. Cuba tambah nama bandar, atau tekan peta.' : 'No matches. Try adding the city, or tap the map.' }
    : value.name.trim() ? { tone: 'warn', text: ms ? 'Belum dipin. Pilih hasil carian atau tekan peta.' : 'Not pinned yet. Pick a result or tap the map.' }
    : { tone: 'idle', text: ms ? 'Taip sekurang-kurangnya 3 huruf, atau tekan peta.' : 'Type at least 3 letters, or tap the map.' };

  return (
    <div className="place-search">
      {label && <label htmlFor={id} className="ps-label">{label}</label>}
      <div className="ps-field">
        <Icon name="search" size={16} />
        <input id={id} type="text" role="combobox" autoComplete="off" spellCheck={false} maxLength={300}
          aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? `${id}-opt-${active}` : undefined}
          aria-describedby={`${id}-status`}
          autoFocus={autoFocus}
          placeholder={t.searchPlace} value={value.name}
          onChange={e => { typed.current = true; onChange({ name: e.target.value, lat: null, lng: null }); }}
          onKeyDown={onKey}
          onFocus={() => { if (results.length && !pinned) setOpen(true); }}
          onBlur={() => setOpen(false)} />
        {(value.name || pinned) && (
          <button type="button" className="ps-clear" aria-label={ms ? 'Kosongkan tempat' : 'Clear place'}
            onClick={() => { seq.current++; onChange({ name: '', lat: null, lng: null }); setResults([]); setOpen(false); setState('idle'); }}>
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      <ul id={listId} role="listbox" className="ps-list" hidden={!open} aria-label={t.searchPlace}>
        {results.map((r, i) => (
          <li key={`${r.lat},${r.lng},${i}`} id={`${id}-opt-${i}`} role="option" aria-selected={i === active}
            className={i === active ? 'on' : ''}
            // mousedown, not click: the input's blur would close the list first
            onMouseDown={e => { e.preventDefault(); choose(r); }}
            onMouseMove={() => setActive(i)}>
            <Icon name="pin" size={16} />
            <span>
              <b>{r.name.split(', ')[0]}{r.kind && <em className="ps-kind">{r.kind}</em>}</b>
              <small>{[r.detail, r.name.split(', ').slice(1).join(', ')].filter(Boolean).join(' · ')}</small>
            </span>
          </li>
        ))}
      </ul>
      <p id={`${id}-status`} className={`ps-status ${status.tone}`} role="status">
        {status.tone === 'ok' && <Icon name="check" size={16} />}
        {status.tone === 'warn' && <Icon name="alert" size={16} />}
        {status.text}
      </p>
      <LeafletMap pins={[]} picked={pinned ? { lat: value.lat!, lng: value.lng! } : null}
        onPick={(lat, lng) => {
          seq.current++; setOpen(false); setResults([]); setState('idle');
          onChange({ name: value.name.trim() || `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng });
        }}
        height={mapHeight} />
    </div>
  );
}
