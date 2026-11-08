import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { weekStartMonday } from '@/lib/vendor-schedule'
import { todayInTZ } from '@/lib/tasks'

// Durable audit trail (vendor_week_status_log, supabase/add-vendor-week-
// status-log.sql) of every Order Placed / Nothing to order / Undo press —
// vendor_week_status itself only ever holds ONE current-state row per
// (vendor, week_start), which switching or undoing overwrites or deletes,
// so without this the fact a decision was ever made/changed would be
// lost. Best-effort and never thrown: if that migration hasn't been run
// yet, the actual mark/switch/undo still works exactly the same — only
// the audit trail is temporarily unavailable, not the feature itself.
async function logVendorWeekAction(db: SupabaseClient, vendor: string, weekStart: string, action: 'ordered' | 'skipped' | 'undone', by: string | null) {
  try {
    await db.from('vendor_week_status_log').insert({ vendor, week_start: weekStart, action, by })
  } catch {
    // best-effort audit trail — see comment above
  }
}

// Marks a vendor's CURRENT week handled ("Order Placed" or "Nothing to
// order this week") — owner-only, matching the Order List page's own
// gating. week_start is computed server-side from the real current Pacific
// date, never trusted from the client, so a stale or spoofed value can't
// silence a different week than the one actually showing on screen.
//
// Fix: this already correctly SWITCHES an existing mark (upsert
// overwrites status/resolved_by/resolved_at regardless of what it was
// before) — pressing "Order Placed" after "Nothing to order" (or vice
// versa) always worked at this layer. What didn't work was the UI only
// ever showing one set of buttons before a mark existed; that's fixed in
// order-list/page.tsx, not here.
export async function POST(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { vendor, status } = await request.json()
  if (typeof vendor !== 'string' || !vendor.trim()) {
    return NextResponse.json({ error: 'Missing vendor' }, { status: 400 })
  }
  if (status !== 'ordered' && status !== 'skipped') {
    return NextResponse.json({ error: "status must be 'ordered' or 'skipped'" }, { status: 400 })
  }

  const trimmedVendor = vendor.trim()
  const weekStart = weekStartMonday(todayInTZ())
  const { data, error } = await db
    .from('vendor_week_status')
    .upsert(
      { vendor: trimmedVendor, week_start: weekStart, status, resolved_by: auth.session.name, resolved_at: new Date().toISOString() },
      { onConflict: 'vendor,week_start' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await logVendorWeekAction(db, trimmedVendor, weekStart, status, auth.session.name)
  return NextResponse.json(data)
}

// "Undo" — clears a vendor's mark for the CURRENT week entirely (deletes
// the vendor_week_status row), which is exactly what makes
// computeVendorDueInfo treat that vendor as pending again: its due-tag and
// action buttons come back exactly as if nothing had been pressed yet, no
// separate "undone" status needed in that table. The fact it happened is
// still recorded in vendor_week_status_log. Owner-only; week_start is
// computed server-side, same reasoning as POST.
export async function DELETE(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { vendor } = await request.json()
  if (typeof vendor !== 'string' || !vendor.trim()) {
    return NextResponse.json({ error: 'Missing vendor' }, { status: 400 })
  }

  const trimmedVendor = vendor.trim()
  const weekStart = weekStartMonday(todayInTZ())
  const { data, error } = await db
    .from('vendor_week_status')
    .delete()
    .eq('vendor', trimmedVendor)
    .eq('week_start', weekStart)
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (data && data.length > 0) {
    await logVendorWeekAction(db, trimmedVendor, weekStart, 'undone', auth.session.name)
  }
  return NextResponse.json({ ok: true, cleared: (data ?? []).length > 0 })
}
