// v0.30: trip outlet context types, shared by pages without importing TripShell.
import type { Trip, TripRole } from './session';

export interface Participant {
  id: number; name: string; is_infant: number;
  trip_role?: 'leader' | 'editor' | 'viewer'; has_account?: number;
}
export interface TripCtx {
  trip: Trip; members: Participant[]; tripId: number;
  reload: () => Promise<void>;
  myRole: TripRole; canLead: boolean; canEdit: boolean;
}

