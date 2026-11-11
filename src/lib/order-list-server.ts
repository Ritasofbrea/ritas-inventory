// Patch 44: server-side "what currently needs ordering, per vendor" — the
// same toOrder concept order-list/page.tsx computes client-side (needsOrder
// minus items already on order), reused by GET /api/vendor-schedules (to
// show per-vendor item counts) and the reminder cron (to decide whether a
// vendor's reminder should fire at all — never for an empty vendor list).
//
// Patch 47: order_history has no upper bound, and an unlimited .select()
// silently truncates at PostgREST's 1000-row cap (the same bug patch 41
// fixed for inventory_counts elsewhere) — a truncated fetch here could drop
// an old still-open "ordered" row, or an old "received"/"will_call" row
// that resolves one, either of which would throw off which items still
// need ordering. A date floor isn't safe either (an old order can still be
// genuinely unresolved), so fetchAllOrderHistoryRows below pages through
// the WHOLE table instead, which can never silently drop rows regardless
// of size. Each individual request stays bounded (capped at pageSize rows),
// but the total number of round trips — and bytes moved — grows with the
// table, so this does more total work as order_history grows; at this
// store's real order volume that stays small for years, but if it ever
// becomes a real cost, the real fix is a maintained "still open" flag
// written at order/receive time (a schema change, out of scope here).
import type { SupabaseClient } from '@supabase/supabase-js'
import { Item, getStockStatus } from './types'
import { vendorKeyForItem } from './vendor-schedule'
import { getPendingOrders } from './order-status'

type OrderRow = { id: string; type: string; related_order_id: string | null; canceled_at: string | null; order_history_items: { item_id: string | null }[] }

// Exported for tests: order-history-paging-checks.mjs forces a tiny
// pageSize against real (small) data to prove the paging loop assembles
// the exact same rows a single unbounded fetch would, without needing a
// 1000+ row table to exercise the real cap.
export async function fetchAllOrderHistoryRows(db: SupabaseClient, pageSize = 500): Promise<OrderRow[]> {
  const rows: OrderRow[] = []
  let from = 0
  let pageLength = pageSize
  do {
    const { data, error } = await db
      .from('order_history')
      .select('id, type, related_order_id, canceled_at, order_history_items(item_id)')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const page = (data ?? []) as OrderRow[]
    rows.push(...page)
    pageLength = page.length
    from += pageSize
  } while (pageLength === pageSize)
  return rows
}

// vendor (items.distributor, or 'other' for null — see vendorKeyForItem)
// -> items currently needing order for that vendor, excluding anything
// already on an unresolved order. Mirrors order-list/page.tsx's
// loadAll/toOrder exactly.
export async function getItemsNeedingOrderByVendor(db: SupabaseClient): Promise<Record<string, Item[]>> {
  const [itemsRes, all] = await Promise.all([db.from('items').select('*'), fetchAllOrderHistoryRows(db)])
  if (itemsRes.error) throw new Error(itemsRes.error.message)

  // Patch 62: canceled orders are excluded (shared rule, ./order-status).
  const pending = getPendingOrders(all)
  const onOrderItemIds = new Set<string>()
  for (const order of pending) {
    for (const line of order.order_history_items) {
      if (line.item_id) onOrderItemIds.add(line.item_id)
    }
  }

  const needsOrder = ((itemsRes.data ?? []) as Item[]).filter((i) => !i.is_off && getStockStatus(i) !== 'ok')
  const toOrder = needsOrder.filter((i) => !onOrderItemIds.has(i.id))

  const byVendor: Record<string, Item[]> = {}
  for (const item of toOrder) {
    const key = vendorKeyForItem(item.distributor)
    if (!byVendor[key]) byVendor[key] = []
    byVendor[key].push(item)
  }
  return byVendor
}
