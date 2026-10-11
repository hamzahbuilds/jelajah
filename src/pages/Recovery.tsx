import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useT } from "../i18n";
import { clearApiCaches } from "../lib/pwa";

export default function Recovery({ reset = false }: { reset?: boolean }) {
  const { t, lang, setLang } = useT(),
    j = t.j;
  const [token] = useState(() => location.hash.slice(1));
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [err, setErr] = useState("");
  useEffect(() => {
    if (reset) history.replaceState(null, "", location.pathname);
    else
      api
        .get("/journey/recovery/status")
        .then((r) => setAvailable(r.available))
        .catch(() => setAvailable(false));
  }, [reset]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      await api.post(
        `/journey/recovery/${reset ? "reset" : "request"}`,
        reset ? { token, password } : { email },
      );
      if (reset) await clearApiCaches();
      setDone(true);
    } catch (e: any) {
      setErr(
        e.code === "rate_limited"
          ? j.rateLimited
          : reset
            ? j.resetInvalid
            : j.recoveryUnavailable,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="journey-public recovery-page">
      <div className="journal-brand">🧭 Jelajah</div>
      <button
        className="btn ghost sm"
        onClick={() => setLang(lang === "en" ? "ms" : "en")}
      >
        {lang === "en" ? "Bahasa Malaysia" : "English"}
      </button>
      <form className="card journal-recovery" onSubmit={submit}>
        <span className="journal-eyebrow">{j.private}</span>
        <h1>{reset ? j.resetTitle : j.recoveryTitle}</h1>
        {done ? (
          <p role="status">{reset ? j.resetDone : j.resetRequested}</p>
        ) : (
          <>
            {!reset && available === false ? (
              <p role="alert">{j.recoveryUnavailable}</p>
            ) : (
              <>
                <label>
                  {reset ? t.newPassword : t.email}
                  <input
                    type={reset ? "password" : "email"}
                    required
                    minLength={reset ? 8 : undefined}
                    maxLength={reset ? 256 : 254}
                    autoComplete={reset ? "new-password" : "email"}
                    value={reset ? password : email}
                    onChange={(e) =>
                      reset
                        ? setPassword(e.target.value)
                        : setEmail(e.target.value)
                    }
                  />
                </label>
                <button
                  className="btn"
                  disabled={busy || (!reset && available !== true)}
                >
                  {busy ? t.loading : reset ? t.save : j.sendReset}
                </button>
              </>
            )}
          </>
        )}
        {err && (
          <p role="alert" className="callout warn">
            {err}
          </p>
        )}
        <p>
          <Link to="/login">{t.signIn}</Link>
          {reset && (
            <>
              {" "}
              · <Link to="/forgot-password">{j.forgot}</Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
