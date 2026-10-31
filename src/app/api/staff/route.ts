import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'

// ?all=true (Staff management screen) is owner-only. The plain active-only
// list stays PUBLIC on purpose (patch 29) — it's the list the login page's
// one-time name picker shows BEFORE any session exists, to establish the
// first staff session (see /api/session POST); gating it would make that
// picker un-bootstrappable. It's also just names, nothing sensitive, and
// was fully open before this patch too.
export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const all = new URL(request.url).searchParams.get('all') === 'true'
  if (all) {
    const auth = await requireRole(db, request, ['owner'])
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  }
  let query = db.from('staff').select('*').order('name')
  if (!all) query = query.eq('active', true)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { name } = await request.json()
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  }
  const { data, error } = await db.from('staff').insert({ name: name.trim() }).select().single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'That name is already on the list' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { id, name, active, color } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const updates: Record<string, string | boolean | null> = {}
  if (typeof name === 'string' && name.trim()) updates.name = name.trim()
  if (typeof active === 'boolean') updates.active = active
  if (color !== undefined) {
    if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(color)) {
      return NextResponse.json({ error: 'color must be a hex value like #2563eb, or null to clear it' }, { status: 400 })
    }
    updates.color = color
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const { data, error } = await db.from('staff').update(updates).eq('id', id).select().single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'That name is already on the list' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}
