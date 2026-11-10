// Runs every suite in sequence as a child process (so one suite's exit()
// can't short-circuit the next) and exits non-zero if any of them failed.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))
const suites = [
  'role-checks.mjs',
  'step-checks.mjs',
  'logout-race.mjs',
  'row-cap-checks.mjs',
  'vendor-schedule-checks.mjs',
  'notification-linking-checks.mjs',
  'vendor-week-switch-checks.mjs',
  'item-category-checks.mjs',
  'item-flavor-link-checks.mjs',
  'order-list-other-merge-checks.mjs',
  'order-history-paging-checks.mjs',
  'receive-order-race-checks.mjs',
  'notes-photo-path-checks.mjs',
  'patch-50-checks.mjs',
  'par-settings-badge-checks.mjs',
  'patch-52-checks.mjs',
  'rename-item-checks.mjs',
  'patch-55-checks.mjs',
  'patch-56-checks.mjs',
]

// vendor-schedule-checks.mjs, order-list-other-merge-checks.mjs, and
// order-history-paging-checks.mjs import src/lib/*.ts files that use
// extensionless relative imports internally (e.g. vendor-schedule.ts's
// `from './tasks'`) — only bundler-style resolution (tsx, same as Next.js/
// Turbopack) follows those; plain Node ESM resolution requires an explicit
// extension and would fail with ERR_MODULE_NOT_FOUND. receive-order-race-
// checks.mjs, notes-photo-path-checks.mjs, patch-50-checks.mjs,
// par-settings-badge-checks.mjs, patch-52-checks.mjs, and
// rename-item-checks.mjs's own imports (storage-server.ts/supabase.ts/
// note-photo-constants.ts/photo.ts/note-photo-cleanup-server.ts/
// order-list-server.ts/session-token.ts) don't need it, but they run
// under tsx too for consistency. Every other suite here only imports
// plain .mjs/leaf .ts files with no such imports, so they still run under
// plain node. par-settings-badge-checks.mjs, patch-52-checks.mjs, and
// rename-item-checks.mjs are the suites (after logout-race.mjs) that
// drive a real browser via Playwright, since the point is what actually
// renders, not just the API response.
const TSX_SUITES = new Set([
  'vendor-schedule-checks.mjs',
  'order-list-other-merge-checks.mjs',
  'order-history-paging-checks.mjs',
  'receive-order-race-checks.mjs',
  'notes-photo-path-checks.mjs',
  'patch-50-checks.mjs',
  'par-settings-badge-checks.mjs',
  'patch-52-checks.mjs',
  'rename-item-checks.mjs',
  'patch-55-checks.mjs',
  'patch-56-checks.mjs',
])

function runOne(file) {
  return new Promise((resolve) => {
    console.log(`\n=== ${file} ===`)
    const [cmd, args] = TSX_SUITES.has(file)
      ? [process.execPath, [join(dir, '..', '..', 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(dir, file)]]
      : [process.execPath, [join(dir, file)]]
    const child = spawn(cmd, args, { stdio: 'inherit', env: process.env })
    child.on('exit', (code) => resolve(code === 0))
  })
}

async function main() {
  let allPassed = true
  for (const file of suites) {
    const passed = await runOne(file)
    allPassed = allPassed && passed
  }
  console.log(allPassed ? '\n=== ALL SUITES PASSED ===' : '\n=== SOME SUITES FAILED ===')
  process.exit(allPassed ? 0 : 1)
}

main()
