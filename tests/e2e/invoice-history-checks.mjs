// Patch 70: invoice history (read-only) + nightly draft cleanup.
// NEVER calls the Anthropic API (reader results are written straight into
// raw_extraction) and never sends a push: run against `npm run dev` started
// with ANTHROPIC_API_KEY= and VAPID_PRIVATE_KEY= (both blank). This process
// blanks the push key too and runs the cleanup code directly.
//
// Covers: 401 / 403 on every GET mode; list paging (20 a page, no 50 cap,
// no repeats), search by invoice number, vendor filter; detail numbers
// (ordered / shipped / received, stock added, short / over, skipped) and
// signed photo links (never public, they load, the public URL does not);
// record only; receipt -> invoice links for Order History and the Short
// alert; the unconfirmed list for the Scan Invoice nudge; the cleanup:
// dry run deletes nothing, the error guards delete nothing, old unread
// drafts go (row + photos), young / read / read-but-not-confirmed /
// received / discarded invoices stay, the orphan sweep respects the 1-day
// age and never touches a path a received invoice points at.
//
// SAFETY: every cleanup run here is limited to this suite's own ids
// (onlyIds), so even with deletes switched on it can never touch a real
// draft or a real orphan folder. Received invoices are never deletable
// anyway; this suite checks that too.
process.env.VAPID_PRIVATE_KEY = ''

import { randomUUID } from 'node:crypto'
import { apiFetch, loginAsOwner, loginAsShiftLead, loginAsStaff } from './helpers/auth.mjs'
import { rest } from './helpers/rest.mjs'
import { TINY_JPEG, createDraftWithPages, getInvoice, listInvoicePhotos, sweepZztestInvoices } from './helpers/invoices.mjs'
import {
  cleanupTracked, listFolder, makeConfirmedInvoice, makeReadInvoice, makeRecordOnlyInvoice, newTracker, putBucketFile, setupItems,
} from './helpers/invoice-history.mjs'
import { cleanupInvoiceDrafts } from '../../src/lib/invoice-cleanup-server.ts'

let failures = 0
let total = 0
function check(name, cond, detail = '') {
  total++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -- ${detail}` : ''}`)
  if (!cond) failures++
}
const J = (x) => JSON.stringify(x)
const t = newTracker()
const DAY = 24 * 60 * 60 * 1000
const H = (q, cookie) => apiFetch(`/api/invoices/history${q}`, cookie)

