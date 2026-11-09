// Patch 51: the Par screen was missing the flavor program badge patch 45
// added everywhere else (Manage Items/Current Stock/Order List/Count).
// Reuses the exact shared badge (src/lib/flavors.ts's PROGRAM_BADGE_CLASS/
// PROGRAM_BADGE_ICON/PROGRAM_LABELS) -- label only, no new requests (the
// Par screen already loads /api/items, which already embeds the linked
// flavor). This is a real-browser check (not just an API check) because
// the point is what actually renders on the page, including the live
// read after a flavor's program changes.
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

  try {
    const flavorRes = await apiFetch('/api/flavors', owner.cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'ZZTEST Par Badge Flavor', type: 'italian_ice' }),
    })
    const flavor = await flavorRes.json()
    flavorId = flavor.id
    check('setup: ZZTEST flavor created', flavorRes.status === 200)
    await apiFetch('/api/flavors', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: flavorId, program: 'everyday' }) })

    const linkedRes = await apiFetch('/api/items', owner.cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'ZZTEST Par Badge Linked', category: 'Ice Mix', unit: 'gallons' }),
    })
    const linkedItem = await linkedRes.json()
    linkedItemId = linkedItem.id
    await apiFetch('/api/items/flavor', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: linkedItemId, flavor_id: flavorId }) })

    const unlinkedRes = await apiFetch('/api/items', owner.cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'ZZTEST Par Badge Unlinked', category: 'Ice Mix', unit: 'gallons' }),
    })
    const unlinkedItem = await unlinkedRes.json()
    unlinkedItemId = unlinkedItem.id
    check('setup: ZZTEST linked + unlinked Ice Mix items created', linkedRes.status === 200 && unlinkedRes.status === 200)

    const token = createSessionToken('owner', 'ZZTEST Owner').token
    const browser = await chromium.launch()
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
    await ctx.addCookies([{ name: 'ritas_session', value: token, domain: 'localhost', path: '/' }])
    const page = await ctx.newPage()
    await page.addInitScript(() => {
      localStorage.setItem('ritas_role', 'owner')
      localStorage.setItem('ritas_owner_name', 'ZZTEST Owner')
    })

    async function openIceMixAndSearch(query) {
      await page.goto(`${BASE_URL}/par-settings`, { waitUntil: 'networkidle' })
      await page.getByPlaceholder('Search items…').fill(query)
      await page.waitForTimeout(300)
      const iceMixHeader = page.getByRole('button', { name: /Ice Mix/i }).first()
      if ((await iceMixHeader.count()) > 0) {
        const expanded = (await iceMixHeader.getAttribute('aria-expanded')) === 'true'
        if (!expanded) {
          await iceMixHeader.click()
          await page.waitForTimeout(300)
        }
      }
    }

    await openIceMixAndSearch('ZZTEST Par Badge Linked')
    const linkedRow = page.locator('div').filter({ hasText: 'ZZTEST Par Badge Linked' }).last()
    check('linked ZZTEST item shows the Everyday badge on the Par screen', await page.getByText('Everyday').isVisible())
    void linkedRow

    await openIceMixAndSearch('ZZTEST Par Badge Unlinked')
    const bodyTextUnlinked = await page.locator('body').innerText()
    check(
      'unlinked ZZTEST item shows NO program badge text nearby',
      bodyTextUnlinked.includes('ZZTEST Par Badge Unlinked') &&
        !['Everyday', 'Seasonal', 'Low Inventory', 'Opt-In', 'Hibernate', 'LTO'].some((label) => bodyTextUnlinked.includes(label))
    )

    // Live read: change the flavor's program, reload, confirm the badge changed.
    await apiFetch('/api/flavors', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: flavorId, program: 'lto' }) })
    await openIceMixAndSearch('ZZTEST Par Badge Linked')
    check('after changing the flavor to LTO, the Par screen shows LTO on refresh (live read)', await page.getByText('LTO').isVisible())
    check('...and no longer shows the old Everyday badge', !(await page.getByText('Everyday').isVisible()))

    await browser.close()
  } finally {
    if (linkedItemId) await apiFetch('/api/items', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: linkedItemId }) })
    if (unlinkedItemId) await apiFetch('/api/items', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: unlinkedItemId }) })
    if (flavorId) await apiFetch('/api/flavors', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: flavorId }) })
    console.log('cleanup - removed ZZTEST flavor and its two ZZTEST items')
  }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
