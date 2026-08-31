// v0.12 personal access tokens — create (shown once) and revoke.
import { useEffect, useState } from 'react';
import { api, fmtDate } from '../api';
import { useT } from '../i18n';
import { useToast } from './Toast';

export default function TokenCard() {
  const { t, lang } = useT();
  const { toast } = useToast();
  const [tokens, setTokens] = useState<any[]>([]);
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);

  const load = async () => setTokens(await api.get('/tokens'));
  useEffect(() => { load(); }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api.post('/tokens', { name });
    setFresh(r.token);
    setName('');
    toast(t.tokenCreated);
    await load();
  };

  const revoke = async (id: number) => {
    await api.del(`/tokens/${id}`);
    toast(t.tokenRevoked);
    await load();
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div className="row-between">
        <strong style={{ fontSize: '.9rem' }}>🔑 {t.accessTokens}</strong>
      </div>
      {fresh && (
        <div className="callout info" style={{ margin: '8px 0' }}>
          <div className="tiny">{t.tokenOnce}</div>
          <code className="token-fresh" onClick={() => navigator.clipboard?.writeText(fresh).catch(() => {})}>{fresh}</code>
        </div>
      )}
      {tokens.map(tk => (
        <div className="row-between" key={tk.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontSize: '.85rem' }}>
            {tk.name} {tk.revoked ? <span className="badge warn">{t.revokedLbl}</span> : null}
            <span className="tiny"> · {tk.last_used_at ? `${t.lastUsed} ${fmtDate(tk.last_used_at.slice(0, 10), lang)}` : t.neverUsed}</span>
          </span>
          {!tk.revoked && <button className="btn btn-ghost btn-sm" onClick={() => revoke(tk.id)}>{t.revoke}</button>}
        </div>
      ))}
      <form className="row" onSubmit={create} style={{ marginTop: 8 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={t.tokenName} required style={{ maxWidth: 220 }} />
        <button className="btn btn-sm" type="submit">＋ {t.newToken}</button>
      </form>
    </div>
  );
}
