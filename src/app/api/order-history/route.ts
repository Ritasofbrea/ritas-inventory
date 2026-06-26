import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'

export async function GET() {
  const db = getServerSupabase()
  const { data, error } = await db
    .from('order_history')
    .select('*, order_history_items(*)')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { type, notes, items } = body
  // items: [{ item_id, item_name, quantity, unit }]

  if (!type || !Array.isArray(items) || items.length === 0)
    return NextResponse.json({ error: 'Missing type or items' }, { status: 400 })

  const db = getServerSupabase()

  // Create the order record
  const { data: order, error: orderError } = await db
    .from('order_history')
    .insert({ type, notes: notes || '' })
    .select()
    .single()

  if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 })

  // Insert line items
  const rows = items.map((i: { item_id: string; item_name: string; quantity: number; unit: string }) => ({
    order_id: order.id,
    item_id: i.item_id,
    item_name: i.item_name,
    quantity: i.quantity,
    unit: i.unit,
  }))

  const { error: itemsError } = await db.from('order_history_items').insert(rows)
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })

  // If receiving stock, add quantities to current_count
  if (type === 'received' || type === 'will_call') {
    await Promise.all(
      items
        .filter((i: { item_id: string; quantity: number }) => i.item_id && i.quantity > 0)
        .map(async (i: { item_id: string; quantity: number }) => {
          // Get current count first
          const { data: item } = await db
            .from('items')
            .select('current_count')
            .eq('id', i.item_id)
            .single()
          if (item) {
            await db
              .from('items')
              .update({ current_count: Number(item.current_count) + Number(i.quantity) })
              .eq('id', i.item_id)
          }
        })
    )
  }

  return NextResponse.json({ ...order, order_history_items: rows })
}
