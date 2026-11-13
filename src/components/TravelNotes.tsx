import { useConfirm } from '../ui/Confirm';
import { useEffect, useState } from "react";
import { api } from "../api";
import { useT } from "../i18n";
import { useToast } from "./Toast";
import { Icon } from "./Icon";

export default function TravelNotes({
  tripId,
  canEdit,
  day,
}: {
  tripId: number;
  canEdit: boolean;
  day?: string;
}) {
  const ask = useConfirm();
  const { t, lang } = useT(),
    ms = lang === "ms",
    j = t.j,
    { toast } = useToast();
  const [notes, setNotes] = useState<any[]>([]),
    [content, setContent] = useState(""),
    [scope, setScope] = useState(day || "*"),
    [checkItem, setCheckItem] = useState(false),
    [visibility, setVisibility] = useState("private"),
    [busy, setBusy] = useState(false),
    [edit, setEdit] = useState<any>(null);
  const load = () =>
    api.get(`/journey/trips/${tripId}/notes`).then((r) => setNotes(r.items));
  useEffect(() => {
    load().catch(() => toast(j.failed, "error"));
  }, [tripId]);
  useEffect(() => { setScope(day || "*"); setEdit(null); }, [day]);
  const run = async (fn: () => Promise<any>) => {
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
  return (
    <section className="card travel-notes">
      <h2>{j.notes}</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api.post(`/journey/trips/${tripId}/notes`, {
              day: scope,
              visibility,
              content,
              is_check: visibility === "group" && checkItem,
            });
            setContent("");
          });
        }}
      >
        {/* v0.44: plain choices instead of two dropdowns both called "Day" */}
        <div className="tn-choices">
          <fieldset className="seg-radio">
            <legend>{ms ? "Berkenaan" : "Applies to"}</legend>
            <div>
              <label><input type="radio" name="tn-scope" checked={scope === "*"} onChange={() => setScope("*")} /><span>{j.tripNote}</span></label>
              <label><input type="radio" name="tn-scope" checked={scope !== "*"}
                onChange={() => setScope(day || new Date().toLocaleDateString("en-CA"))} /><span>{ms ? "Satu hari" : "One day"}</span></label>
            </div>
          </fieldset>
          <fieldset className="seg-radio">
            <legend>{ms ? "Siapa boleh lihat" : "Who can see it"}</legend>
            <div>
              <label><input type="radio" name="tn-vis" checked={visibility === "private"} onChange={() => setVisibility("private")} /><span>{j.private}</span></label>
              {canEdit && <label><input type="radio" name="tn-vis" checked={visibility === "group"} onChange={() => setVisibility("group")} /><span>{j.groupNote}</span></label>}
            </div>
          </fieldset>
          {scope !== "*" && (
            <label className="tn-date">
              {ms ? "Tarikh" : "Date"}
              <input type="date" required value={scope} onChange={(e) => setScope(e.target.value)} />
            </label>
          )}
        </div>
        <label className="tn-note" htmlFor="travel-note-content">{ms ? "Nota" : "Note"}</label>
        <textarea
          id="travel-note-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
          maxLength={2000}
          rows={3}
          placeholder={ms ? "Contoh: Bawa pasport untuk check-in hotel" : "e.g. Bring passports for hotel check-in"}
        />
        {visibility === 'group' && <label className="row"><input type="checkbox" checked={checkItem} onChange={e => setCheckItem(e.target.checked)} />{lang === 'ms' ? 'Item senarai semak' : 'Checklist item'}</label>}
        <button className="btn sm" type="submit" disabled={busy}>
          <Icon name="plus" size={16} /> {ms ? "Tambah nota" : "Add note"}
        </button>
      </form>
      <div className="journal-notes-list">
        {notes
          .filter((n) => n.day === "*" || scope === "*" || n.day === scope)
          .map((n) => (
            <article key={`${n.visibility}-${n.id}`}>
              <span
                className={`badge ${n.visibility === "private" ? "gray" : "brand"}`}
              >
                {n.visibility === "private" ? j.private : j.groupNote}
              </span>{" "}
              <small>{n.day === "*" ? j.tripNote : n.day}</small>
              {!!n.is_check && <label className="row"><input type="checkbox" aria-label={n.content} checked={!!n.done} disabled={!canEdit || busy} onChange={e => run(() => api.patch(`/journey/trips/${tripId}/notes/group/${n.id}`, {...n,done:e.target.checked}))} />{t.doneLabel}</label>}
              {edit?.id === n.id && edit?.visibility === n.visibility ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(async () => {
                      await api.patch(
                        `/journey/trips/${tripId}/notes/${n.visibility}/${n.id}`,
                        edit,
                      );
                      setEdit(null);
                    });
                  }}
                >
                  <textarea
                    aria-label={j.notes}
                    value={edit.content}
                    onChange={(e) =>
                      setEdit({ ...edit, content: e.target.value })
                    }
                    required
                    maxLength={2000}
                  />
                  <button className="btn sm" disabled={busy}>
                    {t.save}
                  </button>
                  <button
                    type="button"
                    className="btn ghost sm"
                    onClick={() => setEdit(null)}
                  >
                    {t.cancel}
                  </button>
                </form>
              ) : (
                <p style={{ whiteSpace: "pre-wrap" }}>{n.content}</p>
              )}
              {(n.visibility === "private" || canEdit) && (
                <div className="row">
                  <button
                    className="btn ghost sm"
                    disabled={busy}
                    onClick={() => setEdit(n)}
                  >
                    {t.edit}
                  </button>
                  <button
                    className="btn ghost sm"
                    disabled={busy}
                    onClick={async () => {
                      if (await ask({ title: j.deleteConfirm, tone: 'danger', confirmLabel: t.delete }))
                        run(() =>
                          api.del(
                            `/journey/trips/${tripId}/notes/${n.visibility}/${n.id}`,
                          ),
                        );
                    }}
                  >
                    {t.delete}
                  </button>
                  {n.visibility === "private" && canEdit && (
                    <button
                      className="btn ghost sm"
                      disabled={busy}
                      onClick={async () => {
                        if (await ask({ title: j.copyConfirm }))
                          run(() =>
                            api.post(`/journey/trips/${tripId}/notes`, {
                              day: n.day,
                              content: n.content,
                              visibility: "group",
                            }),
                          );
                      }}
                    >
                      {j.copyGroup}
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}
      </div>
    </section>
  );
}
