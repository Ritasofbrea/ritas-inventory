// Patch 68a: invoice lines, matching, check-off saves, discard. NEVER calls
// the Anthropic API: reader results are written straight into
// invoices.raw_extraction (shaped like the patch 65 experiment output).
// Run against `npm run dev` started with ANTHROPIC_API_KEY= (blank).
// Fixtures: ZZTEST P68 items + ZZTEST-created invoices, removed by id.
import { apiFetch, loginAsOwner, loginAsShiftLead, loginAsStaff } from './helpers/auth.mjs'
import { rest } from './helpers/rest.mjs'
import { TINY_JPEG, createDraftWithPages, deleteInvoiceById, getInvoice, listInvoicePhotos, sweepZztestInvoices } from './helpers/invoices.mjs'

let failures = 0
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -- ${detail}` : ''}`)
  if (!cond) failures++
}

const itemIds = {}
const invoiceIds = []

const ITEMS = {
  cherry: { name: 'ZZTEST P68 Cherry Mix', category: 'Ice Mix', unit: 'gallons', distributor: 'bunzl', item_number: '9101', code: 'ZZ680001', case: 4 },
  spoons: { name: 'ZZTEST P68 Spoons', category: 'Containers & Cups', unit: 'sleeves', distributor: 'bunzl', item_number: '9102', code: null, case: null },
  sharedA: { name: 'ZZTEST P68 Cookie Box A', category: 'Containers & Cups', unit: 'cases', distributor: 'bunzl', item_number: '9103', code: 'ZZ68SHARE', case: null },
  sharedB: { name: 'ZZTEST P68 Cookie Box B', category: 'Containers & Cups', unit: 'cases', distributor: 'bunzl', item_number: '9104', code: 'ZZ68SHARE', case: null },
  lids: { name: 'ZZTEST P68 Lids', category: 'Containers & Cups', unit: 'boxes', distributor: 'bunzl', item_number: '9105', code: 'ZZ680005', case: null },
  cups: { name: 'ZZTEST P68 Cups', category: 'Containers & Cups', unit: 'boxes', distributor: 'bunzl', item_number: '9106', code: 'ZZ680006', case: null },
  jacket: { name: 'ZZTEST P68 Waffle Jacket', category: 'Containers & Cups', unit: 'cases', distributor: 'bunzl', item_number: null, code: null, case: null },
  custard: { name: 'ZZTEST P68 Custard', category: 'Custard', unit: 'bags', distributor: 'balford', item_number: '9446', code: null, case: 2 },
}

const L = (vendor_code, item_number, description, ordered, shipped, extra = {}) => ({
  vendor_code, item_number, description, invoice_unit: 'CS', qty_ordered: ordered, qty_shipped: shipped, unsure: false, note: null, ...extra,
})
const T = (over = {}) => ({ total_ordered: null, total_shipped: null, total_units: null, total_cases: null, dollar_total: null, note: null, ...over })
const pageEntry = (result) => ({ model: 'claude-opus-5-5', read_at: new Date().toISOString(), ms: 12000, usage: { input_tokens: 6800, output_tokens: 1200 }, result })
const result = (over) => ({ vendor: 'bunzl', invoice_number: 'ZZ70282859', invoice_date: '10/30/26', page_number: 1, page_count: 2, has_no_items: false, lines: [], printed_totals: T(), page_notes: null, ...over })

