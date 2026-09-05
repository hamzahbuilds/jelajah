// v0.13 personal Settings: MCP help + access tokens + referral link, for every user.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { useToast } from '../components/Toast';
import TokenCard from '../components/TokenCard';

export default function Settings() {
  const { t } = useT();
  const { toast } = useToast();
  const [referral, setReferral] = useState<{ code: string; url: string; used_count: number; max_uses: number; enabled: boolean } | null>(null);

  useEffect(() => { api.get('/invites/referral').then(setReferral).catch(() => setReferral(null)); }, []);

  const copyReferral = async () => {
    if (!referral) return;
    await navigator.clipboard.writeText(location.origin + referral.url);
    toast(t.inviteCopied);
  };

  return (
    <div>
      <h1 style={{ margin: '20px 0 14px' }}>⚙️ {t.settings}</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>🎁 {t.referralTitle}</h3>
        {referral && !referral.enabled && <p className="tiny">{t.referralDisabled}</p>}
        {referral && referral.enabled && (
          <>
            <p className="tiny">{t.referralHint}</p>
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <pre className="mcp-url" style={{ flex: 1 }}>{location.origin + referral.url}</pre>
              <button className="btn btn-ghost btn-sm" onClick={copyReferral}>📋</button>
            </div>
            <span className="tiny">{t.inviteUses(referral.used_count, referral.max_uses)}</span>
          </>
        )}
      </div>

      <div className="card">
        <h3>🔌 {t.mcpTitle}</h3>
        <p className="tiny">{t.mcpHelp}</p>
        <pre className="mcp-url">{`${window.location.origin}/api/mcp`}</pre>
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
        <TokenCard />
      </div>
    </div>
  );
}
