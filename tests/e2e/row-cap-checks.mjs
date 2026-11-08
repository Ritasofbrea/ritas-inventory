// Patch 41 regression: proves /api/counts/last-per-item, /api/reports/
// velocity, and /api/par-suggestions don't depend on a bulk fetch that
// PostgREST's silent 1000-row cap could truncate. inventory_counts in the
// real Supabase project this points at (see tests/e2e/README.md -- these
// scripts run against real data, not a seeded local DB) already holds more
// rows than that cap, so this is a live check against the actual
// conditions that caused the original bug, not a simulation of them.
//
// The direct proof is last-per-item: it does one point query per item
// (`.limit(1)` on `item_id`, no bulk fetch across the whole table), so its
// result must exactly match a from-scratch count of which items actually
// have at least one inventory_counts row -- computed here independently,
// the same way the route itself computes it, but via plain REST instead of
// the route's internals, so a regression in either one would surface as a
// mismatch. Velocity/par-suggestions are checked only for 200 + well-formed
// JSON here; their real correctness proof is patch 41's before/after
// comparison against production data (see the report), which a synthetic
// ZZTEST dataset can't reproduce (it would need 1000+ rows seeded).
import { loginAsOwner, apiFetch } from './helpers/auth.mjs'
import { rest } from './helpers/rest.mjs'

let failures = 0
const check = (name, cond) => {
  if (cond) console.log(`ok - ${name}`)
  else {
    console.log(`FAIL - ${name}`)
    failures++
  }
}

async function run() {
  const owner = await loginAsOwner()

  // --- last-per-item: no item can vanish regardless of table size ---
  const lastRes = await apiFetch('/api/counts/last-per-item', owner.cookie)
  check('last-per-item -> 200', lastRes.status === 200)
  const lastData = await lastRes.json()
  check('last-per-item response is an array', Array.isArray(lastData))

  const items = await rest('items?select=id')
  const batchSize = 20
  let realCountedItems = 0
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const results = await Promise.all(batch.map((it) => rest(`inventory_counts?item_id=eq.${it.id}&select=id&limit=1`)))
    realCountedItems += results.filter((r) => r.length > 0).length
  }
  check(
    `last-per-item returns one row per item that has ever been counted (${lastData.length} returned, ${realCountedItems} actually counted)`,
    lastData.length === realCountedItems
  )

  const returnedIds = new Set(lastData.map((r) => r.item_id))
  check('last-per-item has no duplicate item_id', returnedIds.size === lastData.length)

  // --- velocity / par-suggestions: well-formed over a very long range ---
  const wideStart = '2020-01-01'
  const today = new Date().toISOString().split('T')[0]
  const velRes = await apiFetch(`/api/reports/velocity?start=${wideStart}&end=${today}`, owner.cookie)
  check('velocity over a multi-year range -> 200', velRes.status === 200)
  const velData = await velRes.json()
  check('velocity response is an array', Array.isArray(velData))
  check(
    'velocity rows have well-formed shape (item_id/consumed/flagged present)',
    velData.length === 0 || velData.every((r) => typeof r.item_id === 'string' && typeof r.consumed === 'number' && typeof r.flagged === 'boolean')
  )

  const parRes = await apiFetch('/api/par-suggestions', owner.cookie)
  check('par-suggestions -> 200', parRes.status === 200)
  const parData = await parRes.json()
  check(
    'par-suggestions response is a plain object keyed by item_id',
    parData !== null && typeof parData === 'object' && !Array.isArray(parData)
  )

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
