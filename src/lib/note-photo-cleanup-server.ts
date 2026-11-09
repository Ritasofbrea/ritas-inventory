// Patch 50 Part B: cleans up orphaned files in the note-photos bucket --
// uploaded via a signed URL (patch 22/49) before the note itself is saved,
// so a file with no note_photos row pointing to it is normal for a short
// window, but one found 18 files in the real bucket against only 4
// note_photos rows (most from abandoned test uploads). Nothing else in
// the app ever cleans this bucket.
//
// Ships in DRY-RUN ONLY this patch -- real deletion stays off until an
// explicit env var is set (see cleanupOrphanedNotePhotos below), after
// Josh has seen a real dry-run result.
import type { SupabaseClient } from '@supabase/supabase-js'
import { NOTE_PHOTO_BUCKET } from './note-photo-constants'

const SAFETY_WINDOW_MS = 24 * 60 * 60 * 1000 // never touch anything uploaded less than 24h ago
const MAX_DELETIONS_PER_RUN = 50
const BUCKET_LIST_PAGE_SIZE = 1000
const NOTE_PHOTOS_PAGE_SIZE = 1000

interface BucketFile {
  path: string // full path within the bucket, including any folder prefix
  createdAt: string | null
}

// Pages through the bucket root, recursing one level into anything that
// looks like a folder (list() returns a folder entry with id === null and
// no metadata) -- our paths are either flat (old pre-patch-49 uploads,
// "<timestamp>-<random>.jpg") or exactly one folder deep (patch 49's
// "<uuid>/<timestamp>.jpg"), never deeper, so one level of recursion is
// enough to see every real file.
async function listAllBucketFiles(db: SupabaseClient): Promise<BucketFile[]> {
  const files: BucketFile[] = []

  async function listDir(prefix: string): Promise<void> {
    let offset = 0
    for (;;) {
      const { data, error } = await db.storage.from(NOTE_PHOTO_BUCKET).list(prefix, { limit: BUCKET_LIST_PAGE_SIZE, offset })
      if (error) throw new Error(`bucket list failed (prefix "${prefix}"): ${error.message}`)
      const page = data ?? []
      for (const entry of page) {
        const isFolder = entry.id === null
        const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name
        if (isFolder) {
          await listDir(fullPath)
        } else {
          files.push({ path: fullPath, createdAt: entry.created_at ?? null })
        }
      }
      if (page.length < BUCKET_LIST_PAGE_SIZE) break
      offset += BUCKET_LIST_PAGE_SIZE
    }
  }

  await listDir('')
  return files
}

// Pages through note_photos (same cap-safety reasoning as every other
// bulk read in this app -- see CLAUDE.md's PostgREST 1000-row-cap gotcha)
// and returns the bare storage path for every referenced photo_url.
async function fetchReferencedPaths(db: SupabaseClient): Promise<Set<string>> {
  const referenced = new Set<string>()
  let from = 0
  for (;;) {
    const { data, error } = await db
      .from('note_photos')
      .select('photo_url')
      .range(from, from + NOTE_PHOTOS_PAGE_SIZE - 1)
    if (error) throw new Error(`note_photos read failed: ${error.message}`)
    const page = data ?? []
    for (const row of page) {
      const marker = `/public/${NOTE_PHOTO_BUCKET}/`
      const idx = (row.photo_url as string).indexOf(marker)
      if (idx !== -1) referenced.add((row.photo_url as string).slice(idx + marker.length))
    }
    if (page.length < NOTE_PHOTOS_PAGE_SIZE) break
    from += NOTE_PHOTOS_PAGE_SIZE
  }
  return referenced
}

