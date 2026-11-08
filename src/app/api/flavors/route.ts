import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { FLAVOR_TYPES, isValidProgram } from '@/lib/flavors'
import { requireRole } from '@/lib/session'

// ?all=true (Flavors Catalog management) returns every flavor including
// inactive ones; default (the weekly planner's picker) is active-only.
export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead', 'staff'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const all = new URL(request.url).searchParams.get('all') === 'true'
  let query = db.from('flavors').select('*').order('name')
  if (!all) query = query.eq('active', true)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Owner-only, server-enforced (requireRole below -- the comment this
// replaced claimed otherwise; that was stale, the role check was already
// here). type is required (patch 26) — the same name can exist under more
// than one type (e.g. "Cherry" as both italian_ice and sugar_free are
// distinct real items), so the uniqueness check is on (name, type)
// together. program (patch 40) is optional -- omitted or null leaves the
// new flavor untagged, same as today.
export async function POST(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { name, type, program } = await request.json()
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  }
  if (!FLAVOR_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Pick a type' }, { status: 400 })
  }
  if (program !== undefined && program !== null && !isValidProgram(program)) {
    return NextResponse.json({ error: 'Invalid program value' }, { status: 400 })
  }
  const insertData: { name: string; type: string; program?: string } = { name: name.trim(), type }
  if (program) insertData.program = program
  const { data, error } = await db.from('flavors').insert(insertData).select().single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'That flavor is already in the catalog' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

// active and program (patch 40) are each optional on their own -- a caller
// sends whichever it means to change (the catalog's Deactivate/Reactivate
// button sends only active; its new per-row Program selector sends only
// program), and the other field is left untouched. At least one of the two
// must be present.
export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json()
  const { id } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const update: { active?: boolean; program?: string | null } = {}
  if ('active' in body) {
    if (typeof body.active !== 'boolean') return NextResponse.json({ error: 'active must be a boolean' }, { status: 400 })
    update.active = body.active
  }
  if ('program' in body) {
    if (body.program !== null && !isValidProgram(body.program)) {
      return NextResponse.json({ error: 'Invalid program value' }, { status: 400 })
    }
    update.program = body.program
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await db.from('flavors').update(update).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// True hard delete, separate from deactivate, no precondition — a flavor's
// name already lives on in any week's slot that used it as a snapshot
// (flavor_week_slots.flavor_name), so removing it from the catalog can't
// break a past week's display (flavor_id on that slot just goes null, via
// the FK's on delete set null).
export async function DELETE(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const { error } = await db.from('flavors').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
