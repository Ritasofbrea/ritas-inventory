import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { cleanupOldTaskPhotos } from '@/lib/task-server'

// Hit nightly by Vercel Cron (see vercel.json) — same auth pattern as
// generate-tasks: Vercel sends `Authorization: Bearer $CRON_SECRET`
// automatically when that env var is set on the project; fails closed with
// no CRON_SECRET configured. Quiet by design — no user-facing notification,
// just a count in the function logs for visibility if anyone wants to check.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getServerSupabase()
  try {
    const cleaned = await cleanupOldTaskPhotos(db)
    console.log(`cleanup-photos: cleared ${cleaned} photo(s) older than 90 days`)
    return NextResponse.json({ cleaned })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Cleanup failed' }, { status: 500 })
  }
}
