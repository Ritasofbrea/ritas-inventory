import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { fetchStoreFlowHistory, sumFlowInWindow, computeCorrectedConsumed, pacificDayBoundsMs } from '@/lib/usage-server'

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
  const { data, error } = await db
    .from('inventory_counts')
    .select('item_id, count, created_at, items(name, category, unit)')
    .eq('type', 'count')
    .eq('is_test_data', false)
    .lte('created_at', new Date(endMs).toISOString())
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // For each item, find the last record on/before start date and last record on/before end date
  const byItem: Record<string, { name: string; category: string; unit: string; records: { count: number; ts: number }[] }> = {}

  type CountRow = { item_id: string; count: number; created_at: string; items: { name: string; category: string; unit: string } | null }
  for (const row of (data as unknown) as CountRow[]) {
    if (!row.items) continue
    if (!byItem[row.item_id]) {
      byItem[row.item_id] = {
        name: row.items.name,
        category: row.items.category,
        unit: row.items.unit,
        records: [],
      }
    }
    byItem[row.item_id].records.push({ count: row.count, ts: new Date(row.created_at).getTime() })
  }

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

  // Patch 39 Part A: a delivery or a move_to_store raises current_count
  // without a sale, and a move_to_storage lowers it without a sale --
  // either would otherwise make the naive delta below undercount, overcount,
  // or go negative on true consumption. Add back/subtract whatever happened
  // strictly between each item's own start and end snapshot timestamps.
  // Items with no such events in that window are completely unaffected --
  // same consumed value as before this patch.
  const flowHistory = await fetchStoreFlowHistory(db, Object.keys(byItem), new Date(endMs).toISOString())

  for (const [item_id, item] of Object.entries(byItem)) {
    // records are newest first; find latest on/before start and latest on/before end
    const startRecord = item.records.find((r) => r.ts <= startMs)
    const endRecord = item.records.find((r) => r.ts <= endMs)

    const startCount = startRecord?.count ?? null
    const endCount = endRecord?.count ?? null

    if (startCount === null || endCount === null) {
      results.push({ item_id, name: item.name, category: item.category, unit: item.unit, start_count: startCount, end_count: endCount, consumed: 0, flagged: false })
      continue
    }

    const netFlow = sumFlowInWindow(flowHistory[item_id], (startRecord as { ts: number }).ts, (endRecord as { ts: number }).ts)
    const { consumed, flagged } = computeCorrectedConsumed(startCount, endCount, netFlow)

    results.push({ item_id, name: item.name, category: item.category, unit: item.unit, start_count: startCount, end_count: endCount, consumed, flagged })
  }

  // Sort by consumed desc (most used first); a flagged negative is clamped
  // to 0 for ranking purposes only -- the displayed value stays the true,
  // possibly-negative number.
  results.sort((a, b) => Math.max(0, b.consumed) - Math.max(0, a.consumed))

  return NextResponse.json(results)
}
