import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'

type MappingRow = {
  id: string
  quantity: number
  inventory_item_id: string
  items: { id: string; name: string; unit: string } | null
}

type CloverItemRow = {
  clover_id: string
  name: string
  category: string | null
  price: number | null
  clover_item_mappings: MappingRow[]
}

export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { data, error } = await db
    .from('clover_items')
    .select(`
      clover_id,
      name,
      category,
      price,
      clover_item_mappings (
        id,
        quantity,
        inventory_item_id,
        items ( id, name, unit )
      )
    `)
    .order('category')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json((data as unknown) as CloverItemRow[])
}
