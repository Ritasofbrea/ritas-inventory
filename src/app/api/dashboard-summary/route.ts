import { NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'

export async function GET() {
  const db = getServerSupabase()

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
