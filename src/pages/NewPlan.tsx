// v0.32 Chat planner (docs/20 §4.2): chat on the left, the live draft on the
// right (a Chat | Plan switch on phones). Nothing touches a trip until the
// user picks places and confirms "Create trip" or "Add to a trip".
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useT } from '../i18n';
import { useSession } from '../app/session';
import { useToast } from '../components/Toast';
import { useConfirm } from '../ui/Confirm';
import { Icon } from '../components/Icon';
import PlanComposer, { type ComposerMode, type ComposerSubmit } from '../components/PlanComposer';
import { Button, EmptyState, Field, FormSheet, Segmented } from '../ui';
import { DateRangePicker } from '../ui/DateRangePicker';
import { activityIcon } from '../lib/categoryIcons';
import { addDays, formatYmd, tripDays as countDays } from '../../shared/plainDate';
import { cleanDraft, defaultDayMapping, draftPlaceCount, emptyDraft, type Draft, type DraftPlace } from '../../shared/draft';
import '../components/planAi.css';

interface Source { kind: string; url: string; title: string | null; author: string | null; notes: string[]; watched: boolean }
interface ChatMsg { role: 'user' | 'assistant'; content: string; images?: number; source?: Source | null; suggestions?: string[]; error?: boolean }
interface Saved { mode: ComposerMode; messages: ChatMsg[]; draft: Draft; selected: string[] }
export interface NewPlanStart { mode: ComposerMode; text: string; images: { mime: string; data: string; preview: string }[] }

const STORE = 'jelajah:plan-draft';
const load = (): Saved | null => { try { const s = sessionStorage.getItem(STORE); return s ? JSON.parse(s) : null; } catch { return null; } };
const save = (s: Saved | null) => { try { s ? sessionStorage.setItem(STORE, JSON.stringify(s)) : sessionStorage.removeItem(STORE); } catch { /* private mode */ } };

const allIds = (d: Draft) => [...d.days.flatMap(x => x.places), ...d.ideas].map(p => p.id);
/** Dates from start..end inclusive. */
const datesOf = (start: string | null | undefined, end: string | null | undefined) =>
  start && end && end >= start ? Array.from({ length: Math.min(countDays(start, end), 60) }, (_, i) => addDays(start, i)) : [];

