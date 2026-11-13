// Patch 69: confirm an invoice delivery (the first step that ADDS STOCK).
// NEVER calls the Anthropic API (reader results are written straight into
// raw_extraction) and NEVER sends a push: run it against `npm run dev`
// started with VAPID_PRIVATE_KEY= and ANTHROPIC_API_KEY= (both blank); the
// few checks that call the server code directly in this process blank the
// push key first and hide push_subscriptions from it.
//
// Covers: 401/403; blocked confirm (unmatched, unchecked, unknown case size,
// missing invoice number); short / over / exact / skipped lines; learn-once
// codes (saves, refuses on collision, never overwrites); owner-only case
// size remember; the EQUIVALENCE test (same delivery through Receive Order
// and through invoice confirm must leave the same stock, storage, rows and
// on-order status); duplicate guard (pre-check and the unique-index race);
// two simultaneous confirms add stock once; forced mid-way failures roll
// everything back and leave the invoice 'read'; record only adds nothing;
// read-only after confirm; discard works for read, refused for received.
//
// Fixtures: ZZTEST P69 items, ZZTEST-created invoices (numbers ZZTEST69-*),
// ZZTEST orders. Everything is removed by id at the end.
//
// SAFETY: related_order_id is always a ZZTEST order or null. The plan's
// pending_orders can list REAL orders; this suite never sends one.
process.env.VAPID_PRIVATE_KEY = ''

import { apiFetch, loginAsOwner, loginAsShiftLead, loginAsStaff } from './helpers/auth.mjs'
import { rest } from './helpers/rest.mjs'
import { TINY_JPEG, createDraftWithPages, deleteInvoiceById, getInvoice, listInvoicePhotos, sweepZztestInvoices } from './helpers/invoices.mjs'
import { usesBoxOrdering } from '../../src/lib/order-units.ts'
import { getPendingOrders } from '../../src/lib/order-status.ts'

let failures = 0
let total = 0
function check(name, cond, detail = '') {
  total++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  -- ${detail}` : ''}`)
  if (!cond) failures++
}
const J = (x) => JSON.stringify(x)

const PFX = 'ZZTEST P69'
const itemIds = {}
const invoiceIds = []
const orderIds = [] // every order_history row this suite made (orders, receipts, shorts)

// One fixture per kind of item the real catalog has.
const ITEMS = {
  ice: { name: `${PFX} Cherry Ice Mix`, category: 'Ice Mix', unit: 'gallons', code: 'ZZ690001', number: '9301', pack: 4, case: 4 },
  sugarfree: { name: `${PFX} Sugar Free Mix`, category: 'Ice Mix', unit: 'bottles', code: 'ZZ690002', number: '9302', pack: 6, case: 6 },
  syrup: { name: `${PFX} Syrup`, category: 'Syrups', unit: 'bottles', code: 'ZZ690003', number: '9303', pack: 2, case: 2 },
  // Custard: counted in boxes, 2 bags to a box. 1 CS = 1 box.
  custard: { name: `${PFX} Custard`, category: 'Custard', unit: 'boxes', code: 'ZZ690004', number: '9304', pack: null, case: null, secondary_unit: 'bags', units_per_sub_unit: 2 },
  regular: { name: `${PFX} Cups`, category: 'Containers & Cups', unit: 'cases', code: 'ZZ690005', number: '9305', pack: null, case: null },
  storA: { name: `${PFX} Storage Lids A`, category: 'Lids', unit: 'cases', code: 'ZZ690006', number: '9306', pack: null, case: null, has_storage: true },
  storB: { name: `${PFX} Storage Lids B`, category: 'Lids', unit: 'cases', code: 'ZZ690007', number: '9307', pack: null, case: null, has_storage: true },
  spoons: { name: `${PFX} Spoons`, category: 'Spoons & Straws', unit: 'sleeves', code: 'ZZ690008', number: '9308', pack: null, case: null },
  hand: { name: `${PFX} Hand Pick`, category: 'Toppings', unit: 'cases', code: null, number: null, pack: null, case: null },
  taken: { name: `${PFX} Code Owner`, category: 'Toppings', unit: 'cases', code: 'ZZ69TAKEN', number: '9310', pack: null, case: null },
  other2: { name: `${PFX} No Code Yet`, category: 'Toppings', unit: 'cases', code: null, number: null, pack: null, case: null },
  // distributor 'other': a hand pick on a Bunzl invoice still learns the code, with a warning
  offvendor: { name: `${PFX} Other Vendor Fudge`, category: 'Toppings', unit: 'cases', code: null, number: null, pack: null, case: null, distributor: 'other' },
}

const L = (vendor_code, item_number, description, ordered, shipped, extra = {}) => ({
  vendor_code, item_number, description, invoice_unit: 'CS', qty_ordered: ordered, qty_shipped: shipped, unsure: false, note: null, ...extra,
})
const T = () => ({ total_ordered: null, total_shipped: null, total_units: null, total_cases: null, dollar_total: null, note: null })

async function makeReadInvoice(cookie, number, lines) {
  const inv = await createDraftWithPages(cookie, 'bunzl', [TINY_JPEG])
  invoiceIds.push(inv.id)
  const now = new Date().toISOString()
  const result = { vendor: 'bunzl', invoice_number: number, invoice_date: '11/13/26', page_number: 1, page_count: 1, has_no_items: false, lines, printed_totals: T(), page_notes: null }
  await rest(`invoices?id=eq.${inv.id}`, {
    method: 'PATCH',
    body: J({
      status: 'read',
      read_model: 'claude-opus-5-5',
      raw_extraction: {
        model: 'claude-opus-5-5', rev: 3, last_attempt_at: now,
        pages: { 1: { model: 'claude-opus-5-5', read_at: now, ms: 12000, usage: { input_tokens: 6800, output_tokens: 1200 }, result } },
        attempts: [{ page: 1, at: now, model: 'claude-opus-5-5', outcome: 'ok' }],
      },
    }),
  })
  const r = await apiFetch('/api/invoices/lines', cookie, { method: 'POST', body: J({ invoice_id: inv.id }) })
  if (!r.ok) throw new Error(`build lines -> ${r.status} ${await r.text()}`)
  return inv.id
}

const view = async (id, cookie) => (await apiFetch(`/api/invoices/lines?invoice_id=${id}`, cookie)).json()
const plan = async (id, cookie) => (await apiFetch(`/api/invoices/confirm?invoice_id=${id}`, cookie)).json()
const patchLines = (id, cookie, updates) => apiFetch('/api/invoices/lines', cookie, { method: 'PATCH', body: J({ invoice_id: id, updates }) })
const confirm = (id, cookie, body = {}) => apiFetch('/api/invoices/confirm', cookie, { method: 'POST', body: J({ invoice_id: id, mode: 'confirm', ...body }) })
const recordOnly = (id, cookie) => apiFetch('/api/invoices/confirm', cookie, { method: 'POST', body: J({ invoice_id: id, mode: 'record_only' }) })
const setNumber = (id, cookie, n) => apiFetch('/api/invoices/confirm', cookie, { method: 'PATCH', body: J({ invoice_id: id, invoice_number: n }) })

