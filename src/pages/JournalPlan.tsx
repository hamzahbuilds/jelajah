import Loading from '../components/Loading';
import PlanDaySummary from '../components/PlanDaySummary';
import TransportLeg from '../components/TransportLeg';
import Modal from "../components/Modal";
import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { api, fmtDate } from "../api";
import { useT } from "../i18n";
import { useSession } from "../App";
import type { TripCtx } from "./TripShell";
import Plan from "./Plan";
import Publishing from "./Publishing";
import TravelNotes from "../components/TravelNotes";
import LeafletMap from "../components/LeafletMap";
import ExpandedMap from '../components/ExpandedMap';
import TransitOptions from '../components/TransitOptions';
import RailDirections from '../components/RailDirections';
import { useToast } from "../components/Toast";
import { routeSegments, routeFailureMessage, useJourneyRoutes } from "../hooks/useJourneyRoutes";
import {
  directionsUrl,
  type Journey,
  type JourneyStop,
  type JourneyDay,
} from "../../shared/journey";
import { geocode, type GeoResult } from "../geo";

export default function JournalPlan() {
  const { t, lang } = useT(),
    j = t.j,
    { tripId, trip, canLead, canEdit } = useOutletContext<TripCtx>(),
    { user } = useSession(),
    { toast } = useToast();
  const [tab, setTab] = useState("group"),
    [plans, setPlans] = useState<any[]>([]),
    [selected, setSelected] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [failed, setFailed] = useState(false);
  const load = () =>
    api
      .get(`/journey/trips/${tripId}/plans`)
      .then((r) => {
        setPlans(r.plans);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  useEffect(() => {
    load();
  }, [tripId]);
  const own = plans.find((p) => p.owner_id === user.id),
    shared = plans.filter((p) => p.owner_id !== user.id);
  const clone = async () => {
    setBusy(true);
    try {
      await api.post(`/journey/trips/${tripId}/clone`);
      await load();
      toast(j.saved);
    } catch {
      toast(j.failed, "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="journal-workspace">
      <div className="journal-intro">
        <div><span className="journal-eyebrow">{trip.destination || trip.name}</span><h1>{lang === "ms" ? "Rancang pengembaraan anda" : "Your next adventure"}</h1><p>{j.journeyIntro}</p></div>
        <Link to="/discover">{j.discover} ↗</Link>
      </div>
      <nav className="journal-tabs" aria-label={t.plan}>
        {[
          ["group", j.group],
          ["mine", j.mine],
          ["shared", j.shared],
          ...(canLead ? [["publish", lang === "ms" ? "Kongsi & eksport" : "Share & export"]] : []),
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? "active" : ""}
            aria-pressed={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "group" ? (
        <Plan />
      ) : tab === "publish" ? (
        <Publishing />
      ) : failed ? (
        <p role="alert">{j.failed}</p>
      ) : tab === "mine" ? (
        own ? (
          <PersonalPlan key={own.id} id={own.id} />
        ) : (
          <section className="journal-hero">
            <span className="journal-eyebrow">{j.private}</span>
            <h2>{j.mine}</h2>
            <p>{j.independent}</p>
            <button className="btn" disabled={busy} onClick={clone}>
              {j.newPlan}
            </button>
          </section>
        )
      ) : (
        <>
          {!shared.length ? (
            <p className="card">{j.noShared}</p>
          ) : (
            <>
              <label>
                {j.shared}
                <select
                  value={selected ?? ""}
                  onChange={(e) => setSelected(Number(e.target.value))}
                >
                  <option value="">{t.none}</option>
                  {shared.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.owner_name}
                    </option>
                  ))}
                </select>
              </label>
              {selected && <PersonalPlan key={selected} id={selected} />}
            </>
          )}
        </>
      )}

    </div>
  );
}

function PersonalPlan({ id }: { id: number }) {
  const { t, lang } = useT(),
    j = t.j,
    { user } = useSession(),
    { tripId, trip } = useOutletContext<TripCtx>(),
    { toast } = useToast();
  const [record, setRecord] = useState<any>(null),
    [failed, setFailed] = useState(false),
    [busy, setBusy] = useState(false),
    [day, setDay] = useState(trip.start_date || ""),
    [editor, setEditor] = useState<JourneyStop | null>(null);
  const [group, setGroup] = useState<Journey | null>(null),
    [selected, setSelected] = useState<number[]>([]),
    [viewers, setViewers] = useState<any[] | null>(null),
    [mapView, setMapView] = useState(false),
    [focus, setFocus] = useState<number | null>(null),
    [undo, setUndo] = useState<Journey | null>(null),
    [dayEdit, setDayEdit] = useState<JourneyDay | null>(null);
  const load = () =>
    api.get(`/journey/plans/${id}`).then((r) => {
      setRecord(r);
      setFailed(false);
    });
  useEffect(() => {
    load().catch(() => setFailed(true));
  }, [id]);
  const content: Journey = record?.content ?? { stops: [], days: [] },
    mine = record?.owner_id === user.id;
  const days = [
    ...new Set([
      ...content.stops.map((a) => a.day),
      ...content.days.filter((d) => d.day !== "*").map((d) => d.day),
      ...(trip.start_date ? [trip.start_date] : []),
      ...(day ? [day] : []),
    ]),
  ].sort();
  const current = day || days[0] || "",
    stops = content.stops.filter((a) => a.day === current);
  const dayInfo = content.days.find((d) => d.day === current),
    defaults = content.days.find((d) => d.day === "*");
  const settings = { ...defaults, ...dayInfo };
  const pins = [
    ...(settings.start_lat != null && settings.start_lng != null
      ? [
          {
            id: "start",
            lat: settings.start_lat,
            lng: settings.start_lng,
            label: settings.start_name || j.startPoint,
          },
        ]
      : []),
    ...stops
      .filter((a) => a.lat !== null && a.lng !== null)
      .map((a) => ({ id: a.id, lat: a.lat!, lng: a.lng!, label: a.title })),
    ...(settings.end_lat != null && settings.end_lng != null
      ? [
          {
            id: "end",
            lat: settings.end_lat,
            lng: settings.end_lng,
            label: settings.end_name || j.endPoint,
          },
        ]
      : []),
  ];
  // Only adjacent located stops form a leg; missing coordinates never silently
  // join two non-adjacent activities into a misleading route.
  const chain = [
    ...(settings.start_lat != null && settings.start_lng != null
      ? [
          {
            id: "start",
            lat: settings.start_lat,
            lng: settings.start_lng,
            mode: "walk",
            title: settings.start_name || j.startPoint,
          },
        ]
      : []),
    ...stops,
    ...(settings.end_lat != null && settings.end_lng != null
      ? [
          {
            id: "end",
            lat: settings.end_lat,
            lng: settings.end_lng,
            mode: "walk",
            title: settings.end_name || j.endPoint,
          },
        ]
      : []),
  ];
  const legs = chain.slice(1).flatMap((to, i) => {
    const from = chain[i];
    return from.lat !== null &&
      from.lng !== null &&
      to.lat !== null &&
      to.lng !== null
      ? [
          {
            key: `${from.id}-${to.id}`,
            from: { lat: from.lat, lng: from.lng, name: from.title },
            originId: from.id,
            to: { lat: to.lat, lng: to.lng, name: to.title },
            chosen: from.mode,
            label: `${from.title} → ${to.title}`,
          },
        ]
      : [];
  });
  const routeResults = useJourneyRoutes(tripId, legs),
    routes = legs.flatMap((l) =>
      routeSegments(routeResults[l.key], l.chosen),
    );
  const total = Object.values(routeResults).reduce(
    (n, r) => n + (r.available ? (r.duration ?? 0) : 0),
    0,
  );
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      toast(j.saved);
    } catch (e: any) {
      toast(e.code === "conflict" ? j.conflict : j.failed, "error");
      await load().catch(() => setFailed(true));
    } finally {
      setBusy(false);
    }
  };
  const save = async (next: Journey, remember = true) => {
    const r = await api.put(`/journey/plans/${id}`, {
      version: record.version,
      content: next,
    });
    if (remember) setUndo(content);
    setRecord({ ...record, version: r.version, content: next });
  };
  const renderTransport = (l: (typeof legs)[number]) => <TransportLeg key={l.key} title={l.label} mode={l.chosen} detail={routeResults[l.key]?.stations?.join(' → ')} summary={routeResults[l.key]?.available ? `${Math.round(routeResults[l.key].duration! / 60)} ${j.minutes} · ${(routeResults[l.key].distance! / 1000).toFixed(1)} km · ${j.estimate}` : routeResults[l.key] ? routeFailureMessage(routeResults[l.key], j) : j.loadingRoute}>
              {['train','metro','transit','intercity'].includes(l.chosen) && <TransitOptions tripId={tripId} from={l.from} to={l.to} railRoute={routeResults[l.key]} />}

<RailDirections route={routeResults[l.key]} />
              <a
                href={directionsUrl(l.from, l.to, l.chosen)}
                target="_blank"
                rel="noreferrer"
              >
                {l.chosen === "transit" ? j.transitDirections : j.directions} ↗
              </a>

    {mine && content.stops.some(s => s.id === l.originId) && <div className="row">
      {(['walk','transit','drive'] as const).map(mode => <button key={mode} className={`chip ${l.chosen === mode ? 'on' : ''}`} aria-pressed={l.chosen === mode} disabled={busy}
        onClick={() => run(() => save({...content,stops:content.stops.map(s => s.id === l.originId ? {...s,mode} : s)}))}>
        {mode === 'walk' ? j.walk : mode === 'transit' ? j.transit : j.drive}
      </button>)}
    </div>}
  </TransportLeg>;
  if (failed) return <p role="alert">{j.failed}</p>;
  if (!record) return <Loading label={t.loading} />;
  return (
    <section className="personal-plan">
      <header className="journal-hero compact">
        <span className="journal-eyebrow">
          {mine ? j.private : `${record.owner_name} · ${j.readOnly}`}
        </span>
        <h2>{mine ? j.mine : j.shared}</h2>
        <p>{j.independent}</p>
        {mine && (
          <div className="row">
            <button
              className="btn secondary sm"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  setGroup(await api.get(`/journey/trips/${tripId}/group`));
                  setSelected([]);
                })
              }
            >
              {j.copyActivities}
            </button>
            <button
              className="btn secondary sm"
              disabled={busy}
              onClick={() =>
                run(async () =>
                  setViewers(
                    (await api.get(`/journey/plans/${id}/viewers`)).items,
                  ),
                )
              }
            >
              {j.viewers}
            </button>
            {undo && (
              <button
                className="btn ghost sm"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await save(undo, false);
                    setUndo(null);
                  })
                }
              >
                {j.undo}
              </button>
            )}
          </div>
        )}
      </header>
      {group && (
        <section className="card">
          <h3>{j.copyActivities}</h3>
          <p>{j.replaceHint}</p>
          {group.stops.map((a) => (
            <label className="journal-choice" key={a.id}>
              <input
                type="checkbox"
                checked={selected.includes(a.sourceId!)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, a.sourceId!]
                      : selected.filter((x) => x !== a.sourceId),
                  )
                }
              />
              <span>
                {a.day} · {a.title}
                <small>
                  {content.stops.some((s) => s.sourceId === a.sourceId)
                    ? j.replace
                    : j.new}
                </small>
              </span>
            </label>
          ))}
          <button
            className="btn sm"
            disabled={busy || !selected.length}
            onClick={() =>
              run(async () => {
                setUndo(content);
                await api.post(`/journey/plans/${id}/copy`, {
                  version: record.version,
                  ids: selected,
                });
                await load();
                setGroup(null);
              })
            }
          >
            {j.copySelected}
          </button>
          <button className="btn ghost sm" onClick={() => setGroup(null)}>
            {t.cancel}
          </button>
        </section>
      )}
      {viewers && (
        <section className="card">
          <h3>{j.viewers}</h3>
          <p>{j.readOnly}</p>
          {viewers.map((v) => (
            <label className="journal-choice" key={v.id}>
              <input
                type="checkbox"
                checked={!!v.selected}
                onChange={(e) =>
                  setViewers(
                    viewers.map((x) =>
                      x.id === v.id ? { ...x, selected: e.target.checked } : x,
                    ),
                  )
                }
              />
              {v.name}
            </label>
          ))}
          <button
            className="btn sm"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.put(`/journey/plans/${id}/viewers`, {
                  ids: viewers.filter((v) => v.selected).map((v) => v.id),
                });
                setViewers(null);
              })
            }
          >
            {t.save}
          </button>
          <button className="btn ghost sm" onClick={() => setViewers(null)}>
            {t.cancel}
          </button>
        </section>
      )}
      <PlanDaySummary partial={legs.some(l => !routeResults[l.key]?.available)} title={dayInfo?.title || fmtDate(current,lang)} count={stops.length} completed={stops.filter(s => s.done).length} next={stops.find(s => !s.done)?.title} minutes={Math.round(total / 60)} />
      <div className="journal-daybar">
        <div className="journal-daychips">
          {days.map((d, i) => (
            <button
              className={d === current ? "active" : ""}
              key={d}
              onClick={() => { setDay(d); setFocus(null); }}
            >
              <b>
                {j.day} {i + 1}
              </b>
              <small>{d}</small>
            </button>
          ))}
        </div>
        <label>
          {j.day}
          <input
            type="date"
            value={current}
            onChange={(e) => setDay(e.target.value)}
          />
        </label>
      </div>
      <div className="row-between">
        <h3>{dayInfo?.title || current}</h3>
        {mine && (
          <div className="row">
            <button
              className="btn ghost sm"
              onClick={() =>
                setDayEdit({
                  day: current,
                  title: dayInfo?.title || "",
                  start_name: settings.start_name || "",
                  start_lat: settings.start_lat ?? null,
                  start_lng: settings.start_lng ?? null,
                  end_name: settings.end_name || "",
                  end_lat: settings.end_lat ?? null,
                  end_lng: settings.end_lng ?? null,
                })
              }
            >
              {j.editDay}
            </button>
            <button
              className="btn sm"
              disabled={!current || busy}
              onClick={() =>
                setEditor({
                  id: crypto.randomUUID(),
                  day: current,
                  title: "",
                  start_time: "",
                  end_time: "",
                  location_name: "",
                  lat: null,
                  lng: null,
                  notes: "",
                  mode: "walk",
                  done: false,
                })
              }
            >
              {t.add} {j.activity}
            </button>
          </div>
        )}
      </div>
      <div className="journal-mobile-toggle">
        <button
          className={`btn ${!mapView ? "" : "ghost"}`}
          onClick={() => setMapView(false)}
        >
          {j.list}
        </button>
        <button
          className={`btn ${mapView ? "" : "ghost"}`}
          onClick={() => setMapView(true)}
        >
          {j.map}
        </button>
      </div>
      <div className={`journal-columns ${mapView ? "show-map" : "show-list"}`}>
        <div className="journal-timeline">
          {!stops.length && <p className="card">{j.empty}</p>}
          {legs.filter(l => l.key.startsWith('start-')).map(renderTransport)}
          {stops.map((a, i) => (
            <div key={a.id}>
            <article
              key={a.id}
              className={`journal-stop ${focus === pins.findIndex(p => p.id === a.id) && focus !== -1 ? "map-selected" : ""} ${a.done ? "done" : ""}`}
            >
              <div className="stop-time">
                {a.start_time || "—"}
                <small>{a.end_time}</small>
              </div>
              <div className="stop-body">
                <div className="row">
                  <button
                    className="stop-number"
                    aria-label={`${j.map}: ${a.title}`}
                    disabled={a.lat === null || a.lng === null}
                    onClick={() => {
                      setFocus(pins.findIndex((p) => p.id === a.id));
                      setMapView(true);
                    }}
                  >
                    {pins.findIndex((p) => p.id === a.id) >= 0
                      ? pins.findIndex((p) => p.id === a.id) + 1
                      : "—"}
                  </button>
                  <h3>{a.title}</h3>
                  {mine && (
                    <input
                      type="checkbox"
                      aria-label={a.title}
                      checked={a.done}
                      disabled={busy}
                      onChange={() =>
                        run(() =>
                          save({
                            ...content,
                            stops: content.stops.map((s) =>
                              s.id === a.id ? { ...s, done: !s.done } : s,
                            ),
                          }),
                        )
                      }
                    />
                  )}
                </div>
                <p>{a.location_name}</p>
                {a.notes && (
                  <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
                    {a.notes}
                  </p>
                )}
                {mine && (
                  <div className="row">
                    <button
                      className="btn ghost sm"
                      disabled={busy}
                      onClick={() => setEditor(a)}
                    >
                      {t.edit}
                    </button>
                    <button
                      className="btn ghost sm"
                      disabled={busy || !i}
                      aria-label={`${"↑"} ${a.title}`}
                      onClick={() =>
                        run(async () => {
                          const all = [...content.stops],
                            x = all.findIndex((s) => s.id === a.id),
                            y = all.findIndex((s) => s.id === stops[i - 1].id);
                          [all[x], all[y]] = [all[y], all[x]];
                          await save({ ...content, stops: all });
                        })
                      }
                    >
                      ↑
                    </button>
                    <button
                      className="btn ghost sm"
                      disabled={busy}
                      onClick={() => {
                        if (window.confirm(j.deleteConfirm))
                          run(() =>
                            save({
                              ...content,
                              stops: content.stops.filter((s) => s.id !== a.id),
                            }),
                          );
                      }}
                    >
                      {t.delete}
                    </button>
                  </div>
                )}
              </div>
            </article>
            {legs.filter(l => l.key.startsWith(`${a.id}-`)).map(renderTransport)}
            </div>
          ))}

        </div>
        <aside className="journal-map card">
          <div className="cardhead"><h3>{j.map}</h3><ExpandedMap key={current} pins={pins} routes={routes} title={`${j.map} · ${current}`}
            stops={stops.map(a => ({ key: a.id, title: a.title, time: a.start_time, detail: a.location_name, pinIndex: pins.findIndex(p => p.id === a.id) }))} /></div>
          <LeafletMap pins={pins} routes={routes} focus={focus} height={420} onSelectPin={setFocus} />
          <p>
            {j.travelTotal}: {Math.round(total / 60)} {j.minutes}
            {Object.values(routeResults).filter((r) => r.available).length !==
            legs.length
              ? ` · ${j.estimate}`
              : ""}
          </p>
        </aside>
      </div>
      <TravelNotes tripId={tripId} canEdit={false} day={current} />
      {editor && (
        <StopEditor
          value={editor}
          busy={busy}
          onClose={() => setEditor(null)}
          onSave={(a) =>
            run(async () => {
              const exists = content.stops.some((s) => s.id === a.id);
              await save({
                ...content,
                stops: exists
                  ? content.stops.map((s) => (s.id === a.id ? a : s))
                  : [...content.stops, a],
              });
              setEditor(null);
            })
          }
        />
      )}
      {dayEdit && (
        <Modal
          open
          onClose={() => setDayEdit(null)}
          title={j.editDay}
          closeLabel={t.close}
        >
          <form
            className="journal-editor"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await save({
                  ...content,
                  days: [
                    ...content.days.filter((d) => d.day !== dayEdit.day),
                    dayEdit,
                  ],
                });
                setDayEdit(null);
              });
            }}
          >
            <h2>{j.editDay}</h2>
            <label>
              {j.dayTitle}
              <input
                value={dayEdit.title}
                onChange={(e) =>
                  setDayEdit({ ...dayEdit, title: e.target.value })
                }
              />
            </label>
            {(["start", "end"] as const).map((k) => (
              <fieldset key={k}>
                <legend>{k === "start" ? j.startPoint : j.endPoint}</legend>
                <label>
                  {j.location}
                  <input
                    value={dayEdit[`${k}_name`]}
                    onChange={(e) =>
                      setDayEdit({ ...dayEdit, [`${k}_name`]: e.target.value })
                    }
                  />
                </label>
                <div className="row">
                  {(["lat", "lng"] as const).map((axis) => (
                    <label key={axis}>
                      {axis === "lat" ? j.latitude : j.longitude}
                      <input
                        type="number"
                        step="any"
                        min={axis === "lat" ? -90 : -180}
                        max={axis === "lat" ? 90 : 180}
                        value={dayEdit[`${k}_${axis}`] ?? ""}
                        onChange={(e) =>
                          setDayEdit({
                            ...dayEdit,
                            [`${k}_${axis}`]:
                              e.target.value === ""
                                ? null
                                : Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <button className="btn" disabled={busy}>
              {t.save}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => setDayEdit(null)}
            >
              {t.cancel}
            </button>
          </form>
        </Modal>
      )}
    </section>
  );
}

function StopEditor({
  value,
  busy,
  onSave,
  onClose,
}: {
  value: JourneyStop;
  busy: boolean;
  onSave: (a: JourneyStop) => void;
  onClose: () => void;
}) {
  const { t } = useT(),
    j = t.j,
    [a, setA] = useState(value),
    [places, setPlaces] = useState<GeoResult[]>([]),
    [searching, setSearching] = useState(false);
  return (
    <Modal open onClose={onClose} title={j.activity} closeLabel={t.close}>
      <form
        className="journal-editor"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(a);
        }}
      >
        <h2>{j.activity}</h2>
        <label>
          {j.title}
          <input
            autoFocus
            value={a.title}
            onChange={(e) => setA({ ...a, title: e.target.value })}
            maxLength={200}
            required
          />
        </label>
        <div className="row">
          <label>
            {j.day}
            <input
              type="date"
              required
              value={a.day}
              onChange={(e) => setA({ ...a, day: e.target.value })}
            />
          </label>
          <label>
            {j.time}
            <input
              type="time"
              value={a.start_time}
              onChange={(e) => setA({ ...a, start_time: e.target.value })}
            />
          </label>
          <label>
            {j.endTime}
            <input
              type="time"
              value={a.end_time}
              onChange={(e) => setA({ ...a, end_time: e.target.value })}
            />
          </label>
        </div>
        <label>
          {j.location}
          <input
            value={a.location_name}
            onChange={(e) => {
              setA({
                ...a,
                location_name: e.target.value,
                lat: null,
                lng: null,
              });
              setPlaces([]);
            }}
            maxLength={300}
          />
        </label>
        <button
          type="button"
          className="btn ghost sm"
          disabled={searching || !a.location_name}
          onClick={async () => {
            setSearching(true);
            try {
              setPlaces(await geocode(a.location_name));
            } finally {
              setSearching(false);
            }
          }}
        >
          {searching ? t.loading : j.searchPlace}
        </button>
        {places.map((p, i) => (
          <button
            type="button"
            className="place-result"
            key={i}
            onClick={() => {
              setA({ ...a, location_name: p.name, lat: p.lat, lng: p.lng });
              setPlaces([]);
            }}
          >
            {p.name}
          </button>
        ))}
        <LeafletMap
          pins={[]}
          picked={
            a.lat !== null && a.lng !== null ? { lat: a.lat, lng: a.lng } : null
          }
          onPick={(lat, lng) => setA({ ...a, lat, lng })}
          height={180}
        />
        <div className="row">
          {(["lat", "lng"] as const).map((k) => (
            <label key={k}>
              {k === "lat" ? j.latitude : j.longitude}
              <input
                type="number"
                step="any"
                min={k === "lat" ? -90 : -180}
                max={k === "lat" ? 90 : 180}
                value={a[k] ?? ""}
                onChange={(e) =>
                  setA({
                    ...a,
                    [k]: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
              />
            </label>
          ))}
        </div>
        <label>
          {j.mode}
          <select
            value={a.mode}
            onChange={(e) =>
              setA({ ...a, mode: e.target.value as JourneyStop["mode"] })
            }
          >
            <option value="walk">{j.walk}</option>
            <option value="drive">{j.drive}</option>
            <option value="transit">{j.transit}</option>
          </select>
        </label>
        <label>
          {j.notes}
          <textarea
            value={a.notes}
            maxLength={2000}
            onChange={(e) => setA({ ...a, notes: e.target.value })}
          />
        </label>
        <div className="row">
          <button className="btn" disabled={busy}>
            {t.save}
          </button>
          <button type="button" className="btn ghost" onClick={onClose}>
            {t.cancel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
