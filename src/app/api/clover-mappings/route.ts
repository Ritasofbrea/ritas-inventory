import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  const { clover_item_id, inventory_item_id, quantity } = await request.json()
  if (!clover_item_id || !inventory_item_id || !quantity) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  const db = getServerSupabase()
  const { data, error } = await db
    .from('clover_item_mappings')
    .insert({ clover_item_id, inventory_item_id, quantity: parseFloat(quantity) })
    .select('id, clover_item_id, inventory_item_id, quantity')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest) {
  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const db = getServerSupabase()
  const { error } = await db.from('clover_item_mappings').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
