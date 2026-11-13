// Patch 69: Confirm Delivery on the check-off screen, in a real browser at
// 390x844 as ZZTEST Owner. No Anthropic API (reader results are seeded) and
// no push (the dev server runs with VAPID_PRIVATE_KEY= blank, and this test
// answers the browser's /api/send-push itself).
//   - blocked state: no invoice number, unmatched and unchecked lines named
//   - typing the invoice number
//   - the confirm dialog: stock per item in our units, short/over/skipped,
//     "Will remember <code> for <item>", owner "Remember 1 CS = N", Store /
//     Storage, the "no undo" warning, the order picker
//   - a double tap on "Yes, add stock" sends ONE request
//   - the confirmed read-only summary, photo still opens
//   - File as record only, and the duplicate message with its link
// SAFETY: the dialog can list REAL on-order orders. This test always picks
// "No specific order", and refuses to send any confirm that names an order.
// Fixtures: ZZTEST P69U items + ZZTEST-created invoices, removed by id.
// Optional: P69_SCREENSHOT_DIR=<folder outside the repo> saves screenshots.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { createSessionToken } from '../../src/lib/session-token.ts'
import { apiFetch, loginAsOwner } from './helpers/auth.mjs'
import { rest } from './helpers/rest.mjs'
import { BASE_URL } from './helpers/config.mjs'
import { TINY_JPEG, createDraftWithPages, deleteInvoiceById, getInvoice, sweepZztestInvoices } from './helpers/invoices.mjs'

let failures = 0
let total = 0
function check(name, cond, detail = '') {
  total++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -- ${detail}` : ''}`)
  if (!cond) failures++
}
const J = (x) => JSON.stringify(x)
const SHOTS = process.env.P69_SCREENSHOT_DIR
const shot = async (page, name, fullPage = false) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage })
}

const PFX = 'ZZTEST P69U'
const itemIds = {}
const invoiceIds = []
const ITEMS = {
  cherry: { name: `${PFX} Cherry Mix`, category: 'Ice Mix', unit: 'gallons', code: 'ZZ69U001', number: '9401', pack: 4, case: 4 },
  cups: { name: `${PFX} Cups`, category: 'Containers & Cups', unit: 'boxes', code: 'ZZ69U002', number: '9402', pack: null, case: null },
  spoons: { name: `${PFX} Spoons`, category: 'Spoons & Straws', unit: 'sleeves', code: 'ZZ69U003', number: '9403', pack: null, case: null },
  hand: { name: `${PFX} Hand Pick`, category: 'Toppings', unit: 'cases', code: null, number: null, pack: null, case: null },
  stor: { name: `${PFX} Storage Lids`, category: 'Lids', unit: 'cases', code: 'ZZ69U005', number: '9405', pack: null, case: null, has_storage: true },
}
const L = (vendor_code, item_number, description, ordered, shipped) => ({ vendor_code, item_number, description, invoice_unit: 'CS', qty_ordered: ordered, qty_shipped: shipped, unsure: false, note: null })
const T = () => ({ total_ordered: null, total_shipped: null, total_units: null, total_cases: null, dollar_total: null, note: null })

