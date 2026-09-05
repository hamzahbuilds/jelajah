import { useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api, fmtMYR, fmtMoney, fmtDate } from '../api';
import { useT } from '../i18n';
import { useSession } from '../App';
import { TripCtx } from './TripShell';
import { useToast } from '../components/Toast';
import MoneyTabs from '../components/MoneyTabs';
import PageHead from '../components/PageHead';
import Empty from '../components/Empty';
import { Icon, type IconName } from '../components/Icon';

const CATS = ['food', 'shopping', 'transport', 'entrance', 'other'] as const;
// tile icon by category, falling back to a generic receipt (shopping/other
// have no closer match in the shared icon sprite).
const CAT_ICON: Record<string, IconName> = { food: 'food', transport: 'train', entrance: 'ticket' };
// the old emoji dict stays for the (untouched) add-spend form's <option> labels.
const CAT_EMOJI: Record<string, string> = { food: '🍜', shopping: '🛍️', transport: '🚇', entrance: '🎟️', other: '📌' };

export default function MySpend() {
  const { t, lang } = useT();
  const { user } = useSession();
  const { toast } = useToast();
  const { trip, tripId, members } = useOutletContext<TripCtx>();
  const [items, setItems] = useState<any[]>([]);
  const [shares, setShares] = useState<any[]>([]);   // shares on MY items (they owe me)
  const [tagged, setTagged] = useState<any[]>([]);   // shares others tagged ME in (I owe)
  const [form, setForm] = useState({
    spend_date: new Date().toISOString().slice(0, 10),
    category: 'food', description: '', amount: '', currency: 'JPY', behalf_note: '',
    participant_ids: [] as number[], include_self: true,
  });
  const [rate, setRate] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const descRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const r = await api.get(`/trips/${tripId}/myspend`);
    setItems(r.items ?? []);
    setShares(r.shares ?? []);
    setTagged(await api.get(`/trips/${tripId}/myspend/tagged`).catch(() => []));
  };
  useEffect(() => { load(); }, [tripId]);
  useEffect(() => {
    if (form.currency === 'MYR') { setRate(1); return; }
    // stale-response guard: rapid currency/date changes must not let an older
    // fx response overwrite a newer one (the "MySpend fx race" ticket)
    let stale = false;
    setRate(null);
    api.get(`/fx?date=${form.spend_date}&from=${form.currency}&to=MYR`)
      .then(r => { if (!stale) setRate(r.rate); })
      .catch(() => { if (!stale) setRate(null); });
    return () => { stale = true; };
  }, [form.currency, form.spend_date]);

  const total = items.reduce((a, i) => a + i.amount_myr, 0);
  const byCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const i of items) m[i.category] = (m[i.category] ?? 0) + i.amount_myr;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [items]);
  const sharesByItem = useMemo(() => {
    const m = new Map<number, any[]>();
    for (const s of shares) {
      if (!m.has(s.personal_expense_id)) m.set(s.personal_expense_id, []);
      m.get(s.personal_expense_id)!.push(s);
    }
    return m;
  }, [shares]);
  const owedToMe = shares.filter(s => !s.settled).reduce((a, s) => a + s.amount_myr, 0);
  const iOwe = tagged.filter(s => !s.settled).reduce((a, s) => a + s.amount_myr, 0);

  // tag choices: other participants on this trip (not my own linked participant)
  const taggable = members.filter(m => m.id !== user.participant_id && !m.is_infant);
  const toggleTag = (id: number) => {
    setForm(f => ({
      ...f,
      participant_ids: f.participant_ids.includes(id)
        ? f.participant_ids.filter(x => x !== id)
        : [...f.participant_ids, id],
    }));
  };
  const splitPreview = () => {
    if (rate == null) return 0; // rate still loading — no fantasy estimates
    const amt = Number(form.amount) * rate;
    const n = form.participant_ids.length + (form.include_self ? 1 : 0);
    return n > 0 && amt > 0 ? amt / n : 0;
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(form.amount);
    if (!(amt > 0) || !form.description.trim()) return;
    setBusy(true);
    try {
      // never submit a made-up rate: if the async fetch hasn't landed, get it
      // now; a hard failure blocks the save rather than recording wrong money
      let r = rate;
      if (r == null) {
        try {
          r = (await api.get(`/fx?date=${form.spend_date}&from=${form.currency}&to=MYR`)).rate;
        } catch { r = null; }
      }
      if (r == null) { toast(t.tSaveFailed, 'error'); setBusy(false); return; }
      await api.post(`/trips/${tripId}/myspend`, {
        spend_date: form.spend_date, category: form.category, description: form.description,
        amount_original: amt, currency: form.currency, fx_rate: r,
        amount_myr: Math.round(amt * r * 100) / 100,
        behalf_note: form.behalf_note || undefined,
        participant_ids: form.participant_ids,
        include_self: form.include_self,
      });
      setForm({ ...form, description: '', amount: '', behalf_note: '', participant_ids: [] });
      toast(t.tSpendAdded);
      await load();
    } finally { setBusy(false); }
  };

  const remove = async (i: any) => {
    if (!window.confirm(t.confirmDelete)) return;
    await api.del(`/myspend/${i.id}`);
    toast(t.tDeleted);
    await load();
  };

  const promote = async (i: any) => {
    if (!window.confirm(t.promoteConfirm)) return;
    try {
      await api.post(`/myspend/${i.id}/promote`);
      toast(t.tPromoted);
      await load();
    } catch (e: any) {
      if (e?.code === 'no_linked_participant') window.alert(t.linkParticipantFirst);
    }
  };

  const settleShare = async (s: any, settled: boolean) => {
    await api.patch(`/myspend/shares/${s.id}/settle`, { settled });
    if (settled) toast(t.tSettled);
    await load();
  };

  return (
    <div>
      <PageHead crumb={trip.name} title={t.money} sub={t.moneySub} />
      <MoneyTabs />
      <p className="callout info"><Icon name="shield" size={16} /> {t.privateNote}</p>
      <div className="stats">
        <div className="card stat">
          <span className="k"><span className="tile sm"><Icon name="wallet" /></span>{t.spentThisTrip}</span>
          <span className="v">{fmtMYR(total)}</span>
          <span className="t">{items.length} {t.expenses}</span>
        </div>
        {owedToMe > 0 && (
          <div className="card stat">
            <span className="k"><span className="tile sm"><Icon name="coins" /></span>{t.owedToMe}</span>
            <span className="v">{fmtMYR(owedToMe)}</span>
          </div>
        )}
        {iOwe > 0 && (
          <div className="card stat">
            <span className="k"><span className="tile sm"><Icon name="coins" /></span>{t.iOwe}</span>
            <span className="v">{fmtMYR(iOwe)}</span>
          </div>
        )}
        {byCat.slice(0, 1).map(([c, v]) => (
          <div className="card stat" key={c}>
            <span className="k"><span className="tile sm"><Icon name={CAT_ICON[c] ?? 'receipt'} /></span>{(t as any)[c]}</span>
            <span className="v">{fmtMYR(v)}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <form className="card" onSubmit={add}>
          <h3>{t.addSpend}</h3>
          <div className="form-grid">
            <label className="fld"><span>{t.date}</span>
              <input type="date" value={form.spend_date} onChange={e => setForm({ ...form, spend_date: e.target.value })} required /></label>
            <label className="fld"><span>{t.category}</span>
              <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                {CATS.map(c => <option key={c} value={c}>{CAT_EMOJI[c]} {(t as any)[c]}</option>)}
              </select></label>
            <label className="fld full"><span>{t.description}</span>
              <input ref={descRef} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} required /></label>
            <label className="fld"><span>{t.amount}</span>
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
            <label className="fld"><span>{t.behalfOf}</span>
              <input value={form.behalf_note} onChange={e => setForm({ ...form, behalf_note: e.target.value })}
                placeholder="e.g. Ain ¥2000, Mak ¥1500" /></label>
          </div>

          {taggable.length > 0 && (
            <div style={{ margin: '4px 0 12px' }}>
              <span style={{ display: 'block', fontSize: '.8rem', fontWeight: 600, color: 'var(--ink-2)', marginBottom: 3 }}>
                {t.tagPeople}
              </span>
              <div className="chips">
                {taggable.map(m => (
                  <span key={m.id} className={`chip ${form.participant_ids.includes(m.id) ? 'on' : ''}`}
                    onClick={() => toggleTag(m.id)}>{m.name}</span>
                ))}
              </div>
              {form.participant_ids.length > 0 && (
                <div className="tiny" style={{ marginTop: 5 }}>
                  <label className="row" style={{ gap: 5, display: 'inline-flex' }}>
                    <input type="checkbox" checked={form.include_self}
                      onChange={e => setForm({ ...form, include_self: e.target.checked })} /> {t.includeMe}
                  </label>
                  {splitPreview() > 0 && <> · {fmtMYR(splitPreview())} {t.perHead}</>}
                  <div>{t.peerHint}</div>
                </div>
              )}
            </div>
          )}
          <button className="btn" disabled={busy}>{t.add}</button>
        </form>

        <div>
          <div className="card">
            {items.length === 0 && (
              <Empty icon="eye" title={t.myspendEmpty} sub={t.myspendEmptySub}
                action={{ label: t.addSpend, onClick: () => descRef.current?.focus() }} />
            )}
            {items.map(i => (
              <div key={i.id} className="lrow" style={{ flexWrap: 'wrap' }}>
                <span className="tile sm"><Icon name={CAT_ICON[i.category] ?? 'receipt'} /></span>
                <div className="l-main">
                  <b>{i.description}</b>
                  <small>
                    {fmtDate(i.spend_date, lang)}
                    {i.currency !== 'MYR' ? ` · ${fmtMoney(i.amount_original, i.currency)}` : ''}
                    {i.behalf_note ? ` · ${i.behalf_note}` : ''}
                  </small>
                </div>
                <div className="l-end">
                  <strong style={{ whiteSpace: 'nowrap' }}>{fmtMYR(i.amount_myr)}</strong>
                  {user.participant_id != null && (
                    <button type="button" className="btn ghost sm" title={t.promote} aria-label={t.promote} onClick={() => promote(i)}>
                      <Icon name="swap" size={16} />
                    </button>
                  )}
                  <button type="button" className="btn ghost sm" aria-label={t.delete} onClick={() => remove(i)}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
                {(sharesByItem.get(i.id) ?? []).map(s => (
                  <div key={s.id} className={`peer-row ${s.settled ? 'settled' : ''}`} style={{ marginLeft: 20, flexBasis: '100%' }}>
                    <span>{s.participant_name}</span>
                    <span className="row" style={{ flexWrap: 'nowrap' }}>
                      <span className="amt">{fmtMYR(s.amount_myr)}</span>
                      <button type="button" className="btn ghost sm" onClick={() => settleShare(s, !s.settled)}>
                        {s.settled ? t.unmarkReceived : t.markReceived}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {tagged.length > 0 && (
            <div className="card">
              <div className="cardhead"><h3>{t.iOwe}</h3></div>
              {tagged.map(s => (
                <div key={s.share_id} className={`peer-row ${s.settled ? 'settled' : ''}`}>
                  <span>
                    {s.description}
                    <span className="tiny"> · {fmtDate(s.spend_date, lang)} · → {s.owner_name}</span>
                  </span>
                  <span className="amt">{fmtMYR(s.amount_myr)}{s.settled ? ` · ${t.settledLbl}` : ''}</span>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
