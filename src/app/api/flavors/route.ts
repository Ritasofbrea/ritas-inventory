import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { FLAVOR_TYPES } from '@/lib/flavors'

// ?all=true (Flavors Catalog management) returns every flavor including
// inactive ones; default (the weekly planner's picker) is active-only.
export async function GET(request: NextRequest) {
  const all = new URL(request.url).searchParams.get('all') === 'true'
  const db = getServerSupabase()
  let query = db.from('flavors').select('*').order('name')
  if (!all) query = query.eq('active', true)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Owner-only in the UI (Flavors Catalog is gated client-side like Staff/Shift
// Leads), not enforced server-side — same trust model as everywhere else in
// this app. type is required (patch 26) — the same name can exist under more
// than one type (e.g. "Cherry" as both italian_ice and sugar_free are
// distinct real items), so the uniqueness check is on (name, type) together.
export async function POST(request: NextRequest) {
  const { name, type } = await request.json()
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  }
  if (!FLAVOR_TYPES.includes(type)) {
    return NextResponse.json({ error: 'Pick a type' }, { status: 400 })
  }
  const db = getServerSupabase()
  const { data, error } = await db.from('flavors').insert({ name: name.trim(), type }).select().single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'That flavor is already in the catalog' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest) {
  const { id, active } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  if (typeof active !== 'boolean') return NextResponse.json({ error: 'active must be a boolean' }, { status: 400 })
  const db = getServerSupabase()
  const { data, error } = await db.from('flavors').update({ active }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// True hard delete, separate from deactivate, no precondition — a flavor's
// name already lives on in any week's slot that used it as a snapshot
// (flavor_week_slots.flavor_name), so removing it from the catalog can't
// break a past week's display (flavor_id on that slot just goes null, via
// the FK's on delete set null).
export async function DELETE(request: NextRequest) {
  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const db = getServerSupabase()
  const { error } = await db.from('flavors').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
