// Patch 39 Part A/C: shared usage-correction helpers for the Velocity report
// and Par Suggestions. A naive (startCount - endCount) delta silently
// undercounts -- or goes negative on -- true consumption whenever a
// delivery (order_history, type 'received'/'will_call') or a storage move
// (storage_moves, kind 'move_to_store'/'move_to_storage') changed
// current_count mid-window with no count row to reflect it. Both routes call
// the exact same functions here so they can't disagree.
import type { SupabaseClient } from '@supabase/supabase-js'

// Signed per-item events affecting current_count that are NOT consumption:
// a delivery or a move_to_store is +amount (stock arrived without a sale);
// a move_to_storage is -amount (stock left the store without a sale).
export interface FlowEvent {
  amount: number
  ts: number
}

// Short-shipment rows (order_history.type === 'short') are purely an
// informational record of a shortfall -- the paired received/will_call row's
// quantity already reflects what actually arrived -- so they're never
// queried here.
const RECEIVED_TYPES = ['received', 'will_call']

export async function fetchStoreFlowHistory(
  db: SupabaseClient,
  itemIds: string[],
  beforeISO: string
): Promise<Record<string, FlowEvent[]>> {
  if (itemIds.length === 0) return {}
  const itemIdSet = new Set(itemIds)
  const byItem: Record<string, FlowEvent[]> = {}

  const [{ data: orders, error: ordersError }, { data: moves, error: movesError }] = await Promise.all([
    db
      .from('order_history')
      .select('created_at, order_history_items(item_id, quantity)')
      .in('type', RECEIVED_TYPES)
      .lte('created_at', beforeISO),
    db
      .from('storage_moves')
      .select('item_id, kind, amount, created_at')
      .in('kind', ['move_to_store', 'move_to_storage'])
      .in('item_id', itemIds)
      .lte('created_at', beforeISO),
  ])

  if (!ordersError && orders) {
    type OrderRow = { created_at: string; order_history_items: { item_id: string; quantity: number }[] | null }
    for (const order of orders as unknown as OrderRow[]) {
      const ts = new Date(order.created_at).getTime()
      for (const line of order.order_history_items ?? []) {
        if (!itemIdSet.has(line.item_id) || !(Number(line.quantity) > 0)) continue
        if (!byItem[line.item_id]) byItem[line.item_id] = []
        byItem[line.item_id].push({ amount: Number(line.quantity), ts })
      }
    }
  }

  if (!movesError && moves) {
    type MoveRow = { item_id: string; kind: 'move_to_store' | 'move_to_storage'; amount: number; created_at: string }
    for (const row of moves as unknown as MoveRow[]) {
      if (!byItem[row.item_id]) byItem[row.item_id] = []
      const signed = row.kind === 'move_to_storage' ? -Number(row.amount) : Number(row.amount)
      byItem[row.item_id].push({ amount: signed, ts: new Date(row.created_at).getTime() })
    }
  }

  for (const events of Object.values(byItem)) events.sort((a, b) => a.ts - b.ts)
  return byItem
}

// Matches a report's chosen two snapshot timestamps for one item: an event
// exactly at the start snapshot is already "in" the start number (excluded);
// one exactly at the end snapshot happened during the window (included).
export function sumFlowInWindow(events: FlowEvent[] | undefined, fromExclusiveTs: number, toInclusiveTs: number): number {
  if (!events) return 0
  return events.reduce((sum, e) => (e.ts > fromExclusiveTs && e.ts <= toInclusiveTs ? sum + e.amount : sum), 0)
}

export interface CorrectedConsumption {
  consumed: number
  flagged: boolean
}

// consumed = (startCount - endCount) + netFlow, where netFlow is the sum of
// every delivery/move_to_store (+) and move_to_storage (-) strictly inside
// the window. A still-negative result after this correction is a genuine
// anomaly (e.g. a miscount) rather than an artifact of an uncounted
// delivery, so it's returned as-is (never hidden) with `flagged: true` --
// callers clamp to 0 for ranking/sorting only, never for display.
export function computeCorrectedConsumed(startCount: number, endCount: number, netFlow: number): CorrectedConsumption {
  const consumed = parseFloat((startCount - endCount + netFlow).toFixed(2))
  return { consumed, flagged: consumed < 0 }
}

// Store-local (America/Los_Angeles) day boundaries as precise UTC instants,
// correct across DST. Vercel runs UTC, but the store physically operates in
// Pacific time, so "end of the end date" must mean Pacific midnight, not
// whatever timezone the Node process happens to be in.
export const STORE_TZ = 'America/Los_Angeles'

// Guesses the UTC instant for the given Pacific wall-clock components, reads
// back what Pacific time that guess actually lands on, then corrects by the
// difference. Exact for day boundaries: 00:00:00.000 and 23:59:59.999 are
// never the skipped/repeated instant on a US DST transition (only ~2 AM is).
function pacificInstant(dateStr: string, hour: number, minute: number, second: number, ms: number): number {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const guessMs = Date.UTC(y, mo - 1, d, hour, minute, second, ms)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: STORE_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(guessMs))
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const actualMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'), ms)
  return guessMs + (guessMs - actualMs)
}

export function pacificDayBoundsMs(dateStr: string): { startMs: number; endMs: number } {
  return {
    startMs: pacificInstant(dateStr, 0, 0, 0, 0),
    endMs: pacificInstant(dateStr, 23, 59, 59, 999),
  }
}
