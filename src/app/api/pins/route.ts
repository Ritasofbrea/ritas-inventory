import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'

const OWNER_NAMES = ['Josh', 'Gina']

// Lists every PIN's name + when it was last changed — never the value
// itself. Used by the Change PIN screen: an owner can change Josh's or
// Gina's PIN, a shift lead can change their own — both via the same
// self-service flow (current PIN required first).
export async function GET() {
  const db = getServerSupabase()
  const [ownersRes, shiftLeadsRes] = await Promise.all([
    db.from('owners').select('name, updated_at').in('name', OWNER_NAMES),
    db.from('shift_leads').select('name, updated_at').eq('active', true).order('name'),
  ])
  if (ownersRes.error) return NextResponse.json({ error: ownersRes.error.message }, { status: 500 })
  if (shiftLeadsRes.error) return NextResponse.json({ error: shiftLeadsRes.error.message }, { status: 500 })
  return NextResponse.json([...ownersRes.data, ...shiftLeadsRes.data])
}

// Changes a PIN: requires current_pin to match the stored value first.
// Changing one person's PIN only ever checks their own current PIN, never
// anyone else's — owners and shift leads are each independent rows, in
// `owners` and `shift_leads` respectively (both use a `pin` column, so no
// column-name branching is needed here, unlike the old owners/pins split).
export async function PATCH(request: Request) {
  const { name, current_pin, new_pin } = await request.json()
  if (typeof name !== 'string' || !name) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  }
  if (typeof current_pin !== 'string' || !current_pin) {
    return NextResponse.json({ error: 'Enter the current PIN' }, { status: 400 })
  }
  if (typeof new_pin !== 'string' || !/^\d{4,6}$/.test(new_pin)) {
    return NextResponse.json({ error: 'New PIN must be 4-6 digits' }, { status: 400 })
  }

  const db = getServerSupabase()
  const table = OWNER_NAMES.includes(name) ? 'owners' : 'shift_leads'

  const { data: row, error: fetchError } = await db.from(table).select('pin').eq('name', name).maybeSingle()
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'PIN not found' }, { status: 404 })
  if (row.pin !== current_pin) {
    return NextResponse.json({ error: 'Current PIN is incorrect' }, { status: 401 })
  }

  const { error: updateError } = await db
    .from(table)
    .update({ pin: new_pin, updated_at: new Date().toISOString() })
    .eq('name', name)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
