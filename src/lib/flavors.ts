// Shared types + week-math helpers for the Flavors planning tab (patch 20).

import { addDays, formatDateShort, weekdayMonday } from './tasks'

export const FLAVOR_SLOT_COUNT = 12

export interface Flavor {
  id: string
  name: string
  active: boolean
  created_at: string
}

// A filled slot only — an empty one simply has no entry for its slot_number
// (see supabase/add-flavors.sql).
export interface FlavorWeekSlot {
  slot_number: number
  flavor_id: string | null
  flavor_name: string
}

// Monday-start week boundary for a YYYY-MM-DD date — same UTC-string-math
// convention as the rest of the app's date helpers (weekdayMonday/addDays in
// tasks.ts), never a real-timezone Date, so this can't drift across DST.
export function startOfWeek(dateStr: string): string {
  return addDays(dateStr, -weekdayMonday(dateStr))
}

// "Mon, Oct 27 – Sun, Nov 2" from a week's Monday.
export function formatWeekLabel(weekStart: string): string {
  return `${formatDateShort(weekStart)} – ${formatDateShort(addDays(weekStart, 6))}`
}
