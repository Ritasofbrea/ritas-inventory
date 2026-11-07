import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'

// Patch 37: the only route that can change items.is_off. Owner-only --
// separate from the shared SL+ /api/items PATCH, which deliberately ignores
// is_off (see its own comment). Takes one or many ids in a single request
// (Manage Items' per-item switch and bulk Turn On/Off both call this).
// Validates every id exists before writing anything -- all or nothing, so a
// bad id in a bulk selection can't leave some items toggled and others not.
export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json()
  const { ids, is_off } = body as { ids?: unknown; is_off?: unknown }

  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string' && id.length > 0)) {
    return NextResponse.json({ error: 'Missing or invalid ids' }, { status: 400 })
  }
  if (typeof is_off !== 'boolean') {
    return NextResponse.json({ error: 'Missing is_off' }, { status: 400 })
  }

  const uniqueIds = Array.from(new Set(ids as string[]))

  const { data: existing, error: existingError } = await db
    .from('items')
    .select('id')
    .in('id', uniqueIds)
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })
  if (!existing || existing.length !== uniqueIds.length) {
    return NextResponse.json({ error: 'One or more items not found' }, { status: 400 })
  }

  const { data, error } = await db
    .from('items')
    .update({ is_off })
    .in('id', uniqueIds)
    .select()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
