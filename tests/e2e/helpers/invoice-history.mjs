// Patch 70 fixtures for invoice-history-checks.mjs and
// invoice-history-ui-checks.mjs. Everything is ZZTEST: items named
// "ZZTEST P70 ...", invoices created by ZZTEST Owner with numbers
// "ZZTEST70-...", and receipts/shorts made by confirming those invoices
// (never naming a real order). Cleanup is by id. NEVER calls the Anthropic
// API: reader results are written straight into raw_extraction.
import { apiFetch } from './auth.mjs'
import { rest } from './rest.mjs'
import { requiredEnv } from './config.mjs'
import { TINY_JPEG, createDraftWithPages, deleteInvoiceById } from './invoices.mjs'

export const PFX = 'ZZTEST P70'
const J = (x) => JSON.stringify(x)
const BUCKET = 'invoice-photos'

export const ITEMS = {
  cups: { name: `${PFX} Cups`, category: 'Containers & Cups', unit: 'cases', code: 'ZZ700001', number: '9701', pack: null, case: null },
  ice: { name: `${PFX} Cherry Ice Mix`, category: 'Ice Mix', unit: 'gallons', code: 'ZZ700002', number: '9702', pack: 4, case: 4 },
}

export function newTracker() {
  return { itemIds: {}, invoiceIds: [], orderIds: [], orphanFolders: [] }
}

export async function setupItems(cookie, t) {
  const clash = await rest(
    `items?or=(item_number.in.(${Object.values(ITEMS).map((i) => i.number).join(',')}),vendor_item_code.in.(${Object.values(ITEMS).map((i) => i.code).join(',')}))&name=not.ilike.zztest*&select=name`
  )
  if (clash.length) throw new Error(`a real item uses a test code/number: ${J(clash)}`)
  const stale = await rest(`items?name=ilike.${encodeURIComponent(`${PFX}*`)}&select=id`)
  if (stale.length) await cleanupHistoryRowsFor(stale.map((x) => x.id))
  for (const s of stale) await rest(`items?id=eq.${s.id}`, { method: 'DELETE' })
  for (const [k, it] of Object.entries(ITEMS)) {
    const res = await apiFetch('/api/items', cookie, { method: 'POST', body: J({ name: it.name, category: it.category, unit: it.unit }) })
    if (!res.ok) throw new Error(`create item -> ${res.status} ${await res.text()}`)
    const created = await res.json()
    t.itemIds[k] = created.id
    await rest(`items?id=eq.${created.id}`, {
      method: 'PATCH',
      body: J({ distributor: 'bunzl', item_number: it.number, vendor_item_code: it.code, pack_size: it.pack, invoice_units_per_case: it.case }),
    })
  }
}

const L = (vendor_code, item_number, description, ordered, shipped) => ({
  vendor_code, item_number, description, invoice_unit: 'CS', qty_ordered: ordered, qty_shipped: shipped, unsure: false, note: null,
})
const T = () => ({ total_ordered: null, total_shipped: null, total_units: null, total_cases: null, dollar_total: null, note: null })

// A draft with real photos in the private bucket, then fake reader results
// written straight in, then lines built through the real route.
export async function makeReadInvoice(cookie, t, { vendor = 'bunzl', number, pages = 1, lines }) {
  const inv = await createDraftWithPages(cookie, vendor, Array.from({ length: pages }, () => TINY_JPEG))
  t.invoiceIds.push(inv.id)
  const now = new Date().toISOString()
  const pageResults = {}
  for (let p = 1; p <= pages; p++) {
    pageResults[p] = {
      model: 'claude-opus-5-5', read_at: now, ms: 12000, usage: { input_tokens: 6800, output_tokens: 1200 },
      result: { vendor, invoice_number: number, invoice_date: '11/12/26', page_number: p, page_count: pages, has_no_items: p !== 1, lines: p === 1 ? lines : [], printed_totals: T(), page_notes: null },
    }
  }
  await rest(`invoices?id=eq.${inv.id}`, {
    method: 'PATCH',
    body: J({
      status: 'read',
      read_model: 'claude-opus-5-5',
      raw_extraction: {
        model: 'claude-opus-5-5', rev: 3, last_attempt_at: now, pages: pageResults,
        attempts: Array.from({ length: pages }, (_, i) => ({ page: i + 1, at: now, model: 'claude-opus-5-5', outcome: 'ok' })),
      },
    }),
  })
  const r = await apiFetch('/api/invoices/lines', cookie, { method: 'POST', body: J({ invoice_id: inv.id }) })
  if (!r.ok) throw new Error(`build lines -> ${r.status} ${await r.text()}`)
  return inv.id
}

