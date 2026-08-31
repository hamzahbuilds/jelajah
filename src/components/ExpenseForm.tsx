import { useEffect, useMemo, useState } from 'react';
import { api, fmtMYR } from '../api';
import { useT } from '../i18n';
import { Participant } from '../pages/TripShell';

export const CATEGORIES = ['accommodation', 'flight', 'transport', 'entrance', 'pass', 'food', 'shopping', 'other'] as const;
const CURRENCIES = ['MYR', 'JPY', 'SGD', 'USD', 'EUR', 'GBP', 'THB', 'IDR', 'KRW', 'CNY'];

export interface ExpenseDraft {
  category: string; description: string; vendor: string; location: string;
  expense_date: string; end_date: string; payment_date: string;
  amount_original: number; currency: string; fx_rate: number; amount_myr: number;
  payer_participant_id: number | 0;
  participant_ids: number[];
  custom: boolean;
  customShares: Record<number, number>;
  due_dates: Array<{ due_date: string; amount_myr?: number; note?: string; participant_id?: number | null }>;
}

export function emptyDraft(): ExpenseDraft {
  return {
    category: 'other', description: '', vendor: '', location: '',
    expense_date: '', end_date: '', payment_date: '',
    amount_original: 0, currency: 'MYR', fx_rate: 1, amount_myr: 0,
    payer_participant_id: 0, participant_ids: [], custom: false, customShares: {}, due_dates: [],
  };
}

/** Equal split in sen with remainder going to the first participants. */
export function equalShares(total: number, ids: number[]): Record<number, number> {
  const out: Record<number, number> = {};
  if (!ids.length) return out;
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / ids.length);
  let rem = cents - base * ids.length;
  for (const id of ids) {
    out[id] = (base + (rem > 0 ? 1 : 0)) / 100;
    if (rem > 0) rem--;
  }
  return out;
}

