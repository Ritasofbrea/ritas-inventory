// Patch 67: owner-only Vendor Code on Manage Items.
//   API: owner can set/change/clear; shift lead + staff 403; no session 401;
//   cleaning (capitals, no spaces), bad characters / too long rejected;
//   collision flow (409 names the other item, nothing saved, saves with
//   confirm_shared); the shared SL+ PATCH /api/items no longer changes it.
//   Browser (390x844): the gray "Code:" label, the Vendor Code panel, the
//   error message, the collision warning, Cancel, "Use it anyway", and no
//   sideways scrolling at phone width.
// Fixtures: two ZZTEST items, deleted by id at the end.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { createSessionToken } from '../../src/lib/session-token.ts'
import { apiFetch, loginAsOwner, loginAsShiftLead, loginAsStaff } from './helpers/auth.mjs'
import { rest } from './helpers/rest.mjs'
import { BASE_URL } from './helpers/config.mjs'

let failures = 0
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -- ${detail}` : ''}`)
  if (!cond) failures++
}

const NAME_A = 'ZZTEST P67 Alpha'
const NAME_B = 'ZZTEST P67 Bravo'
const SHARED = 'ZZT67SHARED'
const CATEGORY = 'Napkins & Paper'
const SHOTS = process.env.P67_SCREENSHOT_DIR // optional: where to save phone-width screenshots

const ids = []
const codeOf = async (id) => (await rest(`items?id=eq.${id}&select=vendor_item_code`))[0]?.vendor_item_code ?? null
const setCode = (cookie, id, vendor_item_code, extra = {}) =>
  apiFetch('/api/items/vendor-code', cookie, { method: 'PATCH', body: JSON.stringify({ id, vendor_item_code, ...extra }) })

