import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import {
  fetchLatestCountAtOrBefore,
  fetchEarliestCountAtOrAfter,
  fetchFlowForItem,
  computeCorrectedConsumed,
  runBatched,
  CountPoint,
} from '@/lib/usage-server'

// Suggest par = ceil(weekly_avg_consumption * 1.5), minimum 1 week of buffer.
// Only returns items with at least 2 count records in the last 90 days.
export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const nowISO = new Date().toISOString()
  const sinceMs = Date.now() - 90 * 24 * 60 * 60 * 1000
  const sinceISO = new Date(sinceMs).toISOString()

  // items is a bounded catalog table -- see velocity/route.ts for why
  // fetching it whole is safe (unlike inventory_counts, which is not).
  const { data: items, error: itemsError } = await db.from('items').select('id, name, unit')
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })

  type ItemRow = { id: string; name: string; unit: string }
  const itemRows = (items ?? []) as ItemRow[]

  // Step 1: the latest real count ever recorded for each item (no lower
  // bound needed -- the single most recent row, if any, is always the
  // candidate "last" point). Items whose latest count predates the 90-day
  // window, or that have never been counted, are excluded here.
  const lastPoints = await runBatched(itemRows, async (item) => ({
    item,
    last: await fetchLatestCountAtOrBefore(db, item.id, nowISO),
  }))
  const withLast = lastPoints.filter(
    (p): p is { item: ItemRow; last: CountPoint } => p.last !== null && p.last.ts >= sinceMs
  )

  // Step 2: the earliest real count on/after the window start, per item.
  const withFirst = await runBatched(withLast, async ({ item, last }) => ({
    item,
    last,
    first: await fetchEarliestCountAtOrAfter(db, item.id, sinceISO),
  }))

  // Only items with at least two distinct count records inside the window
  // (first and last are the same row otherwise) proceed to the flow lookup.
  const needsFlow = withFirst.filter((r) => r.first !== null && r.first.created_at !== r.last.created_at)
  const flowResults = await runBatched(needsFlow, async (r) => ({
    item_id: r.item.id,
    netFlow: await fetchFlowForItem(db, r.item.id, (r.first as CountPoint).created_at, r.last.created_at),
  }))
  const flowByItem = new Map(flowResults.map((f) => [f.item_id, f.netFlow]))

  const suggestions: Record<string, { name: string; unit: string; suggested_par: number; weekly_avg: number }> = {}

  // Patch 39 Part A: same delivery/move correction as the velocity report --
  // see src/lib/usage-server.ts for why. Items with no such events in the
  // window are unaffected.
  for (const { item, last, first } of needsFlow) {
    const netFlow = flowByItem.get(item.id) ?? 0
    const { consumed } = computeCorrectedConsumed((first as CountPoint).count, last.count, netFlow)
    if (consumed <= 0) continue

    const weeks = (last.ts - (first as CountPoint).ts) / (7 * 24 * 60 * 60 * 1000)
    if (weeks < 0.5) continue // need at least half a week of data

    const weeklyAvg = consumed / weeks
    // Par = 1.5 weeks of stock, rounded up to nearest whole number, minimum 1
    const suggested = Math.max(1, Math.ceil(weeklyAvg * 1.5))

    suggestions[item.id] = {
      name: item.name,
      unit: item.unit,
      suggested_par: suggested,
      weekly_avg: parseFloat(weeklyAvg.toFixed(2)),
    }
  }

  return NextResponse.json(suggestions)
}
