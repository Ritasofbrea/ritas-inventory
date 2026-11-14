// Patch 70: nightly invoice draft cleanup, run from /api/cron/cleanup-photos.
// Same safety pattern as note-photo-cleanup-server.ts (patch 50):
//
//   - DRY RUN unless INVOICE_DRAFT_CLEANUP_ENABLE_DELETE is exactly "1".
//     The dry run reports what it WOULD delete and touches nothing.
//   - If any lookup errors, or the invoices table comes back empty while the
//     bucket still has folders, NOTHING is deleted this run.
//
// What it can delete:
//   1. Unread drafts: status 'draft', never read (raw_extraction IS NULL, so
//      no read attempt was ever recorded), created more than 7 days ago.
//      The row and its photos go, same end result as DELETE /api/invoices.
//   2. Orphan photos: files under "<uuid>/" in invoice-photos whose invoice
//      row no longer exists, older than 1 day.
//
// What it NEVER deletes:
//   - received invoices or their photos (the proof). Every path a received
//     invoice points to is also held back from the orphan sweep, belt and
//     braces, even though a received invoice's folder is never an orphan.
//   - read but not confirmed invoices (they hold the crew's check-off; the
//     Scan Invoice screen nudges instead)
//   - discarded rows (they keep the read attempts that count toward the
//     read caps; their photos were already removed when discarded)
//   - drafts with any read attempt (raw_extraction set)
import type { SupabaseClient } from '@supabase/supabase-js'
import { INVOICE_PHOTO_BUCKET, UUID_RE } from './invoice-constants'

export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000
const MAX_DRAFTS_PER_RUN = 50
const MAX_ORPHAN_FILES_PER_RUN = 200
const PAGE = 1000

type InvoiceLite = { id: string; status: string; created_at: string; created_by: string | null; photo_paths: string[] | null; has_reads: boolean }

export type DraftToDelete = { id: string; created_at: string; created_by: string | null; age_days: number; photo_count: number }
export type OrphanFolder = { folder: string; files: number; eligible_files: number; newest_age_hours: number | null }

export type InvoiceCleanupResult = {
  dryRun: boolean
  abortedReason: string | null // non-null means NOTHING was deleted this run
  invoiceCount: number
  bucketFolderCount: number
  unreadDrafts: DraftToDelete[] // older than 7 days: deleted (or would be, in a dry run)
  youngUnreadDrafts: number // unread drafts not old enough yet
  readNotConfirmed: number // never deleted, nudged on Scan Invoice
  receivedKept: number
  orphanFolders: OrphanFolder[] // folders with no invoice row
  orphanFilesEligible: number // orphan files past the 1-day window: deleted (or would be)
  orphanFilesTooNew: number
  skippedReceivedPaths: number // orphan-looking files held back because a received invoice points at them
  looseRootFiles: number // files not inside a "<uuid>/" folder: never touched, reported only
  deletedDrafts: number
  deletedDraftPhotos: number
  deletedOrphanFiles: number
  cappedAtMax: boolean
  errors: string[] // delete-time problems (lookups that fail abort instead)
}

// Every invoice row, paged. raw_extraction itself is large and is not
// fetched; whether a draft was ever read is asked separately below.
async function loadInvoices(db: SupabaseClient): Promise<InvoiceLite[]> {
  const out: InvoiceLite[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('invoices')
      .select('id, status, created_at, created_by, photo_paths, read_model')
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`invoices read failed: ${error.message}`)
    const rows = (data ?? []) as { id: string; status: string; created_at: string; created_by: string | null; photo_paths: string[] | null; read_model: string | null }[]
    for (const r of rows) out.push({ id: r.id, status: r.status, created_at: r.created_at, created_by: r.created_by, photo_paths: r.photo_paths, has_reads: r.read_model !== null })
    if (rows.length < PAGE) break
  }
  return out
}

// "Never read" must be decided by the database, not by a JSON field that
// might be missing: raw_extraction IS NULL. A draft with any attempt has it set.
async function loadUnreadDraftIds(db: SupabaseClient): Promise<Set<string>> {
  const ids = new Set<string>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('invoices')
      .select('id')
      .eq('status', 'draft')
      .is('raw_extraction', null)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`draft read failed: ${error.message}`)
    for (const r of data ?? []) ids.add(r.id)
    if ((data ?? []).length < PAGE) break
  }
  return ids
}

type Entry = { name: string; id: string | null; created_at?: string | null }

