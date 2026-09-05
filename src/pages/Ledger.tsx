import { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api, fmtMYR, fmtMoney, fmtDate } from '../api';
import { useT } from '../i18n';
import { TripCtx } from './TripShell';
import ExpenseForm, { CATEGORIES, emptyDraft, ExpenseDraft } from '../components/ExpenseForm';
import { useToast } from '../components/Toast';
import MoneyTabs from '../components/MoneyTabs';
import PageHead from '../components/PageHead';
import Empty from '../components/Empty';
import Modal from '../components/Modal';
import { Icon, type IconName } from '../components/Icon';

// tile icon by category — plane/hotel/train/ticket/food, falling back to a
// generic receipt for anything without a closer match (shopping, other…).
const CAT_ICON: Record<string, IconName> = {
  flight: 'plane', accommodation: 'hotel', transport: 'train', entrance: 'ticket', pass: 'ticket', food: 'food',
};

export default function Ledger() {
  const { t, lang } = useT();
  const { toast } = useToast();
  const { trip, tripId, members, canLead } = useOutletContext<TripCtx>();
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
  // stat trio — derived purely from the already-loaded (filtered) list, no new fetch.
  const committedTotal = list.filter((e: any) => e.payment_status === 'pay_at_hotel').reduce((a: number, e: any) => a + e.amount_myr, 0);
  const paidTotal = total - committedTotal;
  const paidPct = total > 0 ? Math.round((paidTotal / total) * 100) : 0;
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
      <PageHead crumb={trip.name} title={t.money} sub={t.moneySub} />
      <MoneyTabs />

      <div className="stats">
        <div className="card stat">
          <span className="k"><span className="tile sm"><Icon name="wallet" /></span>{t.tripTotal}</span>
          <span className="v">{fmtMYR(total)}</span>
          <span className="t">{list.length} {t.expenses}</span>
        </div>
        <div className="card stat">
          <span className="k"><span className="tile sm"><Icon name="hotel" /></span>{t.committed}</span>
          <span className="v">{fmtMYR(committedTotal)}</span>
          <span className="t">{t.committedNote}</span>
        </div>
        <div className="card stat">
          <span className="k"><span className="tile sm"><Icon name="check" /></span>{t.paidLbl}</span>
          <span className="v">{fmtMYR(paidTotal)}</span>
          {total > 0 && <span className="t"><span className="trend-up">▲ {t.pctOfTotal(paidPct)}</span></span>}
        </div>
      </div>

      <div className="card">
        <div className="cardhead">
          <h3>{t.ledger}</h3>
          {list.length > 0 && <span className="badge gray">{list.length} {t.expenses}</span>}
        </div>
        <div className="row-between" style={{ marginBottom: 10 }}>
          <select value={filter} onChange={e => setFilter(e.target.value)} style={{ width: 190 }}>
            <option value="all">{t.allCategories}</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{(t as any)[c]}</option>)}
          </select>
          {canLead && (
            <button type="button" className="btn sm" onClick={() => setEditing('new')}>
              <Icon name="plus" size={16} /> {t.addExpense}
            </button>
          )}
        </div>

        {list.length === 0 && (
          <Empty icon="receipt" title={t.noExpenses} sub={t.noExpensesSub}
            action={canLead ? { label: t.addExpense, onClick: () => setEditing('new') } : undefined} />
        )}

        {list.map((e: any) => {
          const metaBits = [
            e.currency !== 'MYR' ? `${fmtMoney(e.amount_original, e.currency)} @ ${e.fx_rate}` : null,
            e.document_id ? `${t.documentCol} #${e.document_id}` : null,
          ].filter(Boolean).join(' · ');
          const shareCount = (sharesByExpense.get(e.id) ?? []).length;
          return (
            <div className="lrow" key={e.id}>
              <span className="tile"><Icon name={CAT_ICON[e.category] ?? 'receipt'} /></span>
              <div className="l-main">
                <b>{e.description}</b>
                <small>
                  {fmtDate(e.expense_date, lang)}
                  {e.payer_participant_id ? ` · ${pname(e.payer_participant_id)}` : ''}
                  {shareCount > 0 ? ` · ${shareCount} ${t.participants}` : ''}
                  {e.vendor ? ` · ${e.vendor}` : ''}
                </small>
              </div>
              <div className="l-amt">
                {fmtMYR(e.amount_myr)}
                {metaBits && <small>{metaBits}</small>}
              </div>
              <div className="l-end">
                {e.payment_status === 'pay_at_hotel'
                  ? <span className="badge warning" title={t.committedNote}><span className="d" />{t.payAtHotel}</span>
                  : <span className="badge success"><span className="d" />{t.paidLbl}</span>}
                {canLead && e.payment_status === 'pay_at_hotel' && (
                  <button type="button" className="btn ghost sm"
                    onClick={async () => { await api.patch(`/expenses/${e.id}/status`, { payment_status: 'paid' }); toast(t.tMarkedPaid); await load(); }}>
                    {t.markPaid}
                  </button>
                )}
                {canLead && (
                  <>
                    <button type="button" className="btn ghost sm" aria-label={t.edit} onClick={() => setEditing(e)}>
                      <Icon name="edit" size={16} />
                    </button>
                    <button type="button" className="btn ghost sm" aria-label={t.delete} onClick={() => remove(e)}>
                      <Icon name="trash" size={16} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} closeLabel={t.close}
        icon={editing === 'new' ? 'plus' : 'edit'}
        title={editing === 'new' ? t.addExpense : t.editExpense}>
        {editing && (
          <ExpenseForm members={members}
            initial={editing === 'new' ? emptyDraft() : draftFor(editing)}
            submitLabel={t.save} onSubmit={save} />
        )}
      </Modal>
    </div>
  );
}
