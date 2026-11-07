// Login helpers that get a real `ritas_session` cookie for each role by
// calling the app's own routes over plain fetch -- no browser needed for
// role-checks.mjs / step-checks.mjs (see src/lib/session.ts for what the
// cookie contains and how it's verified).
import { BASE_URL, requiredEnv } from './config.mjs'

function sessionCookieFrom(res) {
  const cookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean)
  const match = cookies.find((c) => c.startsWith('ritas_session='))
  return match ? match.split(';')[0] : null
}

// PINs come from env vars (E2E_OWNER_PIN / E2E_SHIFT_LEAD_PIN) -- set them
// in .env.local to the test PIN you chose for the dedicated ZZTEST Owner /
// ZZTEST Shift Lead accounts (see supabase/e2e-test-accounts.sql and
// ../README.md). Never a real person's PIN, and never hardcoded here.
//
// /api/pins/verify doesn't take a name, only a PIN -- whichever account's
// PIN matches is who you're logged in as. That means a wrong/stale env var
// could just as easily match a REAL owner or shift lead as the ZZTEST one,
// so every login here is checked against who it actually matched: refuse
// outright unless that name starts with "ZZTEST".
async function loginWithPin(roleName) {
  const pin = roleName === 'owner' ? requiredEnv('E2E_OWNER_PIN') : requiredEnv('E2E_SHIFT_LEAD_PIN')
  const res = await fetch(`${BASE_URL}/api/pins/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: roleName, pin }),
  })
  const body = await res.json()
  if (!body.valid) {
    throw new Error(
      `login failed for ${roleName} -- E2E_${roleName.toUpperCase()}_PIN must match the ZZTEST ${
        roleName === 'owner' ? 'Owner' : 'Shift Lead'
      } account's PIN, and that account must have active = true right now. See tests/e2e/README.md and supabase/e2e-test-accounts.sql.`
    )
  }
  if (!body.name || !body.name.startsWith('ZZTEST')) {
    throw new Error(
      `REFUSING TO CONTINUE: E2E_${roleName.toUpperCase()}_PIN matched a REAL account ("${body.name}"), not a ZZTEST one. ` +
        `These scripts must only ever log in as ZZTEST Owner / ZZTEST Shift Lead. Double-check E2E_${roleName.toUpperCase()}_PIN in .env.local -- ` +
        `see supabase/e2e-test-accounts.sql.`
    )
  }
  const cookie = sessionCookieFrom(res)
  if (!cookie) throw new Error(`no session cookie returned for ${roleName}`)
  return { cookie, name: body.name }
}

export const loginAsOwner = () => loginWithPin('owner')
export const loginAsShiftLead = () => loginWithPin('shift_lead')

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
