import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { requireRole } from '@/lib/session'

export async function GET(request: NextRequest) {
  const db = getServerSupabase()
  const auth = await requireRole(db, request, ['owner', 'shift_lead'])
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const [countRes, receivedRes] = await Promise.all([
    db
      .from('inventory_counts')
      .select('created_at, entered_by')
      .eq('is_test_data', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('order_history')
      .select('created_at, received_by, type')
      .in('type', ['received', 'will_call'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return NextResponse.json({
    lastCount: countRes.data ?? null,
    lastReceived: receivedRes.data ?? null,
  })
}
