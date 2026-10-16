import { Role } from './types'

const ROLE_KEY = 'ritas_role'
const OWNER_NAME_KEY = 'ritas_owner_name'
const SHIFT_LEAD_NAME_KEY = 'ritas_shift_lead_name'

export function getRole(): Role | null {
  if (typeof window === 'undefined') return null
  return (localStorage.getItem(ROLE_KEY) as Role) || null
}

export function setRole(role: Role) {
  localStorage.setItem(ROLE_KEY, role)
}

// Role stays just 'owner' | 'shift_lead' — within each, everyone has
// identical access, so nothing that only checks "is this an owner" (or
// "is this a shift lead") needs to change. Which specific person it is
// lives separately, only for auto-filling identity fields.
export function clearRole() {
  localStorage.removeItem(ROLE_KEY)
  clearOwnerName()
  clearShiftLeadName()
}

export function isOwner(): boolean {
  return getRole() === 'owner'
}

// Set only when the 'owner' PIN check matched a specific named owner (Josh
// or Gina) at /login — never by the anonymous To-Do "+ Add Task" PIN unlock,
// which stays identity-less (role is never set there either).
export function getOwnerName(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(OWNER_NAME_KEY)
}

export function setOwnerName(name: string) {
  localStorage.setItem(OWNER_NAME_KEY, name)
}

export function clearOwnerName() {
  localStorage.removeItem(OWNER_NAME_KEY)
}

// Same idea as getOwnerName/setOwnerName, for the 'shift_lead' PIN check
// matching a specific named shift lead at /login.
export function getShiftLeadName(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(SHIFT_LEAD_NAME_KEY)
}

export function setShiftLeadName(name: string) {
  localStorage.setItem(SHIFT_LEAD_NAME_KEY, name)
}

export function clearShiftLeadName() {
  localStorage.removeItem(SHIFT_LEAD_NAME_KEY)
}
