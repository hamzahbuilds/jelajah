// v0.12 trip Q&A drawer — EN / BM / Sarawak Malay, per-user server-side context.
// Conversations live in memory only; nothing is stored in the database.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';

type ChatLang = 'en' | 'ms' | 'ms-swk';
interface Msg { role: 'user' | 'assistant'; content: string }

export default function ChatDrawer({ tripId }: { tripId: number }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [lang, setLang] = useState<ChatLang>(() => {
    try { return (localStorage.getItem('chat_lang') as ChatLang) || 'en'; } catch { return 'en'; }
  });
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMessages([]); }, [tripId]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const pickLang = (l: ChatLang) => {
    setLang(l);
    try { localStorage.setItem('chat_lang', l); } catch { /* ignore */ }
  };

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setErr('');
    setBusy(true);
    try {
      const r = await api.post(`/trips/${tripId}/assistant/chat`, { messages: next, lang });
      setMessages([...next, { role: 'assistant', content: r.reply }]);
    } catch (ex: any) {
      const code = ex?.code ?? ex?.body?.error ?? '';
      setErr(code === 'ai_rate_limited' ? t.aiResting : code === 'ai_not_configured' ? t.aiNotConfigured : code === 'ai_unreachable' ? t.aiUnreachable : t.aiError);
    } finally { setBusy(false); }
  };

  return (
    <>
      <button className="chat-fab" onClick={() => setOpen(!open)} aria-label={t.chatTitle}>
        {open ? '✕' : '💬'}
      </button>
      {open && (
        <div className="chat-drawer">
          <div className="row-between" style={{ marginBottom: 6 }}>
            <strong>💬 {t.chatTitle}</strong>
            <span className="row" style={{ gap: 4 }}>
              {([['en', t.langEnglish], ['ms', t.langBm], ['ms-swk', t.langSwk]] as const).map(([l, lbl]) => (
                <span key={l} className={`chip ${lang === l ? 'on' : ''}`} onClick={() => pickLang(l)}>{lbl}</span>
              ))}
            </span>
          </div>
          {lang === 'ms-swk' && <div className="tiny" style={{ marginBottom: 4 }}>{t.swkNote}</div>}
          <div className="chat-log">
            {messages.length === 0 && <p className="muted tiny" style={{ padding: 8 }}>{t.chatPlaceholder}</p>}
            {messages.map((m, i) => (
              <div key={i} className={`chat-msg ${m.role}`}>{m.content}</div>
            ))}
            {busy && <div className="chat-msg assistant tiny">…</div>}
            {err && <div className="callout warn tiny">{err}</div>}
            <div ref={endRef} />
          </div>
          <form className="row" onSubmit={send} style={{ marginTop: 6, flexWrap: 'nowrap' }}>
            <input value={input} onChange={e => setInput(e.target.value)} placeholder={t.chatPlaceholder}
              style={{ flex: 1 }} disabled={busy} />
            <button className="btn btn-sm" type="submit" disabled={busy || !input.trim()}>{t.send}</button>
          </form>
        </div>
      )}
    </>
  );
}
