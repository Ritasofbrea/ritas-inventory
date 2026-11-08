// Runs every suite in sequence as a child process (so one suite's exit()
// can't short-circuit the next) and exits non-zero if any of them failed.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))
const suites = ['role-checks.mjs', 'step-checks.mjs', 'logout-race.mjs', 'row-cap-checks.mjs']

function runOne(file) {
  return new Promise((resolve) => {
    console.log(`\n=== ${file} ===`)
    const child = spawn(process.execPath, [join(dir, file)], { stdio: 'inherit', env: process.env })
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
