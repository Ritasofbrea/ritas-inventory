import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { setSessionCookie, sessionSecretConfigured } from '@/lib/session'
import { clientIp, isRateLimited, recordLoginAttempt } from '@/lib/rate-limit'

// Checks a PIN against the stored value server-side — returns only whether it
// matched, never the value itself. Replaces the old client-side comparison
// against NEXT_PUBLIC_OWNER_PIN / NEXT_PUBLIC_SHIFT_LEAD_PIN.
//
// Neither `name: 'owner'` nor `name: 'shift_lead'` means one shared PIN
// anymore — each matches against its respective table of named, individual
// PINs (owners / shift_leads), equal access within each role either way. The
// caller doesn't pick who up front; whichever PIN matches identifies them,
// so a matched `name` comes back in the response for the login screen to
// remember who's in.
//
// Patch 29: on a match, also sets the real ritas_session cookie (the client
// still calls setRole() itself for its own UI-gating localStorage copy —
// unchanged). Fails closed if SESSION_SECRET isn't configured. Also rate
// limited (B9): 10 failures from the same IP in 15 minutes blocks further
// attempts with 429, without even checking the PIN — a few honest typos
// won't trip it, a guessing script will.
export async function POST(request: NextRequest) {
  const { name, pin } = await request.json()
  if (name !== 'owner' && name !== 'shift_lead') {
    return NextResponse.json({ error: 'name must be "owner" or "shift_lead"' }, { status: 400 })
  }
  if (typeof pin !== 'string' || !pin) {
    return NextResponse.json({ valid: false })
  }
  if (!sessionSecretConfigured()) {
    return NextResponse.json({ error: 'Login is temporarily unavailable' }, { status: 401 })
  }

  const db = getServerSupabase()
  const ip = clientIp(request)
  if (await isRateLimited(db, ip)) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 })
  }

  const table = name === 'owner' ? 'owners' : 'shift_leads'
  const { data, error } = await db.from(table).select('name').eq('pin', pin).eq('active', true).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await recordLoginAttempt(db, ip, !!data)
  if (!data) return NextResponse.json({ valid: false })

  const response = NextResponse.json({ valid: true, name: data.name })
  if (!setSessionCookie(response, name, data.name)) {
    return NextResponse.json({ error: 'Login is temporarily unavailable' }, { status: 401 })
  }
  return response
}
