// Patch 57: a will_call receive gets ONE summary confirm popup at Save,
// listing every entered line's math, instead of patch 56's per-item
// mistake guard -- a will_call line almost never has a prior order line to
// compare against, so there's nothing for that per-item "over what was
// ordered" logic to check against. This suite proves, against three
// ZZTEST fixtures:
//   1. A will_call receive with a pack_size-6, a pack_size-2, and a plain
//      item shows exactly ONE popup at Save, listing all three lines with
//      correct math text, regardless of quantity (even amounts that would
//      NOT have tripped patch 56's per-item guard).
//   2. "Go back" saves nothing (no stock change, no order_history write)
//      and the typed quantities are still in the form fields afterward.
//   3. "Yes, save all" saves exactly once with exactly the right stock
//      increments (no double conversion).
//   4. A normal (non-will_call) receive is byte-for-byte unchanged: patch
//      56's per-item mistake-guard modal still fires for an over-pack_size
//      amount with nothing on order, "Fix it" still saves nothing, and a
//      normal under-pack_size amount saves with no popup at all.
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
  sugarFree: 'ZZTEST P57 SugarFree',
  syrup: 'ZZTEST P57 Syrup',
  plain: 'ZZTEST P57 Plain',
  regression: 'ZZTEST P57 Regression',
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
    // ---------- setup: 4 fixtures ----------
    const create = async (name, category, unit) => {
      const res = await apiFetch('/api/items', owner.cookie, { method: 'POST', body: JSON.stringify({ name, category, unit }) })
      const item = await res.json()
      check(`setup: ${name} created`, res.status === 200)
      return item.id
    }
    itemIds.sugarFree = await create(NAMES.sugarFree, 'Ice Mix', 'bottles')
    itemIds.syrup = await create(NAMES.syrup, 'Syrups', 'bottles')
    itemIds.plain = await create(NAMES.plain, 'Napkins & Paper', 'bags')
    itemIds.regression = await create(NAMES.regression, 'Ice Mix', 'gallons')

    const setPack = async (id, pack_size) => {
      const res = await apiFetch('/api/items/pack-size', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id, pack_size }) })
      check(`setup: pack_size ${pack_size} set`, res.status === 200)
    }
    await setPack(itemIds.sugarFree, 6)
    await setPack(itemIds.syrup, 2)
    await setPack(itemIds.regression, 4)
    // plain: no pack_size

    const setCounts = async (id, current_count, par_level) => {
      const res = await apiFetch('/api/items', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id, current_count, par_level }) })
      check(`setup: counts set for ${id}`, res.status === 200)
    }
    await setCounts(itemIds.sugarFree, 1, 8)
    await setCounts(itemIds.syrup, 0, 5)
    await setCounts(itemIds.plain, 0, 5)
    await setCounts(itemIds.regression, 0, 8)

    const token = createSessionToken('owner', 'ZZTEST Owner').token
    const browser = await chromium.launch()
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
    await ctx.addCookies([{ name: 'ritas_session', value: token, domain: 'localhost', path: '/' }])
    const page = await ctx.newPage()
    await page.addInitScript(() => {
      localStorage.setItem('ritas_role', 'owner')
      localStorage.setItem('ritas_owner_name', 'ZZTEST Owner')
    })

    // ========== PART 1: will_call -- one summary popup ==========
    await page.goto(`${BASE_URL}/receive-order`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Will Call' }).click()
    // "No specific order / Standalone" is already selected by default.
    await page.getByRole('button', { name: /Continue/i }).click()
    await page.waitForTimeout(400)

    await page.getByPlaceholder('Search items…').fill('ZZTEST P57')
    await page.waitForTimeout(300)
    for (const cat of ['Ice Mix', 'Syrups', 'Napkins & Paper']) {
      await expandCategory(page, cat)
    }

    // Amounts deliberately chosen so they'd be BELOW patch 56's per-item
    // mistake-guard threshold (nothing on order, typed < pack_size for
    // syrup would normally be fine at 1 < 2 -- but will_call must always
    // show its one summary popup regardless, which is exactly what this
    // proves alongside the sugarFree/plain lines).
    await itemRow(page, NAMES.sugarFree).locator('input[placeholder="0"]').fill('2')
    await itemRow(page, NAMES.syrup).locator('input[placeholder="0"]').fill('1')
    await itemRow(page, NAMES.plain).locator('input[placeholder="0"]').fill('3')
    await page.waitForTimeout(200)

    await page.getByRole('button', { name: /Review & Save/i }).click()
    await page.waitForTimeout(400)

    const dialogs = page.locator('[role="alertdialog"]')
    check('will_call: exactly one popup shown', (await dialogs.count()) === 1)
    let modalText = await dialogs.innerText().catch(() => '')
    check('will_call popup: titled "Confirm Will Call Receipt" (not the per-item guard)', modalText.includes('Confirm Will Call Receipt'))
    check('will_call popup: Sugar Free row "2 boxes = 12 bottles"', modalText.includes(`${NAMES.sugarFree}:`) && modalText.includes('2 boxes = 12 bottles'))
    check('will_call popup: Syrup row "1 box = 2 bottles" (singular, under pack_size but still shown)', modalText.includes(`${NAMES.syrup}:`) && modalText.includes('1 box = 2 bottles'))
    check('will_call popup: Plain row "3 bags" (no math, no pack_size)', modalText.includes(`${NAMES.plain}:`) && modalText.includes('3 bags') && !modalText.includes('3 bags ='))
    check('will_call popup: buttons are "Go back" / "Yes, save all"', (await page.getByRole('button', { name: 'Go back' }).count()) === 1 && (await page.getByRole('button', { name: 'Yes, save all' }).count()) === 1)

    // ---------- "Go back": saves nothing, keeps typed values ----------
    await page.getByRole('button', { name: 'Go back' }).click()
    await page.waitForTimeout(300)
    check('"Go back" closes popup, stays on enter step', await page.getByPlaceholder('Search items…').isVisible())
    check('"Go back" kept Sugar Free field at 2', await itemRow(page, NAMES.sugarFree).locator('input[placeholder="0"]').inputValue() === '2')
    check('"Go back" kept Syrup field at 1', await itemRow(page, NAMES.syrup).locator('input[placeholder="0"]').inputValue() === '1')
    check('"Go back" kept Plain field at 3', await itemRow(page, NAMES.plain).locator('input[placeholder="0"]').inputValue() === '3')

    const afterGoBack = await apiFetch('/api/items', owner.cookie).then((r) => r.json())
    const getBefore = (id) => afterGoBack.find((i) => i.id === id)
    check('"Go back" saved nothing -- Sugar Free stock unchanged (still 1)', getBefore(itemIds.sugarFree)?.current_count === 1)
    check('"Go back" saved nothing -- Syrup stock unchanged (still 0)', getBefore(itemIds.syrup)?.current_count === 0)
    check('"Go back" saved nothing -- Plain stock unchanged (still 0)', getBefore(itemIds.plain)?.current_count === 0)

    // ---------- re-submit, confirm this time ----------
    await page.getByRole('button', { name: /Review & Save/i }).click()
    await page.waitForTimeout(400)
    modalText = await page.locator('[role="alertdialog"]').innerText().catch(() => '')
    check('popup reappears identically on second Review & Save', modalText.includes('2 boxes = 12 bottles') && modalText.includes('1 box = 2 bottles') && modalText.includes('3 bags'))

    await page.getByRole('button', { name: 'Yes, save all' }).click()
    await page.waitForSelector('text=Receipt Saved', { timeout: 10000 }).catch(() => {})
    check('will_call receipt saved, no short-shipment alert (standalone, nothing to be short against)', await page.getByText('All items received').isVisible().catch(() => false))

    await page.waitForTimeout(400)
    const afterSave = await apiFetch('/api/items', owner.cookie).then((r) => r.json())
    const getAfter = (id) => afterSave.find((i) => i.id === id)
    check('stock: Sugar Free 1 + (2*6=12) = 13 -- exactly once, no double conversion', getAfter(itemIds.sugarFree)?.current_count === 13)
    check('stock: Syrup 0 + (1*2=2) = 2', getAfter(itemIds.syrup)?.current_count === 2)
    check('stock: Plain 0 + 3 = 3 (no pack_size, unchanged math)', getAfter(itemIds.plain)?.current_count === 3)

    const willCallHistory = await apiFetch('/api/order-history?type=will_call', owner.cookie).then((r) => r.json())
    const willCallReceipt = willCallHistory.find((o) => (o.order_history_items ?? []).some((i) => i.item_id === itemIds.sugarFree))
    if (willCallReceipt) orderHistoryIds.push(willCallReceipt.id)
    const wi = (id) => willCallReceipt?.order_history_items.find((i) => i.item_id === id)
    check('order_history_items: Sugar Free quantity=12, unit=bottles (converted once)', wi(itemIds.sugarFree)?.quantity === 12 && wi(itemIds.sugarFree)?.unit === 'bottles')
    check('order_history_items: Syrup quantity=2, unit=bottles', wi(itemIds.syrup)?.quantity === 2 && wi(itemIds.syrup)?.unit === 'bottles')
    check('order_history_items: Plain quantity=3, unit=bags', wi(itemIds.plain)?.quantity === 3 && wi(itemIds.plain)?.unit === 'bags')

    // ========== PART 2: normal (non-will_call) regression ==========
    await page.goto(`${BASE_URL}/receive-order`, { waitUntil: 'networkidle' })
    // "Weekly Delivery" (received) is the default -- no click needed.
    await page.getByRole('button', { name: /Continue/i }).click()
    await page.waitForTimeout(400)

    await page.getByPlaceholder('Search items…').fill('ZZTEST P57 Regression')
    await page.waitForTimeout(300)
    await expandCategory(page, 'Ice Mix')

    // Nothing on order, typed (10) >= pack_size (4) -> patch 56's per-item
    // guard must still fire exactly as before.
    await itemRow(page, NAMES.regression).locator('input[placeholder="0"]').fill('10')
    await page.waitForTimeout(150)
    await page.getByRole('button', { name: /Review & Save/i }).click()
    await page.waitForTimeout(400)

    modalText = await page.locator('[role="alertdialog"]').innerText().catch(() => '')
    check('normal receive: patch 56 per-item guard still fires ("Double-check this quantity")', modalText.includes('Double-check this quantity'))
    check('normal receive: NOT the will_call summary modal', !modalText.includes('Confirm Will Call Receipt'))
    check('normal receive: guard button still says "Fix it" / "Yes, add 40"', (await page.getByRole('button', { name: 'Fix it' }).count()) === 1 && (await page.getByRole('button', { name: 'Yes, add 40' }).count()) === 1)

    await page.getByRole('button', { name: 'Fix it' }).click()
    await page.waitForTimeout(300)
    const regAfterFixIt = await apiFetch('/api/items', owner.cookie).then((r) => r.json()).then((d) => d.find((i) => i.id === itemIds.regression))
    check('normal receive: "Fix it" saved nothing -- Regression stock unchanged (still 0)', regAfterFixIt?.current_count === 0)

    // Normal, in-range amount (1 < pack_size 4, nothing on order) -> no
    // popup at all, saves immediately.
    await itemRow(page, NAMES.regression).locator('input[placeholder="0"]').fill('1')
    await page.waitForTimeout(150)
    await page.getByRole('button', { name: /Review & Save/i }).click()
    await page.waitForSelector('text=Receipt Saved', { timeout: 10000 }).catch(() => {})
    check('normal receive: in-range amount shows no popup, saves directly', await page.getByText('All items received').isVisible().catch(() => false))

    await page.waitForTimeout(400)
    const regAfterSave = await apiFetch('/api/items', owner.cookie).then((r) => r.json()).then((d) => d.find((i) => i.id === itemIds.regression))
    check('stock: Regression 0 + (1*4=4) = 4', regAfterSave?.current_count === 4)

    const receivedHistory = await apiFetch('/api/order-history?type=received', owner.cookie).then((r) => r.json())
    const regReceipt = receivedHistory.find((o) => (o.order_history_items ?? []).some((i) => i.item_id === itemIds.regression))
    if (regReceipt) orderHistoryIds.push(regReceipt.id)
    check('order_history_items: Regression quantity=4, unit=gallons', regReceipt?.order_history_items?.find((i) => i.item_id === itemIds.regression)?.quantity === 4)

    await browser.close()
  } finally {
    for (const id of orderHistoryIds) {
      await apiFetch('/api/order-history', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id }) }).catch(() => {})
    }
    for (const id of Object.values(itemIds)) {
      if (id) await apiFetch('/api/items', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id }) }).catch(() => {})
    }
    console.log('cleanup - removed all ZZTEST P57 items and order_history records')
  }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
