import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'

export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { data, error } = await db
    .from('inventory_counts')
    .select('item_id, created_at, entered_by')
    .eq('type', 'count')
    .eq('is_test_data', false)
    .order('created_at', { ascending: false })
    .limit(1000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Deduplicate — first occurrence per item_id is the most recent
  const seen = new Set<string>()
  const result: { item_id: string; created_at: string; entered_by: string }[] = []
  for (const row of (data ?? [])) {
    if (!seen.has(row.item_id)) {
      seen.add(row.item_id)
      result.push(row as { item_id: string; created_at: string; entered_by: string })
    }
  }

  return NextResponse.json(result)
}
