import { useEffect, useRef, useState } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useT } from '../i18n';
import { useSession } from '../App';
import { TripCtx, Participant } from './TripShell';
import { useToast } from '../components/Toast';
import PageHead from '../components/PageHead';
import { Icon } from '../components/Icon';
import Modal from '../components/Modal';
import { resizeImageFile } from '../lib/image';
import RoomsCard from '../components/RoomsCard';

type UnsplashPhoto = {
  id: string; thumb: string; regular: string; author_name: string; author_link: string; download_location: string;
};

type Invite = {
  id: number; code: string; url: string; role: 'editor' | 'viewer';
  expires_at: string | null; max_uses: number | null; used_count: number; revoked: boolean;
};

// initials for the `.avatar` chip — first letter of the first two words, or the
// first two letters of a single-word name.
const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

export default function People() {
  const { t } = useT();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { user, refresh } = useSession();
  const { trip, tripId, members, reload, canLead, canEdit } = useOutletContext<TripCtx>();
  const [canEditPlan, setCanEditPlan] = useState<boolean>(!!(trip as any).member_can_edit_plan);
  const [all, setAll] = useState<Participant[]>([]);
  const [newName, setNewName] = useState('');
  const [newInfant, setNewInfant] = useState(false);

  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteRole, setInviteRole] = useState<'viewer' | 'editor'>('viewer');
  const [justCreated, setJustCreated] = useState<number | null>(null);

  const load = async () => {
    setAll(await api.get('/participants'));
  };
  const loadInvites = async () => setInvites(await api.get(`/trips/${tripId}/invites`));
  useEffect(() => { if (canLead) { load(); loadInvites(); } }, [canLead]);

  // v0.13: optimistic membership — the chip flips instantly, the PUT runs in
  // the background, and the context resyncs when the server confirms.
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set(members.map(m => m.id)));
  const inFlight = useRef(0);
  useEffect(() => {
    if (inFlight.current === 0) setMemberIds(new Set(members.map(m => m.id)));
  }, [members]);

  const toggleMember = (pid: number) => {
    const removing = memberIds.has(pid);
    const next = new Set(memberIds);
    removing ? next.delete(pid) : next.add(pid);
    setMemberIds(next);
    toast(removing ? t.tParticipantRemoved : t.tParticipantAdded);
    inFlight.current++;
    api.put(`/trips/${tripId}/members`, { participant_ids: [...next] })
      .then(() => reload())
      .catch(() => { setMemberIds(new Set(members.map(m => m.id))); toast(t.tSaveFailed, 'error'); })
      .finally(() => { inFlight.current--; });
  };

  const addParticipant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const r = await api.post('/participants', { name: newName, is_infant: newInfant });
    await api.put(`/trips/${tripId}/members`, { participant_ids: [...members.map(m => m.id), r.id] });
    setNewName(''); setNewInfant(false);
    toast(t.tParticipantAdded);
    await Promise.all([load(), reload()]);
  };

  const roleChip = (p: Participant) => {
    const role = p.trip_role;
    if (!role) return null;
    if (p.has_account) {
      return (
        <select value={role} onChange={e => changeRole(p.id, e.target.value as 'leader' | 'editor' | 'viewer')}>
          <option value="leader">{t.roleLeader}</option>
          <option value="editor">{t.roleEditor}</option>
          <option value="viewer">{t.roleViewer}</option>
        </select>
      );
    }
    const label = role === 'leader' ? t.roleLeader : role === 'editor' ? t.roleEditor : t.roleViewer;
    return <span className="badge gray">{label}</span>;
  };

  const changeRole = async (pid: number, role: 'leader' | 'editor' | 'viewer') => {
    try {
      await api.patch(`/trips/${tripId}/members/${pid}/role`, { role });
      toast(t.tSaved);
      await reload();
    } catch (e: any) {
      if (e instanceof ApiError && e.code === 'last_leader') toast(t.lastLeaderMsg, 'error');
      else toast(t.tSaveFailed, 'error');
    }
  };

  const transferLead = async (pid: number, name: string) => {
    if (!window.confirm(t.transferConfirm(name))) return;
    try {
      await api.post(`/trips/${tripId}/transfer`, { participant_id: pid });
      toast(t.tLeadershipMoved);
      await reload();
    } catch {
      toast(t.tSaveFailed, 'error');
    }
  };

  // ---- Task 3 (v0.18) — trip details card ----
  const [details, setDetails] = useState({
    name: trip.name ?? '', destination: (trip as any).destination ?? '',
    start_date: (trip as any).start_date ?? '', end_date: (trip as any).end_date ?? '',
  });
  useEffect(() => {
    setDetails({
      name: trip.name ?? '', destination: (trip as any).destination ?? '',
      start_date: (trip as any).start_date ?? '', end_date: (trip as any).end_date ?? '',
    });
  }, [trip]);

  const saveTripDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (details.start_date && details.end_date && details.end_date < details.start_date) {
      toast(t.badDateRange, 'error');
      return;
    }
    try {
      await api.patch(`/trips/${tripId}`, {
        name: details.name, destination: details.destination || null,
        start_date: details.start_date || null, end_date: details.end_date || null,
      });
      toast(t.tTripUpdated);
      await reload();
    } catch {
      toast(t.tSaveFailed, 'error');
    }
  };

  // ---- Task 3 (v0.18) — delete trip ----
  const [deleteText, setDeleteText] = useState('');
  const deleteTrip = async () => {
    try {
      const res = await fetch(`/api/trips/${tripId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: deleteText }),
      });
      if (res.status === 401) { location.href = '/login'; return; }
      if (!res.ok) {
        let code = 'error';
        try { code = ((await res.json()) as any)?.error ?? 'error'; } catch { /* ignore */ }
        throw new ApiError(code, res.status);
      }
      toast(t.tTripDeleted);
      await refresh();
      navigate('/');
    } catch {
      toast(t.tSaveFailed, 'error');
    }
  };

  // ---- Task 3 (v0.20) — cover photo ----
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [coverBusy, setCoverBusy] = useState(false);
  const coverCreditRaw = (trip as any).cover_credit as string | null | undefined;
  // server stores "<title> · Wikipedia · <page url>" (empty url segment when
  // the summary lacked one) — render the title+source as a link when a url
  // is present, plain text otherwise. Split on the LAST ' · ' only (F6): a
  // Wikipedia title can itself contain ' · ', which would otherwise shift
  // the fields and turn the credit into a broken relative link.
  const coverCredit = coverCreditRaw ? (() => {
    const idx = coverCreditRaw.lastIndexOf(' · ');
    const label = idx === -1 ? coverCreditRaw : coverCreditRaw.slice(0, idx);
    const maybeUrl = idx === -1 ? '' : coverCreditRaw.slice(idx + 3);
    const url = maybeUrl.startsWith('https://') ? maybeUrl : '';
    return { label, url };
  })() : null;

  const uploadCover = async (file: File) => {
    setCoverBusy(true);
    try {
      const blob = await resizeImageFile(file);
      if (blob.size > 600_000) throw new Error('upload_failed'); // server limit; avoid a doomed 413 round-trip
      const res = await fetch(`/api/trips/${tripId}/cover`, {
        method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob,
      });
      if (res.status === 401) { location.href = '/login'; return; }
      if (!res.ok) throw new Error('upload_failed');
      toast(t.coverSet);
      await reload();
      await refresh();
    } catch {
      toast(t.tSaveFailed, 'error');
    } finally {
      setCoverBusy(false);
    }
  };

  const autoCover = async () => {
    setCoverBusy(true);
    try {
      await api.post(`/trips/${tripId}/cover/auto`);
      toast(t.coverSet);
      await reload();
      await refresh();
    } catch (e) {
      toast(e instanceof ApiError && e.code === 'no_photo' ? t.noPhotoFound : t.tSaveFailed, 'error');
    } finally {
      setCoverBusy(false);
    }
  };

  const removeCover = async () => {
    setCoverBusy(true);
    try {
      await api.del(`/trips/${tripId}/cover`);
      toast(t.coverRemoved);
      await reload();
      await refresh();
    } catch {
      toast(t.tSaveFailed, 'error');
    } finally {
      setCoverBusy(false);
    }
  };

  // ---- Task 3 (v0.23) — Unsplash cover picker ----
  // Hidden for the rest of this mount once a search comes back `no_unsplash`
  // (key absent server-side) — no point showing a button that always 404s.
  const [showUnsplashBtn, setShowUnsplashBtn] = useState(true);
  const [unsplashModal, setUnsplashModal] = useState(false);
  const [unsplashQuery, setUnsplashQuery] = useState('');
  const [unsplashResults, setUnsplashResults] = useState<UnsplashPhoto[] | null>(null);
  const [unsplashSearching, setUnsplashSearching] = useState(false);
  const [unsplashSelecting, setUnsplashSelecting] = useState(false);

  const searchUnsplash = async (q: string) => {
    const query = q.trim();
    if (!query) return;
    setUnsplashSearching(true);
    setUnsplashResults(null);
    try {
      const r = await api.get(`/trips/${tripId}/unsplash?q=${encodeURIComponent(query)}`);
      setUnsplashResults(r.items ?? []);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'no_unsplash') {
        setShowUnsplashBtn(false);
        setUnsplashModal(false);
        toast(t.noUnsplashKey, 'error');
      } else {
        toast(t.tSaveFailed, 'error');
      }
    } finally {
      setUnsplashSearching(false);
    }
  };

  const openUnsplash = () => {
    const q = ((trip as any).destination || trip.name || '').trim();
    setUnsplashQuery(q);
    setUnsplashResults(null);
    setUnsplashModal(true);
    if (q) void searchUnsplash(q);
  };

  const selectUnsplash = async (photo: UnsplashPhoto) => {
    setUnsplashSelecting(true);
    try {
      await api.post(`/trips/${tripId}/cover/unsplash`, {
        regular_url: photo.regular,
        download_location: photo.download_location,
        author_name: photo.author_name,
        author_link: photo.author_link,
      });
      toast(t.coverSet);
      setUnsplashModal(false);
      await reload();
      await refresh();
    } catch {
      toast(t.tSaveFailed, 'error');
    } finally {
      setUnsplashSelecting(false);
    }
  };

  const copyInvite = async (code: string) => {
    const url = location.origin + '/join/' + code;
    await navigator.clipboard.writeText(url);
    toast(t.inviteCopied);
  };

  const createInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await api.post(`/trips/${tripId}/invites`, { role: inviteRole });
    await loadInvites();
    setJustCreated(r.id);
    await copyInvite(r.code);
  };

  const revokeInvite = async (id: number) => {
    await api.del(`/invites/${id}`);
    await loadInvites();
  };

  const [hidden, setHidden] = useState<string[]>(() => {
    try { return JSON.parse((trip as any).hidden_features ?? '[]'); } catch { return []; }
  });
  const toggleFeature = (f: string) => {
    const prev = hidden;
    const next = hidden.includes(f) ? hidden.filter(x => x !== f) : [...hidden, f];
    setHidden(next); // optimistic — checkbox flips immediately
    toast(t.tVisibilitySaved);
    api.patch(`/trips/${tripId}`, { hidden_features: next })
      .then(() => reload())
      .catch(() => { setHidden(prev); toast(t.tSaveFailed, 'error'); });
  };
  const toggleEditPlan = () => {
    const next = !canEditPlan;
    setCanEditPlan(next);
    toast(t.tVisibilitySaved);
    api.patch(`/trips/${tripId}`, { member_can_edit_plan: next })
      .then(() => reload())
      .catch(() => { setCanEditPlan(!next); toast(t.tSaveFailed, 'error'); });
  };

  return (
    <div>
      <PageHead crumb={trip.name} title={t.people} />
      <div className="grid grid-2" style={{ alignItems: 'start' }}>
      {canLead && (
        <div className="card">
          <div className="cardhead"><h3><Icon name="eye" /> {t.visibility}</h3></div>
          <p className="hint">{t.visibilityHint}</p>
          {(['plan', 'documents', 'ledger', 'payments', 'assistant'] as const).map(f => (
            <label key={f} className="row" style={{ gap: 8, padding: '4px 0' }}>
              <input type="checkbox" checked={!hidden.includes(f)} onChange={() => toggleFeature(f)}
                style={{ width: 17, height: 17, accentColor: 'var(--brand-700)' }} />
              <span>{f === 'assistant' ? <><Icon name="chat" size={16} /> {t.assistantFeature}</> : (t as any)[f === 'ledger' ? 'ledger' : f]}</span>
            </label>
          ))}
          <label className="row" style={{ gap: 8, padding: '10px 0 4px', borderTop: '1px solid var(--border)', marginTop: 8 }}>
            <input type="checkbox" checked={canEditPlan} onChange={toggleEditPlan}
              style={{ width: 17, height: 17, accentColor: 'var(--brand-700)' }} />
            <span><Icon name="edit" size={16} /> {t.memberCanEditPlan}</span>
          </label>
        </div>
      )}
      <div className="card">
        <div className="cardhead"><h3>{t.tripMembers}</h3><span className="badge gray">{members.length}</span></div>
        {canLead && (
          <>
            <p className="hint">{t.memberHint}</p>
            <div className="chips" style={{ marginBottom: 12 }}>
              {all.map(p => (
                <span key={p.id} className={`chip ${memberIds.has(p.id) ? 'on' : ''}`} onClick={() => toggleMember(p.id)}>
                  {p.name}{p.is_infant ? ` (${t.infant})` : ''}
                </span>
              ))}
            </div>
          </>
        )}
        {members.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {members.map(m => (
              <div className="lrow" key={m.id}>
                <span className="avatar">{initials(m.name)}</span>
                <div className="l-main">
                  <b>{m.name}</b>
                  <small>
                    {m.is_infant ? t.infant
                      : m.id === user.participant_id ? t.youLbl
                        : m.has_account ? t.hasAccountLbl : t.noAccountLbl}
                  </small>
                </div>
                {canLead && (
                  <div className="l-end">
                    {roleChip(m)}
                    {!!m.has_account && m.id !== user.participant_id && (
                      <button type="button" className="btn ghost sm" title={t.transferLead} aria-label={t.transferLead} onClick={() => transferLead(m.id, m.name)}>
                        <Icon name="flag" size={16} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {canLead && (
          <form className="row" onSubmit={addParticipant}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder={t.addParticipant} style={{ flex: 1 }} />
            <label className="row tiny" style={{ gap: 4 }}>
              <input type="checkbox" checked={newInfant} onChange={e => setNewInfant(e.target.checked)} />{t.infant}
            </label>
            <button className="btn sm" type="submit">{t.add}</button>
          </form>
        )}
      </div>

      <RoomsCard tripId={tripId} members={members} canEdit={canEdit} />

      {canLead && (
        <div className="card">
          <div className="cardhead">
            <h3><Icon name="link" /> {t.inviteTitle}</h3>
            <form className="row" style={{ gap: 8 }} onSubmit={createInvite}>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'viewer' | 'editor')} aria-label={t.inviteRoleLabel}>
                <option value="viewer">{t.roleViewer}</option>
                <option value="editor">{t.roleEditor}</option>
              </select>
              <button type="submit" className="btn sm"><Icon name="plus" size={16} /> {t.inviteCreate}</button>
            </form>
          </div>
          {invites.filter(i => !i.revoked).map(i => (
            <div className={`lrow invite-row${i.id === justCreated ? ' invite-row-new' : ''}`} key={i.id}>
              <span className="tile sm"><Icon name="link" /></span>
              <div className="l-main">
                <div className="invlink">{i.url}</div>
                <small>{i.role === 'editor' ? t.roleEditor : t.roleViewer} · {t.inviteUses(i.used_count, i.max_uses ?? 0)}
                  {i.expires_at ? ` · ${t.inviteExpires(new Date(i.expires_at).toLocaleDateString())}` : ''}</small>
              </div>
              <div className="l-end">
                <button type="button" className="btn secondary sm" onClick={() => copyInvite(i.code)}><Icon name="copy" size={16} /> {t.copyLbl}</button>
                <button type="button" className="btn ghost sm" title={t.inviteRevoke} aria-label={t.inviteRevoke} onClick={() => revokeInvite(i.id)}><Icon name="trash" size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {canLead && (
        <div className="card">
          <div className="cardhead"><h3><Icon name="edit" /> {t.tripDetails}</h3></div>
          <form onSubmit={saveTripDetails}>
            <div className="fld">
              <label>{t.tripName}</label>
              <input value={details.name} onChange={e => setDetails({ ...details, name: e.target.value })} required />
            </div>
            <div className="fld" style={{ marginTop: 12 }}>
              <label>{t.destination}</label>
              <input value={details.destination} onChange={e => setDetails({ ...details, destination: e.target.value })} />
            </div>
            <div className="row" style={{ gap: 12, marginTop: 12 }}>
              <div className="fld" style={{ flex: 1 }}>
                <label>{t.startDate}</label>
                <input type="date" value={details.start_date} onChange={e => setDetails({ ...details, start_date: e.target.value })} />
              </div>
              <div className="fld" style={{ flex: 1 }}>
                <label>{t.endDate}</label>
                <input type="date" value={details.end_date} onChange={e => setDetails({ ...details, end_date: e.target.value })} />
              </div>
            </div>
            <p className="hint" style={{ marginTop: 12 }}>{t.tripDatesHint}</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn sm" type="submit">{t.save}</button>
            </div>
          </form>

          <div className="cover-block">
            <label>{t.coverPhoto}</label>
            {coverCredit ? (
              <p className="hint">
                {coverCredit.url
                  ? <a href={coverCredit.url} target="_blank" rel="noreferrer noopener">{coverCredit.label}</a>
                  : coverCredit.label}
              </p>
            ) : (
              <p className="hint">{t.noCoverYet}</p>
            )}
            <input ref={coverInputRef} type="file" accept="image/*" hidden
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadCover(f); }} />
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn ghost sm" disabled={coverBusy}
                onClick={() => coverInputRef.current?.click()}>
                <Icon name="upload" size={16} /> {t.coverUpload}
              </button>
              {showUnsplashBtn && (
                <button type="button" className="btn ghost sm" disabled={coverBusy} onClick={openUnsplash}>
                  <Icon name="search" size={16} /> {t.chooseFromUnsplash}
                </button>
              )}
              <button type="button" className="btn ghost sm" disabled={coverBusy} onClick={autoCover}>
                <Icon name="camera" size={16} /> {t.coverAuto}
              </button>
              {trip.cover_key && (
                <button type="button" className="btn ghost sm" disabled={coverBusy} onClick={removeCover}>
                  <Icon name="trash" size={16} /> {t.coverRemove}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <Modal open={unsplashModal} onClose={() => setUnsplashModal(false)}
        icon="search" title={t.chooseFromUnsplash} closeLabel={t.close}>
        <div className="fld">
          <label>{t.searchPhotos}</label>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <input value={unsplashQuery} onChange={e => setUnsplashQuery(e.target.value)}
              disabled={unsplashSearching || unsplashSelecting}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void searchUnsplash(unsplashQuery); } }} />
            <button type="button" className="btn ghost sm" disabled={unsplashSearching || unsplashSelecting}
              onClick={() => void searchUnsplash(unsplashQuery)}>
              {unsplashSearching ? t.loading : t.searchBtn}
            </button>
          </div>
        </div>
        {!unsplashSearching && unsplashResults && unsplashResults.length === 0 && (
          <p className="hint">{t.noPhotosFound}</p>
        )}
        {unsplashResults && unsplashResults.length > 0 && (
          <div className="unsplash-grid">
            {unsplashResults.map(p => (
              <button type="button" key={p.id} className="unsplash-thumb"
                disabled={unsplashSelecting} onClick={() => void selectUnsplash(p)}>
                <img src={p.thumb} alt={p.author_name} loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </Modal>

      {canLead && (
        <div className="card danger-card">
          <div className="cardhead"><h3 className="danger-title"><Icon name="trash" /> {t.deleteTrip}</h3></div>
          <p className="hint">{t.deleteTripHint(trip.name)}</p>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            <input value={deleteText} onChange={e => setDeleteText(e.target.value)} placeholder={trip.name} style={{ flex: 1, minWidth: 200 }} />
            <button type="button" className="btn danger sm" disabled={deleteText !== trip.name} onClick={deleteTrip}>
              {t.deleteTrip}
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
