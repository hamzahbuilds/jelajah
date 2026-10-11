import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { useT } from "../i18n";
import PublicSchedule from "../components/PublicSchedule";
import type { PublicJourney } from "../../shared/journey";

export default function PublicJourneys({
  guest = false,
  detail = false,
}: {
  guest?: boolean;
  detail?: boolean;
}) {
  const { t, lang, setLang } = useT(),
    j = t.j,
    params = useParams();
  const [data, setData] = useState<PublicJourney | null>(null),
    [items, setItems] = useState<any[]>([]),
    [failed, setFailed] = useState(false),
    [loading, setLoading] = useState(true);
  const [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
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
  return (
    <main className="journey-public">
      <nav className="public-nav no-print">
        <Link to="/discover" className="journal-brand">
          🧭 Jelajah
        </Link>
        <div className="row">
          <button
            className="btn ghost sm"
            onClick={() => setLang(lang === "en" ? "ms" : "en")}
          >
            {lang === "en" ? "Bahasa Malaysia" : "English"}
          </button>
          <Link to="/login">{t.signIn}</Link>
        </div>
      </nav>
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
            {items.map((g, i) => (
              <Link className="guide-card" key={g.id} to={`/guides/${g.id}`}>
                <div className={`guide-art art-${i % 3}`} aria-hidden="true">
                  {["🗺️", "🌴", "🏔️"][i % 3]}
                </div>
                <div>
                  <small>{g.destination}</small>
                  <h2>{g.title}</h2>
                  <span>
                    {g.duration} {j.day}
                  </span>
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
    </main>
  );
}
