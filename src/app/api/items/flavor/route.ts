import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'

// Patch 45: the only route that can change items.flavor_id. Owner-only --
// same reasoning as pack_size/is_off/storage having their own owner-only
// routes separate from the shared SL+ /api/items PATCH. flavor_id null
// clears the link (allowed regardless of the flavor's active state); a
// non-null value is validated against the real flavors table -- 400 if it
// doesn't exist, so a stale or tampered id can never silently no-op.
export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { id, flavor_id } = await request.json()
  if (typeof id !== 'string' || !id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  }
  if (flavor_id !== null && typeof flavor_id !== 'string') {
    return NextResponse.json({ error: 'flavor_id must be a string or null' }, { status: 400 })
  }

  if (flavor_id !== null) {
    const { data: flavor, error: flavorError } = await db.from('flavors').select('id').eq('id', flavor_id).maybeSingle()
    if (flavorError) return NextResponse.json({ error: flavorError.message }, { status: 500 })
    if (!flavor) return NextResponse.json({ error: 'Flavor not found' }, { status: 400 })
  }

  const { data, error } = await db
    .from('items')
    .update({ flavor_id })
    .eq('id', id)
    .select('*, flavor:flavors(id, name, type, program, active)')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
