// v0.49 Admin → Platform settings → Release notes. Draft with AI from the
// commits since the last published note (or write one by hand), edit both
// languages with a live preview, then publish. Publishing shows it once to
// everyone as "What's new".
import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import { useT } from '../../i18n';
import { useConfirm } from '../../ui/Confirm';
import { useToast } from '../Toast';
import { Icon } from '../Icon';
import ThinkingSteps from '../ThinkingSteps';
import { ReleaseBody, releaseDate, openWhatsNew, type Release } from './releaseText';

type Draft = Pick<Release, 'version' | 'title_en' | 'title_ms' | 'body_en' | 'body_ms'>;
const blank = (): Draft => ({ version: new Date().toISOString().slice(0, 10), title_en: '', title_ms: '', body_en: '## New\n- ', body_ms: '## Baharu\n- ' });

export default function AdminReleases() {
  const { t, lang } = useT();
  const ms = lang === 'ms';
  const L = (en: string, m: string) => (ms ? m : en);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [list, setList] = useState<Release[] | null>(null);
  const [editing, setEditing] = useState<{ id: number | null; draft: Draft } | null>(null);
  const [tab, setTab] = useState<'en' | 'ms'>('en');
  const [busy, setBusy] = useState(false);
  const [drafting, setDrafting] = useState(false);

  const load = () => api.get('/admin/releases').then(r => setList(r.releases)).catch(() => setList([]));
  useEffect(() => { void load(); }, []);

  const draftWithAi = async () => {
    setDrafting(true);
    try {
      const r = await api.post('/admin/releases/draft', {});
      await load();
      setEditing({ id: r.release.id, draft: r.release });
      setTab('en');
      toast(L(`Drafted from ${r.commits} change${r.commits === 1 ? '' : 's'}. Review it before publishing.`, `Draf daripada ${r.commits} perubahan. Semak sebelum diterbitkan.`));
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      toast(code === 'no_changes' ? L('No new changes since the last published note.', 'Tiada perubahan baharu sejak nota terakhir.')
        : code === 'ai_not_configured' ? L('Set up an AI provider first.', 'Tetapkan penyedia AI dahulu.')
        : `${L('Could not draft', 'Tidak dapat membuat draf')}${(e as any)?.body?.detail ? `: ${(e as any).body.detail}` : ''}`, 'error');
    } finally { setDrafting(false); }
  };

  const save = async (): Promise<number | null> => {
    if (!editing) return null;
    setBusy(true);
    try {
      const r = editing.id ? await api.put(`/admin/releases/${editing.id}`, editing.draft) : await api.post('/admin/releases', editing.draft);
      await load(); setEditing({ id: r.id, draft: r }); toast(t.tSaved);
      return r.id;
    } catch { toast(L('Fill in the version, English title and English notes.', 'Isi versi, tajuk dan nota Bahasa Inggeris.'), 'error'); return null; }
    finally { setBusy(false); }
  };

  const publish = async (r: Release | { id: number }) => {
    const ok = await confirm({ title: L('Publish this release note?', 'Terbitkan nota keluaran ini?'), body: L('Everyone sees it once as "What\'s new" the next time they open Jelajah.', 'Semua orang akan melihatnya sekali sebagai "Apa yang baharu" apabila membuka Jelajah.'), confirmLabel: L('Publish', 'Terbitkan') });
    if (!ok) return;
    setBusy(true);
    try { await api.post(`/admin/releases/${r.id}/publish`, {}); await load(); setEditing(null); toast(L('Published', 'Diterbitkan')); }
    catch { toast(t.tSaveFailed, 'error'); } finally { setBusy(false); }
  };

  const remove = async (r: Release) => {
    const ok = await confirm({ title: L('Delete this release note?', 'Padam nota keluaran ini?'), body: r.status === 'published' ? L('It disappears from everyone\'s version history.', 'Ia akan hilang daripada sejarah versi semua orang.') : L('The draft is deleted.', 'Draf akan dipadam.'), confirmLabel: t.delete, tone: 'danger' });
    if (!ok) return;
    try { await api.del(`/admin/releases/${r.id}`); await load(); if (editing?.id === r.id) setEditing(null); toast(L('Deleted', 'Dipadam')); }
    catch { toast(t.tSaveFailed, 'error'); }
  };

  const d = editing?.draft;
  const set = (patch: Partial<Draft>) => editing && setEditing({ ...editing, draft: { ...editing.draft, ...patch } });

  return (
    <section className="card admin-releases" aria-labelledby="rel-h" style={{ marginTop: 16 }}>
      <div className="cardhead">
        <h2 id="rel-h"><Icon name="sparkles" /> {L('Release notes', 'Nota keluaran')}</h2>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn ghost sm" onClick={openWhatsNew}>{L("Open What's new", 'Buka Apa yang baharu')}</button>
          <button type="button" className="btn secondary sm" disabled={drafting || busy} onClick={() => { setEditing({ id: null, draft: blank() }); setTab('en'); }}><Icon name="plus" size={16} /> {L('Write one', 'Tulis sendiri')}</button>
          <button type="button" className="btn sm" disabled={drafting || busy} onClick={() => void draftWithAi()}><Icon name="sparkles" size={16} /> {L('Draft with AI', 'Draf dengan AI')}</button>
        </div>
      </div>
      <p className="hint">{L('AI reads the changes since the last published note and writes them for normal users, in English and Malay. Nothing is shown to anyone until you publish.', 'AI membaca perubahan sejak nota terakhir dan menulisnya untuk pengguna biasa, dalam Bahasa Inggeris dan Melayu. Tiada apa ditunjukkan sehingga anda terbitkan.')}</p>

      {drafting && <ThinkingSteps steps={ms
        ? ['Membaca perubahan terkini', 'Mengasingkan perkara untuk pengguna', 'Menulis dalam bahasa mudah', 'Menterjemah ke Bahasa Melayu']
        : ['Reading the latest changes', 'Picking what users will notice', 'Writing it in plain words', 'Translating to Malay']} label={L('Drafting release notes', 'Membuat draf nota keluaran')} />}

      {editing && d && <div className="rel-editor">
        <div className="rel-fields">
          <label className="fld"><span>{L('Version', 'Versi')}</span><input value={d.version} maxLength={40} onChange={e => set({ version: e.target.value })} /></label>
          <div className="seg" role="group" aria-label={L('Language', 'Bahasa')}>
            <button type="button" className={tab === 'en' ? 'on' : ''} aria-pressed={tab === 'en'} onClick={() => setTab('en')}>English</button>
            <button type="button" className={tab === 'ms' ? 'on' : ''} aria-pressed={tab === 'ms'} onClick={() => setTab('ms')}>Bahasa Melayu</button>
          </div>
          <label className="fld"><span>{L('Title', 'Tajuk')}</span>
            <input value={tab === 'en' ? d.title_en : d.title_ms} maxLength={140} onChange={e => set(tab === 'en' ? { title_en: e.target.value } : { title_ms: e.target.value })} /></label>
          <label className="fld"><span>{L('Notes', 'Nota')} <small className="muted">{L('"## " for a heading, "- " for a bullet', '"## " untuk tajuk, "- " untuk poin')}</small></span>
            <textarea rows={10} value={tab === 'en' ? d.body_en : d.body_ms} onChange={e => set(tab === 'en' ? { body_en: e.target.value } : { body_ms: e.target.value })} /></label>
        </div>
        <div className="rel-preview" aria-label={L('Preview', 'Pratonton')}>
          <small className="muted">{L('Preview', 'Pratonton')}</small>
          <h3>{(tab === 'en' ? d.title_en : d.title_ms) || (tab === 'en' ? '…' : d.title_en || '…')}</h3>
          <ReleaseBody text={(tab === 'en' ? d.body_en : d.body_ms) || d.body_en} />
          {tab === 'ms' && !d.body_ms && <p className="hint">{L('No Malay text yet: Malay readers will see the English.', 'Tiada teks Melayu: pembaca Melayu akan melihat Bahasa Inggeris.')}</p>}
        </div>
        <div className="row rel-actions">
          <button type="button" className="btn ghost" disabled={busy} onClick={() => setEditing(null)}>{t.close}</button>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => void save()}>{L('Save draft', 'Simpan draf')}</button>
          <button type="button" className="btn" disabled={busy} onClick={async () => { const id = await save(); if (id) await publish({ id }); }}>{L('Save & publish', 'Simpan & terbitkan')}</button>
        </div>
      </div>}

      {list === null ? null : !list.length ? <p className="muted">{L('No release notes yet.', 'Belum ada nota keluaran.')}</p> : (
        <ul className="rel-list">
          {list.map(r => (
            <li key={r.id}>
              <div>
                <b>{r.title_en}</b>
                <small>{r.version} · {r.status === 'published' ? `${L('Published', 'Diterbitkan')} ${releaseDate(r.published_at, ms)}` : L('Draft', 'Draf')}{r.ai_drafted ? ` · ${L('AI draft', 'Draf AI')}` : ''}</small>
              </div>
              <span className={`badge ${r.status === 'published' ? 'brand' : 'gray'}`}>{r.status === 'published' ? L('Live', 'Aktif') : L('Draft', 'Draf')}</span>
              <div className="row" style={{ gap: 4 }}>
                <button type="button" className="btn ghost sm" onClick={() => { setEditing({ id: r.id, draft: r }); setTab('en'); }}>{L('Edit', 'Sunting')}</button>
                {r.status === 'draft' && <button type="button" className="btn sm" disabled={busy} onClick={() => void publish(r)}>{L('Publish', 'Terbitkan')}</button>}
                <button type="button" className="btn ghost sm" aria-label={`${t.delete} ${r.title_en}`} onClick={() => void remove(r)}><Icon name="trash" size={16} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
