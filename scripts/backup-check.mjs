#!/usr/bin/env node
// Patch 54: `npm run backup:check` -- reads last-run.json and fires a
// macOS notification (plus a plain console line) if the last backup
// FAILED, or if the last OK backup is older than 10 days -- so a silently
// dead weekly job still gets noticed. Meant to run daily via its own
// launchd job (see scripts/install-backup-jobs.sh). Never touches
// Supabase or the network at all.
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'

const BACKUPS_DIR = path.join(os.homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Ritas-backups')
const STALE_AFTER_DAYS = 10

function notify(message, title = 'Ritas Backup') {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`], () => resolve())
  })
}

async function main() {
  const lastRunPath = path.join(BACKUPS_DIR, 'last-run.json')
  let lastRun
  try {
    lastRun = JSON.parse(await fs.readFile(lastRunPath, 'utf8'))
  } catch {
    console.log(`No backup has ever completed (no ${lastRunPath}).`)
    await notify('No backup has ever run yet.')
    process.exitCode = 1
    return
  }

  if (lastRun.status !== 'OK') {
    console.log(`Last backup FAILED at ${lastRun.time}.`)
    await notify(`Last backup FAILED (${lastRun.time}). Check the log.`)
    process.exitCode = 1
    return
  }

  const ageMs = Date.now() - new Date(lastRun.time).getTime()
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  if (ageDays > STALE_AFTER_DAYS) {
    console.log(`Last OK backup was ${ageDays.toFixed(1)} days ago (${lastRun.folder}) -- older than ${STALE_AFTER_DAYS} days.`)
    await notify(`No successful backup in ${Math.floor(ageDays)} days. Last one: ${lastRun.folder}.`)
    process.exitCode = 1
    return
  }

  console.log(`Last backup OK, ${ageDays.toFixed(1)} days ago (${lastRun.folder}). Nothing to report.`)
}

main()
