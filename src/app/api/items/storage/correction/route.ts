import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { applyStorageCorrection } from '@/lib/storage-server'

// Patch 38: owner-only. Sets storage to an exact new number (a miscount
// fix) -- the signed difference from the old value is logged as the
// history row's amount. Store is untouched.
export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json()
  const { id, new_value, note } = body as { id?: unknown; new_value?: unknown; note?: unknown }
  if (typeof id !== 'string' || !id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const result = await applyStorageCorrection(db, {
    itemId: id,
    newValue: typeof new_value === 'number' ? new_value : NaN,
    byName: auth.session.name,
    note: typeof note === 'string' ? note : null,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json(result.item)
}
