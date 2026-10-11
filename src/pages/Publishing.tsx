import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { api } from "../api";
import { useT } from "../i18n";
import { useToast } from "../components/Toast";
import PublicSchedule from "../components/PublicSchedule";
import type { PublicJourney } from "../../shared/journey";
import type { TripCtx } from "./TripShell";

export default function Publishing() {
  const { t } = useT(),
    j = t.j,
    { tripId } = useOutletContext<TripCtx>(),
    { toast } = useToast();
  const [notes, setNotes] = useState<any[]>([]),
    [ids, setIds] = useState<number[]>([]),
    [links, setLinks] = useState<any[]>([]),
    [guides, setGuides] = useState<any[]>([]);
  const [preview, setPreview] = useState<PublicJourney | null>(null),
    [guide, setGuide] = useState(false),
    [draftId, setDraftId] = useState<string | null>(null),
    [draft, setDraft] = useState<PublicJourney | null>(null),
    [expires, setExpires] = useState(""),
    [link, setLink] = useState(""),
    [busy, setBusy] = useState(false);
  const base = `/journey/trips/${tripId}/publishing`;
  const load = async () => {
    const [n, l, g] = await Promise.all([
      api.get(`/journey/trips/${tripId}/notes`),
      api.get(`${base}/links`),
      api.get(`${base}/guides`),
    ]);
    setNotes(n.items.filter((n: any) => n.visibility === "group"));
    setLinks(l.items);
    setGuides(g.items);
  };
  useEffect(() => {
    load().catch(() => toast(j.failed, "error"));
  }, [tripId]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await load();
      toast(j.saved);
    } catch {
      toast(j.failed, "error");
    } finally {
      setBusy(false);
    }
  };
  const invalidate = () => {
    setPreview(null);
    setDraft(null);
    setDraftId(null);
  };
  const changeDay = (index: number, change: any) => {
    if (!draft) return;
    setDraft({
      ...draft,
      days: draft.days.map((d, i) => (i === index ? { ...d, ...change } : d)),
    });
    setPreview(null);
  };
  return (
    <div className="publishing">
      <header className="journal-hero compact">
        <span className="journal-eyebrow">{j.readOnly}</span>
        <h2>{j.publish}</h2>
        <p>{guide ? j.guideHint : j.guestHint}</p>
      </header>
      <div className="seg no-print">
        <button
          className={!guide ? "on" : ""}
          onClick={() => {
            setGuide(false);
            invalidate();
          }}
        >
          {j.guest}
        </button>
        <button
          className={guide ? "on" : ""}
          onClick={() => {
            setGuide(true);
            invalidate();
          }}
        >
          {j.guide}
        </button>
      </div>
      <section className="card no-print">
        <h3>{j.selectedNotes}</h3>
        <p className="muted">{j.noNotes}</p>
        {notes.map((n) => (
          <label className="journal-choice" key={n.id}>
            <input
              type="checkbox"
              checked={ids.includes(n.id)}
              onChange={(e) => {
                setIds(
                  e.target.checked
                    ? [...ids, n.id]
                    : ids.filter((id) => id !== n.id),
                );
                invalidate();
              }}
            />
            <span>
              {n.day === "*" ? j.tripNote : n.day} · {n.content}
            </span>
          </label>
        ))}
        {!guide && (
          <label>
            {j.expiry}
            <input
              type="datetime-local"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          </label>
        )}
        <button
          className="btn"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const p = await api.post(`${base}/preview`, {
                noteIds: ids,
                guide,
              });
              if (guide) {
                setDraft(p);
                setDraftId(null);
              }
              setPreview(p);
            })
          }
        >
          {guide ? j.createDraft : j.preview}
        </button>
      </section>
      {draft && guide && (
        <section className="card guide-editor no-print">
          <h3>{j.draft}</h3>
          <label>
            {j.title}
            <input
              maxLength={200}
              value={draft.title}
              onChange={(e) => {
                setDraft({ ...draft, title: e.target.value });
                setPreview(null);
              }}
            />
          </label>
          <label>
            {j.destination}
            <input
              maxLength={300}
              value={draft.destination}
              onChange={(e) => {
                setDraft({ ...draft, destination: e.target.value });
                setPreview(null);
              }}
            />
          </label>
          {draft.days.map((d, i) => (
            <fieldset key={i}>
              <legend>
                {j.day} {i + 1}
              </legend>
              <label>
                {j.dayTitle}
                <input
                  value={d.title}
                  onChange={(e) => changeDay(i, { title: e.target.value })}
                />
              </label>
              {d.stops.map((s, k) => (
                <div className="guide-stop-editor" key={k}>
                  <label>
                    {j.activity}
                    <input
                      value={s.title}
                      onChange={(e) =>
                        changeDay(i, {
                          stops: d.stops.map((x, z) =>
                            z === k ? { ...x, title: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    {j.location}
                    <input
                      value={s.location}
                      onChange={(e) =>
                        changeDay(i, {
                          stops: d.stops.map((x, z) =>
                            z === k ? { ...x, location: e.target.value } : x,
                          ),
                        })
                      }
                    />
                  </label>
                  <button
                    className="btn ghost sm"
                    onClick={() =>
                      changeDay(i, { stops: d.stops.filter((_, z) => z !== k) })
                    }
                  >
                    {t.delete}
                  </button>
                </div>
              ))}
              <label>
                {j.guideNotes}
                <textarea
                  value={d.notes.join("\n")}
                  onChange={(e) =>
                    changeDay(i, {
                      notes: e.target.value.split("\n").filter(Boolean),
                    })
                  }
                />
              </label>
              <button
                className="btn ghost sm"
                onClick={() => {
                  setDraft({
                    ...draft,
                    days: draft.days.filter((_, z) => z !== i),
                  });
                  setPreview(null);
                }}
              >
                {t.delete} {j.day}
              </button>
            </fieldset>
          ))}
          <div className="row">
            <button
              className="btn secondary"
              disabled={busy || !draft.title.trim()}
              onClick={() =>
                run(async () => {
                  if (draftId)
                    await api.put(`${base}/guides/${draftId}`, { draft });
                  else
                    setDraftId(
                      (await api.post(`${base}/guides`, { draft })).id,
                    );
                })
              }
            >
              {j.saveDraft}
            </button>
            <button
              className="btn"
              disabled={!draft.title.trim()}
              onClick={() => setPreview(draft)}
            >
              {j.preview}
            </button>
          </div>
        </section>
      )}
      {preview && (
        <section className="publish-preview">
          <p className="callout info no-print">{j.previewHint}</p>
          <PublicSchedule data={preview} guide={guide} />
          <div className="row no-print">
            <button className="btn secondary" onClick={() => window.print()}>
              {j.print}
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (guide) {
                    let id = draftId;
                    if (!id)
                      id = (
                        await api.post(`${base}/guides`, { draft: preview })
                      ).id;
                    await api.put(`${base}/guides/${id}`, {
                      draft: preview,
                      publish: true,
                    });
                    setDraftId(id);
                  } else {
                    const r = await api.post(`${base}/links`, {
                      noteIds: ids,
                      expiresAt: expires
                        ? new Date(expires).toISOString()
                        : null,
                    });
                    setLink(new URL(r.path, location.origin).href);
                  }
                })
              }
            >
              {guide ? j.publishGuide : j.createLink}
            </button>
          </div>
        </section>
      )}
      {link && (
        <section className="card no-print">
          <p>{j.linkOnce}</p>
          <input
            aria-label={j.guest}
            value={link}
            readOnly
            onFocus={(e) => e.target.select()}
          />
          <button
            className="btn"
            onClick={() =>
              run(async () => {
                await navigator.clipboard.writeText(link);
              })
            }
          >
            {j.copyLink}
          </button>
          <a href={link} target="_blank" rel="noreferrer">
            {j.preview} ↗
          </a>
        </section>
      )}
      <section className="card no-print">
        <h3>{guide ? j.guide : j.guest}</h3>
        {guide
          ? guides.map((g) => (
              <div className="publishing-item" key={g.id}>
                <strong>{JSON.parse(g.draft).title}</strong>
                <span>
                  {g.taken_down ? j.takenDown : g.live ? j.live : j.draft}
                </span>
                <div className="row">
                  <button
                    className="btn ghost sm"
                    onClick={() => {
                      setDraftId(g.id);
                      setDraft(JSON.parse(g.draft));
                      setPreview(null);
                    }}
                  >
                    {t.edit}
                  </button>
                  {g.live && (
                    <>
                      <Link to={`/guides/${g.id}`}>{j.viewGuide}</Link>
                      <button
                        className="btn ghost sm"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await api.del(`${base}/guides/${g.id}`);
                          })
                        }
                      >
                        {j.unpublish}
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          : links.map((l) => (
              <div className="publishing-item" key={l.id}>
                <span>
                  #{l.id} · {l.created_at}
                </span>
                <span>
                  {l.revoked
                    ? j.revoked
                    : l.expires_at
                      ? new Date(l.expires_at).toLocaleString()
                      : j.guest}
                </span>
                {!l.revoked && (
                  <button
                    className="btn ghost sm"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api.del(`${base}/links/${l.id}`);
                        setLink("");
                      })
                    }
                  >
                    {j.revoke}
                  </button>
                )}
              </div>
            ))}
      </section>
    </div>
  );
}

export function GuideModeration() {
  const { t } = useT(),
    j = t.j,
    { toast } = useToast(),
    [items, setItems] = useState<any[]>([]),
    [busy, setBusy] = useState(false);
  const load = () =>
    api.get("/journey/admin/guides").then((r) => setItems(r.items));
  useEffect(() => {
    load().catch(() => toast(j.failed, "error"));
  }, []);
  return (
    <section className="card">
      <h2>{j.moderate}</h2>
      {items.map((g) => (
        <div className="publishing-item" key={g.id}>
          <span>
            {g.title} · {g.destination}
          </span>
          <button
            className="btn secondary sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.patch(`/journey/admin/guides/${g.id}`, {
                  takenDown: !g.taken_down,
                });
                await load();
                toast(j.saved);
              } catch {
                toast(j.failed, "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            {g.taken_down ? j.restore : j.takeDown}
          </button>
        </div>
      ))}
    </section>
  );
}
