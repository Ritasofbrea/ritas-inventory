import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'

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
// this app.
export async function POST(request: NextRequest) {
  const { name } = await request.json()
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  }
  const db = getServerSupabase()
  const { data, error } = await db.from('flavors').insert({ name: name.trim() }).select().single()
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
