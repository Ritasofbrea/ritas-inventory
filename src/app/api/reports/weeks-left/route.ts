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
import { getMainUnitTotal, Item } from '@/lib/types'
import { todayInTZ, addDays } from '@/lib/tasks'

// Patch 44: "about N weeks left" for the Order List — restricted to the
// specific item ids it's asked about (the Order List's own shown items,
// ~40 in practice) rather than the whole ~198-item catalog, per the Phase 1
// timing finding (the same per-item point-query approach took ~5.2s across
// the full catalog; scoped to Order-List-sized input it's ~1-1.5s). A fixed
// trailing 28-day window — there's no caller-chosen date range here like
// Velocity's report UI has, so this picks one reasonable, stable window
// rather than exposing it as a parameter nothing calls with anything else.
const WINDOW_DAYS = 28
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { searchParams } = new URL(request.url)
  const idsParam = searchParams.get('ids')
  const ids = (idsParam ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (ids.length === 0) return NextResponse.json([])

  const today = todayInTZ()
  const start = addDays(today, -WINDOW_DAYS)
  const startISO = new Date(pacificDayBoundsMs(start).endMs).toISOString()
  const endISO = new Date(pacificDayBoundsMs(today).endMs).toISOString()

  const { data: items, error: itemsError } = await db.from('items').select('*').in('id', ids)
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })
  const itemRows = (items ?? []) as Item[]

  const endPoints = await runBatched(itemRows, async (item) => ({ item, endRecord: await fetchLatestCountAtOrBefore(db, item.id, endISO) }))
  const withEnd = endPoints.filter((p): p is { item: Item; endRecord: CountPoint } => p.endRecord !== null)

  const withStart = await runBatched(withEnd, async ({ item, endRecord }) => ({
    item,
    endRecord,
    startRecord: await fetchLatestCountAtOrBefore(db, item.id, startISO),
  }))
  const needsFlow = withStart.filter((r) => r.startRecord !== null)

  const flowResults = await runBatched(needsFlow, async (r) => ({
    item_id: r.item.id,
    netFlow: await fetchFlowForItem(db, r.item.id, (r.startRecord as CountPoint).created_at, r.endRecord.created_at),
  }))
  const flowByItem = new Map(flowResults.map((f) => [f.item_id, f.netFlow]))

  const results: { item_id: string; weeks_left: number | null }[] = []

  for (const { item, endRecord, startRecord } of withStart) {
    // No usable history (no start record by the window's beginning): hide.
    if (!startRecord) {
      results.push({ item_id: item.id, weeks_left: null })
      continue
    }
    const netFlow = flowByItem.get(item.id) ?? 0
    const { consumed, flagged } = computeCorrectedConsumed(startRecord.count, endRecord.count, netFlow)
    const elapsedMs = endRecord.ts - startRecord.ts
    const weeklyRate = elapsedMs > 0 ? consumed / (elapsedMs / WEEK_MS) : null

    // Hide per Phase 1's rules: flagged anomaly, or no positive rate to
    // divide by (null, zero, or negative).
    if (flagged || weeklyRate === null || weeklyRate <= 0) {
      results.push({ item_id: item.id, weeks_left: null })
      continue
    }

    const weeksLeft = Math.round((getMainUnitTotal(item) / weeklyRate) * 10) / 10
    results.push({ item_id: item.id, weeks_left: weeksLeft })
  }

  // Items with no end record at all (never counted by today) aren't in
  // `withStart` to begin with — hide by omission, same convention Velocity
  // uses, so the caller only needs to handle "missing from the array".
  return NextResponse.json(results)
}
