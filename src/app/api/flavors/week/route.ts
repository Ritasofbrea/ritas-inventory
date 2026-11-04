import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { sectionForSlot } from '@/lib/flavors'

// One week's filled slots, sparse (an empty slot just has no row — see
// supabase/add-flavors.sql). A week that's never had a slot touched has no
// flavor_weeks row at all yet, which just means an empty slot list here.
export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead', 'staff'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const weekStart = new URL(request.url).searchParams.get('week_start')
  if (!weekStart) return NextResponse.json({ error: 'Missing week_start' }, { status: 400 })

  const { data: week, error: weekError } = await db
    .from('flavor_weeks')
    .select('id')
    .eq('week_start', weekStart)
    .maybeSingle()
  if (weekError) return NextResponse.json({ error: weekError.message }, { status: 500 })
  if (!week) return NextResponse.json({ week_start: weekStart, slots: [] })

  const { data: slots, error } = await db
    .from('flavor_week_slots')
    .select('slot_number, flavor_id, flavor_name, flavor_type')
    .eq('week_id', week.id)
    .order('slot_number')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ week_start: weekStart, slots: slots ?? [] })
}

// Fill, change, or clear one slot. flavor_id: null clears it (deletes the
// row). Owner/shift-lead gating (same tier as "+ Add Task"; patch 29: now
// server-enforced — Flavors page's canManage has no staff PIN-unlock escape
// hatch, unlike the todo page, so this is a clean SL+ gate).
export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { week_start, slot_number, flavor_id } = await request.json()
  if (typeof week_start !== 'string' || !week_start) {
    return NextResponse.json({ error: 'Missing week_start' }, { status: 400 })
  }
  if (typeof slot_number !== 'number') {
    return NextResponse.json({ error: 'Missing slot_number' }, { status: 400 })
  }
  // Patch 32: slot_number must fall in one of the three sections' current
  // ranges (ice 1-12, soft serve 101-103, HS custard 201-212) — not just
  // the wider range the DB's CHECK constraint allows for future growth.
  const section = sectionForSlot(slot_number)
  if (!section) {
    return NextResponse.json({ error: 'slot_number is not in a valid section range' }, { status: 400 })
  }

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
    return NextResponse.json({ slot_number, flavor_id: null, flavor_name: null, flavor_type: null })
  }

  // flavor_name and flavor_type are looked up here, not trusted from the
  // client, so the snapshot always reflects the catalog's actual values at
  // pick time.
  const { data: flavor, error: flavorError } = await db
    .from('flavors')
    .select('name, type')
    .eq('id', flavor_id)
    .maybeSingle()
  if (flavorError) return NextResponse.json({ error: flavorError.message }, { status: 500 })
  if (!flavor) return NextResponse.json({ error: 'Flavor not found' }, { status: 404 })
  if (!section.types.includes(flavor.type)) {
    return NextResponse.json({ error: `That flavor isn't a ${section.label} flavor` }, { status: 400 })
  }

  const { data, error } = await db
    .from('flavor_week_slots')
    .upsert(
      { week_id: week.id, slot_number, flavor_id, flavor_name: flavor.name, flavor_type: flavor.type },
      { onConflict: 'week_id,slot_number' }
    )
    .select('slot_number, flavor_id, flavor_name, flavor_type')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
