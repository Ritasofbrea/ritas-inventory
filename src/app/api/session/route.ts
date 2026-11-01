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

// Issues a 'staff' session with no name — the To-Do List button on /login
// is intentionally open to anyone (same as main, pre-patch-29: no PIN, no
// prompt of any kind), so this route doesn't ask for or store a name
// either. It's NOT a security boundary; it only gives the server a role to
// check so staff-tier routes require *some* session instead of nothing at
// all. Sessions last 365 days and renew on every GET /api/session read
// (see above). Who is actually doing a given action (completing a task,
// posting a note, acknowledging one) is still picked fresh at the moment of
// that action via StaffPicker/isActiveStaff, completely unrelated to this
// session — unchanged from main.
export async function POST() {
  if (!sessionSecretConfigured()) {
    return NextResponse.json({ error: 'Login is temporarily unavailable' }, { status: 401 })
  }
  const response = NextResponse.json({ role: 'staff', name: null })
  if (!setSessionCookie(response, 'staff', null)) {
    return NextResponse.json({ error: 'Login is temporarily unavailable' }, { status: 401 })
  }
  return response
}
