import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'

// Suggest par = ceil(weekly_avg_consumption * 1.5), minimum 1 week of buffer.
// Only returns items with at least 2 count records in the last 90 days.
export async function GET() {
  const db = getServerSupabase()
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await db
    .from('inventory_counts')
    .select('item_id, count, created_at, items(name, unit)')
    .eq('type', 'count')
    .eq('is_test_data', false)
    .gte('created_at', since)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type Row = { item_id: string; count: number; created_at: string; items: { name: string; unit: string } | null }
  const byItem: Record<string, { name: string; unit: string; records: { count: number; ts: number }[] }> = {}

  for (const row of (data as unknown) as Row[]) {
    if (!row.items) continue
    if (!byItem[row.item_id]) {
      byItem[row.item_id] = { name: row.items.name, unit: row.items.unit, records: [] }
    }
    byItem[row.item_id].records.push({ count: row.count, ts: new Date(row.created_at).getTime() })
  }

  const suggestions: Record<string, { name: string; unit: string; suggested_par: number; weekly_avg: number }> = {}

  for (const [item_id, item] of Object.entries(byItem)) {
    if (item.records.length < 2) continue

    const first = item.records[0]
    const last = item.records[item.records.length - 1]
    const consumed = first.count - last.count
    if (consumed <= 0) continue

    const weeks = (last.ts - first.ts) / (7 * 24 * 60 * 60 * 1000)
    if (weeks < 0.5) continue // need at least half a week of data

    const weeklyAvg = consumed / weeks
    // Par = 1.5 weeks of stock, rounded up to nearest whole number, minimum 1
    const suggested = Math.max(1, Math.ceil(weeklyAvg * 1.5))

    suggestions[item_id] = {
      name: item.name,
      unit: item.unit,
      suggested_par: suggested,
      weekly_avg: parseFloat(weeklyAvg.toFixed(2)),
    }
  }

  return NextResponse.json(suggestions)
}
