import AdminFeatureFlags from '../components/AdminFeatureFlags';
import AdminAiUsage from '../components/AdminAiUsage';
import AdminDashboard from '../components/admin/AdminDashboard';
import AdminTrips from '../components/admin/AdminTrips';
import AdminFeatureUsage from '../components/admin/AdminFeatureUsage';
// v0.19 admin panel — platform-admin only. Restyled to card/stat/PageHead
// (P4 Task 4) with hand-written SVG "lieflat-style" charts (style adopted from
// lieflat-charts, PolyForm Noncommercial — zero code copied, see
// src/components/charts/). All charts map only to fields the server actually
// returns from GET /admin/stats and GET /admin/referrals (server/app.ts) —
// no fabricated data. Every card that already existed (AI provider, Accounts,
// Platform invites, Referrals switch) keeps its function intact.
import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api } from '../api';
import { useT, Dict } from '../i18n';
import { useSession } from '../app/session';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import '../components/google.css';
import { useGoogleSignIn } from '../components/GoogleButton';
import PageHead from '../components/PageHead';

type Referral = { user_id: number; name: string; referred: number; first_at: string };

// Static reference values — NOT live-metered. GET /admin/stats has no Cloudflare
// usage endpoint behind it (would need Cloudflare's own dashboard/API, out of
// scope for a server/-untouched task), so this card stays informational copy
// rather than fabricating numbers. See task-4-report.md for the ledger entry.
const freeTierLimits = (t: Dict) => [
  t.mQuotaWorkers,
  t.mQuotaD1Read,
  t.mQuotaD1Write,
  t.mQuotaKvRead,
  t.mQuotaKvWrite,
];

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

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

export type AdminSection = 'dashboard' | 'trips' | 'usage' | 'people' | 'settings';

