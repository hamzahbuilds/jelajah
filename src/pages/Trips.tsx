import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { useT } from '../i18n';
import { useSession } from '../App';
import { StylePicker } from '../components/TripStyle';
import { useToast } from '../components/Toast';
import { CurrencyFields } from '../components/FxWidget';

export default function Trips() {
  const { t, lang } = useT();
  const { toast } = useToast();
  const { user, trips, refresh } = useSession();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', destination: '', start_date: '', end_date: '', emoji: '🧳', color: '', base_currency: 'MYR', watch_currencies: [] as string[] });

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.post('/trips', form);
    setOpen(false);
    toast(t.tTripCreated);
    await refresh();
  };

  return (
    <div>
      <div className="row-between" style={{ margin: '20px 0 14px' }}>
        <h1>{t.myTrips}</h1>
        {user.role === 'admin' && <button className="btn" onClick={() => setOpen(true)}>＋ {t.newTrip}</button>}
      </div>
      {trips.length === 0 && <div className="card muted">{t.noTrips}</div>}
      <div className="grid grid-2">
        {trips.map(tr => (
          <Link key={tr.id} to={`/trips/${tr.id}`} className="card"
            style={{ display: 'block', borderTop: `4px solid ${(tr as any).color || 'var(--brand)'}` }}>
            <div style={{ fontSize: '1.7rem' }}>{tr.emoji}</div>
            <h2 style={{ margin: '4px 0' }}>{tr.name}</h2>
            <div className="muted">{tr.destination}</div>
            <div className="tiny">{fmtDate(tr.start_date, lang)} → {fmtDate(tr.end_date, lang)}</div>
          </Link>
        ))}
      </div>

      {open && (
        <div className="overlay" onClick={() => setOpen(false)}>
          <form className="modal" onClick={e => e.stopPropagation()} onSubmit={create}>
            <h2>{t.newTrip}</h2>
            <div className="form-grid">
              <label className="field full"><span>{t.tripName}</span>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></label>
              <label className="field full"><span>{t.destination}</span>
                <input value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} /></label>
              <label className="field"><span>{t.startDate}</span>
                <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} /></label>
              <label className="field"><span>{t.endDate}</span>
                <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} /></label>
              <CurrencyFields base={form.base_currency} watch={form.watch_currencies}
                onBase={c => setForm({ ...form, base_currency: c, watch_currencies: form.watch_currencies.filter(w => w !== c) })}
                onWatch={w => setForm({ ...form, watch_currencies: w })} />
            </div>
            <StylePicker emoji={form.emoji} color={form.color}
              onEmoji={e => setForm({ ...form, emoji: e })} onColor={c => setForm({ ...form, color: c })}
              labelIcon={t.pickEmoji} labelColor={t.tripColor} />
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>{t.cancel}</button>
              <button className="btn" type="submit">{t.create}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