// Checks every not-skipped line off as received = the given map (by a word in the description) or shipped.
async function checkOff(id, cookie, received = {}) {
  const v = await view(id, cookie)
  const updates = v.lines
    .filter((l) => l.match_method !== 'skipped')
    .map((l) => {
      const key = Object.keys(received).find((k) => l.description.includes(k))
      return { id: l.id, qty_received: key ? received[key] : l.qty_shipped, checked: true }
    })
  const r = await patchLines(id, cookie, updates)
  if (!r.ok) throw new Error(`check off -> ${r.status} ${await r.text()}`)
}

async function stock() {
  const ids = Object.values(itemIds).join(',')
  const rows = await rest(`items?id=in.(${ids})&select=id,current_count,storage_count,vendor_item_code,invoice_units_per_case`)
  const byKey = {}
  for (const [k, id] of Object.entries(itemIds)) {
    const r = rows.find((x) => x.id === id)
    byKey[k] = { store: Number(r.current_count), storage: Number(r.storage_count), code: r.vendor_item_code, size: r.invoice_units_per_case == null ? null : Number(r.invoice_units_per_case) }
  }
  return byKey
}
const delta = (before, after) => Object.fromEntries(Object.keys(before).map((k) => [k, { store: after[k].store - before[k].store, storage: after[k].storage - before[k].storage }]))
const nonZero = (d) => Object.fromEntries(Object.entries(d).filter(([, v]) => v.store !== 0 || v.storage !== 0))
const sameStock = (a, b) => J(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, [v.store, v.storage]]))) === J(Object.fromEntries(Object.entries(b).map(([k, v]) => [k, [v.store, v.storage]])))

const historyFor = async (ids) => (ids.length ? rest(`order_history?id=in.(${ids.join(',')})&select=*,order_history_items(item_id,item_name,quantity,unit)`) : [])
// Every order_history row that mentions one of our items (receipts, shorts, orders).
async function ourHistoryIds() {
  const rows = await rest(`order_history_items?item_name=ilike.${encodeURIComponent(`${PFX}*`)}&select=order_id`)
  return [...new Set(rows.map((r) => r.order_id))]
}
async function isPending(orderId) {
  const all = await rest('order_history?select=id,type,related_order_id,canceled_at&order=created_at.desc&limit=200')
  return getPendingOrders(all).some((o) => o.id === orderId)
}
async function makeOrder(cookie, lines) {
  const r = await apiFetch('/api/order-history', cookie, { method: 'POST', body: J({ type: 'ordered', vendor: 'bunzl', notes: 'ZZTEST P69 order', items: lines }) })
  if (!r.ok) throw new Error(`make order -> ${r.status} ${await r.text()}`)
  const o = await r.json()
  orderIds.push(o.id)
  return o.id
}
const storageMoves = async (itemId) => rest(`storage_moves?item_id=eq.${itemId}&select=kind,amount,by_name,store_before,store_after,storage_before,storage_after&order=created_at.asc`)

// ---------------------------------------------------------------------------
// A database client for calling the server code directly, that can be told to
// fail one specific write. Never lets the code see push_subscriptions.
// ---------------------------------------------------------------------------
function chainResolving(value) {
  const p = new Proxy(function () {}, {
    get: (_, prop) => (prop === 'then' ? (res) => res(value) : () => p),
    apply: () => p,
  })
  return p
}
function wrapDb(real, rule = () => null) {
  const counts = {}
  return new Proxy(real, {
    get(target, prop) {
      if (prop !== 'from') {
        const v = target[prop]
        return typeof v === 'function' ? v.bind(target) : v
      }
      return (table) => {
        if (table === 'push_subscriptions') return chainResolving({ data: [], error: null })
        const builder = target.from(table)
        return new Proxy(builder, {
          get(b, op) {
            const v = b[op]
            if (typeof v !== 'function') return v
            return (...args) => {
              const key = `${table}.${String(op)}`
              counts[key] = (counts[key] ?? 0) + 1
              const forced = rule(table, String(op), counts[key], args)
              if (forced) return chainResolving(forced)
              return v.apply(b, args)
            }
          },
        })
      }
    },
  })
}
const FORCED = { data: null, error: { message: 'forced failure (test)' } }