export default function ExpenseForm({ members, initial, onSubmit, submitLabel, busy }: {
  members: Participant[];
  initial: ExpenseDraft;
  onSubmit: (payload: any) => Promise<void>;
  submitLabel: string;
  busy?: boolean;
}) {
  const { t } = useT();
  const [d, setD] = useState<ExpenseDraft>(initial);
  const [err, setErr] = useState('');
  const [fxBusy, setFxBusy] = useState(false);
  const set = (patch: Partial<ExpenseDraft>) => setD(prev => ({ ...prev, ...patch }));

  useEffect(() => {
    if (d.currency === 'MYR' && (d.fx_rate !== 1 || d.amount_myr !== d.amount_original)) {
      set({ fx_rate: 1, amount_myr: d.amount_original });
    }
  }, [d.currency, d.amount_original]);

  const shares: Record<number, number> = useMemo(() => {
    if (d.custom) return d.customShares;
    return equalShares(d.amount_myr, d.participant_ids);
  }, [d]);
  const shareSum = Object.entries(shares)
    .filter(([id]) => d.participant_ids.includes(Number(id)))
    .reduce((a, [, v]) => a + (Number(v) || 0), 0);
  const sumOk = Math.abs(shareSum - d.amount_myr) <= 0.05;

  const toggleParticipant = (id: number) => {
    const on = d.participant_ids.includes(id);
    set({ participant_ids: on ? d.participant_ids.filter(x => x !== id) : [...d.participant_ids, id] });
  };

  const getRate = async () => {
    const date = d.payment_date || d.expense_date;
    if (!date || d.currency === 'MYR') return;
    setFxBusy(true);
    try {
      const r = await api.get(`/fx?date=${date}&from=${d.currency}&to=MYR`);
      set({ fx_rate: r.rate, amount_myr: Math.round(d.amount_original * r.rate * 100) / 100 });
    } catch {
      setErr('fx_unavailable');
    } finally {
      setFxBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!sumOk) { setErr(t.sharesMustSum); return; }
    const payload = {
      category: d.category, description: d.description, vendor: d.vendor || undefined,
      location: d.location || undefined,
      expense_date: d.expense_date || undefined, end_date: d.end_date || undefined,
      payment_date: d.payment_date || undefined,
      amount_original: Number(d.amount_original), currency: d.currency,
      fx_rate: Number(d.fx_rate), amount_myr: Number(d.amount_myr),
      payer_participant_id: Number(d.payer_participant_id),
      shares: d.participant_ids.map(id => ({ participant_id: id, amount_myr: Number(shares[id] ?? 0) })),
      due_dates: d.due_dates.filter(x => x.due_date),
    };
    await onSubmit(payload);
  };

  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        <label className="field"><span>{t.category}</span>
          <select value={d.category} onChange={e => set({ category: e.target.value })}>
            {CATEGORIES.map(c => <option key={c} value={c}>{(t as any)[c]}</option>)}
          </select>
        </label>
        <label className="field"><span>{t.vendor}</span>
          <input value={d.vendor} onChange={e => set({ vendor: e.target.value })} placeholder="Trip.com, Airbnb…" />
        </label>
        <label className="field full"><span>{t.description}</span>
          <input value={d.description} onChange={e => set({ description: e.target.value })} required />
        </label>
        <label className="field full"><span>{t.location}</span>
          <input value={d.location} onChange={e => set({ location: e.target.value })} />
        </label>
        <label className="field"><span>{t.date} ({t.checkIn}/{t.flightLegs})</span>
          <input type="date" value={d.expense_date} onChange={e => set({ expense_date: e.target.value })} />
        </label>
        <label className="field"><span>{t.checkOut} ({t.optional})</span>
          <input type="date" value={d.end_date} onChange={e => set({ end_date: e.target.value })} />
        </label>
        <label className="field"><span>{t.paymentDate}</span>
          <input type="date" value={d.payment_date} onChange={e => set({ payment_date: e.target.value })} />
        </label>
        <label className="field"><span>{t.amount}</span>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <select style={{ width: 90 }} value={d.currency} onChange={e => set({ currency: e.target.value })}>
              {CURRENCIES.map(c => <option key={c}>{c}</option>)}
            </select>
            <input type="number" step="0.01" min="0" value={d.amount_original || ''}
              onChange={e => set({ amount_original: Number(e.target.value) })} required />
          </div>
        </label>
        {d.currency !== 'MYR' && (
          <>
            <label className="field"><span>{t.fxRate} → MYR</span>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input type="number" step="0.000001" value={d.fx_rate}
                  onChange={e => {
                    const r = Number(e.target.value);
                    set({ fx_rate: r, amount_myr: Math.round(d.amount_original * r * 100) / 100 });
                  }} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={getRate} disabled={fxBusy}>
                  {fxBusy ? '…' : t.getRate}
                </button>
              </div>
            </label>
            <label className="field"><span>{t.amountMyr}</span>
              <input type="number" step="0.01" value={d.amount_myr}
                onChange={e => set({ amount_myr: Number(e.target.value) })} required />
            </label>
          </>
        )}
        <label className="field full"><span>{t.payer}</span>
          <select value={d.payer_participant_id} onChange={e => set({ payer_participant_id: Number(e.target.value) })} required>
            <option value={0} disabled>—</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
      </div>

      <div style={{ margin: '8px 0 14px' }}>
        <div className="row-between">
          <span style={{ fontWeight: 600, fontSize: '.85rem', color: 'var(--ink-2)' }}>
            {t.participants} ({d.participant_ids.length})
          </span>
          <span className="row">
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => set({ participant_ids: members.map(m => m.id) })}>{t.selectAll}</button>
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => set({ participant_ids: [] })}>{t.clearAll}</button>
          </span>
        </div>
        <div className="chips" style={{ marginTop: 6 }}>
          {members.map(m => (
            <span key={m.id} className={`chip ${d.participant_ids.includes(m.id) ? 'on' : ''}`}
              onClick={() => toggleParticipant(m.id)}>
              {m.name}{m.is_infant ? ' 👶' : ''}
            </span>
          ))}
        </div>
      </div>

      {d.participant_ids.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <label className="row" style={{ gap: 5 }}>
              <input type="radio" checked={!d.custom} onChange={() => set({ custom: false })} /> {t.equalSplit}
              <span className="tiny">({fmtMYR(d.participant_ids.length ? d.amount_myr / d.participant_ids.length : 0)} {t.perPerson})</span>
            </label>
            <label className="row" style={{ gap: 5 }}>
              <input type="radio" checked={d.custom}
                onChange={() => set({ custom: true, customShares: equalShares(d.amount_myr, d.participant_ids) })} /> {t.customSplit}
            </label>
          </div>
          {d.custom && (
            <div>
              {d.participant_ids.map(id => {
                const m = members.find(x => x.id === id);
                return (
                  <div className="share-row" key={id}>
                    <span>{m?.name}</span>
                    <input type="number" step="0.01" value={d.customShares[id] ?? 0}
                      onChange={e => set({ customShares: { ...d.customShares, [id]: Number(e.target.value) } })} />
                  </div>
                );
              })}
              <div className="tiny" style={{ textAlign: 'right', marginTop: 4 }}>
                Σ {fmtMYR(shareSum)} / {fmtMYR(d.amount_myr)}
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <div className="row-between">
          <span style={{ fontWeight: 600, fontSize: '.85rem', color: 'var(--ink-2)' }}>{t.dueDates}</span>
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => set({ due_dates: [...d.due_dates, { due_date: '' }] })}>＋ {t.addDueDate}</button>
        </div>
        {d.due_dates.map((dd, i) => (
          <div className="row" key={i} style={{ marginTop: 6 }}>
            <input type="date" value={dd.due_date} style={{ width: 150, flex: '0 0 auto' }}
              onChange={e => set({ due_dates: d.due_dates.map((x, j) => j === i ? { ...x, due_date: e.target.value } : x) })} />
            <input type="number" step="0.01" placeholder="MYR" value={dd.amount_myr ?? ''} style={{ width: 100, flex: '0 0 auto' }}
              onChange={e => set({ due_dates: d.due_dates.map((x, j) => j === i ? { ...x, amount_myr: Number(e.target.value) || undefined } : x) })} />
            <select value={dd.participant_id ?? 0} style={{ width: 170, flex: '0 0 auto' }}
              title={t.forWhom}
              onChange={e => set({ due_dates: d.due_dates.map((x, j) => j === i ? { ...x, participant_id: Number(e.target.value) || null } : x) })}>
              <option value={0}>👥 {t.wholePayment}</option>
              {members.map(m => <option key={m.id} value={m.id}>👤 {m.name}</option>)}
            </select>
            <input placeholder={t.note} value={dd.note ?? ''} style={{ flex: 1, minWidth: 90 }}
              onChange={e => set({ due_dates: d.due_dates.map((x, j) => j === i ? { ...x, note: e.target.value } : x) })} />
            <button type="button" className="icon"
              onClick={() => set({ due_dates: d.due_dates.filter((_, j) => j !== i) })}>✕</button>
          </div>
        ))}
      </div>

      {err && <p className="callout warn">{err}</p>}
      {!sumOk && d.participant_ids.length > 0 && <p className="callout warn">{t.sharesMustSum}</p>}
      <button className="btn" type="submit" disabled={busy || !d.payer_participant_id || d.participant_ids.length === 0}>
        {submitLabel}
      </button>
    </form>
  );
}
