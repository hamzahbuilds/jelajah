import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api, fmtMYR, fmtMoney, fmtDate } from '../api';
import { useT } from '../i18n';
import { useSession } from '../App';
import { TripCtx } from './TripShell';
import ExpenseForm, { CATEGORIES, emptyDraft, ExpenseDraft } from '../components/ExpenseForm';
import { useToast } from '../components/Toast';

const CAT_ICON: Record<string, string> = {
  accommodation: '🏠', flight: '✈️', transport: '🚆', entrance: '🎟️',
  pass: '🎫', food: '🍜', shopping: '🛍️', other: '📌',
};

export default function Ledger() {
  const { t, lang } = useT();
  const { user } = useSession();
  const { toast } = useToast();
  const { tripId, members } = useOutletContext<TripCtx>();
  const [data, setData] = useState<any>(null);
  const [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<any | 'new' | null>(null);

  const load = async () => setData(await api.get(`/trips/${tripId}/expenses`));
  useEffect(() => { load(); }, [tripId]);

  const sharesByExpense = useMemo(() => {
    const map = new Map<number, any[]>();
    for (const s of data?.shares ?? []) {
      if (!map.has(s.expense_id)) map.set(s.expense_id, []);
      map.get(s.expense_id)!.push(s);
    }
    return map;
  }, [data]);

  const list = (data?.expenses ?? []).filter((e: any) => filter === 'all' || e.category === filter);
  const total = list.reduce((a: number, e: any) => a + e.amount_myr, 0);
  const pname = (id: number) => members.find(m => m.id === id)?.name ?? '?';

  const draftFor = (e: any): ExpenseDraft => {
    const d = emptyDraft();
    const shares = sharesByExpense.get(e.id) ?? [];
    Object.assign(d, {
      category: e.category, description: e.description, vendor: e.vendor ?? '', location: e.location ?? '',
      expense_date: e.expense_date ?? '', end_date: e.end_date ?? '', payment_date: e.payment_date ?? '',
      amount_original: e.amount_original, currency: e.currency, fx_rate: e.fx_rate, amount_myr: e.amount_myr,
      payer_participant_id: e.payer_participant_id ?? 0,
      payment_status: e.payment_status === 'pay_at_hotel' ? 'pay_at_hotel' : 'paid',
      participant_ids: shares.map((s: any) => s.participant_id),
      custom: true,
      customShares: Object.fromEntries(shares.map((s: any) => [s.participant_id, s.amount_myr])),
      due_dates: (data?.due_dates ?? []).filter((x: any) => x.expense_id === e.id)
        .map((x: any) => ({ due_date: x.due_date, amount_myr: x.amount_myr ?? undefined, note: x.note ?? undefined, participant_id: x.participant_id ?? null })),
    });
    return d;
  };

  const save = async (payload: any) => {
    if (editing === 'new') await api.post(`/trips/${tripId}/expenses`, payload);
    else await api.put(`/expenses/${editing.id}`, payload);
    setEditing(null);
    toast(t.tExpenseSaved);
    await load();
  };

  const remove = async (e: any) => {
    if (!window.confirm(t.confirmDelete)) return;
    await api.del(`/expenses/${e.id}`);
    toast(t.tExpenseDeleted);
    await load();
  };

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 12 }}>
        <div className="row">
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 190 }}>
            <option value="all">{t.allCategories}</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{(t as any)[c]}</option>)}
          </select>
          <span className="muted">{list.length} {t.expenses} · <strong>{fmtMYR(total)}</strong></span>
        </div>
        {user.role === 'admin' && <button className="btn" onClick={() => setEditing('new')}>＋ {t.addExpense}</button>}
      </div>

      <div className="card tablewrap">
        {list.length === 0 && <p className="muted">{t.noExpenses}</p>}
        {list.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>{t.category}</th><th>{t.description}</th>
                <th className="hide-sm">{t.date}</th><th className="hide-sm">{t.payer}</th>
                <th className="hide-sm">{t.participants}</th>
                <th className="num">{t.amountMyr}</th>
                {user.role === 'admin' && <th />}
              </tr>
            </thead>
            <tbody>
              {list.map((e: any) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{CAT_ICON[e.category]} {(t as any)[e.category]}</td>
                  <td>
                    {e.description}
                    {e.payment_status === 'pay_at_hotel' && (
                      <>
                        {' '}<span className="badge warn" title={t.committedNote}>🏨💤 {t.payAtHotel}</span>
                        {user.role === 'admin' && (
                          <button className="btn btn-ghost btn-sm" style={{ marginLeft: 6 }}
                            onClick={async () => { await api.patch(`/expenses/${e.id}/status`, { payment_status: 'paid' }); toast(t.tMarkedPaid); await load(); }}>
                            {t.markPaid}
                          </button>
                        )}
                      </>
                    )}
                    <div className="tiny">
                      {e.vendor ?? ''}{e.document_id ? ` · 📎 ${t.documentCol} #${e.document_id}` : ''}
                      {e.currency !== 'MYR' ? ` · ${fmtMoney(e.amount_original, e.currency)} @ ${e.fx_rate}` : ''}
                    </div>
                  </td>
                  <td className="hide-sm" style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.expense_date, lang)}</td>
                  <td className="hide-sm">{e.payer_participant_id ? pname(e.payer_participant_id) : '—'}</td>
                  <td className="hide-sm">{(sharesByExpense.get(e.id) ?? []).length}</td>
                  <td className="num"><strong>{fmtMYR(e.amount_myr)}</strong></td>
                  {user.role === 'admin' && (
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="icon" onClick={() => setEditing(e)} aria-label={t.edit}>✏️</button>
                      <button className="icon" onClick={() => remove(e)} aria-label={t.delete}>🗑️</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div className="overlay" onClick={() => setEditing(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="row-between">
              <h2>{editing === 'new' ? t.addExpense : t.editExpense}</h2>
              <button className="icon" onClick={() => setEditing(null)}>✕</button>
            </div>
            <ExpenseForm members={members}
              initial={editing === 'new' ? emptyDraft() : draftFor(editing)}
              submitLabel={t.save} onSubmit={save} />
          </div>
        </div>
      )}
    </div>
  );
}
