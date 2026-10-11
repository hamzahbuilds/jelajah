import type { PublicJourney } from "../../shared/journey";
import { useT } from "../i18n";
export default function PublicSchedule({
  data,
  guide = false,
}: {
  data: PublicJourney;
  guide?: boolean;
}) {
  const { t } = useT(),
    j = t.j;
  return (
    <article className="public-schedule">
      <header className="journal-hero">
        <span className="journal-eyebrow">{guide ? j.guide : j.readOnly}</span>
        <h1>{data.title}</h1>
        <p>{data.destination}</p>
        <small>
          {j.updated}: {data.updatedAt.replace("T", " ").slice(0, 16)} UTC
        </small>
      </header>
      {data.days.map((d, i) => (
        <section className="public-day" key={i}>
          <h2>
            <span className="day-stamp">
              {j.day} {i + 1}
            </span>{" "}
            {d.title || (!guide ? d.label : "")}
          </h2>
          {!guide && d.title && <p>{d.label}</p>}
          <div className="schedule-scroll">
            <table>
              <thead>
                <tr>
                  <th>{j.day}</th>
                  <th>{j.publicTimes}</th>
                  <th>{j.activity}</th>
                  <th>{j.location}</th>
                  <th>{j.transport}</th>
                  <th>{j.durationCol}</th>
                </tr>
              </thead>
              <tbody>
                {d.stops.map((s, k) => (
                  <tr key={k}>
                    <td>{guide ? i + 1 : d.label}</td>
                    <td>
                      {s.time || "—"}
                      {s.endTime ? ` – ${s.endTime}` : ""}
                    </td>
                    <td>{s.title}</td>
                    <td>{s.location || "—"}</td>
                    <td>
                      {s.mode === "walk"
                        ? j.walk
                        : s.mode === "drive"
                          ? j.drive
                          : j.transit}
                    </td>
                    <td>{s.duration ? `${s.duration} ${j.minutes}` : "—"}</td>
                  </tr>
                ))}
                {!d.stops.length && (
                  <tr>
                    <td>{guide ? i + 1 : d.label}</td>
                    <td colSpan={5}>—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {d.notes.some(note => note.trim()) && (
            <section className="schedule-notes">
              <h3>{j.notes}</h3>
              <ul>
                {d.notes.filter(note => note.trim()).map((note, k) => (
                  <li key={k}>{note}</li>
                ))}
              </ul>
            </section>
          )}
        </section>
      ))}
    </article>
  );
}
