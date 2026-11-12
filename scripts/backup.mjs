#!/usr/bin/env node
// Patch 54: weekly full-database backup to iCloud Drive. Read-only against
// Supabase (selects and storage list calls only -- never insert, update,
// delete, upload, or remove). Run by hand with `npm run backup`, or on a
// schedule via the launchd jobs installed by install-backup-jobs.sh (see
// scripts/BACKUP-README.md).
//
// Design notes:
// - Reads NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from
//   .env.local itself, at runtime, parsed by hand below -- never through a
//   shell env-file flag that could echo into a log, never printed/logged.
// - Every table is paged with .range() in batches (PAGE_SIZE), in a
//   stable order, until a short page comes back -- the same 1000-row-cap
//   discipline as src/lib/usage-server.ts/notes-server.ts in the app
//   itself (see CLAUDE.md's PostgREST gotcha). Never a single unbounded
//   select.
// - Every table's written row count is checked against a separate
//   count: 'exact' query. A mismatch marks that table FAILED and the run
//   continues (so one bad table doesn't hide every other table's backup),
//   but the whole script exits non-zero at the end.
// - Writes into a hidden .tmp-<name> folder first and renames to the
//   final dated name only once everything succeeded, so a half-finished
//   backup can never look complete.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const SCRIPT_VERSION = '1.0.0'
const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const BACKUPS_DIR = path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Ritas-backups')
const PAGE_SIZE = 1000
const WRITABILITY_TIMEOUT_MS = 20000
const RETAIN_COUNT = 8
const DATED_FOLDER_RE = /^\d{4}-\d{2}-\d{2}_\d{4}$/
const TEMP_PREFIX = '.tmp-'

// ---- editable table list --------------------------------------------
// Built by cross-referencing every `create table` in supabase/*.sql and
// every `.from('...')` call in src/, then verified against the live
// database's own schema (see assertTableListMatchesLiveSchema below,
// which runs on every backup and fails loudly if the two ever diverge).
// Three of these -- vendor_schedules, vendor_week_status,
// vendor_reminder_log -- exist live but were applied directly in the
// Supabase SQL Editor with no supabase/*.sql file ever committed for
// them (same pattern CLAUDE.md documents for a few other tables); they
// were found via the code cross-reference, not the SQL files.
//
// Each entry's value is the column(s) .order()'d on for paging -- a
// single-column primary key where one exists, or the real composite
// key where it doesn't (vendor_reminder_log has no id column at all).
const TABLES = {
  // items & inventory
  items: ['id'],
  inventory_counts: ['id'],
  order_history: ['id'],
  order_history_items: ['id'],
  storage_moves: ['id'],
  // tasks
  checklists: ['name'],
  task_templates: ['id'],
  task_template_steps: ['id'],
  task_instances: ['id'],
  task_instance_step_checks: ['id'],
  // notes
  notes: ['id'],
  note_replies: ['id'],
  note_acknowledgments: ['id'],
  note_photos: ['id'],
  // people / auth
  owners: ['name'],
  shift_leads: ['id'],
  staff: ['id'],
  pins: ['name'], // legacy, unused by app code (see CLAUDE.md §4), still a real table
  login_attempts: ['id'],
  push_subscriptions: ['id'],
  // flavors
  flavors: ['id'],
  flavor_weeks: ['id'],
  flavor_week_slots: ['id'],
  // vendor schedules / reminders
  vendor_schedules: ['vendor'],
  vendor_week_status: ['id'],
  vendor_week_status_log: ['id'],
  vendor_reminder_log: ['vendor', 'week_start'], // composite primary key, no id column
  // Clover POS mapping
  clover_items: ['clover_id'],
  clover_item_mappings: ['id'],
  // misc
  count_draft: ['id'],
  // invoice scanning (patch 63)
  invoices: ['id'],
  invoice_lines: ['id'],
}

const BUCKETS = ['note-photos', 'task-photos', 'invoice-photos']
// Buckets whose files are COPIED into the backup (under files/<bucket>/),
// not just listed. invoice-photos is the private proof of what a vendor
// delivered, so the photos themselves are kept. The other buckets stay
// list-only, unchanged.
const DOWNLOAD_BUCKETS = ['invoice-photos']

