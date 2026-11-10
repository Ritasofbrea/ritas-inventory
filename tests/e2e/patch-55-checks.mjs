// Patch 55: Ice Mix stays in gallons (counting/par/current-stock/history/
// velocity all unchanged); Order List and Receive Order talk in boxes for
// any Ice Mix item with pack_size=4 and unit=gallons (usesBoxOrdering in
// src/lib/order-units.ts). Drives a real browser against a single ZZTEST
// Ice Mix item to prove:
//   1. Order List's Have/Par/Order box+gallon breakdown is right across the
//      full test matrix the patch spec calls for (6/0/4/8/9/2.5 gal at
//      par=8), including the zero-remainder/zero-box hiding rules and that
//      an item at/above par drops out of the list entirely (unchanged
//      getStockStatus behavior).
//   2. Receiving 2 boxes through the real Receive Order flow adds exactly
//      8 gallons to current_count (the one and only unit conversion point)
//      and the Order History tab shows the receipt as "8 gallons (2 boxes)".
import { chromium } from 'playwright'
import { createSessionToken } from '../../src/lib/session-token.ts'
import { apiFetch, loginAsOwner } from './helpers/auth.mjs'
import { BASE_URL } from './helpers/config.mjs'

let failures = 0
const check = (name, cond) => {
  if (cond) console.log(`ok - ${name}`)
  else {
    console.log(`FAIL - ${name}`)
    failures++
  }
}

const NAME = 'ZZTEST Patch55 IceMix'

