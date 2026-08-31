// v0.12 admin Settings: AI provider (OpenAI-compatible, free presets) + MCP help.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { useSession } from '../App';
import { useToast } from '../components/Toast';
import TokenCard from '../components/TokenCard';

const PRESETS = [
  { name: 'Gemini (free)', base_url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash' },
  { name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.0-flash-exp:free' },
  { name: 'Groq', base_url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
];

export default function Settings() {
  const { t } = useT();
  const { user } = useSession();
  const { toast } = useToast();
  const [form, setForm] = useState({ base_url: '', model: '', api_key: '' });
  const [keyHint, setKeyHint] = useState('');
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const s = await api.get('/settings/ai');
    setKeyHint(s.key_hint);
    // never clobber values the admin has already typed (slow-network race)
    setForm(f => (f.base_url || f.model || f.api_key ? f : { base_url: s.base_url, model: s.model, api_key: '' }));
  };
  useEffect(() => { load(); }, []);

  if (user.role !== 'admin') return <div className="card muted" style={{ marginTop: 20 }}>—</div>;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.put('/settings/ai', { base_url: form.base_url, model: form.model, api_key: form.api_key || undefined });
    toast(t.tSaved);
    setTestMsg(null);
    setForm(f => ({ ...f, api_key: '' }));
    const s = await api.get('/settings/ai');
    setKeyHint(s.key_hint);
  };

  const test = async () => {
    setBusy(true);
    setTestMsg(null);
    try {
      const r = await api.post('/settings/ai/test', {});
      setTestMsg({ ok: true, text: t.connectionOk(r.reply?.trim() || 'OK') });
    } catch (e: any) {
      const code = e?.body?.error ?? '';
      setTestMsg({ ok: false, text: code === 'ai_rate_limited' ? t.aiResting : code === 'ai_not_configured' ? t.aiNotConfigured : code === 'ai_unreachable' ? t.aiUnreachable : t.aiError });
    } finally { setBusy(false); }
  };

  return (
    <div>
      <h1 style={{ margin: '20px 0 14px' }}>⚙️ {t.settings}</h1>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3>🤖 {t.aiProvider}</h3>
        <div className="row" style={{ marginBottom: 10 }}>
          <span className="tiny" style={{ fontWeight: 700 }}>{t.aiPresets}:</span>
          {PRESETS.map(p => (
            <span key={p.name} className={`chip ${form.base_url === p.base_url ? 'on' : ''}`}
              onClick={() => setForm(f => ({ ...f, base_url: p.base_url, model: p.model }))}>{p.name}</span>
          ))}
        </div>
        <p className="tiny">{t.aiKeyHint}</p>
        <form onSubmit={save}>
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
            <button className="btn btn-ghost" type="button" onClick={test} disabled={busy}>
              {busy ? '…' : `🔌 ${t.testConnection}`}
            </button>
          </div>
        </form>
        {testMsg && <p className={`callout ${testMsg.ok ? 'info' : 'warn'}`} style={{ marginTop: 10 }}>{testMsg.text}</p>}
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
          <summary>Claude Desktop (mcpServers JSON)</summary>
          <pre className="mcp-snippet">{`{
  "mcpServers": {
    "jelajah": {
      "type": "http",
      "url": "${window.location.origin}/api/mcp",
      "headers": { "Authorization": "Bearer YOUR_TOKEN" }
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
