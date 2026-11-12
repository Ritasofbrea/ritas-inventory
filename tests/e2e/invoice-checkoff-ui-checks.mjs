// Patch 68b: Scan Invoice "Read Invoice" flow + check-off screen, in a real
// browser at 390x844. NEVER calls the Anthropic API:
//   - the Read Invoice success/failure path intercepts ONLY the browser's
//     POST /api/invoices/read (page 2 fails once as "busy", then Retry
//     works); when the last page "succeeds", the test writes reader
//     results into raw_extraction itself, exactly what a real read leaves
//   - the 2-reads-per-page cap path is real: the server refuses before any
//     API call (and the dev server runs with ANTHROPIC_API_KEY= blank)
// Fixtures: ZZTEST P68U items + ZZTEST-created invoices, removed by id.
// Optional: P68_SCREENSHOT_DIR=<folder outside the repo> saves screenshots.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { createSessionToken } from '../../src/lib/session-token.ts'
import { apiFetch, loginAsOwner } from './helpers/auth.mjs'
import { rest } from './helpers/rest.mjs'
import { BASE_URL } from './helpers/config.mjs'
import { TINY_JPEG, createDraftWithPages, deleteInvoiceById, getInvoice, sweepZztestInvoices } from './helpers/invoices.mjs'

let failures = 0
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -- ${detail}` : ''}`)
  if (!cond) failures++
}
const SHOTS = process.env.P68_SCREENSHOT_DIR
const shot = async (page, name, fullPage = false) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage })
}

const itemIds = {}
const invoiceIds = []
const ITEMS = {
  cherry: { name: 'ZZTEST P68U Cherry Mix', category: 'Ice Mix', unit: 'gallons', item_number: '9201', code: 'ZZ68U001', case: 4 },
  mango: { name: 'ZZTEST P68U Mango Mix', category: 'Ice Mix', unit: 'gallons', item_number: '9202', code: 'ZZ68U002', case: 4 },
  spoons: { name: 'ZZTEST P68U Spoons', category: 'Spoons & Straws', unit: 'sleeves', item_number: '9203', code: 'ZZ68U003', case: null },
  lids: { name: 'ZZTEST P68U Lids', category: 'Lids', unit: 'boxes', item_number: '9204', code: 'ZZ68U004', case: null },
  cups: { name: 'ZZTEST P68U Cups', category: 'Containers & Cups', unit: 'boxes', item_number: '9205', code: 'ZZ68U005', case: null },
  jacket: { name: 'ZZTEST P68U Waffle Jacket', category: 'Cones', unit: 'cases', item_number: null, code: null, case: null },
}
const L = (vendor_code, item_number, description, ordered, shipped, extra = {}) => ({
  vendor_code, item_number, description, invoice_unit: 'CS', qty_ordered: ordered, qty_shipped: shipped, unsure: false, note: null, ...extra,
})
const T = (over = {}) => ({ total_ordered: null, total_shipped: null, total_units: null, total_cases: null, dollar_total: null, note: null, ...over })
const res = (over) => ({ vendor: 'bunzl', invoice_number: 'ZZ70273381', invoice_date: '10/23/26', page_number: 1, page_count: 2, has_no_items: false, lines: [], printed_totals: T(), page_notes: null, ...over })

// 17 lines over 2 pages: 1 conflict, 1 unmatched-with-suggestion, 1 unmatched,
// 1 short, 1 unknown case size, the rest plain code matches.
function readerPages() {
  const filler = Array.from({ length: 10 }, (_, i) => L(i % 2 ? 'ZZ68U001' : 'ZZ68U002', null, `ZZTEST FILLER MIX LINE ${i + 1} 1-GAL`, 1, 1))
  return {
    1: res({
      page_number: 1,
      lines: [
        L('ZZ68U001', '9201', 'ZZTEST CHERRY MIX 1-GAL', 1, 1),
        L('ZZ68U003', '9203', 'ZZTEST SODA SPOON WHITE BULK', 2, 2),
        L('ZZ68U004', '9205', 'ZZTEST DOME LID PP 8-OZ CLEAR', 1, 1, { unsure: true, note: 'First character of the code is faint' }),
        L(null, null, 'ZZTEST WAFFLE JACKET 10/16 REG', 1, 1),
        L('ZZ68UNOPE', null, 'QQQ XYZZY PLUGH', 1, 1),
        L('ZZ68U002', '9202', 'ZZTEST MANGO MIX 1-GAL', 3, 2),
        ...filler.slice(0, 4),
      ],
    }),
    2: res({ page_number: 2, lines: filler.slice(4).concat([L('ZZ68U001', null, 'ZZTEST CHERRY MIX EXTRA', 1, 1)]), printed_totals: T({ total_ordered: 19, total_shipped: 18 }) }),
  }
}

