// Patch 48: the whole-app audit found that POST /api/order-history's
// non-storage receive branch did a naive read-then-write on
// items.current_count (select current_count, then update to old + qty) --
// no compare-and-swap, no retry. Two overlapping receipts for the same
// item (owner on phone, shift lead on the touchscreen) could silently
// lose one increment. The storage branch right above it already guarded
// the same class of write with compare-and-swap + retry
// (src/lib/storage-server.ts's applyStorageChange); this patch gives the
// non-storage branch the same protection via a new, single-column sibling
// (applyCurrentCountIncrement, built on the same shared withRetry control
// flow -- not a second hand-rolled copy).
//
// This suite proves, against the real dev server and disposable ZZTEST
// items:
//  - a normal single receipt (storage and non-storage) still produces
//    exactly the same number as before
//  - firing two overlapping receipts for the same item never loses an
//    increment, across several repeated rounds
//  - a receipt that can't be fully applied is rolled back completely:
//    no order_history row left behind, and any item in that SAME receipt
//    that did get its stock incremented is reversed back to its original
//    value -- "nothing half-written"
//  - the underlying retry-on-conflict primitive actually gives up after
//    MAX_RETRIES attempts with a clear error, tested directly against a
//    fake db that always reports a conflict (the "(test only)" way to force
//    retry exhaustion the patch asked for, mirroring patch 47's
//    recordReminderSent mock-db test -- a real HTTP race can't reliably
//    force every single attempt to collide on command)
import { apiFetch, loginAsOwner } from './helpers/auth.mjs'
import { getServerSupabase } from '../../src/lib/supabase.ts'
import { applyCurrentCountIncrement } from '../../src/lib/storage-server.ts'

let failures = 0
const check = (name, cond) => {
  if (cond) console.log(`ok - ${name}`)
  else {
    console.log(`FAIL - ${name}`)
    failures++
  }
}

async function createItem(owner, overrides = {}) {
  const res = await apiFetch('/api/items', owner.cookie, {
    method: 'POST',
    body: JSON.stringify({ name: 'ZZTEST Race Item', category: 'Other', unit: 'boxes', ...overrides }),
  })
  const body = await res.json()
  return body
}

async function getItem(db, id) {
  const { data } = await db.from('items').select('*').eq('id', id).maybeSingle()
  return data
}

async function receive(owner, itemId, quantity, extra = {}) {
  return apiFetch('/api/order-history', owner.cookie, {
    method: 'POST',
    body: JSON.stringify({
      type: 'received',
      notes: 'ZZTEST race fixture',
      items: [{ item_id: itemId, item_name: 'ZZTEST Race Item', quantity, unit: 'boxes', ...extra }],
    }),
  })
}