async function main() {
  await sweepZztestInvoices()
  const owner = loginAsOwner()
  const lead = loginAsShiftLead()
  const staff = await loginAsStaff()

  // Leftovers from a crashed run (history rows first, then the items).
  const stale = await ourHistoryIds()
  if (stale.length) await rest(`order_history?id=in.(${stale.join(',')})`, { method: 'DELETE' })
  const staleItems = await rest(`items?name=ilike.${encodeURIComponent(`${PFX}*`)}&select=id`)
  if (staleItems.length) {
    await rest(`storage_moves?item_id=in.(${staleItems.map((x) => x.id).join(',')})`, { method: 'DELETE' })
    await rest(`items?id=in.(${staleItems.map((x) => x.id).join(',')})`, { method: 'DELETE' })
  }

  const codes = Object.values(ITEMS).map((i) => i.code).filter(Boolean).concat(['ZZ69LEARN', 'ZZ69NEW', 'ZZ69OFF', 'ZZ69SIZE'])
  const numbers = Object.values(ITEMS).map((i) => i.number).filter(Boolean)
  const clash = await rest(`items?or=(item_number.in.(${numbers.join(',')}),vendor_item_code.in.(${codes.join(',')}))&name=not.ilike.zztest*&select=name`)
  check('no real item uses the test codes/numbers', clash.length === 0, J(clash))

  for (const [k, it] of Object.entries(ITEMS)) {
    const res = await apiFetch('/api/items', owner.cookie, {
      method: 'POST',
      body: J({ name: it.name, category: it.category, unit: it.unit, ...(it.secondary_unit ? { secondary_unit: it.secondary_unit, units_per_sub_unit: it.units_per_sub_unit } : {}) }),
    })
    const created = await res.json()
    itemIds[k] = created.id
    await rest(`items?id=eq.${created.id}`, {
      method: 'PATCH',
      body: J({ distributor: it.distributor ?? 'bunzl', item_number: it.number, vendor_item_code: it.code, pack_size: it.pack, invoice_units_per_case: it.case, has_storage: !!it.has_storage }),
    })
  }
  check(`setup: ${Object.keys(ITEMS).length} ZZTEST items`, Object.values(itemIds).every(Boolean))
  const start = await stock()

  // =========================================================================
  // 1. Roles
  // =========================================================================
  const i1 = await makeReadInvoice(owner.cookie, 'ZZTEST69-1001', [
    L('ZZ690001', '9301', 'ZZTEST EXACT ICE MIX', 2, 2), // exact: 2 CS x 4 = 8 gallons
    L('ZZ690002', '9302', 'ZZTEST SHORTLINE SUGAR FREE', 2, 2), // received 1 of 2 shipped: short 1 CS = 6 bottles
    L('ZZ690003', '9303', 'ZZTEST OVERLINE SYRUP', 1, 1), // received 2 of 1 shipped: over
    L('ZZ69LEARN', null, 'QQA HANDPICK THING', 1, 1), // unmatched -> hand pick -> code learned
    L('ZZ69TAKEN', '9310', 'ZZTEST REPICK CODE OWNER', 1, 1), // auto-matches Code Owner; crew re-picks No Code Yet -> collision, refused
    L('ZZ69NEW', null, 'QQB SECOND ICE LINE', 1, 1), // hand-picked onto the Ice Mix (which has a code) -> never overwritten
    L('ZZ690008', '9308', 'ZZTEST SPOONS UNKNOWN SIZE', 3, 3), // no case size known
    L('ZZ69NOPE', null, 'QQC NOT OURS', 4, 4), // skipped
    L('ZZ690006', '9306', 'ZZTEST STORAGE LIDS A', 1, 1), // has_storage; a shift lead can't route to storage
    L('ZZ69OFF', null, 'QQD FUDGE OTHER VENDOR', 1, 1), // hand pick of an item from another vendor
  ])

  let r = await apiFetch(`/api/invoices/confirm?invoice_id=${i1}`, null)
  check('GET plan, no session -> 401', r.status === 401, `got ${r.status}`)
  r = await apiFetch(`/api/invoices/confirm?invoice_id=${i1}`, staff.cookie)
  check('GET plan, staff -> 403', r.status === 403, `got ${r.status}`)
  r = await confirm(i1, null)
  check('POST confirm, no session -> 401', r.status === 401, `got ${r.status}`)
  r = await confirm(i1, staff.cookie)
  check('POST confirm, staff -> 403', r.status === 403, `got ${r.status}`)
  r = await recordOnly(i1, staff.cookie)
  check('POST record only, staff -> 403', r.status === 403, `got ${r.status}`)
  r = await setNumber(i1, null, 'X1')
  check('PATCH invoice number, no session -> 401', r.status === 401, `got ${r.status}`)
  r = await setNumber(i1, staff.cookie, 'X1')
  check('PATCH invoice number, staff -> 403', r.status === 403, `got ${r.status}`)
  check('...and the staff attempts changed nothing', (await getInvoice(i1)).status === 'read' && (await getInvoice(i1)).invoice_number === 'ZZTEST69-1001' && sameStock(start, await stock()))

  // =========================================================================
  // 2. Blocked confirm: says exactly which lines
  // =========================================================================
  let p = await plan(i1, lead.cookie)
  const kinds = (pl) => pl.blockers.map((b) => b.kind).sort().join(',')
  check('fresh invoice: 4 unmatched lines + 6 unchecked lines block it', p.blockers.filter((b) => b.kind === 'unmatched').length === 4 && p.blockers.filter((b) => b.kind === 'unchecked').length === 6, kinds(p))
  check('each blocker names its line (page, line, description)', p.blockers.every((b) => /^Page 1, line \d+: /.test(b.message) && b.line_id), J(p.blockers[0]))
  r = await confirm(i1, lead.cookie)
  let body = await r.json()
  check('confirm while blocked -> 400 blocked with the list', r.status === 400 && body.code === 'blocked' && body.blockers.length === 10, `${r.status} ${J(body).slice(0, 200)}`)
  check('...no stock moved, invoice still read', sameStock(start, await stock()) && (await getInvoice(i1)).status === 'read')

  let v = await view(i1, lead.cookie)
  const line = (word) => v.lines.find((l) => l.description.includes(word))
  r = await patchLines(i1, lead.cookie, [
    { id: line('HANDPICK').id, item_id: itemIds.hand },
    { id: line('REPICK').id, item_id: itemIds.other2 },
    { id: line('SECOND ICE').id, item_id: itemIds.ice },
    { id: line('NOT OURS').id, skip: true },
    { id: line('FUDGE').id, item_id: itemIds.offvendor },
  ])
  check('picks and skip saved', r.ok, await r.text())
  p = await plan(i1, lead.cookie)
  check('after picks: only unchecked lines block (9), the skipped line does not', kinds(p) === Array(9).fill('unchecked').join(','), kinds(p))

  await checkOff(i1, lead.cookie, { SHORTLINE: 1, OVERLINE: 2 })
  p = await plan(i1, lead.cookie)
  check('all checked: the unknown case size is the one thing left', p.blockers.length === 1 && p.blockers[0].kind === 'case_size' && p.blockers[0].message.includes('SPOONS'), J(p.blockers))
  r = await confirm(i1, lead.cookie)
  check('confirm with an unknown case size -> 400', r.status === 400)
  v = await view(i1, lead.cookie)
  await patchLines(i1, lead.cookie, [{ id: line('SPOONS').id, units_per_invoice_unit: 10 }])

  // =========================================================================
  // 3. The plan (what the dialog shows)
  // =========================================================================
  p = await plan(i1, lead.cookie)
  const qty = (pl, key) => pl.items.find((x) => x.item_id === itemIds[key])?.quantity
  check('plan: no blockers', p.blockers.length === 0, J(p.blockers))
  check('plan: stock in OUR units (ice 2+1 CS x 4 = 12 gal, sugar free 1x6, syrup 2x2, spoons 3x10)',
    qty(p, 'ice') === 12 && qty(p, 'sugarfree') === 6 && qty(p, 'syrup') === 4 && qty(p, 'spoons') === 30 && qty(p, 'hand') === 1 && qty(p, 'other2') === 1 && qty(p, 'storA') === 1 && qty(p, 'offvendor') === 1 && p.items.length === 8,
    J(p.items.map((x) => [x.item_name, x.quantity])))
  check('plan: 1 short, 1 over, 1 skipped', p.short_lines === 1 && p.over_lines === 1 && p.skipped_lines === 1, `${p.short_lines}/${p.over_lines}/${p.skipped_lines}`)
  check('plan: the short is 6 bottles of Sugar Free (1 CS short x 6)', p.shorts.length === 1 && p.shorts[0].item_id === itemIds.sugarfree && p.shorts[0].quantity === 6 && p.shorts[0].unit === 'bottles', J(p.shorts))
  check('plan: note "Invoice ZZTEST69-1001: 1 short, 1 over"', p.note === 'Invoice ZZTEST69-1001: 1 short, 1 over', p.note)
  check('plan: will remember ZZ69LEARN for Hand Pick', p.learn_codes.some((c) => c.code === 'ZZ69LEARN' && c.item_id === itemIds.hand && c.vendor_mismatch === false), J(p.learn_codes))
  check('plan: other-vendor pick is remembered but flagged', p.learn_codes.some((c) => c.code === 'ZZ69OFF' && c.item_id === itemIds.offvendor && c.vendor_mismatch === true), J(p.learn_codes))
  check('plan: ZZ69TAKEN is on a different item -> left alone, says which', p.codes_left_alone.some((c) => c.code === 'ZZ69TAKEN' && c.reason.includes(ITEMS.taken.name)), J(p.codes_left_alone))
  check('plan: Ice Mix already has a code -> ZZ69NEW left alone', p.codes_left_alone.some((c) => c.code === 'ZZ69NEW' && c.reason.includes('already has code ZZ690001')), J(p.codes_left_alone))
  check('plan: exactly 2 codes to learn, 2 left alone', p.learn_codes.length === 2 && p.codes_left_alone.length === 2)
  check('plan (shift lead): no "remember case size" offer', p.remember_sizes.length === 0)
  const ownerPlan = await plan(i1, owner.cookie)
  check('plan (owner): offers "Remember 1 CS = 10" for Spoons', ownerPlan.remember_sizes.length === 1 && ownerPlan.remember_sizes[0].item_id === itemIds.spoons && ownerPlan.remember_sizes[0].size === 10, J(ownerPlan.remember_sizes))
  check('the plan wrote nothing', sameStock(start, await stock()) && (await getInvoice(i1)).status === 'read' && (await ourHistoryIds()).length === 0)

  // =========================================================================
  // 4. Confirm as a SHIFT LEAD against a ZZTEST order
  // =========================================================================
  const o1 = await makeOrder(owner.cookie, [{ item_id: itemIds.ice, item_name: ITEMS.ice.name, quantity: 3, unit: 'boxes' }])
  check('setup: the ZZTEST order is on order', await isPending(o1))
  r = await confirm(i1, lead.cookie, { fingerprint: 'not-the-one-you-saw' })
  body = await r.json()
  check('stale summary (fingerprint mismatch) -> 409 changed, nothing added', r.status === 409 && body.code === 'changed' && sameStock(start, await stock()), `${r.status} ${J(body)}`)

  let before = await stock()
  r = await confirm(i1, lead.cookie, {
    fingerprint: p.fingerprint,
    related_order_id: o1,
    destinations: { [itemIds.storA]: 'storage' }, // a shift lead may not route to storage
    remember_sizes: [line('SPOONS').id], // a shift lead may not save a case size
  })
  body = await r.json()
  check('shift lead confirms -> 200', r.ok && body.ok === true && !!body.receipt_id, `${r.status} ${J(body).slice(0, 300)}`)
  let after = await stock()
  let d = nonZero(delta(before, after))
  check('stock added: ice +12, sugar free +6, syrup +4, spoons +30, 4 hand-picked/plain lines +1 each',
    J(d) === J({ ice: { store: 12, storage: 0 }, sugarfree: { store: 6, storage: 0 }, syrup: { store: 4, storage: 0 }, storA: { store: 1, storage: 0 }, spoons: { store: 30, storage: 0 }, hand: { store: 1, storage: 0 }, other2: { store: 1, storage: 0 }, offvendor: { store: 1, storage: 0 } }),
    J(d))
  check('shift lead "storage" request ignored: has_storage item went to the store', d.storA?.store === 1 && d.storA?.storage === 0 && (await storageMoves(itemIds.storA)).length === 0)
  check('skipped line added nothing anywhere (its code is on no item)', !d.taken)

  let inv1 = await getInvoice(i1)
  check("invoice: 'received', received_by, received_at, receipt linked, order linked, not record-only",
    inv1.status === 'received' && inv1.received_by === 'ZZTEST Shift Lead' && !!inv1.received_at && inv1.receipt_id === body.receipt_id && inv1.related_order_id === o1 && inv1.record_only === false, J({ ...inv1, raw_extraction: undefined }))
  orderIds.push(body.receipt_id)
  if (body.short_id) orderIds.push(body.short_id)
  let [receipt] = await historyFor([body.receipt_id])
  check("receipt row: type received, note 'Invoice ZZTEST69-1001: 1 short, 1 over', linked to the order, resolved, received_by the shift lead",
    receipt.type === 'received' && receipt.notes === 'Invoice ZZTEST69-1001: 1 short, 1 over' && receipt.related_order_id === o1 && receipt.resolved === true && receipt.received_by === 'ZZTEST Shift Lead', J({ ...receipt, order_history_items: undefined }))
  check('receipt note is flagged for owner review (existing patch 44 behavior)', receipt.note_review_needed === true)
  check('receipt has 8 item rows in stock units', receipt.order_history_items.length === 8 && receipt.order_history_items.find((x) => x.item_id === itemIds.ice)?.quantity === 12 && receipt.order_history_items.find((x) => x.item_id === itemIds.ice)?.unit === 'gallons', J(receipt.order_history_items))
  const [shortRow] = await historyFor([body.short_id])
  check("short recorded like Receive Order: a 'short' row linked to the receipt, unresolved, 6 bottles of Sugar Free",
    !!shortRow && shortRow.type === 'short' && shortRow.related_order_id === body.receipt_id && shortRow.resolved === false && shortRow.order_history_items.length === 1 && shortRow.order_history_items[0].item_id === itemIds.sugarfree && Number(shortRow.order_history_items[0].quantity) === 6 && shortRow.order_history_items[0].unit === 'bottles' && /^Short shipment from delivery on .*\(invoice ZZTEST69-1001\)$/.test(shortRow.notes),
    J(shortRow))
  check('the order no longer shows as on order', !(await isPending(o1)))

  v = await view(i1, lead.cookie)
  check('lines: qty_received, stock_qty_added and confirmed_by stored',
    line('EXACT').stock_qty_added === 8 && line('EXACT').confirmed_by === 'ZZTEST Shift Lead' && line('SHORTLINE').qty_received === 1 && line('SHORTLINE').stock_qty_added === 6 && line('OVERLINE').stock_qty_added === 4 && line('SPOONS').stock_qty_added === 30 && line('SPOONS').units_per_invoice_unit === 10 && line('SECOND ICE').stock_qty_added === 4,
    J(v.lines.map((l) => [l.description, l.qty_received, l.units_per_invoice_unit, l.stock_qty_added, l.confirmed_by])))
  check('skipped line: stock_qty_added 0', line('NOT OURS').stock_qty_added === 0 && line('NOT OURS').match_method === 'skipped')
  check('learn-once SAVED: Hand Pick now has ZZ69LEARN, line marked code_learned', after.hand.code === 'ZZ69LEARN' && line('HANDPICK').code_learned === true)
  check('learn-once saved the other-vendor hand pick too (ZZ69OFF)', after.offvendor.code === 'ZZ69OFF' && line('FUDGE').code_learned === true)
  check('learn-once REFUSED on collision: No Code Yet still has no code, Code Owner keeps ZZ69TAKEN, line not marked', after.other2.code === null && after.taken.code === 'ZZ69TAKEN' && line('REPICK').code_learned === false)
  check('learn-once NEVER overwrites: Ice Mix still ZZ690001, line not marked', after.ice.code === 'ZZ690001' && line('SECOND ICE').code_learned === false)
  check('response says what was learned and what was left alone', body.codes_learned.length === 2 && body.codes_left_alone.length === 2, J([body.codes_learned, body.codes_left_alone]))
  check('shift lead could NOT save the case size on the item (this invoice only)', after.spoons.size === null && body.sizes_saved.length === 0)
  check('view carries the read-only summary fields', v.invoice.status === 'received' && v.invoice.received_by === 'ZZTEST Shift Lead' && v.invoice.record_only === false && v.invoice.receipt_id === body.receipt_id)
  check('photos still viewable after confirm (signed link)', (await (await apiFetch(`/api/invoices?id=${i1}`, lead.cookie)).json()).pages?.[0]?.url?.includes('token='))

  // read-only after confirm
  before = await stock()
  r = await patchLines(i1, owner.cookie, [{ id: line('EXACT').id, qty_received: 99, checked: true }])
  check('editing a confirmed invoice -> 409', r.status === 409)
  r = await confirm(i1, owner.cookie)
  body = await r.json()
  check('confirming it again -> 409 already_received', r.status === 409 && body.code === 'already_received', `${r.status} ${J(body)}`)
  r = await recordOnly(i1, owner.cookie)
  check('record-only on a confirmed invoice -> 409', r.status === 409)
  r = await setNumber(i1, owner.cookie, 'ZZTEST69-CHANGED')
  check('changing its invoice number -> 409', r.status === 409 && (await getInvoice(i1)).invoice_number === 'ZZTEST69-1001')
  r = await apiFetch('/api/invoices', owner.cookie, { method: 'DELETE', body: J({ id: i1 }) })
  check('discard of a received invoice -> 409, photos kept', r.status === 409 && (await listInvoicePhotos(i1)).length === 1)
  r = await apiFetch('/api/invoices/lines', owner.cookie, { method: 'POST', body: J({ invoice_id: i1, confirm_replace: true }) })
  check('rebuilding its lines -> 409', r.status === 409)
  check('...none of that moved stock or added history', sameStock(before, await stock()) && (await ourHistoryIds()).length === 3)

  // =========================================================================
  // 5. EQUIVALENCE: the same delivery through Receive Order and through an invoice
  // =========================================================================
  const DELIVERY = { ice: 2, sugarfree: 1, syrup: 3, custard: 2, regular: 5, storA: 3, storB: 2 } // boxes / cases
  const DEST = { storB: 'storage' } // owner routes Storage Lids B to storage; everything else to the store
  const orderLines = Object.entries(DELIVERY).map(([k, q]) => ({ item_id: itemIds[k], item_name: ITEMS[k].name, quantity: q, unit: usesBoxOrdering({ pack_size: ITEMS[k].pack }) ? 'boxes' : ITEMS[k].unit }))

  // --- path A: Receive Order (what the page posts: boxes x pack_size, done in the browser) ---
  const oA = await makeOrder(owner.cookie, orderLines)
  before = await stock()
  const movesBeforeA = (await storageMoves(itemIds.storB)).length
  r = await apiFetch('/api/order-history', owner.cookie, {
    method: 'POST',
    body: J({
      type: 'received',
      notes: '',
      items: Object.entries(DELIVERY).map(([k, q]) => ({
        item_id: itemIds[k], item_name: ITEMS[k].name,
        quantity: usesBoxOrdering({ pack_size: ITEMS[k].pack }) ? q * ITEMS[k].pack : q,
        unit: ITEMS[k].unit, destination: DEST[k] || 'store',
      })),
      related_order_id: oA, resolved: true, received_by: null,
    }),
  })
  const receiptA = await r.json()
  check('Receive Order path saved', r.ok && !!receiptA.id, `${r.status}`)
  orderIds.push(receiptA.id)
  const dA = delta(before, await stock())
  const movesA = (await storageMoves(itemIds.storB)).slice(movesBeforeA)
  const [rowA] = await historyFor([receiptA.id])
  const pendingA = await isPending(oA)

  // --- path B: invoice confirm ---
  const i2 = await makeReadInvoice(owner.cookie, 'ZZTEST69-2002', Object.entries(DELIVERY).map(([k, q]) => L(ITEMS[k].code, ITEMS[k].number, `ZZTEST EQ ${k.toUpperCase()}`, q, q)))
  await checkOff(i2, owner.cookie)
  const oB = await makeOrder(owner.cookie, orderLines)
  const p2 = await plan(i2, owner.cookie)
  check('equivalence invoice: no blockers, custard is 1 CS = 1 box', p2.blockers.length === 0 && qty(p2, 'custard') === 2, J(p2.blockers))

  // 5a. forced failure FIRST, on this same invoice, then the real confirm is the retry.
  const { getServerSupabase } = await import('../../src/lib/supabase.ts')
  const { confirmInvoice } = await import('../../src/lib/invoice-confirm-server.ts')
  const realDb = getServerSupabase()
  const ownerSession = { role: 'owner', name: 'ZZTEST Owner', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }
  const eqOpts = { related_order_id: oB, destinations: { [itemIds.storB]: 'storage' } }
  const histBefore = (await ourHistoryIds()).length
  before = await stock()
  const movesBeforeB = (await storageMoves(itemIds.storB)).length

  // the 4th stock write fails (3 items already added) -> saveReceipt's own rollback
  let out = await confirmInvoice(wrapDb(realDb, (t, op, n) => (t === 'items' && op === 'update' && n === 4 ? FORCED : null)), ownerSession, i2, eqOpts)
  let inv2 = await getInvoice(i2)
  check('forced failure on the 4th stock write: confirm fails with a retry message', out.ok === false && /try again/i.test(out.error), J(out))
  check("...every stock change rolled back, no history rows, invoice back to 'read' with nobody on it",
    sameStock(before, await stock()) && (await ourHistoryIds()).length === histBefore && inv2.status === 'read' && inv2.received_by === null && inv2.received_at === null && inv2.receipt_id === null,
    J([nonZero(delta(before, await stock())), inv2.status, inv2.received_by]))
  check('...the ZZTEST order is still on order', await isPending(oB))

  // the receipt saves, then linking it to the invoice fails -> the confirm's own undo
  out = await confirmInvoice(wrapDb(realDb, (t, op, n) => (t === 'invoices' && op === 'update' && n === 2 ? FORCED : null)), ownerSession, i2, eqOpts)
  inv2 = await getInvoice(i2)
  check('forced failure AFTER the receipt saved (linking fails): stock reversed, receipt rows deleted, invoice read',
    out.ok === false && sameStock(before, await stock()) && (await ourHistoryIds()).length === histBefore && inv2.status === 'read' && inv2.receipt_id === null && (await isPending(oB)),
    J([out, nonZero(delta(before, await stock())), inv2.status]))

  // the last step (stamping the lines) fails -> everything undone, lines clean
  out = await confirmInvoice(wrapDb(realDb, (t, op, n) => (t === 'invoice_lines' && op === 'update' && n === 3 ? FORCED : null)), ownerSession, i2, eqOpts)
  inv2 = await getInvoice(i2)
  const l2 = await rest(`invoice_lines?invoice_id=eq.${i2}&select=stock_qty_added,confirmed_by,qty_received,checked,units_per_invoice_unit`)
  check('forced failure while stamping lines: stock reversed, invoice read, lines show nothing confirmed and keep the check-off',
    out.ok === false && sameStock(before, await stock()) && (await ourHistoryIds()).length === histBefore && inv2.status === 'read' && l2.every((x) => x.stock_qty_added === null && x.confirmed_by === null && x.checked === true && x.qty_received !== null && x.units_per_invoice_unit === null),
    J([out, l2]))
  // Known, unchanged since patch 64: a rolled-back storage line leaves its storage_moves row behind.
  const strayMoves = (await storageMoves(itemIds.storB)).length - movesBeforeB
  console.log(`note  rolled-back attempts left ${strayMoves} receive_to_storage history row(s) behind (known patch 64 behavior; stock itself is restored)`)

  // 5b. the retry: a normal confirm over HTTP
  const movesBeforeReal = (await storageMoves(itemIds.storB)).length
  r = await confirm(i2, owner.cookie, { fingerprint: p2.fingerprint, ...eqOpts })
  body = await r.json()
  check('retry after the failures: confirm -> 200', r.ok && body.ok === true, `${r.status} ${J(body).slice(0, 300)}`)
  orderIds.push(body.receipt_id)
  const dB = delta(before, await stock())
  const movesB = (await storageMoves(itemIds.storB)).slice(movesBeforeReal)
  const [rowB] = await historyFor([body.receipt_id])
  const pendingB = await isPending(oB)

  const rowsOf = (row) => row.order_history_items.map((x) => `${x.item_name}|${Number(x.quantity)}|${x.unit}`).sort()
  console.log('\n  EQUIVALENCE TABLE (same delivery, Receive Order vs invoice confirm)')
  console.log('  item                 delivered   RO store  RO storage | INV store  INV storage | same')
  for (const k of Object.keys(DELIVERY)) {
    const same = dA[k].store === dB[k].store && dA[k].storage === dB[k].storage
    console.log(`  ${ITEMS[k].name.replace(`${PFX} `, '').padEnd(20)} ${String(DELIVERY[k]).padStart(3)} ${usesBoxOrdering({ pack_size: ITEMS[k].pack }) ? 'boxes' : ITEMS[k].unit.padEnd(5)}  ${String(dA[k].store).padStart(8)} ${String(dA[k].storage).padStart(11)} | ${String(dB[k].store).padStart(9)} ${String(dB[k].storage).padStart(12)} | ${same ? 'yes' : 'NO'}`)
  }
  console.log(`  receipt item rows:   RO ${rowsOf(rowA).length}, invoice ${rowsOf(rowB).length}, identical: ${J(rowsOf(rowA)) === J(rowsOf(rowB)) ? 'yes' : 'NO'}`)
  console.log(`  storage history row: RO ${J(movesA.map((m) => [m.kind, Number(m.amount), m.by_name]))}, invoice ${J(movesB.map((m) => [m.kind, Number(m.amount), m.by_name]))}`)
  console.log(`  order still on order: RO ${pendingA}, invoice ${pendingB}\n`)

  check('EQUIVALENCE stock: every item got the same store and storage change on both paths', sameStock(dA, dB), J([nonZero(dA), nonZero(dB)]))
  check('EQUIVALENCE expected numbers: ice +8 gal, sugar free +6, syrup +6, custard +2 boxes, cups +5, lids A +3 store, lids B +2 storage',
    J(nonZero(dB)) === J({ ice: { store: 8, storage: 0 }, sugarfree: { store: 6, storage: 0 }, syrup: { store: 6, storage: 0 }, custard: { store: 2, storage: 0 }, regular: { store: 5, storage: 0 }, storA: { store: 3, storage: 0 }, storB: { store: 0, storage: 2 } }), J(nonZero(dB)))
  check('EQUIVALENCE rows: receipt item rows identical (item, quantity, unit)', J(rowsOf(rowA)) === J(rowsOf(rowB)), J([rowsOf(rowA), rowsOf(rowB)]))
  check('EQUIVALENCE receipt row: same type, resolved, received_by; each linked to its own order',
    rowA.type === rowB.type && rowA.resolved === rowB.resolved && rowA.received_by === rowB.received_by && rowA.related_order_id === oA && rowB.related_order_id === oB, J([rowA.type, rowB.type, rowA.received_by, rowB.received_by]))
  check('EQUIVALENCE storage: one receive_to_storage history row each, same amount and name',
    movesA.length === 1 && movesB.length === 1 && J([movesA[0].kind, Number(movesA[0].amount), movesA[0].by_name]) === J([movesB[0].kind, Number(movesB[0].amount), movesB[0].by_name]) && movesB[0].kind === 'receive_to_storage', J([movesA, movesB]))
  check('EQUIVALENCE on-order: both orders stopped showing as on order', pendingA === false && pendingB === false)
  check('EQUIVALENCE no shorts on either path (everything shipped was received)', body.short_id === null && (await rest(`order_history?related_order_id=in.(${receiptA.id},${body.receipt_id})&type=eq.short&select=id`)).length === 0)
  check('the only intended difference: the invoice receipt carries the auto note', rowA.notes === '' && rowB.notes === 'Invoice ZZTEST69-2002', J([rowA.notes, rowB.notes]))

  // =========================================================================
  // 6. Duplicate guard + two devices confirming at once
  // =========================================================================
  const i3 = await makeReadInvoice(owner.cookie, 'ZZTEST69-1001', [L('ZZ690005', '9305', 'ZZTEST DUP CUPS', 2, 2), L('ZZ690008', '9308', 'ZZTEST DUP SPOONS', 1, 1)])
  await checkOff(i3, owner.cookie)
  v = await view(i3, owner.cookie)
  await patchLines(i3, owner.cookie, [{ id: line('SPOONS').id, units_per_invoice_unit: 25 }])
  before = await stock()
  p = await plan(i3, owner.cookie)
  const dupBlock = p.blockers.find((b) => b.kind === 'duplicate')
  check('same vendor + number as a received invoice: plan blocks and points at the existing one', !!dupBlock && dupBlock.existing_id === i1 && /already received/.test(dupBlock.message), J(p.blockers))
  r = await confirm(i3, owner.cookie)
  body = await r.json()
  check('confirm a duplicate -> 409 duplicate with the existing id, no stock', r.status === 409 && body.code === 'duplicate' && body.existing_id === i1 && sameStock(before, await stock()), `${r.status} ${J(body).slice(0, 200)}`)
  r = await recordOnly(i3, owner.cookie)
  body = await r.json()
  check('record-only a duplicate -> 409 duplicate too', r.status === 409 && body.code === 'duplicate' && (await getInvoice(i3)).status === 'read')

  r = await setNumber(i3, owner.cookie, ' zztest69-3003 ')
  body = await r.json()
  check('typing a corrected invoice number: saved cleaned (capitals, no spaces)', r.ok && body.invoice_number === 'ZZTEST69-3003' && (await getInvoice(i3)).invoice_number === 'ZZTEST69-3003', J(body))
  p = await plan(i3, owner.cookie)
  check('...and the duplicate block is gone', p.blockers.length === 0, J(p.blockers))

  // two devices, same instant
  const histBeforeRace = (await ourHistoryIds()).length
  const both = await Promise.all([
    confirm(i3, owner.cookie, { fingerprint: p.fingerprint, remember_sizes: [line('SPOONS').id] }),
    confirm(i3, lead.cookie, { fingerprint: p.fingerprint }),
  ])
  const bodies = await Promise.all(both.map((x) => x.json()))
  const wins = both.filter((x) => x.ok).length
  d = nonZero(delta(before, await stock()))
  check('two simultaneous confirms: exactly one succeeds, the other gets 409 already_received', wins === 1 && both.some((x) => x.status === 409) && bodies.some((b) => b.code === 'already_received'), J(both.map((x, i) => [x.status, bodies[i].code ?? 'ok'])))
  check('...stock added EXACTLY ONCE (cups +2, spoons +25)', J(d) === J({ regular: { store: 2, storage: 0 }, spoons: { store: 25, storage: 0 } }), J(d))
  const raceRows = await rest(`order_history?notes=eq.${encodeURIComponent('Invoice ZZTEST69-3003')}&select=id`)
  raceRows.forEach((x) => orderIds.push(x.id))
  check('...exactly one receipt row exists for it', raceRows.length === 1 && (await ourHistoryIds()).length === histBeforeRace + 1, `${raceRows.length}`)
  const winner = bodies.find((b) => b.ok)
  const ownerWon = both[0].ok
  after = await stock()
  check(ownerWon ? 'owner won the race: "Remember 1 CS = 25" saved on Spoons' : 'shift lead won the race: no case size saved on Spoons',
    ownerWon ? after.spoons.size === 25 && winner.sizes_saved.length === 1 : after.spoons.size === null, `${after.spoons.size}`)

  // owner-only remember, deterministic (if the lead won above, do it through a fresh invoice line)
  if (!ownerWon) {
    const ix = await makeReadInvoice(owner.cookie, 'ZZTEST69-3004', [L('ZZ690008', '9308', 'ZZTEST SIZE SPOONS', 1, 1)])
    await checkOff(ix, owner.cookie)
    v = await view(ix, owner.cookie)
    await patchLines(ix, owner.cookie, [{ id: line('SPOONS').id, units_per_invoice_unit: 25 }])
    r = await confirm(ix, owner.cookie, { remember_sizes: [line('SPOONS').id] })
    body = await r.json()
    orderIds.push(body.receipt_id)
    after = await stock()
  }
  check('OWNER "Remember 1 CS = 25 for this item" saved on the item', after.spoons.size === 25)

  // =========================================================================
  // 7. Missing invoice number, then the unique-index race between two invoices
  // =========================================================================
  const i4 = await makeReadInvoice(owner.cookie, null, [L('ZZ690005', '9305', 'ZZTEST NONUM CUPS', 1, 1)])
  const i5 = await makeReadInvoice(owner.cookie, 'ZZTEST69-5005', [L('ZZ690005', '9305', 'ZZTEST TWIN CUPS', 1, 1)])
  await checkOff(i4, owner.cookie)
  await checkOff(i5, owner.cookie)
  before = await stock()
  p = await plan(i4, owner.cookie)
  check('no invoice number: plan blocks with a plain message', p.blockers.length === 1 && p.blockers[0].kind === 'invoice_number', J(p.blockers))
  r = await confirm(i4, owner.cookie)
  check('confirm with no invoice number -> 400', r.status === 400 && (await r.json()).code === 'blocked')
  r = await recordOnly(i4, owner.cookie)
  check('record-only with no invoice number -> 400', r.status === 400 && (await getInvoice(i4)).status === 'read')
  r = await setNumber(i4, owner.cookie, '   ')
  check('blank invoice number -> 400', r.status === 400)
  r = await setNumber(i4, owner.cookie, 'bad/number!')
  check('invoice number with odd characters -> 400', r.status === 400)
  r = await setNumber(i4, lead.cookie, 'ZZTEST69-5005')
  check('shift lead types the invoice number -> saved', r.ok && (await getInvoice(i4)).invoice_number === 'ZZTEST69-5005')
  p = await plan(i4, owner.cookie)
  check('...and now nothing blocks it (its twin is not received yet)', p.blockers.length === 0, J(p.blockers))

  const twins = await Promise.all([confirm(i4, owner.cookie), confirm(i5, lead.cookie)])
  const twinBodies = await Promise.all(twins.map((x) => x.json()))
  const twinIds = [i4, i5]
  const wIdx = twins.findIndex((x) => x.ok)
  const lIdx = 1 - wIdx
  twinBodies.filter((b) => b.receipt_id).forEach((b) => orderIds.push(b.receipt_id))
  d = nonZero(delta(before, await stock()))
  check('two invoices with the same vendor + number confirmed at once: one wins, one gets 409 duplicate',
    twins.filter((x) => x.ok).length === 1 && twins[lIdx]?.status === 409 && twinBodies[lIdx]?.code === 'duplicate', J(twins.map((x, i) => [x.status, twinBodies[i].code ?? 'ok'])))
  check('...the loser is told which invoice already has that number', twinBodies[lIdx]?.existing_id === twinIds[wIdx], J(twinBodies[lIdx]))
  check('...stock added once (cups +1), loser still read', J(d) === J({ regular: { store: 1, storage: 0 } }) && (await getInvoice(twinIds[lIdx])).status === 'read', J(d))
  const loser = twinIds[lIdx]

  // The unique index itself (not the pre-check): hide the pre-check's answer once.
  before = await stock()
  let hidden = 0
  out = await confirmInvoice(
    // findReceivedDuplicate is the only place that starts with invoices.select('id')
    wrapDb(realDb, (t, op, n, args) => (t === 'invoices' && op === 'select' && args[0] === 'id' && hidden++ === 0 ? { data: [], error: null } : null)),
    ownerSession, loser, {})
  check('unique index rejects the confirm when the pre-check is blind: friendly 409 duplicate, no stock, still read',
    out.ok === false && out.status === 409 && out.code === 'duplicate' && /already received/.test(out.error) && out.existing_id === twinIds[wIdx] && sameStock(before, await stock()) && (await getInvoice(loser)).status === 'read',
    J(out))

  // =========================================================================
  // 8. Record only
  // =========================================================================
  r = await setNumber(loser, owner.cookie, 'ZZTEST69-6006')
  const histBeforeRec = (await ourHistoryIds()).length
  const linesBefore = J(await rest(`invoice_lines?invoice_id=eq.${loser}&select=*&order=line_no.asc`))
  before = await stock()
  r = await recordOnly(loser, lead.cookie)
  body = await r.json()
  const rec = await getInvoice(loser)
  check('record only (shift lead) -> 200', r.ok && body.record_only === true, `${r.status} ${J(body)}`)
  check("record only: status 'received', record_only true, received_by/at set, NO receipt", rec.status === 'received' && rec.record_only === true && rec.received_by === 'ZZTEST Shift Lead' && !!rec.received_at && rec.receipt_id === null, J({ ...rec, raw_extraction: undefined }))
  check('record only: stock untouched', sameStock(before, await stock()))
  check('record only: no stock history rows created', (await ourHistoryIds()).length === histBeforeRec)
  check('record only: check-off lines kept exactly as they were', linesBefore === J(await rest(`invoice_lines?invoice_id=eq.${loser}&select=*&order=line_no.asc`)))
  check('record only: photos kept', (await listInvoicePhotos(loser)).length === 1)
  r = await confirm(loser, owner.cookie)
  check('record only is final: confirm afterwards -> 409, no stock', r.status === 409 && sameStock(before, await stock()))
  r = await apiFetch('/api/invoices', owner.cookie, { method: 'DELETE', body: J({ id: loser }) })
  check('record only is protected: discard -> 409', r.status === 409)
  const i6 = await makeReadInvoice(owner.cookie, 'ZZTEST69-6006', [L('ZZ690005', '9305', 'ZZTEST AFTER RECORD CUPS', 1, 1)])
  await checkOff(i6, owner.cookie)
  r = await confirm(i6, owner.cookie)
  body = await r.json()
  check('duplicate guard protects a record-only invoice: same number again -> 409 duplicate', r.status === 409 && body.code === 'duplicate' && body.existing_id === loser && sameStock(before, await stock()), `${r.status} ${J(body).slice(0, 200)}`)

  // =========================================================================
  // 9. Discard still works for a READ invoice
  // =========================================================================
  r = await apiFetch('/api/invoices', lead.cookie, { method: 'DELETE', body: J({ id: i6 }) })
  body = await r.json()
  const disc = await getInvoice(i6)
  check("discard of a READ invoice still works: 'discarded', lines and photos removed, no stock",
    r.ok && body.discarded === true && disc.status === 'discarded' && (await rest(`invoice_lines?invoice_id=eq.${i6}&select=id`)).length === 0 && (await listInvoicePhotos(i6)).length === 0 && sameStock(before, await stock()), J(body))
  r = await confirm(i6, owner.cookie)
  check('a discarded invoice can not be confirmed -> 409', r.status === 409 && sameStock(before, await stock()))
}

