// src/components/FxWidget.tsx
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { Icon } from './Icon';
import Dialog from './Dialog';

import { FX_WINDOWS, FxWindow } from '../../shared/fxband';
import { AnimatePresence } from 'motion/react';

const WINDOWS = Object.keys(FX_WINDOWS) as FxWindow[];
type Win = FxWindow;

interface Series {
  base: string; quote: string; points: Array<{ date: string; rate: number }>;
  band: { low: number; high: number } | null; signal: 'buy' | 'ok' | 'wait' | null;
  current: { date: string; rate: number };
}

const SIGNAL_VARIANT = { buy: 'success', ok: 'gray', wait: 'warning' } as const;

function Sparkline({ s }: { s: Series }) {
  const W = 480, H = 72, P = 3;
  const rates = s.points.map(p => p.rate);
  const lo = Math.min(...rates, s.band?.low ?? Infinity);
  const hi = Math.max(...rates, s.band?.high ?? -Infinity);
  const span = hi - lo || 1;
  const x = (i: number) => P + (i / Math.max(s.points.length - 1, 1)) * (W - 2 * P);
  const y = (r: number) => H - P - ((r - lo) / span) * (H - 2 * P);
  return (
    <svg className="fx-spark" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" aria-hidden>
      {s.band && (
        <rect x={0} y={y(s.band.high)} width={W} height={Math.max(y(s.band.low) - y(s.band.high), 1)}
          className="fx-band" />
      )}
      <polyline className="fx-line" fill="none"
        points={s.points.map((p, i) => `${x(i)},${y(p.rate)}`).join(' ')} />
      <circle className="fx-dot" cx={x(s.points.length - 1)} cy={y(s.current.rate)} r={2.5} />
    </svg>
  );
}

/** Base + watch pickers, shared by the widget's editor and the trip create form. */
export function CurrencyFields({ base, watch, onBase, onWatch, locked, multi, onMulti }: {
  base: string; watch: string[]; onBase: (c: string) => void; onWatch: (w: string[]) => void;
  /** Base is shown read-only (it changes, with conversion, in trip settings). */
  locked?: boolean;
  /** When given, a "more than one currency" switch is shown and the watch
   *  list only appears while it is on. */
  multi?: boolean; onMulti?: (on: boolean) => void;
}) {
  const { t } = useT();
  const [all, setAll] = useState<Array<{ code: string; name: string }>>([]);
  const [add, setAdd] = useState('');
  useEffect(() => { api.get('/currencies').then(setAll).catch(() => setAll([])); }, []);
  const resolve = (v: string) => {
    const s = v.trim().toUpperCase();
    return all.find(c => c.code === s)?.code
      ?? all.find(c => c.name.toUpperCase() === v.trim().toUpperCase())?.code ?? null;
  };
  const tryAdd = (v: string) => {
    const code = resolve(v);
    if (code && code !== base && !watch.includes(code) && watch.length < 6) onWatch([...watch, code]);
    if (code) setAdd('');
  };
  return (
    <>
      <label className="fld"><span>{t.fxRefCurrency}</span>
        <select value={base} disabled={locked} aria-describedby="fx-ref-hint"
          onChange={e => { onBase(e.target.value); onWatch(watch.filter(w => w !== e.target.value)); }}>
          {all.map(c => <option key={c.code} value={c.code}>{c.code} · {c.name}</option>)}
          {!all.some(c => c.code === base) && <option value={base}>{base}</option>}
        </select>
        <span id="fx-ref-hint" className="tiny muted">{locked ? t.fxRefLocked : t.fxRefHint}</span></label>
      {onMulti && (
        <label className="check-row full">
          <input type="checkbox" role="switch" {...{ switch: '' }} checked={!!multi} onChange={e => onMulti(e.target.checked)} />
          <span><Icon name="swap" size={16} /> {t.multiCurrency}</span>
        </label>
      )}
      {(!onMulti || multi) && <div className="fld full"><span>{t.fxWatchCurrencies} <span className="tiny">({t.fxMax6})</span></span>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {watch.map(w => (
            <span key={w} className="chip on">{w}
              <button type="button" className="icon" onClick={() => onWatch(watch.filter(x => x !== w))} aria-label={`${t.remove} ${w}`}><Icon name="x" size={16} /></button>
            </span>
          ))}
          <input list="fx-codes" value={add} placeholder={t.fxAddCurrency} style={{ minWidth: 180 }}
            onChange={e => { setAdd(e.target.value); if (resolve(e.target.value)) tryAdd(e.target.value); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); tryAdd(add); } }} />
          <datalist id="fx-codes">
            {all.filter(c => c.code !== base && !watch.includes(c.code))
              .map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
          </datalist>
        </div>
      </div>}
    </>
  );
}

