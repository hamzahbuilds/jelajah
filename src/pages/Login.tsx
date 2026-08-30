import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useT } from '../i18n';

export default function Login() {
  const { t } = useT();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'loading' | 'login' | 'setup'>('loading');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [seed, setSeed] = useState(true);
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/setup/status')
      .then(r => setMode(r.needed ? 'setup' : 'login'))
      .catch(() => setMode('login'));
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(false);
    try {
      if (mode === 'setup') {
        await api.post('/setup', { name, email, password, seedJapanTrip: seed });
      } else {
        await api.post('/auth/login', { email, password });
      }
      navigate('/');
    } catch {
      setErr(true);
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'loading') return <div className="login-wrap"><div className="login-card muted">…</div></div>;

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="logo">🧭 {t.appName}</div>
        {mode === 'setup' ? (
          <>
            <h2 style={{ margin: '10px 0 4px' }}>{t.setupTitle}</h2>
            <p className="tiny" style={{ marginBottom: 14 }}>{t.setupHint}</p>
            <label className="field">
              <span>{t.name}</span>
              <input value={name} onChange={e => setName(e.target.value)} required />
            </label>
          </>
        ) : (
          <p className="muted" style={{ marginBottom: 18 }}>{t.tagline}</p>
        )}
        <label className="field">
          <span>{t.email}</span>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label className="field">
          <span>{mode === 'setup' ? t.newPassword : t.password}</span>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            autoComplete={mode === 'setup' ? 'new-password' : 'current-password'}
            minLength={mode === 'setup' ? 8 : undefined} required />
        </label>
        {mode === 'setup' && (
          <label className="row" style={{ gap: 8, marginBottom: 12, fontSize: '.85rem' }}>
            <input type="checkbox" checked={seed} onChange={e => setSeed(e.target.checked)}
              style={{ width: 17, height: 17, accentColor: 'var(--brand)' }} />
            <span>{t.seedJapan}</span>
          </label>
        )}
        {err && <p className="callout warn">{mode === 'setup' ? '⚠️' : t.invalidLogin}</p>}
        <button className="btn" style={{ width: '100%', marginTop: 6 }} disabled={busy}>
          {mode === 'setup' ? t.setupGo : t.signIn}
        </button>
      </form>
    </div>
  );
}