async function seedRead(id, pages, attempts = null) {
  const now = new Date().toISOString()
  await rest(`invoices?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'read',
      read_model: 'claude-opus-5-5',
      raw_extraction: {
        model: 'claude-opus-5-5', rev: 5, last_attempt_at: now,
        pages: Object.fromEntries(Object.entries(pages).map(([k, r]) => [k, { model: 'claude-opus-5-5', read_at: now, ms: 14000, usage: { input_tokens: 6800, output_tokens: 1300 }, result: r }])),
        attempts: attempts ?? Object.keys(pages).map((k) => ({ page: Number(k), at: now, model: 'claude-opus-5-5', outcome: 'ok' })),
      },
    }),
  })
}

async function main() {
  await sweepZztestInvoices()
  const owner = loginAsOwner()
  const clash = await rest('items?or=(item_number.in.(9201,9202,9203,9204,9205),vendor_item_code.in.(ZZ68U001,ZZ68U002,ZZ68U003,ZZ68U004,ZZ68U005))&name=not.ilike.zztest*&select=name')
  check('no real item uses the test codes/numbers', clash.length === 0, JSON.stringify(clash))
  for (const [k, it] of Object.entries(ITEMS)) {
    const r = await apiFetch('/api/items', owner.cookie, { method: 'POST', body: JSON.stringify({ name: it.name, category: it.category, unit: it.unit }) })
    const created = await r.json()
    itemIds[k] = created.id
    await rest(`items?id=eq.${created.id}`, { method: 'PATCH', body: JSON.stringify({ distributor: 'bunzl', item_number: it.item_number, vendor_item_code: it.code, invoice_units_per_case: it.case }) })
  }

  // Invoice A: draft, 2 pages, nothing read -> Read Invoice flow.
  const a = await createDraftWithPages(owner.cookie, 'bunzl', [TINY_JPEG, TINY_JPEG])
  invoiceIds.push(a.id)
  // Invoice C: draft, page 1 already used both reads -> cap message, no Retry.
  const c = await createDraftWithPages(owner.cookie, 'bunzl', [TINY_JPEG])
  invoiceIds.push(c.id)
  const now = new Date().toISOString()
  await rest(`invoices?id=eq.${c.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ raw_extraction: { model: null, rev: 2, last_attempt_at: now, pages: {}, attempts: [{ page: 1, at: now, model: 'claude-opus-5-5', outcome: 'failed' }, { page: 1, at: now, model: 'claude-opus-5-5', outcome: 'failed' }] } }),
  })

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
    const noSideScroll = async (label) => {
      const w = await page.evaluate(() => document.documentElement.scrollWidth)
      check(`no sideways scrolling: ${label}`, w <= 390, `scrollWidth ${w}`)
    }

    // ---------- Read Invoice flow (only the read request is faked) ----------
    let page2Calls = 0
    await page.route('**/api/invoices/read', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}')
      await new Promise((r) => setTimeout(r, 700))
      if (body.invoice_id !== a.id) return route.continue()
      if (body.page === 1) {
        // what a real page-1 read leaves behind: page 1's result, still a draft
        const p = readerPages()
        await seedRead(a.id, { 1: p[1] })
        await rest(`invoices?id=eq.${a.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'draft' }) })
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, page: 1 }) })
      }
      page2Calls++
      if (page2Calls === 1) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'The invoice reader is busy right now. Wait a minute, then tap Read again.' }) })
      await seedRead(a.id, readerPages())
      await apiFetch('/api/invoices/lines', owner.cookie, { method: 'POST', body: JSON.stringify({ invoice_id: a.id }) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, page: 2 }) })
    })

    await page.goto(`${BASE_URL}/scan-invoice`, { waitUntil: 'networkidle' })
    const recentRow = page.locator('button').filter({ hasText: 'Open →' }).first()
    await recentRow.waitFor()
    // open invoice A from the recent list (newest first: C, then A)
    await page.locator('button').filter({ hasText: '2 pages' }).filter({ hasText: 'Open →' }).first().click()
    const panel = page.getByTestId('read-panel')
    await panel.waitFor()
    check('draft opens with a Read Invoice button', (await panel.getByRole('button', { name: 'Read Invoice' }).count()) === 1)
    await panel.getByRole('button', { name: 'Read Invoice' }).click()
    await page.getByText('Reading page 1 of 2, about 15 seconds each').waitFor({ timeout: 5000 })
    check('progress shows "Reading page 1 of 2, about 15 seconds each"', true)
    await shot(page, '1-reading-progress')
    const alert = panel.getByRole('alert')
    await alert.waitFor({ timeout: 10000 })
    check('page 2 failure shows a clear message', (await alert.innerText()).includes('busy right now'))
    check('...with Retry for page 2 only', (await alert.getByRole('button', { name: 'Retry page 2' }).count()) === 1)
    check('...and page 1 shows as read', (await panel.innerText()).includes('Page 1: ✓ read'))
    await shot(page, '2-read-error-retry')
    await noSideScroll('read panel with error')
    await alert.getByRole('button', { name: 'Retry page 2' }).click()
    await page.waitForURL(/\/scan-invoice\/check\?id=/, { timeout: 15000 })
    check('all pages read -> lands on the check-off screen', page.url().includes(a.id))

    // ---------- check-off screen ----------
    await page.getByTestId('checkoff-header').waitFor()
    await page.getByTestId('line-card').first().waitFor()
    const header = await page.getByTestId('checkoff-header').innerText()
    check('header: vendor, invoice number, date', header.includes('Bunzl invoice #ZZ70273381') && header.includes('Dated 10/23/26'), header)
    const totalsText = await page.getByTestId('totals-line').innerText()
    check('totals mismatch shows a soft warning (19 shipped vs printed 18)', totalsText.includes('add up to 19') && totalsText.includes('total of 18'), totalsText)
    const cards = page.getByTestId('line-card')
    check('17 line cards', (await cards.count()) === 17, `${await cards.count()}`)
    check('"needs a look" line is first', (await cards.nth(0).innerText()).includes('Needs a look'))
    check('unmatched lines come next', (await cards.nth(1).innerText()).includes('Not matched') && (await cards.nth(2).innerText()).includes('Not matched'))
    check("reader's unsure note shown", (await cards.nth(0).innerText()).includes('First character of the code is faint'))
    await shot(page, '3-checkoff-top')
    await noSideScroll('check-off screen')
    const bar = await page.getByTestId('checkoff-bar').boundingBox()
    check('sticky bar sits at the bottom of the screen', bar && bar.y + bar.height >= 840 && bar.y > 700, JSON.stringify(bar))
    check('bar reads "0 of 17 lines checked"', (await page.getByTestId('checkoff-bar').innerText()).includes('0 of 17 lines checked'))

    // picker: resolve the conflict line by tapping a best guess
    await cards.nth(0).getByRole('button', { name: 'Which item is this?' }).click()
    const picker = page.getByTestId('picker')
    await picker.waitFor()
    const pickerText = (await picker.innerText()).toLowerCase()
    check('picker: best guesses list both items', pickerText.includes('best guesses') && pickerText.includes(ITEMS.lids.name.toLowerCase()) && pickerText.includes(ITEMS.cups.name.toLowerCase()))
    check('picker: vendor items, "Show all items", and skip', pickerText.includes('bunzl items') && pickerText.includes('show all items') && pickerText.includes('not one of our items (skip)'))
    await shot(page, '4-picker')
    await picker.getByPlaceholder('Search our items…').fill('P68U Lids')
    await picker.getByRole('button', { name: new RegExp(ITEMS.lids.name) }).first().click()
    await picker.waitFor({ state: 'detached' })
    const lidCard = cards.filter({ hasText: 'DOME LID' })
    check('picked line now shows our item, "picked by hand"', (await lidCard.innerText()).includes(`${ITEMS.lids.name} (picked by hand)`))

    // accept the description suggestion, skip the junk line
    await cards.filter({ hasText: 'WAFFLE JACKET' }).getByRole('button', { name: 'Which item is this?' }).click()
    await picker.waitFor()
    check('suggestion offered for the waffle jacket line', (await picker.innerText()).includes(ITEMS.jacket.name))
    await picker.getByRole('button', { name: new RegExp(ITEMS.jacket.name) }).first().click()
    await picker.waitFor({ state: 'detached' })
    await cards.filter({ hasText: 'XYZZY' }).getByRole('button', { name: 'Which item is this?' }).click()
    await picker.waitFor()
    await picker.getByRole('button', { name: 'Not one of our items (skip)' }).click()
    await picker.waitFor({ state: 'detached' })
    check('skipped line collapses to "Not one of our items"', (await cards.filter({ hasText: 'XYZZY' }).innerText()).includes('Not one of our items'))
    check('bar now counts 16 lines (skip not counted)', (await page.getByTestId('checkoff-bar').innerText()).includes('of 16 lines checked'))

    // received: over, short, matches
    const cherry = cards.filter({ hasText: 'ZZTEST CHERRY MIX 1-GAL' })
    await cherry.getByRole('button', { name: 'One more' }).click()
    await cherry.getByRole('button', { name: 'One more' }).click()
    check('+ + on a 1-shipped line -> "Over 1" badge', (await cherry.getByTestId('badge-over').innerText()).includes('Over 1'))
    await cherry.getByRole('button', { name: /Matches invoice/ }).click()
    check('"Matches invoice" fills 1, badge gone', (await cherry.getByLabel('Received').inputValue()) === '1' && (await cherry.getByTestId('badge-over').count()) === 0)
    const mango = cards.filter({ hasText: 'ZZTEST MANGO MIX 1-GAL' })
    await mango.getByLabel('Received').fill('1')
    check('typed 1 on a 2-shipped line -> "Short 1" badge', (await mango.getByTestId('badge-short').innerText()).includes('Short 1'))
    await shot(page, '5-received-badges')
    // unknown case size, typed for this line
    const spoon = cards.filter({ hasText: 'SODA SPOON' })
    check('unknown case size asks for it', (await spoon.innerText()).includes('Case size unknown'))
    await spoon.getByLabel('Case size for this line').fill('24')
    check('bar shows unsaved', (await page.getByTestId('checkoff-bar').innerText()).includes('unsaved'))

    // view the page photo
    await cherry.getByRole('button', { name: 'View page 1' }).click()
    const viewer = page.getByTestId('photo-viewer')
    await viewer.waitFor()
    await viewer.locator('img').waitFor({ timeout: 10000 })
    check('page photo opens full screen (signed link)', (await viewer.locator('img').getAttribute('src')).includes('token='))
    await viewer.getByRole('button', { name: 'Close' }).click()

    // save, leave, come back
    await page.getByTestId('checkoff-bar').getByRole('button', { name: 'Save Progress' }).click()
    await page.getByText('Progress saved').waitFor()
    await page.goto(`${BASE_URL}/scan-invoice`, { waitUntil: 'networkidle' })
    const readRow = page.locator('button').filter({ hasText: '#ZZ70273381' })
    const readRowText = (await readRow.innerText()).toLowerCase()
    check('recent list: read invoice shows status + "Check off →"', readRowText.includes('read') && readRowText.includes('check off'), readRowText)
    await readRow.click()
    await page.waitForURL(/\/scan-invoice\/check\?id=/)
    await page.getByTestId('line-card').first().waitFor()
    check('resume: "2 of 16 lines checked" after coming back', (await page.getByTestId('checkoff-bar').innerText()).includes('2 of 16 lines checked'))
    const mangoBack = cards.filter({ hasText: 'ZZTEST MANGO MIX 1-GAL' })
    check('resume: checked lines fold into one row with received + short badge',
      (await mangoBack.getByTestId('compact-received').innerText()).includes('Received 1 CS') && (await mangoBack.getByTestId('badge-short').innerText()).includes('Short 1'))
    await mangoBack.getByRole('button', { name: 'Edit' }).click()
    check('resume: Edit opens it again with the saved value', (await cards.filter({ hasText: 'ZZTEST MANGO MIX 1-GAL' }).getByLabel('Received').inputValue()) === '1')
    check('resume: typed case size kept', (await cards.filter({ hasText: 'SODA SPOON' }).innerText()).includes('1 CS = 24 sleeves (typed for this invoice)'))
    await page.evaluate(() => window.scrollTo(0, 2400))
    await page.waitForTimeout(200)
    await shot(page, '6-checkoff-scrolled')
    await shot(page, '7-checkoff-full', true)

    // discard
    await page.getByRole('button', { name: 'Discard Invoice' }).click()
    await page.getByRole('dialog', { name: 'Discard this invoice?' }).waitFor()
    await shot(page, '8-discard-confirm')
    await page.getByRole('button', { name: 'Yes, discard' }).click()
    await page.waitForURL(/\/scan-invoice$/)
    check('discard -> back on Scan Invoice, invoice discarded', (await getInvoice(a.id)).status === 'discarded')
    await page.waitForLoadState('networkidle')
    check('discarded invoice is gone from the recent list', (await page.locator('button').filter({ hasText: '#ZZ70273381' }).count()) === 0)

    // ---------- the real 2-reads cap (server refuses before any API call) ----------
    await page.unroute('**/api/invoices/read')
    await page.locator('button').filter({ hasText: '1 page' }).filter({ hasText: 'Open →' }).first().click()
    await page.getByTestId('read-panel').waitFor()
    await page.getByTestId('read-panel').getByRole('button', { name: 'Read Invoice' }).click()
    const capAlert = page.getByTestId('read-panel').getByRole('alert')
    await capAlert.waitFor({ timeout: 10000 })
    const capText = await capAlert.innerText()
    check('2-reads cap: friendly message, no Retry', capText.includes('already been read 2 times') && (await capAlert.getByRole('button').count()) === 0, capText)
    await shot(page, '9-read-cap')
  } finally {
    await browser.close()
  }
}

async function cleanup() {
  const owner = loginAsOwner()
  let left = 0
  for (const id of invoiceIds) {
    const r = await deleteInvoiceById(id)
    if (r.photosLeft || r.rowLeft) left++
  }
  const ids = Object.values(itemIds).filter(Boolean)
  for (const id of ids) await apiFetch('/api/items', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id }) }).catch(() => {})
  const itemsLeft = ids.length ? (await rest(`items?id=in.(${ids.join(',')})&select=id`)).length : 0
  const linesLeft = invoiceIds.length ? (await rest(`invoice_lines?invoice_id=in.(${invoiceIds.join(',')})&select=id`)).length : 0
  console.log(`cleanup: ${invoiceIds.length} invoices, ${ids.length} items removed by id; left: invoices ${left}, items ${itemsLeft}, lines ${linesLeft}`)
  if (left || itemsLeft || linesLeft) failures++
}

main()
  .catch((err) => {
    console.error('FAIL  suite crashed:', err?.stack ?? err)
    failures++
  })
  .finally(async () => {
    await cleanup().catch((err) => {
      console.error('FAIL  cleanup crashed:', err?.message ?? err)
      failures++
    })
    console.log(failures ? `\n${failures} check(s) failed` : '\nall invoice check-off UI checks passed')
    process.exit(failures ? 1 : 0)
  })