// Invoice A: Cups 3 shipped / 2 received (short), Ice 2 shipped / 3 received
// (over), one line skipped. Confirmed by ZZTEST Owner with no order named.
export async function makeConfirmedInvoice(cookie, t, number) {
  const id = await makeReadInvoice(cookie, t, {
    number,
    pages: 2,
    lines: [L('ZZ700001', '9701', 'ZZTEST P70 CUPS 16OZ', 3, 3), L('ZZ700002', '9702', 'ZZTEST P70 CHERRY ICE', 2, 2), L('ZZ70NOPE', null, 'QQZ NOT OURS P70', 1, 1)],
  })
  const view = await (await apiFetch(`/api/invoices/lines?invoice_id=${id}`, cookie)).json()
  const updates = view.lines.map((l) => {
    if (l.description.includes('NOT OURS')) return { id: l.id, skip: true }
    if (l.description.includes('CUPS')) return { id: l.id, qty_received: 2, checked: true }
    return { id: l.id, qty_received: 3, checked: true }
  })
  // skip first (its own update), then the check-offs
  for (const u of updates.filter((u) => u.skip)) {
    const r = await apiFetch('/api/invoices/lines', cookie, { method: 'PATCH', body: J({ invoice_id: id, updates: [u] }) })
    if (!r.ok) throw new Error(`skip -> ${r.status} ${await r.text()}`)
  }
  const r1 = await apiFetch('/api/invoices/lines', cookie, { method: 'PATCH', body: J({ invoice_id: id, updates: updates.filter((u) => !u.skip) }) })
  if (!r1.ok) throw new Error(`check off -> ${r1.status} ${await r1.text()}`)
  const c = await apiFetch('/api/invoices/confirm', cookie, { method: 'POST', body: J({ invoice_id: id, mode: 'confirm', related_order_id: null }) })
  const body = await c.json()
  if (!c.ok) throw new Error(`confirm -> ${c.status} ${J(body)}`)
  const inv = (await rest(`invoices?id=eq.${id}&select=receipt_id`))[0]
  if (inv.receipt_id) {
    t.orderIds.push(inv.receipt_id)
    const shorts = await rest(`order_history?related_order_id=eq.${inv.receipt_id}&type=eq.short&select=id`)
    for (const s of shorts) t.orderIds.push(s.id)
  }
  return id
}

// Invoice B: Balford, filed as record only (no stock, no receipt).
export async function makeRecordOnlyInvoice(cookie, t, number) {
  const id = await makeReadInvoice(cookie, t, { vendor: 'balford', number, lines: [L('307999', null, 'ZZTEST P70 BALFORD THING', 1, 1)] })
  const r = await apiFetch('/api/invoices/confirm', cookie, { method: 'POST', body: J({ invoice_id: id, mode: 'record_only' }) })
  if (!r.ok) throw new Error(`record only -> ${r.status} ${await r.text()}`)
  return id
}

function storageHeaders(extra = {}) {
  const key = requiredEnv('SUPABASE_SERVICE_ROLE_KEY')
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra }
}

