// v0.32 Chat planner (docs/20 §4.2): chat on the left, the live draft on the
// right (a Chat | Plan switch on phones). Nothing touches a trip until the
// user picks places and confirms "Create trip" or "Add to a trip".
import { PlanIntro } from '../components/Onboarding';
import Dialog from '../components/Dialog';
import { BriefBar, BriefWizard, briefDestination, briefSummary, type BriefStep } from '../components/TripBrief';
import { cleanBrief, emptyBrief, type TripBrief } from '../../shared/brief';
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
import { AnimatePresence, motion } from 'motion/react';
import { useListItem, usePopItem } from '../lib/motionKit';

interface Source { kind: string; url: string; title: string | null; author: string | null; notes: string[]; watched: boolean }
interface ChatMsg { role: 'user' | 'assistant'; content: string; images?: number; source?: Source | null; suggestions?: string[]; error?: boolean }
interface Saved { mode: ComposerMode; messages: ChatMsg[]; draft: Draft; selected: string[]; brief?: TripBrief | null }
export interface NewPlanStart { mode: ComposerMode; text: string; images: { mime: string; data: string; preview: string }[] }

const STORE = 'jelajah:plan-draft';
/** v0.36: the trip brief while it is still being filled in (survives a reload). */
const WIZ_STORE = 'jelajah:plan-brief';
const loadWiz = (): { brief: unknown; step: string } | null => { try { const v = sessionStorage.getItem(WIZ_STORE); return v ? JSON.parse(v) : null; } catch { return null; } };
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
  const { trips, refresh, user } = useSession();
  const targetTripId = Number(params.get('trip')) || null;
  const editable = trips.filter(tr => tr.my_role === 'leader' || tr.my_role === 'editor');
  const targetTrip = editable.find(tr => tr.id === targetTripId) ?? null;

  // A fresh brief from Home starts a new plan; otherwise resume the saved one.
  // v0.44: "Use this template" (Discover) hands over a ready plan draft; it
  // opens straight in the review with every place picked.
  const tplIn = (loc.state as { template?: { name: string; draft: Draft } } | null)?.template ?? null;
  const saved = useRef<Saved | null>(tplIn ? (() => {
    const d = cleanDraft(tplIn.draft);
    return { mode: 'plan' as ComposerMode, messages: [{ role: 'assistant' as const, content: t.templateLoaded(tplIn.name) }], draft: d,
      selected: [...d.days.flatMap(x => x.places), ...d.ideas].map(x => x.id), brief: null };
  })() : (loc.state as { brief?: unknown } | null)?.brief ? null : load()).current;
  const [mode, setMode] = useState<ComposerMode>(saved?.mode ?? (params.get('mode') === 'import' ? 'import' : 'plan'));
  const [messages, setMessages] = useState<ChatMsg[]>(saved?.messages ?? []);
  const [draft, setDraft] = useState<Draft>(saved ? cleanDraft(saved.draft) : emptyDraft());
  const [selected, setSelected] = useState<Set<string>>(new Set(saved?.selected ?? []));
  const [busy, setBusy] = useState<false | 'plan' | 'link'>(false);
  const [pane, setPane] = useState<'chat' | 'plan'>(tplIn ? 'plan' : 'chat');
  const [sheet, setSheet] = useState<null | 'new' | 'add'>(null);
  const [ai, setAi] = useState<{ ai: boolean; video: boolean } | null>(null);
  // v0.36 trip brief (docs/23). Home hands over the countries (step 1); a
  // fresh plan opened directly starts at step 1 here. Link imports skip it —
  // the AI fills it from the source ("found").
  const handoff = (loc.state as { brief?: TripBrief; briefStep?: BriefStep; start?: NewPlanStart } | null) ?? null;
  const wiz = useRef(handoff?.brief || handoff?.start || saved?.messages?.length ? null : loadWiz()).current;
  const [brief, setBrief] = useState<TripBrief | null>(() => cleanBrief(handoff?.brief) ?? cleanBrief(wiz?.brief) ?? (saved?.brief ? cleanBrief(saved.brief) : null));
  const [wizard, setWizard] = useState<BriefStep | null>(() =>
    handoff?.brief ? (handoff.briefStep ?? 'when')
      : !saved?.messages?.length && !handoff?.start && !targetTripId && params.get('mode') !== 'import'
        ? ((['where', 'when', 'you', 'ready'] as const).find(x => x === wiz?.step) ?? 'where')
      : null);
  const [editingBrief, setEditingBrief] = useState(false);
  const [briefFound, setBriefFound] = useState(false);
  useEffect(() => {
    if (handoff?.brief || tplIn) nav('.', { replace: true, state: null, relative: 'path' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const logRef = useRef<HTMLDivElement>(null);
  const listItem = useListItem();
  const popItem = usePopItem();
  const started = useRef(false);
  // v0.35: how-it-works intro on a fresh plan (not when resuming a draft),
  // unless the user ticked "Don't show this again".
  const [intro, setIntro] = useState(() => !user.onboarding?.skip_plan_intro && !saved?.messages?.length);
  const endIntro = (dontShowAgain: boolean) => {
    setIntro(false);
    if (dontShowAgain) api.patch('/me', { skip_plan_intro: true }).then(refresh).catch(() => {});
  };

  useEffect(() => { api.get('/plan/status').then(setAi).catch(() => setAi({ ai: false, video: false })); }, []);
  useEffect(() => { save(messages.length || brief ? { mode, messages, draft, selected: [...selected], brief } : null); }, [mode, messages, draft, selected, brief]);
  useEffect(() => { logRef.current?.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [messages, busy]);

  const send = async ({ text, images }: ComposerSubmit, history = messages, currentDraft = draft, currentBrief = brief) => {
    const content = text || (images.length ? 'Extract the places from these screenshots.' : '');
    if (!content) return;
    const next: ChatMsg[] = [...history, { role: 'user', content, images: images.length || undefined }];
    setMessages(next);
    setBusy(/https?:\/\//i.test(content) ? 'link' : 'plan');
    try {
      const r = await api.post('/plan/draft', {
        mode, lang: lang === 'ms' ? 'ms' : 'en', draft: currentDraft, brief: currentBrief,
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
      // No countries picked (e.g. a link import): take the ones the AI read from the source.
      if (!currentBrief?.places.length && r.found?.countries?.length) {
        const found = r.found as { countries: string[]; areas: string[] };
        setBrief(cleanBrief({
          ...(currentBrief ?? emptyBrief()),
          places: found.countries.map((country, k) => ({ country, areas: k === 0 ? found.areas : [] })),
          when: currentBrief?.when ?? (d.days.length ? { kind: 'unsure', days: d.days.length } : null),
        }));
        setBriefFound(true);
      }
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      const msg = code === 'ai_rate_limited' ? t.aiResting : code === 'ai_not_configured' ? t.aiNotConfigured : code === 'ai_unreachable' ? t.aiUnreachable : t.aiError;
      setMessages([...next, { role: 'assistant', content: msg, error: true }]);
    } finally { setBusy(false); }
  };

  // The intro opened on its own, so there's no button to hand focus back to:
  // once it closes, land in the chat box (after Dialog's cleanup has run).
  const hadIntro = useRef(intro);
  useEffect(() => {
    if (intro || !hadIntro.current) return;
    hadIntro.current = false;
    document.querySelector<HTMLElement>('.np .tb-search input, .np textarea')?.focus();
  }, [intro]);

  // First message handed over from the home composer (navigate state). Once only,
  // and after the intro closes so the reply doesn't arrive behind it.
  useEffect(() => {
    const start = (loc.state as { start?: NewPlanStart } | null)?.start;
    if (intro || !start || started.current) return;
    started.current = true;
    nav('.', { replace: true, state: null, relative: 'path' });
    setMode(start.mode);
    setMessages([]); setDraft(emptyDraft()); setSelected(new Set());
    send({ mode: start.mode, text: start.text, images: start.images }, [], emptyDraft());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intro]);

  const startOver = async () => {
    if (!(await ask({ title: t.confirmStartOver, confirmLabel: t.startOver, tone: 'danger' }))) return;
    setMessages([]); setDraft(emptyDraft()); setSelected(new Set()); setPane('chat');
    setBrief(null); setBriefFound(false); if (!targetTripId) setWizard('where');
    try { sessionStorage.removeItem(WIZ_STORE); } catch { /* private mode */ }
  };

  // Brief finished: plan from it straight away.
  const briefDone = (b: TripBrief, extra: string) => {
    try { sessionStorage.removeItem(WIZ_STORE); } catch { /* private mode */ }
    // Came back to the brief from an existing chat: keep the chat, update the plan.
    if (messages.length) {
      setWizard(null); setEditingBrief(false); setBrief(b); setBriefFound(false);
      const changed = JSON.stringify(b) !== JSON.stringify(brief);
      const text = [changed ? t.briefChanged(briefSummary(b, lang, t)) : '', extra].filter(Boolean).join(' ');
      if (text) send({ mode, text, images: [] }, messages, draft, b);
      return;
    }
    setBrief(b); setWizard(null); setMode('plan');
    setMessages([]); setDraft(emptyDraft()); setSelected(new Set());
    send({ mode: 'plan', text: t.briefAsk(briefSummary(b, lang, t), extra), images: [] }, [], emptyDraft(), b);
  };
  // Brief edited mid-chat: tell the AI so it updates the plan.
  const briefEdited = (b: TripBrief) => {
    setEditingBrief(false); setBrief(b); setBriefFound(false);
    if (messages.length && JSON.stringify(b) !== JSON.stringify(brief)) send({ mode, text: t.briefChanged(briefSummary(b, lang, t)), images: [] }, messages, draft, b);
  };

  const total = draftPlaceCount(draft);
  const toggle = (id: string) => setSelected(cur => { const n = new Set(cur); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const setMany = (ids: string[], on: boolean) => setSelected(cur => { const n = new Set(cur); ids.forEach(id => on ? n.add(id) : n.delete(id)); return n; });
  const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant' && !m.error);

  return (
    <div className="np">
      <AnimatePresence>{intro && <PlanIntro onClose={endIntro} />}</AnimatePresence>
      <header className="np-head">
        <div>
          {/* Back to the trip brief from the chat (the chat is kept). */}
          {!wizard && brief && !busy && (
            <button type="button" className="np-back" onClick={() => setWizard('ready')}>
              <Icon name="arrow-l" size={16} /> {t.briefBackToBrief}
            </button>
          )}
          <h1>{targetTrip ? t.addToNamed(targetTrip.name) : t.newPlanTitle}</h1>
        </div>
        <div className="np-head-actions">
          {messages.length > 0 && <Button variant="ghost" size="sm" icon="refresh" onClick={startOver}>{t.startOver}</Button>}
        </div>
      </header>

      {wizard ? (
        <BriefWizard initial={brief ?? emptyBrief()} startAt={wizard} onDone={briefDone}
          onProgress={(b, step) => { try { sessionStorage.setItem(WIZ_STORE, JSON.stringify({ brief: b, step })); } catch { /* private mode */ } }}
          // Back from the first step always leaves for Home (the plan stays saved for next time).
          onCancel={() => nav('/')} cancelLabel={t.home}
          doneLabel={messages.length ? t.briefBackToChat : undefined}
          onReturn={messages.length ? () => setWizard(null) : undefined} returnLabel={t.briefBackToChat} />
      ) : <>
      <Segmented<'chat' | 'plan'> className="np-switch" label={t.newPlanTitle} value={pane} onChange={setPane}
        options={[{ value: 'chat', label: t.chatTab, icon: 'chat' }, { value: 'plan', label: t.planTab(total), icon: 'list-check' }]} />

      <div className="np-grid" data-pane={pane}>
        <section className="np-chat" aria-label={t.chatTab}>
          {brief?.places.length ? <BriefBar brief={brief} note={briefFound} onEdit={() => setEditingBrief(true)} /> : null}
          <div className="np-log" ref={logRef} role="log" aria-live="polite" aria-relevant="additions">
            {messages.length === 0 && (
              <div className="np-intro">
                <span className="tile"><Icon name="sparkles" /></span>
                <h2>{t.composerHeading}</h2>
                <p>{t.composerSub}</p>
                {ai && !ai.ai && <p className="callout warn">{t.aiOffHome}</p>}
              </div>
            )}
            {/* new messages rise in (Animate UI list recipe); ones restored on load show at rest */}
            <AnimatePresence initial={false}>
              {messages.map((m, i) => (
                <motion.div key={i} className={`np-msg ${m.role}${m.error ? ' error' : ''}`} {...listItem}>
                  {m.source && <SourceChip s={m.source} />}
                  <p>{m.content}</p>
                  {m.images ? <span className="np-msg-meta"><Icon name="camera" size={16} /> {t.composerScreenshotsNote(m.images)}</span> : null}
                </motion.div>
              ))}
            </AnimatePresence>
            {busy && <div className="np-msg assistant pending"><span className="np-dots" aria-hidden="true" />{busy === 'link' ? t.readingLink : t.planning}</div>}
          </div>
          {!busy && lastAssistant?.suggestions?.length ? (
            <div className="np-suggest">
              {lastAssistant.suggestions.map(s => (
                <motion.button key={s} type="button" className="chip" {...popItem} onClick={() => send({ mode, text: s, images: [] })}>{s}</motion.button>
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
                <DayGroup key={i} label={`${t.dayN(i + 1)} · ${d.title}`} places={d.places}
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

      </>}

      <AnimatePresence>{editingBrief && brief && (
        <Dialog className="ui-sheet tb-edit-sheet" label={t.briefEdit} onClose={() => setEditingBrief(false)} lightDismiss={false}>
          <div className="ui-sheet-body">
            <BriefWizard initial={brief} startAt="where" editing onDone={b => briefEdited(b)} onCancel={() => setEditingBrief(false)} />
          </div>
        </Dialog>
      )}</AnimatePresence>

      {sheet && (
        <CommitSheet kind={sheet} draft={draft} brief={brief} selected={selected} trips={editable} defaultTripId={targetTrip?.id ?? editable[0]?.id ?? null}
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

function CommitSheet({ kind, draft, brief, selected, trips, defaultTripId, onClose, onDone }: {
  kind: 'new' | 'add'; draft: Draft; brief: TripBrief | null; selected: Set<string>;
  trips: { id: number; name: string; start_date: string | null; end_date: string | null }[];
  defaultTripId: number | null;
  onClose: () => void; onDone: (tripId: number, added: number, located: number) => void;
}) {
  const { t, lang } = useT();
  const { toast } = useToast();
  const locale = lang === 'ms' ? 'ms-MY' : 'en-MY';
  const nDays = Math.max(1, draft.days.length);
  const [name, setName] = useState(draft.name);
  // v0.36: destination and dates come from the trip brief when there is one.
  const [destination, setDestination] = useState(brief?.places.length ? briefDestination(brief, lang) : draft.destination);
  const [range, setRange] = useState(brief?.when?.kind === 'dates' ? { start: brief.when.start, end: brief.when.end } : { start: '', end: '' });
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
          <div key={i}>{dateSelect(map[i] ?? dates[0], v => setMap(m => { const n = [...m]; n[i] = v; return n; }), t.dayGoesTo(`${t.dayN(i + 1)} · ${d.title}`))}</div>
        ))}
        {dates.length > 0 && usesIdeas && dateSelect(ideasDay, setIdeasDay, t.ideasGoTo)}
      </div>
    </FormSheet>
  );
}
