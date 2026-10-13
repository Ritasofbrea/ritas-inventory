import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'

const OWNER_NAMES = ['Josh', 'Gina']

// Lists every PIN's name + when it was last changed — never the value
// itself. Used by the owner-only Change PIN screen, now three choices
// (Josh, Gina, Shift Lead) instead of one shared Owner PIN.
export async function GET() {
  const db = getServerSupabase()
  const [pinsRes, ownersRes] = await Promise.all([
    db.from('pins').select('name, updated_at').eq('name', 'shift_lead'),
    db.from('owners').select('name, updated_at').in('name', OWNER_NAMES),
  ])
  if (pinsRes.error) return NextResponse.json({ error: pinsRes.error.message }, { status: 500 })
  if (ownersRes.error) return NextResponse.json({ error: ownersRes.error.message }, { status: 500 })
  return NextResponse.json([...ownersRes.data, ...pinsRes.data])
}

// Changes a PIN: requires current_pin to match the stored value first.
// Changing Josh's PIN only ever checks Josh's current PIN, never Gina's
// (and vice versa) — each named owner row is independent in `owners`.
export async function PATCH(request: Request) {
  const { name, current_pin, new_pin } = await request.json()
  if (name !== 'shift_lead' && !OWNER_NAMES.includes(name)) {
    return NextResponse.json({ error: 'name must be "Josh", "Gina", or "shift_lead"' }, { status: 400 })
  }
  if (typeof current_pin !== 'string' || !current_pin) {
    return NextResponse.json({ error: 'Enter the current PIN' }, { status: 400 })
  }
  if (typeof new_pin !== 'string' || !/^\d{4,6}$/.test(new_pin)) {
    return NextResponse.json({ error: 'New PIN must be 4-6 digits' }, { status: 400 })
  }

  const db = getServerSupabase()
  const table = name === 'shift_lead' ? 'pins' : 'owners'
  const column = name === 'shift_lead' ? 'value' : 'pin'

  const { data: row, error: fetchError } = await db.from(table).select(column).eq('name', name).maybeSingle()
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'PIN not found' }, { status: 404 })
  if ((row as Record<string, string>)[column] !== current_pin) {
    return NextResponse.json({ error: 'Current PIN is incorrect' }, { status: 401 })
  }

  const { error: updateError } = await db
    .from(table)
    .update({ [column]: new_pin, updated_at: new Date().toISOString() })
    .eq('name', name)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
