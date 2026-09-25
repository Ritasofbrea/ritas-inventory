import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { todayInTZ } from '@/lib/tasks'
import { generateInstancesForDate } from '@/lib/task-server'

// Hit daily by Vercel Cron (see vercel.json). Safe to call repeatedly — never creates duplicates.
// Vercel automatically sends `Authorization: Bearer $CRON_SECRET` on cron invocations when
// that env var is set on the project (there is no per-job headers setting in vercel.json).
// Fails closed: with no CRON_SECRET configured, every request is rejected.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const date = todayInTZ()
  try {
    const result = await generateInstancesForDate(getServerSupabase(), date)
    return NextResponse.json({ date, ...result })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Generation failed' }, { status: 500 })
  }
}
