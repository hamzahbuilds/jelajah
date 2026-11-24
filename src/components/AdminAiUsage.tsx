// v0.48 Admin → AI usage: what every AI feature costs, per day, feature and
// model, plus the backup provider (Workers AI) and the price list behind the
// estimates. Costs are estimates from token counts × the prices below.
import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { useT } from '../i18n';
import { useToast } from './Toast';
import { Icon } from './Icon';
import type { AiPrices } from '../../shared/aiPrices';

interface Agg { calls: number; failed: number; fallbacks: number; in: number; out: number; think: number; cost: number; unpriced: number; ms: number }
interface Usage {
  days: number; total: Agg; series: Array<{ day: string } & Agg>;
  features: Array<{ feature: string } & Agg>;
  models: Array<{ model: string; provider: string; price: { in: number; out: number } | null } & Agg>;
  failures: Array<{ at: string; feature: string; provider: string; model: string; error: string | null }>;
  prices: AiPrices;
}

const FEATURE_NAMES: Record<string, [string, string]> = {
  today_brief: ['Today brief', 'Ringkasan hari ini'],
  assistant_chat: ['AI chat', 'Sembang AI'],
  suggest: ['Activity suggestions', 'Cadangan aktiviti'],
  plan_ai: ['Plan with AI', 'Rancang dengan AI'],
  plan_import: ['Import from link / screenshots', 'Import daripada pautan / tangkapan skrin'],
  admin_test: ['Admin tests', 'Ujian pentadbir'],
};

const usd = (v: number) => (v === 0 ? '$0' : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);
const tok = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(v));

