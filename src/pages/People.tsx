import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { api } from '../api';
import { useT } from '../i18n';
import { TripCtx, Participant } from './TripShell';
import { useToast } from '../components/Toast';

export default function People() {
  const { t } = useT();
  const { toast } = useToast();
  const { trip, tripId, members, reload } = useOutletContext<TripCtx>();
  const [canEditPlan, setCanEditPlan] = useState<boolean>(!!(trip as any).member_can_edit_plan);
  const [all, setAll] = useState<Participant[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [newName, setNewName] = useState('');
  const [newInfant, setNewInfant] = useState(false);
  const [uform, setUform] = useState({ name: '', email: '', password: '', role: 'member', participant_id: 0 });
  const [showTemp, setShowTemp] = useState<string | null>(null);

  const load = async () => {
    setAll(await api.get('/participants'));
    setUsers(await api.get('/users'));
  };
  useEffect(() => { load(); }, []);

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

  const genPassword = () => Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    const password = uform.password || genPassword();
    await api.post('/users', { ...uform, password, participant_id: uform.participant_id || null });
    setShowTemp(password);
    setUform({ name: '', email: '', password: '', role: 'member', participant_id: 0 });
    toast(t.tAccountCreated);
    await load();
  };

  const resetPw = async (u: any) => {
    const pw = genPassword();
    await api.patch(`/users/${u.id}`, { resetPassword: pw });
    setShowTemp(pw);
  };

  const toggleDisabled = async (u: any) => {
    await api.patch(`/users/${u.id}`, { disabled: !u.disabled });
    await load();
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
        <form className="row" onSubmit={addParticipant}>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder={t.addParticipant} style={{ flex: 1 }} />
          <label className="row tiny" style={{ gap: 4 }}>
            <input type="checkbox" checked={newInfant} onChange={e => setNewInfant(e.target.checked)} />{t.infant}
          </label>
          <button className="btn btn-sm">{t.add}</button>
        </form>
      </div>

      <div className="card">
        <h3>{t.usersTitle}</h3>
        {showTemp && (
          <p className="callout info">
            {t.tempPassword}: <strong style={{ fontFamily: 'monospace' }}>{showTemp}</strong>
            <button className="icon" onClick={() => setShowTemp(null)}>✕</button>
          </p>
        )}
        {users.map(u => (
          <div className="row-between" key={u.id} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
            <div>
              <div><strong>{u.name}</strong> <span className="badge">{u.role === 'admin' ? t.admin : t.member}</span>
                {u.disabled ? <span className="badge warn">{t.disabled}</span> : null}</div>
              <div className="tiny">{u.email}{u.participant_id ? ` · ${all.find(p => p.id === u.participant_id)?.name ?? ''}` : ''}</div>
            </div>
            <div className="row">
              <button className="btn btn-ghost btn-sm" onClick={() => resetPw(u)}>{t.resetPassword}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => toggleDisabled(u)}>
                {u.disabled ? t.enable : t.disable}
              </button>
            </div>
          </div>
        ))}
        <form onSubmit={addUser} style={{ marginTop: 14 }}>
          <h3 style={{ fontSize: '.9rem' }}>{t.addUser}</h3>
          <div className="form-grid">
            <label className="field"><span>{t.name}</span>
              <input required value={uform.name} onChange={e => setUform({ ...uform, name: e.target.value })} /></label>
            <label className="field"><span>{t.email}</span>
              <input type="email" required value={uform.email} onChange={e => setUform({ ...uform, email: e.target.value })} /></label>
            <label className="field"><span>{t.role}</span>
              <select value={uform.role} onChange={e => setUform({ ...uform, role: e.target.value })}>
                <option value="member">{t.member}</option>
                <option value="admin">{t.admin}</option>
              </select></label>
            <label className="field"><span>{t.linkedParticipant}</span>
              <select value={uform.participant_id} onChange={e => setUform({ ...uform, participant_id: Number(e.target.value) })}>
                <option value={0}>{t.none}</option>
                {all.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select></label>
          </div>
          <button className="btn btn-sm">{t.addUser}</button>
          <span className="tiny" style={{ marginLeft: 8 }}>({t.tempPassword} ✨)</span>
        </form>
      </div>
    </div>
  );
}
