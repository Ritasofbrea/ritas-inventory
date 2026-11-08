import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { weekStartMonday } from '@/lib/vendor-schedule'
import { todayInTZ } from '@/lib/tasks'

// Marks a vendor's CURRENT week handled ("Order Placed" or "Nothing to
// order this week") — owner-only, matching the Order List page's own
// gating. week_start is computed server-side from the real current Pacific
// date, never trusted from the client, so a stale or spoofed value can't
// silence a different week than the one actually showing on screen.
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

  const weekStart = weekStartMonday(todayInTZ())
  const { data, error } = await db
    .from('vendor_week_status')
    .upsert(
      { vendor: vendor.trim(), week_start: weekStart, status, resolved_by: auth.session.name, resolved_at: new Date().toISOString() },
      { onConflict: 'vendor,week_start' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
