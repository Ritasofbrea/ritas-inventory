import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { runBatched } from '@/lib/usage-server'

type LastRow = { item_id: string; created_at: string; entered_by: string }

// Latest inventory_counts row of any type (count or adjustment, test or
// real -- same as the old bulk query, which had no type/is_test_data
// filter), for one item. Backed by idx_inventory_counts_item_created.
async function fetchLatestRowAnyType(
  db: SupabaseClient,
  itemId: string
): Promise<LastRow | null> {
  const { data } = await db
    .from('inventory_counts')
    .select('item_id, created_at, entered_by')
    .eq('item_id', itemId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as LastRow) ?? null
}

export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // Patch 41: the old query pulled the newest 1000 inventory_counts rows
  // table-wide and deduped first-occurrence-per-item -- an item whose most
  // recent activity fell outside that newest-1000 window silently vanished
  // from Current Stock / the Dashboard's "last counted" column. Per-item
  // point queries against the bounded `items` catalog table guarantee
  // every item that has ever been counted gets its own real latest row,
  // regardless of how large inventory_counts grows.
  const { data: items, error: itemsError } = await db.from('items').select('id')
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })

  const itemIds = (items ?? []).map((i) => (i as { id: string }).id)
  const rows = await runBatched(itemIds, (id) => fetchLatestRowAnyType(db, id))
  const result = rows.filter((r): r is LastRow => r !== null)

  return NextResponse.json(result)
}
