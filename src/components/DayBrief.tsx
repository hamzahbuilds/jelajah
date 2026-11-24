// v0.49 Daily brief inside the Plan day card (replaces the separate Today page).
// The leader's own summary, a one-time AI summary of the day (written only when
// someone asks, then kept for everyone), and Share.
import { useEffect, useState } from 'react';
import { api, ApiError, fmtDate } from '../api';
import { useT } from '../i18n';
import { useToast } from './Toast';
import { Icon } from './Icon';
import ThinkingSteps from './ThinkingSteps';

interface Brief {
  items: number;
  ai_available: boolean;
  ai: { text: string; at: string } | null;
  note: { text: string; by: string | null; at: string } | null;
}

const STEPS = {
  en: ['Going through the plans', 'Taking note of the places to visit', 'Checking flight and hotel times', 'Spotting the fixed times of the day', 'Reading the notes and to-dos', 'Harmonising the flow', 'Picking out what matters most', 'Writing it up for the group'],
  ms: ['Meneliti rancangan', 'Mencatat tempat yang akan dilawati', 'Menyemak masa penerbangan dan hotel', 'Mengenal pasti masa tetap hari ini', 'Membaca nota dan senarai tugasan', 'Menyelaraskan aliran perjalanan', 'Memilih perkara paling penting', 'Menulis untuk kumpulan'],
};

export default function DayBrief({ tripId, tripName, day, canLead, schedule }: {
  tripId: number; tripName: string; day: string; canLead: boolean;
  /** One line per stop, already formatted ("09:00 Senso-ji (Asakusa)"), for Share. */
  schedule: string[];
}) {
  const { t, lang } = useT();
  const ms = lang === 'ms';
  const L = (en: string, m: string) => (ms ? m : en);
  const { toast } = useToast();
  const [brief, setBrief] = useState<Brief | null>(null);
  const [writing, setWriting] = useState(false);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    setBrief(null); setEditing(false); setErr('');
    api.get(`/trips/${tripId}/briefs/${day}?lang=${lang}`).then((b: Brief) => { if (live) setBrief(b); }).catch(() => live && setBrief(null));
    return () => { live = false; };
  }, [tripId, day, lang]);

  const write = async () => {
    setWriting(true); setErr('');
    try { setBrief(await api.post(`/trips/${tripId}/briefs/${day}/ai?lang=${lang}`)); }
    catch (e) {
      setErr(e instanceof ApiError && e.code === 'ai_rate_limited' ? L('Too many requests. Try again in a minute.', 'Terlalu banyak permintaan. Cuba sebentar lagi.') : L('Could not write the summary. Try again.', 'Ringkasan tidak dapat ditulis. Cuba lagi.'));
    } finally { setWriting(false); }
  };

  const saveNote = async (text: string) => {
    setSaving(true);
    try { setBrief(await api.put(`/trips/${tripId}/briefs/${day}/note?lang=${lang}`, { text })); setEditing(false); toast(t.tSaved); }
    catch { toast(t.tSaveFailed, 'error'); }
    finally { setSaving(false); }
  };

  const share = async () => {
    const lines = [`${tripName} · ${fmtDate(day, lang)}`];
    if (brief?.note) lines.push('', brief.note.text);
    if (brief?.ai) lines.push('', brief.ai.text);
    if (schedule.length) lines.push('', L('Schedule:', 'Jadual:'), ...schedule);
    const text = lines.join('\n');
    const data = { title: `${tripName} · ${fmtDate(day, lang)}`, text };
    if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
      try { await navigator.share(data); return; } catch (e) { if ((e as DOMException)?.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); toast(L('Day summary copied', 'Ringkasan hari disalin')); }
    catch { toast(L('Copy failed', 'Tidak dapat menyalin'), 'error'); }
  };

  if (!brief) return null;
  const hasPlan = brief.items > 0;
  const canWrite = brief.ai_available && hasPlan && !brief.ai;
  if (!brief.note && !brief.ai && !canWrite && !canLead && !schedule.length) return null;

  return (
    <div className="day-brief">
      {editing ? (
        <form className="day-brief-form" onSubmit={e => { e.preventDefault(); void saveNote(draft); }}>
          <label htmlFor={`brief-note-${day}`}>{L('Your note for the group', 'Nota anda untuk kumpulan')}</label>
          <textarea id={`brief-note-${day}`} rows={3} maxLength={1500} value={draft} onChange={e => setDraft(e.target.value)}
            placeholder={L('e.g. Meet in the lobby at 8:30. Bring an umbrella.', 'Contoh: Berkumpul di lobi 8:30 pagi. Bawa payung.')} />
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            {brief.note && <button type="button" className="btn ghost sm" disabled={saving} onClick={() => void saveNote('')}>{t.delete}</button>}
            <button type="button" className="btn ghost sm" disabled={saving} onClick={() => setEditing(false)}>{t.close}</button>
            <button className="btn sm" disabled={saving}>{saving ? t.loading : t.save}</button>
          </div>
        </form>
      ) : brief.note ? (
        <div className="day-brief-note">
          <p>{brief.note.text}</p>
          <small>{L('From', 'Daripada')} {brief.note.by ?? L('the trip leader', 'ketua perjalanan')}
            {canLead && <> · <button type="button" className="linklike" onClick={() => { setDraft(brief.note!.text); setEditing(true); }}>{L('Edit', 'Sunting')}</button></>}</small>
        </div>
      ) : null}

      {writing ? <ThinkingSteps steps={STEPS[ms ? 'ms' : 'en']} label={L('Writing the summary', 'Menulis ringkasan')} />
        : brief.ai ? <div className="day-brief-ai">
            <p>{brief.ai.text}</p>
            <small><Icon name="sparkles" size={16} /> {L('AI summary of the plan. Check times before you go.', 'Ringkasan AI daripada pelan. Semak masa sebelum bertolak.')}</small>
          </div>
        : null}
      {err && <p className="callout warn" role="alert">{err}</p>}

      {!writing && <div className="day-brief-actions">
        {canWrite && <button type="button" className="btn secondary sm" onClick={() => void write()}><Icon name="sparkles" size={16} /> {L('Summarise this day', 'Ringkaskan hari ini')}</button>}
        {canLead && !brief.note && !editing && <button type="button" className="btn ghost sm" onClick={() => { setDraft(''); setEditing(true); }}><Icon name="edit" size={16} /> {L('Add a note for the group', 'Tambah nota untuk kumpulan')}</button>}
        {(brief.note || brief.ai || schedule.length > 0) && <button type="button" className="btn ghost sm" onClick={() => void share()}><Icon name="link" size={16} /> {L('Share day', 'Kongsi hari')}</button>}
      </div>}
    </div>
  );
}