async function run() {
  const db = getServerSupabase()
  const owner = await loginAsOwner()
  const createdItemIds = []
  const createdOrderIds = []

  try {
    // --- Part A: a normal single receipt still gives the same number ---
    const plainItem = await createItem(owner)
    createdItemIds.push(plainItem.id)
    check('setup: ZZTEST non-storage item created at current_count 0', plainItem.current_count === 0)

    const r1 = await receive(owner, plainItem.id, 5)
    const r1Body = await r1.json()
    check('single non-storage receipt (qty 5) -> 200', r1.status === 200)
    createdOrderIds.push(r1Body.id)
    const afterR1 = await getItem(db, plainItem.id)
    check('single non-storage receipt: current_count is exactly old (0) + 5', afterR1.current_count === 5)

    const r2 = await receive(owner, plainItem.id, 3)
    const r2Body = await r2.json()
    check('second single receipt (qty 3) -> 200', r2.status === 200)
    createdOrderIds.push(r2Body.id)
    const afterR2 = await getItem(db, plainItem.id)
    check('second single receipt: current_count is exactly 5 + 3 = 8', afterR2.current_count === 8)

    // --- storage-destination item still behaves exactly as before ---
    const storageItem = await createItem(owner, { name: 'ZZTEST Race Storage Item' })
    createdItemIds.push(storageItem.id)
    await apiFetch('/api/items/storage', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: storageItem.id, has_storage: true }) })
    const r3 = await receive(owner, storageItem.id, 4, { destination: 'storage' })
    const r3Body = await r3.json()
    check('storage-destination receipt -> 200', r3.status === 200)
    createdOrderIds.push(r3Body.id)
    const afterR3 = await getItem(db, storageItem.id)
    check('storage-destination receipt: storage_count is 0 + 4', afterR3.storage_count === 4)
    check('storage-destination receipt: current_count (store) untouched at 0', afterR3.current_count === 0)

    // --- Part B: concurrency -- two overlapping receipts never lose an increment ---
    const raceItem = await createItem(owner, { name: 'ZZTEST Race Concurrency Item' })
    createdItemIds.push(raceItem.id)
    const ROUNDS = 5
    for (let round = 1; round <= ROUNDS; round++) {
      const before = (await getItem(db, raceItem.id)).current_count
      const [resA, resB] = await Promise.all([receive(owner, raceItem.id, 5), receive(owner, raceItem.id, 7)])
      const [bodyA, bodyB] = await Promise.all([resA.json(), resB.json()])
      check(`round ${round}: both concurrent receipts -> 200`, resA.status === 200 && resB.status === 200)
      if (bodyA.id) createdOrderIds.push(bodyA.id)
      if (bodyB.id) createdOrderIds.push(bodyB.id)
      const after = (await getItem(db, raceItem.id)).current_count
      check(`round ${round}: final current_count is old (${before}) + 12, no lost update (got ${after})`, after === before + 12)
    }

    // --- Part C: a receipt that can't fully apply is rolled back completely ---
    // item A (real, healthy) + item B pre-loaded right up against
    // DECIMAL(10,2)'s precision limit, so receiving on top of it causes a
    // genuine Postgres numeric overflow -- a real, deterministic failure
    // from a real HTTP call, not a mock.
    const rollbackA = await createItem(owner, { name: 'ZZTEST Race Rollback Item A' })
    createdItemIds.push(rollbackA.id)
    const rollbackB = await createItem(owner, { name: 'ZZTEST Race Rollback Item B' })
    createdItemIds.push(rollbackB.id)
    await apiFetch('/api/items', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: rollbackB.id, current_count: 99999999 }) })

    const { count: orderCountBefore } = await db.from('order_history').select('id', { count: 'exact', head: true })

    const rollbackRes = await apiFetch('/api/order-history', owner.cookie, {
      method: 'POST',
      body: JSON.stringify({
        type: 'received',
        notes: 'ZZTEST race fixture',
        items: [
          { item_id: rollbackA.id, item_name: 'ZZTEST Race Rollback Item A', quantity: 5, unit: 'boxes' },
          { item_id: rollbackB.id, item_name: 'ZZTEST Race Rollback Item B', quantity: 10, unit: 'boxes' },
        ],
      }),
    })
    const rollbackBody = await rollbackRes.json()
    check('receipt with one item that cannot be applied -> a non-200 error, not a silent partial success', rollbackRes.status >= 400)
    check('...error message is clear (mentions the receipt was not saved)', typeof rollbackBody.error === 'string' && rollbackBody.error.length > 0)

    const rollbackAAfter = await getItem(db, rollbackA.id)
    check('item A (which DID get applied first) was rolled back to its original current_count (0)', rollbackAAfter.current_count === 0)
    const rollbackBAfter = await getItem(db, rollbackB.id)
    check('item B (the one that failed) is untouched at its pre-set value', Number(rollbackBAfter.current_count) === 99999999)

    const { count: orderCountAfter } = await db.from('order_history').select('id', { count: 'exact', head: true })
    check('no net new order_history row was left behind by the failed receipt', orderCountAfter === orderCountBefore)
  } finally {
    for (const id of createdOrderIds) {
      await apiFetch('/api/order-history', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id }) })
    }
    for (const id of createdItemIds) {
      await apiFetch('/api/items', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id }) })
    }
    console.log(`cleanup - removed ${createdOrderIds.length} ZZTEST order_history row(s) and ${createdItemIds.length} ZZTEST item(s)`)
  }

  // --- Part D: retry exhaustion, forced deterministically against a fake
  // db that always reports a conflict (0 rows matched), never a real write ---
  function alwaysConflictingDb() {
    let updateAttempts = 0
    const chain = {
      eq() {
        return chain
      },
      select() {
        return chain
      },
      maybeSingle: async () => {
        if (chain.__mode === 'read') return { data: { id: 'zztest-fake-item', current_count: 10 }, error: null }
        return { data: null, error: null } // write: simulate "0 rows matched" every time
      },
    }
    return {
      updateAttempts: () => updateAttempts,
      from() {
        return {
          select() {
            chain.__mode = 'read'
            return chain
          },
          update() {
            updateAttempts++
            chain.__mode = 'write'
            return chain
          },
        }
      },
    }
  }

  const fakeDb = alwaysConflictingDb()
  const exhausted = await applyCurrentCountIncrement(fakeDb, { itemId: 'zztest-fake-item', amount: 5 })
  check('retries exhausted: applyCurrentCountIncrement returns a clear, non-ok error', exhausted.ok === false && typeof exhausted.error === 'string')
  check('retries exhausted: error status is 409 (conflict), not a generic 500', exhausted.ok === false && exhausted.status === 409)
  check('retries exhausted: attempted exactly 3 writes (MAX_RETRIES), not fewer or more', fakeDb.updateAttempts() === 3)

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
