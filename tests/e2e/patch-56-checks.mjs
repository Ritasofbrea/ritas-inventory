// Patch 56: generalizes patch 55's Ice-Mix-only "box ordering" gate
// (usesBoxOrdering in src/lib/order-units.ts) to ANY item with a positive
// whole-number pack_size, gives Sugar Free Ice Mix (pack_size 6) and
// Syrups (pack_size 2) box wording, and fixes a real latent bug: Receive
// Order used to only convert a typed box count to stock units for the
// narrow Ice Mix gate -- every other pre-existing pack_size item (Matcha
// Syrup, Chocolate Base, Caramel, Peanut Butter Topping) had its typed
// quantity saved with NO conversion at all. This suite proves, against
// five ZZTEST fixtures:
//   1. Order List's Have/Par/Order box+remainder breakdown is correct for
//      box-word items (Ice Mix/Syrups categories), case-word items (any
//      other pack_size category), and that a plain no-pack_size item is
//      completely unchanged.
//   2. Receive Order converts a typed box/case count to the real stock
//      unit exactly once (no double multiplication) for every pack_size
//      item, regardless of category/unit/word.
//   3. Short/full detection compares box-denominated values on both sides
//      now that it applies to every pack_size item, not just Ice Mix.
//   4. The new mistake-guard confirm popup: a live math line always shows
//      while typing, a confirm popup appears exactly when typed exceeds
//      what was ordered (or, with nothing ordered, at/above one full
//      pack), "Fix it" saves nothing and changes no stock, "Yes" saves
//      exactly once with the right stock delta, and normal amounts never
//      trigger it.
//   5. Manage Items' pack-size preview uses the same shared box/case word.
//
// Safety note: "Mark as Ordered" is never driven through the Order List UI
// here -- that button operates on whatever's currently checked, and by
// default EVERY real low-stock item in production is pre-checked, plus it
// silences real vendor reminders (vendor_week_status). Creating the
// 'ordered' order_history record directly via POST /api/order-history
// (the exact same call and payload shape the button itself makes) tests
// the same save path without that blast radius. Order List's wording
// itself is still proven through the real rendered page in step 1.
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

const NAMES = {
  sugarFree: 'ZZTEST P56 SugarFree',
  syrup: 'ZZTEST P56 Syrup',
  iceMix: 'ZZTEST P56 IceMix',
  topping: 'ZZTEST P56 Topping',
  plain: 'ZZTEST P56 Plain',
}

function itemRow(page, name) {
  return page.locator('div.flex.items-center.gap-4.px-5.py-4').filter({ hasText: name }).first()
}

async function expandCategory(page, label) {
  const header = page.getByRole('button', { name: label, exact: true })
  if ((await header.count()) === 0) return
  if ((await header.first().getAttribute('aria-expanded')) !== 'true') {
    await header.first().click()
    await page.waitForTimeout(250)
  }
}

