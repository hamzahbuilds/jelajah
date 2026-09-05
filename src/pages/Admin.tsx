// v0.19 admin panel — platform-admin only. Restyled to card/stat/PageHead
// (P4 Task 4) with hand-written SVG "lieflat-style" charts (style adopted from
// lieflat-charts, PolyForm Noncommercial — zero code copied, see
// src/components/charts/). All charts map only to fields the server actually
// returns from GET /admin/stats and GET /admin/referrals (server/app.ts) —
// no fabricated data. Every card that already existed (AI provider, Accounts,
// Platform invites, Referrals switch) keeps its function intact.
import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { api } from '../api';
import { useT, Dict } from '../i18n';
import { useSession } from '../App';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import PageHead from '../components/PageHead';
import LfLine from '../components/charts/LfLine';
import LfBars from '../components/charts/LfBars';
import { cumulative } from '../components/charts/chartData';
import { trendPct } from '../../shared/metrics';

// Humanized labels for usage_daily.feature raw keys (see server trackUsage() call sites).
// Unknown/future feature keys fall back to the raw key itself.
const FEATURE_LABELS: Record<string, keyof Dict> = {
  login: 'fLogin', doc_upload: 'fDocUpload', expense_add: 'fExpenseAdd',
  payment_add: 'fPaymentAdd', plan_view: 'fPlanView', myspend_add: 'fMyspendAdd',
  fx_view: 'fFxView', join_register: 'fJoinRegister', ai_suggest: 'fAiSuggest',
  ai_chat: 'fAiChat', mcp_call: 'fMcpCall',
};

