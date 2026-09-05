// v0.17 admin panel — platform-admin only. Four cards, all wired to existing
// endpoints: AI provider (moved from Settings, Task 6), Accounts (moved from
// People, Task 5), Platform invites and the Referrals switch (Task 2).
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api';
import { useT } from '../i18n';
import { useSession } from '../App';
import { useToast } from '../components/Toast';

// See Settings.tsx history (pre-Task-6) for why the model names stay editable:
// providers retire free-tier model names without notice.
const PRESETS = [
  { name: 'Gemini (free)', base_url: 'https://generativelanguage.googleapis.com', model: 'gemini-2.5-flash' },
  { name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.0-flash-exp:free' },
  { name: 'Groq', base_url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
];

type Invite = {
  id: number; code: string; url: string; kind: 'platform' | 'referral'; role: string | null;
  expires_at: string | null; max_uses: number | null; used_count: number; revoked: boolean;
  created_by_name?: string;
};

export default function Admin() {
  const { t } = useT();
  const { user } = useSession();
  const { toast } = useToast();

  // ---- AI provider (moved from Settings, Task 6) ----
  const [form, setForm] = useState({ base_url: '', model: '', api_key: '' });
  const [keyHint, setKeyHint] = useState('');
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadAi = async () => {
    const s = await api.get('/settings/ai');
    setKeyHint(s.key_hint);
    setForm(f => (f.base_url || f.model || f.api_key ? f : { base_url: s.base_url, model: s.model, api_key: '' }));
  };

  const saveAi = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.put('/settings/ai', { base_url: form.base_url, model: form.model, api_key: form.api_key || undefined });
    toast(t.tSaved);
    setTestMsg(null);
    setForm(f => ({ ...f, api_key: '' }));
    await loadAi();
  };

  const testAi = async () => {
    setBusy(true);
    setTestMsg(null);
    try {
      const r = await api.post('/settings/ai/test', {});
      setTestMsg({ ok: true, text: t.connectionOk(r.reply?.trim() || 'OK') });
    } catch (e: any) {
      const code = e?.code ?? e?.body?.error ?? '';
      const base = code === 'ai_rate_limited' ? t.aiResting : code === 'ai_not_configured' ? t.aiNotConfigured : code === 'ai_unreachable' ? t.aiUnreachable : t.aiError;
      const detail = e?.body?.detail;
      setTestMsg({ ok: false, text: detail ? `${base}\n${detail}` : base });
    } finally { setBusy(false); }
  };

  // ---- Accounts (moved from People, Task 5) ----
  const [all, setAll] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [uform, setUform] = useState({ name: '', email: '', password: '', role: 'member', participant_id: 0 });
  const [showTemp, setShowTemp] = useState<string | null>(null);

  const loadAccounts = async () => {
    setAll(await api.get('/participants'));
    setUsers(await api.get('/users'));
  };

  const genPassword = () => Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const password = uform.password || genPassword();
    await api.post('/users', { ...uform, password, participant_id: uform.participant_id || null });
    setShowTemp(password);
    setUform({ name: '', email: '', password: '', role: 'member', participant_id: 0 });
    toast(t.tAccountCreated);
    await loadAccounts();
  };

  const resetPw = async (u: any) => {
    const pw = genPassword();
    await api.patch(`/users/${u.id}`, { resetPassword: pw });
    setShowTemp(pw);
    toast(t.tPasswordReset);
  };

  const toggleDisabled = async (u: any) => {
    await api.patch(`/users/${u.id}`, { disabled: !u.disabled });
    await loadAccounts();
  };

  // ---- Platform invites ----
  const [invites, setInvites] = useState<Invite[]>([]);
  const [justCreated, setJustCreated] = useState<number | null>(null);

  const loadInvites = async () => setInvites(await api.get('/invites/platform'));

  const copyInvite = async (url: string) => {
    await navigator.clipboard.writeText(location.origin + url);
    toast(t.inviteCopied);
  };

  const createInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api.post('/invites/platform', {});
    await loadInvites();
    setJustCreated(r.id);
    await copyInvite(r.url);
  };

  const revokeInvite = async (id: number) => {
    await api.del(`/invites/${id}`);
    await loadInvites();
  };

  // ---- Referrals switch ----
  const [referralsOn, setReferralsOn] = useState(true);
  const loadReferralsSetting = async () => setReferralsOn((await api.get('/settings/referrals')).enabled);
  const toggleReferrals = () => {
    const next = !referralsOn;
    setReferralsOn(next);
    api.put('/settings/referrals', { enabled: next })
      .then(() => toast(t.tSaved))
      .catch(() => { setReferralsOn(!next); toast(t.tSaveFailed, 'error'); });
  };

  useEffect(() => {
    if (user.role !== 'admin') return;
    loadAi(); loadAccounts(); loadInvites(); loadReferralsSetting();
  }, []);

  if (user.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <div>
      <h1 style={{ margin: '20px 0 14px' }}>🛂 {t.adminTitle}</h1>
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <h3>🤖 {t.aiProvider}</h3>
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="tiny" style={{ fontWeight: 700 }}>{t.aiPresets}:</span>
            {PRESETS.map(p => (
              <span key={p.name} className={`chip ${form.base_url === p.base_url ? 'on' : ''}`}
                onClick={() => setForm(f => ({ ...f, base_url: p.base_url, model: p.model }))}>{p.name}</span>
            ))}
          </div>
          <p className="tiny">{t.aiKeyHint}</p>
          <form onSubmit={saveAi}>
            <div className="form-grid">
              <label className="field full"><span>{t.baseUrl}</span>
                <input value={form.base_url} onChange={e => setForm({ ...form, base_url: e.target.value })}
                  placeholder="https://…/v1" required /></label>
              <label className="field"><span>{t.modelName}</span>
                <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} required /></label>
              <label className="field"><span>{t.apiKey} {keyHint && <em className="tiny">({keyHint} — {t.keepKey})</em>}</span>
                <input type="password" value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })}
                  placeholder={keyHint ? '••••••••' : 'sk-…'} autoComplete="off" /></label>
            </div>
            <div className="row">
              <button className="btn" type="submit">{t.save}</button>
              <button className="btn btn-ghost" type="button" onClick={testAi} disabled={busy}>
                {busy ? '…' : `🔌 ${t.testConnection}`}
              </button>
            </div>
          </form>
          {testMsg && <p className={`callout ${testMsg.ok ? 'info' : 'warn'}`} style={{ marginTop: 10 }}>{testMsg.text}</p>}
        </div>

        <div className="card">
          <h3>{t.accountsTitle}</h3>
          {showTemp && (
            <p className="callout info">
              {t.tempPassword}: <strong style={{ fontFamily: 'monospace' }}>{showTemp}</strong>
              <button className="icon" onClick={() => setShowTemp(null)}>✕</button>
            </p>
          )}
          {users.map(u => (
            <div className="row-between" key={u.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
              <div>
                <div><strong>{u.name}</strong> <span className="badge">{u.role === 'admin' ? t.admin : t.member}</span>
                  {u.disabled ? <span className="badge warn">{t.disabled}</span> : null}</div>
                <div className="tiny">{u.email}{u.participant_id ? ` · ${all.find(p => p.id === u.participant_id)?.name ?? ''}` : ''}</div>
              </div>
              <div className="row">
                <button className="btn btn-ghost btn-sm" onClick={() => resetPw(u)}>{t.resetPassword}</button>
                <button className="btn btn-ghost btn-sm" onClick={() => toggleDisabled(u)}>
                  {u.disabled ? t.enable : t.disable}
                </button>
              </div>
            </div>
          ))}
          <form onSubmit={addUser} style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: '.9rem' }}>{t.addUser}</h3>
            <div className="form-grid">
              <label className="field"><span>{t.name}</span>
                <input required value={uform.name} onChange={e => setUform({ ...uform, name: e.target.value })} /></label>
              <label className="field"><span>{t.email}</span>
                <input type="email" required value={uform.email} onChange={e => setUform({ ...uform, email: e.target.value })} /></label>
              <label className="field"><span>{t.role}</span>
                <select value={uform.role} onChange={e => setUform({ ...uform, role: e.target.value })}>
                  <option value="member">{t.member}</option>
                  <option value="admin">{t.admin}</option>
                </select></label>
              <label className="field"><span>{t.linkedParticipant}</span>
                <select value={uform.participant_id} onChange={e => setUform({ ...uform, participant_id: Number(e.target.value) })}>
                  <option value={0}>{t.none}</option>
                  {all.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></label>
            </div>
            <button className="btn btn-sm">{t.addUser}</button>
            <span className="tiny" style={{ marginLeft: 8 }}>({t.tempPassword} ✨)</span>
          </form>
        </div>

        <div className="card">
          <h3>{t.platformInvites}</h3>
          {invites.filter(i => !i.revoked).map(i => (
            <div className={`row-between invite-row${i.id === justCreated ? ' invite-row-new' : ''}`} key={i.id}
              style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
              <div>
                <div className="row" style={{ gap: 6 }}>
                  <span className="badge">{i.kind === 'platform' ? 'Platform' : 'Referral'}</span>
                  {i.created_by_name && <span className="tiny">{i.created_by_name}</span>}
                  <span className="tiny">{t.inviteUses(i.used_count, i.max_uses ?? 0)}</span>
                  {i.expires_at && <span className="tiny">{t.inviteExpires(new Date(i.expires_at).toLocaleDateString())}</span>}
                </div>
              </div>
              <div className="row">
                <button className="btn btn-ghost btn-sm" onClick={() => copyInvite(i.url)}>📋</button>
                <button className="btn btn-ghost btn-sm" onClick={() => revokeInvite(i.id)}>{t.inviteRevoke} ✕</button>
              </div>
            </div>
          ))}
          <form className="row" onSubmit={createInvite} style={{ marginTop: 14 }}>
            <button className="btn btn-sm">{t.inviteCreate}</button>
          </form>
        </div>

        <div className="card">
          <h3>🎁 {t.referralTitle}</h3>
          <label className="row" style={{ gap: 8, padding: '4px 0' }}>
            <input type="checkbox" checked={referralsOn} onChange={toggleReferrals}
              style={{ width: 17, height: 17, accentColor: 'var(--brand)' }} />
            <span>{t.referralsEnabled}</span>
          </label>
        </div>
      </div>
    </div>
  );
}
