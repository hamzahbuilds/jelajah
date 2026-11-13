// v0.44 Discover (docs/30): starter templates plus plans travellers shared,
// one search across both, and a preview page where any of them becomes your
// trip ("Use this template" opens New plan with the plan already picked).
// Signed out it sits under the public site header; signed in, inside the app.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import SiteHeader from "../components/SiteHeader";
import { api } from "../api";
import { useT } from "../i18n";
import PublicSchedule from "../components/PublicSchedule";
import type { PublicJourney } from "../../shared/journey";
import { TEMPLATES, journeyAsDraft, templateAsJourney, templateById, templatePlaces, type TripTemplate } from "../../shared/templates";
import { Icon, IconDefs } from "../components/Icon";
import { Flag } from "../components/TripBrief";
import "./discover.css";

interface GuideRow { id: string; title: string; destination: string; duration: number }
const DURATIONS = [0, 3, 5, 7] as const;
const TEMPLATE_PREFIX = "template-";

export default function PublicJourneys({ guest = false, detail = false, embedded = false }: {
  guest?: boolean;
  detail?: boolean;
  /** Inside the signed-in app: its nav is around us, so no brand bar or sign-in link. */
  embedded?: boolean;
}) {
  const { t } = useT(), j = t.j, params = useParams(), [sp] = useSearchParams(), nav = useNavigate();
  const [data, setData] = useState<PublicJourney | null>(null);
  const [items, setItems] = useState<GuideRow[]>([]);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  // v0.42: the homepage's destination cards open /discover?q=Kyoto.
  const [q, setQ] = useState(() => sp.get("q") ?? "");
  const [search, setSearch] = useState(() => sp.get("q") ?? "");
  const [duration, setDuration] = useState(0);
  const [page, setPage] = useState(0);
  const tplId = detail && params.id?.startsWith(TEMPLATE_PREFIX) ? params.id.slice(TEMPLATE_PREFIX.length) : null;
  const tpl = tplId ? templateById(tplId) : null;

  useEffect(() => {
    let active = true;
    setFailed(false); setData(null);
    if (tplId) {
      if (tpl) setData(templateAsJourney(tpl)); else setFailed(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    const path = guest ? `guest/${params.token}` : detail ? `guides/${params.id}`
      : `guides?${new URLSearchParams({ q: search, duration: String(duration), page: String(page) })}`;
    api.get(`/journey/${path}`)
      .then(r => { if (active) { if (guest || detail) setData(r); else setItems(r.items); } })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [guest, detail, params.token, params.id, search, duration, page, tplId, tpl]);

  useEffect(() => {
    if (!guest) return;
    const meta = document.createElement("meta");
    meta.name = "robots"; meta.content = "noindex,nofollow";
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, [guest]);

  const templates = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return TEMPLATES.filter(x => (!needle || `${x.draft.name} ${x.draft.destination} ${x.tags.join(" ")}`.toLowerCase().includes(needle))
      && (!duration || x.draft.days.length <= duration));
  }, [search, duration]);

  /** Signed in: straight into New plan with the plan picked. Signed out: sign in first. */
  const startFrom = (name: string, draft: ReturnType<typeof journeyAsDraft>) => {
    if (embedded) nav("/new", { state: { template: { name, draft } } });
    else nav("/login");
  };
  const useLabel = embedded ? t.useTemplate : t.signInToUse;

  // Inside the app the shell already provides <main>; the public page is its own.
  const Wrap = embedded ? "div" : "main";
  return (
    <>
      {!embedded && <><IconDefs /><div className="no-print site-header-host"><SiteHeader /></div></>}
      <Wrap className={embedded ? "journey-public embedded" : "journey-public"}>
        {(detail || guest) ? (
          <>
            {detail && <Link to="/discover" className="dv-back no-print"><Icon name="arrow-l" size={16} /> {j.discover}</Link>}
            {loading ? <p role="status" className="dv-status">{t.loading}</p>
              : failed || !data ? <p role="alert" className="dv-empty">{j.missing}</p>
              : (
                <PublicSchedule data={data} guide={!guest} template={tpl}
                  actions={
                    <>
                      {!guest && (
                        <button type="button" className="btn" onClick={() => startFrom(data.title, tpl ? tpl.draft : journeyAsDraft(data))}>
                          <Icon name="copy" size={16} /> {useLabel}
                        </button>
                      )}
                      <button type="button" className="btn secondary" onClick={() => window.print()}>
                        <Icon name="download" size={16} /> {j.print}
                      </button>
                    </>
                  } />
              )}
          </>
        ) : (
          <>
            <header className="dv-head">
              <p className="dv-eyebrow">{j.discover}</p>
              <h1>{t.discoverHead}</h1>
              <p className="dv-sub">{t.discoverSub}</p>
            </header>

            <search className="dv-search">
              <form role="search" onSubmit={e => { e.preventDefault(); setPage(0); setSearch(q); }}>
                <label className="dv-field">
                  <span className="sr-only">{j.search}</span>
                  <Icon name="search" size={20} />
                  <input type="search" name="q" value={q} onChange={e => setQ(e.target.value)} maxLength={100}
                    placeholder={j.search} autoComplete="off" />
                </label>
                <button className="btn" type="submit">{t.searchBtn}</button>
              </form>
              <div className="dv-chips" role="group" aria-label={j.duration}>
                {DURATIONS.map(n => (
                  <button key={n} type="button" className="dv-chip" aria-pressed={duration === n}
                    onClick={() => { setDuration(n); setPage(0); }}>
                    {n ? t.upToDays(n) : t.anyLength}
                  </button>
                ))}
              </div>
            </search>

            {templates.length > 0 && page === 0 && (
              <section className="dv-section" aria-labelledby="dv-templates">
                <div className="dv-section-head">
                  <h2 id="dv-templates">{t.templates}</h2>
                  <p>{t.templatesHint}</p>
                </div>
                <ul className="dv-grid">
                  {templates.map(x => (
                    <li key={x.id}><TemplateCard tpl={x} useLabel={useLabel} onUse={() => startFrom(x.draft.name, x.draft)} /></li>
                  ))}
                </ul>
              </section>
            )}

            <section className="dv-section" aria-labelledby="dv-shared" aria-busy={loading || undefined}>
              <div className="dv-section-head">
                <h2 id="dv-shared">{t.sharedJourneys}</h2>
                <p>{j.discoverHint}</p>
              </div>
              {loading ? <p role="status" className="dv-status">{t.loading}</p>
                : failed ? <p role="alert" className="dv-empty">{j.missing}</p>
                : items.length ? (
                  <ul className="dv-grid">
                    {items.map(g => (
                      <li key={g.id}>
                        <Link className="dv-card dv-guide" to={`/guides/${g.id}`}>
                          <span className="dv-guide-dest"><Icon name="pin" size={16} /> {g.destination}</span>
                          <strong>{g.title}</strong>
                          <span className="dv-meta">{t.nDays(g.duration)}</span>
                          <span className="dv-go">{t.preview} <Icon name="arrow-r" size={16} /></span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : <p className="dv-empty">{j.noGuides}</p>}
              {(page > 0 || items.length >= 24) && (
                <nav className="dv-pages" aria-label={j.discover}>
                  <button type="button" className="btn secondary" disabled={!page} onClick={() => setPage(page - 1)}>
                    <Icon name="arrow-l" size={16} /> {j.previous}
                  </button>
                  <button type="button" className="btn secondary" disabled={items.length < 24} onClick={() => setPage(page + 1)}>
                    {j.next} <Icon name="arrow-r" size={16} />
                  </button>
                </nav>
              )}
            </section>
          </>
        )}
      </Wrap>
    </>
  );
}

function TemplateCard({ tpl, useLabel, onUse }: { tpl: TripTemplate; useLabel: string; onUse: () => void }) {
  const { t } = useT();
  const d = tpl.draft;
  const pace = tpl.pace === "relaxed" ? t.paceRelaxed : tpl.pace === "packed" ? t.pacePacked : t.paceBalanced;
  const highlights = d.days.flatMap(x => x.places).filter(p => p.category !== "food" && p.category !== "transport").slice(0, 3);
  return (
    <article className={`dv-card dv-tpl c-${tpl.country.toLowerCase()}`} aria-labelledby={`tpl-${tpl.id}`}>
      <div className="dv-tpl-band">
        <Flag code={tpl.country} />
        <span>{d.destination}</span>
      </div>
      <div className="dv-tpl-body">
        <h3 id={`tpl-${tpl.id}`}>{d.name}</h3>
        <p>{tpl.summary}</p>
        <ul className="dv-tpl-stops" aria-label={t.preview}>
          {highlights.map(p => <li key={p.id}>{p.title}</li>)}
        </ul>
        <p className="dv-meta">{t.nDays(d.days.length)} · {t.placesN(templatePlaces(tpl))} · {pace}</p>
      </div>
      <div className="dv-tpl-actions">
        <button type="button" className="btn" onClick={onUse}>{useLabel}</button>
        <Link to={`/guides/${TEMPLATE_PREFIX}${tpl.id}`} className="btn secondary" aria-label={`${t.preview}: ${d.name}`}>{t.preview}</Link>
      </div>
    </article>
  );
}