async function run() {
  const owner = await loginAsOwner()
  const itemIds = {}
  const orderHistoryIds = []

  try {
    // ---------- setup: 5 fixtures ----------
    const create = async (name, category, unit) => {
      const res = await apiFetch('/api/items', owner.cookie, { method: 'POST', body: JSON.stringify({ name, category, unit }) })
      const item = await res.json()
      check(`setup: ${name} created`, res.status === 200)
      return item.id
    }
    itemIds.sugarFree = await create(NAMES.sugarFree, 'Ice Mix', 'bottles')
    itemIds.syrup = await create(NAMES.syrup, 'Syrups', 'bottles')
    itemIds.iceMix = await create(NAMES.iceMix, 'Ice Mix', 'gallons')
    itemIds.topping = await create(NAMES.topping, 'Toppings - Wet', 'bags')
    itemIds.plain = await create(NAMES.plain, 'Napkins & Paper', 'rolls')

    const setPack = async (id, pack_size) => {
      const res = await apiFetch('/api/items/pack-size', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id, pack_size }) })
      check(`setup: pack_size ${pack_size} set`, res.status === 200)
    }
    await setPack(itemIds.sugarFree, 6)
    await setPack(itemIds.syrup, 2)
    await setPack(itemIds.iceMix, 4)
    await setPack(itemIds.topping, 4)
    // plain: no pack_size

    const setCounts = async (id, current_count, par_level) => {
      const res = await apiFetch('/api/items', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id, current_count, par_level }) })
      check(`setup: counts set for ${id}`, res.status === 200)
    }
    await setCounts(itemIds.sugarFree, 2.5, 8) // decimal on-hand count
    await setCounts(itemIds.syrup, 1, 5)
    await setCounts(itemIds.iceMix, 6, 8)
    await setCounts(itemIds.topping, 0, 10)
    await setCounts(itemIds.plain, 1, 5)

    const token = createSessionToken('owner', 'ZZTEST Owner').token
    const browser = await chromium.launch()
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
    await ctx.addCookies([{ name: 'ritas_session', value: token, domain: 'localhost', path: '/' }])
    const page = await ctx.newPage()
    await page.addInitScript(() => {
      localStorage.setItem('ritas_role', 'owner')
      localStorage.setItem('ritas_owner_name', 'ZZTEST Owner')
    })

    // ---------- Stage A: Order List breakdown + default order qty ----------
    await page.goto(`${BASE_URL}/order-list`, { waitUntil: 'networkidle' })
    let body = await page.locator('body').innerText()

    check('Order List: Sugar Free "Have: 2.5 bottles" (decimal on-hand, no box)', body.includes('Have: 2.5 bottles'))
    check('Order List: Sugar Free "Par: 8 bottles (1 box + 2 bottles)"', body.includes('Par: 8 bottles (1 box + 2 bottles)'))
    check('Order List: Sugar Free "Order: 1 box"', body.includes('Order: 1 box'))

    check('Order List: Syrup "Have: 1 bottle" (singular)', body.includes('Have: 1 bottle'))
    check('Order List: Syrup "Par: 5 bottles (2 boxes + 1 bottle)"', body.includes('Par: 5 bottles (2 boxes + 1 bottle)'))
    check('Order List: Syrup "Order: 2 boxes"', body.includes('Order: 2 boxes'))

    check('Order List: Ice Mix regression "Have: 6 gallons (1 box + 2 gallons)"', body.includes('Have: 6 gallons (1 box + 2 gallons)'))
    check('Order List: Ice Mix regression "Par: 8 gallons (2 boxes)"', body.includes('Par: 8 gallons (2 boxes)'))

    check('Order List: Topping "Have: 0 bags" (generic "case" word, no box)', body.includes('Have: 0 bags'))
    check('Order List: Topping "Par: 10 bags (2 cases + 2 bags)"', body.includes('Par: 10 bags (2 cases + 2 bags)'))
    check('Order List: Topping "Order: 3 cases"', body.includes('Order: 3 cases'))

    check('Order List: Plain item unchanged -- "Have 1" / ", want " / "5 rolls"', body.includes('Have1') === false && body.includes('5 rolls') && body.includes(', want '))
    check('Order List: Plain item has no box/case breakdown', !new RegExp(`${NAMES.plain}[\\s\\S]{0,200}\\(`).test(body))

    // ---------- Stage B: create ONE pending order with 2 items, direct API ----------
    // Mirrors exactly what clicking "Mark as Ordered" sends (item_id,
    // item_name, quantity, unit: getOrderUnitLabel(item)) -- see the safety
    // note above for why this isn't driven through the Order List UI.
    const markRes = await apiFetch('/api/order-history', owner.cookie, {
      method: 'POST',
      body: JSON.stringify({
        type: 'ordered',
        items: [
          { item_id: itemIds.sugarFree, item_name: NAMES.sugarFree, quantity: 1, unit: 'boxes' },
          { item_id: itemIds.topping, item_name: NAMES.topping, quantity: 3, unit: 'case' },
        ],
      }),
    })
    const markOrder = await markRes.json()
    orderHistoryIds.push(markOrder.id)
    check('Mark-as-Ordered-equivalent save: 200', markRes.status === 200)
    check('Mark-as-Ordered-equivalent save: Sugar Free word "boxes"', markOrder.order_history_items.find((i) => i.item_id === itemIds.sugarFree)?.unit === 'boxes')
    check('Mark-as-Ordered-equivalent save: Topping word "case"', markOrder.order_history_items.find((i) => i.item_id === itemIds.topping)?.unit === 'case')

    // ---------- Manage Items: shared-helper preview wording ----------
    await page.goto(`${BASE_URL}/manage-items`, { waitUntil: 'networkidle' })
    await page.getByPlaceholder('Search items…').fill('ZZTEST P56')
    await page.waitForTimeout(300)
    for (const cat of ['Ice Mix', 'Syrups', 'Toppings - Wet']) {
      await expandCategory(page, cat)
    }
    body = await page.locator('body').innerText()
    check('Manage Items: Sugar Free preview "1 box = 6 bottles"', body.includes('1 box = 6 bottles'))
    check('Manage Items: Syrup preview "1 box = 2 bottles"', body.includes('1 box = 2 bottles'))
    check('Manage Items: Ice Mix preview "1 box = 4 gallons"', body.includes('1 box = 4 gallons'))
    check('Manage Items: Topping preview "1 case = 4 bags"', body.includes('1 case = 4 bags'))

    // ---------- Stage C/D: Receive Order, selecting the combined order ----------
    await page.goto(`${BASE_URL}/receive-order`, { waitUntil: 'networkidle' })
    // Pick the first real order in the list (index 0 is "No specific
    // order"; our just-created order is the newest 'ordered' record, so
    // it's first among real ones).
    const orderRadios = page.locator('input[name="order"]')
    await orderRadios.nth(1).check()
    await page.getByRole('button', { name: /Continue/i }).click()
    await page.waitForTimeout(400)

    await page.getByPlaceholder('Search items…').fill('ZZTEST P56')
    await page.waitForTimeout(300)
    for (const cat of ['Syrups', 'Ice Mix', 'Toppings - Wet', 'Napkins & Paper']) {
      await expandCategory(page, cat)
    }

    body = await page.locator('body').innerText()
    check('Receive Order: both order items show On Order', (body.match(/On Order/g) || []).length === 2)

    // isFull check before touching anything -- both items prefilled to
    // exactly their ordered amount.
    const sfRowInitial = await itemRow(page, NAMES.sugarFree).innerText()
    const topRowInitial = await itemRow(page, NAMES.topping).innerText()
    check('Receive Order: Sugar Free prefilled to ordered qty shows full ✓', sfRowInitial.includes('✓'))
    check('Receive Order: Topping prefilled to ordered qty shows full ✓', topRowInitial.includes('✓'))

    // ---------- Fix-it dry run: Ice Mix typed way over pack_size, nothing ordered ----------
    await itemRow(page, NAMES.iceMix).locator('input[placeholder="0"]').fill('999')
    await page.waitForTimeout(150)
    await page.getByRole('button', { name: /Review & Save/i }).click()
    await page.waitForTimeout(400)
    let modalText = await page.locator('[role="alertdialog"]').innerText().catch(() => '')
    check('Mistake guard: popup shown for Ice Mix typed 999 (no order, >= pack 4)', modalText.includes(NAMES.iceMix) && modalText.includes('999') && modalText.includes('3996'))
    check('Mistake guard: popup does NOT mention Sugar Free/Topping (both at/under ordered amount)', !modalText.includes(NAMES.sugarFree) && !modalText.includes(NAMES.topping))
    await page.getByRole('button', { name: /Fix it/i }).click()
    await page.waitForTimeout(300)
    check('Mistake guard: "Fix it" closes the popup, stays on enter step', await page.getByPlaceholder('Search items…').isVisible())
    const iceMixAfterFixIt = await apiFetch('/api/items', owner.cookie).then((r) => r.json()).then((d) => d.find((i) => i.id === itemIds.iceMix))
    check('Mistake guard: "Fix it" saved nothing -- Ice Mix stock unchanged (still 6)', iceMixAfterFixIt?.current_count === 6)

    // ---------- Real values: set every field for the final submit ----------
    await itemRow(page, NAMES.iceMix).locator('input[placeholder="0"]').fill('2') // not on order, 2 < pack 4 -> no flag
    await itemRow(page, NAMES.sugarFree).locator('input[placeholder="0"]').fill('2') // on order (ordered 1), 2 > 1 -> flag
    await itemRow(page, NAMES.topping).locator('input[placeholder="0"]').fill('1') // on order (ordered 3), 1 < 3 -> short, not a mistake flag
    await itemRow(page, NAMES.syrup).locator('input[placeholder="0"]').fill('2') // not on order, 2 >= pack 2 -> flag
    await itemRow(page, NAMES.plain).locator('input[placeholder="0"]').fill('2') // no pack_size -> never flagged
    await page.waitForTimeout(200)

    body = await page.locator('body').innerText()
    check('Live math line: Sugar Free shows "boxes" caption', (await itemRow(page, NAMES.sugarFree).innerText()).includes('boxes'))
    check('Live math line: Sugar Free shows "= 12 bottles"', (await itemRow(page, NAMES.sugarFree).innerText()).includes('= 12 bottles'))
    check('Live math line: Topping shows "case" caption', (await itemRow(page, NAMES.topping).innerText()).includes('case'))
    check('Live math line: Topping shows "= 4 bags"', (await itemRow(page, NAMES.topping).innerText()).includes('= 4 bags'))
    check('Live math line: Syrup shows "= 4 bottles"', (await itemRow(page, NAMES.syrup).innerText()).includes('= 4 bottles'))
    check('Live math line: Ice Mix shows "= 8 gallons" (generalized, no more hardcoded "gal")', (await itemRow(page, NAMES.iceMix).innerText()).includes('= 8 gallons'))

    await page.getByRole('button', { name: /Review & Save/i }).click()
    await page.waitForTimeout(400)
    modalText = await page.locator('[role="alertdialog"]').innerText().catch(() => '')
    check('Mistake guard: flags exactly Sugar Free (over-ordered) and Syrup (over-pack, no order)', modalText.includes(NAMES.sugarFree) && modalText.includes(NAMES.syrup))
    check('Mistake guard: does not flag Topping (under ordered amount)', !modalText.includes(NAMES.topping))
    check('Mistake guard: does not flag Ice Mix (under pack_size)', !modalText.includes(NAMES.iceMix))
    check('Mistake guard: does not flag Plain (no pack_size)', !modalText.includes(NAMES.plain))
    check('Mistake guard: sentence "2 boxes = 12 bottles" for Sugar Free', modalText.includes('2 boxes = 12 bottles') || modalText.includes('2 box = 12 bottles'))
    check('Mistake guard: sentence "2 boxes = 4 bottles" for Syrup', modalText.includes('2 boxes = 4 bottles') || modalText.includes('2 box = 4 bottles'))
    check('Mistake guard: multi-item button says "Yes, add all"', (await page.getByRole('button', { name: /Yes, add all/i }).count()) === 1)

    await page.getByRole('button', { name: /Yes, add all/i }).click()
    await page.waitForTimeout(500)

    // Short detection must fire next (Topping short by 2 cases) -- box-
    // denominated comparison now applies to every pack_size item.
    body = await page.locator('body').innerText()
    check('Short shipment step shown for Topping', body.includes('Short Shipment'))
    check('Short detail: "Ordered: 3 case"', body.includes('Ordered:') && body.includes('3 case'))
    check('Short detail: "Received: 1 case"', body.includes('Received:') && body.includes('1 case'))
    check('Short detail: "Short: 2 case"', body.includes('Short: 2 case'))

    await page.locator('input[type="checkbox"]').first().check()
    await page.getByRole('button', { name: /Confirm & Save/i }).click()
    await page.waitForSelector('text=Receipt Saved', { timeout: 10000 }).catch(() => {})
    check('Receipt saved (with short alert)', await page.getByText('Receipt Saved').isVisible())

    await page.waitForTimeout(400)
    const refetched = await apiFetch('/api/items', owner.cookie).then((r) => r.json())
    const get = (id) => refetched.find((i) => i.id === id)
    check('Stock: Sugar Free 2.5 + (2*6=12) = 14.5 -- exactly once, no double multiplication', get(itemIds.sugarFree)?.current_count === 14.5)
    check('Stock: Syrup 1 + (2*2=4) = 5', get(itemIds.syrup)?.current_count === 5)
    check('Stock: Ice Mix 6 + (2*4=8) = 14', get(itemIds.iceMix)?.current_count === 14)
    check('Stock: Topping 0 + (1*4=4) = 4', get(itemIds.topping)?.current_count === 4)
    check('Stock: Plain (no pack_size) 1 + 2 = 3, unchanged math', get(itemIds.plain)?.current_count === 3)

    const historyRes = await apiFetch('/api/order-history?type=received', owner.cookie)
    const historyOrders = await historyRes.json()
    const receipt = historyOrders.find((o) => (o.order_history_items ?? []).some((i) => i.item_id === itemIds.sugarFree))
    if (receipt) orderHistoryIds.push(receipt.id)
    const hi = (id) => receipt?.order_history_items.find((i) => i.item_id === id)
    check('order_history_items: Sugar Free quantity=12, unit=bottles (converted once)', hi(itemIds.sugarFree)?.quantity === 12 && hi(itemIds.sugarFree)?.unit === 'bottles')
    check('order_history_items: Syrup quantity=4, unit=bottles', hi(itemIds.syrup)?.quantity === 4 && hi(itemIds.syrup)?.unit === 'bottles')
    check('order_history_items: Ice Mix quantity=8, unit=gallons', hi(itemIds.iceMix)?.quantity === 8 && hi(itemIds.iceMix)?.unit === 'gallons')
    check('order_history_items: Topping quantity=4, unit=bags', hi(itemIds.topping)?.quantity === 4 && hi(itemIds.topping)?.unit === 'bags')
    check('order_history_items: Plain quantity=2, unit=rolls', hi(itemIds.plain)?.quantity === 2 && hi(itemIds.plain)?.unit === 'rolls')

    const shortRes = await apiFetch('/api/order-history?type=short', owner.cookie)
    const shortOrders = await shortRes.json()
    const shortRecord = shortOrders.find((o) => (o.order_history_items ?? []).some((i) => i.item_id === itemIds.topping))
    if (shortRecord) orderHistoryIds.push(shortRecord.id)
    check('short record: Topping quantity=2, unit=case', shortRecord?.order_history_items?.[0]?.quantity === 2 && shortRecord?.order_history_items?.[0]?.unit === 'case')

    await browser.close()
  } finally {
    for (const id of orderHistoryIds) {
      await apiFetch('/api/order-history', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id }) }).catch(() => {})
    }
    for (const id of Object.values(itemIds)) {
      if (id) await apiFetch('/api/items', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id }) }).catch(() => {})
    }
    console.log('cleanup - removed all ZZTEST P56 items and order_history records')
  }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
