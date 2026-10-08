import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'

// Checks a PIN against the stored value server-side — returns only whether it
// matched, never the value itself. Replaces the old client-side comparison
// against NEXT_PUBLIC_OWNER_PIN / NEXT_PUBLIC_SHIFT_LEAD_PIN.
export async function POST(request: Request) {
  const { name, pin } = await request.json()
  if (name !== 'owner' && name !== 'shift_lead') {
    return NextResponse.json({ error: 'name must be "owner" or "shift_lead"' }, { status: 400 })
  }
  if (typeof pin !== 'string' || !pin) {
    return NextResponse.json({ valid: false })
  }
  const db = getServerSupabase()
  const { data, error } = await db.from('pins').select('value').eq('name', name).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ valid: !!data && data.value === pin })
}
