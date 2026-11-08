// Regression for a bug where PATCH /api/items silently ignored `category`
// — it was never destructured/whitelisted, even though every other field
// Manage Items' edit form sends (name/unit/secondary_unit/
// units_per_sub_unit/distributor/item_number/distributor_item_name) was.
// The request returned 200 with the item's OLD category unchanged, so the
// UI had no reason to show an error — a category change looked like it
// saved, then "reverted" on refresh because it had never actually been
// written. Uses a disposable 'ZZTEST Category Bug Item', cleaned up
// either way.
import { apiFetch, loginAsOwner } from './helpers/auth.mjs'

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
  let itemId = null

  try {
    const createRes = await apiFetch('/api/items', owner.cookie, {
      method: 'POST',
      body: JSON.stringify({ name: 'ZZTEST Category Bug Item', category: 'Custard', unit: 'boxes' }),
    })
    const created = await createRes.json()
    itemId = created.id
    check('setup: item created with category Custard', createRes.status === 200 && created.category === 'Custard')

    await apiFetch('/api/items', owner.cookie, {
      method: 'PATCH',
      body: JSON.stringify({ id: itemId, par_level: 5, current_count: 3, secondary_unit: 'Bottle', units_per_sub_unit: 2 }),
    })

    // The bug: a category-ONLY change.
    const catRes = await apiFetch('/api/items', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: itemId, category: 'Syrups' }) })
    const catBody = await catRes.json()
    check('PATCH category only -> 200', catRes.status === 200)
    check('...the RESPONSE reflects the new category (not silently unchanged)', catBody.category === 'Syrups')

    // The real proof: re-fetch independently of that response, confirming
    // it actually persisted (the original bug's response round-tripped
    // the OLD category too, since the row genuinely never changed).
    const refetchRes = await apiFetch('/api/items', owner.cookie)
    const refetched = (await refetchRes.json()).find((i) => i.id === itemId)
    check('re-fetch after the PATCH shows the new category persisted', refetched?.category === 'Syrups')

    // Must not have touched counts/par/pack_size.
    check('par_level untouched by the category-only change', refetched?.par_level === 5)
    check('current_count untouched by the category-only change', refetched?.current_count === 3)
    check('pack_size untouched (still null) by the category-only change', refetched?.pack_size === null)

    // Every other field in the same edit form, changed together with
    // category in one request.
    const allRes = await apiFetch('/api/items', owner.cookie, {
      method: 'PATCH',
      body: JSON.stringify({
        id: itemId,
        name: 'ZZTEST Category Bug Item Renamed',
        unit: 'cases',
        secondary_unit: 'Jar',
        units_per_sub_unit: 4,
        category: 'Toppings - Wet',
        distributor: 'bunzl',
        item_number: '9999',
        distributor_item_name: 'ZZTEST CATALOG NAME',
      }),
    })
    const allBody = await allRes.json()
    check('PATCH with every edit-form field at once -> 200', allRes.status === 200)
    check('...name saved', allBody.name === 'ZZTEST Category Bug Item Renamed')
    check('...unit saved', allBody.unit === 'cases')
    check('...secondary_unit saved', allBody.secondary_unit === 'Jar')
    check('...units_per_sub_unit saved', allBody.units_per_sub_unit === 4)
    check('...category saved alongside everything else', allBody.category === 'Toppings - Wet')
    check('...distributor saved', allBody.distributor === 'bunzl')
    check('...item_number saved', allBody.item_number === '9999')
    check('...distributor_item_name saved', allBody.distributor_item_name === 'ZZTEST CATALOG NAME')

    // Defense-in-depth: a PATCH with nothing this route recognizes now
    // reports a clear error instead of silently "succeeding" as a no-op.
    const emptyRes = await apiFetch('/api/items', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: itemId }) })
    const emptyBody = await emptyRes.json()
    check('PATCH with no recognized fields -> 400 Nothing to update', emptyRes.status === 400 && emptyBody.error === 'Nothing to update')
  } finally {
    if (itemId) await apiFetch('/api/items', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: itemId }) })
  }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
