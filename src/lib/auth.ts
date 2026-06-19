import { Role } from './types'

const ROLE_KEY = 'ritas_role'

export function getRole(): Role | null {
  if (typeof window === 'undefined') return null
  return (localStorage.getItem(ROLE_KEY) as Role) || null
}

export function setRole(role: Role) {
  localStorage.setItem(ROLE_KEY, role)
}

export function clearRole() {
  localStorage.removeItem(ROLE_KEY)
}

export function isOwner(): boolean {
  return getRole() === 'owner'
}
