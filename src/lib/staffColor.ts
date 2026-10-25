import { Staff, TASK_CREATORS } from './tasks'

// A task/template's created_by ("Added by") stores a short first-name-only
// value from TASK_CREATORS ('Josh' | 'Gina' | 'Valerie') — an older, separate
// identity concept from the staff table's full names ('Josh D.', 'Valerie
// Morrow'). 'Gina' happens to match exactly; these two don't, so they're
// mapped explicitly rather than guessed with fuzzy name matching.
const CREATOR_NAME_ALIASES: Partial<Record<(typeof TASK_CREATORS)[number], string>> = {
  Josh: 'Josh D.',
  Valerie: 'Valerie Morrow',
}

// Looks up the color assigned to a staff name (exact match, or via the alias
// above for a TASK_CREATORS short name) — or null if unassigned/not found,
// meaning "render in the normal default text color."
export function staffColorFor(name: string, staff: Staff[]): string | null {
  const exact = staff.find((s) => s.name === name)
  if (exact) return exact.color
  const alias = CREATOR_NAME_ALIASES[name as (typeof TASK_CREATORS)[number]]
  if (!alias) return null
  return staff.find((s) => s.name === alias)?.color ?? null
}

// Is this a *staff-table* name (e.g. a note's created_by, which is always a
// staff name, never a TASK_CREATORS short one) for one of the two owners?
// Reuses CREATOR_NAME_ALIASES.Josh ('Josh D.') as the single source of truth
// for that identity instead of a second hardcoded string — Gina's staff name
// matches her owners-table name exactly, so no alias is needed for her.
export function isOwnerStaffName(staffName: string): boolean {
  return staffName === 'Gina' || staffName === CREATOR_NAME_ALIASES.Josh
}

// Mixes a hex color toward white for a subtle pastel background tint — e.g.
// a note card tinted by its author's color, not a bold/solid fill. `amount`
// is how much of the way toward white to go (0 = original color, 1 = white).
export function pastelTint(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount)
  const r = mix((n >> 16) & 255)
  const g = mix((n >> 8) & 255)
  const b = mix(n & 255)
  return `rgb(${r}, ${g}, ${b})`
}
