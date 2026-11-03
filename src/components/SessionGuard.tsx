'use client'

import { useEffect } from 'react'
import { clearRole } from '@/lib/auth'

export const LOGIN_MESSAGE_KEY = 'ritas_login_message'

// Set by a deliberate Home/Switch tap (Navigation.tsx) right before it
// navigates to /login. If POST /api/logout failed or timed out, the cookie
// may still be a valid staff session when /login's own check runs a moment
// later — and /login auto-skips any valid staff session straight back to
// /todo (intentional for a *returning* device, see login/page.tsx), which
// would make a deliberate Home tap look like it does nothing, same symptom
// as the original bug but from a genuine network failure instead of a race.
// This flag tells /login to skip that one check this one time, so a
// deliberate exit always reaches the three buttons regardless of whether
// the server-side cookie actually got cleared.
export const SKIP_LOGIN_AUTOSKIP_KEY = 'ritas_skip_login_autoskip'

let patched = false

// Patch 29 B8: wraps window.fetch once, globally, so ANY 401 response from
// anywhere in the app — not just this component — is treated as "your
// session is no longer valid": clears the local role/name cache and sends
// the device to /login with a short message. A full navigation (not a
// router.push) so every page's timers/intervals are torn down with it —
// that's what stops an auto-refresh loop from repeatedly hitting 401.
// Excludes /login itself so a pre-session 401 there (e.g. SESSION_SECRET
// briefly unavailable) doesn't bounce the page it's already on.
export default function SessionGuard() {
  useEffect(() => {
    if (patched) return
    patched = true
    const originalFetch = window.fetch.bind(window)
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const response = await originalFetch(...args)
      if (response.status === 401 && !window.location.pathname.startsWith('/login')) {
        clearRole()
        try {
          sessionStorage.setItem(LOGIN_MESSAGE_KEY, 'Please log in again.')
        } catch {
          // ignore — private browsing / storage blocked
        }
        window.location.href = '/login'
      }
      return response
    }
  }, [])
  return null
}
