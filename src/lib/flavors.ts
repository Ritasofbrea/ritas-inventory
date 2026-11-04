// Shared types + week-math helpers for the Flavors planning tab (patch 20),
// its flavor types (patch 26), and its sections (patch 32).

import { addDays, formatDateShort, weekdayMonday } from './tasks'

export type FlavorType = 'italian_ice' | 'cream_ice' | 'sugar_free' | 'soft_serve' | 'hs_custard'

export const FLAVOR_TYPES: FlavorType[] = ['italian_ice', 'cream_ice', 'sugar_free', 'soft_serve', 'hs_custard']

export const FLAVOR_TYPE_LABELS: Record<FlavorType, string> = {
  italian_ice: 'Italian Ice',
  cream_ice: 'Cream Ice',
  sugar_free: 'Sugar Free',
  soft_serve: 'Soft Serve',
  hs_custard: 'Hand Scoop Custard',
}

// Short form for a slot/row badge — "so at a glance across all the slots
// you can see the mix without hovering or clicking each one."
export const FLAVOR_TYPE_BADGE: Record<FlavorType, string> = {
  italian_ice: 'Ice',
  cream_ice: 'Cream',
  sugar_free: 'SF',
  soft_serve: 'SS',
  hs_custard: 'HS',
}

export const FLAVOR_TYPE_BADGE_CLASS: Record<FlavorType, string> = {
  italian_ice: 'bg-blue-100 text-blue-700',
  cream_ice: 'bg-amber-100 text-amber-800',
  sugar_free: 'bg-purple-100 text-purple-700',
  soft_serve: 'bg-pink-100 text-pink-700',
  hs_custard: 'bg-teal-100 text-teal-700',
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

// Patch 32: one shared definition per weekly-planner section — its slot
// number range, which flavor types its picker and the server's save
// validation allow, and how many of those slots are actually shown today.
// The ranges are deliberately spaced out (1-12, 101-199, 201-299 "lanes")
// so growing one section's count later never has to renumber another
// section's slots or touch any week's already-saved rows — see
// supabase/add-flavor-sections.sql for the matching DB CHECK constraint,
// which allows a wider range (101-110, 201-220) than slotCount uses today.
export type FlavorSectionKey = 'ice' | 'soft_serve' | 'hs_custard'

export interface FlavorSection {
  key: FlavorSectionKey
  label: string
  slotStart: number
  slotCount: number
  types: FlavorType[]
  // Informational only — never stored, never a slot. Shown once above the
  // section (patch 32: soft serve's three always-on, never-planned flavors).
  alwaysOnNote?: string
}

export const FLAVOR_SECTIONS: FlavorSection[] = [
  { key: 'ice', label: 'Ice', slotStart: 1, slotCount: 12, types: ['italian_ice', 'cream_ice', 'sugar_free'] },
  {
    key: 'soft_serve',
    label: 'Soft Serve',
    slotStart: 101,
    slotCount: 3,
    types: ['soft_serve'],
    alwaysOnNote: 'Always on: Vanilla, Chocolate, Twist',
  },
  { key: 'hs_custard', label: 'Hand Scoop Custard', slotStart: 201, slotCount: 12, types: ['hs_custard'] },
]

// Which section a slot number belongs to, or undefined if it's outside all
// three current ranges — the single check both the planner UI and the save
// route use, so a number like 13 or 300 is rejected the same way everywhere.
export function sectionForSlot(slotNumber: number): FlavorSection | undefined {
  return FLAVOR_SECTIONS.find((s) => slotNumber >= s.slotStart && slotNumber < s.slotStart + s.slotCount)
}

export function slotNumbersForSection(section: FlavorSection): number[] {
  return Array.from({ length: section.slotCount }, (_, i) => section.slotStart + i)
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
