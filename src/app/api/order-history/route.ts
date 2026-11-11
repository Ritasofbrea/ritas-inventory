import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { applyStorageChange, applyCurrentCountIncrement, applyRawCountDelta } from '@/lib/storage-server'
import { sendPushToSubs, subsForOwnersWithAlert } from '@/lib/push-server'

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
  const { type, notes, items, related_order_id, resolved, received_by, vendor } = body

  if (!type || !Array.isArray(items) || items.length === 0)
    return NextResponse.json({ error: 'Missing type or items' }, { status: 400 })

  // Split orders by vendor (supabase/patch-57-order-vendor.sql): an
  // 'ordered' row from the Order List carries the one vendor key its items
  // belong to (vendorKeyForItem's output). Optional and only ever sent by
  // the Order List's Order Placed buttons; receipts never send it. The
  // column is only included in the insert when a vendor was actually sent,
  // so a receipt save never depends on the column existing.
  if (vendor !== undefined && vendor !== null && (typeof vendor !== 'string' || !vendor.trim()))
    return NextResponse.json({ error: 'vendor must be a non-empty string' }, { status: 400 })
  const trimmedVendor = typeof vendor === 'string' ? vendor.trim() : null

  // Patch 44: a receipt (received/will_call) saved with a non-empty note
  // needs an owner's attention — flips note_review_needed on, independent
  // of `resolved` (which already means something else: an outstanding
  // short-shipment follow-up, type 'short' only). Nothing about how the
  // note itself gets written changes.
  const trimmedNotes = (notes ?? '').trim()
  const needsNoteReview = (type === 'received' || type === 'will_call') && trimmedNotes.length > 0

  const { data: order, error: orderError } = await db
    .from('order_history')
    .insert({
      type,
      notes: notes || '',
      related_order_id: related_order_id || null,
      resolved: resolved !== undefined ? resolved : true,
      received_by: received_by || null,
      note_review_needed: needsNoteReview,
      ...(trimmedVendor ? { vendor: trimmedVendor } : {}),
    })
    .select()
    .single()

  if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 })

  if (needsNoteReview) {
    // Awaited (not fire-and-forget) — a serverless function can be frozen
    // the instant the response is sent, which would drop an unawaited push
    // mid-flight. A push failure here must never fail the receipt save, so
    // it's wrapped in its own try/catch rather than letting it throw.
    try {
      const subs = await subsForOwnersWithAlert(db, 'receipt_note_alerts_enabled')
      await sendPushToSubs(db, subs, {
        title: 'Receipt Note',
        body: `A note was left on a ${type === 'will_call' ? 'will call' : 'delivery'} receipt — check Order History`,
      })
    } catch {
      // best-effort; the Dashboard/Order History flag is the durable signal
    }
  }

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
  //
  // Patch 48: each item's write now goes through applyStorageChange/
  // applyCurrentCountIncrement, both of which read-guard-retry (compare-
  // and-swap) against concurrent writes to the same item instead of a bare
  // read-then-write, fixing a lost-update race (two overlapping receipts
  // for the same item). Processed sequentially (not Promise.all) so that
  // if one item's write ultimately fails after retries are exhausted, every
  // item already applied in THIS receipt can be rolled back (a
  // compensating negative delta) before deleting the order_history_items
  // and order_history rows just inserted above -- so a failed receipt never
  // leaves a "received" record with stock that doesn't match it, and
  // nothing is left half-written.
  if (type === 'received' || type === 'will_call') {
    const isOwner = auth.session.role === 'owner'
    const applied: { itemId: string; column: 'current_count' | 'storage_count'; amount: number }[] = []
    let failure: { error: string; status: number } | null = null

    for (const i of items as { item_id: string; quantity: number; destination?: string }[]) {
      if (!i.item_id || !(i.quantity > 0)) continue

      let routedToStorage = false
      if (isOwner && i.destination === 'storage') {
        const { data: storageItem } = await db.from('items').select('has_storage').eq('id', i.item_id).maybeSingle()
        if (storageItem?.has_storage) {
          const result = await applyStorageChange(db, {
            itemId: i.item_id,
            kind: 'receive_to_storage',
            amount: Number(i.quantity),
            byName: auth.session.name,
          })
          if (!result.ok) {
            failure = { error: result.error, status: result.status }
            break
          }
          applied.push({ itemId: i.item_id, column: 'storage_count', amount: Number(i.quantity) })
          routedToStorage = true
        }
      }

      if (!routedToStorage) {
        const result = await applyCurrentCountIncrement(db, { itemId: i.item_id, amount: Number(i.quantity) })
        if (!result.ok) {
          failure = { error: result.error, status: result.status }
          break
        }
        applied.push({ itemId: i.item_id, column: 'current_count', amount: Number(i.quantity) })
      }
    }

    if (failure) {
      for (const a of applied) {
        await applyRawCountDelta(db, { itemId: a.itemId, column: a.column, delta: -a.amount })
      }
      await db.from('order_history_items').delete().eq('order_id', order.id)
      await db.from('order_history').delete().eq('id', order.id)
      return NextResponse.json(
        { error: `Could not update stock for this receipt (${failure.error}). Nothing was saved -- please try again.` },
        { status: failure.status === 404 || failure.status === 400 ? 400 : 500 }
      )
    }
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
  if (error) {
    // Patch 50 Part C: a kept-as-a-safety-net message in case this route
    // ever hits a blocking foreign key again (e.g. before
    // fix-order-history-related-fk.sql is applied, or a future one) --
    // Postgres code 23503 is foreign_key_violation. Fixing the actual
    // constraint is the real fix (see that SQL file); this just keeps a
    // 500 with raw SQL text from ever reaching the Delete button.
    if (error.code === '23503') {
      return NextResponse.json({ error: 'This order is still linked to a receipt — it can’t be deleted yet.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json()
  const { id, resolved, resolved_by, mark_note_reviewed } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const updates: Record<string, unknown> = { resolved }
  if (resolved === true) {
    updates.resolved_at = new Date().toISOString()
    updates.resolved_by = resolved_by || null
  }
  // Patch 44: separate from `resolved` — see the POST handler's comment.
  // A caller sends ONLY mark_note_reviewed (never the raw note_review_needed
  // column), so this can only ever be flipped off here, never back on —
  // that only ever happens server-side, at receipt-creation time, based on
  // whether the note was non-empty.
  if (mark_note_reviewed === true) {
    updates.note_review_needed = false
    updates.note_reviewed_by = auth.session.name
    updates.note_reviewed_at = new Date().toISOString()
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
