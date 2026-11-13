// Patch 64: the shared "save an order_history row and, for a receipt, add
// the stock" logic, moved verbatim out of POST /api/order-history so the
// invoice confirm step (patch 69) can save a receipt exactly the way
// Receive Order does instead of copying this. NO behavior change: the
// route still validates the request and shapes the response; everything
// that writes to the database lives here.
//
// Box/case -> stock-unit conversion is NOT here: Receive Order still does
// it in the browser (receive-order/page.tsx) and sends quantities already
// in each item's stock unit.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SessionPayload } from './session-token'
import { applyStorageChange, applyCurrentCountIncrement, applyRawCountDelta } from './storage-server'
import { sendPushToSubs, subsForOwnersWithAlert } from './push-server'

export interface ReceiptLineInput {
  item_id: string
  item_name: string
  quantity: number
  unit: string
  // Patch 38: 'storage' routes a has_storage item's quantity to storage,
  // OWNER sessions only (re-verified from the DB below). Anything else,
  // or missing, means the store.
  destination?: string
}

// One typed input object so later patches can add optional fields
// without touching existing callers. Values are passed through exactly as
// the route received them; the same defaults the route always applied are
// applied here (notes '' , related_order_id null, resolved true,
// received_by null).
export interface SaveReceiptInput {
  type: string // 'received' | 'will_call' add stock; 'ordered' | 'short' only record
  items: ReceiptLineInput[]
  notes?: string | null
  related_order_id?: string | null
  resolved?: boolean
  received_by?: string | null
  vendor?: string | null // already validated + trimmed by the caller; omitted from the insert when empty
}

// One stock write a receipt made, so it can be reversed.
export type AppliedStock = { itemId: string; column: 'current_count' | 'storage_count'; amount: number }

export type SaveReceiptResult =
  // Patch 69: `applied` (what was added to stock, in order) is returned so
  // the invoice confirm step can reverse a receipt that saved fine when a
  // LATER step of the confirm fails. Receive Order ignores it.
  | { ok: true; order: Record<string, unknown>; lines: { order_id: string; item_id: string; item_name: string; quantity: number; unit: string }[]; applied: AppliedStock[] }
  | { ok: false; status: number; error: string }

// The compensating rollback saveReceipt has always done when a stock write
// fails partway: take back every stock change already applied, then delete
// the order_history_items and order_history rows. Patch 69 only moved it
// into this function (same three steps, same order) so the invoice confirm
// step can run the SAME rollback on a receipt that saved, instead of
// writing a second copy. Known, unchanged: a `receive_to_storage`
// storage_moves row is left behind (stock itself is restored).
export async function undoReceipt(db: SupabaseClient, orderId: string, applied: AppliedStock[]): Promise<void> {
  for (const a of applied) {
    await applyRawCountDelta(db, { itemId: a.itemId, column: a.column, delta: -a.amount })
  }
  await db.from('order_history_items').delete().eq('order_id', orderId)
  await db.from('order_history').delete().eq('id', orderId)
}

export async function saveReceipt(db: SupabaseClient, session: SessionPayload, input: SaveReceiptInput): Promise<SaveReceiptResult> {
  const { type, notes, items, related_order_id, resolved, received_by, vendor } = input

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
      ...(vendor ? { vendor } : {}),
    })
    .select()
    .single()

  if (orderError) return { ok: false, status: 500, error: orderError.message }

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

  const rows = items.map((i) => ({
    order_id: order.id,
    item_id: i.item_id,
    item_name: i.item_name,
    quantity: i.quantity,
    unit: i.unit,
  }))

  const { error: itemsError } = await db.from('order_history_items').insert(rows)
  if (itemsError) return { ok: false, status: 500, error: itemsError.message }

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
  const applied: AppliedStock[] = []
  if (type === 'received' || type === 'will_call') {
    const isOwner = session.role === 'owner'
    let failure: { error: string; status: number } | null = null

    for (const i of items) {
      if (!i.item_id || !(i.quantity > 0)) continue

      let routedToStorage = false
      if (isOwner && i.destination === 'storage') {
        const { data: storageItem } = await db.from('items').select('has_storage').eq('id', i.item_id).maybeSingle()
        if (storageItem?.has_storage) {
          const result = await applyStorageChange(db, {
            itemId: i.item_id,
            kind: 'receive_to_storage',
            amount: Number(i.quantity),
            byName: session.name,
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
      await undoReceipt(db, order.id, applied)
      return {
        ok: false,
        status: failure.status === 404 || failure.status === 400 ? 400 : 500,
        error: `Could not update stock for this receipt (${failure.error}). Nothing was saved -- please try again.`,
      }
    }
  }

  return { ok: true, order, lines: rows, applied }
}
