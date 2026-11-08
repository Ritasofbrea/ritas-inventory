// Session helpers for the e2e scripts. loginAsStaff still goes through the
// real /api/session route (staff sessions name no one, so there's nothing
// to "fake" -- same as tapping "To-Do List" on /login). loginAsOwner/
// loginAsShiftLead used to call /api/pins/verify with a test PIN; they now
// mint a real, production-signed session token directly via
// src/lib/session-token.ts (the exact function the app itself uses to sign
// every cookie -- no reimplementation, no drift risk) and build the cookie
// header by hand, with zero HTTP round trip and no PIN involved at all.
//
// This only works against localhost: it reads SESSION_SECRET from
// process.env (via `node --env-file=.env.local`, same as every other
// secret in tests/e2e/) and never prints it. The two names below are
// hardcoded literals, not parameters -- this file can only ever mint a
// session for ZZTEST Owner or ZZTEST Shift Lead, never an arbitrary name,
// so there's no way to accidentally point it at a real account the way a
// stale/wrong PIN env var once could.
import { createSessionToken } from '../../../src/lib/session-token.ts'
import { BASE_URL } from './config.mjs'

function mint(role, name) {
  const created = createSessionToken(role, name)
  if (!created) {
    throw new Error(
      'createSessionToken returned null -- SESSION_SECRET is missing from .env.local (or empty). ' +
        'Run with `node --env-file=.env.local`, same as every other e2e script.'
    )
  }
  return { cookie: `ritas_session=${created.token}`, name }
}

export const loginAsOwner = () => mint('owner', 'ZZTEST Owner')
export const loginAsShiftLead = () => mint('shift_lead', 'ZZTEST Shift Lead')

function sessionCookieFrom(res) {
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean)
  const match = cookies.find((c) => c.startsWith('ritas_session='))
  return match ? match.split(';')[0] : null
}

// Staff session: no PIN, same as tapping "To-Do List" on /login.
export async function loginAsStaff() {
  const res = await fetch(`${BASE_URL}/api/session`, { method: 'POST' })
  const cookie = sessionCookieFrom(res)
  if (!cookie) throw new Error('no session cookie returned for staff')
  return { cookie }
}

// Calls an API route with an optional session cookie. Pass `cookie: null`
// for the no-session case.
export async function apiFetch(path, cookie, opts = {}) {
  return fetch(`${BASE_URL}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {}),
    },
  })
}
