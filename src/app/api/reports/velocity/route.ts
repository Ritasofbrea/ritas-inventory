import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import {
  fetchLatestCountAtOrBefore,
  fetchFlowForItem,
  computeCorrectedConsumed,
  pacificDayBoundsMs,
  runBatched,
  CountPoint,
} from '@/lib/usage-server'

export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { searchParams } = new URL(request.url)
  const start = searchParams.get('start')
  const end = searchParams.get('end')

  if (!start || !end) {
    return NextResponse.json({ error: 'Missing start or end date' }, { status: 400 })
  }

  // Patch 39 Part C: "end of day" means store-local (Pacific) midnight, not
  // whatever timezone the server process happens to run in -- the store
  // physically operates in Pacific time. pacificDayBoundsMs is DST-safe.
  const startMs = pacificDayBoundsMs(start).endMs
  const endMs = pacificDayBoundsMs(end).endMs
  const endISO = new Date(endMs).toISOString()
  const startISO = new Date(startMs).toISOString()

  // items is a bounded catalog table (not a growing log -- unlike
  // inventory_counts/order_history/storage_moves), so fetching it whole is
  // safe. It's the universe of item_ids patch 41's per-item point queries
  // below run against.
  const { data: items, error: itemsError } = await db.from('items').select('id, name, category, unit')
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })

  type ItemRow = { id: string; name: string; category: string; unit: string }
  const itemRows = (items ?? []) as ItemRow[]

  // Step 1: latest real count on/before the end date, per item. An item
  // with no such row was never counted by the end date and is excluded --
  // exactly matching the old bulk query's behavior (it only ever produced
  // rows for item_ids actually present in the fetched count rows).
  const endPoints = await runBatched(itemRows, async (item) => ({
    item,
    endRecord: await fetchLatestCountAtOrBefore(db, item.id, endISO),
  }))
  const withEnd = endPoints.filter((p): p is { item: ItemRow; endRecord: CountPoint } => p.endRecord !== null)

  // Step 2: latest real count on/before the start date, per item -- only
  // for items that passed step 1.
  const withStart = await runBatched(withEnd, async ({ item, endRecord }) => ({
    item,
    endRecord,
    startRecord: await fetchLatestCountAtOrBefore(db, item.id, startISO),
  }))

  // Step 3: net delivery/move flow strictly between the two snapshots --
  // only for items that have both a start and an end record (matches the
  // old code's early-continue for a null start/end count).
  const needsFlow = withStart.filter((r) => r.startRecord !== null)
  const flowResults = await runBatched(needsFlow, async (r) => ({
    item_id: r.item.id,
    netFlow: await fetchFlowForItem(db, r.item.id, (r.startRecord as CountPoint).created_at, r.endRecord.created_at),
  }))
  const flowByItem = new Map(flowResults.map((f) => [f.item_id, f.netFlow]))

  const results: {
    item_id: string
    name: string
    category: string
    unit: string
    start_count: number | null
    end_count: number | null
    consumed: number
    flagged: boolean
  }[] = []

  for (const { item, endRecord, startRecord } of withStart) {
    if (!startRecord) {
      results.push({
        item_id: item.id,
        name: item.name,
        category: item.category,
        unit: item.unit,
        start_count: null,
        end_count: endRecord.count,
        consumed: 0,
        flagged: false,
      })
      continue
    }

    const netFlow = flowByItem.get(item.id) ?? 0
    const { consumed, flagged } = computeCorrectedConsumed(startRecord.count, endRecord.count, netFlow)

    results.push({
      item_id: item.id,
      name: item.name,
      category: item.category,
      unit: item.unit,
      start_count: startRecord.count,
      end_count: endRecord.count,
      consumed,
      flagged,
    })
  }

  // Sort by consumed desc (most used first); a flagged negative is clamped
  // to 0 for ranking purposes only -- the displayed value stays the true,
  // possibly-negative number.
  results.sort((a, b) => Math.max(0, b.consumed) - Math.max(0, a.consumed))

  return NextResponse.json(results)
}
