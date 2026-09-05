// v0.19 personal Settings: MCP help + access tokens + referral link, for every
// user. Restyled to card/cardhead/seg/.mono per the P4 Task 4 admin+settings
// plan (design/ui-refresh/08-settings.html is the visual reference).
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useT, Lang } from '../i18n';
import { useToast } from '../components/Toast';
import { Icon } from '../components/Icon';
import PageHead from '../components/PageHead';
import TokenCard from '../components/TokenCard';
import { getThemePref, setThemePref, ThemePref } from '../theme';

export default function Settings() {
  const { t, lang, setLang } = useT();
  const { toast } = useToast();
  const [referral, setReferral] = useState<{ code: string; url: string; used_count: number; max_uses: number; enabled: boolean } | null>(null);
  const [pref, setPref] = useState<ThemePref>(getThemePref());
  const pick = (p: ThemePref) => { setThemePref(p); setPref(p); api.patch('/me', { theme: p }).catch(() => {}); };
  const changeLang = async (l: Lang) => { setLang(l); await api.patch('/me', { lang: l }); };

  useEffect(() => { api.get('/invites/referral').then(setReferral).catch(() => setReferral(null)); }, []);

  const copyReferral = async () => {
    if (!referral) return;
    await navigator.clipboard.writeText(location.origin + referral.url);
    toast(t.inviteCopied);
  };

  return (
    <div>
      <PageHead crumb={t.settingsCrumb} title={t.settings} sub={t.settingsSub} />

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="cardhead"><h3><Icon name="gift" /> {t.referralTitle}</h3>
          {referral && referral.enabled && (
            <span className="badge brand"><span className="d" />{t.inviteUses(referral.used_count, referral.max_uses)}</span>
          )}
        </div>
        {referral && !referral.enabled && <p className="hint">{t.referralDisabled}</p>}
        {referral && referral.enabled && (
          <>
            <p className="hint">{t.referralHint}</p>
            <div className="row" style={{ flexWrap: 'nowrap', gap: 10, alignItems: 'center' }}>
              <div className="mono" style={{ flex: 1, minWidth: 220 }}>{location.origin + referral.url}</div>
              <button className="btn secondary sm" onClick={copyReferral}><Icon name="copy" size={16} /> {t.copyLbl}</button>
            </div>
          </>
        )}
      </div>

      <TokenCard />

      <div className="card" style={{ marginBottom: 16, marginTop: 16 }}>
        <div className="cardhead"><h3><Icon name="chat" /> {t.mcpTitle}</h3></div>
        <p className="hint">{t.mcpHelp}</p>
        <div className="mono">{`${window.location.origin}/api/mcp`}</div>
        <details className="tiny" style={{ margin: '8px 0' }}>
          <summary>Claude Code</summary>
          <pre className="mcp-snippet">{`claude mcp add --transport http jelajah ${window.location.origin}/api/mcp \\
  --header "Authorization: Bearer YOUR_TOKEN"`}</pre>
        </details>
        <details className="tiny" style={{ margin: '8px 0' }}>
          <summary>Claude Desktop / claude.ai (custom connector)</summary>
          <p style={{ margin: '4px 0' }}>{t.mcpDesktopHint}</p>
          <pre className="mcp-snippet">{`${window.location.origin}/api/mcp/t/YOUR_TOKEN`}</pre>
        </details>
        <details className="tiny" style={{ margin: '8px 0' }}>
          <summary>Claude Desktop via config file (mcp-remote bridge, needs Node.js)</summary>
          <pre className="mcp-snippet">{`{
  "mcpServers": {
    "jelajah": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${window.location.origin}/api/mcp",
               "--transport", "http-only",
               "--header", "Authorization: Bearer YOUR_TOKEN"]
    }
  }
}`}</pre>
        </details>
        <details className="tiny" style={{ margin: '8px 0' }}>
          <summary>Codex (config.toml)</summary>
          <pre className="mcp-snippet">{`[mcp_servers.jelajah]
url = "${window.location.origin}/api/mcp"
http_headers = { "Authorization" = "Bearer YOUR_TOKEN" }`}</pre>
        </details>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="cardhead"><h3><Icon name="moon" /> {t.appearance}</h3></div>
        <div className="seg" role="group">
          {([['', t.themeLight], ['dark', t.themeDark], ['system', t.themeSystem]] as const).map(([v, label]) => (
            <button key={v} className={pref === v ? 'on' : ''} onClick={() => pick(v)}>{label}</button>
          ))}
        </div>
        <p className="hint" style={{ marginTop: 10 }}>{t.themeHint}</p>
      </div>

      <div className="card">
        <div className="cardhead"><h3><Icon name="globe" /> {t.languageTitle}</h3></div>
        <div className="seg" role="group">
          <button className={lang === 'en' ? 'on' : ''} onClick={() => changeLang('en')}>English</button>
          <button className={lang === 'ms' ? 'on' : ''} onClick={() => changeLang('ms')}>Bahasa Malaysia</button>
        </div>
      </div>
    </div>
  );
}