async function main() {
  const owner = loginAsOwner()
  const lead = loginAsShiftLead()
  const staff = await loginAsStaff()

  for (const name of [NAME_A, NAME_B]) {
    const res = await apiFetch('/api/items', owner.cookie, { method: 'POST', body: JSON.stringify({ name, category: CATEGORY, unit: 'cases' }) })
    const item = await res.json()
    check(`setup: ${name} created`, res.ok && !!item.id)
    ids.push(item.id)
  }
  const [a, b] = ids

  // ---------- roles ----------
  let r = await setCode(null, a, 'X1')
  check('no session -> 401', r.status === 401, `got ${r.status}`)
  r = await setCode(lead.cookie, a, 'X1')
  check('shift lead -> 403', r.status === 403, `got ${r.status}`)
  r = await setCode(staff.cookie, a, 'X1')
  check('staff -> 403', r.status === 403, `got ${r.status}`)
  check('...and nothing was saved', (await codeOf(a)) === null)

  // ---------- set / change / clear + cleaning ----------
  r = await setCode(owner.cookie, a, ' ab c-12 ')
  check("owner sets ' ab c-12 ' -> saved as 'ABC-12'", r.ok && (await codeOf(a)) === 'ABC-12', `${r.status} ${await codeOf(a)}`)
  r = await setCode(owner.cookie, a, 'xyz9')
  check("owner changes it to 'xyz9' -> 'XYZ9'", r.ok && (await codeOf(a)) === 'XYZ9')
  r = await setCode(owner.cookie, a, 'AB_12')
  check("underscore rejected -> 400, code unchanged", r.status === 400 && (await codeOf(a)) === 'XYZ9', `got ${r.status}`)
  r = await setCode(owner.cookie, a, 'AB/12')
  check('slash rejected -> 400', r.status === 400)
  r = await setCode(owner.cookie, a, 'A'.repeat(21))
  check('21 characters rejected -> 400', r.status === 400)
  r = await setCode(owner.cookie, a, 'b'.repeat(20))
  check('20 characters accepted', r.ok && (await codeOf(a)) === 'B'.repeat(20))
  r = await setCode(owner.cookie, a, '   ')
  check('blank clears the code -> null', r.ok && (await codeOf(a)) === null)
  r = await setCode(owner.cookie, '00000000-0000-0000-0000-000000000000', 'X1')
  check('unknown item -> 404', r.status === 404)

  // ---------- shared SL+ route no longer touches it ----------
  await apiFetch('/api/items', lead.cookie, { method: 'PATCH', body: JSON.stringify({ id: a, vendor_item_code: 'SNEAKY1' }) })
  await apiFetch('/api/items', owner.cookie, { method: 'PATCH', body: JSON.stringify({ id: a, vendor_item_code: 'SNEAKY2' }) })
  check('shared PATCH /api/items ignores vendor_item_code (shift lead and owner)', (await codeOf(a)) === null, await codeOf(a))

  // ---------- collision (API) ----------
  r = await setCode(owner.cookie, b, SHARED)
  check(`Bravo gets ${SHARED}`, r.ok && (await codeOf(b)) === SHARED)
  r = await setCode(owner.cookie, a, SHARED.toLowerCase())
  const conflict = await r.json()
  check('same code on Alpha -> 409 code_in_use naming Bravo',
    r.status === 409 && conflict.error === 'code_in_use' && conflict.conflicts?.some((c) => c.name === NAME_B) && conflict.code === SHARED,
    JSON.stringify(conflict))
  check('...nothing saved without confirmation', (await codeOf(a)) === null)
  r = await setCode(owner.cookie, a, SHARED, { confirm_shared: true })
  check('...saved with confirm_shared', r.ok && (await codeOf(a)) === SHARED)
  r = await setCode(owner.cookie, a, SHARED)
  check('re-saving the code it already has does not warn again', r.ok && (await codeOf(a)) === SHARED, `got ${r.status}`)
  await setCode(owner.cookie, a, null)

  // ---------- browser, phone width ----------
  const token = createSessionToken('owner', 'ZZTEST Owner').token
  const browser = await chromium.launch()
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
    await ctx.addCookies([{ name: 'ritas_session', value: token, domain: 'localhost', path: '/' }])
    const page = await ctx.newPage()
    await page.addInitScript(() => {
      localStorage.setItem('ritas_role', 'owner')
      localStorage.setItem('ritas_owner_name', 'ZZTEST Owner')
    })
    await page.goto(`${BASE_URL}/manage-items`, { waitUntil: 'networkidle' })
    await page.getByPlaceholder('Search items…').fill('ZZTEST P67')
    const header = page.getByRole('button', { name: CATEGORY, exact: true })
    if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()

    const card = (name) => page.locator('div.px-5.py-4').filter({ hasText: name }).first()
    const bravo = card(NAME_B)
    const alpha = card(NAME_A)
    await bravo.waitFor()
    check('gray label shows "Code: ZZT67SHARED" on Bravo', (await bravo.getByTestId('vendor-code-label').innerText()).includes(SHARED))
    check('no label on Alpha (no code)', (await alpha.getByTestId('vendor-code-label').count()) === 0)
    const labelClass = await bravo.getByTestId('vendor-code-label').getAttribute('class')
    check('label is small gray text', /text-xs/.test(labelClass) && /text-gray-400/.test(labelClass), labelClass)

    await alpha.getByRole('button', { name: 'Vendor Code', exact: true }).click()
    const panel = alpha.getByTestId('vendor-code-panel')
    await panel.waitFor()
    const panelText = await panel.innerText()
    check('panel shows the item name and "Current code: none"', panelText.includes(NAME_A) && panelText.includes('Current code: none'), panelText)

    const input = panel.getByLabel('Vendor code')
    await input.fill('bad_code')
    check('bad characters -> clear message, Save disabled',
      (await panel.getByRole('alert').innerText()).includes('letters, numbers and hyphens') && (await panel.getByRole('button', { name: 'Save', exact: true }).isDisabled()))
    await input.fill(' zzt67 shared ')
    check('"Will save as ZZT67SHARED" preview', (await panel.innerText()).includes(`Will save as ${SHARED}`))
    if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/p67-panel.png` }) }

    await panel.getByRole('button', { name: 'Save', exact: true }).click()
    const warn = panel.getByTestId('vendor-code-conflict')
    await warn.waitFor()
    check(`warning: "This code is already on ${NAME_B}"`, (await warn.innerText()).includes(`This code is already on ${NAME_B}`))
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/p67-collision.png` })
    const wide = await page.evaluate(() => document.documentElement.scrollWidth)
    check('no sideways scrolling at 390px with the warning open', wide <= 390, `scrollWidth ${wide}`)

    await warn.getByRole('button', { name: 'Cancel', exact: true }).click()
    check('Cancel -> warning gone, nothing saved', (await warn.count()) === 0 && (await codeOf(a)) === null)

    await panel.getByRole('button', { name: 'Save', exact: true }).click()
    await warn.waitFor()
    await warn.getByRole('button', { name: 'Use it anyway', exact: true }).click()
    await panel.waitFor({ state: 'detached' })
    check('"Use it anyway" -> saved, panel closes', (await codeOf(a)) === SHARED)
    check('Alpha now shows the gray label', (await alpha.getByTestId('vendor-code-label').innerText()).includes(SHARED))

    // Clear through the UI.
    await alpha.getByRole('button', { name: 'Vendor Code', exact: true }).click()
    await alpha.getByTestId('vendor-code-panel').getByLabel('Vendor code').fill('')
    await alpha.getByTestId('vendor-code-panel').getByRole('button', { name: 'Save', exact: true }).click()
    await alpha.getByTestId('vendor-code-panel').waitFor({ state: 'detached' })
    check('clearing the field and saving removes the code', (await codeOf(a)) === null && (await alpha.getByTestId('vendor-code-label').count()) === 0)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/p67-list.png` })
  } finally {
    await browser.close()
  }
}

async function cleanup() {
  const owner = loginAsOwner()
  for (const id of ids) await apiFetch('/api/items', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id }) }).catch(() => {})
  const left = ids.length ? await rest(`items?id=in.(${ids.join(',')})&select=id`) : []
  console.log(`cleanup: ${ids.length} ZZTEST items deleted by id, ${left.length} left`)
  if (left.length) failures++
}

main()
  .catch((err) => {
    console.error('FAIL  suite crashed:', err?.message ?? err)
    failures++
  })
  .finally(async () => {
    await cleanup().catch((err) => {
      console.error('FAIL  cleanup crashed:', err?.message ?? err)
      failures++
    })
    console.log(failures ? `\n${failures} check(s) failed` : '\nall vendor-code checks passed')
    process.exit(failures ? 1 : 0)
  })