// Puts a file straight into the bucket under "<folder>/<name>" (an orphan
// when no invoice row has that id).
export async function putBucketFile(folder, name = '1.jpg') {
  const res = await fetch(`${requiredEnv('NEXT_PUBLIC_SUPABASE_URL')}/storage/v1/object/${BUCKET}/${folder}/${name}`, {
    method: 'POST',
    headers: storageHeaders({ 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }),
    body: TINY_JPEG,
  })
  if (!res.ok) throw new Error(`put bucket file -> ${res.status} ${await res.text()}`)
}

export async function listFolder(folder) {
  const res = await fetch(`${requiredEnv('NEXT_PUBLIC_SUPABASE_URL')}/storage/v1/object/list/${BUCKET}`, {
    method: 'POST',
    headers: storageHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefix: folder, limit: 100 }),
  })
  if (!res.ok) throw new Error(`list -> ${res.status}`)
  return (await res.json()).map((f) => `${folder}/${f.name}`)
}

export async function removeFolder(folder) {
  const paths = await listFolder(folder)
  if (paths.length === 0) return 0
  const res = await fetch(`${requiredEnv('NEXT_PUBLIC_SUPABASE_URL')}/storage/v1/object/${BUCKET}`, {
    method: 'DELETE',
    headers: storageHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: paths }),
  })
  if (!res.ok) throw new Error(`remove folder -> ${res.status}`)
  return (await listFolder(folder)).length
}

async function cleanupHistoryRowsFor(itemIds) {
  if (!itemIds.length) return
  const rows = await rest(`order_history_items?item_id=in.(${itemIds.join(',')})&select=order_id`)
  const ids = [...new Set(rows.map((r) => r.order_id))]
  if (!ids.length) return
  await rest(`order_history?id=in.(${ids.join(',')})&type=eq.short`, { method: 'DELETE' })
  await rest(`order_history?id=in.(${ids.join(',')})`, { method: 'DELETE' })
}

// Removes everything the tracker holds, by id. Returns what is left (all zero = clean).
export async function cleanupTracked(cookie, t) {
  let invLeft = 0
  for (const id of t.invoiceIds) {
    const res = await deleteInvoiceById(id)
    if (res.photosLeft || res.rowLeft) invLeft++
  }
  let orphanLeft = 0
  for (const f of t.orphanFolders) orphanLeft += await removeFolder(f)
  const itemIds = Object.values(t.itemIds).filter(Boolean)
  const byItems = itemIds.length ? (await rest(`order_history_items?item_id=in.(${itemIds.join(',')})&select=order_id`)).map((r) => r.order_id) : []
  const hist = [...new Set([...t.orderIds, ...byItems])]
  if (hist.length) {
    await rest(`order_history?id=in.(${hist.join(',')})&type=eq.short`, { method: 'DELETE' })
    await rest(`order_history?id=in.(${hist.join(',')})`, { method: 'DELETE' })
  }
  if (itemIds.length) await rest(`storage_moves?item_id=in.(${itemIds.join(',')})`, { method: 'DELETE' })
  for (const id of itemIds) await apiFetch('/api/items', cookie, { method: 'DELETE', body: J({ id }) }).catch(() => {})
  const left = {
    invoices: invLeft,
    invoiceRows: t.invoiceIds.length ? (await rest(`invoices?id=in.(${t.invoiceIds.join(',')})&select=id`)).length : 0,
    lines: t.invoiceIds.length ? (await rest(`invoice_lines?invoice_id=in.(${t.invoiceIds.join(',')})&select=id`)).length : 0,
    orphanFiles: orphanLeft,
    history: hist.length ? (await rest(`order_history?id=in.(${hist.join(',')})&select=id`)).length : 0,
    historyItems: (await rest(`order_history_items?item_name=ilike.${encodeURIComponent(`${PFX}*`)}&select=id`)).length,
    items: itemIds.length ? (await rest(`items?id=in.(${itemIds.join(',')})&select=id`)).length : 0,
  }
  return { removed: { invoices: t.invoiceIds.length, orphanFolders: t.orphanFolders.length, history: hist.length, items: itemIds.length }, left }
}
