import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'

// Owner-only: "Enable Notifications" only renders inside Navigation's
// owner-only More dropdown (src/components/Navigation.tsx) — no shift_lead
// or staff screen exposes it today.
export async function POST(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { endpoint, keys } = await request.json()
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  }
  const { error } = await db
    .from('push_subscriptions')
    .upsert({ endpoint, p256dh: keys.p256dh, auth: keys.auth }, { onConflict: 'endpoint' })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// Patch 29 A1: this used to delete every row in the table (neq('endpoint',
// '') matches everything) — turning off notifications on one device wiped
// every device's subscription. No UI feature calls this today (grepped —
// only POST above has a caller), so the bug was latent, not yet triggered
// in practice; fixed anyway now that a real "turn off" button could call it
// safely. Deletes only the endpoint the caller sends.
export async function DELETE(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { endpoint } = await request.json()
  if (typeof endpoint !== 'string' || !endpoint) {
    return NextResponse.json({ error: 'Missing endpoint' }, { status: 400 })
  }
  const { error } = await db.from('push_subscriptions').delete().eq('endpoint', endpoint)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
