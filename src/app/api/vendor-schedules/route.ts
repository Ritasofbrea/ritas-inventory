import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { computeVendorDueInfo, VendorSchedule, VendorWeekStatusRow } from '@/lib/vendor-schedule'
import { getItemsNeedingOrderByVendor } from '@/lib/order-list-server'
import { todayInTZ } from '@/lib/tasks'

// Owner-only, same as the Order List page itself (role==='owner' or
// redirected) — vendor schedules only ever matter to that screen, the
// Dashboard due-vendor line, and the in-app banner, all owner-only today.
export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const today = todayInTZ()
  const [{ data: schedules, error: schedError }, byVendor] = await Promise.all([
    db.from('vendor_schedules').select('*').order('vendor'),
    getItemsNeedingOrderByVendor(db).catch(() => ({} as Record<string, { id: string }[]>)),
  ])
  if (schedError) return NextResponse.json({ error: schedError.message }, { status: 500 })

  const rows = (schedules ?? []) as VendorSchedule[]
  const vendors = rows.map((r) => r.vendor)
  let weekStatusRows: VendorWeekStatusRow[] = []
  if (vendors.length > 0) {
    const { data: weekStatus, error: weekError } = await db
      .from('vendor_week_status')
      .select('vendor, week_start, status, resolved_by, resolved_at')
      .in('vendor', vendors)
    if (weekError) return NextResponse.json({ error: weekError.message }, { status: 500 })
    weekStatusRows = (weekStatus ?? []) as VendorWeekStatusRow[]
  }

  const result = rows.map((schedule) => {
    const info = computeVendorDueInfo(schedule, weekStatusRows, today)
    return { ...schedule, ...info, itemCount: (byVendor[schedule.vendor] ?? []).length }
  })

  return NextResponse.json(result)
}

// Upserts one vendor's schedule row — lets an owner add a schedule for a
// currently-anytime vendor, not just edit Balford/Bunzl's seeded rows.
// Every field is optional except `vendor`; omitted fields keep their
// current (or column-default, on insert) value.
export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const body = await request.json()
  const { vendor, order_day, cutoff_time, reminder_start_time, reminder_interval_minutes, override_date, active } = body

  if (typeof vendor !== 'string' || !vendor.trim()) {
    return NextResponse.json({ error: 'Missing vendor' }, { status: 400 })
  }
  if (order_day !== undefined && order_day !== null && (typeof order_day !== 'number' || order_day < 0 || order_day > 6)) {
    return NextResponse.json({ error: 'order_day must be 0-6 or null' }, { status: 400 })
  }
  if (reminder_interval_minutes !== undefined && (typeof reminder_interval_minutes !== 'number' || reminder_interval_minutes <= 0)) {
    return NextResponse.json({ error: 'reminder_interval_minutes must be a positive number' }, { status: 400 })
  }
  const timePattern = /^\d{2}:\d{2}(:\d{2})?$/
  for (const [label, value] of [['cutoff_time', cutoff_time], ['reminder_start_time', reminder_start_time]] as const) {
    if (value !== undefined && !timePattern.test(value)) {
      return NextResponse.json({ error: `${label} must be HH:MM` }, { status: 400 })
    }
  }
  if (override_date !== undefined && override_date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(override_date)) {
    return NextResponse.json({ error: 'override_date must be YYYY-MM-DD or null' }, { status: 400 })
  }

  const updates: Record<string, unknown> = { vendor: vendor.trim() }
  if (order_day !== undefined) updates.order_day = order_day
  if (cutoff_time !== undefined) updates.cutoff_time = cutoff_time
  if (reminder_start_time !== undefined) updates.reminder_start_time = reminder_start_time
  if (reminder_interval_minutes !== undefined) updates.reminder_interval_minutes = reminder_interval_minutes
  if (override_date !== undefined) updates.override_date = override_date
  if (active !== undefined) updates.active = active

  const { data, error } = await db
    .from('vendor_schedules')
    .upsert(updates, { onConflict: 'vendor' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