// ---- env -------------------------------------------------------------
// Minimal, dependency-free .env parser -- loaded at runtime only, never
// written to process-wide process.env (so nothing else on the machine
// can read it back out of this process), never logged.
async function loadEnvLocal() {
  const envPath = path.join(REPO_ROOT, '.env.local')
  let text
  try {
    text = await fs.readFile(envPath, 'utf8')
  } catch {
    throw new Error(`Could not read ${envPath} -- is this script running from inside the repo?`)
  }
  const env = {}
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing from .env.local')
  return { url, key }
}

// ---- macOS notifications ---------------------------------------------
// execFile (not exec/a shell string) so a message can never be
// interpreted as shell syntax. Never passed a secret.
function notify(message, title = 'Ritas Backup') {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`], () => resolve())
  })
}

function failLoud(message) {
  console.error(`FAILED: ${message}`)
  return notify(message).then(() => {
    process.exitCode = 1
  })
}

// macOS can silently block a background (launchd) process from touching
// iCloud Drive instead of erroring -- the OS wants to show a permission
// prompt, but a non-interactive agent has no window to show it in, so the
// fs call just hangs forever. Confirmed live: the installed launchd job
// hung indefinitely on exactly this check before Full Disk Access was
// granted to the node binary. Races the real check against a plain
// timer so a stall is reported, not silently waited on forever.
function withTimeout(promise, ms, timeoutMessage) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// ---- backups folder safety checks -------------------------------------
async function ensureBackupsDirWritable() {
  await fs.mkdir(BACKUPS_DIR, { recursive: true })
  const testFile = path.join(BACKUPS_DIR, `.write-test-${process.pid}-${Date.now()}`)
  try {
    await fs.writeFile(testFile, 'ok')
    await fs.unlink(testFile)
  } catch (e) {
    throw new Error(`Backups folder exists but is not writable (${BACKUPS_DIR}): ${e instanceof Error ? e.message : String(e)}`)
  }
}

async function cleanupStaleTempFolders() {
  const entries = await fs.readdir(BACKUPS_DIR, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith(TEMP_PREFIX)) {
      await fs.rm(path.join(BACKUPS_DIR, entry.name), { recursive: true, force: true })
      console.log(`cleaned up stale temp folder from an earlier crashed run: ${entry.name}`)
    }
  }
}

// ---- schema drift guard ------------------------------------------------
// Fails loudly (rather than silently backing up an incomplete set) if the
// live database has a public table this script doesn't know about.
// Read-only: PostgREST's own OpenAPI description, no SQL run.
async function assertTableListMatchesLiveSchema(url, key) {
  const res = await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' } })
  if (!res.ok) throw new Error(`Could not fetch live schema to verify the table list (HTTP ${res.status})`)
  const spec = await res.json()
  const liveTables = new Set(Object.keys(spec.definitions || {}))
  const knownTables = new Set(Object.keys(TABLES))
  const unknown = [...liveTables].filter((t) => !knownTables.has(t)).sort()
  if (unknown.length > 0) {
    throw new Error(
      `The live database has ${unknown.length} table(s) not in this script's TABLES list: ${unknown.join(', ')}. Add them to scripts/backup.mjs's TABLES before backing up, so this run doesn't silently skip real data.`
    )
  }
}

// ---- table backup ------------------------------------------------------
async function backupTable(db, tableName, orderCols, outDir) {
  const rows = []
  let from = 0
  for (;;) {
    let query = db.from(tableName).select('*').range(from, from + PAGE_SIZE - 1)
    for (const col of orderCols) query = query.order(col, { ascending: true })
    const { data, error } = await query
    if (error) throw new Error(error.message)
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }

  const { count: exactCount, error: countError } = await db.from(tableName).select('*', { count: 'exact', head: true })
  if (countError) throw new Error(countError.message)

  await fs.writeFile(path.join(outDir, `${tableName}.json`), JSON.stringify(rows, null, 2))

  const ok = rows.length === exactCount
  return { table: tableName, written: rows.length, exactCount, ok }
}

