import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'

const PIN_RE = /^\d{4,6}$/

// Owner-only management screen's list — deliberately never selects `pin`.
export async function GET() {
  const db = getServerSupabase()
  const { data, error } = await db.from('shift_leads').select('id, name, active, created_at, updated_at').order('name')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const { name, pin } = await request.json()
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  }
  if (typeof pin !== 'string' || !PIN_RE.test(pin)) {
    return NextResponse.json({ error: 'PIN must be 4-6 digits' }, { status: 400 })
  }
  const db = getServerSupabase()
  const { data, error } = await db
    .from('shift_leads')
    .insert({ name: name.trim(), pin })
    .select('id, name, active, created_at, updated_at')
    .single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'That name is already on the list' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

// `active`: soft-delete toggle, same pattern as staff/templates (never hard
// delete). `pin`: the owner-driven reset — no current-pin check, unlike the
// self-service /api/pins PATCH, since reaching this at all already requires
// being logged in as owner (ShiftLeadView is an owner-only tab).
export async function PATCH(request: NextRequest) {
  const { id, active, pin } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const updates: Record<string, string | boolean> = {}
  if (typeof active === 'boolean') updates.active = active
  if (pin !== undefined) {
    if (typeof pin !== 'string' || !PIN_RE.test(pin)) {
      return NextResponse.json({ error: 'PIN must be 4-6 digits' }, { status: 400 })
    }
    updates.pin = pin
    updates.updated_at = new Date().toISOString()
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const db = getServerSupabase()
  const { data, error } = await db
    .from('shift_leads')
    .update(updates)
    .eq('id', id)
    .select('id, name, active, created_at, updated_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Permanent delete — only allowed once already inactive, so someone still
// actively using their login can't be deleted out from under them; they'd
// have to be deactivated first (which already blocks login on its own).
// Unlike deactivate, there's no undo once this runs.
export async function DELETE(request: NextRequest) {
  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const db = getServerSupabase()
  const { data: row, error: fetchError } = await db.from('shift_leads').select('active').eq('id', id).maybeSingle()
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'Shift lead not found' }, { status: 404 })
  if (row.active) return NextResponse.json({ error: 'Deactivate before deleting' }, { status: 400 })
  const { error } = await db.from('shift_leads').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
