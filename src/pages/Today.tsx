// v0.48 Today: what is on the itinerary for one day, a short AI brief of it
// (written by the trip's AI provider, Gemini by default), and the leader's own
// summary. Everything can be shared as plain text in one tap.
import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { api, ApiError, fmtDate } from '../api';
import { useT } from '../i18n';
import type { TripCtx } from '../app/tripContext';
import PageHead from '../components/PageHead';
import Loading from '../components/Loading';
import Empty from '../components/Empty';
import { Icon, type IconName } from '../components/Icon';
import { useToast } from '../components/Toast';

interface Brief {
  day: string;
  items: number;
  ai_available: boolean;
  ai: { text: string; at: string; stale: boolean } | null;
  note: { text: string; by: string | null; at: string } | null;
}

interface Row { key: string; time: string | null; end: string | null; icon: IconName; title: string; sub: string | null; notes: string | null; lat: number | null; lng: number | null }

/** The device's calendar date (not UTC), as YYYY-MM-DD. */
function localDay(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function shiftDay(day: string, by: number): string {
  const d = new Date(day + 'T00:00:00');
  d.setDate(d.getDate() + by);
  return localDay(d);
}
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000);

const KIND_ICON: Record<string, IconName> = { flight: 'plane', checkin: 'hotel', checkout: 'hotel', food: 'food', transport: 'train', sight: 'camera', shopping: 'bag' };