async function makeReadInvoice(cookie, number, lines) {
  const inv = await createDraftWithPages(cookie, 'bunzl', [TINY_JPEG])
  invoiceIds.push(inv.id)
  const now = new Date().toISOString()
  const result = { vendor: 'bunzl', invoice_number: number, invoice_date: '11/13/26', page_number: 1, page_count: 1, has_no_items: false, lines, printed_totals: T(), page_notes: null }
  await rest(`invoices?id=eq.${inv.id}`, {
    method: 'PATCH',
    body: J({
      status: 'read', read_model: 'claude-opus-5-5',
      raw_extraction: { model: 'claude-opus-5-5', rev: 3, last_attempt_at: now, pages: { 1: { model: 'claude-opus-5-5', read_at: now, ms: 12000, usage: { input_tokens: 6800, output_tokens: 1200 }, result } }, attempts: [{ page: 1, at: now, model: 'claude-opus-5-5', outcome: 'ok' }] },
    }),
  })
  const r = await apiFetch('/api/invoices/lines', cookie, { method: 'POST', body: J({ invoice_id: inv.id }) })
  if (!r.ok) throw new Error(`build lines -> ${r.status} ${await r.text()}`)
  return inv.id
}
const view = async (id, cookie) => (await apiFetch(`/api/invoices/lines?invoice_id=${id}`, cookie)).json()
const patchLines = (id, cookie, updates) => apiFetch('/api/invoices/lines', cookie, { method: 'PATCH', body: J({ invoice_id: id, updates }) })
async function stock() {
  const rows = await rest(`items?id=in.(${Object.values(itemIds).join(',')})&select=id,current_count,storage_count,vendor_item_code,invoice_units_per_case`)
  return Object.fromEntries(Object.entries(itemIds).map(([k, id]) => {
    const r = rows.find((x) => x.id === id)
    return [k, { store: Number(r.current_count), storage: Number(r.storage_count), code: r.vendor_item_code, size: r.invoice_units_per_case == null ? null : Number(r.invoice_units_per_case) }]
  }))
}
const counts = (s) => J(Object.values(s).map((x) => [x.store, x.storage]))
async function ourHistory() {
  const rows = await rest(`order_history_items?item_name=ilike.${encodeURIComponent(`${PFX}*`)}&select=order_id`)
  const ids = [...new Set(rows.map((r) => r.order_id))]
  return ids.length ? rest(`order_history?id=in.(${ids.join(',')})&select=id,type,notes,related_order_id,resolved`) : []
}

