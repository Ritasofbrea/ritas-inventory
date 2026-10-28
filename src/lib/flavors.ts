// Shared types + week-math helpers for the Flavors planning tab (patch 20)
// and its flavor types (patch 26).

import { addDays, formatDateShort, weekdayMonday } from './tasks'

export const FLAVOR_SLOT_COUNT = 12

export type FlavorType = 'italian_ice' | 'cream_ice' | 'sugar_free'

export const FLAVOR_TYPES: FlavorType[] = ['italian_ice', 'cream_ice', 'sugar_free']

export const FLAVOR_TYPE_LABELS: Record<FlavorType, string> = {
  italian_ice: 'Italian Ice',
  cream_ice: 'Cream Ice',
  sugar_free: 'Sugar Free',
}

// Short form for a slot/row badge — "so at a glance across all 12 slots
// you can see the mix without hovering or clicking each one."
export const FLAVOR_TYPE_BADGE: Record<FlavorType, string> = {
  italian_ice: 'Ice',
  cream_ice: 'Cream',
  sugar_free: 'SF',
}

export const FLAVOR_TYPE_BADGE_CLASS: Record<FlavorType, string> = {
  italian_ice: 'bg-blue-100 text-blue-700',
  cream_ice: 'bg-amber-100 text-amber-800',
  sugar_free: 'bg-purple-100 text-purple-700',
}

export interface Flavor {
  id: string
  name: string
  type: FlavorType
  active: boolean
  created_at: string
}

// Same (name, type) catalog can hold two distinct real items — e.g. "Cherry"
// exists as both an italian_ice and a sugar_free flavor — so flavors are no
// longer unique by name alone (see supabase/add-flavor-type-fixes.sql).
export function groupFlavorsByType<T extends { type: FlavorType }>(flavors: T[]): { type: FlavorType; flavors: T[] }[] {
  return FLAVOR_TYPES.map((type) => ({ type, flavors: flavors.filter((f) => f.type === type) })).filter(
    (g) => g.flavors.length > 0
  )
}

// A filled slot only — an empty one simply has no entry for its slot_number
// (see supabase/add-flavors.sql). flavor_type is a snapshot taken at pick
// time, same reasoning as flavor_name (patch 20): it has to survive the
// catalog entry being deleted later, so it can't just be a live join.
// Older slots picked before patch 26 may have a null flavor_type until
// backfilled (see add-flavor-type-fixes.sql) — treat that as "no badge,"
// never an error.
export interface FlavorWeekSlot {
  slot_number: number
  flavor_id: string | null
  flavor_name: string
  flavor_type: FlavorType | null
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
