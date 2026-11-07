// One category → icon vocabulary for the whole app (v0.29). Ledger, My spend,
// Plan and the dashboard all draw from here so the same category never shows
// two different symbols (it used to be SVG in Ledger and emoji in My spend/Plan).
import type { IconName } from '../components/iconDefs';

/** Expense + private-spend categories (ExpenseForm CATEGORIES, MySpend). */
export const EXPENSE_CAT_ICON: Record<string, IconName> = {
  accommodation: 'hotel',
  flight: 'plane',
  transport: 'train',
  entrance: 'ticket',
  pass: 'ticket',
  food: 'food',
  shopping: 'bag',
  other: 'receipt',
};

/** Plan activity categories (shared/wizard ACTIVITY_CATEGORIES). */
export const ACTIVITY_CAT_ICON: Record<string, IconName> = {
  sightseeing: 'camera',
  food: 'food',
  transport: 'train',
  lodging: 'bed',
  shopping: 'bag',
  other: 'pin',
};

export const expenseIcon = (cat?: string | null): IconName => EXPENSE_CAT_ICON[cat ?? ''] ?? 'receipt';
export const activityIcon = (cat?: string | null): IconName => ACTIVITY_CAT_ICON[cat ?? ''] ?? 'pin';
