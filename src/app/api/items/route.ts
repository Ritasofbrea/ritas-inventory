import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'

export async function GET() {
  const db = getServerSupabase()
  const { data, error } = await db
    .from('items')
    .select('*')
    .order('category')
    .order('sort_order')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
  const body = await request.json()
  const { name, category, unit, secondary_unit, units_per_sub_unit, distributor, item_number, distributor_item_name } = body

  if (!name || !category || !unit)
    return NextResponse.json({ error: 'Missing name, category, or unit' }, { status: 400 })

  const db = getServerSupabase()

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

export async function PATCH(request: NextRequest) {
  const body = await request.json()
  const { id, current_count, par_level, par_level_secondary, name, unit, secondary_count, secondary_unit, units_per_sub_unit, distributor, item_number, distributor_item_name } = body

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const updates: Record<string, number | string | null> = {}
  if (current_count !== undefined) updates.current_count = current_count
  if (par_level !== undefined) updates.par_level = par_level
  if (par_level_secondary !== undefined) updates.par_level_secondary = par_level_secondary
  if (name !== undefined) updates.name = name
  if (unit !== undefined) updates.unit = unit
  if (secondary_count !== undefined) updates.secondary_count = secondary_count
  if (secondary_unit !== undefined) updates.secondary_unit = secondary_unit
  if (units_per_sub_unit !== undefined) updates.units_per_sub_unit = units_per_sub_unit
  if (distributor !== undefined) updates.distributor = distributor
  if (item_number !== undefined) updates.item_number = item_number
  if (distributor_item_name !== undefined) updates.distributor_item_name = distributor_item_name

  const db = getServerSupabase()
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
  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const db = getServerSupabase()
  const { error } = await db.from('items').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
