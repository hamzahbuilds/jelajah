import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import SiteHeader from "../components/SiteHeader";
import { api } from "../api";
import { useT } from "../i18n";
import PublicSchedule from "../components/PublicSchedule";
import type { PublicJourney } from "../../shared/journey";
import { Icon, IconDefs } from "../components/Icon";

export default function PublicJourneys({
  guest = false,
  detail = false,
  embedded = false,
}: {
  guest?: boolean;
  detail?: boolean;
  /** Inside the signed-in app: its nav is around us, so no brand bar or sign-in link. */
  embedded?: boolean;
}) {
  const { t } = useT(),
    j = t.j,
    params = useParams(),
    [sp] = useSearchParams();
  const [data, setData] = useState<PublicJourney | null>(null),
    [items, setItems] = useState<any[]>([]),
    [failed, setFailed] = useState(false),
    [loading, setLoading] = useState(true);
  // v0.42: the homepage's destination cards open /discover?q=Kyoto.
  const [q, setQ] = useState(() => sp.get("q") ?? ""),
    [search, setSearch] = useState(() => sp.get("q") ?? ""),
    [duration, setDuration] = useState("0"),
    [page, setPage] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    setData(null);
    const path = guest
      ? `guest/${params.token}`
      : detail
        ? `guides/${params.id}`
        : `guides?${new URLSearchParams({ q: search, duration, page: String(page) })}`;
    api
      .get(`/journey/${path}`)
      .then((r) => {
        if (active) {
          if (guest || detail) setData(r);
          else setItems(r.items);
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [guest, detail, params.token, params.id, search, duration, page]);
  useEffect(() => {
    if (!guest) return;
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex,nofollow";
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, [guest]);
  // Inside the app the shell already provides <main>; the public page is its own.
  const Wrap = embedded ? "div" : "main";
  return (
    <>
    {!embedded && <><IconDefs /><div className="no-print site-header-host"><SiteHeader /></div></>}
    <Wrap className={embedded ? "journey-public embedded" : "journey-public"}>
      {embedded ? (detail && (
        <Link to="/discover" className="np-back no-print"><Icon name="arrow-l" size={16} /> {j.discover}</Link>
      )) : (
      <>
        {detail && (
          <Link to="/discover" className="np-back no-print"><Icon name="arrow-l" size={16} /> {j.discover}</Link>
        )}
      </>
      )}
      {loading ? (
        <p role="status">{t.loading}</p>
      ) : failed ? (
        <p role="alert" className="card">
          {j.missing}
        </p>
      ) : data ? (
        <>
          <button className="btn no-print" onClick={() => window.print()}>
            {j.print}
          </button>
          <PublicSchedule data={data} guide={!guest} />
        </>
      ) : (
        <>
          <header className="journal-hero">
            <span className="journal-eyebrow">Jelajah</span>
            <h1>{j.discover}</h1>
            <p>{j.discoverHint}</p>
          </header>
          <form
            className="discover-search"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(0);
              setSearch(q);
            }}
          >
            <label>
              {j.search}
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                maxLength={100}
              />
            </label>
            <label>
              {j.duration}
              <select
                value={duration}
                onChange={(e) => {
                  setDuration(e.target.value);
                  setPage(0);
                }}
              >
                <option value="0">{j.all}</option>
                {[3, 7, 14, 30].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn">{j.search}</button>
          </form>
          <div className="guide-grid">
            {items.map((g) => (
              <Link className="guide-card" key={g.id} to={`/guides/${g.id}`}>
                <div>
                  <small>{g.destination}</small>
                  <h2>{g.title}</h2>
                  <span>{t.nDays(g.duration)}</span>
                </div>
              </Link>
            ))}
          </div>
          {!items.length && <p>{j.noGuides}</p>}
          <div className="row">
            <button
              className="btn ghost"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              {j.previous}
            </button>
            <button
              className="btn ghost"
              disabled={items.length < 24}
              onClick={() => setPage(page + 1)}
            >
              {j.next}
            </button>
          </div>
        </>
      )}
    </Wrap>
    </>
  );
}