async function listDir(db: SupabaseClient, prefix: string): Promise<Entry[]> {
  const out: Entry[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await db.storage.from(INVOICE_PHOTO_BUCKET).list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new Error(`bucket list failed (prefix "${prefix}"): ${error.message}`)
    out.push(...((data ?? []) as Entry[]))
    if ((data ?? []).length < PAGE) break
  }
  return out
}

export type InvoiceCleanupOptions = {
  now?: number // tests only: there is no way to backdate a Storage file
  // Tests only: limit every deletion candidate (drafts and orphan folders)
  // to these invoice ids, so a test run with deletes on can never touch a
  // real draft or a real orphan folder. The cron never passes this.
  onlyIds?: Set<string>
}

export async function cleanupInvoiceDrafts(db: SupabaseClient, opts: InvoiceCleanupOptions = {}): Promise<InvoiceCleanupResult> {
  const dryRun = process.env.INVOICE_DRAFT_CLEANUP_ENABLE_DELETE !== '1'
  const now = opts.now ?? Date.now()
  const inScope = (id: string) => !opts.onlyIds || opts.onlyIds.has(id)

  const result: InvoiceCleanupResult = {
    dryRun,
    abortedReason: null,
    invoiceCount: 0,
    bucketFolderCount: 0,
    unreadDrafts: [],
    youngUnreadDrafts: 0,
    readNotConfirmed: 0,
    receivedKept: 0,
    orphanFolders: [],
    orphanFilesEligible: 0,
    orphanFilesTooNew: 0,
    skippedReceivedPaths: 0,
    looseRootFiles: 0,
    deletedDrafts: 0,
    deletedDraftPhotos: 0,
    deletedOrphanFiles: 0,
    cappedAtMax: false,
    errors: [],
  }
  const abort = (why: string) => ({ ...result, abortedReason: why, unreadDrafts: [], orphanFolders: [], orphanFilesEligible: 0 })

  // ---- Lookups. Any error here: delete nothing. ----
  let invoices: InvoiceLite[]
  let unreadIds: Set<string>
  let root: Entry[]
  try {
    invoices = await loadInvoices(db)
    unreadIds = await loadUnreadDraftIds(db)
    root = await listDir(db, '')
  } catch (e) {
    return abort(`lookup errored, nothing deleted: ${e instanceof Error ? e.message : String(e)}`)
  }
  const folders = root.filter((e) => e.id === null)
  result.invoiceCount = invoices.length
  result.bucketFolderCount = folders.length
  result.looseRootFiles = root.length - folders.length

  if (invoices.length === 0 && folders.length > 0) {
    return abort('invoices came back empty while the bucket has folders -- nothing deleted')
  }

  const byId = new Map(invoices.map((i) => [i.id, i]))
  const received = invoices.filter((i) => i.status === 'received')
  result.receivedKept = received.length
  result.readNotConfirmed = invoices.filter((i) => i.status === 'read').length
  // Both lookups must agree that a draft is unread; if they disagree (it was
  // read between the two queries), leave it.
  const receivedPaths = new Set(received.flatMap((i) => i.photo_paths ?? []))
  const receivedIds = new Set(received.map((i) => i.id))

  for (const inv of invoices) {
    if (inv.status !== 'draft' || inv.has_reads || !unreadIds.has(inv.id)) continue
    const age = now - new Date(inv.created_at).getTime()
    if (!(age > DRAFT_MAX_AGE_MS)) {
      result.youngUnreadDrafts++
      continue
    }
    if (!inScope(inv.id)) continue
    result.unreadDrafts.push({
      id: inv.id,
      created_at: inv.created_at,
      created_by: inv.created_by,
      age_days: Math.floor(age / (24 * 60 * 60 * 1000)),
      photo_count: (inv.photo_paths ?? []).length,
    })
  }

  // Orphan folders: a "<uuid>/" folder with no invoice row at all.
  const orphanFiles: string[] = []
  try {
    for (const f of folders) {
      if (!UUID_RE.test(f.name) || byId.has(f.name) || receivedIds.has(f.name)) continue
      if (!inScope(f.name)) continue
      const files = (await listDir(db, f.name)).filter((e) => e.id !== null)
      let eligible = 0
      let newest: number | null = null
      for (const file of files) {
        const path = `${f.name}/${file.name}`
        const created = file.created_at ? new Date(file.created_at).getTime() : NaN
        const age = now - created
        if (Number.isFinite(age)) newest = newest === null ? age : Math.min(newest, age)
        if (receivedPaths.has(path)) {
          result.skippedReceivedPaths++
          continue
        }
        if (Number.isFinite(age) && age >= ORPHAN_MIN_AGE_MS) {
          eligible++
          orphanFiles.push(path)
        } else {
          result.orphanFilesTooNew++
        }
      }
      result.orphanFolders.push({ folder: f.name, files: files.length, eligible_files: eligible, newest_age_hours: newest === null ? null : Math.floor(newest / 3600000) })
    }
  } catch (e) {
    return abort(`lookup errored, nothing deleted: ${e instanceof Error ? e.message : String(e)}`)
  }
  result.orphanFilesEligible = orphanFiles.length

  const drafts = result.unreadDrafts.slice(0, MAX_DRAFTS_PER_RUN)
  const orphans = orphanFiles.slice(0, MAX_ORPHAN_FILES_PER_RUN)
  result.cappedAtMax = result.unreadDrafts.length > drafts.length || orphanFiles.length > orphans.length
  if (dryRun) return result

  // ---- Deletes (only with the env flag). ----
  // Drafts: the row first, guarded so it only goes if it is STILL an unread
  // draft; then its folder. If the photo removal then fails, the files are
  // orphans that the next run's orphan sweep picks up (after a day).
  for (const d of drafts) {
    const { data: gone, error } = await db
      .from('invoices')
      .delete()
      .eq('id', d.id)
      .eq('status', 'draft')
      .is('raw_extraction', null)
      .select('id')
    if (error) {
      result.errors.push(`draft ${d.id.slice(0, 8)} row delete failed: ${error.message}`)
      continue
    }
    if (!gone || gone.length === 0) continue // changed since the lookup: leave it
    result.deletedDrafts++
    try {
      const files = (await listDir(db, d.id)).filter((e) => e.id !== null).map((e) => `${d.id}/${e.name}`)
      if (files.length > 0) {
        const { error: rmError } = await db.storage.from(INVOICE_PHOTO_BUCKET).remove(files)
        if (rmError) result.errors.push(`draft ${d.id.slice(0, 8)} photo delete failed: ${rmError.message}`)
        else result.deletedDraftPhotos += files.length
      }
    } catch (e) {
      result.errors.push(`draft ${d.id.slice(0, 8)} photo list failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Orphans: re-check right before deleting that none of these folders has
  // gained an invoice row since the lookup.
  if (orphans.length > 0) {
    const folderIds = [...new Set(orphans.map((p) => p.split('/')[0]))]
    const { data: nowRows, error } = await db.from('invoices').select('id').in('id', folderIds)
    if (error) {
      result.errors.push(`orphan re-check failed, no orphan files deleted: ${error.message}`)
    } else {
      const reborn = new Set((nowRows ?? []).map((r) => r.id))
      const safe = orphans.filter((p) => !reborn.has(p.split('/')[0]) && !receivedPaths.has(p))
      if (safe.length > 0) {
        const { error: rmError } = await db.storage.from(INVOICE_PHOTO_BUCKET).remove(safe)
        if (rmError) result.errors.push(`orphan delete failed: ${rmError.message}`)
        else result.deletedOrphanFiles = safe.length
      }
    }
  }
  return result
}

// One line for the function logs. No paths, no photo URLs.
export function describeInvoiceCleanup(r: InvoiceCleanupResult): string {
  if (r.abortedReason) return `invoice draft cleanup (dryRun=${r.dryRun}) ABORTED: ${r.abortedReason}`
  return (
    `invoice draft cleanup (dryRun=${r.dryRun}) -- ${r.invoiceCount} invoice(s), ${r.receivedKept} received kept, ` +
    `${r.readNotConfirmed} read-not-confirmed kept, ${r.unreadDrafts.length} unread draft(s) over 7 days, ` +
    `${r.youngUnreadDrafts} younger, ${r.orphanFolders.length} orphan folder(s), ${r.orphanFilesEligible} orphan file(s) past 1 day, ` +
    `${r.orphanFilesTooNew} too new, deleted ${r.deletedDrafts} draft(s) / ${r.deletedDraftPhotos} draft photo(s) / ${r.deletedOrphanFiles} orphan file(s)` +
    `${r.cappedAtMax ? ' (capped this run)' : ''}${r.errors.length ? ` -- errors: ${r.errors.join('; ')}` : ''}`
  )
}