export default function NewPlan() {
  const { t, lang } = useT();
  const { toast } = useToast();
  const ask = useConfirm();
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const { trips, refresh } = useSession();
  const targetTripId = Number(params.get('trip')) || null;
  const editable = trips.filter(tr => tr.my_role === 'leader' || tr.my_role === 'editor');
  const targetTrip = editable.find(tr => tr.id === targetTripId) ?? null;

  const saved = useRef(load()).current;
  const [mode, setMode] = useState<ComposerMode>(saved?.mode ?? (params.get('mode') === 'import' ? 'import' : 'plan'));
  const [messages, setMessages] = useState<ChatMsg[]>(saved?.messages ?? []);
  const [draft, setDraft] = useState<Draft>(saved ? cleanDraft(saved.draft) : emptyDraft());
  const [selected, setSelected] = useState<Set<string>>(new Set(saved?.selected ?? []));
  const [busy, setBusy] = useState<false | 'plan' | 'link'>(false);
  const [pane, setPane] = useState<'chat' | 'plan'>('chat');
  const [sheet, setSheet] = useState<null | 'new' | 'add'>(null);
  const [ai, setAi] = useState<{ ai: boolean; video: boolean } | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => { api.get('/plan/status').then(setAi).catch(() => setAi({ ai: false, video: false })); }, []);
  useEffect(() => { save(messages.length ? { mode, messages, draft, selected: [...selected] } : null); }, [mode, messages, draft, selected]);
  useEffect(() => { logRef.current?.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [messages, busy]);

  const send = async ({ text, images }: ComposerSubmit, history = messages, currentDraft = draft) => {
    const content = text || (images.length ? 'Extract the places from these screenshots.' : '');
    if (!content) return;
    const next: ChatMsg[] = [...history, { role: 'user', content, images: images.length || undefined }];
    setMessages(next);
    setBusy(/https?:\/\//i.test(content) ? 'link' : 'plan');
    try {
      const r = await api.post('/plan/draft', {
        mode, lang: lang === 'ms' ? 'ms' : 'en', draft: currentDraft,
        messages: next.filter(m => !m.error).map(m => ({ role: m.role, content: m.content })),
        images: images.map(({ mime, data }) => ({ mime, data })),
      });
      const d = cleanDraft(r.draft);
      // Keep the user's ticks for places that survive; new places start ticked.
      const before = new Set(allIds(currentDraft));
      setSelected(cur => new Set(allIds(d).filter(id => !before.has(id) || cur.has(id))));
      setDraft(d);
      setMessages([...next, { role: 'assistant', content: r.reply || '…', source: r.source, suggestions: r.suggestions }]);
      if (draftPlaceCount(d) && !draftPlaceCount(currentDraft)) setPane('plan');
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      const msg = code === 'ai_rate_limited' ? t.aiResting : code === 'ai_not_configured' ? t.aiNotConfigured : code === 'ai_unreachable' ? t.aiUnreachable : t.aiError;
      setMessages([...next, { role: 'assistant', content: msg, error: true }]);
    } finally { setBusy(false); }
  };

  // First message handed over from the home composer (navigate state). Once only.
  useEffect(() => {
    const start = (loc.state as { start?: NewPlanStart } | null)?.start;
    if (!start || started.current) return;
    started.current = true;
    nav('.', { replace: true, state: null, relative: 'path' });
    setMode(start.mode);
    setMessages([]); setDraft(emptyDraft()); setSelected(new Set());
    send({ mode: start.mode, text: start.text, images: start.images }, [], emptyDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startOver = async () => {
    if (!(await ask({ title: t.confirmStartOver, confirmLabel: t.startOver, tone: 'danger' }))) return;
    setMessages([]); setDraft(emptyDraft()); setSelected(new Set()); setPane('chat');
  };

  const total = draftPlaceCount(draft);
  const toggle = (id: string) => setSelected(cur => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setMany = (ids: string[], on: boolean) => setSelected(cur => { const n = new Set(cur); ids.forEach(id => on ? n.add(id) : n.delete(id)); return n; });
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && !m.error);

  return (
    <div className="np">
      <header className="np-head">
        <div>
          <h1>{targetTrip ? t.addToNamed(targetTrip.name) : t.newPlanTitle}</h1>
        </div>
        <div className="np-head-actions">
          {messages.length > 0 && <Button variant="ghost" size="sm" icon="refresh" onClick={startOver}>{t.startOver}</Button>}
        </div>
      </header>

      <Segmented<'chat' | 'plan'> className="np-switch" label={t.newPlanTitle} value={pane} onChange={setPane}
        options={[{ value: 'chat', label: t.chatTab, icon: 'chat' }, { value: 'plan', label: t.planTab(total), icon: 'list-check' }]} />

      <div className="np-grid" data-pane={pane}>
        <section className="np-chat" aria-label={t.chatTab}>
          <div className="np-log" ref={logRef} role="log" aria-live="polite" aria-relevant="additions">
            {messages.length === 0 && (
              <div className="np-intro">
                <span className="tile"><Icon name="sparkles" /></span>
                <h2>{t.composerHeading}</h2>
                <p>{t.composerSub}</p>
                {ai && !ai.ai && <p className="callout warn">{t.aiOffHome}</p>}
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`np-msg ${m.role}${m.error ? ' error' : ''}`}>
                {m.source && <SourceChip s={m.source} />}
                <p>{m.content}</p>
                {m.images ? <span className="np-msg-meta"><Icon name="camera" size={16} /> {t.composerScreenshotsNote(m.images)}</span> : null}
              </div>
            ))}
            {busy && <div className="np-msg assistant pending"><span className="np-dots" aria-hidden="true" />{busy === 'link' ? t.readingLink : t.planning}</div>}
          </div>
          {!busy && lastAssistant?.suggestions?.length ? (
            <div className="np-suggest">
              {lastAssistant.suggestions.map(s => (
                <button key={s} type="button" className="chip" onClick={() => send({ mode, text: s, images: [] })}>{s}</button>
              ))}
            </div>
          ) : null}
          <PlanComposer variant="chat" mode={mode} busy={!!busy} disabled={ai?.ai === false}
            onSubmit={v => send(v)} autoFocus={!messages.length} refine={total > 0} />
        </section>

        <section className="np-draft" aria-label={t.planTab(total)}>
          {total === 0 ? (
            <EmptyState icon="map" title={t.draftEmptyTitle} text={t.draftEmptyText} />
          ) : (
            <>
              <div className="np-draft-head">
                {draft.emoji ? <span className="np-emoji" aria-hidden="true">{draft.emoji}</span> : <span className="tile"><Icon name="plane" /></span>}
                <div>
                  <h2>{draft.name || t.newPlanTitle}</h2>
                  <p>{[draft.destination, t.nDays(draft.days.length), t.nPlaces(total)].filter(Boolean).join(' · ')}</p>
                </div>
              </div>
              {draft.days.map((d, i) => d.places.length > 0 && (
                <DayGroup key={i} label={`${t.dayN(i + 1)} — ${d.title}`} places={d.places}
                  selected={selected} onToggle={toggle} onAll={on => setMany(d.places.map(p => p.id), on)} />
              ))}
              {draft.ideas.length > 0 && (
                <DayGroup label={t.ideasTitle} places={draft.ideas} selected={selected} onToggle={toggle}
                  onAll={on => setMany(draft.ideas.map(p => p.id), on)} />
              )}
              <div className="np-commit">
                <span className="np-count">{t.nSelected(selected.size, total)}</span>
                {targetTrip ? (
                  <Button icon="plus" onClick={() => setSheet('add')} disabled={!selected.size}>{t.addToNamed(targetTrip.name)}</Button>
                ) : (
                  <>
                    <Button variant="secondary" onClick={() => setSheet('add')} disabled={!selected.size || !editable.length}>{t.addToTrip}</Button>
                    <Button icon="plus" onClick={() => setSheet('new')} disabled={!selected.size}>{t.createTrip}</Button>
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {sheet && (
        <CommitSheet kind={sheet} draft={draft} selected={selected} trips={editable} defaultTripId={targetTrip?.id ?? editable[0]?.id ?? null}
          onClose={() => setSheet(null)}
          onDone={async (tripId, added, located) => {
            toast(t.tPlanAdded(added, located));
            save(null);
            await refresh();
            nav(`/trips/${tripId}/plan`, { viewTransition: true });
          }} />
      )}
    </div>
  );
}

function SourceChip({ s }: { s: Source }) {
  const { t } = useT();
  return (
    <div className="np-source">
      <a href={s.url} target="_blank" rel="noopener noreferrer">
        <Icon name={s.kind === 'web' ? 'globe' : 'link'} size={16} />
        <span>{s.title || s.url}</span>
        {s.author && <span className="np-source-by">· {s.author}</span>}
      </a>
      {s.watched && !s.notes.includes('the video could not be watched') && <span className="np-source-ok"><Icon name="check" size={16} /> {t.sourceWatched}</span>}
      {s.notes.length > 0 && <p className="np-source-notes">{t.sourceCouldNot}: {s.notes.join('; ')}</p>}
    </div>
  );
}

function DayGroup({ label, places, selected, onToggle, onAll }: {
  label: string; places: DraftPlace[]; selected: Set<string>; onToggle: (id: string) => void; onAll: (on: boolean) => void;
}) {
  const { t } = useT();
  const all = places.every(p => selected.has(p.id));
  return (
    <fieldset className="np-day">
      <legend>
        <span>{label}</span>
        <button type="button" className="pc-linkbtn" onClick={() => onAll(!all)}>{all ? t.selectNone : t.selectAll}</button>
      </legend>
      <ul>
        {places.map(p => (
          <li key={p.id}>
            <label className={`np-place${selected.has(p.id) ? ' on' : ''}`}>
              <input type="checkbox" checked={selected.has(p.id)} onChange={() => onToggle(p.id)} />
              <span className="tile sm"><Icon name={activityIcon(p.category)} size={16} /></span>
              <span className="np-place-text">
                <strong>{p.start_time ? `${p.start_time} · ` : ''}{p.title}</strong>
                {p.place && <span className="np-place-where"><Icon name="pin" size={16} /> {p.place}</span>}
                {p.notes && <span className="np-place-note">{p.notes}</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

function CommitSheet({ kind, draft, selected, trips, defaultTripId, onClose, onDone }: {
  kind: 'new' | 'add'; draft: Draft; selected: Set<string>;
  trips: { id: number; name: string; start_date: string | null; end_date: string | null }[];
  defaultTripId: number | null;
  onClose: () => void; onDone: (tripId: number, added: number, located: number) => void;
}) {
  const { t, lang } = useT();
  const { toast } = useToast();
  const locale = lang === 'ms' ? 'ms-MY' : 'en-MY';
  const nDays = Math.max(1, draft.days.length);
  const [name, setName] = useState(draft.name);
  const [destination, setDestination] = useState(draft.destination);
  const [range, setRange] = useState({ start: '', end: '' });
  const [tripId, setTripId] = useState<number | null>(defaultTripId);
  const trip = trips.find(x => x.id === tripId) ?? null;
  const dates = useMemo(() => kind === 'new' ? datesOf(range.start, range.end) : datesOf(trip?.start_date, trip?.end_date), [kind, range, trip]);
  const [map, setMap] = useState<string[]>([]);
  const [ideasDay, setIdeasDay] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setMap(defaultDayMapping(draft.days.length, dates)); setIdeasDay(dates[0] ?? ''); }, [dates, draft.days.length]);

  const fmt = (d: string) => formatYmd(d, locale, { weekday: 'short', day: 'numeric', month: 'short' });
  const usedDays = draft.days.map((d, i) => ({ d, i })).filter(({ d }) => d.places.some(p => selected.has(p.id)));
  const usesIdeas = draft.ideas.some(p => selected.has(p.id));

  const onRange = (s: string, e: string) => {
    // One tap on a start date fills the plan's length; the user can still drag it.
    setRange(s && !e ? { start: s, end: addDays(s, nDays - 1) } : { start: s, end: e });
  };

  const submit = async () => {
    if (!dates.length) { toast(t.datesRequired); return; }
    const picks = [
      ...draft.days.flatMap((d, i) => d.places.filter(p => selected.has(p.id)).map(p => ({ id: p.id, day: map[i] ?? dates[0] }))),
      ...draft.ideas.filter(p => selected.has(p.id)).map(p => ({ id: p.id, day: ideasDay || dates[0] })),
    ];
    if (!picks.length) { toast(t.pickSomething); return; }
    const day_titles: Record<string, string> = {};
    draft.days.forEach((d, i) => { if (map[i] && !day_titles[map[i]] && d.places.some(p => selected.has(p.id))) day_titles[map[i]] = d.title; });
    setSaving(true);
    try {
      const r = await api.post('/plan/commit', {
        draft, picks, day_titles,
        target: kind === 'add' ? { trip_id: tripId } : { new: { name: name.trim() || draft.name, destination, start_date: range.start, end_date: range.end, emoji: draft.emoji } },
      });
      onDone(r.trip_id, r.added, r.located);
    } catch { toast(t.aiError); setSaving(false); }
  };

  const dateSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <Field label={label}>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {dates.map((d, k) => <option key={d} value={d}>{t.dayN(k + 1)} · {fmt(d)}</option>)}
      </select>
    </Field>
  );

  return (
    <FormSheet open onClose={onClose} icon={kind === 'new' ? 'plane' : 'plus'} title={kind === 'new' ? t.createTrip : (trip ? t.addToNamed(trip.name) : t.addToTrip)}
      sub={t.nSelected(selected.size, draftPlaceCount(draft))} closeLabel={t.close} onSubmit={submit}
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t.cancel}</Button>
        <Button type="submit" loading={saving} disabled={saving || !dates.length}>{kind === 'new' ? t.createTrip : t.addToTrip}</Button>
      </>}>
      <div className="np-sheet">
        {kind === 'new' ? (
          <>
            <Field label={t.tripName} required><input value={name} onChange={e => setName(e.target.value)} required maxLength={80} /></Field>
            <Field label={t.destination}><input value={destination} onChange={e => setDestination(e.target.value)} maxLength={120} /></Field>
            <DateRangePicker label={t.tripDates} mode="trip" start={range.start} end={range.end} onChange={onRange}
              required hint={t.planHasDays(nDays)} />
          </>
        ) : (
          trips.length ? (
            <Field label={t.chooseTrip}>
              <select value={tripId ?? ''} onChange={e => setTripId(Number(e.target.value))}>
                {trips.map(tr => <option key={tr.id} value={tr.id}>{tr.name}</option>)}
              </select>
            </Field>
          ) : <p className="callout warn">{t.noEditableTrips}</p>
        )}
        {dates.length > 0 && (usedDays.length > 1 || kind === 'add') && usedDays.map(({ d, i }) => (
          <div key={i}>{dateSelect(map[i] ?? dates[0], v => setMap(m => { const n = [...m]; n[i] = v; return n; }), t.dayGoesTo(`${t.dayN(i + 1)} — ${d.title}`))}</div>
        ))}
        {dates.length > 0 && usesIdeas && dateSelect(ideasDay, setIdeasDay, t.ideasGoTo)}
      </div>
    </FormSheet>
  );
}
