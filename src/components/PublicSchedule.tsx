// v0.44 read-only schedule (docs/30): shared journeys, guest links and
// template previews. Each day is a timeline (ordered list, time first), which
// reads better than a six-column table on a phone and still prints cleanly.
import type { ReactNode } from "react";
import type { PublicJourney } from "../../shared/journey";
import type { TripTemplate } from "../../shared/templates";
import { useT } from "../i18n";
import { Icon } from "./Icon";
import { Flag } from "./TripBrief";
import "../pages/discover.css";

export default function PublicSchedule({ data, guide = false, template = null, actions }: {
  data: PublicJourney;
  guide?: boolean;
  template?: TripTemplate | null;
  actions?: ReactNode;
}) {
  const { t } = useT(), j = t.j;
  const places = data.days.reduce((n, d) => n + d.stops.length, 0);
  const mode = (m: string) => (m === "walk" ? j.walk : m === "drive" ? j.drive : m ? j.transit : "");
  return (
    <article className="public-schedule">
      <header className="dv-hero">
        <p className="dv-eyebrow">
          {template ? <><Flag code={template.country} /> {t.templates}</> : guide ? j.guide : j.readOnly}
        </p>
        <h1>{data.title}</h1>
        <p className="dv-hero-dest"><Icon name="pin" size={16} /> {data.destination}</p>
        {template && <p className="dv-sub">{template.summary}</p>}
        <ul className="dv-facts">
          <li><Icon name="calendar" size={16} /> {t.nDays(data.days.length)}</li>
          <li><Icon name="map" size={16} /> {t.placesN(places)}</li>
          {data.updatedAt && <li><Icon name="clock" size={16} /> {j.updated}: {data.updatedAt.replace("T", " ").slice(0, 16)} UTC</li>}
        </ul>
        {actions && <div className="dv-actions no-print">{actions}</div>}
      </header>

      <ol className="dv-days">
        {data.days.map((d, i) => (
          <li key={i} className="dv-day">
            <h2>
              <span className="dv-day-n">{j.day} {i + 1}</span>
              <span>{d.title || (!guide ? d.label : "")}</span>
            </h2>
            {!guide && d.title && <p className="dv-meta">{d.label}</p>}
            {d.stops.length ? (
              <ol className="dv-stops">
                {d.stops.map((s, k) => (
                  <li key={k}>
                    <span className="dv-time">
                      {s.time || "—"}
                      {s.endTime && <small>{s.endTime}</small>}
                    </span>
                    <span className="dv-dot" aria-hidden="true" />
                    <div className="dv-stop">
                      <strong>{s.title}</strong>
                      {s.location && s.location !== s.title && <span className="dv-loc">{s.location}</span>}
                      {(s.duration || s.mode) && (
                        <span className="dv-meta">
                          {s.duration ? `${s.duration} ${j.minutes}` : ""}
                          {s.duration && s.mode ? " · " : ""}
                          {mode(s.mode)}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            ) : <p className="dv-meta">—</p>}
            {d.notes.some(note => note.trim()) && (
              <section className="schedule-notes" aria-label={j.notes}>
                <h3>{j.notes}</h3>
                <ul>{d.notes.filter(note => note.trim()).map((note, k) => <li key={k}>{note}</li>)}</ul>
              </section>
            )}
          </li>
        ))}
      </ol>
    </article>
  );
}