async function setReadState(id, pages) {
  const now = new Date().toISOString()
  await rest(`invoices?id=eq.${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'read',
      read_model: 'claude-opus-5-5',
      raw_extraction: {
        model: 'claude-opus-5-5', rev: 3, last_attempt_at: now,
        pages: Object.fromEntries(Object.entries(pages).map(([k, r]) => [k, pageEntry(r)])),
        attempts: Object.keys(pages).map((k) => ({ page: Number(k), at: now, model: 'claude-opus-5-5', outcome: 'ok' })),
      },
    }),
  })
}

const linesUrl = (id) => `/api/invoices/lines?invoice_id=${id}`

async function main() {
  await sweepZztestInvoices()
  const owner = loginAsOwner()
  const lead = loginAsShiftLead()
  const staff = await loginAsStaff()

  // Guard: our made-up codes / numbers must not exist on any real item.
  const clash = await rest(`items?or=(item_number.in.(9101,9102,9103,9104,9105,9106,9446),vendor_item_code.in.(ZZ680001,ZZ68SHARE,ZZ680005,ZZ680006))&name=not.ilike.zztest*&select=name`)
  check('no real item uses the test codes/numbers', clash.length === 0, JSON.stringify(clash))

  // ---------- items ----------
  for (const [k, it] of Object.entries(ITEMS)) {
    const res = await apiFetch('/api/items', owner.cookie, { method: 'POST', body: JSON.stringify({ name: it.name, category: it.category, unit: it.unit }) })
    const created = await res.json()
    itemIds[k] = created.id
    await rest(`items?id=eq.${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ distributor: it.distributor, item_number: it.item_number, vendor_item_code: it.code, invoice_units_per_case: it.case }),
    })
  }
  check('setup: 8 ZZTEST items', Object.values(itemIds).every(Boolean))

  // ---------- a 2-page Bunzl invoice, read ----------
  const inv = await createDraftWithPages(owner.cookie, 'bunzl', [TINY_JPEG, TINY_JPEG])
  invoiceIds.push(inv.id)
  await setReadState(inv.id, {
    1: result({
      page_number: 1,
      lines: [
        L('ZZ680001', '9101', 'ZZTEST CHERRY MIX 1-GAL', 1, 1), // code match
        L('ZZ68NOCODE', '9102', 'ZZTEST SODA SPOON WHITE', 2, 0), // item-number match, short shipped
        L('ZZ68SHARE', null, 'ZZTEST 6-CT COOKIE CONTAINER', 1, 1), // shared code -> forced pick
        L('ZZ680005', '9106', 'ZZTEST DOME LID 8OZ', 1, 1, { unsure: true, note: 'First character faint' }), // code vs number conflict
      ],
    }),
    2: result({
      page_number: 2,
      lines: [
        L(null, null, 'ZZTEST WAFFLE JACKET 10/16 REG', 1, 1), // description suggestion
        L('ZZ68NOPE', null, 'QQQ XYZZY PLUGH', 1, 1), // unmatched
      ],
      printed_totals: T({ total_ordered: 7, total_shipped: 5 }),
    }),
  })

  // roles
  let r = await apiFetch(linesUrl(inv.id), null)
  check('GET lines, no session -> 401', r.status === 401, `got ${r.status}`)
  r = await apiFetch(linesUrl(inv.id), staff.cookie)
  check('GET lines, staff -> 403', r.status === 403, `got ${r.status}`)
  r = await apiFetch('/api/invoices/lines', staff.cookie, { method: 'POST', body: JSON.stringify({ invoice_id: inv.id }) })
  check('POST lines, staff -> 403', r.status === 403)
  r = await apiFetch('/api/invoices/lines', null, { method: 'PATCH', body: JSON.stringify({ invoice_id: inv.id, updates: [] }) })
  check('PATCH lines, no session -> 401', r.status === 401)
  r = await apiFetch('/api/invoices', staff.cookie, { method: 'DELETE', body: JSON.stringify({ id: inv.id }) })
  check('DELETE (discard), staff -> 403', r.status === 403)

  // build (as a shift lead -- allowed)
  r = await apiFetch('/api/invoices/lines', lead.cookie, { method: 'POST', body: JSON.stringify({ invoice_id: inv.id }) })
  const built = await r.json()
  check('shift lead builds lines -> 6 lines', r.ok && built.built === 6, JSON.stringify(built))
  const row = await getInvoice(inv.id)
  check('invoice number and date filled from the reader', row.invoice_number === 'ZZ70282859' && row.invoice_date === '2026-10-30', `${row.invoice_number} ${row.invoice_date}`)

  let view = await (await apiFetch(linesUrl(inv.id), lead.cookie)).json()
  const byDesc = (d) => view.lines.find((l) => l.description.includes(d))
  let l = byDesc('CHERRY')
  check('code match -> vendor_code, Cherry Mix', l.match_method === 'vendor_code' && l.item?.id === itemIds.cherry)
  check('case size from the item: 1 CS = 4', l.case_size.size === 4 && l.case_size.source === 'item')
  l = byDesc('SODA SPOON')
  check('item-number match -> item_number, Spoons', l.match_method === 'item_number' && l.item?.id === itemIds.spoons)
  check('Spoons has no known case size', l.case_size.size === null && l.case_size.source === 'unknown')
  l = byDesc('COOKIE CONTAINER')
  check('shared code -> no pick, forced choice between both boxes',
    l.item === null && l.review_reason === 'shared_code' && l.needs_pick && l.candidates.map((c) => c.id).sort().join() === [itemIds.sharedA, itemIds.sharedB].sort().join(),
    JSON.stringify(l))
  l = byDesc('DOME LID')
  check('code vs printed number conflict -> needs a look with both items',
    l.item === null && l.review_reason === 'code_number_conflict' && l.candidates.some((c) => c.id === itemIds.lids) && l.candidates.some((c) => c.id === itemIds.cups),
    JSON.stringify(l))
  check("AI's unsure note kept on the line", l.ai_unsure === true && l.ai_note === 'First character faint')
  l = byDesc('WAFFLE JACKET')
  check('description suggestion offered, never auto-matched', l.item === null && l.match_method === 'none' && l.suggestions.some((s) => s.item.id === itemIds.jacket && s.why === 'description'), JSON.stringify(l.suggestions))
  l = byDesc('XYZZY')
  check('unmatched line stays unmatched with nothing suggested', l.item === null && l.needs_pick && l.suggestions.length === 0 && l.candidates.length === 0)
  check('totals: lines add up to the printed 5 shipped -> match', view.totals_check.status === 'match' && view.totals_check.lines_total === 5, JSON.stringify(view.totals_check))

  // picks, skip, case size, received, checked
  const id = (d) => byDesc(d).id
  const patch = (cookie, updates) => apiFetch('/api/invoices/lines', cookie, { method: 'PATCH', body: JSON.stringify({ invoice_id: inv.id, updates }) })
  r = await patch(lead.cookie, [
    { id: id('WAFFLE JACKET'), item_id: itemIds.jacket }, // accept suggestion
    { id: id('COOKIE CONTAINER'), item_id: itemIds.sharedB }, // forced pick
    { id: id('DOME LID'), item_id: itemIds.lids }, // resolve conflict
    { id: id('XYZZY'), skip: true }, // not ours
    { id: id('SODA SPOON'), units_per_invoice_unit: 12, qty_received: 0, checked: true }, // case size for this line only
    { id: id('CHERRY'), qty_received: 1, checked: true },
  ])
  check('save picks / skip / size / received (shift lead)', r.ok, await r.text())
  view = await (await apiFetch(linesUrl(inv.id), owner.cookie)).json()
  check('accepted suggestion -> manual', byDesc('WAFFLE JACKET').match_method === 'manual' && byDesc('WAFFLE JACKET').item.id === itemIds.jacket)
  check('forced pick saved -> manual, review cleared', byDesc('COOKIE CONTAINER').match_method === 'manual' && !byDesc('COOKIE CONTAINER').review_reason && !byDesc('COOKIE CONTAINER').needs_pick)
  check('skip -> skipped, no longer needs a pick', byDesc('XYZZY').match_method === 'skipped' && !byDesc('XYZZY').needs_pick)
  check('typed case size used for this line: 1 CS = 12', byDesc('SODA SPOON').case_size.size === 12 && byDesc('SODA SPOON').case_size.source === 'line')
  const spoonItem = (await rest(`items?id=eq.${itemIds.spoons}&select=invoice_units_per_case`))[0]
  check('...and NOT saved on the item', spoonItem.invoice_units_per_case === null)
  check('partial save then resume: 2 of 6 checked, received kept', view.checked_count === 2 && byDesc('CHERRY').qty_received === 1 && byDesc('SODA SPOON').qty_received === 0)
  check('updated_by recorded', byDesc('CHERRY').updated_by === 'ZZTEST Shift Lead')

  // bad input
  r = await patch(owner.cookie, [{ id: id('CHERRY'), qty_received: -1 }])
  check('negative received -> 400', r.status === 400)
  r = await patch(owner.cookie, [{ id: id('CHERRY'), units_per_invoice_unit: 0 }])
  check('case size 0 -> 400', r.status === 400)
  r = await patch(owner.cookie, [{ id: id('CHERRY'), skip: true, item_id: itemIds.cherry }])
  check('pick + skip together -> 400', r.status === 400)

  // reset a skip
  r = await patch(owner.cookie, [{ id: id('XYZZY'), reset_match: true }])
  view = await (await apiFetch(linesUrl(inv.id), owner.cookie)).json()
  check('reset_match undoes a skip', byDesc('XYZZY').match_method === 'none' && byDesc('XYZZY').needs_pick)

  // re-read / rebuild guard after check-off started
  r = await apiFetch('/api/invoices/read', owner.cookie, { method: 'POST', body: JSON.stringify({ invoice_id: inv.id, page: 1 }) })
  let body = await r.json()
  check('re-read of a page with entries -> 409 crew_entries (no API call)', r.status === 409 && body.code === 'crew_entries', JSON.stringify(body))
  r = await apiFetch('/api/invoices/lines', owner.cookie, { method: 'POST', body: JSON.stringify({ invoice_id: inv.id }) })
  body = await r.json()
  check('rebuild without confirm -> 409 naming the pages with entries', r.status === 409 && body.code === 'crew_entries' && body.pages.includes(1) && body.pages.includes(2), JSON.stringify(body))
  r = await apiFetch('/api/invoices/lines', owner.cookie, { method: 'POST', body: JSON.stringify({ invoice_id: inv.id, pages: [1], confirm_replace: true }) })
  view = await (await apiFetch(linesUrl(inv.id), owner.cookie)).json()
  check('confirmed rebuild of page 1 clears page 1 entries only',
    r.ok && byDesc('CHERRY').qty_received === null && !byDesc('CHERRY').checked && byDesc('WAFFLE JACKET').match_method === 'manual',
    JSON.stringify(view.lines.map((x) => [x.page, x.description, x.qty_received, x.match_method])))

  // ---------- Balford: suggestion by part number, totals mismatch ----------
  const bal = await createDraftWithPages(owner.cookie, 'balford', [TINY_JPEG])
  invoiceIds.push(bal.id)
  await setReadState(bal.id, {
    1: result({
      vendor: 'balford', invoice_number: 'ZZ24168404', invoice_date: '11/07/26', page_number: 1, page_count: null,
      lines: [L('309446', null, 'ZZTEST VANILLA CUSTARD MIX 2/2.5 GAL', 8, 8), L('ZZ68BAL2', null, 'QQQ PLUGH', 4, 4)],
      printed_totals: T({ total_units: 14 }),
    }),
  })
  await apiFetch('/api/invoices/lines', owner.cookie, { method: 'POST', body: JSON.stringify({ invoice_id: bal.id }) })
  const bview = await (await apiFetch(linesUrl(bal.id), owner.cookie)).json()
  const custard = bview.lines.find((x) => x.vendor_code === '309446')
  check('Balford part 309446 -> suggestion item #9446, not auto-matched',
    custard.item === null && custard.suggestions[0]?.item.id === itemIds.custard && custard.suggestions[0]?.why === 'balford_part', JSON.stringify(custard.suggestions))
  check('Balford items only: no Bunzl item suggested', custard.suggestions.every((s) => s.item.distributor === 'balford'))
  check('totals mismatch (12 vs 14) -> soft warning', bview.totals_check.status === 'mismatch' && !!bview.totals_check.warning)

  // ---------- discard ----------
  r = await apiFetch('/api/invoices', lead.cookie, { method: 'DELETE', body: JSON.stringify({ id: bal.id }) })
  body = await r.json()
  const brow = await getInvoice(bal.id)
  check("shift lead discards a READ invoice -> row kept as 'discarded'", r.ok && body.discarded && brow.status === 'discarded', JSON.stringify(body))
  check('...its lines are removed', (await rest(`invoice_lines?invoice_id=eq.${bal.id}&select=id`)).length === 0)
  check('...its photos are removed', (await listInvoicePhotos(bal.id)).length === 0)
  check('...its read attempts are kept', brow.raw_extraction?.attempts?.length === 1)
  const list = await (await apiFetch('/api/invoices', owner.cookie)).json()
  check('...and it is gone from the recent list', !list.some((x) => x.id === bal.id))
  check('recent list shows status and invoice number', list.find((x) => x.id === inv.id)?.status === 'read' && list.find((x) => x.id === inv.id)?.invoice_number === 'ZZ70282859')
  r = await apiFetch('/api/invoices/lines', owner.cookie, { method: 'PATCH', body: JSON.stringify({ invoice_id: bal.id, updates: [{ id: id('CHERRY'), checked: true }] }) })
  check('editing lines on a discarded invoice -> 409', r.status === 409)

  const rec = await createDraftWithPages(owner.cookie, 'bunzl', [TINY_JPEG])
  invoiceIds.push(rec.id)
  await rest(`invoices?id=eq.${rec.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'received' }) })
  r = await apiFetch('/api/invoices', owner.cookie, { method: 'DELETE', body: JSON.stringify({ id: rec.id }) })
  check('a RECEIVED invoice can never be discarded -> 409', r.status === 409 && (await getInvoice(rec.id)).status === 'received')

  // a line id from another invoice
  r = await apiFetch('/api/invoices/lines', owner.cookie, { method: 'PATCH', body: JSON.stringify({ invoice_id: rec.id, updates: [{ id: id('CHERRY'), checked: true }] }) })
  check('a line from another invoice is refused', r.status === 400 || r.status === 409, `got ${r.status}`)
}

async function cleanup() {
  const owner = loginAsOwner()
  let left = 0
  for (const id of invoiceIds) {
    const res = await deleteInvoiceById(id)
    if (res.photosLeft || res.rowLeft) left++
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
    console.log(failures ? `\n${failures} check(s) failed` : '\nall invoice-lines checks passed')
    process.exit(failures ? 1 : 0)
  })
