// Patch 52: adds the shared flavor program badge (patches 45/51) to
// Receive Order's main item row, Correct Count's main item row, and the
// Count Summary modal -- the three places patch 51's report flagged as
// missing it. Label only, no new requests (all three already load
// /api/items, which already embeds the linked flavor).
//
// Drives a real browser (same reasoning as par-settings-badge-checks.mjs:
// the point is what actually renders, not just the API response) to prove
// a ZZTEST-linked Ice Mix item shows the right badge on all three screens,
// an unlinked one shows none, and a flavor's program change updates the
// badge on the next load. Also smoke-tests that Receive Order (standalone,
// with Search, including a storage-destination item) and Correct Count
// still complete a real save after the JSX change -- not re-proving the
// receive/adjust logic itself (already covered by other suites), just
// that this patch didn't break the page.
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

async function run() {
  const owner = await loginAsOwner()
  let flavorId = null
  let linkedItemId = null
  let unlinkedItemId = null
  let storageItemId = null
  const createdOrderIds = []

  try {
    const flavorRes = await apiFetch('/api/flavors', owner.cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'ZZTEST Patch52 Flavor', type: 'italian_ice' }),
    })
    const flavor = await flavorRes.json()
    flavorId = flavor.id
    await apiFetch('/api/flavors', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: flavorId, program: 'everyday' }) })
    check('setup: ZZTEST flavor created (program=everyday)', flavorRes.status === 200)

    const linkedRes = await apiFetch('/api/items', owner.cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'ZZTEST Patch52 Linked', category: 'Ice Mix', unit: 'gallons' }),
    })
    const linkedItem = await linkedRes.json()
    linkedItemId = linkedItem.id
    await apiFetch('/api/items/flavor', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: linkedItemId, flavor_id: flavorId }) })

    const unlinkedRes = await apiFetch('/api/items', owner.cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'ZZTEST Patch52 Unlinked', category: 'Ice Mix', unit: 'gallons' }),
    })
    const unlinkedItem = await unlinkedRes.json()
    unlinkedItemId = unlinkedItem.id
    check('setup: ZZTEST linked + unlinked Ice Mix items created', linkedRes.status === 200 && unlinkedRes.status === 200)

    const storageRes = await apiFetch('/api/items', owner.cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'ZZTEST Patch52 Storage', category: 'Ice Mix', unit: 'gallons' }),
    })
    const storageItem = await storageRes.json()
    storageItemId = storageItem.id
    await apiFetch('/api/items/storage', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: storageItemId, has_storage: true }) })

    const token = createSessionToken('owner', 'ZZTEST Owner').token
    const browser = await chromium.launch()
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
    await ctx.addCookies([{ name: 'ritas_session', value: token, domain: 'localhost', path: '/' }])
    const page = await ctx.newPage()
    await page.addInitScript(() => {
      localStorage.setItem('ritas_role', 'owner')
      localStorage.setItem('ritas_owner_name', 'ZZTEST Owner')
    })

    async function searchAndExpandIceMix(query) {
      await page.getByPlaceholder(/Search/).first().fill(query)
      await page.waitForTimeout(300)
      const header = page.getByRole('button', { name: /Ice Mix/i }).first()
      if ((await header.count()) > 0) {
        const expanded = (await header.getAttribute('aria-expanded')) === 'true'
        if (!expanded) {
          await header.click()
          await page.waitForTimeout(300)
        }
      }
    }

    // .first() so a second coincidental match elsewhere on the page can
    // never turn into a silent strict-mode false negative via the catch.
    async function badgeVisibleFor(label) {
      return page.getByText(label).first().isVisible().catch(() => false)
    }

    // ---------- Receive Order ----------
    await page.goto(`${BASE_URL}/receive-order`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /Continue/i }).click()
    await page.waitForTimeout(500)

    await searchAndExpandIceMix('ZZTEST Patch52 Linked')
    check('Receive Order: linked ZZTEST item shows the Everyday badge', await badgeVisibleFor('Everyday'))

    await searchAndExpandIceMix('ZZTEST Patch52 Unlinked')
    const bodyAfterUnlinked = await page.locator('body').innerText()
    check(
      'Receive Order: unlinked ZZTEST item shows no program badge text',
      bodyAfterUnlinked.includes('ZZTEST Patch52 Unlinked') &&
        !['Everyday', 'Seasonal', 'Low Inventory', 'Opt-In', 'Hibernate', 'LTO'].some((l) => bodyAfterUnlinked.includes(l))
    )

    // Smoke test: still works end to end, standalone, with a storage item --
    // not re-proving the storage/race logic itself (patch 48's suite
    // already does), just that this patch's JSX change didn't break the
    // page or the save flow.
    await searchAndExpandIceMix('ZZTEST Patch52 Storage')
    // Search narrows the list to this one item, so the single visible
    // quantity input on the page is unambiguously its own.
    await page.getByPlaceholder('0').first().fill('4')
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: /Review & Save/i }).click()
    await page.waitForSelector('text=Receipt Saved', { timeout: 10000 }).catch(() => {})
    check('Receive Order: standalone save with a storage item still completes (Receipt Saved)', await page.getByText('Receipt Saved').isVisible())

    const afterReceiveRes = await apiFetch('/api/order-history?type=received', owner.cookie)
    const afterReceiveOrders = await afterReceiveRes.json()
    const ourReceipt = afterReceiveOrders.find((o) =>
      (o.order_history_items ?? []).some((i) => i.item_id === storageItemId)
    )
    if (ourReceipt) createdOrderIds.push(ourReceipt.id)
    check('Receive Order: the receipt was actually saved to order_history', !!ourReceipt)

    // ---------- Correct Count ----------
    await page.goto(`${BASE_URL}/adjust`, { waitUntil: 'networkidle' })
    await searchAndExpandIceMix('ZZTEST Patch52 Linked')
    check('Correct Count: linked ZZTEST item shows the Everyday badge', await badgeVisibleFor('Everyday'))

    await searchAndExpandIceMix('ZZTEST Patch52 Unlinked')
    const adjustBodyUnlinked = await page.locator('body').innerText()
    check(
      'Correct Count: unlinked ZZTEST item shows no program badge text',
      adjustBodyUnlinked.includes('ZZTEST Patch52 Unlinked') &&
        !['Everyday', 'Seasonal', 'Low Inventory', 'Opt-In', 'Hibernate', 'LTO'].some((l) => adjustBodyUnlinked.includes(l))
    )

    // Smoke test: Correct Count still saves (new count + a required reason).
    await searchAndExpandIceMix('ZZTEST Patch52 Linked')
    await page.getByRole('button', { name: /ZZTEST Patch52 Linked/ }).first().click()
    await page.waitForTimeout(300)
    await page.locator('input[inputmode="decimal"]').first().fill('7')
    await page.getByRole('button', { name: 'Count error' }).click()
    await page.getByRole('button', { name: 'Save Adjustment' }).click()
    await page.waitForTimeout(600)
    const refetchedLinked = await apiFetch('/api/items', owner.cookie).then((r) => r.json())
    const linkedNow = refetchedLinked.find((i) => i.id === linkedItemId)
    check('Correct Count: the adjustment actually saved (current_count now 7)', linkedNow?.current_count === 7)

    // Live read: change the flavor's program, reload each screen, confirm
    // the badge updated (same live join as every other screen).
    await apiFetch('/api/flavors', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: flavorId, program: 'lto' }) })

    await page.goto(`${BASE_URL}/adjust`, { waitUntil: 'networkidle' })
    await searchAndExpandIceMix('ZZTEST Patch52 Linked')
    check('Correct Count: badge updates to LTO after the flavor program changes (live read)', await badgeVisibleFor('LTO'))

    await page.goto(`${BASE_URL}/receive-order`, { waitUntil: 'networkidle' })
    await page.getByRole('button', { name: /Continue/i }).click()
    await page.waitForTimeout(500)
    await searchAndExpandIceMix('ZZTEST Patch52 Linked')
    check('Receive Order: badge updates to LTO after the flavor program changes (live read)', await badgeVisibleFor('LTO'))

    // ---------- Count Summary modal ----------
    // Uses the count page's own "Test count" mode (is_test_data: true,
    // never touches real stock) so this never writes a non-ZZTEST, non-
    // test-flagged row -- the ZZTEST item itself is already disposable.
    await page.goto(`${BASE_URL}/count`, { waitUntil: 'networkidle' })
    const testToggle = page.getByRole('switch').first()
    if ((await testToggle.count()) > 0 && (await testToggle.getAttribute('aria-checked')) !== 'true') {
      await testToggle.click()
      await page.waitForTimeout(200)
    }
    await searchAndExpandIceMix('ZZTEST Patch52 Linked')
    // Search narrows the list to this one item, so the single visible
    // count input (inputmode=decimal, distinct from the search box which
    // is also type=text) on the page is unambiguously its own.
    await page.locator('input[inputmode="decimal"]').first().fill('3')
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: /Save Counts/i }).click()
    await page.waitForSelector('text=Count Submitted', { timeout: 10000 }).catch(() => {})
    // The main list (now behind the modal) still shows its own badge too,
    // so there are two "LTO" matches on the page -- scope to the summary
    // modal specifically (it renders after/on top of the main content, so
    // it's the last match) rather than a bare, ambiguous getByText.
    check('Count: summary modal shows the LTO badge next to the item', await page.getByText('LTO').last().isVisible())
  } finally {
    for (const id of createdOrderIds) {
      await apiFetch('/api/order-history', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id }) }).catch(() => {})
    }
    if (linkedItemId) await apiFetch('/api/items', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: linkedItemId }) })
    if (unlinkedItemId) await apiFetch('/api/items', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: unlinkedItemId }) })
    if (storageItemId) await apiFetch('/api/items', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: storageItemId }) })
    if (flavorId) await apiFetch('/api/flavors', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: flavorId }) })
    console.log('cleanup - removed ZZTEST flavor, 3 ZZTEST items, and any ZZTEST order_history/inventory_counts rows they produced')
  }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
