import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const start = searchParams.get('start')
  const end = searchParams.get('end')

  if (!start || !end) {
    return NextResponse.json({ error: 'Missing start or end date' }, { status: 400 })
  }

  // Fetch all count records up through the end date, newest first
  const startMs = new Date(start).setHours(23, 59, 59, 999)
  const endMs = new Date(end).setHours(23, 59, 59, 999)

  const db = getServerSupabase()
  const { data, error } = await db
    .from('inventory_counts')
    .select('item_id, count, created_at, items(name, category, unit)')
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

  for (const [item_id, item] of Object.entries(byItem)) {
    // records are newest first; find latest on/before start and latest on/before end
    const startRecord = item.records.find((r) => r.ts <= startMs)
    const endRecord = item.records.find((r) => r.ts <= endMs)

    const startCount = startRecord?.count ?? null
    const endCount = endRecord?.count ?? null

    // consumed = what was there at start minus what's left at end
    const consumed =
      startCount !== null && endCount !== null
        ? parseFloat((startCount - endCount).toFixed(2))
        : 0

    results.push({ item_id, name: item.name, category: item.category, unit: item.unit, start_count: startCount, end_count: endCount, consumed })
  }

  // Sort by consumed desc (most used first), filter out items never counted
  results.sort((a, b) => b.consumed - a.consumed)

  return NextResponse.json(results)
}
