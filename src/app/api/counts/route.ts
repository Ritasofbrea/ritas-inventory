import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') || '200')
  const itemId = searchParams.get('item_id')

  const db = getServerSupabase()
  let query = db
    .from('inventory_counts')
    .select('*, items(name, category, unit)')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (itemId) query = query.eq('item_id', itemId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { counts, entered_by } = body
  // counts: Array<{ item_id: string; count: number }>

  if (!Array.isArray(counts) || counts.length === 0) {
    return NextResponse.json({ error: 'No counts provided' }, { status: 400 })
  }

  const db = getServerSupabase()

  // Insert history records
  const rows = counts.map((c: { item_id: string; count: number }) => ({
    item_id: c.item_id,
    count: c.count,
    entered_by: entered_by || 'shift_lead',
  }))

  const { error: insertError } = await db.from('inventory_counts').insert(rows)
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Update current counts on items
  const updates = counts.map((c: { item_id: string; count: number }) =>
    db.from('items').update({ current_count: c.count }).eq('id', c.item_id)
  )
  await Promise.all(updates)

  return NextResponse.json({ ok: true })
}
