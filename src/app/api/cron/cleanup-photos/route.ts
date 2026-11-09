import { NextRequest, NextResponse } from 'next/server'
import { getServerSupabase } from '@/lib/supabase'
import { cleanupOldTaskPhotos } from '@/lib/task-server'
import { cleanupOldLoginAttempts } from '@/lib/rate-limit'
import { cleanupOrphanedNotePhotos } from '@/lib/note-photo-cleanup-server'

// Hit nightly by Vercel Cron (see vercel.json) — same auth pattern as
// generate-tasks: Vercel sends `Authorization: Bearer $CRON_SECRET`
// automatically when that env var is set on the project; fails closed with
// no CRON_SECRET configured. Quiet by design — no user-facing notification,
// just a count in the function logs for visibility if anyone wants to check.
//
// Patch 29 B9: also purges login_attempts rows older than 7 days here,
// piggybacking on this existing nightly job instead of adding a new cron /
// vercel.json entry — simplest option, same reasoning as reusing this cron
// for photo cleanup originally.
//
// Patch 50 Part B: also sweeps orphaned note-photos bucket files (uploaded
// but never attached to a saved note) — dry-run only until
// NOTE_PHOTO_CLEANUP_ENABLE_DELETE=true is explicitly set (see
// note-photo-cleanup-server.ts). A failure here is logged and reported in
// the response, but never fails the whole cron run — the other two
// cleanups still complete either way.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = getServerSupabase()
  try {
    const cleaned = await cleanupOldTaskPhotos(db)
    const loginAttemptsCleaned = await cleanupOldLoginAttempts(db)
    console.log(`cleanup-photos: cleared ${cleaned} photo(s) older than 90 days, ${loginAttemptsCleaned} login_attempts row(s) older than 7 days`)

    let notePhotoOrphans = null
    try {
      notePhotoOrphans = await cleanupOrphanedNotePhotos(db)
      console.log(
        `cleanup-photos: note photo orphan sweep (dryRun=${notePhotoOrphans.dryRun}) -- ${notePhotoOrphans.bucketFileCount} bucket file(s), ${notePhotoOrphans.referencedCount} referenced, ${notePhotoOrphans.orphanCandidateCount} orphan candidate(s), ${notePhotoOrphans.eligibleCount} past the 24h safety window, ${notePhotoOrphans.deletedCount} deleted${notePhotoOrphans.abortedReason ? ` -- ABORTED: ${notePhotoOrphans.abortedReason}` : ''}`
      )
    } catch (e) {
      console.error('cleanup-photos: note photo orphan sweep failed:', e instanceof Error ? e.message : String(e))
    }

    return NextResponse.json({ cleaned, loginAttemptsCleaned, notePhotoOrphans })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Cleanup failed' }, { status: 500 })
  }
}
