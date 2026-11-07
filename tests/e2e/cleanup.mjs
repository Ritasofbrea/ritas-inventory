// Standalone cleanup: sweeps any ZZTEST fixtures left behind by
// role-checks.mjs or step-checks.mjs (e.g. after a crashed run). Safe to
// run any time -- matches nothing if there's nothing to clean up.
import { sweepZztestFixtures } from './helpers/zztest.mjs'

sweepZztestFixtures()
  .then(() => console.log('ZZTEST fixtures swept.'))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
