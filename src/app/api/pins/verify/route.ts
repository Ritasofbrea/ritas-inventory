import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'

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
export async function POST(request: Request) {
  const { name, pin } = await request.json()
  if (name !== 'owner' && name !== 'shift_lead') {
    return NextResponse.json({ error: 'name must be "owner" or "shift_lead"' }, { status: 400 })
  }
  if (typeof pin !== 'string' || !pin) {
    return NextResponse.json({ valid: false })
  }
  const db = getServerSupabase()
  const table = name === 'owner' ? 'owners' : 'shift_leads'
  const { data, error } = await db.from(table).select('name').eq('pin', pin).eq('active', true).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ valid: !!data, name: data?.name ?? null })
}