export default function Admin({ section = 'dashboard' }: { section?: AdminSection }) {
  const { t, lang } = useT();
  const { user } = useSession();
  const { toast } = useToast();

  // ---- AI provider (moved from Settings, Task 6) ----
  const [form, setForm] = useState({ base_url: '', model: '', api_key: '', light_model: '' });
  const [keyHint, setKeyHint] = useState('');
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadAi = async () => {
    const s = await api.get('/settings/ai');
    setKeyHint(s.key_hint);
    setForm(f => (f.base_url || f.model || f.api_key ? f : { base_url: s.base_url, model: s.model, api_key: '', light_model: s.light_model ?? '' }));
  };

  const saveAi = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.put('/settings/ai', { base_url: form.base_url, model: form.model, api_key: form.api_key || undefined, light_model: form.light_model });
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
      const base = code === 'ai_rate_limited' ? t.aiResting : code === 'ai_not_configured' ? t.aiNotConfiguredAdmin : code === 'ai_unreachable' ? t.aiUnreachable : t.aiError;
      const detail = e?.body?.detail;
      setTestMsg({ ok: false, text: detail ? `${base}\n${detail}` : base });
    } finally { setBusy(false); }
  };

  // ---- Accounts (moved from People, Task 5) ----
  const [all, setAll] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [uform, setUform] = useState({ name: '', email: '', password: '', role: 'member', participant_id: 0 });
  const [access, setAccess] = useState<{ name: string; url: string } | null>(null);
  // v0.34: with Google on, people sign in with Google using the account's email;
  // password sign-in links are off.
  const googleOnly = useGoogleSignIn() === true;

  const loadAccounts = async () => {
    setAll(await api.get('/participants'));
    setUsers(await api.get('/users'));
  };

  // v0.33: no email service — new accounts and forgotten passwords get a one-time
  // sign-in link the admin sends by hand (WhatsApp, Telegram…).
  const makeLink = async (id: number, name: string) => {
    const r = await api.post(`/users/${id}/access-link`, {});
    setAccess({ name, url: location.origin + r.url });
  };

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const created = await api.post('/users', { ...uform, password: uform.password || undefined, participant_id: uform.participant_id || null });
    const name = uform.name;
    setUform({ name: '', email: '', password: '', role: 'member', participant_id: 0 });
    toast(t.tAccountCreated);
    if (!googleOnly) await makeLink(Number(created.id), name);
    await loadAccounts();
  };

  const copyAccess = async () => {
    if (!access) return;
    await navigator.clipboard.writeText(access.url);
    toast(t.linkCopiedTo);
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

  // ---- Dashboard (Task 5, charts restyled Task 4 of the UI-refresh plan) ----
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const loadReferrals = async () => setReferrals(await api.get('/admin/referrals'));

  useEffect(() => {
    if (user.role !== 'admin') return;
    // Each section loads only what it shows.
    if (section === 'settings') loadAi();
    if (section === 'people') { loadAccounts(); loadInvites(); loadReferralsSetting(); loadReferrals(); }
  }, [section]);

  if (user.role !== 'admin') return <Navigate to="/" replace />;

  const ms = lang === 'ms';
  const heads: Record<AdminSection, [string, string, string, string]> = {
    dashboard: ['Dashboard', 'Papan pemuka', '', ''],
    trips: ['All trips', 'Semua perjalanan', 'Every trip on Jelajah, with who leads it and how far planning has got.', 'Setiap perjalanan di Jelajah, siapa ketuanya dan sejauh mana perancangan.'],
    usage: ['Usage', 'Penggunaan', 'What people use, and what the AI features cost.', 'Apa yang digunakan, dan kos ciri AI.'],
    people: ['People', 'Orang', 'Accounts, platform invites and referrals.', 'Akaun, jemputan platform dan rujukan.'],
    settings: ['Platform settings', 'Tetapan platform', 'AI provider, experimental features and limits.', 'Penyedia AI, ciri percubaan dan had.'],
  };
  const h = heads[section];

  return (
    <div className="admin-page">
      {/* Phones and tablets have no sidebar: the admin sections as tabs. */}
      <nav className="adm-tabs" aria-label={ms ? 'Bahagian pentadbir' : 'Admin sections'}>
        {(Object.keys(heads) as AdminSection[]).map(k => (
          <Link key={k} to={k === 'dashboard' ? '/admin' : `/admin/${k}`} className={section === k ? 'on' : ''} aria-current={section === k ? 'page' : undefined}>{ms ? heads[k][1] : heads[k][0]}</Link>
        ))}
      </nav>
      {section !== 'dashboard' && <PageHead crumb={ms ? 'Pentadbir' : 'Admin'} title={ms ? h[1] : h[0]} sub={ms ? h[3] : h[2]} />}
      {section === 'dashboard' && <AdminDashboard />}
      {section === 'trips' && <AdminTrips />}
      {section === 'usage' && <><AdminFeatureUsage /><AdminAiUsage /></>}

      {section === 'people' && <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="cardhead"><h2>{t.accountsTitle}</h2></div>
          {access && (
            <div className="callout info access-link" role="status">
              <b>{t.signInLinkTitle(access.name)}</b>
              <input readOnly value={access.url} aria-label={t.signInLink} onFocus={e => e.currentTarget.select()} />
              <small>{t.signInLinkHint}</small>
              <div className="row">
                <button className="btn sm" type="button" onClick={copyAccess}><Icon name="copy" size={16} /> {t.copyLbl}</button>
                <a className="btn ghost sm" target="_blank" rel="noopener noreferrer"
                  href={`https://wa.me/?text=${encodeURIComponent(t.signInLinkMsg(access.name, access.url))}`}>{t.shareWhatsApp}</a>
                <button className="btn ghost sm" type="button" onClick={() => setAccess(null)} aria-label={t.close}><Icon name="x" size={16} /></button>
              </div>
            </div>
          )}
          {users.map(u => (
            <div className="lrow" key={u.id}>
              <div className="l-main">
                <b>{u.name} <span className="badge gray">{u.role === 'admin' ? t.admin : t.member}</span>
                  {u.disabled ? <span className="badge warning">{t.disabled}</span> : null}</b>
                <small>{u.email}{u.participant_id ? ` · ${all.find(p => p.id === u.participant_id)?.name ?? ''}` : ''}</small>
              </div>
              <div className="l-end">
                {!u.disabled && !googleOnly && <button className="btn ghost sm" onClick={() => makeLink(u.id, u.name)}><Icon name="link" size={16} /> {t.signInLink}</button>}
                <button className="btn ghost sm" onClick={() => toggleDisabled(u)}>
                  {u.disabled ? t.enable : t.disable}
                </button>
              </div>
            </div>
          ))}
          <form onSubmit={addUser} style={{ marginTop: 14 }}>
            <h2 style={{ fontSize: 'var(--fs-md)' }}>{t.addUser}</h2>
            <div className="form-grid">
              <label className="fld"><span>{t.name}</span>
                <input required value={uform.name} onChange={e => setUform({ ...uform, name: e.target.value })} /></label>
              <label className="fld"><span>{t.email}</span>
                <input type="email" required value={uform.email} onChange={e => setUform({ ...uform, email: e.target.value })} /></label>
              <label className="fld"><span>{t.role}</span>
                <select value={uform.role} onChange={e => setUform({ ...uform, role: e.target.value })}>
                  <option value="member">{t.member}</option>
                  <option value="admin">{t.admin}</option>
                </select></label>
              <label className="fld"><span>{t.linkedParticipant}</span>
                <select value={uform.participant_id} onChange={e => setUform({ ...uform, participant_id: Number(e.target.value) })}>
                  <option value={0}>{t.none}</option>
                  {all.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select></label>
            </div>
            <button className="btn sm">{t.addUser}</button>
            <span className="tiny" style={{ marginLeft: 8 }}><Icon name="link" size={16} /> {googleOnly ? t.addUserGoogleHint : t.addUserNoPwHint}</span>
          </form>
        </div>

        <div className="card">
          <div className="cardhead"><h2><Icon name="link" /> {t.platformInvites}</h2></div>
          {invites.filter(i => !i.revoked).map(i => (
            <div className={`lrow invite-row${i.id === justCreated ? ' invite-row-new' : ''}`} key={i.id}>
              <span className="tile sm"><Icon name="link" /></span>
              <div className="l-main">
                <b><span className="badge gray">{i.kind === 'platform' ? 'Platform' : 'Referral'}</span> {i.created_by_name}</b>
                <small>{t.inviteUses(i.used_count, i.max_uses ?? 0)}
                  {i.expires_at && ` · ${t.inviteExpires(new Date(i.expires_at).toLocaleDateString())}`}</small>
              </div>
              <div className="l-end">
                <button className="btn ghost sm" onClick={() => copyInvite(i.url)} aria-label={t.copyLbl}><Icon name="copy" size={16} /></button>
                <button className="btn ghost sm" onClick={() => revokeInvite(i.id)}>{t.inviteRevoke}</button>
              </div>
            </div>
          ))}
          <form className="row" onSubmit={createInvite} style={{ marginTop: 14 }}>
            <button className="btn sm">{t.inviteCreate}</button>
          </form>
        </div>

        <div className="card">
          <div className="cardhead"><h2><Icon name="gift" /> {t.mReferrals}</h2></div>
          {referrals.length === 0 ? (
            <p className="muted">{t.mNoReferrals}</p>
          ) : (
            <table className="table">
              <thead>
                <tr><th>{t.mReferredBy}</th><th className="num">{t.mReferredCount}</th><th>{t.mSince}</th></tr>
              </thead>
              <tbody>
                {referrals.map(r => (
                  <tr key={r.user_id}>
                    <td><div className="row" style={{ gap: 10, alignItems: 'center' }}><span className="avatar">{initials(r.name)}</span><b>{r.name}</b></div></td>
                    <td className="num">{r.referred}</td>
                    <td>{new Date(r.first_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <div className="cardhead"><h2><Icon name="gift" /> {t.referralTitle}</h2></div>
          <label className="row" style={{ gap: 8, padding: '4px 0' }}>
            <input type="checkbox" checked={referralsOn} onChange={toggleReferrals}
              style={{ width: 17, height: 17, accentColor: 'var(--brand-700)' }} />
            <span>{t.referralsEnabled}</span>
          </label>
        </div>
      </div>}

      {section === 'settings' && <>
        <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="cardhead"><h2><Icon name="chat" /> {t.aiProvider}</h2></div>
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
              <label className="fld full"><span>{t.baseUrl}</span>
                <input value={form.base_url} onChange={e => setForm({ ...form, base_url: e.target.value })}
                  placeholder="https://…/v1" required /></label>
              <label className="fld"><span>{t.modelName}</span>
                <input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} required /></label>
              <label className="fld"><span>{t.apiKey} {keyHint && <em className="tiny">({keyHint}, {t.keepKey})</em>}</span>
                <input type="password" value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })}
                  placeholder={keyHint ? '••••••••' : 'sk-…'} autoComplete="off" /></label>
              <label className="fld full"><span>{t.lightModel}</span>
                <input value={form.light_model} onChange={e => setForm({ ...form, light_model: e.target.value })}
                  placeholder="gemini-3.5-flash-lite" spellCheck={false} />
                <small className="hint">{t.lightModelHint}</small></label>
            </div>
            <div className="row">
              <button className="btn" type="submit">{t.save}</button>
              <button className="btn ghost" type="button" onClick={testAi} disabled={busy}>
                <Icon name="link" size={16} /> {busy ? '…' : t.testConnection}
              </button>
            </div>
          </form>
          {testMsg && <p className={`callout ${testMsg.ok ? 'info' : 'warn'}`} style={{ marginTop: 10 }}>{testMsg.text}</p>}
        </div>

        </div>
        <div style={{ marginTop: 16 }}><AdminFeatureFlags /></div>
            <div className="card lf">
              <div className="cardhead"><h2>{t.mQuotaTitle}</h2><span className="badge gray"><span className="d" />{t.mBadgeAllTime}</span></div>
              <div className="lfsub">{t.mQuotaSub}</div>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 'var(--fs-sm)', color: 'var(--ink-2)', lineHeight: 1.7 }}>
                {freeTierLimits(t).map(l => <li key={l}>{l}</li>)}
              </ul>
              <div className="lfsrc">{t.sourcePrefix} · {t.mSourceQuota}. {t.mQuotaNote}</div>
            </div>

      </>}
    </div>
  );
}