// ---- storage bucket file listing (names/sizes/dates only, no downloads) ----
async function listBucketFilesRecursive(db, bucket, prefix = '') {
  const files = []
  let offset = 0
  for (;;) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: PAGE_SIZE, offset })
    if (error) throw new Error(`bucket "${bucket}" list failed (prefix "${prefix}"): ${error.message}`)
    const page = data ?? []
    for (const entry of page) {
      const isFolder = entry.id === null
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (isFolder) {
        files.push(...(await listBucketFilesRecursive(db, bucket, fullPath)))
      } else {
        files.push({ path: fullPath, size: entry.metadata?.size ?? null, created_at: entry.created_at ?? null, updated_at: entry.updated_at ?? null })
      }
    }
    if (page.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return files
}

// Downloads every listed file of a DOWNLOAD_BUCKETS bucket into
// <outDir>/files/<bucket>/<path>, and checks each written file's size
// against the size Storage reported. Any failure throws, which fails the
// whole backup (same as a table failing) rather than saving a backup
// that silently lacks photos.
async function downloadBucketFiles(db, bucket, files, outDir) {
  const root = path.join(outDir, 'files', bucket)
  let bytes = 0
  for (const f of files) {
    if (f.path.split('/').some((part) => part === '..' || part === '')) throw new Error(`bucket "${bucket}": refusing odd path "${f.path}"`)
    const { data, error } = await db.storage.from(bucket).download(f.path)
    if (error || !data) throw new Error(`bucket "${bucket}" download failed for "${f.path}": ${error?.message ?? 'no data'}`)
    const buf = Buffer.from(await data.arrayBuffer())
    if (f.size !== null && buf.length !== f.size) throw new Error(`bucket "${bucket}": "${f.path}" downloaded ${buf.length} bytes, expected ${f.size}`)
    const dest = path.join(root, f.path)
    await fs.mkdir(path.dirname(dest), { recursive: true })
    await fs.writeFile(dest, buf)
    bytes += buf.length
  }
  return { downloaded: files.length, bytes }
}

async function backupBuckets(db, outDir) {
  const result = {}
  const downloads = {}
  for (const bucket of BUCKETS) {
    result[bucket] = await listBucketFilesRecursive(db, bucket)
    if (DOWNLOAD_BUCKETS.includes(bucket)) downloads[bucket] = await downloadBucketFiles(db, bucket, result[bucket], outDir)
  }
  await fs.writeFile(path.join(outDir, 'storage-file-lists.json'), JSON.stringify(result, null, 2))
  return {
    counts: Object.fromEntries(Object.entries(result).map(([b, files]) => [b, files.length])),
    downloads,
  }
}

// ---- retention ----------------------------------------------------------
// Only ever touches folders directly inside BACKUPS_DIR whose name
// matches DATED_FOLDER_RE exactly -- never anything else in that folder.
async function pruneOldBackups() {
  const entries = await fs.readdir(BACKUPS_DIR, { withFileTypes: true })
  const dated = entries.filter((e) => e.isDirectory() && DATED_FOLDER_RE.test(e.name)).map((e) => e.name).sort()
  const toDelete = dated.slice(0, Math.max(0, dated.length - RETAIN_COUNT))
  for (const name of toDelete) {
    await fs.rm(path.join(BACKUPS_DIR, name), { recursive: true, force: true })
    console.log(`retention: removed old backup folder ${name}`)
  }
  return { kept: dated.length - toDelete.length, removed: toDelete.length }
}

