// Patch 62: the single definition of "still on order", shared by every
// place that decides it -- Order List (fetchPendingOrders), Receive Order
// (fetchRecentOrders, i.e. "Receiving against which order?" and the green
// On Order tags), Dashboard (N items on order), and the server-side vendor
// counts/reminders (src/lib/order-list-server.ts). An 'ordered' row is
// pending when it hasn't been fulfilled by a received/will_call receipt
// (related_order_id) AND hasn't been canceled (canceled_at, soft cancel --
// supabase/patch-62-soft-cancel.sql). A canceled order stays in history.

type OrderLike = { id: string; type: string; related_order_id?: string | null; canceled_at?: string | null }

export function isCanceledOrder(order: { canceled_at?: string | null }): boolean {
  return !!order.canceled_at
}

export function getPendingOrders<T extends OrderLike>(all: T[]): T[] {
  const fulfilledIds = new Set(
    all.filter((r) => r.type === 'received' || r.type === 'will_call').map((r) => r.related_order_id).filter(Boolean) as string[]
  )
  return all.filter((r) => r.type === 'ordered' && !fulfilledIds.has(r.id) && !isCanceledOrder(r))
}
