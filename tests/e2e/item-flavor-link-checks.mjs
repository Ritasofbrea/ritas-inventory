// Patch 45: item-to-flavor linking (items.flavor_id) — the live badge read,
// the owner-only /api/items/flavor route, the shared PATCH /api/items
// ignoring flavor_id, invalid-id validation, and that a hibernate-tagged
// linked item behaves exactly like any other item (no is_off/dimming/
// status change). Uses a disposable 'ZZTEST Flavor Badge Item' + 'ZZTEST
// Flavor' flavor, cleaned up either way.
import { apiFetch, loginAsOwner, loginAsShiftLead, loginAsStaff } from './helpers/auth.mjs'
import { rest } from './helpers/rest.mjs'

let failures = 0
const check = (name, cond) => {
  if (cond) console.log(`ok - ${name}`)
  else {
    console.log(`FAIL - ${name}`)
    failures++
  }
}

const PROGRAMS = ['everyday', 'seasonal', 'low_inventory', 'opt_in', 'hibernate', 'lto']

async function run() {
  const owner = await loginAsOwner()
  const shiftLead = await loginAsShiftLead()
  const staff = await loginAsStaff()

  let itemId = null
  let flavorId = null

  try {
    const flavorRes = await apiFetch('/api/flavors', owner.cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'ZZTEST Flavor', type: 'italian_ice' }),
    })
    const flavor = await flavorRes.json()
    flavorId = flavor.id
    check('setup: ZZTEST flavor created', flavorRes.status === 200)

    const itemRes = await apiFetch('/api/items', owner.cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'ZZTEST Flavor Badge Item', category: 'Ice Mix', unit: 'gallons' }),
    })
    const item = await itemRes.json()
    itemId = item.id
    check('setup: ZZTEST Ice Mix item created, unlinked', itemRes.status === 200 && item.flavor_id === null)

    // Unlinked item: GET /api/items embeds flavor: null, same as "looks exactly as before".
    const fresh = (await (await apiFetch('/api/items', owner.cookie)).json()).find((i) => i.id === itemId)
    check('unlinked item: embedded flavor is null', fresh.flavor === null)

    const linkBody = JSON.stringify({ id: itemId, flavor_id: flavorId })

    // Role gate: owner-only.
    const noSession = await apiFetch('/api/items/flavor', null, { method: 'PATCH', body: linkBody })
    check('PATCH /api/items/flavor with no session -> 401', noSession.status === 401)
    const asShiftLead = await apiFetch('/api/items/flavor', shiftLead.cookie, { method: 'PATCH', body: linkBody })
    check('PATCH /api/items/flavor as shift_lead -> 403', asShiftLead.status === 403)
    const asStaff = await apiFetch('/api/items/flavor', staff.cookie, { method: 'PATCH', body: linkBody })
    check('PATCH /api/items/flavor as staff -> 403', asStaff.status === 403)

    // Invalid (well-formed but nonexistent) flavor id -> 400.
    const badRes = await apiFetch('/api/items/flavor', owner.cookie, {
      method: 'PATCH',
      body: JSON.stringify({ id: itemId, flavor_id: '00000000-0000-0000-0000-000000000000' }),
    })
    check('PATCH /api/items/flavor with a nonexistent flavor id -> 400', badRes.status === 400)

    // Owner sets the link.
    const setRes = await apiFetch('/api/items/flavor', owner.cookie, { method: 'PATCH', body: linkBody })
    const setBody = await setRes.json()
    check('owner sets the link -> 200', setRes.status === 200)
    check('response embeds the flavor', setBody.flavor?.id === flavorId)

    // The shared SL+ PATCH /api/items must ignore flavor_id entirely.
    await apiFetch('/api/items', owner.cookie, {
      method: 'PATCH',
      body: JSON.stringify({ id: itemId, flavor_id: null, name: 'ZZTEST Flavor Badge Item' }),
    })
    const afterShared = (await (await apiFetch('/api/items', owner.cookie)).json()).find((i) => i.id === itemId)
    check('shared PATCH /api/items ignores flavor_id -- link survives', afterShared.flavor_id === flavorId)

    // Live read: cycle the SAME flavor through all six program values and
    // confirm GET /api/items reflects each one immediately -- proves the
    // badge is a live join, never copied onto the item.
    for (const program of PROGRAMS) {
      await apiFetch('/api/flavors', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: flavorId, program }) })
      const refetched = (await (await apiFetch('/api/items', owner.cookie)).json()).find((i) => i.id === itemId)
      check(`live update: program=${program} reflected immediately on GET /api/items`, refetched.flavor?.program === program)
    }

    // Hibernate (now set from the loop above) must not change anything
    // about the item itself -- not is_off, not par/count, nothing stock-related.
    const hibernateItem = (await (await apiFetch('/api/items', owner.cookie)).json()).find((i) => i.id === itemId)
    check('hibernate-tagged linked item: is_off is still false', hibernateItem.is_off === false)
    check('hibernate-tagged linked item: par_level untouched (0, as created)', hibernateItem.par_level === 0)
    check('hibernate-tagged linked item: current_count untouched (0, as created)', hibernateItem.current_count === 0)

    // Clearing the link removes the badge data entirely.
    const clearRes = await apiFetch('/api/items/flavor', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: itemId, flavor_id: null }) })
    const clearBody = await clearRes.json()
    check('clearing the link -> flavor_id null', clearBody.flavor_id === null)
    check('clearing the link -> embedded flavor null', clearBody.flavor === null)

    // Re-link, then delete the FLAVOR itself -- the item must survive
    // (on delete set null), not be removed or broken.
    await apiFetch('/api/items/flavor', owner.cookie, { method: 'PATCH', body: linkBody })
    const deleteFlavorRes = await apiFetch('/api/flavors', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: flavorId }) })
    check('deleting the flavor -> 200', deleteFlavorRes.status === 200)
    flavorId = null // already gone, don't try to delete it again in cleanup
    const afterFlavorDelete = (await (await apiFetch('/api/items', owner.cookie)).json()).find((i) => i.id === itemId)
    check('item survives the flavor being deleted', !!afterFlavorDelete)
    check('item has no flavor_id after its flavor was deleted', afterFlavorDelete.flavor_id === null)
  } finally {
    if (itemId) await apiFetch('/api/items', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: itemId }) })
    if (flavorId) await apiFetch('/api/flavors', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: flavorId }) })
    await rest('flavors?name=eq.ZZTEST%20Flavor', { method: 'DELETE' }).catch(() => {})
    await rest('items?name=eq.ZZTEST%20Flavor%20Badge%20Item', { method: 'DELETE' }).catch(() => {})
  }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
