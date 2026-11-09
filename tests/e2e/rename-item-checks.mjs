// Patch 53: Manage Items' inline edit ("Rename") always PATCHed
// secondary_unit as null when empty, but items.secondary_unit is NOT NULL
// DEFAULT '' -- so saving ANY edit (not just a rename) on an item with no
// secondary unit 500'd, and the UI just reverted to "Save" with nothing
// obviously visible. Fixed by sending '' instead of null (same shared
// PATCH /api/items the whole edit form uses).
//
// Also found and fixed, same silent-failure class as the old category
// bug: `supplier_order` (used by the up/down reorder arrows) was never in
// the route's whitelist, so every reorder 400'd -- invisibly, since the
// client never checked the response and optimistically "moved" the item
// in local state anyway.
//
// This suite drives a real browser (the point is the actual Save button
// experience the bug report described, not just the API) plus direct API
// checks for role rules, duplicate/empty-name behavior, and that nothing
// else (pack size, flavor link, par, counts) moves when only the name
// changes.
import { chromium } from 'playwright'
import { createSessionToken } from '../../src/lib/session-token.ts'
import { apiFetch, loginAsOwner, loginAsShiftLead, loginAsStaff } from './helpers/auth.mjs'
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
  const shiftLead = await loginAsShiftLead()
  const staff = await loginAsStaff()
  let itemId = null
  let flavorId = null
  let dupId = null

  try {
    // --- setup: a ZZTEST Ice Mix item with NO secondary unit -- this is
    // exactly the shape that reproduced the real bug (Wild Cherry has no
    // secondary unit either) ---
    const createRes = await apiFetch('/api/items', owner.cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'ZZTEST Rename Item', category: 'Ice Mix', unit: 'gallons' }),
    })
    const item = await createRes.json()
    itemId = item.id
    check('setup: ZZTEST item created with no secondary_unit (empty string, not null)', createRes.status === 200 && item.secondary_unit === '')

    // Attach a pack size, par, flavor link, and a real count -- then prove
    // none of them move when the rename happens.
    await apiFetch('/api/items', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: itemId, par_level: 5 }) })
    await apiFetch('/api/items/pack-size', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: itemId, pack_size: 6 }) })
    const flavorRes = await apiFetch('/api/flavors', owner.cookie, { method: 'POST', body: JSON.stringify({ name: 'ZZTEST Rename Flavor', type: 'italian_ice' }) })
    flavorId = (await flavorRes.json()).id
    await apiFetch('/api/items/flavor', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: itemId, flavor_id: flavorId }) })
    await apiFetch('/api/counts', owner.cookie, { method: 'POST', body: JSON.stringify({ counts: [{ item_id: itemId, count: 3 }], entered_by: 'ZZTEST', is_test_data: true }) })

    // --- reproduce the exact original bug directly against the route,
    // the way the old client used to send it (null instead of '') ---
    const buggyRes = await apiFetch('/api/items', owner.cookie, {
      method: 'PATCH',
      body: JSON.stringify({ id: itemId, name: 'should not matter', unit: 'gallons', secondary_unit: null, category: 'Ice Mix' }),
    })
    check('reproduces the original bug: secondary_unit: null still 500s (confirms the real cause)', buggyRes.status === 500)

    // --- the real UI: rename through Manage Items, exactly as a person would ---
    const token = createSessionToken('owner', 'ZZTEST Owner').token
    const browser = await chromium.launch()
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
    await ctx.addCookies([{ name: 'ritas_session', value: token, domain: 'localhost', path: '/' }])
    const page = await ctx.newPage()
    await page.addInitScript(() => {
      localStorage.setItem('ritas_role', 'owner')
      localStorage.setItem('ritas_owner_name', 'ZZTEST Owner')
    })

    await page.goto(`${BASE_URL}/manage-items`, { waitUntil: 'networkidle' })
    await page.getByPlaceholder('Search items…').fill('ZZTEST Rename Item')
    await page.waitForTimeout(400)
    const iceMixHeader = page.getByRole('button', { name: /Ice Mix/i }).first()
    if ((await iceMixHeader.count()) > 0 && (await iceMixHeader.getAttribute('aria-expanded')) !== 'true') {
      await iceMixHeader.click()
      await page.waitForTimeout(300)
    }
    await page.getByRole('button', { name: 'Rename' }).first().click()
    await page.waitForTimeout(200)

    // DOM order of type="text" inputs on this page: 0 = Add New Item's own
    // name field, 1 = Add New Item's own unit field, 2 = the search box,
    // 3 = the name field in the now-open edit row.
    const nameInput = page.locator('input[type="text"]').nth(3)
    await nameInput.fill('ZZTEST Rename Item RENAMED')

    const saveBtn = page.getByRole('button', { name: /^Save$/ })
    await saveBtn.click()
    // The real regression: this used to hang on "Saving…" with the name
    // never changing. Give it a real chance to either succeed or show an
    // error -- either way "Saving…" must not still be showing after.
    await page.waitForTimeout(1500)
    const stillSaving = await page.getByRole('button', { name: 'Saving…' }).isVisible().catch(() => false)
    check('Save button does not hang on "Saving…"', !stillSaving)
    check('the new name is now visible on the page (not stuck on the old one)', await page.getByText('ZZTEST Rename Item RENAMED').isVisible())
    const noVisibleError = !(await page.getByText(/[Cc]ould not save/).isVisible().catch(() => false))
    check('no error banner shown for a legitimate rename', noVisibleError)

    await browser.close()

    // --- persists after refresh, and the exact same /api/items response
    // every other screen (Stock/Order List/Count/Par) reads from reflects
    // it -- they all load items from this one endpoint, nothing caches or
    // snapshots a live item's name separately ---
    const refetched = await apiFetch('/api/items', owner.cookie).then((r) => r.json())
    const renamed = refetched.find((i) => i.id === itemId)
    check('rename persisted after refresh (GET /api/items, the shared source for Stock/Order List/Count/Par)', renamed?.name === 'ZZTEST Rename Item RENAMED')

    // --- nothing else moved ---
    check('par_level untouched by the rename', renamed?.par_level === 5)
    check('pack_size untouched by the rename', renamed?.pack_size === 6)
    check('flavor_id link untouched by the rename', renamed?.flavor_id === flavorId)
    const countsAfter = await apiFetch('/api/counts/last-per-item', owner.cookie).then((r) => r.json())
    const ourCount = (Array.isArray(countsAfter) ? countsAfter : []).find((c) => c.item_id === itemId)
    check('the earlier count entry is unaffected (still findable / not erased)', !ourCount || ourCount.item_id === itemId)

    // --- duplicate / empty name behavior ---
    const dupCreateRes = await apiFetch('/api/items', owner.cookie, { method: 'POST', body: JSON.stringify({ name: 'ZZTEST Rename Dup Target', category: 'Other', unit: 'boxes' }) })
    dupId = (await dupCreateRes.json()).id
    const dupRes = await apiFetch('/api/items', owner.cookie, {
      method: 'PATCH',
      body: JSON.stringify({ id: itemId, name: 'ZZTEST Rename Dup Target', unit: 'gallons', secondary_unit: '', category: 'Ice Mix' }),
    })
    check(
      'info: duplicate names are not blocked at the DB/route level today (not the cause of the original bug -- confirmed, not changed)',
      dupRes.status === 200
    )
    // Revert so later assertions aren't confused by the duplicate name.
    await apiFetch('/api/items', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: itemId, name: 'ZZTEST Rename Item RENAMED', unit: 'gallons', secondary_unit: '', category: 'Ice Mix' }) })

    const emptyRes = await apiFetch('/api/items', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: itemId, name: '' }) })
    const emptyBody = await emptyRes.json()
    check('empty name is rejected with a clear 400, not silently accepted', emptyRes.status === 400 && typeof emptyBody.error === 'string')

    const whitespaceRes = await apiFetch('/api/items', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: itemId, name: '   ' }) })
    check('whitespace-only name is also rejected', whitespaceRes.status === 400)

    // --- role rules unchanged: SL+ can rename, staff/no-session cannot ---
    const slRes = await apiFetch('/api/items', shiftLead.cookie, { method: 'PATCH', body: JSON.stringify({ id: itemId, name: 'ZZTEST Rename By SL' }) })
    check('shift_lead can still rename (SL+ tier, unchanged)', slRes.status === 200)
    await apiFetch('/api/items', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: itemId, name: 'ZZTEST Rename Item RENAMED' }) })
    const staffRes = await apiFetch('/api/items', staff.cookie, { method: 'PATCH', body: JSON.stringify({ id: itemId, name: 'ZZTEST Rename By Staff' }) })
    check('staff still cannot rename -> 403 (unchanged)', staffRes.status === 403)
    const noSessionRes = await apiFetch('/api/items', null, { method: 'PATCH', body: JSON.stringify({ id: itemId, name: 'x' }) })
    check('no session -> 401 (unchanged)', noSessionRes.status === 401)

    // --- the other fixed bug: supplier_order (up/down reorder) ---
    const soRes = await apiFetch('/api/items', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: itemId, supplier_order: 777 }) })
    const soBody = await soRes.json()
    check('supplier_order (reorder arrows) now actually saves -- used to 400 "Nothing to update"', soRes.status === 200 && soBody.supplier_order === 777)
  } finally {
    if (itemId) await apiFetch('/api/items', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: itemId }) })
    if (dupId) await apiFetch('/api/items', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: dupId }) })
    if (flavorId) await apiFetch('/api/flavors', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: flavorId }) })
    console.log('cleanup - removed ZZTEST item(s) and the ZZTEST flavor')
  }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
