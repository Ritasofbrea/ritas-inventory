import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'

// One week's filled slots, sparse (an empty slot just has no row — see
// supabase/add-flavors.sql). A week that's never had a slot touched has no
// flavor_weeks row at all yet, which just means an empty slot list here.
export async function GET(request: NextRequest) {
  const weekStart = new URL(request.url).searchParams.get('week_start')
  if (!weekStart) return NextResponse.json({ error: 'Missing week_start' }, { status: 400 })

  const db = getServerSupabase()
  const { data: week, error: weekError } = await db
    .from('flavor_weeks')
    .select('id')
    .eq('week_start', weekStart)
    .maybeSingle()
  if (weekError) return NextResponse.json({ error: weekError.message }, { status: 500 })
  if (!week) return NextResponse.json({ week_start: weekStart, slots: [] })

  const { data: slots, error } = await db
    .from('flavor_week_slots')
    .select('slot_number, flavor_id, flavor_name')
    .eq('week_id', week.id)
    .order('slot_number')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ week_start: weekStart, slots: slots ?? [] })
}

// Fill, change, or clear one slot. flavor_id: null clears it (deletes the
// row). Owner/shift-lead gating (same tier as "+ Add Task") is enforced
// client-side only — the picker is hidden from regular staff — same as
// every other owner-only action in this app.
export async function PATCH(request: NextRequest) {
  const { week_start, slot_number, flavor_id } = await request.json()
  if (typeof week_start !== 'string' || !week_start) {
    return NextResponse.json({ error: 'Missing week_start' }, { status: 400 })
  }
  if (typeof slot_number !== 'number' || slot_number < 1 || slot_number > 12) {
    return NextResponse.json({ error: 'slot_number must be between 1 and 12' }, { status: 400 })
  }

  const db = getServerSupabase()
  const { data: week, error: weekError } = await db
    .from('flavor_weeks')
    .upsert({ week_start }, { onConflict: 'week_start' })
    .select('id')
    .single()
  if (weekError) return NextResponse.json({ error: weekError.message }, { status: 500 })

  if (!flavor_id) {
    const { error } = await db
      .from('flavor_week_slots')
      .delete()
      .eq('week_id', week.id)
      .eq('slot_number', slot_number)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ slot_number, flavor_id: null, flavor_name: null })
  }

  // flavor_name is looked up here, not trusted from the client, so the
  // snapshot always reflects the catalog's actual name at pick time.
  const { data: flavor, error: flavorError } = await db
    .from('flavors')
    .select('name')
    .eq('id', flavor_id)
    .maybeSingle()
  if (flavorError) return NextResponse.json({ error: flavorError.message }, { status: 500 })
  if (!flavor) return NextResponse.json({ error: 'Flavor not found' }, { status: 404 })

  const { data, error } = await db
    .from('flavor_week_slots')
    .upsert({ week_id: week.id, slot_number, flavor_id, flavor_name: flavor.name }, { onConflict: 'week_id,slot_number' })
    .select('slot_number, flavor_id, flavor_name')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
