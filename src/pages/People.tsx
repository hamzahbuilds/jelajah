import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api';
import { useT } from '../i18n';
import { TripCtx, Participant } from './TripShell';
import { useToast } from '../components/Toast';

type Invite = {
  id: number; code: string; url: string; role: 'editor' | 'viewer';
  expires_at: string | null; max_uses: number | null; used_count: number; revoked: boolean;
};

export default function People() {
  const { t } = useT();
  const { toast } = useToast();
  const { trip, tripId, members, reload } = useOutletContext<TripCtx>();
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
  useEffect(() => { load(); loadInvites(); }, []);

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
    const role = (p as any).trip_role as 'leader' | 'editor' | 'viewer' | undefined;
    if (!role) return null;
    const label = role === 'leader' ? t.roleLeader : role === 'editor' ? t.roleEditor : t.roleViewer;
    return <span className="badge">{label}</span>;
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
    <div className="grid grid-2" style={{ alignItems: 'start' }}>
      <div className="card">
        <h3>{t.visibility}</h3>
        <p className="tiny">{t.visibilityHint}</p>
        {(['plan', 'documents', 'ledger', 'payments', 'assistant'] as const).map(f => (
          <label key={f} className="row" style={{ gap: 8, padding: '4px 0' }}>
            <input type="checkbox" checked={!hidden.includes(f)} onChange={() => toggleFeature(f)}
              style={{ width: 17, height: 17, accentColor: 'var(--brand)' }} />
            <span>{f === 'assistant' ? `💬 ${t.assistantFeature}` : (t as any)[f === 'ledger' ? 'ledger' : f]}</span>
          </label>
        ))}
        <label className="row" style={{ gap: 8, padding: '10px 0 4px', borderTop: '1px solid var(--line)', marginTop: 8 }}>
          <input type="checkbox" checked={canEditPlan} onChange={toggleEditPlan}
            style={{ width: 17, height: 17, accentColor: 'var(--brand)' }} />
          <span>✏️ {t.memberCanEditPlan}</span>
        </label>
      </div>
      <div className="card">
        <h3>{t.tripMembers}</h3>
        <p className="tiny">{t.memberHint}</p>
        <div className="chips" style={{ marginBottom: 12 }}>
          {all.map(p => (
            <span key={p.id} className={`chip ${memberIds.has(p.id) ? 'on' : ''}`} onClick={() => toggleMember(p.id)}>
              {p.name}{p.is_infant ? ' 👶' : ''}
            </span>
          ))}
        </div>
        {members.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {members.map(m => (
              <div className="row-between" key={m.id} style={{ padding: '4px 0' }}>
                <span>{m.name}{m.is_infant ? ' 👶' : ''}</span>
                {roleChip(m)}
              </div>
            ))}
          </div>
        )}
        <form className="row" onSubmit={addParticipant}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder={t.addParticipant} style={{ flex: 1 }} />
          <label className="row tiny" style={{ gap: 4 }}>
            <input type="checkbox" checked={newInfant} onChange={e => setNewInfant(e.target.checked)} />{t.infant}
          </label>
          <button className="btn btn-sm">{t.add}</button>
        </form>
      </div>

      <div className="card">
        <h3>{t.inviteTitle}</h3>
        {invites.filter(i => !i.revoked).map(i => (
          <div className={`row-between invite-row${i.id === justCreated ? ' invite-row-new' : ''}`} key={i.id}
            style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
            <div>
              <div className="row" style={{ gap: 6 }}>
                <span className="badge">{i.role === 'editor' ? t.roleEditor : t.roleViewer}</span>
                <span className="tiny">{t.inviteUses(i.used_count, i.max_uses ?? 0)}</span>
                {i.expires_at && <span className="tiny">{t.inviteExpires(new Date(i.expires_at).toLocaleDateString())}</span>}
              </div>
            </div>
            <div className="row">
              <button className="btn btn-ghost btn-sm" onClick={() => copyInvite(i.code)}>📋</button>
              <button className="btn btn-ghost btn-sm" onClick={() => revokeInvite(i.id)}>{t.inviteRevoke} ✕</button>
            </div>
          </div>
        ))}
        <form className="row" onSubmit={createInvite} style={{ marginTop: 14 }}>
          <label className="row tiny" style={{ gap: 4 }}>
            <span>{t.inviteRoleLabel}</span>
            <select value={inviteRole} onChange={e => setInviteRole(e.target.value as 'viewer' | 'editor')}>
              <option value="viewer">{t.roleViewer}</option>
              <option value="editor">{t.roleEditor}</option>
            </select>
          </label>
          <button className="btn btn-sm">{t.inviteCreate}</button>
        </form>
      </div>
    </div>
  );
}
