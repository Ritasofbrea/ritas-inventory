// Patch 44 fix: push_subscriptions.owner_name isolation + the
// GET /api/owners/alerts `linked` field. Proves the exact property Josh
// asked for: "a device linked to Josh is never reachable by Gina's switch,
// and vice versa" — using 'ZZTEST Owner' (a real owners row that is
// invisible to the real Josh/Gina-only OWNER_NAMES allowlist everywhere
// else) as a safe stand-in third identity, so no real Josh/Gina device
// row is ever touched. The actual query (`subsForOwner`/
// `subsForOwnersWithAlert` in src/lib/push-server.ts) scopes by an exact
// owner_name match either way, so this isolation proof generalizes to any
// pair of names, including the real two.
import { getServerSupabase } from '../../src/lib/supabase.ts'
import { subsForOwner } from '../../src/lib/push-server.ts'
import { rest } from './helpers/rest.mjs'
import { apiFetch, loginAsOwner } from './helpers/auth.mjs'

let failures = 0
const check = (name, cond) => {
  if (cond) console.log(`ok - ${name}`)
  else {
    console.log(`FAIL - ${name}`)
    failures++
  }
}

const FAKE_ENDPOINT = `https://zztest.example.com/fake-endpoint-${Date.now()}`

async function run() {
  const db = getServerSupabase()
  const owner = await loginAsOwner()

  const before = await apiFetch('/api/owners/alerts', owner.cookie)
  check('GET /api/owners/alerts -> 200', before.status === 200)
  const rowsBefore = await before.json()
  check('every row has a boolean `linked` field', rowsBefore.every((r) => typeof r.linked === 'boolean'))
  const joshBefore = rowsBefore.find((r) => r.name === 'Josh')?.linked
  const ginaBefore = rowsBefore.find((r) => r.name === 'Gina')?.linked

  await rest('push_subscriptions', {
    method: 'POST',
    body: JSON.stringify({ endpoint: FAKE_ENDPOINT, p256dh: 'ZZTEST-p256dh', auth: 'ZZTEST-auth', owner_name: 'ZZTEST Owner' }),
  })

  try {
    const zztestSubs = await subsForOwner(db, 'ZZTEST Owner')
    check('subsForOwner(ZZTEST Owner) finds the fixture', zztestSubs.some((s) => s.endpoint === FAKE_ENDPOINT))

    const joshSubs = await subsForOwner(db, 'Josh')
    check("subsForOwner(Josh) never includes ZZTEST Owner's device", !joshSubs.some((s) => s.endpoint === FAKE_ENDPOINT))

    const ginaSubs = await subsForOwner(db, 'Gina')
    check("subsForOwner(Gina) never includes ZZTEST Owner's device", !ginaSubs.some((s) => s.endpoint === FAKE_ENDPOINT))

    const after = await apiFetch('/api/owners/alerts', owner.cookie)
    const rowsAfter = await after.json()
    const joshAfter = rowsAfter.find((r) => r.name === 'Josh')?.linked
    const ginaAfter = rowsAfter.find((r) => r.name === 'Gina')?.linked
    check("Josh's linked status is unaffected by an unrelated ZZTEST Owner subscription", joshBefore === joshAfter)
    check("Gina's linked status is unaffected by an unrelated ZZTEST Owner subscription", ginaBefore === ginaAfter)
  } finally {
    await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(FAKE_ENDPOINT)}`, { method: 'DELETE' })
  }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
