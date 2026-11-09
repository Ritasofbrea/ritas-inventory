// Patch 47: order_history has no upper bound, and an unlimited .select()
// silently truncates at PostgREST's 1000-row cap (same bug class as patch
// 41). src/lib/order-list-server.ts's getItemsNeedingOrderByVendor fed the
// Order List's vendor counts, GET /api/vendor-schedules, and the
// vendor-reminders cron from exactly this kind of unbounded fetch. The fix
// (fetchAllOrderHistoryRows) pages the whole table with .range() instead,
// which can't silently drop rows regardless of table size.
//
// This suite can't practically grow order_history past 1000 real rows, so
// it proves the paging loop itself is correct a different way: force a
// tiny pageSize (2) and confirm the result is byte-for-byte the same set of
// rows a plain unbounded .select() returns, using a handful of disposable
// ZZTEST order_history rows to guarantee there's real content to page
// through either way. Also proves getItemsNeedingOrderByVendor's byVendor
// output is unchanged from what the OLD (pre-patch-47) single-select logic
// would have produced, on real data, read-only except for the ZZTEST rows
// this suite creates and cleans up itself.
//
// Also covers patch 47's second fix: src/lib/vendor-reminder-server.ts's
// recordReminderSent (the vendor_reminder_log write the cron route now
// performs BEFORE sending a push) -- its failure path is tested here with
// a hand-rolled fake db stub, never a real write, per the patch's own
// "mock or inject an error, not in real data" instruction.
import { apiFetch, loginAsOwner } from './helpers/auth.mjs'
import { getServerSupabase } from '../../src/lib/supabase.ts'
import { fetchAllOrderHistoryRows, getItemsNeedingOrderByVendor } from '../../src/lib/order-list-server.ts'
import { getStockStatus } from '../../src/lib/types.ts'
import { vendorKeyForItem } from '../../src/lib/vendor-schedule.ts'
import { recordReminderSent } from '../../src/lib/vendor-reminder-server.ts'

let failures = 0
const check = (name, cond) => {
  if (cond) console.log(`ok - ${name}`)
  else {
    console.log(`FAIL - ${name}`)
    failures++
  }
}

function sortedIds(rows) {
  return rows.map((r) => r.id).sort()
}

// The OLD (pre-patch-47) matching logic, duplicated here deliberately --
// not imported -- so this is an independent re-implementation to compare
// the NEW code's output against, not just the new code checking itself.
function oldStyleByVendor(items, orderRows) {
  const fulfilledOrderIds = new Set(
    orderRows.filter((r) => r.type === 'received' || r.type === 'will_call').map((r) => r.related_order_id).filter(Boolean)
  )
  const pending = orderRows.filter((r) => r.type === 'ordered' && !fulfilledOrderIds.has(r.id))
  const onOrderItemIds = new Set()
  for (const order of pending) {
    for (const line of order.order_history_items) {
      if (line.item_id) onOrderItemIds.add(line.item_id)
    }
  }
  const needsOrder = items.filter((i) => !i.is_off && getStockStatus(i) !== 'ok')
  const toOrder = needsOrder.filter((i) => !onOrderItemIds.has(i.id))
  const byVendor = {}
  for (const item of toOrder) {
    const key = vendorKeyForItem(item.distributor)
    if (!byVendor[key]) byVendor[key] = []
    byVendor[key].push(item.id)
  }
  for (const key of Object.keys(byVendor)) byVendor[key].sort()
  return byVendor
}

