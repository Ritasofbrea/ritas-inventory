import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { saveReceipt } from '@/lib/receipt-server'

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

  // Split orders by vendor (supabase/patch-58-order-vendor.sql): an
  // 'ordered' row from the Order List carries the one vendor key its items
  // belong to (vendorKeyForItem's output). Optional and only ever sent by
  // the Order List's Order Placed buttons; receipts never send it. The
  // column is only included in the insert when a vendor was actually sent,
  // so a receipt save never depends on the column existing.
  if (vendor !== undefined && vendor !== null && (typeof vendor !== 'string' || !vendor.trim()))
    return NextResponse.json({ error: 'vendor must be a non-empty string' }, { status: 400 })
  const trimmedVendor = typeof vendor === 'string' ? vendor.trim() : null

  // Patch 64: everything that writes (order_history + order_history_items
  // insert, the receipt-note push, stock via applyStorageChange/
  // applyCurrentCountIncrement, and the rollback on failure) lives in
  // saveReceipt (src/lib/receipt-server.ts), moved there unchanged. This
  // route only validates and shapes the response, same JSON and status
  // codes as before.
  const result = await saveReceipt(db, auth.session, {
    type,
    notes,
    items,
    related_order_id,
    resolved,
    received_by,
    vendor: trimmedVendor,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ...result.order, order_history_items: result.lines })
}

// Patch 62: no longer used by Cancel Order (that's now a soft cancel via
// PATCH { cancel: true } below). Kept for the e2e cleanup scripts.
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
  const { id, resolved, resolved_by, mark_note_reviewed, cancel, canceled_by } = body
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  // Patch 62: soft cancel (supabase/patch-62-soft-cancel.sql). Replaces the
  // old Cancel Order hard DELETE: stamps canceled_at/canceled_by and keeps
  // the row and its order_history_items as proof of what was ordered. Only
  // an 'ordered' row that isn't already canceled can be canceled; any
  // receipt linked via related_order_id is left untouched. Who canceled:
  // the server session's name first, else the name the page sends.
  if (cancel === true) {
    const byName = auth.session.name || (typeof canceled_by === 'string' && canceled_by.trim() ? canceled_by.trim() : null)
    const { data, error } = await db
      .from('order_history')
      .update({ canceled_at: new Date().toISOString(), canceled_by: byName })
      .eq('id', id)
      .eq('type', 'ordered')
      .is('canceled_at', null)
      .select()
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'This order was already canceled or is not an order.' }, { status: 409 })
    return NextResponse.json(data)
  }

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