async function main() {
  await sweepZztestInvoices()
  const owner = loginAsOwner()
  const stale = await ourHistory()
  if (stale.length) await rest(`order_history?id=in.(${stale.map((x) => x.id).join(',')})`, { method: 'DELETE' })
  const staleItems = await rest(`items?name=ilike.${encodeURIComponent(`${PFX}*`)}&select=id`)
  if (staleItems.length) {
    await rest(`storage_moves?item_id=in.(${staleItems.map((x) => x.id).join(',')})`, { method: 'DELETE' })
    await rest(`items?id=in.(${staleItems.map((x) => x.id).join(',')})`, { method: 'DELETE' })
  }
  const clash = await rest('items?or=(item_number.in.(9401,9402,9403,9405),vendor_item_code.in.(ZZ69U001,ZZ69U002,ZZ69U003,ZZ69U005,ZZ69ULEARN))&name=not.ilike.zztest*&select=name')
  check('no real item uses the test codes/numbers', clash.length === 0, J(clash))
  for (const [k, it] of Object.entries(ITEMS)) {
    const r = await apiFetch('/api/items', owner.cookie, { method: 'POST', body: J({ name: it.name, category: it.category, unit: it.unit }) })
    itemIds[k] = (await r.json()).id
    await rest(`items?id=eq.${itemIds[k]}`, { method: 'PATCH', body: J({ distributor: 'bunzl', item_number: it.number, vendor_item_code: it.code, pack_size: it.pack, invoice_units_per_case: it.case, has_storage: !!it.has_storage }) })
  }

  // Invoice A: the reader got no invoice number.
  const a = await makeReadInvoice(owner.cookie, null, [
    L('ZZ69U001', '9401', 'ZZTEST CHERRY MIX 1-GAL', 2, 2),
    L('ZZ69U002', '9402', 'ZZTEST CUPS 12OZ', 3, 3),
    L('ZZ69U003', '9403', 'ZZTEST SODA SPOONS', 1, 1),
    L('ZZ69ULEARN', null, 'QQA HANDPICK TOPPING', 1, 1),
    L('ZZ69UNOPE', null, 'QQB NOT OURS', 1, 1),
    L('ZZ69U005', '9405', 'ZZTEST STORAGE LIDS', 1, 1),
  ])
  const start = await stock()

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

    // Never a real push from the browser, and never a confirm that names an order.
    const pushes = []
    await page.route('**/api/send-push', async (route) => {
      pushes.push(JSON.parse(route.request().postData() || '{}'))
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })
    const confirmPosts = []
    let unsafe = false
    await page.route('**/api/invoices/confirm', async (route) => {
      const req = route.request()
      if (req.method() !== 'POST') return route.continue()
      const body = JSON.parse(req.postData() || '{}')
      confirmPosts.push(body)
      if (body.related_order_id) { unsafe = true; return route.abort() }
      await new Promise((r) => setTimeout(r, 600)) // long enough for a second tap to land
      return route.continue()
    })

    const open = async (id) => {
      await page.goto(`${BASE_URL}/scan-invoice/check?id=${id}`)
      await page.waitForSelector('[data-testid="checkoff-header"]')
    }
    const card = (text) => page.locator('[data-testid="line-card"]', { hasText: text })

    // ---------- blocked ----------
    await open(a)
    check('the invoice number box shows when the reader got none', await page.locator('[data-testid="number-entry"]').isVisible())
    await page.locator('[data-testid="confirm-button"]').click()
    await page.waitForSelector('[data-testid="blockers"]')
    const blockText = await page.locator('[data-testid="blockers"]').innerText()
    check('blocked: says it can\'t confirm and counts what to fix', /Can't confirm yet\. 7 things to fix/.test(blockText), blockText.slice(0, 120))
    check('blocked: missing invoice number named', /no invoice number/i.test(blockText))
    check('blocked: unmatched lines named (page, line, description)', /Page 1, line 4: QQA HANDPICK TOPPING is not matched/.test(blockText) && /Page 1, line 5: QQB NOT OURS is not matched/.test(blockText), blockText)
    check('blocked: unchecked lines named', /Page 1, line 1: ZZTEST CHERRY MIX 1-GAL is not checked off yet/.test(blockText) && /Page 1, line 6: ZZTEST STORAGE LIDS is not checked off yet/.test(blockText))
    check('blocked: no dialog opened', (await page.locator('[data-testid="confirm-dialog"]').count()) === 0)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(400)
    await noSideScroll('blocked state')
    await shot(page, '1-blocked')
    await shot(page, '1-blocked-full', true)
    check('blocked: nothing was sent to confirm, no stock moved', confirmPosts.length === 0 && counts(start) === counts(await stock()))

    // ---------- type the invoice number ----------
    await page.getByLabel('Invoice number').fill('zztest69u-1')
    await page.locator('[data-testid="number-entry"] button').click()
    await page.waitForSelector('[data-testid="number-entry"]', { state: 'detached' })
    check('typed invoice number saved and shown in the header', (await page.locator('[data-testid="checkoff-header"] h1').innerText()).includes('#ZZTEST69U-1') && (await getInvoice(a)).invoice_number === 'ZZTEST69U-1')

    // picks / skip / most of the check-off through the API (patch 68 UI already has its own suite)
    let v = await view(a, owner.cookie)
    const line = (w) => v.lines.find((l) => l.description.includes(w))
    await patchLines(a, owner.cookie, [
      { id: line('HANDPICK').id, item_id: itemIds.hand, qty_received: 1, checked: true },
      { id: line('NOT OURS').id, skip: true },
      { id: line('CHERRY').id, qty_received: 2, checked: true },
      { id: line('CUPS').id, qty_received: 2, checked: true }, // 3 shipped: short 1
      { id: line('STORAGE LIDS').id, qty_received: 1, checked: true },
    ])
    await open(a)
    // the last line is finished IN the browser and NOT saved: Confirm must save it first
    const spoons = card('ZZTEST SODA SPOONS')
    await spoons.getByLabel('Case size for this line').fill('12')
    await spoons.getByRole('button', { name: /Matches invoice/ }).click()
    check('bar shows unsaved work', (await page.locator('[data-testid="checkoff-bar"]').innerText()).includes('unsaved'))
    await page.locator('[data-testid="confirm-button"]').click()
    await page.waitForSelector('[data-testid="confirm-dialog"]')
    v = await view(a, owner.cookie)
    check('Confirm Delivery saved the unsaved line first', line('SPOONS').qty_received === 1 && line('SPOONS').checked === true && line('SPOONS').units_per_invoice_unit === 12)

    // ---------- the dialog ----------
    const dlg = page.locator('[data-testid="confirm-dialog"]')
    const dText = await dlg.innerText()
    check('dialog: says it adds stock to 5 items', /This adds stock to 5 items\./.test(dText), dText.slice(0, 200))
    check('dialog: says plainly there is no undo and where corrections go', /no undo button yet/i.test(dText) && /Correct Count/.test(dText))
    check('dialog: quantities in OUR units after case size (8 gallons, 2 boxes, 12 sleeves)', /\+8 gallons/.test(dText) && /\+2 boxes/.test(dText) && /\+12 sleeves/.test(dText) && /from 2 CS received/.test(dText), dText)
    check('dialog: 1 short, 0 over, 1 skipped', /1 short · 0 over · 1 skipped/.test(dText))
    check('dialog: names the short item in our units', new RegExp(`${ITEMS.cups.name}: 1 box short`).test(dText), dText)
    check('dialog: "Will remember ZZ69ULEARN for <item>"', new RegExp(`Will remember\\s+ZZ69ULEARN\\s+for\\s+${ITEMS.hand.name}`).test(dText), dText)
    check('dialog (owner): "Remember 1 CS = 12 sleeves for <item>" checkbox, unticked', /Remember 1 CS = 12 sleeves for/.test(dText) && !(await dlg.locator('input[type="checkbox"]').isChecked()))
    check('dialog (owner): Store / Storage choice on the has_storage item only', (await dlg.getByRole('button', { name: 'Storage', exact: true }).count()) === 1)
    check('dialog: order picker with "No specific order"', /Receiving against which order\?/i.test(dText) && /No specific order/.test(dText))
    check('dialog: nothing saved to stock yet', counts(start) === counts(await stock()))
    await noSideScroll('confirm dialog')
    await shot(page, '2-dialog-top')
    await dlg.locator('[data-testid="confirm-orders"]').scrollIntoViewIfNeeded()
    await shot(page, '2-dialog-bottom')

    await dlg.locator('input[type="checkbox"]').check()
    await dlg.getByRole('button', { name: 'Storage', exact: true }).click()
    await dlg.getByText('No specific order').click() // SAFETY: never a real order
    check('"No specific order" is selected', await dlg.locator('input[type="radio"]').first().isChecked())

    // ---------- double tap ----------
    const yes = dlg.locator('[data-testid="confirm-yes"]')
    await yes.click()
    await yes.click({ force: true, timeout: 1000 }).catch(() => {})
    check('button is disabled and says "Adding stock…" while saving', await page.locator('[data-testid="confirm-yes"]').isDisabled().catch(() => true))
    await page.waitForSelector('[data-testid="confirmed-summary"]', { timeout: 30000 })
    check('double tap on "Yes, add stock" sent exactly ONE confirm', confirmPosts.length === 1, `${confirmPosts.length}`)
    check('safety: the confirm named no order', !unsafe && confirmPosts[0].related_order_id == null)

    // ---------- confirmed summary ----------
    const sText = await page.locator('[data-testid="confirmed-summary"]').innerText()
    check('summary: "Delivery confirmed by ZZTEST Owner" with a time', /Delivery confirmed by ZZTEST Owner · /.test(sText), sText.slice(0, 120))
    check('summary: lists what was added in our units', /Added to stock:/.test(sText) && new RegExp(`${ITEMS.cherry.name}: \\+8 gallons`).test(sText) && new RegExp(`${ITEMS.spoons.name}: \\+12 sleeves`).test(sText), sText)
    check('summary: says what was remembered', /Remembered code ZZ69ULEARN for/.test(sText) && /Remembered 1 CS = 12 sleeves for/.test(sText), sText)
    check('summary: mentions the short', /1 item came up short/.test(sText))
    check('no stale "Progress saved" line above the summary', (await page.getByText('Progress saved').count()) === 0)
    check('read-only: no Confirm, Save, Discard or record-only buttons', (await page.locator('[data-testid="confirm-button"]').count()) === 0 && (await page.locator('[data-testid="checkoff-bar"]').count()) === 0 && (await page.getByRole('button', { name: 'Discard Invoice' }).count()) === 0 && (await page.locator('[data-testid="record-only-button"]').count()) === 0)
    check('read-only: no Edit / Change item / Undo, no enabled inputs', (await page.getByRole('button', { name: 'Edit', exact: true }).count()) === 0 && (await page.getByText('Change item').count()) === 0 && (await page.getByRole('button', { name: 'Undo', exact: true }).count()) === 0 && (await page.locator('main input:not([disabled])').count()) === 0)
    check('read-only: each line shows what it added', (await page.locator('[data-testid="compact-added"]').count()) === 5)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(400)
    await noSideScroll('confirmed summary')
    await shot(page, '3-confirmed')
    await shot(page, '3-confirmed-full', true)
    await page.locator('[data-testid="confirmed-summary"]').getByRole('button', { name: 'View page 1' }).click()
    await page.waitForSelector('[data-testid="photo-viewer"] img')
    check('photo still opens after confirm (signed link)', (await page.locator('[data-testid="photo-viewer"] img').getAttribute('src'))?.includes('token='))
    await page.locator('[data-testid="photo-viewer"]').getByRole('button', { name: 'Close' }).click()

    // what actually happened in the database
    const after = await stock()
    check('stock: cherry +8, cups +2, spoons +12, hand +1 in the store; lids +1 in STORAGE (owner chose it)',
      after.cherry.store - start.cherry.store === 8 && after.cups.store - start.cups.store === 2 && after.spoons.store - start.spoons.store === 12 && after.hand.store - start.hand.store === 1 && after.stor.store === start.stor.store && after.stor.storage - start.stor.storage === 1,
      J(after))
    check('owner ticked "Remember": Spoons now has 1 CS = 12', after.spoons.size === 12)
    check('hand-picked code learned on the item', after.hand.code === 'ZZ69ULEARN')
    const hist = await ourHistory()
    check('one receipt + one short row, receipt note "Invoice ZZTEST69U-1: 1 short"', hist.length === 2 && hist.some((h) => h.type === 'received' && h.notes === 'Invoice ZZTEST69U-1: 1 short' && h.related_order_id === null) && hist.some((h) => h.type === 'short' && h.resolved === false), J(hist))
    check('browser fired the same owner push Receive Order does (answered by the test, not sent)', pushes.length === 1 && pushes[0].title === 'Short Shipment', J(pushes))

    // recent list
    await page.goto(`${BASE_URL}/scan-invoice`)
    await page.waitForSelector('text=ZZTEST69U-1')
    check('Scan Invoice list: the received invoice opens its summary', (await page.locator('button', { hasText: 'ZZTEST69U-1' }).innerText()).includes('Summary'))

    // ---------- duplicate ----------
    const c = await makeReadInvoice(owner.cookie, 'ZZTEST69U-1', [L('ZZ69U002', '9402', 'ZZTEST CUPS AGAIN', 1, 1)])
    v = await view(c, owner.cookie)
    await patchLines(c, owner.cookie, [{ id: v.lines[0].id, qty_received: 1, checked: true }])
    const beforeDup = await stock()
    await open(c)
    await page.locator('[data-testid="confirm-button"]').click()
    await page.waitForSelector('[data-testid="blockers"]')
    const dupText = await page.locator('[data-testid="blockers"]').innerText()
    const href = await page.locator('[data-testid="blockers"] a').getAttribute('href')
    check('duplicate: clear message, no dialog', /Invoice ZZTEST69U-1 from this vendor was already received\. Nothing was added\./.test(dupText) && (await page.locator('[data-testid="confirm-dialog"]').count()) === 0, dupText)
    check('duplicate: links to the existing invoice', href === `/scan-invoice/check?id=${a}`, href)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(300)
    await shot(page, '4-duplicate')
    check('duplicate: no stock moved', counts(beforeDup) === counts(await stock()))

    // ---------- record only ----------
    await page.locator('[data-testid="record-only-button"]').scrollIntoViewIfNeeded()
    await page.locator('[data-testid="record-only-button"]').click()
    await page.waitForSelector('[data-testid="record-dialog"]')
    await page.locator('[data-testid="record-yes"]').click()
    await page.waitForSelector('[data-testid="record-dialog"]', { state: 'detached' })
    await page.waitForSelector('[data-testid="blockers"]')
    check('record-only on a duplicate number is refused with the same message', /already received/.test(await page.locator('[data-testid="blockers"]').innerText()))
    check('...invoice still read, nothing added', (await getInvoice(c)).status === 'read' && counts(beforeDup) === counts(await stock()))

    await rest(`invoices?id=eq.${c}`, { method: 'PATCH', body: J({ invoice_number: 'ZZTEST69U-2' }) })
    await open(c)
    const histBefore = (await ourHistory()).length
    await page.locator('[data-testid="record-only-button"]').scrollIntoViewIfNeeded()
    await shot(page, '5-record-only-button')
    await page.locator('[data-testid="record-only-button"]').click()
    await page.waitForSelector('[data-testid="record-dialog"]')
    const rText = await page.locator('[data-testid="record-dialog"]').innerText()
    check('record-only dialog: says no stock is added and it can\'t be undone', /no stock is added/.test(rText) && /can't be undone/.test(rText) && /already received another way/.test(rText), rText)
    await shot(page, '5-record-only-dialog')
    await page.locator('[data-testid="record-yes"]').click()
    await page.waitForSelector('[data-testid="confirmed-summary"]')
    const roText = await page.locator('[data-testid="confirmed-summary"]').innerText()
    check('record-only summary: "Filed as record only by ZZTEST Owner", no stock added', /Filed as record only by ZZTEST Owner/.test(roText) && /No stock was added/.test(roText), roText)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(300)
    await shot(page, '5-record-only-summary')
    const rc = await getInvoice(c)
    check('record-only: received + record_only, no receipt, stock and history untouched',
      rc.status === 'received' && rc.record_only === true && rc.receipt_id === null && counts(beforeDup) === counts(await stock()) && (await ourHistory()).length === histBefore, J({ ...rc, raw_extraction: undefined }))
    check('no real push was attempted for record only', pushes.length === 1)
    check('safety: no confirm ever named an order', !unsafe && confirmPosts.every((b) => b.related_order_id == null))
  } finally {
    await browser.close()
  }
}

async function cleanup() {
  const owner = loginAsOwner()
  let invLeft = 0
  for (const id of invoiceIds) {
    const res = await deleteInvoiceById(id)
    if (res.photosLeft || res.rowLeft) invLeft++
  }
  const hist = (await ourHistory()).map((h) => h.id)
  if (hist.length) {
    await rest(`order_history?id=in.(${hist.join(',')})&type=eq.short`, { method: 'DELETE' })
    await rest(`order_history?id=in.(${hist.join(',')})`, { method: 'DELETE' })
  }
  const ids = Object.values(itemIds).filter(Boolean)
  if (ids.length) await rest(`storage_moves?item_id=in.(${ids.join(',')})`, { method: 'DELETE' })
  for (const id of ids) await apiFetch('/api/items', owner.cookie, { method: 'DELETE', body: J({ id }) }).catch(() => {})
  const itemsLeft = ids.length ? (await rest(`items?id=in.(${ids.join(',')})&select=id`)).length : 0
  const linesLeft = invoiceIds.length ? (await rest(`invoice_lines?invoice_id=in.(${invoiceIds.join(',')})&select=id`)).length : 0
  const histLeft = (await ourHistory()).length
  const movesLeft = ids.length ? (await rest(`storage_moves?item_id=in.(${ids.join(',')})&select=id`)).length : 0
  console.log(`cleanup: ${invoiceIds.length} invoices, ${ids.length} items, ${hist.length} history rows removed by id; left: invoices ${invLeft}, items ${itemsLeft}, lines ${linesLeft}, history ${histLeft}, storage moves ${movesLeft}`)
  if (invLeft || itemsLeft || linesLeft || histLeft || movesLeft) failures++
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
    console.log(failures ? `\n${failures} check(s) failed (of ${total})` : `\nall ${total} invoice-confirm-ui checks passed`)
    process.exit(failures ? 1 : 0)
  })
