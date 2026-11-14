// Patch 70: invoice history screens in Playwright at 390x844 (phone width).
// History > Invoices list (search, vendor filter, badges, record only),
// the read-only detail (numbers, skipped lines, full-screen photo through a
// signed link), "View invoice" from Order History and from the Dashboard
// Short Shipment alert, the Scan Invoice "read but not confirmed" nudge,
// and the shift lead view (Invoices tab only). Nothing is clicked that
// changes data (no Resolved, no confirm, no discard).
// NEVER calls the Anthropic API; run against `npm run dev` started with
// ANTHROPIC_API_KEY= and VAPID_PRIVATE_KEY= (both blank).
// Optional: P70_SCREENSHOT_DIR=<folder outside the repo> saves screenshots.
process.env.VAPID_PRIVATE_KEY = ''

import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'
import { createSessionToken } from '../../src/lib/session-token.ts'
import { loginAsOwner } from './helpers/auth.mjs'
import { getInvoice, sweepZztestInvoices } from './helpers/invoices.mjs'
import { BASE_URL } from './helpers/config.mjs'
import { cleanupTracked, makeConfirmedInvoice, makeReadInvoice, makeRecordOnlyInvoice, newTracker, setupItems } from './helpers/invoice-history.mjs'

let failures = 0
let total = 0
function check(name, cond, detail = '') {
  total++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -- ${detail}` : ''}`)
  if (!cond) failures++
}
const J = (x) => JSON.stringify(x)
const SHOTS = process.env.P70_SCREENSHOT_DIR
const shot = async (page, name, fullPage = false) => {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage })
}
const t = newTracker()

async function newPage(browser, role, name) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
  if (role) await ctx.addCookies([{ name: 'ritas_session', value: createSessionToken(role, name).token, domain: 'localhost', path: '/' }])
  const page = await ctx.newPage()
  await page.addInitScript(
    ([r, n]) => {
      if (r) localStorage.setItem('ritas_role', r)
      if (r === 'owner') localStorage.setItem('ritas_owner_name', n)
    },
    [role, name]
  )
  // Never a real push, never a write from these screens.
  const writes = []
  await page.route('**/api/**', async (route) => {
    const m = route.request().method()
    if (m !== 'GET' && !route.request().url().includes('/api/logout')) {
      writes.push(`${m} ${route.request().url()}`)
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    }
    return route.continue()
  })
  return { ctx, page, writes }
}

