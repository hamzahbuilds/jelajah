import Loading from '../components/Loading';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useOutletContext, useSearchParams, Link } from 'react-router-dom';
import { api, fmtDate } from '../api';
import { useT } from '../i18n';
import { TripCtx } from '../app/tripContext';
// v0.38 perf: the PDF reader (pdfjs, ~800 KB of source) loads only when a PDF is read.
const loadPdf = () => import('../pdf');
import { parseDocument } from '../../shared/parsers';
import { OCR_LANGS, savedLangs, saveLangs, looksScanned, ocrImages, OcrProgress } from '../ocr';
import { useToast } from '../components/Toast';
import PageHead from '../components/PageHead';
import Modal from '../components/Modal';
import { Icon, type IconName } from '../components/Icon';
import Dialog from '../components/Dialog';

// v0.48: Attractions joins the built-in types (file storage, no OCR import).
const BUILT_IN = ['accommodation', 'logistics', 'attractions', 'other'];
const OCR_TYPES = ['accommodation', 'logistics'];
const VIEW_KEY = 'jl-docs-view';
const DOC_DRAG = 'application/x-jelajah-doc';
const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files');
const hasDoc = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(DOC_DRAG);

interface UploadOpts { category: string; folder: string }

/** v0.49 Documents, Drive-style: a folder rail, one workspace that takes
 *  dropped files anywhere, files you can drag onto a folder (or move with
 *  "Move to…" from the keyboard or a phone), and an upload dialog that asks
 *  where a file goes and what it is. */