export default function FxWidget({ tripId, trip, isAdmin, onChanged }: {
  tripId: number; trip: any; isAdmin: boolean; onChanged: () => void;
}) {
  const { t } = useT();
  let watch: string[] = [];
  try { watch = JSON.parse(trip?.watch_currencies ?? '[]'); } catch { /* empty */ }
  const [win, setWin] = useState<Win>(() => {
    try { const w = localStorage.getItem('fx_window'); return (WINDOWS as readonly string[]).includes(w ?? '') ? w as Win : '1m'; }
    catch { return '1m'; }
  });
  const [series, setSeries] = useState<Record<string, Series | 'error'>>({});
  const [editor, setEditor] = useState<{ base: string; watch: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  useEffect(() => {
    setSeries({});
    for (const q of watch) {
      api.get(`/trips/${tripId}/fxseries?quote=${q}&window=${win}`)
        .then(s => setSeries(prev => ({ ...prev, [q]: s })))
        .catch(() => setSeries(prev => ({ ...prev, [q]: 'error' })));
    }
  }, [tripId, win, trip?.watch_currencies]);

  const pickWin = (w: Win) => { setWin(w); try { localStorage.setItem('fx_window', w); } catch { /* ignore */ } };
  const save = async () => {
    if (!editor) return;
    setBusy(true); setSaveErr('');
    try {
      await api.patch(`/trips/${tripId}/currencies`, { base_currency: editor.base, watch_currencies: editor.watch });
      setEditor(null); onChanged();
    } catch (e: any) {
      setSaveErr(e?.code === 'currency_locked' ? t.fxRefLocked : t.fxUnavailable);
    } finally { setBusy(false); }
  };

  if (!watch.length && !isAdmin) return null;

  return (
    <div className="card">
      <div className="row-between">
        <h3><Icon name="swap" size={16} /> {t.fxTitle}</h3>
        <span className="row" style={{ gap: 6 }}>
          {watch.length > 0 && (
            <span className="seg">
              {WINDOWS.map(w => (
                <button key={w} className={win === w ? 'on' : ''}
                  onClick={() => pickWin(w)}>{w.toUpperCase()}</button>
              ))}
            </span>
          )}
          {isAdmin && (
            <button className="btn ghost sm" title={t.fxEditCurrencies}
              onClick={() => { setSaveErr(''); setEditor({ base: trip.base_currency ?? 'MYR', watch }); }}>
              {watch.length ? <Icon name="settings" size={16} /> : <><Icon name="settings" size={16} /> {t.fxSetup}</>}
            </button>
          )}
        </span>
      </div>
      {watch.map(q => {
        const s = series[q];
        return (
          <div className="fx-row" key={q}>
            {s === undefined && <span className="muted tiny">…</span>}
            {s === 'error' && <span className="muted tiny">{q}: {t.fxUnavailable}</span>}
            {s && s !== 'error' && (
              <>
                <div className="fx-head">
                  <strong>1 {s.base} = {s.current.rate.toLocaleString(undefined, { maximumSignificantDigits: 5 })} {s.quote}</strong>
                  {s.points.length >= 2 && (() => {
                    const last = s.points[s.points.length - 1].rate;
                    const prev = s.points[s.points.length - 2].rate;
                    if (last === prev) return null;
                    const pct = ((last - prev) / prev) * 100;
                    const up = last > prev;
                    return (
                      <span className={`fx-delta ${up ? 'up' : 'down'}`}>
                        {up ? '▲' : '▼'} {Math.abs(pct).toFixed(2)}%
                      </span>
                    );
                  })()}
                  {s.signal && (
                    <span className={`badge ${SIGNAL_VARIANT[s.signal]}`}>
                      <span className="d" /> {s.signal === 'buy' ? t.fxBuy : s.signal === 'ok' ? t.fxOk : t.fxWait}
                    </span>
                  )}
                  {!s.signal && <span className="badge gray">{t.fxNoHistory}</span>}
                </div>
                <Sparkline s={s} />
                <div className="tiny muted">{t.fxVsDays(FX_WINDOWS[win])}
                  {s.band && <> · {s.band.low.toLocaleString(undefined, { maximumSignificantDigits: 5 })}–{s.band.high.toLocaleString(undefined, { maximumSignificantDigits: 5 })}</>}
                </div>
              </>
            )}
          </div>
        );
      })}
      <AnimatePresence>{editor && (
        <Dialog className="overlay-dlg modal" onClose={() => setEditor(null)} label={t.fxEditCurrencies}>
            <h2><Icon name="swap" size={16} /> {t.fxEditCurrencies}</h2>
            <div className="form-grid">
              <CurrencyFields base={editor.base} watch={editor.watch}
                onBase={b => setEditor({ ...editor, base: b })}
                onWatch={w => setEditor({ ...editor, watch: w })} locked />
            </div>
            {saveErr && <p className="callout warn" role="alert"><Icon name="alert" size={16} /> {saveErr}</p>}
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setEditor(null)}>{t.cancel}</button>
              <button className="btn" disabled={busy} onClick={save}>{t.save}</button>
            </div>
        </Dialog>
      )}</AnimatePresence>
    </div>
  );
}