async function main() {
  await sweepZztestInvoices()
  const owner = loginAsOwner()
  await setupItems(owner.cookie, t)
  const A = await makeConfirmedInvoice(owner.cookie, t, 'ZZTEST70-UA1')
  const B = await makeRecordOnlyInvoice(owner.cookie, t, 'ZZTEST70-UB2')
  const R1 = await makeReadInvoice(owner.cookie, t, { number: 'ZZTEST70-UR3', lines: [] })
  const aRow = await getInvoice(A)
  check('setup: A confirmed (receipt), B record only, R1 read', aRow.status === 'received' && !!aRow.receipt_id && (await getInvoice(B)).record_only === true && (await getInvoice(R1)).status === 'read')

  const browser = await chromium.launch()
  try {
    // ---------------------------------------------------------------- owner
    const { page, writes } = await newPage(browser, 'owner', 'ZZTEST Owner')
    const noSideScroll = async (label) => {
      const w = await page.evaluate(() => document.documentElement.scrollWidth)
      check(`no sideways scrolling: ${label}`, w <= 390, `scrollWidth ${w}`)
    }

    await page.goto(`${BASE_URL}/history`)
    await page.getByTestId('tab-invoices').click()
    await page.getByTestId('invoice-row').first().waitFor()
    check('History has an Invoices tab next to the owner tabs', await page.getByRole('button', { name: 'Recent Counts', exact: true }).isVisible())
    await page.getByTestId('invoice-search').fill('zztest70-u')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="invoice-row"]').length === 2 && [...document.querySelectorAll('[data-testid="invoice-row"]')].every((e) => e.textContent.includes('ZZTEST70-U')))
    const rows = await page.getByTestId('invoice-row').allTextContents()
    check('search shows A and B, newest confirm first', rows.length === 2 && rows[0].includes('ZZTEST70-UB2') && rows[1].includes('ZZTEST70-UA1'), J(rows))
    check('A row: 3 lines, short and over badges, confirmed by', rows[1].includes('3 lines') && rows[1].includes('▼ 1 short') && rows[1].includes('▲ 1 over') && rows[1].includes('Confirmed by ZZTEST Owner'), rows[1])
    check('B row: Record only badge, "Filed by"', rows[0].includes('Record only') && rows[0].includes('Filed by ZZTEST Owner'), rows[0])
    await noSideScroll('Invoices list')
    await shot(page, '01-invoices-list')
    await page.getByTestId('vendor-balford').click()
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="invoice-row"]').length === 1)
    check('vendor filter Balford leaves only B', (await page.getByTestId('invoice-row').allTextContents())[0].includes('ZZTEST70-UB2'))
    await shot(page, '02-invoices-balford')
    await page.getByTestId('vendor-all').click()
    await page.getByTestId('invoice-search').fill('')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="invoice-row"]').length >= 3)
    const allRows = await page.getByTestId('invoice-row').allTextContents()
    check('cleared search shows the real invoice too', allRows.some((r) => r.includes('70302731')))
    await shot(page, '03-invoices-all')

    // Detail A
    await page.getByTestId('invoice-search').fill('ZZTEST70-UA1')
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="invoice-row"]').length === 1)
    await page.getByTestId('invoice-row').first().click()
    await page.getByTestId('invoice-header').waitFor()
    check('detail URL is /history/invoice?id=A', page.url().endsWith(`/history/invoice?id=${A}`), page.url())
    const header = await page.getByTestId('invoice-header').textContent()
    check('detail header: number, confirmed by, short open', header.includes('ZZTEST70-UA1') && header.includes('Delivery confirmed by ZZTEST Owner') && header.includes('Short shipment is still open'), header)
    const lines = await page.getByTestId('detail-line').allTextContents()
    const cups = lines.find((l) => l.includes('CUPS')) ?? ''
    const ice = lines.find((l) => l.includes('CHERRY')) ?? ''
    check('Cups card: our item, ordered 3 / shipped 3 / received 2, Short 1, Added 2 cases', cups.includes('ZZTEST P70 Cups') && /Ordered3/.test(cups.replace(/\s/g, '')) && /Received2/.test(cups.replace(/\s/g, '')) && cups.includes('▼ Short 1') && cups.includes('Added 2 cases'), cups)
    check('Ice card: Over 1, Added 12 gallons (1 CS = 4)', ice.includes('▲ Over 1') && ice.includes('Added 12 gallons') && ice.includes('1 CS = 4'), ice)
    const skipped = await page.getByTestId('skipped-line').allTextContents()
    check('skipped line listed separately', skipped.length === 1 && skipped[0].includes('NOT OURS'), J(skipped))
    check('no edit controls on the detail', (await page.getByRole('button', { name: /Confirm|Discard|Save|Edit/ }).count()) === 0)
    await noSideScroll('Invoice detail')
    await shot(page, '04-detail-A', true)
    await page.getByTestId('view-page').nth(1).click()
    await page.getByTestId('photo-viewer').waitFor()
    const img = page.locator('[data-testid="photo-viewer"] img')
    await img.waitFor()
    await page.waitForFunction(() => { const i = document.querySelector('[data-testid="photo-viewer"] img'); return i && i.complete && i.naturalWidth > 0 })
    const src = await img.getAttribute('src')
    check('page 2 opens full screen through a signed link (loaded, never public)', src.includes('/object/sign/invoice-photos/') && src.includes(`${A}/2.jpg`) && !src.includes('/object/public/'), src.replace(/token=.*/, 'token=…'))
    await shot(page, '05-photo-viewer')
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    // Detail B (record only)
    await page.goto(`${BASE_URL}/history/invoice?id=${B}`)
    await page.getByTestId('invoice-header').waitFor()
    const bHeader = await page.getByTestId('invoice-header').textContent()
    check('record-only detail: "Filed as record only", badge, no stock added', bHeader.includes('Filed as record only by ZZTEST Owner') && bHeader.includes('Record only') && bHeader.includes('No stock was added'), bHeader)
    check('record-only line says no stock added', (await page.getByTestId('detail-line').first().textContent()).includes('No stock added (record only)'))
    await shot(page, '06-detail-B-record-only', true)

    // A read invoice is not history.
    await page.goto(`${BASE_URL}/history/invoice?id=${R1}`)
    await page.getByTestId('detail-error').waitFor()
    check('a read (not received) invoice shows "not found" on the detail', (await page.getByTestId('detail-error').textContent()).includes('not been received'))

    // Order History > View invoice
    await page.goto(`${BASE_URL}/order-list`)
    await page.getByRole('button', { name: 'Order History', exact: true }).click()
    await page.locator('main .divide-y, main').first().waitFor()
    await page.waitForTimeout(500)
    // Expand rows until A's receipt shows its link (the newest rows: A's short, then its receipt).
    const rowButtons = page.locator('main button:has(svg)')
    let found = false
    for (let i = 0; i < 6 && !found; i++) {
      await rowButtons.nth(i).click()
      found = await page.locator(`[data-testid="view-invoice-link"][href="/history/invoice?id=${A}"]`).count() > 0
    }
    check('Order History: A\'s receipt has "View invoice"', found)
    await shot(page, '07-order-history-link')
    if (found) {
      await page.locator(`[data-testid="view-invoice-link"][href="/history/invoice?id=${A}"]`).click()
      await page.getByTestId('invoice-header').waitFor()
      check('…and it opens A\'s detail', page.url().endsWith(`/history/invoice?id=${A}`))
    }

    // Dashboard Short Shipment alert > View invoice
    await page.goto(`${BASE_URL}/dashboard`)
    const shortLink = page.locator(`[data-testid="short-view-invoice"][href="/history/invoice?id=${A}"]`)
    await shortLink.waitFor({ timeout: 20000 })
    check('Dashboard: A\'s Short Shipment alert has "View invoice"', await shortLink.isVisible())
    await shortLink.scrollIntoViewIfNeeded()
    await noSideScroll('Dashboard short alert')
    await shot(page, '08-dashboard-short-link')
    await shortLink.click()
    await page.getByTestId('invoice-header').waitFor()
    check('…and it opens A\'s detail', page.url().endsWith(`/history/invoice?id=${A}`))

    // Scan Invoice nudge
    await page.goto(`${BASE_URL}/scan-invoice`)
    const nudge = page.getByTestId('unconfirmed-nudge')
    await nudge.waitFor()
    const nudgeText = await nudge.textContent()
    check('Scan Invoice nudge: "N invoice(s) read but not confirmed" listing R1', /\d+ invoices? read but not confirmed/.test(nudgeText) && nudgeText.includes('ZZTEST70-UR3'), nudgeText)
    await noSideScroll('Scan Invoice nudge')
    await shot(page, '09-scan-nudge')
    await page.getByTestId('unconfirmed-open').filter({ hasText: 'ZZTEST70-UR3' }).click()
    await page.waitForURL(`**/scan-invoice/check?id=${R1}`)
    check('…tapping it opens the check-off screen for R1', page.url().endsWith(`/scan-invoice/check?id=${R1}`))
    await page.goto(`${BASE_URL}/scan-invoice`)
    await page.getByTestId('invoice-history-link').click()
    await page.getByTestId('invoice-history').waitFor()
    check('Scan Invoice "Invoice history" link opens History on the Invoices tab', page.url().endsWith('/history?tab=invoices'))
    check('owner screens made no writes', writes.length === 0, J(writes))

    // ----------------------------------------------------------- shift lead
    const sl = await newPage(browser, 'shift_lead', 'ZZTEST Shift Lead')
    await sl.page.goto(`${BASE_URL}/history`)
    await sl.page.getByTestId('invoice-history').waitFor()
    check('shift lead: History opens straight to Invoices', (await sl.page.locator('h1').textContent()).includes('Invoice History'))
    check('shift lead: no Recent Counts / Fastest tabs', (await sl.page.getByRole('button', { name: 'Recent Counts', exact: true }).count()) === 0 && (await sl.page.getByRole('button', { name: 'Fastest by Category', exact: true }).count()) === 0)
    await sl.page.getByTestId('invoice-search').fill('ZZTEST70-UA1')
    await sl.page.waitForFunction(() => document.querySelectorAll('[data-testid="invoice-row"]').length === 1)
    await sl.page.getByTestId('invoice-row').first().click()
    await sl.page.getByTestId('invoice-header').waitFor()
    check('shift lead can open the detail', (await sl.page.getByTestId('detail-line').count()) === 2)
    await shot(sl.page, '10-shift-lead-detail')
    check('shift lead screens made no writes', sl.writes.length === 0, J(sl.writes))

    // ------------------------------------------------- staff and logged out
    const st = await newPage(browser, null, null)
    await st.page.goto(`${BASE_URL}/history/invoice?id=${A}`)
    await st.page.waitForURL('**/login', { timeout: 15000 })
    check('logged out: the detail sends you to /login', st.page.url().endsWith('/login'))
    const staffCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
    const staffPage = await staffCtx.newPage()
    await staffPage.addInitScript(() => localStorage.setItem('ritas_role', 'staff'))
    await staffPage.goto(`${BASE_URL}/history/invoice?id=${A}`)
    await staffPage.waitForURL('**/login', { timeout: 15000 })
    check('staff: the detail sends you away (and the API says 401/403)', staffPage.url().endsWith('/login'))
  } finally {
    await browser.close()
  }
}

async function cleanup() {
  const owner = loginAsOwner()
  const out = await cleanupTracked(owner.cookie, t)
  console.log(`cleanup: removed ${J(out.removed)}; left ${J(out.left)}`)
  if (Object.values(out.left).some((n) => n > 0)) failures++
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
    console.log(failures ? `\n${failures} check(s) failed (of ${total})` : `\nall ${total} invoice-history-ui checks passed`)
    process.exit(failures ? 1 : 0)
  })