export default function AdminAiUsage() {
  const { lang } = useT();
  const ms = lang === 'ms';
  const { toast } = useToast();
  const [days, setDays] = useState(30);
  const [u, setU] = useState<Usage | null>(null);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [fb, setFb] = useState<{ enabled: boolean; model: string; bound: boolean } | null>(null);
  const [fbModel, setFbModel] = useState('');
  const [fbMsg, setFbMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [prices, setPrices] = useState<Array<{ model: string; in: string; out: string }>>([]);

  const load = () => api.get(`/admin/ai-usage?days=${days}`).then((r: Usage) => {
    setU(r); setFailed(false);
    setPrices(Object.entries(r.prices).map(([model, p]) => ({ model, in: String(p.in), out: String(p.out) })));
  }).catch(() => setFailed(true));
  useEffect(() => { void load(); }, [days]);
  useEffect(() => { api.get('/settings/ai-fallback').then(r => { setFb(r); setFbModel(r.model); }).catch(() => setFb(null)); }, []);

  const name = (f: string) => FEATURE_NAMES[f]?.[ms ? 1 : 0] ?? f;

  const saveFb = async (enabled: boolean, model = fbModel) => {
    setBusy(true); setFbMsg(null);
    try { const r = await api.put('/settings/ai-fallback', { enabled, model }); setFb(r); setFbModel(r.model); toast(ms ? 'Disimpan' : 'Saved'); }
    catch (e) { toast(e instanceof ApiError && e.code === 'invalid_model' ? (ms ? 'ID model tidak sah (contoh: @cf/…)' : 'Invalid model ID (e.g. @cf/…)') : (ms ? 'Gagal menyimpan' : 'Could not save'), 'error'); }
    finally { setBusy(false); }
  };
  const testFb = async () => {
    setBusy(true); setFbMsg(null);
    try { const r = await api.post('/settings/ai-fallback/test', {}); setFbMsg({ ok: true, text: `${ms ? 'Berjaya' : 'Works'}: "${r.reply?.trim()}" (${r.model})` }); }
    catch (e: any) { setFbMsg({ ok: false, text: e?.body?.detail || (ms ? 'Ujian gagal' : 'Test failed') }); }
    finally { setBusy(false); void load(); }
  };
  const savePrices = async () => {
    const out: AiPrices = {};
    for (const p of prices) {
      if (!p.model.trim()) continue;
      const a = Number(p.in), b = Number(p.out);
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) { toast(ms ? 'Harga mesti nombor positif' : 'Prices must be positive numbers', 'error'); return; }
      out[p.model.trim()] = { in: a, out: b };
    }
    try { await api.put('/settings/ai-prices', { prices: out }); toast(ms ? 'Harga disimpan' : 'Prices saved'); void load(); }
    catch { toast(ms ? 'Gagal menyimpan' : 'Could not save', 'error'); }
  };

  // Daily cost bars: one series, baseline-anchored, 2px gaps, rounded top ends.
  const W = 600, H = 120, top = 8;
  const series = u?.series ?? [];
  const max = Math.max(...series.map(s => s.cost), 0);
  const slot = series.length ? W / series.length : W;
  const barW = Math.max(1, slot - 2);
  const h = (v: number) => (max > 0 ? Math.max(v > 0 ? 2 : 0, (v / max) * (H - top)) : 0);
  const hv = hover != null ? series[hover] : null;

  return (
    <section className="card ai-usage" aria-labelledby="ai-usage-h" style={{ marginBottom: 20 }}>
      <div className="cardhead">
        <h2 id="ai-usage-h"><Icon name="sparkles" /> {ms ? 'Penggunaan AI' : 'AI usage'}</h2>
        <div className="seg" role="group" aria-label={ms ? 'Tempoh' : 'Range'}>
          {[7, 30, 90].map(d => <button key={d} type="button" className={days === d ? 'on' : ''} aria-pressed={days === d} onClick={() => setDays(d)}>{d}{ms ? ' hari' : 'd'}</button>)}
        </div>
      </div>
      {failed && <p className="callout warn" role="alert">{ms ? 'Penggunaan AI tidak dapat dimuatkan.' : 'Could not load AI usage.'}</p>}
      {u && <>
        <div className="ai-usage-tiles">
          <div><span>{ms ? 'Anggaran kos' : 'Estimated cost'}</span><b>{usd(u.total.cost)}</b><small>{u.days} {ms ? 'hari' : 'days'}</small></div>
          <div><span>{ms ? 'Panggilan' : 'Calls'}</span><b>{u.total.calls}</b><small>{u.total.failed} {ms ? 'gagal' : 'failed'}</small></div>
          <div><span>{ms ? 'Token' : 'Tokens'}</span><b>{tok(u.total.in + u.total.out + u.total.think)}</b><small>{tok(u.total.in)} {ms ? 'masuk' : 'in'} · {tok(u.total.out)} {ms ? 'keluar' : 'out'} · {tok(u.total.think)} {ms ? 'fikir' : 'thinking'}</small></div>
          <div><span>{ms ? 'Guna sandaran' : 'Backup used'}</span><b>{u.total.fallbacks}</b><small>Workers AI</small></div>
        </div>

        <h3 className="ai-usage-sub">{ms ? 'Anggaran kos sehari (USD)' : 'Estimated cost per day (USD)'}</h3>
        <div className="ai-usage-chart" onPointerLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={ms ? `Kos sehari, tertinggi ${usd(max)}` : `Cost per day, highest ${usd(max)}`}>
            <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--border)" strokeWidth="1" />
            {series.map((s, i) => {
              const bh = h(s.cost), x = i * slot + 1, y = H - bh, r = Math.min(4, barW / 2, bh);
              return <g key={s.day}>
                {bh > 0 && <path d={`M${x} ${H}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + barW - r}Q${x + barW} ${y} ${x + barW} ${y + r}V${H}Z`}
                  fill="var(--brand-600)" opacity={hover == null || hover === i ? 1 : 0.45} />}
                {/* hit target: the whole column, taller and wider than the bar */}
                <rect x={i * slot} y={0} width={slot} height={H} fill="transparent" onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)} />
              </g>;
            })}
          </svg>
          {hv && <div className="ai-usage-tip" style={{ left: `${Math.min(80, Math.max(10, ((hover! + 0.5) / series.length) * 100))}%` }}>
            <b>{hv.day}</b><span>{usd(hv.cost)} · {hv.calls} {ms ? 'panggilan' : 'calls'}</span>
          </div>}
          <div className="ai-usage-axis"><span>{series[0]?.day}</span><span>{ms ? 'tertinggi' : 'max'} {usd(max)}</span><span>{series.at(-1)?.day}</span></div>
        </div>

        <div className="ai-usage-tables">
          <div className="table-scroll">
            <table className="ai-usage-table">
              <caption>{ms ? 'Mengikut ciri' : 'By feature'}</caption>
              <thead><tr><th>{ms ? 'Ciri' : 'Feature'}</th><th>{ms ? 'Panggilan' : 'Calls'}</th><th>{ms ? 'Token' : 'Tokens'}</th><th>{ms ? 'Purata masa' : 'Avg time'}</th><th>{ms ? 'Kos' : 'Cost'}</th></tr></thead>
              <tbody>{u.features.length ? u.features.map(f => <tr key={f.feature}><td>{name(f.feature)}</td><td>{f.calls}{f.failed ? <small> ({f.failed} {ms ? 'gagal' : 'failed'})</small> : null}</td><td>{tok(f.in + f.out + f.think)}{f.think ? <small> ({tok(f.think)} {ms ? 'fikir' : 'thinking'})</small> : null}</td><td>{f.calls ? `${(f.ms / f.calls / 1000).toFixed(1)}s` : '—'}</td><td>{usd(f.cost)}</td></tr>)
                : <tr><td colSpan={5} className="muted">{ms ? 'Tiada panggilan AI lagi.' : 'No AI calls yet.'}</td></tr>}</tbody>
            </table>
          </div>
          <div className="table-scroll">
            <table className="ai-usage-table">
              <caption>{ms ? 'Mengikut model' : 'By model'}</caption>
              <thead><tr><th>Model</th><th>{ms ? 'Panggilan' : 'Calls'}</th><th>{ms ? 'Purata masa' : 'Avg time'}</th><th>{ms ? 'Kos' : 'Cost'}</th></tr></thead>
              <tbody>{u.models.length ? u.models.map(m => <tr key={m.model}><td><code>{m.model}</code><small> {m.provider}</small></td><td>{m.calls}</td><td>{m.calls ? `${(m.ms / m.calls / 1000).toFixed(1)}s` : '—'}</td><td>{m.price ? usd(m.cost) : <small>{ms ? 'tiada harga' : 'no price set'}</small>}</td></tr>)
                : <tr><td colSpan={4} className="muted">—</td></tr>}</tbody>
            </table>
          </div>
        </div>
        {u.total.unpriced > 0 && <p className="hint">{ms ? `${u.total.unpriced} panggilan tiada harga model. Tambah harga di bawah.` : `${u.total.unpriced} calls use a model with no price. Add it below.`}</p>}

        <details className="ai-usage-more">
          <summary>{ms ? 'Kegagalan terkini' : 'Recent failures'} ({u.failures.length})</summary>
          {u.failures.length ? <ul>{u.failures.map((f, i) => <li key={i}><small>{f.at}</small> {name(f.feature)} · <code>{f.model}</code> · {f.error}</li>)}</ul> : <p className="hint">—</p>}
        </details>
      </>}

      <div className="ai-usage-fallback">
        <h3 className="ai-usage-sub"><Icon name="refresh" size={16} /> {ms ? 'Sandaran: Cloudflare Workers AI' : 'Backup: Cloudflare Workers AI'}</h3>
        <p className="hint">{ms
          ? 'Gemini dahulu. Jika Gemini gagal, dihadkan atau belum disediakan, permintaan teks dihantar ke Workers AI. Video dan tangkapan skrin tidak boleh guna sandaran. Percuma sehingga 10,000 neuron sehari.'
          : 'Gemini goes first. If it fails, is rate-limited or is not set up, text requests go to Workers AI. Video and screenshot imports cannot use the backup. Free up to 10,000 neurons a day.'}</p>
        {fb && !fb.bound && <p className="callout warn">{ms ? 'Deployment ini tiada binding Workers AI (wrangler.toml [ai]).' : 'This deployment has no Workers AI binding (wrangler.toml [ai]).'}</p>}
        {fb && <>
          <label className="check-row">
            <input type="checkbox" role="switch" {...{ switch: '' }} checked={fb.enabled} disabled={busy} onChange={e => void saveFb(e.target.checked)} />
            <span>{ms ? 'Guna Workers AI sebagai sandaran' : 'Use Workers AI as backup'}</span>
          </label>
          <form className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }} onSubmit={e => { e.preventDefault(); void saveFb(fb.enabled); }}>
            <label className="fld" style={{ flex: '1 1 260px' }}><span>{ms ? 'Model sandaran' : 'Backup model'}</span>
              <input value={fbModel} onChange={e => setFbModel(e.target.value)} list="wai-models" spellCheck={false} />
              <datalist id="wai-models">
                <option value="@cf/meta/llama-3.3-70b-instruct-fp8-fast" />
                <option value="@cf/zai-org/glm-4.7-flash" />
                <option value="@cf/google/gemma-3-12b-it" />
                <option value="@cf/aisingapore/gemma-sea-lion-v4-27b-it" />
                <option value="@cf/openai/gpt-oss-20b" />
              </datalist>
            </label>
            <button className="btn sm" disabled={busy || fbModel === fb.model}>{ms ? 'Simpan' : 'Save'}</button>
            <button type="button" className="btn secondary sm" disabled={busy || !fb.bound} onClick={() => void testFb()}>{ms ? 'Uji sandaran' : 'Test backup'}</button>
          </form>
          {fbMsg && <p className={fbMsg.ok ? 'hint' : 'callout warn'} role="status">{fbMsg.text}</p>}
        </>}
      </div>

      <details className="ai-usage-more">
        <summary>{ms ? 'Harga model (USD setiap 1 juta token)' : 'Model prices (USD per 1 million tokens)'}</summary>
        <p className="hint">{ms
          ? 'Token pemikiran dikira pada kadar keluaran. Jika anda di peringkat percuma Gemini, letak 0 untuk kos sebenar.'
          : 'Thinking tokens count at the output rate. On Gemini’s free tier, set its price to 0 to see your real cost.'}</p>
        <div className="table-scroll">
          <table className="ai-usage-table ai-price-table">
            <thead><tr><th>Model</th><th>{ms ? 'Masuk' : 'Input'}</th><th>{ms ? 'Keluar' : 'Output'}</th><th><span className="sr-only">{ms ? 'Buang' : 'Remove'}</span></th></tr></thead>
            <tbody>
              {prices.map((p, i) => <tr key={i}>
                <td><input aria-label="Model" value={p.model} spellCheck={false} onChange={e => setPrices(prices.map((x, j) => j === i ? { ...x, model: e.target.value } : x))} /></td>
                <td><input aria-label={`${p.model} input`} inputMode="decimal" value={p.in} onChange={e => setPrices(prices.map((x, j) => j === i ? { ...x, in: e.target.value } : x))} /></td>
                <td><input aria-label={`${p.model} output`} inputMode="decimal" value={p.out} onChange={e => setPrices(prices.map((x, j) => j === i ? { ...x, out: e.target.value } : x))} /></td>
                <td><button type="button" className="btn ghost sm" aria-label={`${ms ? 'Buang' : 'Remove'} ${p.model}`} onClick={() => setPrices(prices.filter((_, j) => j !== i))}><Icon name="x" size={16} /></button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 8 }}>
          <button type="button" className="btn ghost sm" onClick={() => setPrices([...prices, { model: '', in: '0', out: '0' }])}><Icon name="plus" size={16} /> {ms ? 'Tambah model' : 'Add model'}</button>
          <button type="button" className="btn sm" onClick={() => void savePrices()}>{ms ? 'Simpan harga' : 'Save prices'}</button>
        </div>
      </details>
    </section>
  );
}
