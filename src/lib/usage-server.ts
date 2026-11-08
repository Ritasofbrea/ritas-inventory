// Patch 39 Part A/C, patch 41: shared usage-correction helpers for the
// Velocity report and Par Suggestions. A naive (startCount - endCount)
// delta silently undercounts -- or goes negative on -- true consumption
// whenever a delivery (order_history, type 'received'/'will_call') or a
// storage move (storage_moves, kind 'move_to_store'/'move_to_storage')
// changed current_count mid-window with no count row to reflect it. Both
// routes call the exact same functions here so they can't disagree.
//
// Patch 41: every lookup below is a targeted, per-item point query (a
// specific item_id plus, where relevant, a narrow time window) instead of
// a single bulk fetch across every item/every row at once. PostgREST
// silently caps any unlimited `.select()` at 1000 rows -- a bulk fetch here
// would (and, for par-suggestions, already did) silently drop data once
// the underlying table grew past that. A `.limit(1)` point query or a
// query scoped to one item's narrow window can never hit that cap.
import type { SupabaseClient } from '@supabase/supabase-js'

// Short-shipment rows (order_history.type === 'short') are purely an
// informational record of a shortfall -- the paired received/will_call row's
// quantity already reflects what actually arrived -- so they're never
// queried here.
const RECEIVED_TYPES = ['received', 'will_call']

export interface CountPoint {
  count: number
  created_at: string
  ts: number
}

// Latest real (non-test) count on or before the given instant, for one
// item. Backed by idx_inventory_counts_item_created(item_id, created_at
// desc) -- a single index lookup, never a scan.
export async function fetchLatestCountAtOrBefore(
  db: SupabaseClient,
  itemId: string,
  beforeISO: string
): Promise<CountPoint | null> {
  const { data } = await db
    .from('inventory_counts')
    .select('count, created_at')
    .eq('item_id', itemId)
    .eq('type', 'count')
    .eq('is_test_data', false)
    .lte('created_at', beforeISO)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return { count: data.count, created_at: data.created_at, ts: new Date(data.created_at).getTime() }
}

// Earliest real count on or after the given instant, for one item.
export async function fetchEarliestCountAtOrAfter(
  db: SupabaseClient,
  itemId: string,
  afterISO: string
): Promise<CountPoint | null> {
  const { data } = await db
    .from('inventory_counts')
    .select('count, created_at')
    .eq('item_id', itemId)
    .eq('type', 'count')
    .eq('is_test_data', false)
    .gte('created_at', afterISO)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!data) return null
  return { count: data.count, created_at: data.created_at, ts: new Date(data.created_at).getTime() }
}

// Net signed delivery/move flow for one item, strictly inside
// (fromExclusiveISO, toInclusiveISO]. Replaces the old bulk
// fetchStoreFlowHistory/sumFlowInWindow pair (fetch-everything, then sum in
// memory) with two queries scoped to this one item and this one window --
// order_history filtered through order_history_items via idx_
// order_history_items_item_id + idx_order_history_created_at, storage_moves
// via the existing idx_storage_moves_item_created from patch 38.
export async function fetchFlowForItem(
  db: SupabaseClient,
  itemId: string,
  fromExclusiveISO: string,
  toInclusiveISO: string
): Promise<number> {
  const [{ data: orderLines, error: orderError }, { data: moves, error: movesError }] = await Promise.all([
    db
      .from('order_history_items')
      .select('quantity, order_history!inner(created_at, type)')
      .eq('item_id', itemId)
      .in('order_history.type', RECEIVED_TYPES)
      .gt('order_history.created_at', fromExclusiveISO)
      .lte('order_history.created_at', toInclusiveISO),
    db
      .from('storage_moves')
      .select('kind, amount, created_at')
      .eq('item_id', itemId)
      .in('kind', ['move_to_store', 'move_to_storage'])
      .gt('created_at', fromExclusiveISO)
      .lte('created_at', toInclusiveISO),
  ])

  let net = 0
  if (!orderError && orderLines) {
    for (const line of orderLines as unknown as { quantity: number }[]) {
      if (Number(line.quantity) > 0) net += Number(line.quantity)
    }
  }
  if (!movesError && moves) {
    for (const row of moves as unknown as { kind: 'move_to_store' | 'move_to_storage'; amount: number }[]) {
      net += row.kind === 'move_to_storage' ? -Number(row.amount) : Number(row.amount)
    }
  }
  return net
}

// Runs `fn` over `items` in fixed-size concurrent batches instead of all at
// once, so a ~200-item report doesn't fire ~200+ simultaneous requests at
// Supabase. 18 is in the middle of patch 41's requested 15-20 range.
export const DEFAULT_BATCH_SIZE = 18

export async function runBatched<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  batchSize: number = DEFAULT_BATCH_SIZE
): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    results.push(...(await Promise.all(batch.map(fn))))
  }
  return results
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
