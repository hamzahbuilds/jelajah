import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { useT, Dict } from '../i18n';
import { useSession, Trip, TripRole } from '../App';
import { StylePicker } from '../components/TripStyle';
import { useToast } from '../components/Toast';
import { CurrencyFields } from '../components/FxWidget';
import { Icon } from '../components/Icon';
import Modal from '../components/Modal';
import PageHead from '../components/PageHead';
import Empty from '../components/Empty';
import { daysBetween, todayYmd } from '../../shared/days';

function roleLabel(t: Dict, role?: TripRole) {
  if (role === 'leader') return t.roleLeader;
  if (role === 'editor') return t.roleEditor;
  return t.roleViewer;
}

/** "In 86 days" / "Happening now" / "Done · Mar 2026" — never toISOString on calendar dates. */
function tripChip(t: Dict, lang: string, tr: Trip): string | null {
  if (!tr.start_date) return null;
  const today = todayYmd();
  if (today < tr.start_date) {
    // daysBetween walks local-calendar days only (shared/days) — never a raw Date diff.
    const n = Math.max(0, daysBetween(today, tr.start_date, 5000).length - 1);
    const s = t.inDays(n);
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  const end = tr.end_date || tr.start_date;
  if (today <= end) return t.happeningNow;
  const month = new Date(end + 'T00:00:00').toLocaleDateString(lang === 'ms' ? 'ms-MY' : 'en-MY', {
    month: 'short', year: 'numeric',
  });
  return t.tripDoneOn(month);
}

/** Trip card cover: a real photo (when the trip has one) sits under the
 * brand-gradient overlay so card text stays legible; falls back to the
 * plain gradient+emoji look when there's no cover_key, or if the image
 * fails to load. */
function TripCardCover({ trip: tr, chip }: { trip: Trip; chip: string | null }) {
  const [errored, setErrored] = useState(false);
  const hasPhoto = !!tr.cover_key && !errored;
  return (
    <div className={`tc-cover${hasPhoto ? ' has-photo' : ''}`}>
      {hasPhoto && (
        <img className="tc-photo" src={`/api/trips/${tr.id}/cover?v=${encodeURIComponent(tr.cover_key ?? '')}`} alt={tr.name}
          loading="lazy" onError={() => setErrored(true)} />
      )}
      <span className={`em${hasPhoto ? ' has-photo' : ''}`}>{tr.emoji}</span>
      {chip && <span className="tc-chip">{chip}</span>}
    </div>
  );
}

export default function Trips() {
  const { t, lang } = useT();
  const { toast } = useToast();
  const { trips, refresh } = useSession();
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
      <PageHead crumb={t.home} title={t.myTrips} sub={t.myTripsSub}
        actions={<button className="btn" onClick={() => setOpen(true)}><Icon name="plus" size={16} /> {t.newTrip}</button>} />

      {trips.length === 0 ? (
        <Empty icon="folder" title={t.startFirstTrip} sub={t.startFirstTripSub}
          action={{ label: t.newTrip, onClick: () => setOpen(true) }} />
      ) : (
        <div className="tripgrid">
          {trips.map(tr => {
            const color = (tr as any).color as string | undefined;
            const chip = tripChip(t, lang, tr);
            return (
              <Link key={tr.id} to={`/trips/${tr.id}`} className="tripcard"
                style={color ? ({ ['--cov' as any]: color, borderTop: `4px solid ${color}` }) : undefined}>
                <TripCardCover trip={tr} chip={chip} />
                <div className="tc-body">
                  <h3>{tr.name}</h3>
                  <div className="sub">
                    {tr.destination}{tr.destination ? ' · ' : ''}{fmtDate(tr.start_date, lang)} – {fmtDate(tr.end_date, lang)}
                  </div>
                  <div className="tc-meta">
                    <span />
                    <span className={`badge ${tr.my_role === 'leader' ? 'brand' : 'gray'}`}>
                      <span className="d" />{roleLabel(t, tr.my_role)}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}

          <button type="button" className="newcard" onClick={() => setOpen(true)}>
            <span className="inner"><Icon name="plus" size={24} />{t.newTripCard}</span>
          </button>
        </div>
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <div className="cardhead">
          <h3><span className="invite-icon"><Icon name="gift" className="icon" /></span> {t.inviteSomeone}</h3>
          <Link to="/settings" style={{ fontSize: 13, fontWeight: 600 }}>{t.yourReferralLink} →</Link>
        </div>
        <p className="hint">{t.inviteSomeoneHint}</p>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} icon="plane" title={t.newTrip} closeLabel={t.close}
        footer={(
          <>
            <button type="button" className="btn secondary" onClick={() => setOpen(false)}>{t.cancel}</button>
            <button className="btn" type="submit" form="new-trip-form">{t.create}</button>
          </>
        )}>
        <form id="new-trip-form" onSubmit={create}>
          <div className="fld">
            <label>{t.tripName}</label>
            <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
          </div>
          <div className="fld" style={{ marginTop: 14 }}>
            <label>{t.destination}</label>
            <input value={form.destination} onChange={e => setForm({ ...form, destination: e.target.value })} />
          </div>
          <div className="mrow" style={{ marginTop: 14 }}>
            <div className="fld">
              <label>{t.startDate}</label>
              <input type="date" value={form.start_date} onChange={e => setForm({ ...form, start_date: e.target.value })} />
            </div>
            <div className="fld">
              <label>{t.endDate}</label>
              <input type="date" value={form.end_date} onChange={e => setForm({ ...form, end_date: e.target.value })} />
            </div>
          </div>
          <CurrencyFields base={form.base_currency} watch={form.watch_currencies}
            onBase={c => setForm({ ...form, base_currency: c, watch_currencies: form.watch_currencies.filter(w => w !== c) })}
            onWatch={w => setForm({ ...form, watch_currencies: w })} />
          <StylePicker emoji={form.emoji} color={form.color}
            onEmoji={e => setForm({ ...form, emoji: e })} onColor={c => setForm({ ...form, color: c })}
            labelIcon={t.pickEmoji} labelColor={t.tripColor} />
        </form>
      </Modal>
    </div>
  );
}
