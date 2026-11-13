import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { useT, Dict } from '../i18n';
import { useSession, Trip, TripRole } from '../app/session';
import { StylePicker } from '../components/TripStyle';
import { useToast } from '../components/Toast';
import { CurrencyFields } from '../components/FxWidget';
import { Icon } from '../components/Icon';
import Modal from '../components/Modal';
import PageHead from '../components/PageHead';
import Empty from '../components/Empty';
import { daysBetween, todayYmd } from '../../shared/days';
import PlanComposer, { type ComposerMode } from '../components/PlanComposer';
import { HomeBriefStart } from '../components/TripBrief';
import type { NewPlanStart } from './NewPlan';
import { backfillSmallCover } from '../lib/coverThumb';
import { DateRangePicker } from '../ui/DateRangePicker';

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
        // v0.38: the small (640px) copy; a leader's browser makes it if it's missing.
        <img className="tc-photo" src={`/api/trips/${tr.id}/cover?size=sm&v=${encodeURIComponent(tr.cover_key ?? '')}`} alt={tr.name}
          loading="lazy" decoding="async" onError={() => setErrored(true)}
          onLoad={e => backfillSmallCover(e.currentTarget, tr.id, tr.cover_key ?? '', tr.my_role === 'leader')} />
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
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(params.get('manual') === '1');
  const [mode, setMode] = useState<ComposerMode>('plan');
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  useEffect(() => { api.get('/plan/status').then(r => setAiOn(!!r.ai)).catch(() => setAiOn(false)); }, []);
  useEffect(() => {
    if (params.get('manual') === '1') { params.delete('manual'); setParams(params, { replace: true }); }
  }, [params, setParams]);
  // "New trip" opens the chat planner; the form stays one tap away (docs/20 §4.1).
  const newTrip = () => (aiOn === false ? setOpen(true) : nav('/new', { viewTransition: true }));
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
 />

      <div className="home-compose">
        <PlanComposer variant="hero" mode={mode} onModeChange={setMode} disabled={aiOn === false}
          onManual={() => setOpen(true)}
          onSubmit={v => nav('/new', { viewTransition: true, state: { start: v satisfies NewPlanStart } })}
          planSlot={<HomeBriefStart onNext={places => nav('/new', { viewTransition: true, state: { brief: { places, when: null }, briefStep: 'when' } })} />} />
      </div>

      {trips.length === 0 ? (
        <Empty icon="folder" title={t.startFirstTrip} sub={t.startFirstTripSub}
          action={{ label: t.newTrip, onClick: newTrip }} />
      ) : (
        <div className="tripgrid">
          {trips.map(tr => {
            const color = (tr as any).color as string | undefined;
            const chip = tripChip(t, lang, tr);
            return (
              <Link key={tr.id} to={`/trips/${tr.id}`} className="tripcard"
                style={color ? ({ ['--cov' as any]: color }) : undefined}>
                <TripCardCover trip={tr} chip={chip} />
                <div className="tc-body">
                  <h3>{tr.name}</h3>
                  <div className="sub">
                    {tr.destination}{tr.destination ? ' · ' : ''}{fmtDate(tr.start_date, lang)} – {fmtDate(tr.end_date, lang)}
                  </div>
                  <div className="tc-meta">
                    <span />
                    <span className="tc-role">{roleLabel(t, tr.my_role)}</span>
                  </div>
                </div>
              </Link>
            );
          })}

          <button type="button" className="newcard" onClick={newTrip}>
            <span className="inner"><Icon name="plus" size={24} />{t.newTripCard}</span>
          </button>
        </div>
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <div className="cardhead">
          <h3><span className="invite-icon"><Icon name="gift" className="icon" /></span> {t.inviteSomeone}</h3>
          <Link to="/settings" style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{t.yourReferralLink} →</Link>
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
          {/* One picker for both ends (v0.38): tap the start, then the end. */}
          <div className="new-trip-dates">
            <DateRangePicker label={t.tripDates} mode="trip" start={form.start_date} end={form.end_date}
              onChange={(start_date, end_date) => setForm(f => ({ ...f, start_date, end_date }))} />
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
