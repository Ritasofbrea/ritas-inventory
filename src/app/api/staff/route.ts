import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const all = new URL(request.url).searchParams.get('all') === 'true'
  const db = getServerSupabase()
  let query = db.from('staff').select('*').order('name')
  if (!all) query = query.eq('active', true)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const { name } = await request.json()
  if (typeof name !== 'string' || !name.trim()) {
    return NextResponse.json({ error: 'Missing name' }, { status: 400 })
  }
  const db = getServerSupabase()
  const { data, error } = await db.from('staff').insert({ name: name.trim() }).select().single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'That name is already on the list' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest) {
  const { id, name, active } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const updates: Record<string, string | boolean> = {}
  if (typeof name === 'string' && name.trim()) updates.name = name.trim()
  if (typeof active === 'boolean') updates.active = active
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const db = getServerSupabase()
  const { data, error } = await db.from('staff').update(updates).eq('id', id).select().single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'That name is already on the list' }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}
