import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { applyStorageChange } from '@/lib/storage-server'

export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type') // optional filter
  const unresolvedOnly = searchParams.get('unresolved') === 'true'

  let query = db
    .from('order_history')
    .select('*, order_history_items(*)')
    .order('created_at', { ascending: false })
    .limit(50)

  if (type) query = query.eq('type', type)
  if (unresolvedOnly) query = query.eq('resolved', false)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json()
  const { type, notes, items, related_order_id, resolved, received_by } = body

  if (!type || !Array.isArray(items) || items.length === 0)
    return NextResponse.json({ error: 'Missing type or items' }, { status: 400 })

  const { data: order, error: orderError } = await db
    .from('order_history')
    .insert({
      type,
      notes: notes || '',
      related_order_id: related_order_id || null,
      resolved: resolved !== undefined ? resolved : true,
      received_by: received_by || null,
    })
    .select()
    .single()

  if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 })

  const rows = items.map((i: { item_id: string; item_name: string; quantity: number; unit: string }) => ({
    order_id: order.id,
    item_id: i.item_id,
    item_name: i.item_name,
    quantity: i.quantity,
    unit: i.unit,
  }))

  const { error: itemsError } = await db.from('order_history_items').insert(rows)
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })

  // Add quantities to current_count when receiving stock -- patch 38: for a
  // has_storage item, an OWNER session can instead route a line's quantity
  // to storage (destination: 'storage'). Anyone else, or no destination, or
  // an item without has_storage, behaves exactly as before: straight into
  // current_count. The has_storage check is re-verified server-side from
  // the DB, never trusted from the request body.
  if (type === 'received' || type === 'will_call') {
    const isOwner = auth.session.role === 'owner'
    await Promise.all(
      items
        .filter((i: { item_id: string; quantity: number }) => i.item_id && i.quantity > 0)
        .map(async (i: { item_id: string; quantity: number; destination?: string }) => {
          if (isOwner && i.destination === 'storage') {
            const { data: storageItem } = await db.from('items').select('has_storage').eq('id', i.item_id).maybeSingle()
            if (storageItem?.has_storage) {
              await applyStorageChange(db, {
                itemId: i.item_id,
                kind: 'receive_to_storage',
                amount: Number(i.quantity),
                byName: auth.session.name,
              })
              return
            }
          }
          const { data: item } = await db.from('items').select('current_count').eq('id', i.item_id).single()
          if (item) {
            await db.from('items').update({ current_count: Number(item.current_count) + Number(i.quantity) }).eq('id', i.item_id)
          }
        })
    )
  }

  return NextResponse.json({ ...order, order_history_items: rows })
}

export async function DELETE(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json()
  const { id } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error } = await db.from('order_history').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json()
  const { id, resolved, resolved_by } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const updates: Record<string, unknown> = { resolved }
  if (resolved === true) {
    updates.resolved_at = new Date().toISOString()
    updates.resolved_by = resolved_by || null
  }

  const { data, error } = await db
    .from('order_history')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
