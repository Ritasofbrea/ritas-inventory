// Patch 44: server-side "what currently needs ordering, per vendor" — the
// same toOrder concept order-list/page.tsx computes client-side (needsOrder
// minus items already on order), reused by GET /api/vendor-schedules (to
// show per-vendor item counts) and the reminder cron (to decide whether a
// vendor's reminder should fire at all — never for an empty vendor list).
import type { SupabaseClient } from '@supabase/supabase-js'
import { Item, getStockStatus } from './types'
import { vendorKeyForItem } from './vendor-schedule'

// vendor (items.distributor, or 'other' for null — see vendorKeyForItem)
// -> items currently needing order for that vendor, excluding anything
// already on an unresolved order. Mirrors order-list/page.tsx's
// loadAll/toOrder exactly.
export async function getItemsNeedingOrderByVendor(db: SupabaseClient): Promise<Record<string, Item[]>> {
  const [{ data: items, error: itemsError }, { data: orders, error: ordersError }] = await Promise.all([
    db.from('items').select('*'),
    db.from('order_history').select('id, type, related_order_id, order_history_items(item_id)'),
  ])
  if (itemsError) throw new Error(itemsError.message)
  if (ordersError) throw new Error(ordersError.message)

  type OrderRow = { id: string; type: string; related_order_id: string | null; order_history_items: { item_id: string | null }[] }
  const all = (orders ?? []) as OrderRow[]
  const fulfilledOrderIds = new Set(
    all.filter((r) => r.type === 'received' || r.type === 'will_call').map((r) => r.related_order_id).filter(Boolean) as string[]
  )
  const pending = all.filter((r) => r.type === 'ordered' && !fulfilledOrderIds.has(r.id))
  const onOrderItemIds = new Set<string>()
  for (const order of pending) {
    for (const line of order.order_history_items) {
      if (line.item_id) onOrderItemIds.add(line.item_id)
    }
  }

  const needsOrder = ((items ?? []) as Item[]).filter((i) => !i.is_off && getStockStatus(i) !== 'ok')
  const toOrder = needsOrder.filter((i) => !onOrderItemIds.has(i.id))

  const byVendor: Record<string, Item[]> = {}
  for (const item of toOrder) {
    const key = vendorKeyForItem(item.distributor)
    if (!byVendor[key]) byVendor[key] = []
    byVendor[key].push(item)
  }
  return byVendor
}
