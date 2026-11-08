import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'
import { subsForOwner, sendPushToSubs } from '@/lib/push-server'

const OWNER_NAMES = ['Josh', 'Gina']

// "Send me a test notification" — owner-only. Deliberately bypasses both
// owners' alert switches (subsForOwner, not subsForOwnersWithAlert): this
// tests DEVICE LINKAGE itself, not whether a real reminder would currently
// be allowed through. Always scoped to exactly the one named owner's own
// devices — never reachable through the other owner's switch or request.
export async function POST(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const { name } = await request.json()
  if (typeof name !== 'string' || !OWNER_NAMES.includes(name)) {
    return NextResponse.json({ error: 'Unknown owner' }, { status: 400 })
  }

  const subs = await subsForOwner(db, name)
  if (subs.length === 0) return NextResponse.json({ sent: 0 })

  const { sent } = await sendPushToSubs(db, subs, {
    title: 'Test Notification',
    body: `If you see this, notifications are linked for ${name}.`,
  })
  return NextResponse.json({ sent })
}