async function cleanup() {
  const owner = loginAsOwner()
  let invLeft = 0
  for (const id of invoiceIds) {
    const res = await deleteInvoiceById(id)
    if (res.photosLeft || res.rowLeft) invLeft++
  }
  // history: by tracked id, plus anything else that mentions our items (shorts first: they point at receipts)
  const hist = [...new Set([...orderIds, ...(await ourHistoryIds())])]
  if (hist.length) {
    await rest(`order_history?id=in.(${hist.join(',')})&type=eq.short`, { method: 'DELETE' })
    await rest(`order_history?id=in.(${hist.join(',')})`, { method: 'DELETE' })
  }
  const ids = Object.values(itemIds).filter(Boolean)
  if (ids.length) await rest(`storage_moves?item_id=in.(${ids.join(',')})`, { method: 'DELETE' })
  for (const id of ids) await apiFetch('/api/items', owner.cookie, { method: 'DELETE', body: J({ id }) }).catch(() => {})
  const itemsLeft = ids.length ? (await rest(`items?id=in.(${ids.join(',')})&select=id`)).length : 0
  const linesLeft = invoiceIds.length ? (await rest(`invoice_lines?invoice_id=in.(${invoiceIds.join(',')})&select=id`)).length : 0
  const histLeft = hist.length ? (await rest(`order_history?id=in.(${hist.join(',')})&select=id`)).length : 0
  const histItemsLeft = (await rest(`order_history_items?item_name=ilike.${encodeURIComponent(`${PFX}*`)}&select=id`)).length
  const movesLeft = ids.length ? (await rest(`storage_moves?item_id=in.(${ids.join(',')})&select=id`)).length : 0
  console.log(`cleanup: ${invoiceIds.length} invoices, ${ids.length} items, ${hist.length} history rows removed by id; left: invoices ${invLeft}, items ${itemsLeft}, lines ${linesLeft}, history ${histLeft}, history items ${histItemsLeft}, storage moves ${movesLeft}`)
  if (invLeft || itemsLeft || linesLeft || histLeft || histItemsLeft || movesLeft) failures++
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
    console.log(failures ? `\n${failures} check(s) failed (of ${total})` : `\nall ${total} invoice-confirm checks passed`)
    process.exit(failures ? 1 : 0)
  })
