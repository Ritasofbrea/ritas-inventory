import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'

// Patch 44: the only route that can change items.pack_size. Owner-only —
// separate from the shared SL+ /api/items PATCH (same reasoning as
// is_off/storage fields having their own owner-only routes: pack_size feeds
// order-quantity math, so a shift_lead session must never be able to set
// it through the generic items PATCH).
export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id, pack_size } = await request.json()
  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }
  if (pack_size !== null && (typeof pack_size !== 'number' || !Number.isInteger(pack_size) || pack_size <= 0)) {
    return NextResponse.json({ error: 'pack_size must be a positive integer or null' }, { status: 400 })
  }

  const { data, error } = await db
    .from('items')
    .update({ pack_size })
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
