import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { applyStorageChange } from '@/lib/storage-server'

// Patch 38: owner-only. Moves `amount` from storage to the store: storage
// down, store (current_count) up by the same amount, combined total
// unchanged. Rejects (400) if amount exceeds what's currently in storage.
export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json()
  const { id, amount, note } = body as { id?: unknown; amount?: unknown; note?: unknown }
  if (typeof id !== 'string' || !id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const result = await applyStorageChange(db, {
    itemId: id,
    kind: 'move_to_store',
    amount: typeof amount === 'number' ? amount : NaN,
    byName: auth.session.name,
    note: typeof note === 'string' ? note : null,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.item)
}
