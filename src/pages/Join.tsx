import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useT } from '../i18n';

interface JoinInfo {
  valid: boolean;
  kind?: 'trip' | 'platform' | 'referral' | string;
  trip_name?: string;
  inviter_name?: string;
  role?: string;
}

export default function Join() {
  const { t } = useT();
  const { code } = useParams();
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/join/${code}`)
      .then(async r => {
        if (r.status === 404) return setInfo({ valid: false });
        setInfo(await r.json());
      })
      .catch(() => setInfo({ valid: false }));
  }, [code]);

  useEffect(() => {
    if (!info?.valid) return;
    fetch('/api/me')
      .then(r => setLoggedIn(r.status === 200))
      .catch(() => setLoggedIn(false));
  }, [info]);

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/join/${code}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        setErr(body?.error === 'email_taken' ? 'email_taken' : body?.error === 'weak_password' ? 'weak_password' : 'error');
        setBusy(false);
        return;
      }
      location.href = body.trip_id ? `/trips/${body.trip_id}` : '/';
    } catch {
      setErr('error');
      setBusy(false);
    }
  };

  const accept = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/join/${code}/accept`, { method: 'POST' });
      const body: any = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        setErr('error');
        setBusy(false);
        return;
      }
      if (body.already) {
        setDone(true);
        setBusy(false);
        return;
      }
      location.href = body.trip_id ? `/trips/${body.trip_id}` : '/';
    } catch {
      setErr('error');
      setBusy(false);
    }
  };

  if (info === null) {
    return <div className="login-wrap"><div className="login-card muted">{t.loading}</div></div>;
  }

  if (!info.valid) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="logo">🧭 {t.appName}</div>
          <p className="callout warn">{t.joinInvalid}</p>
          <a className="btn" style={{ width: '100%', textAlign: 'center', display: 'block', marginTop: 6 }} href="/login">
            {t.signIn}
          </a>
        </div>
      </div>
    );
  }

  const title = info.kind === 'trip' && info.trip_name ? t.joinTripTitle(info.trip_name) : t.joinTitle;

  if (loggedIn === null) {
    return <div className="login-wrap"><div className="login-card muted">{t.loading}</div></div>;
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="logo">🧭 {t.appName}</div>
        <h2 style={{ margin: '10px 0 4px' }}>{title}</h2>
        {info.inviter_name && (
          <p className="muted" style={{ marginBottom: 18 }}>{t.joinInvitedBy(info.inviter_name)}</p>
        )}

        {done ? (
          <p className="callout" style={{ marginTop: 6 }}>{t.joinDone}</p>
        ) : loggedIn ? (
          <button className="btn" style={{ width: '100%', marginTop: 6 }} disabled={busy} onClick={accept}>
            {t.joinAccept}
          </button>
        ) : (
          <form onSubmit={register}>
            <label className="field">
              <span>{t.joinName}</span>
              <input value={name} onChange={e => setName(e.target.value)} required />
            </label>
            <label className="field">
              <span>{t.joinEmail}</span>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required />
            </label>
            <label className="field">
              <span>{t.joinPassword}</span>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                autoComplete="new-password" minLength={8} required />
            </label>
            {err === 'email_taken' && (
              <p className="callout warn">
                {t.emailTaken} <a href="/login">{t.signIn}</a>
              </p>
            )}
            {err === 'weak_password' && <p className="callout warn">⚠️</p>}
            {err === 'error' && <p className="callout warn">⚠️</p>}
            <button className="btn" style={{ width: '100%', marginTop: 6 }} disabled={busy}>
              {t.joinRegister}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
