// v0.21 — Rooms card on the People page, visible to every trip role.
// Read-only for viewers; editors/leaders can add stays/rooms, assign or
// remove occupants, rename/resize rooms, and delete rooms. Server enforces
// single-occupancy-per-stay-group (PUT .../occupants), so every mutating
// call here refetches the full room list afterwards rather than trying to
// patch local state — the server may have silently moved someone out of a
// sibling room.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { useT } from '../i18n';
import { useToast } from './Toast';
import { Icon } from './Icon';
import Modal from './Modal';
import { occupancyLabel } from '../../shared/rooms';
import type { Participant } from '../pages/TripShell';

type Room = {
  id: number; stay_label: string; check_in: string | null; check_out: string | null;
  name: string; capacity: number | null; sort: number; occupant_ids: number[];
};
type SuggestedStay = { label: string; check_in: string | null; check_out: string | null };

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

export default function RoomsCard({ tripId, members, canEdit }: {
  tripId: number; members: Participant[]; canEdit: boolean;
}) {
  const { t } = useT();
  const { toast } = useToast();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [suggested, setSuggested] = useState<SuggestedStay[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    const r = await api.get(`/trips/${tripId}/rooms`);
    setRooms(r.rooms);
    setSuggested(r.suggested_stays ?? []);
    setLoaded(true);
  };
  useEffect(() => { load(); }, [tripId]);

  const membersById = new Map(members.map(m => [m.id, m]));

  // ---- add-stay panel (editor+) ----
  const [addOpen, setAddOpen] = useState(false);
  const [freeForm, setFreeForm] = useState({ stay_label: '', check_in: '', check_out: '', name: '', capacity: '' });

  const usedStayLabels = new Set(rooms.map(r => r.stay_label));
  const availableSuggestions = suggested.filter(s => !usedStayLabels.has(s.label));

  const quickAddStay = async (s: SuggestedStay) => {
    try {
      await api.post(`/trips/${tripId}/rooms`, {
        stay_label: s.label, check_in: s.check_in, check_out: s.check_out, name: t.roomOne,
      });
      toast(t.tRoomSaved);
      setAddOpen(false);
      await load();
    } catch { toast(t.tSaveFailed, 'error'); }
  };

  const submitFreeForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!freeForm.stay_label.trim() || !freeForm.name.trim()) return;
    try {
      await api.post(`/trips/${tripId}/rooms`, {
        stay_label: freeForm.stay_label.trim(),
        check_in: freeForm.check_in || null,
        check_out: freeForm.check_out || null,
        name: freeForm.name.trim(),
        capacity: freeForm.capacity === '' ? null : Number(freeForm.capacity),
      });
      toast(t.tRoomSaved);
      setFreeForm({ stay_label: '', check_in: '', check_out: '', name: '', capacity: '' });
      setAddOpen(false);
      await load();
    } catch { toast(t.tSaveFailed, 'error'); }
  };

  // ---- per-stay "add room" (editor+) ----
  const [addRoomFor, setAddRoomFor] = useState<string | null>(null);
  const [newRoom, setNewRoom] = useState({ name: '', capacity: '' });
  const submitAddRoom = async (e: React.FormEvent, group: Room[]) => {
    e.preventDefault();
    if (!newRoom.name.trim() || !addRoomFor) return;
    const ref = group[0];
    try {
      await api.post(`/trips/${tripId}/rooms`, {
        stay_label: addRoomFor, check_in: ref?.check_in ?? null, check_out: ref?.check_out ?? null,
        name: newRoom.name.trim(), capacity: newRoom.capacity === '' ? null : Number(newRoom.capacity),
      });
      toast(t.tRoomSaved);
      setNewRoom({ name: '', capacity: '' });
      setAddRoomFor(null);
      await load();
    } catch { toast(t.tSaveFailed, 'error'); }
  };

  // ---- per-room inline person picker (editor+) ----
  const [pickerFor, setPickerFor] = useState<number | null>(null);
  const assign = async (room: Room, participantId: number) => {
    try {
      await api.put(`/trips/${tripId}/rooms/${room.id}/occupants`, {
        participant_ids: [...room.occupant_ids, participantId],
      });
      toast(t.tOccupantsSaved);
      setPickerFor(null);
      await load();
    } catch { toast(t.tSaveFailed, 'error'); }
  };
  const unassign = async (room: Room, participantId: number) => {
    try {
      await api.put(`/trips/${tripId}/rooms/${room.id}/occupants`, {
        participant_ids: room.occupant_ids.filter(id => id !== participantId),
      });
      toast(t.tOccupantsSaved);
      await load();
    } catch { toast(t.tSaveFailed, 'error'); }
  };

  // ---- rename/capacity inline edit (editor+) ----
  const [editingRoom, setEditingRoom] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: '', capacity: '' });
  const startEdit = (room: Room) => {
    setEditingRoom(room.id);
    setEditForm({ name: room.name, capacity: room.capacity == null ? '' : String(room.capacity) });
  };
  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRoom || !editForm.name.trim()) return;
    try {
      await api.patch(`/trips/${tripId}/rooms/${editingRoom}`, {
        name: editForm.name.trim(), capacity: editForm.capacity === '' ? null : Number(editForm.capacity),
      });
      toast(t.tRoomSaved);
      setEditingRoom(null);
      await load();
    } catch { toast(t.tSaveFailed, 'error'); }
  };

  // ---- delete room (destructive Modal, editor+) ----
  const [confirmDelete, setConfirmDelete] = useState<Room | null>(null);
  const doDelete = async () => {
    if (!confirmDelete) return;
    const room = confirmDelete;
    setConfirmDelete(null);
    try {
      await api.del(`/trips/${tripId}/rooms/${room.id}`);
      toast(t.tRoomDeleted);
      await load();
    } catch { toast(t.tSaveFailed, 'error'); }
  };

  // group rooms by stay_label, preserving server order (stay_label, sort, id)
  const groups: { label: string; rooms: Room[] }[] = [];
  for (const r of rooms) {
    const g = groups.find(g2 => g2.label === r.stay_label);
    if (g) g.rooms.push(r); else groups.push({ label: r.stay_label, rooms: [r] });
  }

  if (!loaded) return null;

  return (
    <div className="card full">
      <div className="cardhead">
        <h3><Icon name="hotel" /> {t.roomsTitle}</h3>
        {canEdit && (
          <button type="button" className="btn secondary sm" onClick={() => setAddOpen(v => !v)}>
            <Icon name="plus" size={16} /> {t.addStay}
          </button>
        )}
      </div>
      <p className="hint">{t.roomsHint}</p>

      {canEdit && addOpen && (
        <div className="room-addstay">
          {availableSuggestions.length > 0 && (
            <>
              <div className="tiny" style={{ marginBottom: 6 }}>{t.suggestedStays}</div>
              <div className="chips" style={{ marginBottom: 12 }}>
                {availableSuggestions.map(s => (
                  <span key={s.label} className="chip" onClick={() => quickAddStay(s)}>
                    {s.label}{s.check_in && s.check_out ? ` · ${t.stayDates(s.check_in, s.check_out)}` : ''}
                  </span>
                ))}
              </div>
            </>
          )}
          <div className="tiny" style={{ marginBottom: 6 }}>{t.orManually}</div>
          <form className="row" onSubmit={submitFreeForm} style={{ gap: 8, flexWrap: 'wrap' }}>
            <input value={freeForm.stay_label} onChange={e => setFreeForm({ ...freeForm, stay_label: e.target.value })}
              placeholder={t.stayLabel} style={{ flex: '1 1 160px' }} required />
            <input type="date" value={freeForm.check_in} onChange={e => setFreeForm({ ...freeForm, check_in: e.target.value })}
              aria-label={t.checkIn} style={{ flex: '1 1 130px' }} />
            <input type="date" value={freeForm.check_out} onChange={e => setFreeForm({ ...freeForm, check_out: e.target.value })}
              aria-label={t.checkOut} style={{ flex: '1 1 130px' }} />
            <input value={freeForm.name} onChange={e => setFreeForm({ ...freeForm, name: e.target.value })}
              placeholder={t.roomName} style={{ flex: '1 1 140px' }} required />
            <input type="number" min={0} max={99} value={freeForm.capacity}
              onChange={e => setFreeForm({ ...freeForm, capacity: e.target.value })}
              placeholder={t.capacity} style={{ flex: '0 1 90px' }} />
            <button type="submit" className="btn sm">{t.addRoom}</button>
          </form>
        </div>
      )}

      {groups.length === 0 && <p className="hint">{t.noStaysYet}</p>}

      {groups.map(group => {
        const assignedIds = new Set(group.rooms.flatMap(r => r.occupant_ids));
        const unassignedPool = members.filter(m => !assignedIds.has(m.id));
        const ref = group.rooms[0];
        return (
          <div key={group.label} className="room-stay" style={{ marginTop: 16 }}>
            <div className="row-between">
              <div>
                <b>{group.label}</b>
                {ref?.check_in && ref?.check_out && (
                  <div className="tiny">{t.stayDates(ref.check_in, ref.check_out)}</div>
                )}
              </div>
              {canEdit && (
                <button type="button" className="btn ghost sm" onClick={() => setAddRoomFor(addRoomFor === group.label ? null : group.label)}>
                  <Icon name="plus" size={16} /> {t.addRoom}
                </button>
              )}
            </div>

            {canEdit && addRoomFor === group.label && (
              <form className="row" onSubmit={e => submitAddRoom(e, group.rooms)} style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                <input value={newRoom.name} onChange={e => setNewRoom({ ...newRoom, name: e.target.value })}
                  placeholder={t.roomName} style={{ flex: '1 1 140px' }} required />
                <input type="number" min={0} max={99} value={newRoom.capacity}
                  onChange={e => setNewRoom({ ...newRoom, capacity: e.target.value })}
                  placeholder={t.capacity} style={{ flex: '0 1 90px' }} />
                <button type="submit" className="btn sm">{t.save}</button>
                <button type="button" className="btn ghost sm" onClick={() => setAddRoomFor(null)}>{t.cancel}</button>
              </form>
            )}

            <div className="room-grid">
              {group.rooms.map(room => {
                const occMembers = room.occupant_ids.map(id => membersById.get(id)).filter((m): m is Participant => !!m);
                const infants = occMembers.filter(m => !!m.is_infant).length;
                const count = occMembers.length - infants;
                const over = room.capacity != null && count > room.capacity;
                const label = occupancyLabel(count, infants, room.capacity);
                const isEditing = editingRoom === room.id;
                return (
                  <div className="room-card" key={room.id}>
                    {isEditing ? (
                      <form className="row" onSubmit={saveEdit} style={{ gap: 6, flexWrap: 'wrap' }}>
                        <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                          style={{ flex: '1 1 100px' }} required autoFocus />
                        <input type="number" min={0} max={99} value={editForm.capacity}
                          onChange={e => setEditForm({ ...editForm, capacity: e.target.value })}
                          placeholder={t.capacity} style={{ flex: '0 1 80px' }} />
                        <button type="submit" className="btn sm">{t.save}</button>
                        <button type="button" className="btn ghost sm" onClick={() => setEditingRoom(null)}>{t.cancel}</button>
                      </form>
                    ) : (
                      <div className="row-between">
                        <b>{room.name}</b>
                        <div className="row" style={{ gap: 6 }}>
                          <span className={`badge ${over ? 'warning' : 'gray'}`} title={over ? t.overCapacity : undefined}>
                            {label}
                          </span>
                          {canEdit && (
                            <>
                              <button type="button" className="btn ghost sm" title={t.edit} aria-label={t.edit} onClick={() => startEdit(room)}>
                                <Icon name="edit" size={16} />
                              </button>
                              <button type="button" className="btn ghost sm" title={t.delete} aria-label={t.delete} onClick={() => setConfirmDelete(room)}>
                                <Icon name="trash" size={16} />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    <div className="chips" style={{ marginTop: 8 }}>
                      {occMembers.map(m => (
                        <span key={m.id} className="room-occ">
                          <span className="avatar" style={{ width: 22, height: 22, fontSize: 10 }}>{initials(m.name)}</span>
                          {m.name}
                          {!!m.is_infant && <span className="badge infant">{t.infant}</span>}
                          {canEdit && (
                            <button type="button" className="room-occ-x" title={t.removeFromRoom} aria-label={t.removeFromRoom}
                              onClick={() => unassign(room, m.id)}>×</button>
                          )}
                        </span>
                      ))}
                      {occMembers.length === 0 && <span className="tiny">{t.unassigned}</span>}
                    </div>

                    {canEdit && (
                      <div style={{ marginTop: 8 }}>
                        {pickerFor === room.id ? (
                          <div className="chips">
                            {unassignedPool.length === 0 && <span className="tiny">{t.unassigned}: —</span>}
                            {unassignedPool.map(p => (
                              <span key={p.id} className="chip" onClick={() => assign(room, p.id)}>
                                {p.name}{p.is_infant ? ` (${t.infant})` : ''}
                              </span>
                            ))}
                            <button type="button" className="btn ghost sm" onClick={() => setPickerFor(null)}>{t.cancel}</button>
                          </div>
                        ) : (
                          <button type="button" className="btn ghost sm" onClick={() => setPickerFor(room.id)}>
                            <Icon name="plus" size={16} /> {t.assign}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {confirmDelete && (
        <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} icon="trash"
          title={t.deleteRoomTitle} sub={t.deleteRoomHint} closeLabel={t.close}
          footer={(
            <>
              <button type="button" className="btn secondary" onClick={() => setConfirmDelete(null)}>{t.cancel}</button>
              <button type="button" className="btn danger" onClick={doDelete}>{t.delete}</button>
            </>
          )} />
      )}
    </div>
  );
}
