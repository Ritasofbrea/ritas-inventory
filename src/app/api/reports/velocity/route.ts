import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { fetchMoveToStoreHistory, sumMovesInWindow } from '@/lib/storage-server'

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

  // Fetch all count records up through the end date, newest first
  const startMs = new Date(start).setHours(23, 59, 59, 999)
  const endMs = new Date(end).setHours(23, 59, 59, 999)
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
  }[] = []

  // Patch 38: a move_to_store (storage -> store) raises current_count
  // without a sale, which would otherwise make the naive delta below
  // undercount -- or go negative on -- true consumption. Add back whatever
  // moved into the store strictly between each item's own start and end
  // snapshot timestamps. Items with no storage, or no moves in that window,
  // get +0 and are completely unaffected -- same consumed value as before
  // this patch.
  const moveHistory = await fetchMoveToStoreHistory(db, Object.keys(byItem), new Date(endMs).toISOString())

  for (const [item_id, item] of Object.entries(byItem)) {
    // records are newest first; find latest on/before start and latest on/before end
    const startRecord = item.records.find((r) => r.ts <= startMs)
    const endRecord = item.records.find((r) => r.ts <= endMs)

    const startCount = startRecord?.count ?? null
    const endCount = endRecord?.count ?? null

    // consumed = what was there at start minus what's left at end, plus
    // anything moved into the store from storage in that exact window
    // (which isn't consumption -- it's stock relocating, not leaving)
    const movedIn = startRecord && endRecord ? sumMovesInWindow(moveHistory[item_id], startRecord.ts, endRecord.ts) : 0
    const consumed =
      startCount !== null && endCount !== null
        ? parseFloat((startCount - endCount + movedIn).toFixed(2))
        : 0

    results.push({ item_id, name: item.name, category: item.category, unit: item.unit, start_count: startCount, end_count: endCount, consumed })
  }

  // Sort by consumed desc (most used first), filter out items never counted
  results.sort((a, b) => b.consumed - a.consumed)

  return NextResponse.json(results)
}
