import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { applyStorageChange } from '@/lib/storage-server'

// Patch 38: owner-only. Bulk purchase arrives directly into storage.
// Positive amount only -- storage up, store untouched.
export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json()
  const { id, amount, note } = body as { id?: unknown; amount?: unknown; note?: unknown }
  if (typeof id !== 'string' || !id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const result = await applyStorageChange(db, {
    itemId: id,
    kind: 'add',
    amount: typeof amount === 'number' ? amount : NaN,
    byName: auth.session.name,
    note: typeof note === 'string' ? note : null,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.item)
}
