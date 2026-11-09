import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'

export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  // Patch 45: embeds each item's linked flavor (name/type/program/active)
  // via the flavor_id FK in the same query — a per-row join, not a second
  // bulk fetch, so it's immune to the 1000-row cap that applies to a
  // growing log table (flavors is a small, bounded catalog table, same as
  // items itself). null when flavor_id is null, exactly like today.
  const { data, error } = await db
    .from('items')
    .select('*, flavor:flavors(id, name, type, program, active)')
    .order('category')
    .order('sort_order')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json()
  const { name, category, unit, secondary_unit, units_per_sub_unit, distributor, item_number, distributor_item_name } = body

  if (!name || !category || !unit)
    return NextResponse.json({ error: 'Missing name, category, or unit' }, { status: 400 })

  const { data: existing } = await db
    .from('items')
    .select('sort_order')
    .eq('category', category)
    .order('sort_order', { ascending: false })
    .limit(1)
    .single()

  const sort_order = existing ? existing.sort_order + 10 : 10

  const insertData: Record<string, string | number> = { name, category, unit, sort_order, par_level: 0, current_count: 0 }
  if (secondary_unit) insertData.secondary_unit = secondary_unit
  if (units_per_sub_unit !== undefined && units_per_sub_unit !== null) insertData.units_per_sub_unit = units_per_sub_unit
  if (distributor) insertData.distributor = distributor
  if (item_number) insertData.item_number = item_number
  if (distributor_item_name) insertData.distributor_item_name = distributor_item_name

  const { data, error } = await db
    .from('items')
    .insert(insertData)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Patch 29: SL+ (not owner-only) — Count Entry/Adjustment/Receive Order all
// bump current_count through this same endpoint that Manage Items uses for
// full-record edits (name/par/distributor/etc.), and they're all shift_lead
// accessible. More permissive than ideal (a shift_lead session can also
// rename an item through here), flagged in route-access.md, not split by
// field this patch.
// Patch 37: is_off is deliberately NOT destructured/whitelisted here, even
// though this route is SL+. It must only ever change through the owner-only
// PATCH /api/items/off route (403 for shift_lead/staff) -- if a caller sends
// is_off in this body it's silently ignored, same as any other unlisted
// field. Do not add it to the whitelist below.
// Patch 38: same treatment for has_storage/storage_count/storage_updated_at
// -- they only ever change through the owner-only /api/items/storage*
// routes (storage_count specifically only via applyStorageChange/
// applyStorageCorrection in src/lib/storage-server.ts, which also writes
// the storage_moves history row a direct update here would skip). Do not
// add any of the three to the whitelist below.
// Patch 44: pack_size is likewise owner-only, via /api/items/pack-size.
// Patch 45: same for flavor_id -- owner-only via /api/items/flavor, which
// also validates the flavor actually exists (400 otherwise). A shift_lead
// session must never be able to set it through this shared route; if a
// caller sends flavor_id here it's silently ignored, same as the others.
export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const body = await request.json()
  const { id, current_count, par_level, par_level_secondary, name, category, unit, secondary_count, secondary_unit, units_per_sub_unit, distributor, item_number, distributor_item_name, supplier_order } = body

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const updates: Record<string, number | string | null> = {}
  if (current_count !== undefined) updates.current_count = current_count
  if (par_level !== undefined) updates.par_level = par_level
  if (par_level_secondary !== undefined) updates.par_level_secondary = par_level_secondary
  // Bug fix (patch 53): same silent-failure shape as the category bug --
  // Manage Items' up/down reorder arrows (moveItem) have always PATCHed
  // only { id, supplier_order }, but this field was never whitelisted, so
  // every reorder returned 400 "Nothing to update" (the client never
  // checked the response and optimistically updated local state anyway,
  // so the UI looked like it worked until the next refresh/re-sort).
  if (supplier_order !== undefined) updates.supplier_order = supplier_order
  // Patch 53: the Manage Items Save button already disables itself for a
  // blank name, but items.name has no DB-level check -- a blank name sent
  // directly to this route (bypassing that UI guard) used to succeed
  // silently. Reject it explicitly instead.
  if (name !== undefined) {
    if (!name.trim()) return NextResponse.json({ error: "Name can't be blank." }, { status: 400 })
    updates.name = name
  }
  // Bug fix: Manage Items' edit form has always sent `category` in this
  // PATCH body (it's in the same request as name/unit/distributor/etc.),
  // but it was never destructured or added to `updates` above — a category
  // change silently had no effect: the request returned 200 with the
  // item's OLD category (nothing else in the row changed either), so the
  // UI had no reason to show an error, and a refresh "reverted" a change
  // that had in fact never been saved. No DB constraint or category-name
  // mismatch was involved — items.category is plain `text`, and the
  // Manage Items dropdown's CATEGORIES list (src/lib/types.ts) already
  // matches real stored values exactly, 'Syrups' included.
  if (category !== undefined) updates.category = category
  if (unit !== undefined) updates.unit = unit
  if (secondary_count !== undefined) updates.secondary_count = secondary_count
  if (secondary_unit !== undefined) updates.secondary_unit = secondary_unit
  if (units_per_sub_unit !== undefined) updates.units_per_sub_unit = units_per_sub_unit
  if (distributor !== undefined) updates.distributor = distributor
  if (item_number !== undefined) updates.item_number = item_number
  if (distributor_item_name !== undefined) updates.distributor_item_name = distributor_item_name

  // Defense-in-depth for the same failure mode in general: if nothing in
  // the body matched anything this route knows how to update (a typo'd or
  // future unlisted field), say so explicitly instead of silently
  // "succeeding" with a no-op update and an unchanged row — same
  // reasoning/shape as /api/owners/alerts PATCH's equivalent guard.
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await db
    .from('items')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error } = await db.from('items').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