export default function Today() {
  const { t, lang } = useT();
  const bm = lang === 'ms';
  const { trip, tripId, canLead, canEdit } = useOutletContext<TripCtx>();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  const start = trip.start_date || null;
  const end = trip.end_date || start;
  const today = localDay();

  // Default day: today while the trip runs, else its first (or last) day.
  const fallback = !start ? today : today < start ? start : end && today > end ? end : today;
  const asked = params.get('day');
  const day = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : fallback;
  const go = (d: string) => { const p = new URLSearchParams(params); if (d === fallback) p.delete('day'); else p.set('day', d); setParams(p); };

  const [plan, setPlan] = useState<any>(null);
  const [planFailed, setPlanFailed] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [writing, setWriting] = useState(false);
  const [aiError, setAiError] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setPlanFailed(false);
    api.get(`/trips/${tripId}/plan`).then(setPlan).catch(() => setPlanFailed(true));
  }, [tripId]);

  const writeBrief = async (force = false) => {
    setWriting(true); setAiError('');
    try { setBrief(await api.post(`/trips/${tripId}/briefs/${day}/ai?lang=${lang}${force ? '&force=1' : ''}`)); }
    catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      setAiError(code === 'ai_rate_limited' ? (bm ? 'Terlalu banyak permintaan. Cuba sebentar lagi.' : 'Too many requests. Try again in a minute.')
        : code === 'ai_not_configured' ? (bm ? 'AI belum disediakan oleh pentadbir.' : 'AI is not set up by the admin yet.')
        : (bm ? 'Ringkasan tidak dapat ditulis. Cuba lagi.' : 'Could not write the brief. Try again.'));
    } finally { setWriting(false); }
  };

  useEffect(() => {
    let live = true;
    setBrief(null); setEditing(false); setAiError('');
    api.get(`/trips/${tripId}/briefs/${day}?lang=${lang}`).then((b: Brief) => {
      if (!live) return;
      setBrief(b);
      // First visit to a day with plans: write the brief once; later visits read the saved one.
      if (b.ai_available && !b.ai && b.items > 0) void writeBrief();
    }).catch(() => live && setBrief(null));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId, day, lang]);

  const rows: Row[] = useMemo(() => {
    if (!plan) return [];
    const auto: Row[] = (plan.autoEvents ?? []).filter((e: any) => e.day === day).map((e: any, i: number) => ({
      key: `auto-${i}`, time: e.time, end: e.end_time, icon: KIND_ICON[e.kind] ?? 'pin',
      title: e.kind === 'checkin' ? `${bm ? 'Daftar masuk' : 'Check in'} · ${e.title}` : e.kind === 'checkout' ? `${bm ? 'Daftar keluar' : 'Check out'} · ${e.title}` : e.title,
      sub: e.subtitle ?? null, notes: null, lat: null, lng: null,
    }));
    const acts: Row[] = (plan.activities ?? []).filter((a: any) => a.day === day).map((a: any) => ({
      key: `act-${a.id}`, time: a.start_time, end: a.end_time, icon: KIND_ICON[a.category] ?? 'pin',
      title: a.title, sub: a.location_name && a.location_name !== a.title ? a.location_name : null,
      notes: a.notes || null, lat: a.lat, lng: a.lng,
    }));
    // Timed items in order; untimed ones keep their plan order at the end.
    return [...auto, ...acts].map((r, i) => ({ r, i }))
      .sort((a, b) => (a.r.time && b.r.time ? a.r.time.localeCompare(b.r.time) : a.r.time ? -1 : b.r.time ? 1 : 0) || a.i - b.i)
      .map(x => x.r);
  }, [plan, day, bm]);

  const notes = (plan?.dayNotes ?? []).filter((n: any) => n.day === day);
  const title = (plan?.daySettings ?? []).find((s: any) => s.day === day)?.title as string | undefined;
  const stay = (plan?.stays ?? []).find((s: any) => s.checkin && s.checkout && s.checkin <= day && day < s.checkout);
  const dayNo = start ? daysBetween(start, day) + 1 : null;
  const total = start && end ? daysBetween(start, end) + 1 : null;
  const inTrip = dayNo != null && total != null && dayNo >= 1 && dayNo <= total;
  const startsIn = start && today < start ? daysBetween(today, start) : 0;

  const saveNote = async (text: string) => {
    setSaving(true);
    try { setBrief(await api.put(`/trips/${tripId}/briefs/${day}/note?lang=${lang}`, { text })); setEditing(false); toast(t.tSaved); }
    catch { toast(t.tSaveFailed, 'error'); }
    finally { setSaving(false); }
  };

  const shareText = () => {
    const lines = [`${trip.name} · ${fmtDate(day, lang)}${title ? ` · ${title}` : ''}`];
    if (brief?.note) lines.push('', brief.note.text);
    if (brief?.ai) lines.push('', brief.ai.text);
    if (rows.length) {
      lines.push('', bm ? 'Jadual:' : 'Schedule:');
      for (const r of rows) lines.push(`${r.time ? `${r.time}${r.end ? `-${r.end}` : ''} ` : '• '}${r.title}${r.sub ? ` (${r.sub})` : ''}`);
    }
    return lines.join('\n');
  };

  // Native share sheet where there is one; otherwise copy, and say which happened.
  const share = async () => {
    const text = shareText();
    const data = { title: `${trip.name} · ${fmtDate(day, lang)}`, text };
    if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
      try { await navigator.share(data); return; }
      catch (e) { if ((e as DOMException)?.name === 'AbortError') return; /* fall through to copy */ }
    }
    try { await navigator.clipboard.writeText(text); toast(bm ? 'Ringkasan disalin' : 'Brief copied'); }
    catch { toast(bm ? 'Tidak dapat menyalin' : 'Copy failed', 'error'); }
  };

  const mapUrl = (r: Row) => r.lat != null && r.lng != null
    ? `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`
    : r.sub || r.title ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.sub ?? r.title}${trip.destination ? `, ${trip.destination}` : ''}`)}` : null;

  return (
    <div className="today-page">
      <PageHead title={t.today} sub={inTrip ? (bm ? `Hari ${dayNo} daripada ${total}` : `Day ${dayNo} of ${total}`) : startsIn > 0 ? (bm ? `Perjalanan bermula dalam ${startsIn} hari` : `Trip starts in ${startsIn} day${startsIn === 1 ? '' : 's'}`) : undefined} />

      <nav className="today-days" aria-label={bm ? 'Pilih hari' : 'Choose day'}>
        <button type="button" className="btn ghost sm" disabled={!!start && day <= start} onClick={() => go(shiftDay(day, -1))} aria-label={bm ? 'Hari sebelumnya' : 'Previous day'}><Icon name="chev-l" size={16} /></button>
        <div className="today-date">
          <b>{fmtDate(day, lang)}</b>
          {title && <span>{title}</span>}
        </div>
        <button type="button" className="btn ghost sm" disabled={!!end && day >= end} onClick={() => go(shiftDay(day, 1))} aria-label={bm ? 'Hari seterusnya' : 'Next day'}><Icon name="chev-r" size={16} /></button>
        {day !== fallback && <button type="button" className="btn secondary sm" onClick={() => go(fallback)}>{inTrip || today >= (start ?? today) ? t.today : (bm ? 'Hari pertama' : 'First day')}</button>}
      </nav>

      <section className="card today-brief" aria-labelledby="today-brief-h">
        <div className="cardhead">
          <h2 id="today-brief-h"><Icon name="sparkles" /> {bm ? 'Ringkasan hari ini' : 'Daily brief'}</h2>
          <button type="button" className="btn sm" onClick={share} disabled={!brief?.note && !brief?.ai && !rows.length}><Icon name="link" size={16} /> {bm ? 'Kongsi' : 'Share'}</button>
        </div>

        {editing ? (
          <form className="today-note-form" onSubmit={e => { e.preventDefault(); void saveNote(draft); }}>
            <label htmlFor="today-note">{bm ? 'Ringkasan anda untuk kumpulan' : 'Your summary for the group'}</label>
            <textarea id="today-note" rows={4} maxLength={1500} value={draft} onChange={e => setDraft(e.target.value)}
              placeholder={bm ? 'Contoh: Bertolak dari lobi 8:30 pagi. Bawa payung.' : 'e.g. Meet in the lobby at 8:30. Bring an umbrella.'} />
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              {brief?.note && <button type="button" className="btn ghost sm" disabled={saving} onClick={() => void saveNote('')}><Icon name="trash" size={16} /> {t.delete}</button>}
              <button type="button" className="btn ghost sm" disabled={saving} onClick={() => setEditing(false)}>{t.close}</button>
              <button className="btn sm" disabled={saving}>{saving ? t.loading : t.save}</button>
            </div>
          </form>
        ) : brief?.note ? (
          <div className="today-note">
            <p>{brief.note.text}</p>
            <small>{bm ? 'Daripada' : 'From'} {brief.note.by ?? (bm ? 'ketua perjalanan' : 'the trip leader')}</small>
            {canLead && <button type="button" className="btn ghost sm" onClick={() => { setDraft(brief.note!.text); setEditing(true); }}><Icon name="edit" size={16} /> {bm ? 'Sunting' : 'Edit'}</button>}
          </div>
        ) : canLead ? (
          <button type="button" className="btn secondary sm today-add-note" onClick={() => { setDraft(''); setEditing(true); }}><Icon name="edit" size={16} /> {bm ? 'Tulis ringkasan anda' : 'Add your summary'}</button>
        ) : null}

        <div className="today-ai" aria-busy={writing}>
          {brief?.ai_available === false ? (
            <p className="hint">{bm ? 'Ringkasan AI akan muncul di sini selepas pentadbir menyediakan AI.' : 'An AI brief appears here once the admin sets up AI.'}</p>
          ) : writing ? (
            <Loading label={bm ? 'Menulis ringkasan…' : 'Writing the brief…'} />
          ) : brief?.ai ? (
            <>
              <p className="today-ai-text">{brief.ai.text}</p>
              <div className="today-ai-foot">
                <small><Icon name="sparkles" size={16} /> {bm ? 'Ditulis oleh AI daripada jadual. Semak masa sebelum bertolak.' : 'Written by AI from the schedule. Check times before you go.'}</small>
                {brief.ai.stale
                  ? <button type="button" className="btn secondary sm" onClick={() => void writeBrief()}><Icon name="refresh" size={16} /> {bm ? 'Jadual berubah · Kemas kini' : 'Plan changed · Update'}</button>
                  : canEdit && <button type="button" className="btn ghost sm" onClick={() => void writeBrief(true)}><Icon name="refresh" size={16} /> {bm ? 'Tulis semula' : 'Rewrite'}</button>}
              </div>
            </>
          ) : brief && brief.items === 0 ? null : brief ? (
            <button type="button" className="btn secondary sm" onClick={() => void writeBrief()}><Icon name="sparkles" size={16} /> {bm ? 'Tulis ringkasan' : 'Write the brief'}</button>
          ) : null}
          {aiError && <p className="callout warn" role="alert">{aiError} <button type="button" className="btn ghost sm" onClick={() => void writeBrief()}>{bm ? 'Cuba lagi' : 'Retry'}</button></p>}
        </div>
      </section>

      <section className="card" aria-labelledby="today-plan-h" style={{ marginTop: 16 }}>
        <div className="cardhead">
          <h2 id="today-plan-h"><Icon name="calendar" /> {bm ? 'Jadual' : 'Schedule'} {rows.length > 0 && <span className="badge gray">{rows.length}</span>}</h2>
          <Link className="btn ghost sm" to={`/trips/${tripId}/plan`}>{t.plan} <Icon name="arrow-r" size={16} /></Link>
        </div>
        {stay && <p className="today-stay"><Icon name="bed" size={16} /> {bm ? 'Menginap di' : 'Staying at'} <b>{stay.description}</b>{stay.location ? ` · ${stay.location}` : ''}</p>}
        {planFailed ? <p className="callout warn" role="alert">{bm ? 'Jadual tidak dapat dimuatkan.' : 'Could not load the schedule.'}</p>
          : !plan ? <Loading label={t.loading} />
          : !rows.length ? <Empty icon="calendar" title={bm ? 'Tiada apa-apa dirancang' : 'Nothing planned for this day'} sub={bm ? 'Tambah aktiviti dalam Pelan dan ia akan muncul di sini.' : 'Add activities in Plan and they show up here.'} />
          : <ol className="today-list">
            {rows.map(r => {
              const url = mapUrl(r);
              return (
                <li key={r.key}>
                  <span className="today-time">{r.time ?? '—'}{r.end && <small>{r.end}</small>}</span>
                  <span className="tile sm"><Icon name={r.icon} /></span>
                  <div className="today-item">
                    <b>{r.title}</b>
                    {r.sub && <span>{r.sub}</span>}
                    {r.notes && <small>{r.notes}</small>}
                  </div>
                  {url && <a className="btn ghost sm" href={url} target="_blank" rel="noreferrer noopener" aria-label={`${bm ? 'Peta untuk' : 'Map for'} ${r.title}`}><Icon name="map" size={16} /></a>}
                </li>
              );
            })}
          </ol>}
        {notes.length > 0 && <ul className="today-notes">
          {notes.map((n: any) => <li key={n.id} className={n.done ? 'done' : ''}><Icon name={n.is_check ? (n.done ? 'check' : 'list-check') : 'note'} size={16} /> {n.content}</li>)}
        </ul>}
      </section>
    </div>
  );
}
