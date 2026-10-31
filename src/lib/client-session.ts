export interface ClientSessionInfo {
  role: 'owner' | 'shift_lead' | 'staff' | null
  name: string | null
}

// Asks the server what session (if any) this device currently has — the
// source of truth for routing decisions in patch 29, instead of trusting
// localStorage alone (see src/app/page.tsx and src/app/login/page.tsx).
export async function fetchSession(): Promise<ClientSessionInfo> {
  try {
    const res = await fetch('/api/session')
    if (!res.ok) return { role: null, name: null }
    return await res.json()
  } catch {
    return { role: null, name: null }
  }
}
