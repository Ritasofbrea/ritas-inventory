import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { getSession, setSessionCookie, sessionSecretConfigured } from '@/lib/session'

// GET: tells the client what session (if any) it currently has, so the root
// page and /login can decide where to send a returning device without
// relying on localStorage (which patch 29 no longer trusts for that
// decision — see src/app/page.tsx and src/app/login/page.tsx).
//
// Also where staff sessions renew (B2: "renew themselves whenever the
// device is used") — every page that checks its session this way pushes a
// staff cookie's expiry another 365 days out, so normal daily use never
// lets it approach expiry. Owner/shift_lead sessions are NOT renewed here —
// they stay a flat 30 days per B2, by design (periodic re-PIN).
export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const result = await getSession(db, request)
  if (!result.ok) return NextResponse.json({ role: null, name: null })
  const response = NextResponse.json({ role: result.session.role, name: result.session.name })
  if (result.session.role === 'staff') {
    setSessionCookie(response, 'staff', result.session.name)
  }
  return response
}

// Issues a 'staff' session after a staff member picks their own name from
// the active staff list — this is NOT a security boundary (staff have no
// PIN and this route doesn't ask for one); it only gives the server a role
// to check so staff-tier routes can require *some* session instead of
// nothing at all. Sessions last 365 days and are meant to be invisible after
// the first pick — see requireRole's revocation check (still active=true
// required) and the auto-renew in middleware-less form at GET /api/session
// callers, which re-sets the cookie whenever it's read on a page load.
export async function POST(request: NextRequest) {
  const { name } = await request.json()
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Pick your name from the list' }, { status: 400 })
  }
  if (!sessionSecretConfigured()) {
    return NextResponse.json({ error: 'Login is temporarily unavailable' }, { status: 401 })
  }
  const db = getServerSupabase()
  const { data } = await db.from('staff').select('name').eq('name', name.trim()).eq('active', true).maybeSingle()
  if (!data) return NextResponse.json({ error: 'Pick your name from the list' }, { status: 400 })

  const response = NextResponse.json({ role: 'staff', name: data.name })
  if (!setSessionCookie(response, 'staff', data.name)) {
    return NextResponse.json({ error: 'Login is temporarily unavailable' }, { status: 401 })
  }
  return response
}
