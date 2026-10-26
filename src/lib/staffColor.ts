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

// Loose match between a short/login name (an owner's or shift lead's, e.g.
// "Melek") and a staff-table full name (e.g. "Melek Hernandez") — the same
// identity-space gap CREATOR_NAME_ALIASES solves for the two owners, but
// shift leads are added dynamically via an in-app screen with no fixed list
// to hand-alias, so this matches on an exact name or the staff name's
// leading word instead. Best-effort: a shift lead whose login name shares
// neither form with their staff entry won't be recognized.
export function namesLikelyMatch(shortOrFullName: string, staffFullName: string): boolean {
  const a = shortOrFullName.trim().toLowerCase()
  const b = staffFullName.trim().toLowerCase()
  return a === b || b.startsWith(`${a} `)
}

// How many people are actually required to acknowledge an ack-required note
// (patch 16): every active staff name plus every active shift lead
// (deduped by staff-table identity via namesLikelyMatch, falling back to
// the shift lead's own name if they have no matching staff entry), minus
// owners (never required), minus the note's author if — and only if — the
// author is a shift lead (exempt from their own note; a regular staffer
// still counts on their own note). Pure/shared so the client (NotesBoard,
// for display) and the server (acknowledgments route, for auto-archive —
// see notes-server.ts) can never compute a different number for the same
// note.
export function computeAckDenominator(staffNames: string[], shiftLeadNames: string[], authorName: string): number {
  const denom = new Set<string>()
  staffNames.forEach((name) => {
    if (!isOwnerStaffName(name)) denom.add(name)
  })
  shiftLeadNames.forEach((slName) => {
    const matchedStaff = staffNames.find((s) => namesLikelyMatch(slName, s))
    const canonicalName = matchedStaff ?? slName
    if (!isOwnerStaffName(canonicalName)) denom.add(canonicalName)
  })
  const authorIsShiftLead = shiftLeadNames.some((sl) => namesLikelyMatch(sl, authorName))
  if (authorIsShiftLead) denom.delete(authorName)
  return denom.size
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