function chainResolving(value) {
  const p = new Proxy(function () {}, {
    get: (_, prop) => (prop === 'then' ? (res) => res(value) : () => p),
    apply: () => p,
  })
  return p
}
// A client whose invoices table (or storage list) answers with what we say.
function wrapDb(real, { invoices, storageList } = {}) {
  return new Proxy(real, {
    get(target, prop) {
      if (prop === 'from') return (table) => (table === 'invoices' && invoices ? chainResolving(invoices) : target.from(table))
      if (prop === 'storage' && storageList) {
        return { from: () => ({ list: async () => storageList, remove: async () => ({ error: { message: 'must not be called' } }) }) }
      }
      const v = target[prop]
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
}

async function main() {
  await sweepZztestInvoices()
  const owner = loginAsOwner()
  const lead = loginAsShiftLead()
  const staff = await loginAsStaff()

  await setupItems(owner.cookie, t)
  check('setup: 2 ZZTEST items', Object.values(t.itemIds).every(Boolean))

  // ---- Fixtures ----
  const A = await makeConfirmedInvoice(owner.cookie, t, 'ZZTEST70-A100')
  const B = await makeRecordOnlyInvoice(owner.cookie, t, 'ZZTEST70-B200')
  const R1 = await makeReadInvoice(owner.cookie, t, { number: 'ZZTEST70-R300', lines: [] })
  const aRow = await getInvoice(A)
  const bRow = await getInvoice(B)
  check('setup: A received with a receipt, B record only with none', aRow.status === 'received' && !!aRow.receipt_id && bRow.status === 'received' && bRow.record_only === true && !bRow.receipt_id, J({ a: aRow.status, b: bRow.status }))
  const shortRows = await rest(`order_history?related_order_id=eq.${aRow.receipt_id}&type=eq.short&select=id,resolved,order_history_items(item_name,quantity)`)
  check('setup: A made one unresolved short (Cups 1)', shortRows.length === 1 && shortRows[0].resolved === false && shortRows[0].order_history_items[0]?.quantity === 1, J(shortRows))

  // 23 received rows straight in, newest first by received_at: paging.
  // created_at is set in the past so they don't count toward the app-wide
  // 20-scans-in-15-minutes limit (isInvoiceScanRateLimited).
  const now = Date.now()
  const bulk = []
  for (let n = 0; n < 23; n++) {
    bulk.push({
      vendor: n % 3 === 0 ? 'balford' : 'bunzl',
      invoice_number: `ZZTEST70-P${String(n).padStart(2, '0')}`,
      status: 'received',
      created_by: 'ZZTEST Owner',
      received_by: 'ZZTEST Owner',
      received_at: new Date(now - (n + 10) * 60000).toISOString(),
      invoice_date: '2026-11-01',
      record_only: true,
      created_at: new Date(now - 30 * DAY).toISOString(),
    })
  }
  const inserted = await rest('invoices', { method: 'POST', body: J(bulk) })
  for (const r of inserted) t.invoiceIds.push(r.id)
  check('setup: 23 bulk received rows', inserted.length === 23)

  // =========================================================================
  // 1. Roles: 401 logged out, 403 staff, 200 shift lead, on every GET mode
  // =========================================================================
  const modes = ['', `?id=${A}`, `?receipt_ids=${aRow.receipt_id}`, '?unconfirmed=1']
  for (const m of modes) {
    const r0 = await H(m, null)
    check(`GET history${m || ' (list)'}, no session -> 401`, r0.status === 401, `got ${r0.status}`)
    const r1 = await H(m, staff.cookie)
    check(`GET history${m || ' (list)'}, staff -> 403`, r1.status === 403, `got ${r1.status}`)
    const r2 = await H(m, lead.cookie)
    check(`GET history${m || ' (list)'}, shift lead -> 200`, r2.status === 200, `got ${r2.status}`)
  }
  for (const m of ['POST', 'PATCH', 'DELETE']) {
    const r = await apiFetch('/api/invoices/history', owner.cookie, { method: m, body: '{}' })
    check(`${m} history -> 405 (read-only route)`, r.status === 405, `got ${r.status}`)
  }

  // =========================================================================
  // 2. List: paging, search, vendor filter
  // =========================================================================
  let r = await H('?q=ZZTEST70-P', owner.cookie)
  let b = await r.json()
  check('search ZZTEST70-P page 0: 20 rows, has_more', r.ok && b.invoices.length === 20 && b.has_more === true, J({ n: b.invoices?.length, more: b.has_more }))
  const p0 = b.invoices.map((x) => x.invoice_number)
  check('page 0 is newest first (P00..P19)', J(p0) === J(Array.from({ length: 20 }, (_, i) => `ZZTEST70-P${String(i).padStart(2, '0')}`)), J(p0))
  r = await H('?q=ZZTEST70-P&page=1', owner.cookie)
  b = await r.json()
  const p1 = b.invoices.map((x) => x.invoice_number)
  check('page 1: the last 3, no more pages', r.ok && J(p1) === J(['ZZTEST70-P20', 'ZZTEST70-P21', 'ZZTEST70-P22']) && b.has_more === false, J({ p1, more: b.has_more }))
  check('no row repeats across pages', new Set([...p0, ...p1]).size === 23)
  r = await H('?q=zztest70-p&vendor=balford', owner.cookie)
  b = await r.json()
  check('search is case-insensitive + vendor filter balford: 8 rows, all balford', r.ok && b.invoices.length === 8 && b.invoices.every((x) => x.vendor === 'balford'), J(b.invoices?.map((x) => x.invoice_number)))
  r = await H('?q=ZZTEST70-P&vendor=bunzl', owner.cookie)
  b = await r.json()
  check('vendor bunzl: 15 rows, all bunzl', r.ok && b.invoices.length === 15 && b.invoices.every((x) => x.vendor === 'bunzl'))
  r = await H('?q=ZZTEST70-A100', owner.cookie)
  b = await r.json()
  check('search an exact number finds just A', r.ok && b.invoices.length === 1 && b.invoices[0].id === A)
  r = await H('?q=ZZTEST70-R300', owner.cookie)
  b = await r.json()
  check('a read (not received) invoice is not in history', r.ok && b.invoices.length === 0)
  r = await H('?q=%25%2C*_', owner.cookie)
  check('pattern characters in search are dropped, not an error', r.ok)
  r = await H('?vendor=sysco', owner.cookie)
  check('bad vendor -> 400', r.status === 400)
  r = await H('?page=-1', owner.cookie)
  check('bad page -> 400', r.status === 400)

  // Whole list, every page: more than 20 rows, nothing capped at 50 or 20.
  let all = []
  for (let page = 0; page < 100; page++) {
    const x = await (await H(`?page=${page}`, owner.cookie)).json()
    all = all.concat(x.invoices)
    if (!x.has_more) break
  }
  const allIds = all.map((x) => x.id)
  check('unfiltered paging reaches every received invoice (26+ incl. the real one), no repeats', all.length >= 26 && new Set(allIds).size === allIds.length && allIds.includes(A) && allIds.includes(B), `got ${all.length}`)
  const real = all.find((x) => x.invoice_number === '70302731')
  check('the real Bunzl invoice shows in the list (read-only)', !!real && real.line_count === 18, J(real))
  const sorted = all.every((x, i) => i === 0 || (all[i - 1].received_at ?? '') >= (x.received_at ?? ''))
  check('unfiltered list is newest confirm first', sorted)

  const aList = all.find((x) => x.id === A)
  const bList = all.find((x) => x.id === B)
  check('A in list: 3 lines, 1 skipped, 1 short, 1 over, not record only, confirmed by ZZTEST Owner',
    aList.line_count === 3 && aList.skipped_count === 1 && aList.short_count === 1 && aList.over_count === 1 && aList.record_only === false && aList.received_by === 'ZZTEST Owner' && aList.page_count === 2, J(aList))
  check('B in list: record only, balford, no shorts', bList.record_only === true && bList.vendor === 'balford' && bList.short_count === 0 && bList.over_count === 0, J(bList))

  // =========================================================================
  // 3. Detail
  // =========================================================================
  r = await H(`?id=${A}`, lead.cookie)
  const d = await r.json()
  const cups = d.lines?.find((l) => l.description.includes('CUPS'))
  const ice = d.lines?.find((l) => l.description.includes('CHERRY'))
  const skip = d.lines?.find((l) => l.description.includes('NOT OURS'))
  check('detail A: header (number, vendor, confirmed by, receipt)', r.ok && d.invoice.invoice_number === 'ZZTEST70-A100' && d.invoice.vendor === 'bunzl' && d.invoice.received_by === 'ZZTEST Owner' && d.invoice.receipt_id === aRow.receipt_id && d.receipt?.id === aRow.receipt_id, J(d.invoice))
  check('detail A: Cups ordered 3 / shipped 3 / received 2, short, +2 cases, matched by code',
    cups && cups.qty_ordered === 3 && cups.qty_shipped === 3 && cups.qty_received === 2 && cups.diff === 'short' && cups.stock_qty_added === 2 && cups.item?.name === 'ZZTEST P70 Cups' && cups.match_method === 'vendor_code', J(cups))
  check('detail A: Ice shipped 2 / received 3, over, +12 gallons (1 CS = 4)',
    ice && ice.qty_shipped === 2 && ice.qty_received === 3 && ice.diff === 'over' && ice.stock_qty_added === 12 && ice.units_per_invoice_unit === 4 && ice.item?.unit === 'gallons', J(ice))
  check('detail A: skipped line listed, no item, no stock, no badge', skip && skip.match_method === 'skipped' && !skip.item && !skip.stock_qty_added && skip.diff === null, J(skip))
  check('detail A: the short is linked and still open', d.short && d.short.id === shortRows[0].id && d.short.resolved === false, J(d.short))
  check('detail A: 2 pages, signed links only', d.pages?.length === 2 && d.pages.every((p) => p.url && p.url.includes('/object/sign/invoice-photos/') && !p.url.includes('/object/public/')), J(d.pages?.map((p) => p.url?.replace(/token=.*/, 'token=…'))))
  const img = await fetch(d.pages[0].url)
  check('signed link loads the photo (200, image)', img.status === 200 && (img.headers.get('content-type') ?? '').startsWith('image/'), `${img.status} ${img.headers.get('content-type')}`)
  const pub = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/invoice-photos/${A}/1.jpg`)
  check('the public URL does NOT work (bucket still private)', pub.status >= 400, `got ${pub.status}`)
  check('detail never returns raw_extraction or photo paths', !('raw_extraction' in d.invoice) && !('photo_paths' in d.invoice))

  r = await H(`?id=${B}`, owner.cookie)
  const db2 = await r.json()
  check('detail B: record only, no receipt, no short, line kept, no stock added',
    r.ok && db2.invoice.record_only === true && db2.invoice.receipt_id === null && db2.receipt === null && db2.short === null && db2.lines.length === 1 && db2.lines[0].stock_qty_added == null && db2.pages.length === 1, J(db2.invoice))
  r = await H(`?id=${R1}`, owner.cookie)
  check('detail of a read (not received) invoice -> 404', r.status === 404, `got ${r.status}`)
  r = await H('?id=not-a-uuid', owner.cookie)
  check('detail bad id -> 400', r.status === 400)
  r = await H(`?id=${randomUUID()}`, owner.cookie)
  check('detail unknown id -> 404', r.status === 404)

  // =========================================================================
  // 4. Links (Order History receipts, Short alert) + unconfirmed nudge
  // =========================================================================
  r = await H(`?receipt_ids=${aRow.receipt_id},${shortRows[0].id},${randomUUID()},junk`, owner.cookie)
  b = await r.json()
  check('receipt_ids: A\'s receipt -> A; a short id or unknown id -> nothing', r.ok && b.links[aRow.receipt_id] === A && Object.keys(b.links).length === 1, J(b))
  // The Short alert uses the short's related_order_id, which is A's receipt.
  const shortFull = await rest(`order_history?id=eq.${shortRows[0].id}&select=related_order_id`)
  check('the short points at A\'s receipt, so the Short alert links to A', shortFull[0].related_order_id === aRow.receipt_id)
  const hist = await (await apiFetch('/api/order-history', owner.cookie)).json()
  check('A\'s receipt is in Order History\'s 50 rows (where the link shows)', hist.some((o) => o.id === aRow.receipt_id))
  r = await H(`?receipt_ids=${Array.from({ length: 101 }, () => randomUUID()).join(',')}`, owner.cookie)
  check('receipt_ids over 100 -> 400', r.status === 400)
  r = await H('?unconfirmed=1', lead.cookie)
  b = await r.json()
  check('unconfirmed lists the read invoice, not received ones', r.ok && b.invoices.some((x) => x.id === R1) && !b.invoices.some((x) => x.id === A || x.id === B), J(b.invoices?.map((x) => x.invoice_number)))

  // =========================================================================
  // 5. Cleanup
  // =========================================================================
  const { getServerSupabase } = await import('../../src/lib/supabase.ts')
  const realDb = getServerSupabase()

  // D1 unread draft, 8 days old (photos)        -> deleted
  // D2 unread draft, 2 days old                 -> kept (too young)
  // D3 draft with a read attempt, 8 days old    -> kept (was read)
  // R1 read, not confirmed, made 30 days old    -> kept (holds the check-off)
  // DS discarded, 30 days old                   -> kept (read-cap ledger)
  // A, B received, made 30 days old             -> kept, photos too
  // O1 orphan folder (no row)                   -> deleted only once 1 day old
  // O2 orphan-looking folder a received invoice points at -> never
  const D1 = (await createDraftWithPages(owner.cookie, 'bunzl', [TINY_JPEG, TINY_JPEG])).id
  const D2 = (await createDraftWithPages(owner.cookie, 'bunzl', [TINY_JPEG])).id
  const D3 = (await createDraftWithPages(owner.cookie, 'bunzl', [TINY_JPEG])).id
  const DS = (await createDraftWithPages(owner.cookie, 'bunzl', [TINY_JPEG])).id
  t.invoiceIds.push(D1, D2, D3, DS)
  const ago = (days) => new Date(Date.now() - days * DAY).toISOString()
  await rest(`invoices?id=eq.${D1}`, { method: 'PATCH', body: J({ created_at: ago(8) }) })
  await rest(`invoices?id=eq.${D2}`, { method: 'PATCH', body: J({ created_at: ago(2) }) })
  await rest(`invoices?id=eq.${D3}`, { method: 'PATCH', body: J({ created_at: ago(8), raw_extraction: { rev: 1, pages: {}, attempts: [{ page: 1, at: ago(8), model: 'x', outcome: 'error' }] } }) })
  await rest(`invoices?id=eq.${DS}`, { method: 'PATCH', body: J({ created_at: ago(30), status: 'discarded', raw_extraction: { rev: 1, pages: {}, attempts: [{ page: 1, at: ago(30), model: 'x', outcome: 'error' }] } }) })
  for (const id of [R1, A, B]) await rest(`invoices?id=eq.${id}`, { method: 'PATCH', body: J({ created_at: ago(30) }) })
  const O1 = randomUUID()
  const O2 = randomUUID()
  t.orphanFolders.push(O1, O2)
  await putBucketFile(O1, '1.jpg')
  await putBucketFile(O1, '2.jpg')
  await putBucketFile(O2, '1.jpg')
  // A received invoice row pointing at O2's file (its own folder is its id; O2 has no row).
  const [rcv] = await rest('invoices', { method: 'POST', body: J({ vendor: 'other', invoice_number: 'ZZTEST70-O2', status: 'received', record_only: true, created_by: 'ZZTEST Owner', received_at: new Date().toISOString(), photo_paths: [`${O2}/1.jpg`] }) })
  t.invoiceIds.push(rcv.id)

  const ours = new Set([D1, D2, D3, DS, R1, A, B, rcv.id, O1, O2])
  const state = async () => ({
    rows: Object.fromEntries(await Promise.all([D1, D2, D3, DS, R1, A, B].map(async (id) => [id, (await getInvoice(id))?.status ?? null]))),
    photos: Object.fromEntries(await Promise.all([D1, D2, D3, R1, A, B].map(async (id) => [id, (await listInvoicePhotos(id)).length]))),
    o1: (await listFolder(O1)).length,
    o2: (await listFolder(O2)).length,
  })
  const start = await state()
  check('cleanup setup: every fixture row and photo exists', Object.values(start.rows).every(Boolean) && start.photos[D1] === 2 && start.photos[A] === 2 && start.o1 === 2 && start.o2 === 1, J(start))

  // 5a. Dry run (flag unset), clock 2 days ahead so the orphan is old enough.
  delete process.env.INVOICE_DRAFT_CLEANUP_ENABLE_DELETE
  let res = await cleanupInvoiceDrafts(realDb, { now: Date.now() + 2 * DAY, onlyIds: ours })
  check('dry run: reports D1 (and only D1) as an old unread draft', res.dryRun === true && !res.abortedReason && J(res.unreadDrafts.map((x) => x.id)) === J([D1]) && res.unreadDrafts[0].photo_count === 2, J(res.unreadDrafts))
  check('dry run: reports O1\'s 2 files, holds back O2 (received path)', res.orphanFilesEligible === 2 && res.skippedReceivedPaths === 1 && res.orphanFolders.some((f) => f.folder === O1 && f.eligible_files === 2), J({ e: res.orphanFilesEligible, s: res.skippedReceivedPaths }))
  check('dry run: counts read-not-confirmed and received as kept', res.readNotConfirmed >= 1 && res.receivedKept >= 3)
  check('dry run: deleted nothing', res.deletedDrafts === 0 && res.deletedOrphanFiles === 0 && J(await state()) === J(start))
  process.env.INVOICE_DRAFT_CLEANUP_ENABLE_DELETE = 'true'
  res = await cleanupInvoiceDrafts(realDb, { now: Date.now() + 2 * DAY, onlyIds: ours })
  check('a flag other than exactly "1" stays a dry run', res.dryRun === true && J(await state()) === J(start))

  // 5b. Error guards, with deletes ON: nothing may be deleted.
  process.env.INVOICE_DRAFT_CLEANUP_ENABLE_DELETE = '1'
  res = await cleanupInvoiceDrafts(wrapDb(realDb, { invoices: { data: null, error: { message: 'forced (test)' } } }), { now: Date.now() + 2 * DAY, onlyIds: ours })
  check('guard: invoices lookup errors -> aborted, nothing deleted', !!res.abortedReason && res.deletedDrafts === 0 && res.deletedOrphanFiles === 0 && J(await state()) === J(start), res.abortedReason)
  res = await cleanupInvoiceDrafts(wrapDb(realDb, { invoices: { data: [], error: null } }), { now: Date.now() + 2 * DAY, onlyIds: ours })
  check('guard: invoices empty while the bucket has folders -> aborted, nothing deleted', !!res.abortedReason && /empty/.test(res.abortedReason) && J(await state()) === J(start), res.abortedReason)
  res = await cleanupInvoiceDrafts(wrapDb(realDb, { storageList: { data: null, error: { message: 'forced (test)' } } }), { now: Date.now() + 2 * DAY, onlyIds: ours })
  check('guard: bucket list errors -> aborted, nothing deleted', !!res.abortedReason && J(await state()) === J(start), res.abortedReason)

  // 5c. Deletes ON, real clock: D1 goes; O1 is too new (uploaded seconds ago).
  res = await cleanupInvoiceDrafts(realDb, { onlyIds: ours })
  let after = await state()
  check('enabled: D1 row and both photos deleted', res.dryRun === false && res.deletedDrafts === 1 && res.deletedDraftPhotos === 2 && after.rows[D1] === null && after.photos[D1] === 0, J({ res: { d: res.deletedDrafts, p: res.deletedDraftPhotos, e: res.errors }, after }))
  check('enabled: D2 (young), D3 (was read), DS (discarded), R1 (read), A and B (received) all kept with photos',
    after.rows[D2] === 'draft' && after.rows[D3] === 'draft' && after.rows[DS] === 'discarded' && after.rows[R1] === 'read' && after.rows[A] === 'received' && after.rows[B] === 'received' &&
    after.photos[D2] === 1 && after.photos[D3] === 1 && after.photos[R1] === 1 && after.photos[A] === 2 && after.photos[B] === 1, J(after))
  check('enabled, real clock: orphan O1 too new (under 1 day), kept', res.orphanFilesEligible === 0 && res.orphanFilesTooNew >= 2 && after.o1 === 2, J({ e: res.orphanFilesEligible, n: res.orphanFilesTooNew }))

  // 5d. Clock 2 days ahead: O1 goes, O2 (a received invoice's path) stays.
  // Even 40 days ahead, received / read / discarded rows stay.
  res = await cleanupInvoiceDrafts(realDb, { now: Date.now() + 40 * DAY, onlyIds: ours })
  after = await state()
  check('enabled, clock ahead: O1\'s 2 orphan files deleted', res.deletedOrphanFiles === 2 && after.o1 === 0, J({ d: res.deletedOrphanFiles, e: res.errors }))
  check('enabled, clock ahead: O2 kept (a received invoice points at it)', after.o2 === 1 && res.skippedReceivedPaths === 1)
  check('enabled, clock 40 days ahead: D2 now old enough and deleted; D3 / DS / R1 / A / B still kept',
    after.rows[D2] === null && after.rows[D3] === 'draft' && after.rows[DS] === 'discarded' && after.rows[R1] === 'read' && after.rows[A] === 'received' && after.rows[B] === 'received' && after.photos[A] === 2 && after.photos[R1] === 1, J(after))
  // A received invoice can never be a cleanup candidate even when its folder is in scope.
  check('received A was never listed as a draft or orphan', !res.unreadDrafts.some((x) => x.id === A) && !res.orphanFolders.some((f) => f.folder === A))
  delete process.env.INVOICE_DRAFT_CLEANUP_ENABLE_DELETE
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
    delete process.env.INVOICE_DRAFT_CLEANUP_ENABLE_DELETE
    await cleanup().catch((err) => {
      console.error('FAIL  cleanup crashed:', err?.message ?? err)
      failures++
    })
    console.log(failures ? `\n${failures} check(s) failed (of ${total})` : `\nall ${total} invoice-history checks passed`)
    process.exit(failures ? 1 : 0)
  })