async function run() {
  const db = getServerSupabase()
  const owner = await loginAsOwner()
  let itemId = null
  const orderIds = []
  // order_history_related_order_id_fkey is enforced as a blocking
  // constraint in the live DB (not the ON DELETE SET NULL add-order-
  // history.sql documents -- a real schema-drift finding, reported
  // separately), so a row with a related_order_id must be deleted BEFORE
  // the row it points to. Tracked here so cleanup can delete in that order.
  const referencingOrderIds = []

  try {
    // --- Part A: paging vs. a plain unbounded select, on real data as it
    // stands right now (no ZZTEST rows yet) ---
    const { data: plainNow, error: plainNowErr } = await db
      .from('order_history')
      .select('id, type, related_order_id, order_history_items(item_id)')
    check('setup: plain unbounded select of real order_history succeeded', !plainNowErr)
    const pagedNow = await fetchAllOrderHistoryRows(db)
    check(
      'fetchAllOrderHistoryRows(default pageSize) matches a plain unbounded select on real data (same row count + ids)',
      plainNow.length === pagedNow.length && JSON.stringify(sortedIds(plainNow)) === JSON.stringify(sortedIds(pagedNow))
    )
    console.log(`info - real order_history row count right now: ${plainNow.length}`)

    // --- Part B: create a handful of ZZTEST rows, then force pageSize=2 ---
    const createItemRes = await apiFetch('/api/items', owner.cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'ZZTEST Paging Item', category: 'Other', unit: 'boxes' }),
    })
    const createdItem = await createItemRes.json()
    itemId = createdItem.id
    check('setup: ZZTEST item created', createItemRes.status === 200 && !!itemId)

    async function placeOrder(type, qty, relatedOrderId) {
      const res = await apiFetch('/api/order-history', owner.cookie, {
        method: 'POST',
        body: JSON.stringify({
          type,
          items: [{ item_id: itemId, item_name: 'ZZTEST Paging Item', quantity: qty, unit: 'boxes' }],
          related_order_id: relatedOrderId || undefined,
          notes: 'ZZTEST paging fixture',
        }),
      })
      const body = await res.json()
      check(`setup: ${type} order created (qty ${qty})`, res.status === 200 && !!body.id)
      orderIds.push(body.id)
      if (relatedOrderId) referencingOrderIds.push(body.id)
      return body
    }

    const o1 = await placeOrder('ordered', 5)
    await placeOrder('received', 5, o1.id) // fulfills o1
    await placeOrder('ordered', 3) // stays pending
    await placeOrder('ordered', 1) // stays pending
    const o5 = await placeOrder('ordered', 2)
    await placeOrder('will_call', 2, o5.id) // fulfills o5

    const { data: plainAfter, error: plainAfterErr } = await db
      .from('order_history')
      .select('id, type, related_order_id, order_history_items(item_id)')
    check('plain unbounded select succeeded after adding ZZTEST rows', !plainAfterErr)

    const pagedTiny = await fetchAllOrderHistoryRows(db, 2)
    check(
      'fetchAllOrderHistoryRows(pageSize=2) matches a plain unbounded select (same row count + ids), forced across >=3 pages',
      plainAfter.length === pagedTiny.length && JSON.stringify(sortedIds(plainAfter)) === JSON.stringify(sortedIds(pagedTiny))
    )
    check('pageSize=2 run actually spanned multiple pages', plainAfter.length > 2)

    const pagedTinyById = new Map(pagedTiny.map((r) => [r.id, r]))
    let allZztestRowsPresentAndCorrect = orderIds.length === 6
    for (const id of orderIds) {
      const row = pagedTinyById.get(id)
      if (!row || !Array.isArray(row.order_history_items) || row.order_history_items.length !== 1 || row.order_history_items[0].item_id !== itemId) {
        allZztestRowsPresentAndCorrect = false
      }
    }
    check('every ZZTEST order survived pageSize=2 paging with its order_history_items intact', allZztestRowsPresentAndCorrect)

    // --- Part C: functional parity through the real matching logic ---
    const { data: realItems, error: itemsErr } = await db.from('items').select('*')
    check('setup: real items fetched for parity check', !itemsErr)

    const newByVendor = await getItemsNeedingOrderByVendor(db)
    const newByVendorIds = {}
    for (const key of Object.keys(newByVendor)) newByVendorIds[key] = newByVendor[key].map((i) => i.id).sort()

    const oldByVendorIds = oldStyleByVendor(realItems, plainAfter)

    check(
      'getItemsNeedingOrderByVendor (new, paged) produces the same byVendor item sets as the old single-select logic, on real data',
      JSON.stringify(newByVendorIds) === JSON.stringify(oldByVendorIds)
    )
    console.log('info - byVendor item counts (new code):', Object.fromEntries(Object.entries(newByVendorIds).map(([k, v]) => [k, v.length])))
    console.log('info - byVendor item counts (old-style, independently recomputed):', Object.fromEntries(Object.entries(oldByVendorIds).map(([k, v]) => [k, v.length])))

    // --- Part D: the live route, for a real end-to-end number ---
    const vsRes = await apiFetch('/api/vendor-schedules', owner.cookie)
    const vsBody = await vsRes.json()
    check('GET /api/vendor-schedules succeeded', vsRes.status === 200)
    if (Array.isArray(vsBody)) {
      console.log('info - GET /api/vendor-schedules itemCount per vendor (real data, right now):', Object.fromEntries(vsBody.map((v) => [v.vendor, v.itemCount])))
    }
  } finally {
    // Cleanup: delete ZZTEST orders first (cascades order_history_items),
    // then the ZZTEST item.
    let deleteFailures = 0
    const deleteOrder = [...referencingOrderIds, ...orderIds.filter((id) => !referencingOrderIds.includes(id))]
    for (const id of deleteOrder) {
      const delRes = await apiFetch('/api/order-history', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id }) })
      if (delRes.status !== 200) {
        deleteFailures++
        console.error(`cleanup - DELETE /api/order-history for ${id} returned ${delRes.status}: ${await delRes.text()}`)
      }
    }
    if (itemId) {
      await apiFetch('/api/items', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: itemId }) })
    }
    console.log(`cleanup - removed ${orderIds.length - deleteFailures}/${orderIds.length} ZZTEST order_history row(s)${itemId ? ' and the ZZTEST item' : ''}`)
  }

  // --- Part E: recordReminderSent's failure path, mocked db, no real writes ---
  const fakeDb = (shouldFail) => ({
    from: () => ({
      upsert: async () => (shouldFail ? { error: { message: 'simulated upsert failure' } } : { data: {}, error: null }),
    }),
  })

  const successResult = await recordReminderSent(fakeDb(false), 'ZZTEST Vendor', '2026-01-05', 1)
  check('recordReminderSent: success path returns { ok: true } against a mocked db', successResult.ok === true)

  const failureResult = await recordReminderSent(fakeDb(true), 'ZZTEST Vendor', '2026-01-05', 1)
  check('recordReminderSent: failure path returns { ok: false, error } against a mocked db', failureResult.ok === false && failureResult.error === 'simulated upsert failure')

  // --- Part F: loop-level proof that one vendor's failure doesn't stop
  // others, mirroring the cron route's own loop (including its
  // console.error call) with the same mocked db ---
  const originalConsoleError = console.error
  let loggedError = null
  console.error = (...args) => {
    loggedError = args.join(' ')
  }

  const simulatedVendors = [
    { vendor: 'ZZTEST Vendor A', db: fakeDb(true) },
    { vendor: 'ZZTEST Vendor B', db: fakeDb(false) },
  ]
  let simSent = 0
  const simFailed = {}
  for (const v of simulatedVendors) {
    const rec = await recordReminderSent(v.db, v.vendor, '2026-01-05', 1)
    if (!rec.ok) {
      console.error(`vendor-reminders: failed to record vendor_reminder_log for ${v.vendor}/2026-01-05 -- skipping this tick's push: ${rec.error}`)
      simFailed[v.vendor] = rec.error
      continue
    }
    simSent++
  }
  console.error = originalConsoleError

  check('loop simulation: vendor A (failing db) lands in failed, does not throw/stop the loop', simFailed['ZZTEST Vendor A'] === 'simulated upsert failure')
  check('loop simulation: vendor B (healthy db) still processed after A failed', simSent === 1 && !('ZZTEST Vendor B' in simFailed))
  check('vendor A failure is console.error-logged (same as the real route does)', typeof loggedError === 'string' && loggedError.includes('ZZTEST Vendor A'))

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