export default function Documents() {
  const { t, lang } = useT();
  const { tripId, canLead, members } = useOutletContext<TripCtx>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const bm = lang === 'ms';
  const L = (en: string, ms: string) => (bm ? ms : en);

  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [library, setLibrary] = useState<{ folders: any[]; groups: any[]; categories: string[] }>({ folders: [], groups: [], categories: [] });
  const [search, setSearch] = useState('');
  const [view, setViewState] = useState<'grid' | 'list'>(() => { try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } });
  const setView = (v: 'grid' | 'list') => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* per-device nicety */ } };

  // Folder and type live in the URL, so Back walks out of a folder.
  const [params, setParams] = useSearchParams();
  const folder = params.get('folder') || 'all';
  const typeFilter = params.get('type') || 'all';
  const browse = (next: { folder?: string; type?: string }) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) { if (!v || v === 'all') p.delete(k); else p.set(k, v); }
    setParams(p);
  };

  // Dialogs
  const [upload, setUpload] = useState<{ files: File[]; folder: string; category: string; custom: string } | null>(null);
  const [editing, setEditing] = useState<any>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState('');
  const [moving, setMoving] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);
  const [folderModal, setFolderModal] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderScope, setFolderScope] = useState('private');
  const [groupId, setGroupId] = useState('');
  const [groupModal, setGroupModal] = useState(false);
  const [editGroup, setEditGroup] = useState<any>(null);
  const [groupName, setGroupName] = useState('');
  const [groupPeople, setGroupPeople] = useState<number[]>([]);

  // Drag state: which folder is under a dragged file, and whether files hover the workspace.
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [fileOver, setFileOver] = useState(false);
  const dragDepth = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const scopeLabel = (v: string) => v === 'trip' ? L('Whole trip', 'Seluruh perjalanan') : v === 'group' ? L('Group', 'Kumpulan') : L('Only me', 'Saya sahaja');
  const categories: Array<{ id: string; name: string; icon: IconName }> = [
    { id: 'accommodation', name: L('Accommodation', 'Penginapan'), icon: 'hotel' },
    { id: 'logistics', name: L('Transport', 'Pengangkutan'), icon: 'plane' },
    { id: 'attractions', name: L('Attractions', 'Tarikan'), icon: 'ticket' },
    { id: 'other', name: L('Other', 'Lain-lain'), icon: 'file' },
  ];
  const docMeta = (d: any) => { try { return JSON.parse(d.parsed_json || '{}'); } catch { return {}; } };
  const docCategory = (d: any) => { const c = docMeta(d).libraryCategory; return c === 'personal' ? 'other' : c || (d.doc_type === 'personal' ? 'other' : d.doc_type === 'confirmation' ? 'accommodation' : 'logistics'); };
  const typeOf = (d: any) => (BUILT_IN.slice(0, 3).includes(docCategory(d)) ? docCategory(d) : 'other');
  const categoryName = (d: any) => categories.find(c => c.id === docCategory(d))?.name || docCategory(d);
  const docFolder = (d: any) => String(docMeta(d).libraryFolderId || (d.doc_type === 'personal' ? 'private' : 'trip'));
  const folders = [
    { id: 'private', name: L('Only me', 'Saya sahaja'), visibility: 'private', builtIn: true },
    { id: 'trip', name: L('Whole trip', 'Seluruh perjalanan'), visibility: 'trip', builtIn: true },
    ...library.folders.map(f => ({ ...f, builtIn: false })),
  ];
  const folderById = (id: string) => folders.find(f => String(f.id) === id);
  const folderTitle = (id: string) => folderById(id)?.name || scopeLabel(id);
  const access = (f: any) => `${scopeLabel(f.visibility)}${f.group_id ? ` · ${library.groups.find(g => g.id === f.group_id)?.name || ''}` : ''}`;
  const folderIcon = (f: any): IconName => (f.visibility === 'private' ? 'user' : f.visibility === 'group' ? 'users' : 'globe');
  const priorCategories = [...new Set<string>([...library.categories, ...docs.map(docCategory)])].filter(c => !BUILT_IN.includes(c));

  const needle = search.trim().toLocaleLowerCase();
  const visible = useMemo(() => docs.filter(d =>
    (folder === 'all' || docFolder(d) === folder)
    && (typeFilter === 'all' || typeOf(d) === typeFilter)
    && (!needle || `${d.filename} ${categoryName(d)}`.toLocaleLowerCase().includes(needle))),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [docs, folder, typeFilter, needle, lang]);
  const atRoot = folder === 'all' && typeFilter === 'all' && !needle;
  const countIn = (id: string) => docs.filter(d => docFolder(d) === id).length;
  const typeCount = (id: string) => docs.filter(d => (folder === 'all' || docFolder(d) === folder) && typeOf(d) === id).length;

  const load = async () => {
    setLoading(true);
    try {
      const [files, settings] = await Promise.all([api.get(`/trips/${tripId}/documents`), api.get(`/trips/${tripId}/document-library/settings`)]);
      setDocs(files); setLibrary(settings); setLoadError(false);
    } catch { setDocs([]); setLibrary({ folders: [], groups: [], categories: [] }); setLoadError(true); }
    finally { setLoading(false); }
  };
  useEffect(() => { setDocs([]); setLibrary({ folders: [], groups: [], categories: [] }); setSearch(''); void load(); }, [tripId]);

  const modify = async (action: () => Promise<unknown>, done = t.tSaved) => {
    setBusy(true);
    try { await action(); await load(); setEditing(null); setDeleting(null); setMoving(null); setFolderModal(false); setGroupModal(false); toast(done); }
    catch { toast(t.tSaveFailed, 'error'); }
    finally { setBusy(false); }
  };

  /* ---------------- upload ---------------- */
  const [ocrQueue, setOcrQueue] = useState<{ files: File[]; single: boolean; opts: UploadOpts } | null>(null);
  const [prog, setProg] = useState<{ done: number; total: number; current: string; errors: Array<{ name: string; reason: string }> } | null>(null);
  const emptyParse = (warning?: string) => ({ parser: 'none', docType: 'other', people: [], legs: [], fields: {}, warnings: warning ? [warning] : [], confidence: 0, suggestExpense: true });
  const scopeOf = (folderId: string) => folderById(folderId)?.visibility || folderId;
  const usesOcr = (o: UploadOpts) => canLead && scopeOf(o.folder) === 'trip' && OCR_TYPES.includes(o.category);

  /** Open the upload dialog for these files, defaulting to where the person is. */
  const startUpload = (files: FileList | File[] | null, into?: string) => {
    const list = Array.from(files ?? []);
    if (!list.length || busy || ocrQueue) return;
    const here = into ?? (folder !== 'all' ? folder : canLead ? 'trip' : 'private');
    setUpload({ files: list, folder: here, category: typeFilter !== 'all' ? typeFilter : 'other', custom: '' });
  };

  const uploadOne = async (file: File, parsed: any, goReview: boolean, o: UploadOpts) => {
    const f = folderById(o.folder);
    const form = new FormData();
    form.append('file', file);
    form.append('category', o.category);
    form.append('visibility', f?.visibility === 'trip' ? 'trip' : f?.builtIn ? 'private' : (f?.visibility ?? 'private'));
    if (f && !f.builtIn) form.append('folder_id', String(f.id));
    form.append('meta', JSON.stringify(parsed));
    const res = await api.upload(`/trips/${tripId}/documents`, form);
    if (goReview) navigate(`/trips/${tripId}/documents/${res.id}/review`, { state: { duplicate: res.duplicate } });
    return res;
  };

  const runUpload = async (all: File[], o: UploadOpts) => {
    setBusy(true);
    const errors: Array<{ name: string; reason: string }> = [];
    let done = 0;
    setProg({ done: 0, total: all.length, current: all[0]?.name ?? '', errors: [] });
    const tick = (current: string) => setProg({ done, total: all.length, current, errors: [...errors] });
    const ocr = usesOcr(o);
    try {
      const needOcr: File[] = [];
      for (const file of all) {
        tick(file.name);
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        const isImage = /^image\//.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
        try {
          if (!ocr) await uploadOne(file, {}, false, o);
          else if (isPdf) {
            let text = '';
            try { text = await (await loadPdf()).extractPdfText(file); } catch { /* treat as scan */ }
            if (looksScanned(text)) { needOcr.push(file); continue; }
            await uploadOne(file, parseDocument(text), all.length === 1, o);
            if (all.length === 1) return;
          } else if (isImage) { needOcr.push(file); continue; }
          else await uploadOne(file, emptyParse(), false, o);
          done++;
        } catch { errors.push({ name: file.name, reason: t.uploadFailedRow }); }
        tick(file.name);
      }
      if (all.length > 1 || errors.length) toast(t.uploadDone(done, errors.length), errors.length ? 'error' : 'ok');
      else if (done) toast(L(`Saved to ${folderTitle(o.folder)}`, `Disimpan dalam ${folderTitle(o.folder)}`));
      if (needOcr.length) { setOcrQueue({ files: needOcr, single: all.length === 1 && needOcr.length === 1, opts: o }); return; }
      await load();
    } finally {
      setBusy(false);
      setProg(errors.length ? { done, total: all.length, current: '', errors } : null);
    }
  };

  const confirmUpload = () => {
    if (!upload) return;
    const category = upload.category === 'other' ? (upload.custom.trim() || 'other') : upload.category;
    const files = upload.files, o = { category, folder: upload.folder };
    setUpload(null);
    void runUpload(files, o);
  };

  /* ---------------- moving ---------------- */
  const moveTo = (d: any, target: string) => {
    if (docFolder(d) === target) return;
    void modify(() => api.post(`/documents/${d.id}/move`, { folder: target }), L(`Moved to ${folderTitle(target)}`, `Dipindah ke ${folderTitle(target)}`));
  };

  // Drop handlers shared by the rail and the folder cards.
  const folderDrop = (id: string) => ({
    onDragOver: (e: React.DragEvent) => { if (hasDoc(e) || hasFiles(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = hasDoc(e) ? 'move' : 'copy'; setDropFolder(id); } },
    onDragLeave: () => setDropFolder(f => (f === id ? null : f)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault(); e.stopPropagation(); setDropFolder(null); setFileOver(false); dragDepth.current = 0;
      const docId = e.dataTransfer.getData(DOC_DRAG);
      if (docId) { const d = docs.find(x => String(x.id) === docId); if (d) moveTo(d, id); return; }
      if (e.dataTransfer.files.length) startUpload(e.dataTransfer.files, id);
    },
  });
  // The whole workspace accepts files dropped from the computer.
  const workspaceDrop = {
    onDragEnter: (e: React.DragEvent) => { if (hasFiles(e)) { dragDepth.current++; setFileOver(true); } },
    onDragOver: (e: React.DragEvent) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } },
    onDragLeave: (e: React.DragEvent) => { if (hasFiles(e) && --dragDepth.current <= 0) { dragDepth.current = 0; setFileOver(false); } },
    onDrop: (e: React.DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth.current = 0; setFileOver(false); startUpload(e.dataTransfer.files); },
  };

  const openGroup = (g?: any) => { setEditGroup(g || null); setGroupName(g?.name || ''); setGroupPeople(g?.participant_ids || []); setGroupModal(true); };
  const openEdit = (d: any) => { setEditing(d); setEditName(d.filename); setEditType(docCategory(d)); };
  const isBooking = (d: any) => d.doc_type !== 'personal' && OCR_TYPES.includes(docCategory(d));
  const typeIcon = (d: any): IconName => categories.find(c => c.id === typeOf(d))?.icon ?? 'file';

  const fileActions = (d: any) => (
    <div className="drive-actions">
      <a className="btn secondary sm" href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer">{t.viewFile}</a>
      {canLead && isBooking(d) && <Link className="btn ghost sm" to={`/trips/${tripId}/documents/${d.id}/review`}>{d.status === 'confirmed' ? L('Review again', 'Semak semula') : t.reviewNow}</Link>}
      {d.can_manage && <>
        <button type="button" className="btn ghost sm" disabled={busy} aria-label={`${L('Move', 'Pindah')} ${d.filename}`} title={L('Move to…', 'Pindah ke…')} onClick={() => setMoving(d)}><Icon name="folder" size={16} /></button>
        <button type="button" className="btn ghost sm" disabled={busy} aria-label={`${L('Edit', 'Sunting')} ${d.filename}`} title={L('Edit', 'Sunting')} onClick={() => openEdit(d)}><Icon name="edit" size={16} /></button>
        <button type="button" className="btn ghost sm" disabled={busy} aria-label={`${t.delete} ${d.filename}`} title={t.delete} onClick={() => setDeleting(d)}><Icon name="trash" size={16} /></button>
      </>}
    </div>
  );
  const dragProps = (d: any) => d.can_manage ? {
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData(DOC_DRAG, String(d.id)); e.dataTransfer.effectAllowed = 'move'; document.documentElement.classList.add('drive-dragging'); },
    onDragEnd: () => { document.documentElement.classList.remove('drive-dragging'); setDropFolder(null); },
  } : {};
  const badges = (d: any) => <>
    {isBooking(d) && <span className="badge gray">{d.status === 'confirmed' ? t.confirmedStatus : t.draft}</span>}
    {d.expense_id && <Link className="badge brand" to={`/trips/${tripId}/money/ledger`}>{t.linkedExpense}</Link>}
  </>;

  const files = (list: any[]) => view === 'list'
    ? <div className="table-scroll"><table className="drive-table">
        <thead><tr><th>{L('Name', 'Nama')}</th><th>{L('Type', 'Jenis')}</th><th>{L('Folder', 'Folder')}</th><th>{L('Added', 'Ditambah')}</th><th><span className="sr-only">{L('Actions', 'Tindakan')}</span></th></tr></thead>
        <tbody>{list.map(d => <tr key={d.id} {...dragProps(d)}>
          <td><span className="drive-name"><Icon name={typeIcon(d)} size={16} /> <b>{d.filename}</b></span> {badges(d)}</td>
          <td>{categoryName(d)}</td><td>{folderTitle(docFolder(d))}</td><td>{fmtDate(d.created_at?.slice(0, 10), lang)}</td><td>{fileActions(d)}</td>
        </tr>)}</tbody>
      </table></div>
    : <ul className="drive-files">{list.map(d => (
        <li key={d.id} className="drive-file" {...dragProps(d)}>
          <span className={`drive-thumb t-${typeOf(d)}`} aria-hidden="true"><Icon name={typeIcon(d)} size={24} /></span>
          <div className="drive-file-info">
            <b title={d.filename}>{d.filename}</b>
            <small>{categoryName(d)} · {folderTitle(docFolder(d))} · {fmtDate(d.created_at?.slice(0, 10), lang)}</small>
            <span className="drive-badges">{badges(d)}</span>
          </div>
          {fileActions(d)}
        </li>
      ))}</ul>;

  const uploadButton = (label = L('Upload', 'Muat naik')) => (
    <button type="button" className="btn" disabled={busy || !!ocrQueue} onClick={() => fileRef.current?.click()}><Icon name="upload" size={16} /> {label}</button>
  );
  const here = folder !== 'all' ? folderById(folder) : null;

  return (
    <div className="drive">
      <PageHead title={t.documents} sub={L('Bookings, tickets and travel files in one place. Drag files in, or drag a file onto a folder to move it.', 'Tempahan, tiket dan fail perjalanan di satu tempat. Seret fail masuk, atau seret fail ke folder untuk memindahkannya.')} />
      <input ref={fileRef} type="file" multiple hidden onChange={e => { startUpload(e.target.files); e.target.value = ''; }} />

      <div className="drive-layout">
        <nav className="drive-rail" aria-label={L('Folders', 'Folder')}>
          <button type="button" className={`drive-rail-item ${folder === 'all' ? 'on' : ''}`} aria-current={folder === 'all' ? 'page' : undefined} onClick={() => browse({ folder: 'all' })}>
            <Icon name="files" size={16} /> <span>{L('All files', 'Semua fail')}</span> <small>{docs.length}</small>
          </button>
          {folders.map(f => (
            <button key={f.id} type="button" className={`drive-rail-item ${folder === String(f.id) ? 'on' : ''} ${dropFolder === String(f.id) ? 'drop' : ''}`}
              aria-current={folder === String(f.id) ? 'page' : undefined} onClick={() => browse({ folder: String(f.id) })} {...folderDrop(String(f.id))}>
              <Icon name={folderIcon(f)} size={16} /> <span>{f.name}</span> <small>{countIn(String(f.id))}</small>
            </button>
          ))}
          <div className="drive-rail-tools">
            <button type="button" className="btn ghost sm" onClick={() => { setFolderName(''); setFolderScope('private'); setFolderModal(true); }}><Icon name="plus" size={16} /> {L('New folder', 'Folder baharu')}</button>
            <button type="button" className="btn ghost sm" onClick={() => openGroup()}><Icon name="users" size={16} /> {L('New group', 'Kumpulan baharu')}</button>
            {library.groups.filter(g => g.can_manage).map(g => <button key={g.id} type="button" className="btn ghost sm" onClick={() => openGroup(g)}>{L('Manage', 'Urus')} {g.name}</button>)}
          </div>
        </nav>

        <section className={`drive-main ${fileOver ? 'file-over' : ''}`} aria-labelledby="drive-h" {...workspaceDrop}>
          <div className="drive-head">
            <nav aria-label={L('Location', 'Lokasi')} className="drive-crumbs">
              <h2 id="drive-h">
                {folder === 'all' ? L('All files', 'Semua fail') : <><button type="button" className="linklike" onClick={() => browse({ folder: 'all' })}>{L('All files', 'Semua fail')}</button> <Icon name="chev-r" size={16} /> {folderTitle(folder)}</>}
              </h2>
              {here && <small>{access(here)}</small>}
            </nav>
            <div className="drive-head-actions">
              {uploadButton()}
              <div className="seg" role="group" aria-label={L('View', 'Paparan')}>
                <button type="button" className={view === 'grid' ? 'on' : ''} aria-pressed={view === 'grid'} aria-label={L('Grid', 'Grid')} onClick={() => setView('grid')}><Icon name="folder" size={16} /></button>
                <button type="button" className={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} aria-label={L('List', 'Senarai')} onClick={() => setView('list')}><Icon name="list-check" size={16} /></button>
              </div>
            </div>
          </div>

          {docs.length > 0 && <div className="drive-toolbar">
            <input type="search" aria-label={L('Search files', 'Cari fail')} placeholder={L('Search files…', 'Cari fail…')} value={search} onChange={e => setSearch(e.target.value)} />
            <div className="chips" role="group" aria-label={L('Type', 'Jenis')}>
              <button type="button" className={`chip ${typeFilter === 'all' ? 'on' : ''}`} aria-pressed={typeFilter === 'all'} onClick={() => browse({ type: 'all' })}>{L('All types', 'Semua jenis')}</button>
              {categories.map(c => <button key={c.id} type="button" className={`chip ${typeFilter === c.id ? 'on' : ''}`} aria-pressed={typeFilter === c.id} onClick={() => browse({ type: c.id })}>
                <Icon name={c.icon} size={16} /> {c.name} <span className="badge gray">{typeCount(c.id)}</span></button>)}
            </div>
          </div>}

          {prog && <div className="upload-strip" role="status">
            <div className="row-between tiny" style={{ marginBottom: 3 }}>
              <span>{busy ? t.uploadingDocs : t.uploadDone(prog.done, prog.errors.length)}</span>
              <span>{t.uploadCount(prog.done, prog.total)}</span>
            </div>
            <div className="upload-track"><div className="fillbar" style={{ width: `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%` }} /></div>
            {busy && <div className="tiny" style={{ marginTop: 2 }}>{prog.current}</div>}
            {prog.errors.length > 0 && !busy && <div className="callout warn" style={{ marginTop: 6 }}>
              {prog.errors.map((er, i) => <div key={i} className="tiny"><Icon name="alert" size={16} /> {er.name}: {er.reason}</div>)}
              <button type="button" className="btn ghost sm" style={{ marginTop: 4 }} onClick={() => setProg(null)}><Icon name="x" size={16} /> {t.close}</button>
            </div>}
          </div>}

          {loadError && <div className="callout warn" role="alert">{L('Could not load files. Documents need an internet connection.', 'Fail tidak dapat dimuatkan. Dokumen memerlukan sambungan internet.')} <button className="btn secondary sm" onClick={() => void load()}>{L('Retry', 'Cuba lagi')}</button></div>}
          {loading && <Loading label={t.loading} />}

          {!loading && !loadError && !docs.length && (
            <div className="drive-empty">
              <span className="drive-empty-icon"><Icon name="upload" size={24} /></span>
              <h3>{L('Keep your trip documents together', 'Simpan dokumen perjalanan bersama')}</h3>
              <p>{L('Drag files here, or upload hotel bookings, flight tickets, passes and anything else the trip needs.', 'Seret fail ke sini, atau muat naik tempahan hotel, tiket penerbangan, pas dan apa sahaja yang diperlukan.')}</p>
              {uploadButton(L('Upload files', 'Muat naik fail'))}
              <small>{L('Up to 10 MB per file. You choose who can see each one.', 'Sehingga 10 MB setiap fail. Anda pilih siapa boleh melihatnya.')}</small>
            </div>
          )}

          {!loading && !loadError && docs.length > 0 && atRoot && <>
            <h3 className="drive-sub">{L('Folders', 'Folder')}</h3>
            <ul className="drive-folders">
              {folders.map(f => (
                <li key={f.id}>
                  <button type="button" className={`drive-folder ${dropFolder === String(f.id) ? 'drop' : ''}`} onClick={() => browse({ folder: String(f.id) })} {...folderDrop(String(f.id))}>
                    <Icon name={folderIcon(f)} size={20} />
                    <span><b>{f.name}</b><small>{countIn(String(f.id))} {L('files', 'fail')} · {access(f)}</small></span>
                  </button>
                </li>
              ))}
            </ul>
            <h3 className="drive-sub">{L('Recent files', 'Fail terkini')}</h3>
            {files(docs.slice(0, 12))}
            {docs.length > 12 && <button type="button" className="btn ghost sm" onClick={() => setView('list')}>{L(`See all ${docs.length} in a list`, `Lihat kesemua ${docs.length} dalam senarai`)}</button>}
          </>}

          {!loading && !loadError && docs.length > 0 && !atRoot && (visible.length ? files(visible) : (
            <div className="drive-empty small">
              <h3>{needle ? L('No matching files', 'Tiada padanan') : L('Nothing here yet', 'Belum ada apa-apa')}</h3>
              <p>{needle ? L('Try another name or type.', 'Cuba nama atau jenis lain.') : L('Drop files here, or upload them straight into this folder.', 'Lepaskan fail di sini, atau muat naik terus ke folder ini.')}</p>
              {needle ? <button type="button" className="btn secondary sm" onClick={() => setSearch('')}>{L('Clear search', 'Kosongkan carian')}</button> : uploadButton()}
            </div>
          ))}

          {fileOver && <div className="drive-drop-hint" aria-hidden="true"><Icon name="upload" size={24} /> {L(`Drop to upload to ${folder !== 'all' ? folderTitle(folder) : L('a folder you choose', 'folder pilihan anda')}`, `Lepaskan untuk muat naik ke ${folder !== 'all' ? folderTitle(folder) : 'folder pilihan anda'}`)}</div>}
        </section>
      </div>

      {/* Upload: where it goes and what it is */}
      <Modal open={!!upload} onClose={() => setUpload(null)} icon="upload" title={upload ? L(`Upload ${upload.files.length} file${upload.files.length === 1 ? '' : 's'}`, `Muat naik ${upload.files.length} fail`) : ''} closeLabel={t.close}>
        {upload && <form className="drive-form" onSubmit={e => { e.preventDefault(); confirmUpload(); }}>
          <ul className="drive-upload-list">{upload.files.slice(0, 5).map((f, i) => <li key={i}><Icon name="file" size={16} /> {f.name}</li>)}{upload.files.length > 5 && <li>+{upload.files.length - 5}</li>}</ul>
          <label>{L('Save to', 'Simpan dalam')}
            <select value={upload.folder} onChange={e => setUpload({ ...upload, folder: e.target.value })}>
              {folders.map(f => <option key={f.id} value={String(f.id)}>{f.name}{f.builtIn ? '' : ` · ${scopeLabel(f.visibility)}`}</option>)}
            </select>
          </label>
          <fieldset className="drive-types"><legend>{L('What is it?', 'Apakah ini?')}</legend>
            {categories.map(c => <label key={c.id} className={`chip ${upload.category === c.id ? 'on' : ''}`}>
              <input type="radio" name="up-type" value={c.id} checked={upload.category === c.id} onChange={() => setUpload({ ...upload, category: c.id })} /> <Icon name={c.icon} size={16} /> {c.name}</label>)}
          </fieldset>
          {upload.category === 'other' && <label>{L('Your own type (optional)', 'Jenis sendiri (pilihan)')}
            <input list="drive-categories" value={upload.custom} maxLength={80} placeholder={L('e.g. Food guides', 'Contoh: Panduan makanan')} onChange={e => setUpload({ ...upload, custom: e.target.value })} />
            <datalist id="drive-categories">{priorCategories.map(c => <option key={c} value={c} />)}</datalist></label>}
          <p className="hint">{scopeLabel(scopeOf(upload.folder))} · {usesOcr({ category: upload.category, folder: upload.folder })
            ? L('We read the booking and you review it before it joins the group plan.', 'Kami baca tempahan dan anda semak sebelum ia ditambah ke pelan kumpulan.')
            : L('Stored as a file. Nothing is added to the plan.', 'Disimpan sebagai fail. Tiada apa ditambah ke pelan.')}</p>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn ghost" onClick={() => setUpload(null)}>{t.close}</button>
            <button className="btn"><Icon name="upload" size={16} /> {L('Upload', 'Muat naik')}</button>
          </div>
        </form>}
      </Modal>

      {/* Move to… (keyboard and touch alternative to dragging) */}
      <Modal open={!!moving} onClose={() => !busy && setMoving(null)} icon="folder" title={L('Move to…', 'Pindah ke…')} closeLabel={t.close}>
        {moving && <div className="drive-move">
          <p className="hint"><b>{moving.filename}</b> · {L('now in', 'kini dalam')} {folderTitle(docFolder(moving))}</p>
          {folders.map(f => (
            <button key={f.id} type="button" className="drive-move-item" disabled={busy || docFolder(moving) === String(f.id)} onClick={() => moveTo(moving, String(f.id))}>
              <Icon name={folderIcon(f)} size={16} /> <span><b>{f.name}</b><small>{access(f)}</small></span>
              {docFolder(moving) === String(f.id) && <small className="muted">{L('Current', 'Semasa')}</small>}
            </button>
          ))}
          <p className="hint">{L('Who can see the file follows the folder.', 'Siapa boleh melihat fail mengikut folder.')}</p>
        </div>}
      </Modal>

      <Modal open={!!editing} onClose={() => !busy && setEditing(null)} icon="edit" title={L('Edit file', 'Sunting fail')} closeLabel={t.close}>
        {editing && <form className="drive-form" onSubmit={e => { e.preventDefault(); void modify(() => api.patch(`/documents/${editing.id}`, { filename: editName, ...(editType !== docCategory(editing) ? { category: editType } : {}) })); }}>
          <label>{L('File name', 'Nama fail')}<input value={editName} maxLength={180} required onChange={e => setEditName(e.target.value)} disabled={busy} /></label>
          <label>{L('Type', 'Jenis')}
            <select value={BUILT_IN.includes(editType) ? editType : 'custom'} onChange={e => setEditType(e.target.value === 'custom' ? '' : e.target.value)}>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="custom">{L('Your own type…', 'Jenis sendiri…')}</option>
            </select>
          </label>
          {!BUILT_IN.includes(editType) && <label>{L('Your own type', 'Jenis sendiri')}<input list="drive-categories" value={editType} maxLength={80} required onChange={e => setEditType(e.target.value)} /></label>}
          <p className="hint">{L('The file itself stays unchanged.', 'Kandungan fail tidak berubah.')}</p>
          <button className="btn" disabled={busy || !editName.trim() || !editType.trim()}>{busy ? t.loading : t.save}</button>
        </form>}
      </Modal>

      <Modal open={!!deleting} onClose={() => !busy && setDeleting(null)} icon="trash" title={L('Delete file?', 'Padam fail?')} closeLabel={t.close}>
        <b>{deleting?.filename}</b>
        <p>{L('This permanently deletes the file.', 'Fail ini akan dipadam secara kekal.')}</p>
        {deleting?.doc_type !== 'personal' && <p className="hint">{L('Associated booking details will be removed from the group plan. Expense records, personal plan copies and published guides are kept.', 'Maklumat tempahan berkaitan akan dibuang daripada pelan kumpulan. Rekod perbelanjaan, salinan pelan peribadi dan panduan yang diterbitkan dikekalkan.')}</p>}
        <button className="btn danger" disabled={busy} onClick={() => void modify(() => api.del(`/documents/${deleting.id}`))}>{busy ? t.loading : t.delete}</button>
      </Modal>

      <Modal open={folderModal} onClose={() => !busy && setFolderModal(false)} icon="folder" title={L('New folder', 'Folder baharu')} closeLabel={t.close}>
        <form className="drive-form" onSubmit={e => { e.preventDefault(); void modify(() => api.post(`/trips/${tripId}/document-library/folders`, { name: folderName, visibility: folderScope, group_id: Number(groupId) })); }}>
          <label>{L('Folder name', 'Nama folder')}<input required maxLength={80} value={folderName} onChange={e => setFolderName(e.target.value)} /></label>
          <label>{L('Who can see it?', 'Siapa boleh melihat?')}<select value={folderScope} onChange={e => setFolderScope(e.target.value)}><option value="private">{scopeLabel('private')}</option><option value="group">{scopeLabel('group')}</option><option value="trip">{scopeLabel('trip')}</option></select></label>
          {folderScope === 'group' && <label>{L('Group', 'Kumpulan')}<select required value={groupId} onChange={e => setGroupId(e.target.value)}><option value="">{L('Choose a group', 'Pilih kumpulan')}</option>{library.groups.filter(g => g.can_access).map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
          <p className="hint">{L('Files in this folder get its visibility. Group access follows group membership.', 'Fail dalam folder ini mengikut aksesnya. Akses kumpulan mengikut keahlian.')}</p>
          <button className="btn" disabled={busy || !folderName.trim()}>{t.save}</button>
        </form>
      </Modal>

      <Modal open={groupModal} onClose={() => !busy && setGroupModal(false)} icon="users" title={editGroup ? L('Manage group', 'Urus kumpulan') : L('New group', 'Kumpulan baharu')} closeLabel={t.close}>
        <form className="drive-form" onSubmit={e => { e.preventDefault(); const data = { name: groupName, participant_ids: groupPeople }; void modify(() => editGroup ? api.put(`/trips/${tripId}/document-library/groups/${editGroup.id}`, data) : api.post(`/trips/${tripId}/document-library/groups`, data)); }}>
          <label>{L('Group name', 'Nama kumpulan')}<input required maxLength={80} value={groupName} onChange={e => setGroupName(e.target.value)} /></label>
          <p className="hint">{L('The creator and the people you pick can open group folders. Trip leaders can manage who is in it.', 'Pencipta dan ahli terpilih boleh membuka folder kumpulan. Ketua perjalanan boleh mengurus keahlian.')}</p>
          <div className="document-group-people">{members.map(m => <label key={m.id}><input type="checkbox" checked={groupPeople.includes(m.id)} onChange={e => setGroupPeople(e.target.checked ? [...groupPeople, m.id] : groupPeople.filter(id => id !== m.id))} />{m.name}</label>)}</div>
          <button className="btn" disabled={busy || !groupName.trim()}>{t.save}</button>
        </form>
      </Modal>

      {ocrQueue && (
        <OcrModal files={ocrQueue.files} single={ocrQueue.single}
          upload={(file, parsed, goReview) => uploadOne(file, parsed, goReview, ocrQueue.opts)}
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
  const { t, lang } = useT();
  const controller = useRef<AbortController | null>(null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => () => controller.current?.abort(), []);
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
    if (controller.current) return;
    const current = new AbortController();
    controller.current = current;
    setErr('');
    setProg({ page: 0, pages: 1, pct: 0, status: 'render' });
    try {
      const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const images: Blob[] = isPdf ? await (await loadPdf()).renderPdfPages(file, 8, 2.2, current.signal) : [file];
      const text = await ocrImages(images, langs, setProg, current.signal);
      current.signal.throwIfAborted();
      const parsed = parseDocument(text);
      parsed.fields['OCR'] = langs.join('+');
      setUploading(true);
      await upload(file, parsed, single && isLast);
      if (!(single && isLast)) await advance();
    } catch (e: any) {
      if (!current.signal.aborted) setErr(t.ocrFailed);
      setProg(null);
    } finally { controller.current = null; setUploading(false); }
  };

  const skip = async () => {
    if (uploading || controller.current) return;
    setUploading(true); setErr('');
    try { await upload(file, {
      parser: 'none', docType: 'other', people: [], legs: [], fields: {},
      warnings: [t.ocrSkippedWarn], confidence: 0, suggestExpense: true,
    }, single && isLast);
    if (!(single && isLast)) await advance();
    } catch { setErr(t.ocrFailed); } finally { setUploading(false); }
  };

  const running = prog !== null || uploading;
  return (
    <Dialog className="overlay-dlg modal" onClose={onClose} dismissible={!running} label={t.ocrTitle} style={{ maxWidth: 480 }}>
        <div className="row-between">
          <h2><Icon name="search" size={20} /> {t.ocrTitle}</h2>
          {!running && <button className="icon" onClick={onClose} aria-label={t.close}><Icon name="x" size={20} /></button>}
        </div>
        <p className="tiny">{file.name}{files.length > 1 ? ` (${idx + 1}/${files.length})` : ''}</p>
        <p className="tiny">{t.ocrHint}</p>
        <div className="chips" style={{ margin: '8px 0' }}>
          {OCR_LANGS.map(l => (
            <button type="button" disabled={running || l.code === 'eng'} aria-pressed={langs.includes(l.code)} key={l.code}
              className={`chip ${langs.includes(l.code) ? 'on' : ''}`}
              onClick={() => !running && toggleLang(l.code)}>
              {l.label}{!l.local && !langs.includes(l.code) ? <> <Icon name="download" size={16} /></> : ''}
            </button>
          ))}
        </div>
        {langs.some(l => !OCR_LANGS.find(o => o.code === l)?.local) && (
          <p className="tiny">{t.ocrDownloadNote}</p>
        )}
        {prog && (
          <div style={{ margin: '10px 0' }}>
            <div className="tiny">
              {uploading ? t.uploadingDocs : prog.status === 'render' ? (lang === 'ms' ? 'Menyediakan halaman…' : 'Preparing document pages…') : prog.status === 'lang' ? t.ocrLoadingLang : t.ocrPage(prog.page, prog.pages, Math.round(prog.pct * 100))}
            </div>
            <div className="track" style={{ height: 8, marginTop: 4 }}>
              <div className="fill" style={{ width: `${Math.round(prog.pct * 100)}%` }} />
            </div>
          </div>
        )}
        {err && <p className="callout warn">{err}</p>}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
          {prog && !uploading && <button className="btn secondary" onClick={() => controller.current?.abort()}>{lang === 'ms' ? 'Batalkan OCR' : 'Cancel OCR'}</button>}
          <button className="btn ghost" disabled={running} onClick={skip}>{t.ocrSkip}</button>
          <button className="btn" disabled={running} onClick={run}><Icon name="chev-r" size={16} /> {t.ocrStart}</button>
        </div>
    </Dialog>
  );
}