type Stats = {
  signups: Array<{ day: string; n: number }>;
  active7: number; active7Prev: number; active30: number;
  trips: number; mcp30: number;
  features: Array<{ feature: string; n: number }>;
  audit: Array<{ action: string; user: string | null; at: string }>;
};
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

  // ---- Dashboard (Task 5, charts restyled Task 4 of the UI-refresh plan) ----
  const [stats, setStats] = useState<Stats | null>(null);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const loadStats = async () => setStats(await api.get('/admin/stats'));
  const loadReferrals = async () => setReferrals(await api.get('/admin/referrals'));

  useEffect(() => {
    if (user.role !== 'admin') return;
    loadAi(); loadAccounts(); loadInvites(); loadReferralsSetting();
    loadStats(); loadReferrals();
  }, []);

  if (user.role !== 'admin') return <Navigate to="/" replace />;

  return (
    <div>
      <PageHead crumb="Platform" title={t.adminTitle} sub={t.adminSub} />

      {stats && (() => {
        const signups30 = stats.signups.reduce((a, d) => a + d.n, 0);
        const trend = trendPct(stats.active7, stats.active7Prev);
        const firstDay = stats.signups[0]?.day;
        const lastDay = stats.signups[stats.signups.length - 1]?.day;
        const cumSignups = cumulative(stats.signups.map(d => d.n));
        const barsRows = stats.features.map(f => ({
          key: f.feature, label: (t as any)[FEATURE_LABELS[f.feature]] ?? f.feature, value: f.n,
        }));
        return (
          <>
            <div className="stats">
              <div className="card stat">
                <span className="k"><span className="tile sm"><Icon name="user" /></span>{t.mSignups30}</span>
                <span className="v">{signups30}</span>
              </div>
              <div className="card stat">
                <span className="k"><span className="tile sm"><Icon name="spark" /></span>{t.mActive7}</span>
                <span className="v">
                  {stats.active7}{' '}
                  {trend == null
                    ? <span>—</span>
                    : <span className={trend >= 0 ? 'trend-up' : 'trend-down'}>{trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}%</span>}
                </span>
                <span className="t">{t.mVsPrev7}</span>
              </div>
              <div className="card stat">
                <span className="k"><span className="tile sm"><Icon name="bag" /></span>{t.mTrips}</span>
                <span className="v">{stats.trips}</span>
              </div>
              <div className="card stat">
                <span className="k"><span className="tile sm"><Icon name="key" /></span>{t.mMcp30}</span>
                <span className="v">{stats.mcp30}</span>
              </div>
            </div>

            <div className="grid grid-2" style={{ alignItems: 'start' }}>
              <LfLine
                title={t.mLineTitle} sub={t.mLineSub} badge={t.mBadge30d}
                series={cumSignups} unitLabel={t.mAccountsUnit}
                firstLabel={firstDay ? new Date(firstDay + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : ''}
                lastLabel={lastDay ? new Date(lastDay + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }) : ''}
                source={`${t.sourcePrefix} · ${t.mSourceSignups}`}
              />
              <LfBars
                title={t.mBarsTitle} sub={t.mBarsSub} badge={t.mBadge30d}
                rows={barsRows}
                source={`${t.sourcePrefix} · ${t.mSourceUsage}`}
              />
            </div>

            {/* Signup-source waffle and weekday×daypart punch card are intentionally
                NOT shipped: /admin/referrals has no invite-kind breakdown for every
                signup (only counts per referrer), and usage_daily is a daily UTC
                bucket with no hour column — charting either would mean fabricating
                data. See task-4-report.md. */}

            <div className="card lf">
              <div className="cardhead"><h3>{t.mQuotaTitle}</h3><span className="badge gray"><span className="d" />{t.mBadgeAllTime}</span></div>
              <div className="lfsub">{t.mQuotaSub}</div>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.7 }}>
                {freeTierLimits(t).map(l => <li key={l}>{l}</li>)}
              </ul>
              <div className="lfsrc">{t.sourcePrefix} · {t.mSourceQuota} — {t.mQuotaNote}</div>
            </div>

            <div className="grid grid-2" style={{ alignItems: 'start' }}>
              <div className="card">
                <div className="cardhead"><h3><Icon name="gift" /> {t.mReferrals}</h3></div>
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
                <div className="cardhead"><h3>{t.mFeed}</h3></div>
                {stats.audit.length === 0 && <p className="muted">—</p>}
                {stats.audit.map((a, i) => (
                  <div className="lrow" key={i}>
                    <span className="tile sm"><Icon name="spark" /></span>
                    <div className="l-main"><b>{a.user ?? '—'}</b><small>{a.action}</small></div>
                    <div className="l-end"><span className="tiny muted">{new Date(a.at).toLocaleString()}</span></div>
                  </div>
                ))}
              </div>
            </div>
          </>
        );
      })()}

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <div className="card">
          <div className="cardhead"><h3><Icon name="chat" /> {t.aiProvider}</h3></div>
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
              <label className="fld"><span>{t.apiKey} {keyHint && <em className="tiny">({keyHint} — {t.keepKey})</em>}</span>
                <input type="password" value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })}
                  placeholder={keyHint ? '••••••••' : 'sk-…'} autoComplete="off" /></label>
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

        <div className="card">
          <div className="cardhead"><h3>{t.accountsTitle}</h3></div>
          {showTemp && (
            <p className="callout info">
              {t.tempPassword}: <strong style={{ fontFamily: 'monospace' }}>{showTemp}</strong>
              <button className="btn ghost sm" onClick={() => setShowTemp(null)} aria-label={t.close}>✕</button>
            </p>
          )}
          {users.map(u => (
            <div className="lrow" key={u.id}>
              <div className="l-main">
                <b>{u.name} <span className="badge gray">{u.role === 'admin' ? t.admin : t.member}</span>
                  {u.disabled ? <span className="badge warning">{t.disabled}</span> : null}</b>
                <small>{u.email}{u.participant_id ? ` · ${all.find(p => p.id === u.participant_id)?.name ?? ''}` : ''}</small>
              </div>
              <div className="l-end">
                <button className="btn ghost sm" onClick={() => resetPw(u)}>{t.resetPassword}</button>
                <button className="btn ghost sm" onClick={() => toggleDisabled(u)}>
                  {u.disabled ? t.enable : t.disable}
                </button>
              </div>
            </div>
          ))}
          <form onSubmit={addUser} style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: '.9rem' }}>{t.addUser}</h3>
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
            <span className="tiny" style={{ marginLeft: 8 }}>({t.tempPassword} ✨)</span>
          </form>
        </div>

        <div className="card">
          <div className="cardhead"><h3><Icon name="link" /> {t.platformInvites}</h3></div>
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
          <div className="cardhead"><h3><Icon name="gift" /> {t.referralTitle}</h3></div>
          <label className="row" style={{ gap: 8, padding: '4px 0' }}>
            <input type="checkbox" checked={referralsOn} onChange={toggleReferrals}
              style={{ width: 17, height: 17, accentColor: 'var(--brand-700)' }} />
            <span>{t.referralsEnabled}</span>
          </label>
        </div>
      </div>
    </div>
  );
}