// ---- size helper ---------------------------------------------------------
async function folderSizeBytes(dir) {
  let total = 0
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) total += await folderSizeBytes(full)
    else total += (await fs.stat(full)).size
  }
  return total
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function datedFolderName(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}`
}

// ---- main -----------------------------------------------------------------
async function main() {
  const startedAt = new Date()

  try {
    await withTimeout(
      ensureBackupsDirWritable(),
      WRITABILITY_TIMEOUT_MS,
      `Backup is blocked -- the backups folder check did not respond within ${WRITABILITY_TIMEOUT_MS / 1000}s. This almost always means macOS is silently blocking background access to iCloud Drive. Check System Settings -> Privacy & Security -> Full Disk Access and make sure the node binary used to run this script is listed and turned on.`
    )
  } catch (e) {
    await failLoud(e instanceof Error ? e.message : `Backups folder is missing or not writable: ${String(e)}`)
    // A genuinely stuck fs call can leave the event loop (and this
    // process) alive even after we've stopped waiting on it -- force a
    // real exit so a launchd job ends up "not running" with a failure
    // code instead of hanging forever the way the un-timed-out version did.
    process.exit(1)
  }

  await cleanupStaleTempFolders()

  let url, key
  try {
    ;({ url, key } = await loadEnvLocal())
  } catch (e) {
    await failLoud(`Could not load Supabase credentials: ${e instanceof Error ? e.message : String(e)}`)
    return
  }

  const db = createClient(url, key, { auth: { persistSession: false } })

  try {
    await assertTableListMatchesLiveSchema(url, key)
  } catch (e) {
    await failLoud(e instanceof Error ? e.message : String(e))
    return
  }

  const folderName = datedFolderName(startedAt)
  const tempDir = path.join(BACKUPS_DIR, `${TEMP_PREFIX}${folderName}`)
  const finalDir = path.join(BACKUPS_DIR, folderName)
  await fs.mkdir(tempDir, { recursive: true })

  const results = []
  for (const [tableName, orderCols] of Object.entries(TABLES)) {
    try {
      const result = await backupTable(db, tableName, orderCols, tempDir)
      results.push(result)
      if (!result.ok) console.error(`FAILED: ${tableName} -- wrote ${result.written} rows but exact count is ${result.exactCount}`)
    } catch (e) {
      results.push({ table: tableName, written: 0, exactCount: null, ok: false, error: e instanceof Error ? e.message : String(e) })
      console.error(`FAILED: ${tableName} -- ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  let bucketCounts = {}
  let bucketDownloads = {}
  try {
    const buckets = await backupBuckets(db, tempDir)
    bucketCounts = buckets.counts
    bucketDownloads = buckets.downloads
  } catch (e) {
    results.push({ table: '(storage buckets)', written: 0, exactCount: null, ok: false, error: e instanceof Error ? e.message : String(e) })
    console.error(`FAILED: storage buckets -- ${e instanceof Error ? e.message : String(e)}`)
  }

  const allOk = results.every((r) => r.ok)
  const finishedAt = new Date()

  const manifest = {
    scriptVersion: SCRIPT_VERSION,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    ok: allOk,
    tables: results,
    buckets: bucketCounts,
    bucketDownloads,
  }
  await fs.writeFile(path.join(tempDir, 'manifest.json'), JSON.stringify(manifest, null, 2))

  if (!allOk) {
    // Leave the temp folder in place (named so it can never be mistaken
    // for a completed backup) for inspection, and never rename it into a
    // dated folder real retention/restore would trust.
    const failedTables = results.filter((r) => !r.ok).map((r) => r.table).join(', ')
    await failLoud(`Backup failed for: ${failedTables}. Left at ${tempDir} for inspection.`)
    await fs.writeFile(
      path.join(BACKUPS_DIR, 'last-run.json'),
      JSON.stringify({ time: finishedAt.toISOString(), status: 'FAILED', folder: null }, null, 2)
    )
    return
  }

  await fs.rename(tempDir, finalDir)
  const retention = await pruneOldBackups()
  const totalSize = await folderSizeBytes(finalDir)

  await fs.writeFile(
    path.join(BACKUPS_DIR, 'last-run.json'),
    JSON.stringify({ time: finishedAt.toISOString(), status: 'OK', folder: folderName }, null, 2)
  )

  const totalRows = results.reduce((sum, r) => sum + (r.written || 0), 0)
  const totalFiles = Object.values(bucketCounts).reduce((sum, n) => sum + n, 0)

  console.log('\n=== Backup summary ===')
  console.log(`Folder: ${finalDir}`)
  console.log(`Status: OK`)
  console.log(`Tables backed up: ${results.length} (${totalRows} total rows)`)
  for (const r of results) console.log(`  ${r.table}: ${r.written} rows`)
  console.log(`Storage files listed: ${totalFiles} (${Object.entries(bucketCounts).map(([b, n]) => `${b}: ${n}`).join(', ')})`)
  for (const [b, d] of Object.entries(bucketDownloads)) console.log(`Storage files copied: ${b}: ${d.downloaded} (${formatBytes(d.bytes)})`)
  console.log(`Total backup size: ${formatBytes(totalSize)}`)
  console.log(`Retention: kept ${retention.kept} folder(s), removed ${retention.removed} old one(s)`)

  await notify(`Backup OK -- ${results.length} tables, ${formatBytes(totalSize)}`)
}

main().catch(async (e) => {
  await failLoud(`Unexpected error: ${e instanceof Error ? e.message : String(e)}`)
})