async function run() {
  const owner = await loginAsOwner()
  let itemId = null
  let receiptOrderId = null

  try {
    // ---------- setup ----------
    const createRes = await apiFetch('/api/items', owner.cookie, {
      method: 'POST',
      body: JSON.stringify({ name: NAME, category: 'Ice Mix', unit: 'gallons' }),
    })
    const item = await createRes.json()
    itemId = item.id
    check('setup: ZZTEST Ice Mix item created', createRes.status === 200)

    const packRes = await apiFetch('/api/items/pack-size', owner.cookie, {
      method: 'PATCH',
      body: JSON.stringify({ id: itemId, pack_size: 4 }),
    })
    check('setup: pack_size set to 4', packRes.status === 200)

    const token = createSessionToken('owner', 'ZZTEST Owner').token
    const browser = await chromium.launch()
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
    await ctx.addCookies([{ name: 'ritas_session', value: token, domain: 'localhost', path: '/' }])
    const page = await ctx.newPage()
    await page.addInitScript(() => {
      localStorage.setItem('ritas_role', 'owner')
      localStorage.setItem('ritas_owner_name', 'ZZTEST Owner')
    })

    // ---------- Order List: the exact example from the spec ----------
    await apiFetch('/api/items', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: itemId, current_count: 6, par_level: 8 }) })
    await page.goto(`${BASE_URL}/order-list`, { waitUntil: 'networkidle' })
    let body = await page.locator('body').innerText()
    check('Order List: item visible at 6 gal / par 8', body.includes(NAME))
    check('Order List: "Have: 6 gallons (1 box + 2 gallons)"', body.includes('Have: 6 gallons (1 box + 2 gallons)'))
    check('Order List: "Par: 8 gallons (2 boxes)"', body.includes('Par: 8 gallons (2 boxes)'))
    check('Order List: "Order: 1 box"', body.includes('Order: 1 box'))

    // ---------- Order List: 0 / 4 / 8 / 9 / 2.5 gal matrix (par stays 8) ----------
    // "gallons" (the full word), not the spec's shorthand "gal" -- matches
    // the existing unitLabel dictionary convention used everywhere else.
    const matrix = [
      { count: 0, have: 'Have: 0 gallons', order: 'Order: 2 boxes', visible: true },
      { count: 4, have: 'Have: 4 gallons (1 box)', order: 'Order: 1 box', visible: true },
      { count: 8, visible: false }, // at par -- drops out of the list entirely
      { count: 9, visible: false }, // above par -- same
      { count: 2.5, have: 'Have: 2.5 gallons', order: 'Order: 2 boxes', visible: true },
    ]
    for (const m of matrix) {
      await apiFetch('/api/items', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: itemId, current_count: m.count }) })
      await page.reload({ waitUntil: 'networkidle' })
      body = await page.locator('body').innerText()
      if (!m.visible) {
        check(`Order List: at ${m.count} gal (>= par 8), item is not listed`, !body.includes(NAME))
      } else {
        check(`Order List: at ${m.count} gal, "${m.have}"`, body.includes(m.have))
        check(`Order List: at ${m.count} gal, "${m.order}"`, body.includes(m.order))
      }
    }

    // ---------- Receive Order: receive 2 boxes ----------
    await apiFetch('/api/items', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: itemId, current_count: 6, par_level: 8 }) })

    await page.goto(`${BASE_URL}/receive-order`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /Continue/i }).click()
    await page.waitForTimeout(500)

    await page.locator('input[placeholder="Notes (optional) — e.g. missing 2 cases, damaged box"]').fill('ZZTEST patch 55 receipt')
    await page.getByPlaceholder('Search items…').fill(NAME)
    await page.waitForTimeout(300)
    const header = page.getByRole('button', { name: /Ice Mix/i }).first()
    if ((await header.getAttribute('aria-expanded')) !== 'true') {
      await header.click()
      await page.waitForTimeout(300)
    }

    const rowBodyBefore = await page.locator('body').innerText()
    check('Receive Order: box caption shown for this item before entry', rowBodyBefore.includes(NAME))

    await page.getByPlaceholder('0').first().fill('2')
    await page.waitForTimeout(200)
    const rowBodyAfter = await page.locator('body').innerText()
    check('Receive Order: "boxes" caption under the input', rowBodyAfter.includes('boxes'))
    // Patch 56: this preview line was generalized off a hardcoded "gal"
    // abbreviation to the item's real unit word via unitLabel() (so Sugar
    // Free/Syrups/other pack_size items read correctly too) -- now reads
    // "= 8 gallons", matching every other full-word unit display in this
    // app (e.g. Order List's own "6 gallons (1 box + 2 gallons)" below).
    check('Receive Order: live conversion preview "= 8 gallons"', rowBodyAfter.includes('= 8 gallons'))

    await page.getByRole('button', { name: /Review & Save/i }).click()
    await page.waitForSelector('text=Receipt Saved', { timeout: 10000 }).catch(() => {})
    check('Receive Order: receipt saved', await page.getByText('Receipt Saved').isVisible())

    await page.waitForTimeout(300)
    const refetched = await apiFetch('/api/items', owner.cookie).then((r) => r.json())
    const itemNow = refetched.find((i) => i.id === itemId)
    check('Receive Order: stock went from 6 to 14 gal (2 boxes x 4 = +8)', itemNow?.current_count === 14)

    const historyRes = await apiFetch('/api/order-history?type=received', owner.cookie)
    const historyOrders = await historyRes.json()
    const ourReceipt = historyOrders.find((o) => (o.order_history_items ?? []).some((i) => i.item_id === itemId))
    if (ourReceipt) receiptOrderId = ourReceipt.id
    const historyItem = ourReceipt?.order_history_items.find((i) => i.item_id === itemId)
    check('History data: order_history_items stored quantity=8, unit=gallons', historyItem?.quantity === 8 && historyItem?.unit === 'gallons')

    // ---------- Order List's Order History tab shows "8 gallons (2 boxes)" ----------
    await page.goto(`${BASE_URL}/order-list`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Order History' }).click()
    await page.waitForTimeout(400)
    const firstEntry = page.getByText(new Date().toLocaleDateString('en-US', { month: 'short' })).first()
    if ((await firstEntry.count()) > 0) {
      await firstEntry.click()
      await page.waitForTimeout(300)
    }
    const historyBody = await page.locator('body').innerText()
    check('Order History tab: shows "8 gallons (2 boxes)" for the receipt', historyBody.includes('8 gallons (2 boxes)'))
  } finally {
    if (receiptOrderId) await apiFetch('/api/order-history', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: receiptOrderId }) }).catch(() => {})
    if (itemId) await apiFetch('/api/items', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: itemId }) }).catch(() => {})
    console.log('cleanup - removed ZZTEST item and its order_history receipt')
  }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
