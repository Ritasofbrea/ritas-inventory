import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'

const DRAFT_EXPIRY_MS = 4 * 60 * 60 * 1000

export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { data, error } = await db
    .from('count_draft')
    .select('*')
    .eq('id', 'current')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json(null)

  if (Date.now() - new Date(data.updated_at).getTime() > DRAFT_EXPIRY_MS) {
    await db.from('count_draft').delete().eq('id', 'current')
    return NextResponse.json(null)
  }

  return NextResponse.json(data)
}

export async function PUT(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json()
  const { counts, secondary_counts, counted_by, is_test_count } = body

  const { data, error } = await db
    .from('count_draft')
    .upsert({
      id: 'current',
      counts: counts ?? {},
      secondary_counts: secondary_counts ?? {},
      counted_by: counted_by ?? '',
      is_test_count: is_test_count ?? false,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { error } = await db.from('count_draft').delete().eq('id', 'current')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
