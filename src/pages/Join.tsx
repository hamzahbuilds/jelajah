import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useT } from '../i18n';
import AuthCarousel from '../components/AuthCarousel';
import { Icon } from '../components/Icon';

interface JoinInfo {
  valid: boolean;
  kind?: 'trip' | 'platform' | 'referral' | string;
  trip_name?: string;
  inviter_name?: string;
  role?: string;
}

// SECURITY-FROZEN (Task 5, P4 UI refresh; unfrozen for strings in v0.20 T4):
// this file's logic — the raw fetch calls, the constant-shape invalid/error
// handling, the validate → register → accept flow — is untouched from the
// pre-refresh version. Only markup/classNames/strings have ever changed
// (split/carousel layout, .fld2 fields, .joinbadge invite context card;
// v0.20 T4 converted the last EN-hardcoded strings to t() keys). No fetch/
// validate/register/accept byte changed for v0.20 — do not wire new logic
// in here.
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
      <div className="split">
        <AuthCarousel />
        <div className="pane">
          <div className="authcard login-card">
            <div className="logo"><Icon name="pin" size={20} /> {t.appName}</div>
            <p className="callout warn">{t.joinInvalid}</p>
            <a className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} href="/login">
              {t.signIn}
            </a>
          </div>
        </div>
      </div>
    );
  }

  const title = info.kind === 'trip' && info.trip_name ? t.joinTripTitle(info.trip_name) : t.joinTitle;
  // invite context card: rendered ONLY from fields the /api/join/:code
  // response already returns (trip_name / inviter_name / role) — nothing
  // added to the API for this task.
  const roleLabel = info.role
    ? info.role === 'leader' ? t.roleLeader : info.role === 'editor' ? t.roleEditor : info.role === 'viewer' ? t.roleViewer
      : info.role.charAt(0).toUpperCase() + info.role.slice(1)
    : null;

  if (loggedIn === null) {
    return <div className="login-wrap"><div className="login-card muted">{t.loading}</div></div>;
  }

  return (
    <div className="split">
      <AuthCarousel />
      <div className="pane">
        <div className="authcard login-card">
          <div className="logo"><Icon name="pin" size={20} /> {t.appName}</div>
          <h2>{title}</h2>
          {info.kind === 'trip' && info.trip_name && (
            <div className="joinbadge">
              <Icon name="pin" size={24} />
              <div className="t">
                <b>{info.trip_name}</b>
                <small>
                  {info.inviter_name ? t.joinInvitedBy(info.inviter_name) : t.joinTitle}
                  {roleLabel ? ` · ${roleLabel}` : ''}
                </small>
              </div>
              {roleLabel && <span className="badge brand" style={{ marginLeft: 'auto' }}>{roleLabel}</span>}
            </div>
          )}
          {/* fallback: also covers kind==='trip' with a null trip_name (server can
              return that) — the old page always showed "Invited by X" then */}
          {!(info.kind === 'trip' && info.trip_name) && info.inviter_name && (
            <p className="sub">{t.joinInvitedBy(info.inviter_name)}</p>
          )}

          {done ? (
            <p className="callout" style={{ marginTop: 6 }}>{t.joinDone}</p>
          ) : loggedIn ? (
            <button className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} disabled={busy} onClick={accept}>
              {t.joinAccept}
            </button>
          ) : (
            <form onSubmit={register}>
              <label className="fld2">
                {t.joinName}
                <input value={name} onChange={e => setName(e.target.value)} required />
              </label>
              <label className="fld2">
                {t.joinEmail}
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required />
              </label>
              <label className="fld2">
                {t.joinPassword}
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  autoComplete="new-password" minLength={8} required />
              </label>
              {err === 'email_taken' && (
                <p className="callout warn">
                  {t.emailTaken} <a href="/login">{t.signIn}</a>
                </p>
              )}
              {err === 'weak_password' && <p className="callout warn"><Icon name="alert" size={16} /> {t.weakPasswordMsg}</p>}
              {err === 'error' && <p className="callout warn"><Icon name="alert" size={16} /> {t.genericErrorMsg}</p>}
              <button className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} disabled={busy}>
                {t.joinRegister}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
