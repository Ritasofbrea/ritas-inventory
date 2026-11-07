import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'

// Patch 38: owner-only. Flips has_storage on/off for one item. No history
// row -- storage_moves tracks changes to storage_count, not this flag
// (same precedent as patch 37's is_off, which also isn't logged). Turning
// has_storage off does NOT clear storage_count -- flipping it back on
// later picks up wherever it was left, same spirit as deactivate-over-
// delete.
export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json()
  const { id, has_storage } = body as { id?: unknown; has_storage?: unknown }

  if (typeof id !== 'string' || !id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  if (typeof has_storage !== 'boolean') return NextResponse.json({ error: 'Missing has_storage' }, { status: 400 })

  const { data, error } = await db.from('items').update({ has_storage }).eq('id', id).select().maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Item not found' }, { status: 404 })
  return NextResponse.json(data)
}
