import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api, fmtMYR, fmtMoney, fmtDate } from '../api';
import { useT } from '../i18n';
import { useSession } from '../App';
import { TripCtx } from './TripShell';

const CATS = ['food', 'shopping', 'transport', 'entrance', 'other'] as const;
const CAT_ICON: Record<string, string> = { food: '🍜', shopping: '🛍️', transport: '🚇', entrance: '🎟️', other: '📌' };

export default function MySpend() {
  const { t, lang } = useT();
  const { user } = useSession();
  const { tripId } = useOutletContext<TripCtx>();
  const [items, setItems] = useState<any[]>([]);
  const [form, setForm] = useState({
    spend_date: new Date().toISOString().slice(0, 10),
    category: 'food', description: '', amount: '', currency: 'JPY', behalf_note: '',
  });
  const [rate, setRate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => setItems(await api.get(`/trips/${tripId}/myspend`));
  useEffect(() => { load(); }, [tripId]);
  useEffect(() => {
    if (form.currency === 'MYR') { setRate(1); return; }
    api.get(`/fx?date=${form.spend_date}&from=${form.currency}&to=MYR`)
      .then(r => setRate(r.rate)).catch(() => setRate(null));
  }, [form.currency, form.spend_date]);

  const total = items.reduce((a, i) => a + i.amount_myr, 0);
  const byCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of items) m[i.category] = (m[i.category] ?? 0) + i.amount_myr;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [items]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(form.amount);
    if (!(amt > 0) || !form.description.trim()) return;
    setBusy(true);
    try {
      const r = rate ?? (form.currency === 'MYR' ? 1 : 0.03);
      await api.post(`/trips/${tripId}/myspend`, {
        spend_date: form.spend_date, category: form.category, description: form.description,
        amount_original: amt, currency: form.currency, fx_rate: r,
        amount_myr: Math.round(amt * r * 100) / 100,
        behalf_note: form.behalf_note || undefined,
      });
      setForm({ ...form, description: '', amount: '', behalf_note: '' });
      await load();
    } finally { setBusy(false); }
  };

  const remove = async (i: any) => {
    if (!window.confirm(t.confirmDelete)) return;
    await api.del(`/myspend/${i.id}`);
    await load();
  };

  const promote = async (i: any) => {
    if (!window.confirm(t.promoteConfirm)) return;
    try {
      await api.post(`/myspend/${i.id}/promote`);
      await load();
    } catch (e: any) {
      if (e?.code === 'no_linked_participant') window.alert(t.linkParticipantFirst);
    }
  };

  return (
    <div>
      <p className="callout info">🔒 {t.privateNote}</p>
      <div className="stats">
        <div className="stat">
          <div className="label">{t.spentThisTrip}</div>
          <div className="value">{fmtMYR(total)}</div>
          <div className="sub">{items.length}</div>
        </div>
        {byCat.slice(0, 2).map(([c, v]) => (
          <div className="stat" key={c}>
            <div className="label">{CAT_ICON[c]} {(t as any)[c]}</div>
            <div className="value">{fmtMYR(v)}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <form className="card" onSubmit={add}>
          <h3>{t.addSpend}</h3>
          <div className="form-grid">
            <label className="field"><span>{t.date}</span>
              <input type="date" value={form.spend_date} onChange={e => setForm({ ...form, spend_date: e.target.value })} required /></label>
            <label className="field"><span>{t.category}</span>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {CATS.map(c => <option key={c} value={c}>{CAT_ICON[c]} {(t as any)[c]}</option>)}
              </select></label>
            <label className="field full"><span>{t.description}</span>
              <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required /></label>
            <label className="field"><span>{t.amount}</span>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <select style={{ width: 88 }} value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>
                  {['JPY', 'MYR', 'USD', 'SGD'].map(c => <option key={c}>{c}</option>)}
                </select>
                <input type="number" step="0.01" min="0" value={form.amount}
                  onChange={e => setForm({ ...form, amount: e.target.value })} required />
              </div>
              {form.currency !== 'MYR' && form.amount && rate != null && (
                <span className="tiny">≈ {fmtMYR(Number(form.amount) * rate)}</span>
              )}
            </label>
            <label className="field"><span>{t.behalfOf}</span>
              <input value={form.behalf_note} onChange={e => setForm({ ...form, behalf_note: e.target.value })}
                placeholder="e.g. Ain ¥2000, Mak ¥1500" /></label>
          </div>
          <button className="btn" disabled={busy}>{t.add}</button>
        </form>

        <div className="card">
          {items.length === 0 && <p className="muted">{t.noSpend}</p>}
          {items.map(i => (
            <div className="row-between" key={i.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ minWidth: 0 }}>
                <div>{CAT_ICON[i.category] ?? '📌'} {i.description}</div>
                <div className="tiny">
                  {fmtDate(i.spend_date, lang)}
                  {i.currency !== 'MYR' ? ` · ${fmtMoney(i.amount_original, i.currency)}` : ''}
                  {i.behalf_note ? ` · 🤝 ${i.behalf_note}` : ''}
                </div>
              </div>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <strong style={{ whiteSpace: 'nowrap' }}>{fmtMYR(i.amount_myr)}</strong>
                {user.participant_id != null && (
                  <button className="icon" title={t.promote} onClick={() => promote(i)}>📤</button>
                )}
                <button className="icon" onClick={() => remove(i)}>🗑️</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
