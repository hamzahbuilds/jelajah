import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext, Link } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { useT } from '../i18n';
import { TripCtx } from './TripShell';
import { extractPdfText, renderPdfPages } from '../pdf';
import { parseDocument } from '../../shared/parsers';
import { OCR_LANGS, savedLangs, saveLangs, looksScanned, ocrImages, OcrProgress } from '../ocr';
import { useToast } from '../components/Toast';
import PageHead from '../components/PageHead';
import Empty from '../components/Empty';
import Modal from '../components/Modal';
import { Icon, type IconName } from '../components/Icon';


export default function Documents() {
  const { t, lang } = useT();
  const { trip, tripId, canLead, members } = useOutletContext<TripCtx>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [docs, setDocs] = useState<any[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const bm = lang === 'ms';
  const [category, setCategory] = useState('accommodation');
  const [library, setLibrary] = useState<{folders:any[];groups:any[];categories:string[]}>({folders:[],groups:[],categories:[]});
  const [destination, setDestination] = useState('private');
  const [customCategory, setCustomCategory] = useState('');
  const [folderModal, setFolderModal] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderScope, setFolderScope] = useState('private');
  const [groupId, setGroupId] = useState('');
  const [groupModal, setGroupModal] = useState(false);
  const [editGroup, setEditGroup] = useState<any>(null);
  const [groupName, setGroupName] = useState('');
  const [groupPeople, setGroupPeople] = useState<number[]>([]);
  const scopeLabel = (v: string) => v === 'trip' ? (bm ? 'Seluruh perjalanan' : 'Whole trip') : v === 'group' ? (bm ? 'Kumpulan' : 'Group') : (bm ? 'Peribadi' : 'Private');
  const uploadFolder = library.folders.find(f => String(f.id) === destination);
  const uploadScope = uploadFolder?.visibility || destination;
  const useOcr = canLead && uploadScope === 'trip' && category !== 'other';
  const [view, setView] = useState<'folders' | 'list'>('folders');
  const [folder, setFolder] = useState('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<any>(null);
  const [filename, setFilename] = useState('');
  const [deleting, setDeleting] = useState<any>(null);
  const categories = [
    { id: 'accommodation', name: bm ? 'Penginapan' : 'Accommodation', icon: 'hotel' as IconName, hint: bm ? 'Tempahan hotel dan penginapan · OCR' : 'Hotels and stays · OCR import' },
    { id: 'logistics', name: bm ? 'Pengangkutan & logistik' : 'Transport & logistics', icon: 'plane' as IconName, hint: bm ? 'Penerbangan, kereta api dan tiket · OCR' : 'Flights, trains and tickets · OCR import' },
    { id: 'other', name: bm ? 'Lain-lain' : 'Other', icon: 'file' as IconName, hint: bm ? 'Kategori sendiri atau pilih yang sedia ada' : 'Choose or create your own category' },
  ];
  const docMeta = (d: any) => { try { return JSON.parse(d.parsed_json || '{}'); } catch { return {}; } };
  const docCategory = (d: any) => { const c = docMeta(d).libraryCategory; return c === 'personal' ? 'other' : c || (d.doc_type === 'personal' ? 'other' : d.doc_type === 'confirmation' ? 'accommodation' : 'logistics'); };
  const categoryName = (d: any) => categories.find(c => c.id === docCategory(d))?.name || docCategory(d);
  const docFolder = (d: any) => String(docMeta(d).libraryFolderId || (d.doc_type === 'personal' ? 'private' : 'trip'));
  const folderLabel = (d: any) => library.folders.find(f => String(f.id) === docFolder(d))?.name || scopeLabel(docFolder(d));
  const accessLabel = (d: any) => scopeLabel(library.folders.find(f => String(f.id) === docFolder(d))?.visibility || docFolder(d));
  const folderChoices = [{id:'private',name:scopeLabel('private'),visibility:'private'}, {id:'trip',name:scopeLabel('trip'),visibility:'trip'}, ...library.folders];
  const priorCategories = [...new Set<string>([...library.categories,...docs.map(docCategory)])].filter(c => !['accommodation','logistics','other'].includes(c));
  const visible = docs.filter(d => (folder === 'all' || docFolder(d) === folder) && `${d.filename} ${categoryName(d)}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const openGroup = (g?: any) => { setEditGroup(g || null); setGroupName(g?.name || ''); setGroupPeople(g?.participant_ids || []); setGroupModal(true); };
  const modify = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try { await action(); await load(); setEditing(null); setDeleting(null); setFolderModal(false); setGroupModal(false); toast(t.tSaved); }
    catch { toast(t.tSaveFailed, 'error'); }
    finally { setBusy(false); }
  };
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try { const [files, settings] = await Promise.all([api.get(`/trips/${tripId}/documents`),api.get(`/trips/${tripId}/document-library/settings`)]); setDocs(files); setLibrary(settings); setLoadError(false); }
    catch { setDocs([]); setLibrary({folders:[],groups:[],categories:[]}); setLoadError(true); }
  };
  useEffect(() => { setDocs([]); setDestination('private'); setLibrary({folders:[],groups:[],categories:[]}); setFolder('all'); setSearch(''); void load(); }, [tripId]);

  const [ocrQueue, setOcrQueue] = useState<{ files: File[]; single: boolean } | null>(null);
  // v0.12: visible import pipeline — ✈️ progress, counts, per-file errors
  const [prog, setProg] = useState<{ done: number; total: number; current: string; errors: Array<{ name: string; reason: string }> } | null>(null);

  const emptyParse = (warning?: string) => ({
    parser: 'none', docType: 'other', people: [], legs: [], fields: {},
    warnings: warning ? [warning] : [], confidence: 0, suggestExpense: true,
  });

  const uploadOne = async (file: File, parsed: any, goReview: boolean) => {
    const form = new FormData();
    form.append('file', file);
    form.append('category', category === 'other' ? customCategory.trim() || 'other' : category);
    form.append('visibility', uploadScope);
    if (uploadFolder) form.append('folder_id', String(uploadFolder.id));
    form.append('meta', JSON.stringify(parsed));
    const res = await api.upload(`/trips/${tripId}/documents`, form);
    if (goReview) navigate(`/trips/${tripId}/documents/${res.id}/review`, { state: { duplicate: res.duplicate } });
    return res;
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length || busy || ocrQueue) return;
    setBusy(true);
    const all = Array.from(files);
    const errors: Array<{ name: string; reason: string }> = [];
    let done = 0;
    setProg({ done: 0, total: all.length, current: all[0]?.name ?? '', errors: [] });
    const tick = (current: string) => setProg({ done, total: all.length, current, errors: [...errors] });
    try {
      const needOcr: File[] = [];
      for (const file of all) {
        tick(file.name);
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        const isImage = /^image\//.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
        try {
          if (!useOcr) {
            await uploadOne(file, {}, false);
          } else if (isPdf) {
            let text = '';
            try { text = await extractPdfText(file); } catch { /* treat as scan */ }
            if (looksScanned(text)) { needOcr.push(file); continue; } // scanned PDF → OCR prompt
            await uploadOne(file, parseDocument(text), all.length === 1);
            if (all.length === 1) return;
          } else if (isImage) {
            needOcr.push(file); // photos always go through the OCR prompt
          } else {
            await uploadOne(file, emptyParse(), false);
          }
          done++;
        } catch {
          errors.push({ name: file.name, reason: t.uploadFailedRow });
        }
        tick(file.name);
      }
      if (all.length > 1 || errors.length) toast(t.uploadDone(done, errors.length), errors.length ? 'error' : 'ok');
      if (needOcr.length) { setOcrQueue({ files: needOcr, single: all.length === 1 && needOcr.length === 1 }); return; }
      await load();
    } finally {
      setBusy(false);
      setProg(p => (p && p.errors.length === 0 && errors.length === 0 ? null : p ? { ...p, done, errors: [...errors] } : null));
      if (!errors.length) setProg(null);
    }
  };

  const fileActions = (d: any) => <div className="document-file-actions">
    <a className="btn secondary sm" href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer">{t.viewFile}</a>
    {canLead && d.doc_type !== 'personal' && d.status === 'draft' && ['accommodation','logistics'].includes(docCategory(d)) && <Link className="btn sm" to={`/trips/${tripId}/documents/${d.id}/review`}>{t.reviewNow}</Link>}
    {d.can_manage && <><button className="btn ghost sm" disabled={busy} aria-label={`${bm ? 'Namakan semula' : 'Rename'} ${d.filename}`} onClick={() => { setEditing(d); setFilename(d.filename); }}><Icon name="edit" size={16} /></button><button className="btn ghost sm" disabled={busy} aria-label={`${t.delete} ${d.filename}`} onClick={() => setDeleting(d)}><Icon name="trash" size={16} /></button></>}
  </div>;

  return (
    <div>
      <PageHead crumb={trip.name} title={t.documents} sub={bm ? 'Tempahan perjalanan dan fail peribadi, tersusun di satu tempat.' : 'Travel bookings and personal files, organised in one place.'} />
      { (
        <>
          <div className="document-upload-categories" role="group" aria-label={bm ? 'Loại tải lên' : 'Upload category'}>
            {categories.map(c => <button key={c.id} type="button" className={`document-category ${category === c.id ? 'active' : ''}`} aria-pressed={category === c.id} disabled={busy || !!ocrQueue} onClick={() => setCategory(c.id)}>
              <Icon name={c.icon} /><b>{c.name}</b><small>{c.hint}</small>
            </button>)}
          </div>
          <div className="document-upload-options">
            <label>{bm ? 'Simpan dalam folder' : 'Save to folder'}
              <select value={destination} disabled={busy || !!ocrQueue} onChange={e => setDestination(e.target.value)}>{folderChoices.map(f => <option key={f.id} value={String(f.id)}>{f.name}{f.name !== scopeLabel(f.visibility) ? ` · ${scopeLabel(f.visibility)}` : ''}</option>)}</select>
            </label>
            {category === 'other' && <label>{bm ? 'Kategori' : 'Category'}<input list="document-categories" value={customCategory} maxLength={80} disabled={busy || !!ocrQueue} placeholder={bm ? 'Contoh: Panduan makanan' : 'e.g. Food guides'} onChange={e => setCustomCategory(e.target.value)} /><datalist id="document-categories">{priorCategories.map(c => <option key={c} value={c} />)}</datalist></label>}
            <p className="hint">{scopeLabel(uploadScope)} · {useOcr ? (bm ? 'OCR dan semakan sebelum ditambah ke pelan kumpulan.' : 'OCR and review before adding to the group plan.') : (bm ? 'Fail sahaja. Tidak ditambah ke pelan kumpulan.' : 'File storage only. Nothing is added to the group plan.')}</p>
          </div>
          <div
            role="button" tabIndex={busy || ocrQueue ? -1 : 0}
            aria-label={t.uploadDoc}
            onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !busy && !ocrQueue) { e.preventDefault(); fileRef.current?.click(); } }}
            className={`drop2 ${drag ? 'drag' : ''} ${busy || ocrQueue ? 'disabled' : ''}`}
            onClick={() => !busy && !ocrQueue && fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); if (!busy && !ocrQueue) setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
          >
            <span className="tile"><Icon name="upload" /></span>
            <b>{busy ? t.parsing : t.uploadDoc}</b>
            <small>{!useOcr ? (bm ? 'Maksimum 10 MB setiap fail' : 'Up to 10 MB per file') : t.dropHint}</small>
            <input ref={fileRef} type="file" accept={!useOcr ? undefined : 'application/pdf,image/*'} multiple hidden
              onChange={e => { handleFiles(e.target.files); e.target.value = ''; }} />
          </div>
          {prog && (
            <div className="upload-strip">
              <div className="row-between tiny" style={{ marginBottom: 3 }}>
                <span>{busy ? t.uploadingDocs : t.uploadDone(prog.done, prog.errors.length)}</span>
                <span>{t.uploadCount(prog.done, prog.total)}{prog.errors.length ? <> · <Icon name="alert" size={16} /> {prog.errors.length}</> : ''}</span>
              </div>
              <div className="upload-track">
                <div className="fillbar" style={{ width: `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%` }} />
                <span className="plane" style={{ left: `${Math.max(4, Math.min(96, Math.round((prog.done / Math.max(1, prog.total)) * 100)))}%` }}><Icon name="plane" size={16} /></span>
              </div>
              {busy && <div className="tiny" style={{ marginTop: 2 }}>{prog.current}</div>}
              {prog.errors.length > 0 && !busy && (
                <div className="callout warn" style={{ marginTop: 6 }}>
                  {prog.errors.map((er, i) => <div key={i} className="tiny"><Icon name="alert" size={16} /> {er.name} — {er.reason}</div>)}
                  <button type="button" className="btn ghost sm" style={{ marginTop: 4 }} onClick={() => setProg(null)}><Icon name="plus" className="x-close" size={16} /> {t.close}</button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {loadError && <div className="callout warn" role="alert">{bm ? 'Fail tidak dapat dimuatkan. Sambungan internet diperlukan.' : 'Could not load files. Documents require an internet connection.'} <button className="btn secondary sm" onClick={() => void load()}>{bm ? 'Cuba lagi' : 'Retry'}</button></div>}
      <section className="card document-library" style={{ marginTop: 16 }}>
        <div className="cardhead"><h3>{t.documents} <span className="badge gray">{docs.length}</span></h3>
          <div className="row" role="group" aria-label={bm ? 'Paparan' : 'View mode'}>
            <button className={`btn sm ${view === 'folders' ? '' : 'secondary'}`} aria-pressed={view === 'folders'} onClick={() => { setView('folders'); setFolder('all'); }}>{bm ? 'Folder & fail' : 'Folders & files'}</button>
            <button className={`btn sm ${view === 'list' ? '' : 'secondary'}`} aria-pressed={view === 'list'} onClick={() => { setView('list'); setFolder('all'); }}>{bm ? 'Senarai' : 'List'}</button>
          </div>
        </div>
        <div className="document-library-toolbar">
          <input type="search" aria-label={bm ? 'Cari fail' : 'Search files'} placeholder={bm ? 'Cari nama fail…' : 'Search filenames…'} value={search} onChange={e => setSearch(e.target.value)} />
          <select aria-label={bm ? 'Folder' : 'Folder'} value={folder} onChange={e => setFolder(e.target.value)}><option value="all">{bm ? 'Semua fail' : 'All files'}</option>{folderChoices.map(f => <option key={f.id} value={String(f.id)}>{f.name}</option>)}</select>
        </div>
        <div className="row" style={{marginBottom:16, flexWrap:'wrap'}}>
          <button className="btn secondary sm" onClick={() => { setFolderName(''); setFolderModal(true); }}>{bm ? 'Folder baharu' : 'New folder'}</button>
          <button className="btn secondary sm" onClick={() => openGroup()}>{bm ? 'Kumpulan baharu' : 'New group'}</button>
          {library.groups.filter(g => g.can_manage).map(g => <button key={g.id} className="btn ghost sm" onClick={() => openGroup(g)}>{bm ? 'Urus' : 'Manage'} {g.name}</button>)}
        </div>
        {view === 'folders' && folder === 'all' && !search && <div className="document-folders">
          {folderChoices.map(f => <button className="document-folder" key={f.id} onClick={() => setFolder(String(f.id))}><Icon name="file" size={24} /><strong>{f.name}</strong><span>{docs.filter(d => docFolder(d) === String(f.id)).length} {bm ? 'fail' : 'files'}</span><small>{scopeLabel(f.visibility)}{f.group_id ? ` · ${library.groups.find(g => g.id === f.group_id)?.name || ''}` : ''}</small></button>)}
        </div>}
        {(view === 'list' || folder !== 'all' || !!search) && <>
          {folder !== 'all' && <button className="btn ghost sm" onClick={() => setFolder('all')}>{bm ? 'Semua folder' : 'All folders'}</button>}
          {!visible.length && <Empty icon="file" title={bm ? 'Tiada fail ditemui' : 'No files found'} sub={bm ? 'Tukar carian atau muat naik fail di atas.' : 'Try another search or upload a file above.'} />}
          <div className={view === 'list' ? 'document-table-scroll' : 'document-file-grid'}>
            {view === 'list' ? <table className="document-table"><thead><tr><th>{bm ? 'Nama fail' : 'File name'}</th><th>{bm ? 'Kategori' : 'Category'}</th><th>Folder / {bm ? 'Akses' : 'Visibility'}</th><th>{bm ? 'Tarikh' : 'Uploaded'}</th><th>{bm ? 'Tindakan' : 'Actions'}</th></tr></thead><tbody>
              {visible.map(d => <tr key={d.id}><td><b>{d.filename}</b>{d.doc_type !== 'personal' && ['accommodation','logistics'].includes(docCategory(d)) && <small>{d.status === 'confirmed' ? t.confirmedStatus : t.draft}</small>}{d.expense_id && <Link className="badge brand" to={`/trips/${tripId}/ledger`}>{t.linkedExpense}</Link>}</td><td>{categoryName(d)}</td><td>{folderLabel(d)}{folderLabel(d) !== accessLabel(d) && <small>{accessLabel(d)}</small>}</td><td>{fmtDate(d.created_at?.slice(0,10),lang)}</td><td>{fileActions(d)}</td></tr>)}
            </tbody></table> : visible.map(d => <article className="document-file" key={d.id}><span className="tile sm"><Icon name="file" /></span><div className="document-file-info"><b>{d.filename}</b><small>{categoryName(d)} · {folderLabel(d)}</small><span className="badge brand">{accessLabel(d)}</span></div>{fileActions(d)}</article>)}
          </div>
        </>}
      </section>
      <Modal open={folderModal} onClose={() => !busy && setFolderModal(false)} icon="file" title={bm ? 'Folder baharu' : 'New folder'} closeLabel={t.close}>
        <form className="document-folder-form" onSubmit={e => { e.preventDefault(); void modify(() => api.post(`/trips/${tripId}/document-library/folders`, {name:folderName,visibility:folderScope,group_id:Number(groupId)})); }}>
          <label>{bm ? 'Nama folder' : 'Folder name'}<input required maxLength={80} value={folderName} onChange={e => setFolderName(e.target.value)} /></label>
          <label>{bm ? 'Siapa boleh melihat?' : 'Who can access?'}<select value={folderScope} onChange={e => setFolderScope(e.target.value)}><option value="private">{scopeLabel('private')}</option><option value="group">{scopeLabel('group')}</option><option value="trip">{scopeLabel('trip')}</option></select></label>
          {folderScope === 'group' && <label>{bm ? 'Kumpulan' : 'Group'}<select required value={groupId} onChange={e => setGroupId(e.target.value)}><option value="">{bm ? 'Pilih kumpulan' : 'Choose a group'}</option>{library.groups.filter(g => g.can_access).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
          <p className="hint">{bm ? 'Fail baharu mengikut akses folder ini. Akses kumpulan berubah apabila keahlian berubah.' : 'New files inherit this folder’s visibility. Group access changes when membership changes.'}</p>
          <button className="btn" disabled={busy || !folderName.trim()}>{t.save}</button>
        </form>
      </Modal>
      <Modal open={groupModal} onClose={() => !busy && setGroupModal(false)} icon="edit" title={editGroup ? (bm ? 'Urus kumpulan' : 'Manage group') : (bm ? 'Kumpulan baharu' : 'New group')} closeLabel={t.close}>
        <form className="document-folder-form" onSubmit={e => { e.preventDefault(); const data={name:groupName,participant_ids:groupPeople}; void modify(() => editGroup ? api.put(`/trips/${tripId}/document-library/groups/${editGroup.id}`,data) : api.post(`/trips/${tripId}/document-library/groups`,data)); }}>
          <label>{bm ? 'Nama kumpulan' : 'Group name'}<input required maxLength={80} value={groupName} onChange={e => setGroupName(e.target.value)} /></label>
          <p className="hint">{bm ? 'Pencipta dan ahli terpilih boleh melihat fail kumpulan. Ketua perjalanan boleh mengurus keahlian.' : 'The creator and selected members can access group files. Trip leaders can manage membership.'}</p>
          <div className="document-group-people">{members.map(m => <label key={m.id}><input type="checkbox" checked={groupPeople.includes(m.id)} onChange={e => setGroupPeople(e.target.checked ? [...groupPeople,m.id] : groupPeople.filter(id => id !== m.id))} />{m.name}</label>)}</div>
          <button className="btn" disabled={busy || !groupName.trim()}>{t.save}</button>
        </form>
      </Modal>
      <Modal open={!!editing} onClose={() => !busy && setEditing(null)} icon="edit" title={bm ? 'Namakan semula fail' : 'Rename file'} closeLabel={t.close}>
        <form onSubmit={e => { e.preventDefault(); void modify(() => api.patch(`/documents/${editing.id}`, { filename })); }}>
          <label htmlFor="document-name">{bm ? 'Nama fail' : 'File name'}</label>
          <input id="document-name" value={filename} maxLength={180} required onChange={e => setFilename(e.target.value)} disabled={busy} />
          <p className="hint">{bm ? 'Kandungan fail tidak berubah.' : 'The file contents stay unchanged.'}</p>
          <button className="btn" disabled={busy || !filename.trim()}>{busy ? t.loading : t.save}</button>
        </form>
      </Modal>
      <Modal open={!!deleting} onClose={() => !busy && setDeleting(null)} icon="trash" title={bm ? 'Padam fail?' : 'Delete file?'} closeLabel={t.close}>
        <b>{deleting?.filename}</b>
        <p>{bm ? 'Fail ini akan dipadam secara kekal.' : 'This permanently deletes the file.'}</p>
        {deleting?.doc_type !== 'personal' && <p className="hint">{bm ? 'Maklumat tempahan berkaitan akan dibuang daripada pelan kumpulan. Rekod perbelanjaan, salinan pelan peribadi dan panduan yang diterbitkan dikekalkan.' : 'Associated booking details will be removed from the group plan. Expense records, personal plan copies and published guides are kept.'}</p>}
        <button className="btn danger" disabled={busy} onClick={() => void modify(() => api.del(`/documents/${deleting.id}`))}>{busy ? t.loading : t.delete}</button>
      </Modal>

      {ocrQueue && (
        <OcrModal files={ocrQueue.files} single={ocrQueue.single}
          upload={uploadOne}
          onClose={async () => { setOcrQueue(null); await load(); }} />
      )}
    </div>
  );
}

/** v0.11: OCR prompt for photos and scanned PDFs — language chips + progress. */
function OcrModal({ files, single, upload, onClose }: {
  files: File[];
  single: boolean;
  upload: (file: File, parsed: any, goReview: boolean) => Promise<any>;
  onClose: () => void;
}) {
  const { t } = useT();
  const [idx, setIdx] = useState(0);
  const [langs, setLangs] = useState<string[]>(savedLangs());
  const [prog, setProg] = useState<OcrProgress | null>(null);
  const [err, setErr] = useState('');
  const file = files[idx];
  const isLast = idx === files.length - 1;

  const toggleLang = (code: string) => {
    if (code === 'eng') return; // English always on — it anchors Latin text
    const next = langs.includes(code) ? langs.filter(l => l !== code) : [...langs, code];
    setLangs(next.length ? next : ['eng']);
    saveLangs(next.length ? next : ['eng']);
  };

  const advance = async () => {
    if (isLast) onClose();
    else { setIdx(idx + 1); setProg(null); setErr(''); }
  };

  const run = async () => {
    setErr('');
    setProg({ page: 0, pages: 1, pct: 0, status: 'lang' });
    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const images: Blob[] = isPdf ? await renderPdfPages(file) : [file];
      const text = await ocrImages(images, langs, setProg);
      const parsed = parseDocument(text);
      parsed.fields['OCR'] = langs.join('+');
      await upload(file, parsed, single && isLast);
      if (!(single && isLast)) await advance();
    } catch (e: any) {
      setErr(t.ocrFailed);
      setProg(null);
    }
  };

  const skip = async () => {
    await upload(file, {
      parser: 'none', docType: 'other', people: [], legs: [], fields: {},
      warnings: [t.ocrSkippedWarn], confidence: 0, suggestExpense: true,
    }, single && isLast);
    if (!(single && isLast)) await advance();
  };

  const running = prog !== null;
  return (
    <div className="overlay" onClick={() => !running && onClose()}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
        <div className="row-between">
          <h2><Icon name="search" size={20} /> {t.ocrTitle}</h2>
          {!running && <button className="icon" onClick={onClose} aria-label={t.close}><Icon name="plus" className="x-close" size={20} /></button>}
        </div>
        <p className="tiny">{file.name}{files.length > 1 ? ` (${idx + 1}/${files.length})` : ''}</p>
        <p className="tiny">{t.ocrHint}</p>
        <div className="chips" style={{ margin: '8px 0' }}>
          {OCR_LANGS.map(l => (
            <span key={l.code}
              className={`chip ${langs.includes(l.code) ? 'on' : ''}`}
              onClick={() => !running && toggleLang(l.code)}>
              {l.label}{!l.local && !langs.includes(l.code) ? <> <Icon name="download" size={16} /></> : ''}
            </span>
          ))}
        </div>
        {langs.some(l => !OCR_LANGS.find(o => o.code === l)?.local) && (
          <p className="tiny">{t.ocrDownloadNote}</p>
        )}
        {running && (
          <div style={{ margin: '10px 0' }}>
            <div className="tiny">
              {prog.status === 'lang' ? t.ocrLoadingLang : t.ocrPage(prog.page, prog.pages, Math.round(prog.pct * 100))}
            </div>
            <div className="track" style={{ height: 8, marginTop: 4 }}>
              <div className="fill" style={{ width: `${Math.round(prog.pct * 100)}%` }} />
            </div>
          </div>
        )}
        {err && <p className="callout warn">{err}</p>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
          <button className="btn ghost" disabled={running} onClick={skip}>{t.ocrSkip}</button>
          <button className="btn" disabled={running} onClick={run}><Icon name="chev-r" size={16} /> {t.ocrStart}</button>
        </div>
      </div>
    </div>
  );
}
