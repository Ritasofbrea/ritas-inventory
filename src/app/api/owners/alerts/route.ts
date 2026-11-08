import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'

// Same hardcoded real-owner allowlist /api/pins already uses — ZZTEST
// Owner is a real `owners` row (so its session passes requireRole) but is
// invisible everywhere the app lists owners by name, this included.
const OWNER_NAMES = ['Josh', 'Gina']

// Lists Josh's and Gina's two independent alert switches (order reminders,
// receipt-note alerts) — owner-only, same self-service pattern as Change
// PIN: either owner can view or change either switch.
export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { data, error } = await db
    .from('owners')
    .select('name, order_alerts_enabled, receipt_note_alerts_enabled')
    .in('name', OWNER_NAMES)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { name, order_alerts_enabled, receipt_note_alerts_enabled } = await request.json()
  if (typeof name !== 'string' || !OWNER_NAMES.includes(name)) {
    return NextResponse.json({ error: 'Unknown owner' }, { status: 400 })
  }

  const updates: Record<string, boolean> = {}
  if (order_alerts_enabled !== undefined) {
    if (typeof order_alerts_enabled !== 'boolean') return NextResponse.json({ error: 'order_alerts_enabled must be boolean' }, { status: 400 })
    updates.order_alerts_enabled = order_alerts_enabled
  }
  if (receipt_note_alerts_enabled !== undefined) {
    if (typeof receipt_note_alerts_enabled !== 'boolean') return NextResponse.json({ error: 'receipt_note_alerts_enabled must be boolean' }, { status: 400 })
    updates.receipt_note_alerts_enabled = receipt_note_alerts_enabled
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await db
    .from('owners')
    .update(updates)
    .eq('name', name)
    .select('name, order_alerts_enabled, receipt_note_alerts_enabled')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
