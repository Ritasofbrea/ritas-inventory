import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'

// Lists the two PIN rows' names + when they were last changed — never the
// value itself. Used by the owner-only Change PIN screen.
export async function GET() {
  const db = getServerSupabase()
  const { data, error } = await db.from('pins').select('name, updated_at').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Changes a PIN: requires current_pin to match the stored value first.
export async function PATCH(request: Request) {
  const { name, current_pin, new_pin } = await request.json()
  if (name !== 'owner' && name !== 'shift_lead') {
    return NextResponse.json({ error: 'name must be "owner" or "shift_lead"' }, { status: 400 })
  }
  if (typeof current_pin !== 'string' || !current_pin) {
    return NextResponse.json({ error: 'Enter the current PIN' }, { status: 400 })
  }
  if (typeof new_pin !== 'string' || !/^\d{4,6}$/.test(new_pin)) {
    return NextResponse.json({ error: 'New PIN must be 4-6 digits' }, { status: 400 })
  }

  const db = getServerSupabase()
  const { data: row, error: fetchError } = await db.from('pins').select('value').eq('name', name).maybeSingle()
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'PIN not found' }, { status: 404 })
  if (row.value !== current_pin) return NextResponse.json({ error: 'Current PIN is incorrect' }, { status: 401 })

  const { error: updateError } = await db
    .from('pins')
    .update({ value: new_pin, updated_at: new Date().toISOString() })
    .eq('name', name)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