export interface OrphanCleanupResult {
  dryRun: boolean
  bucketFileCount: number
  referencedCount: number
  orphanCandidateCount: number // bucket files with no note_photos row at all
  eligibleCount: number // orphan candidates also older than the 24h safety window
  deletedCount: number // actually removed (0 in dry-run)
  cappedAtMax: boolean // true if eligibleCount exceeded MAX_DELETIONS_PER_RUN
  abortedReason: string | null // non-null means NOTHING was touched this run
  sampleAges: number[] // ages in days of up to 10 eligible orphans, for reporting -- never paths/URLs
}

// Real deletion only runs if NOTE_PHOTO_CLEANUP_ENABLE_DELETE is exactly
// "true" -- any other value (including unset) stays dry-run, by design,
// per patch 50: Josh approves turning this on after seeing a real
// dry-run result, no redeploy needed to flip it later.
export async function cleanupOrphanedNotePhotos(db: SupabaseClient, opts: { now?: number } = {}): Promise<OrphanCleanupResult> {
  const dryRun = process.env.NOTE_PHOTO_CLEANUP_ENABLE_DELETE !== 'true'

  const bucketFiles = await listAllBucketFiles(db)

  let referenced: Set<string>
  try {
    referenced = await fetchReferencedPaths(db)
  } catch (e) {
    return emptyResult(dryRun, bucketFiles.length, `note_photos read errored, nothing touched: ${e instanceof Error ? e.message : String(e)}`)
  }

  // Fail-safe: an empty referenced set next to a non-empty bucket means
  // something's wrong upstream of this function (a bad query, bad
  // credentials, an empty table that shouldn't be) -- never trust that
  // combination enough to delete anything.
  if (referenced.size === 0 && bucketFiles.length > 0) {
    return emptyResult(dryRun, bucketFiles.length, 'note_photos came back empty while the bucket has files -- aborting without deleting anything')
  }

  // now is injectable for tests only (there's no way to backdate a real
  // Storage object's created_at, so a test proves the 24h filter logic by
  // moving "now" forward instead of waiting a day) -- defaults to the
  // real clock for the actual cron run.
  const now = opts.now ?? Date.now()
  const orphanCandidates = bucketFiles.filter((f) => !referenced.has(f.path))
  const eligible = orphanCandidates.filter((f) => f.createdAt && now - new Date(f.createdAt).getTime() >= SAFETY_WINDOW_MS)

  const cappedAtMax = eligible.length > MAX_DELETIONS_PER_RUN
  const toDelete = cappedAtMax ? eligible.slice(0, MAX_DELETIONS_PER_RUN) : eligible

  const sampleAges = eligible
    .slice(0, 10)
    .map((f) => Math.floor((now - new Date(f.createdAt as string).getTime()) / (24 * 60 * 60 * 1000)))

  let deletedCount = 0
  if (!dryRun && toDelete.length > 0) {
    const { error } = await db.storage.from(NOTE_PHOTO_BUCKET).remove(toDelete.map((f) => f.path))
    if (error) {
      return {
        dryRun,
        bucketFileCount: bucketFiles.length,
        referencedCount: referenced.size,
        orphanCandidateCount: orphanCandidates.length,
        eligibleCount: eligible.length,
        deletedCount: 0,
        cappedAtMax,
        abortedReason: `delete call failed, nothing confirmed removed: ${error.message}`,
        sampleAges,
      }
    }
    deletedCount = toDelete.length
  }

  return {
    dryRun,
    bucketFileCount: bucketFiles.length,
    referencedCount: referenced.size,
    orphanCandidateCount: orphanCandidates.length,
    eligibleCount: eligible.length,
    deletedCount,
    cappedAtMax,
    abortedReason: null,
    sampleAges,
  }
}

function emptyResult(dryRun: boolean, bucketFileCount: number, abortedReason: string): OrphanCleanupResult {
  return {
    dryRun,
    bucketFileCount,
    referencedCount: 0,
    orphanCandidateCount: 0,
    eligibleCount: 0,
    deletedCount: 0,
    cappedAtMax: false,
    abortedReason,
    sampleAges: [],
  }
}
