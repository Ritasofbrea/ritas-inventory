import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { normalizeVendorCode } from '@/lib/vendor-code'

// Patch 67: the only route that can change items.vendor_item_code.
// Owner-only, same reasoning as pack_size/flavor_id/is_off: invoice
// matching relies on these codes, so a shift_lead session must never be
// able to set one (the shared SL+ PATCH /api/items no longer accepts it).
//
// PATCH { id, vendor_item_code, confirm_shared? }
//   - the code is cleaned by normalizeVendorCode (capitals, no spaces,
//     letters/numbers/hyphens, max 20); blank clears it
//   - if the code is already on a DIFFERENT item and confirm_shared isn't
//     true, nothing is saved: 409 { error: 'code_in_use', code, conflicts: [{ id, name }] }
//     (some vendor codes are legitimately shared, so the owner can confirm)
export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const cleaned = normalizeVendorCode(body.vendor_item_code)
  if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 })
  const code = cleaned.code

  const { data: item, error: itemError } = await db.from('items').select('id, vendor_item_code').eq('id', id).maybeSingle()
  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 })
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 })

  // Re-saving the code the item already has never warns (the owner already
  // confirmed it when it was first shared).
  if (code && code !== item.vendor_item_code && body.confirm_shared !== true) {
    const { data: others, error: othersError } = await db
      .from('items')
      .select('id, name')
      .eq('vendor_item_code', code)
      .neq('id', id)
      .order('name')
    if (othersError) return NextResponse.json({ error: othersError.message }, { status: 500 })
    if (others && others.length > 0) {
      return NextResponse.json({ error: 'code_in_use', code, conflicts: others }, { status: 409 })
    }
  }

  const { data, error } = await db
    .from('items')
    .update({ vendor_item_code: code })
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
