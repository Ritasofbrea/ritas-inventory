// Patch 70: invoice history (read-only). Shared by /api/invoices/history.
//
// Only RECEIVED invoices are history: confirmed deliveries and ones filed as
// record only. Drafts, read-but-not-confirmed and discarded invoices stay on
// the Scan Invoice screen. Nothing here writes anything.
//
//   listReceivedInvoices   one page of the list, newest confirm first, with
//                          search by invoice number and a vendor filter.
//                          Paged with .range(), so there is no hidden cap
//                          (Order History's GET stops at 50; this does not).
//   getInvoiceHistoryDetail  header + every line + signed photo links
//                          (10 minutes; the bucket stays private)
//   invoiceIdsForReceipts  receipt id -> invoice id, for the "View invoice"
//                          links on Order History and the Short Shipment alert
import type { SupabaseClient } from '@supabase/supabase-js'
import { INVOICE_PHOTO_BUCKET, INVOICE_SIGNED_URL_SECONDS, INVOICE_VENDORS, UUID_RE } from './invoice-constants'

export const INVOICE_HISTORY_PAGE_SIZE = 20
const LINES_PAGE = 1000

type Fail = { ok: false; status: number; error: string }

export type InvoiceListRow = {
  id: string
  vendor: string
  invoice_number: string | null
  invoice_date: string | null
  received_by: string | null
  received_at: string | null
  record_only: boolean
  receipt_id: string | null
  page_count: number
  line_count: number
  skipped_count: number
  short_count: number
  over_count: number
}

// Search is by invoice number only. Invoice numbers are capitals, digits and
// hyphens (setInvoiceNumber's rule), so anything else is dropped. That also
// keeps PostgREST's ilike pattern characters (% _ * ,) out of the filter.
export function cleanInvoiceSearch(raw: string | null | undefined): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40)
}

type LineLite = { invoice_id: string; match_method: string; qty_shipped: number | null; qty_received: number | null }

// short = received less than shipped, over = more, same rule as the
// check-off screen's badges. Skipped lines never count.
export function lineDiff(l: { match_method: string; qty_shipped: number | null; qty_received: number | null }): 'short' | 'over' | null {
  if (l.match_method === 'skipped' || l.qty_shipped == null || l.qty_received == null) return null
  const d = Number(l.qty_received) - Number(l.qty_shipped)
  if (d < 0) return 'short'
  if (d > 0) return 'over'
  return null
}

async function loadLinesFor(db: SupabaseClient, invoiceIds: string[]): Promise<LineLite[] | null> {
  if (invoiceIds.length === 0) return []
  const out: LineLite[] = []
  for (let from = 0; ; from += LINES_PAGE) {
    const { data, error } = await db
      .from('invoice_lines')
      .select('invoice_id, match_method, qty_shipped, qty_received')
      .in('invoice_id', invoiceIds)
      .order('id')
      .range(from, from + LINES_PAGE - 1)
    if (error) return null
    out.push(...((data ?? []) as LineLite[]))
    if ((data ?? []).length < LINES_PAGE) break
  }
  return out
}

export async function listReceivedInvoices(
  db: SupabaseClient,
  opts: { q?: string | null; vendor?: string | null; page?: number }
): Promise<{ ok: true; invoices: InvoiceListRow[]; page: number; has_more: boolean } | Fail> {
  const page = Number.isInteger(opts.page) && (opts.page as number) >= 0 ? (opts.page as number) : 0
  const q = cleanInvoiceSearch(opts.q)
  const vendor = opts.vendor ? String(opts.vendor).toLowerCase() : ''
  if (vendor && !(INVOICE_VENDORS as readonly string[]).includes(vendor)) return { ok: false, status: 400, error: 'Bad vendor' }

  const from = page * INVOICE_HISTORY_PAGE_SIZE
  // One extra row tells us whether there is another page.
  let query = db
    .from('invoices')
    .select('id, vendor, invoice_number, invoice_date, received_by, received_at, record_only, receipt_id, photo_paths, created_at')
    .eq('status', 'received')
    .order('received_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + INVOICE_HISTORY_PAGE_SIZE)
  if (vendor) query = query.eq('vendor', vendor)
  if (q) query = query.ilike('invoice_number', `%${q}%`)
  const { data, error } = await query
  if (error) return { ok: false, status: 500, error: 'Could not load invoices.' }

  const rows = (data ?? []) as (Omit<InvoiceListRow, 'page_count' | 'line_count' | 'skipped_count' | 'short_count' | 'over_count'> & { photo_paths: string[] | null })[]
  const has_more = rows.length > INVOICE_HISTORY_PAGE_SIZE
  const shown = rows.slice(0, INVOICE_HISTORY_PAGE_SIZE)
  const lines = await loadLinesFor(db, shown.map((r) => r.id))
  if (!lines) return { ok: false, status: 500, error: 'Could not load invoice lines.' }

  const invoices: InvoiceListRow[] = shown.map((r) => {
    const mine = lines.filter((l) => l.invoice_id === r.id)
    return {
      id: r.id,
      vendor: r.vendor,
      invoice_number: r.invoice_number,
      invoice_date: r.invoice_date,
      received_by: r.received_by,
      received_at: r.received_at,
      record_only: !!r.record_only,
      receipt_id: r.receipt_id,
      page_count: (r.photo_paths ?? []).length,
      line_count: mine.length,
      skipped_count: mine.filter((l) => l.match_method === 'skipped').length,
      short_count: mine.filter((l) => lineDiff(l) === 'short').length,
      over_count: mine.filter((l) => lineDiff(l) === 'over').length,
    }
  })
  return { ok: true, invoices, page, has_more }
}

export type InvoiceDetailLine = {
  id: string
  page: number
  line_no: number
  vendor_code: string | null
  printed_item_number: string | null
  description: string | null
  invoice_unit: string | null
  qty_ordered: number | null
  qty_shipped: number | null
  qty_received: number | null
  units_per_invoice_unit: number | null
  stock_qty_added: number | null
  match_method: string
  code_learned: boolean
  confirmed_by: string | null
  item: { id: string; name: string; unit: string | null } | null
  diff: 'short' | 'over' | null
}

export type InvoiceHistoryDetail = {
  invoice: {
    id: string
    vendor: string
    invoice_number: string | null
    invoice_date: string | null
    created_by: string | null
    created_at: string
    received_by: string | null
    received_at: string | null
    record_only: boolean
    receipt_id: string | null
    related_order_id: string | null
  }
  receipt: { id: string; created_at: string; notes: string | null } | null
  short: { id: string; resolved: boolean } | null
  lines: InvoiceDetailLine[]
  pages: { page: number; url: string | null }[]
  expires_in: number
}

const num = (v: unknown) => (v == null ? null : Number(v))

export async function getInvoiceHistoryDetail(db: SupabaseClient, id: string): Promise<{ ok: true; detail: InvoiceHistoryDetail } | Fail> {
  if (!UUID_RE.test(id)) return { ok: false, status: 400, error: 'Bad id' }
  const { data: inv, error } = await db
    .from('invoices')
    .select('id, vendor, status, invoice_number, invoice_date, created_by, created_at, received_by, received_at, record_only, receipt_id, related_order_id, photo_paths')
    .eq('id', id)
    .maybeSingle()
  if (error) return { ok: false, status: 500, error: 'Could not load the invoice.' }
  // Only received invoices are history. Anything else answers "not found"
  // here; the Scan Invoice screen is where unfinished invoices live.
  if (!inv || inv.status !== 'received') return { ok: false, status: 404, error: 'Invoice not found' }

  const { data: lineRows, error: lineError } = await db
    .from('invoice_lines')
    .select('id, page, line_no, vendor_code, printed_item_number, description, invoice_unit, qty_ordered, qty_shipped, qty_received, units_per_invoice_unit, stock_qty_added, match_method, code_learned, confirmed_by, item_id')
    .eq('invoice_id', id)
    .order('page')
    .order('line_no')
  if (lineError) return { ok: false, status: 500, error: 'Could not load the lines.' }
  const raw = (lineRows ?? []) as (Omit<InvoiceDetailLine, 'item' | 'diff'> & { item_id: string | null })[]

  const itemIds = [...new Set(raw.map((l) => l.item_id).filter((x): x is string => !!x))]
  const itemsById = new Map<string, { id: string; name: string; unit: string | null }>()
  if (itemIds.length > 0) {
    const { data: items, error: itemError } = await db.from('items').select('id, name, unit').in('id', itemIds)
    if (itemError) return { ok: false, status: 500, error: 'Could not load items.' }
    for (const i of items ?? []) itemsById.set(i.id, i)
  }

  const lines: InvoiceDetailLine[] = raw.map(({ item_id, ...l }) => {
    const shaped = {
      ...l,
      qty_ordered: num(l.qty_ordered),
      qty_shipped: num(l.qty_shipped),
      qty_received: num(l.qty_received),
      units_per_invoice_unit: num(l.units_per_invoice_unit),
      stock_qty_added: num(l.stock_qty_added),
    }
    return { ...shaped, item: item_id ? itemsById.get(item_id) ?? null : null, diff: lineDiff(shaped) }
  })

  let receipt: InvoiceHistoryDetail['receipt'] = null
  let short: InvoiceHistoryDetail['short'] = null
  if (inv.receipt_id) {
    const { data: r } = await db.from('order_history').select('id, created_at, notes').eq('id', inv.receipt_id).maybeSingle()
    receipt = r ?? null
    const { data: s } = await db
      .from('order_history')
      .select('id, resolved')
      .eq('type', 'short')
      .eq('related_order_id', inv.receipt_id)
      .order('created_at', { ascending: false })
      .limit(1)
    short = s && s.length > 0 ? { id: s[0].id, resolved: !!s[0].resolved } : null
  }

  const paths: string[] = inv.photo_paths ?? []
  let pages: { page: number; url: string | null }[] = []
  if (paths.length > 0) {
    const { data: signed, error: signError } = await db.storage.from(INVOICE_PHOTO_BUCKET).createSignedUrls(paths, INVOICE_SIGNED_URL_SECONDS)
    // A signing failure still shows the invoice; the photo buttons say the
    // page couldn't be loaded.
    pages = paths.map((p, i) => ({ page: i + 1, url: signError ? null : signed?.[i]?.signedUrl ?? null }))
  }

  return {
    ok: true,
    detail: {
      invoice: {
        id: inv.id,
        vendor: inv.vendor,
        invoice_number: inv.invoice_number,
        invoice_date: inv.invoice_date,
        created_by: inv.created_by,
        created_at: inv.created_at,
        received_by: inv.received_by,
        received_at: inv.received_at,
        record_only: !!inv.record_only,
        receipt_id: inv.receipt_id,
        related_order_id: inv.related_order_id,
      },
      receipt,
      short,
      lines,
      pages,
      expires_in: INVOICE_SIGNED_URL_SECONDS,
    },
  }
}

// receipt id -> invoice id. Only received invoices (a receipt only ever
// belongs to one: the confirm sets receipt_id once). At most 100 ids per
// call; Order History sends at most 50.
export const MAX_RECEIPT_LOOKUP = 100

export async function invoiceIdsForReceipts(db: SupabaseClient, receiptIds: string[]): Promise<{ ok: true; links: Record<string, string> } | Fail> {
  const ids = [...new Set(receiptIds)].filter((x) => UUID_RE.test(x))
  if (ids.length === 0) return { ok: true, links: {} }
  if (ids.length > MAX_RECEIPT_LOOKUP) return { ok: false, status: 400, error: 'Too many ids' }
  const { data, error } = await db.from('invoices').select('id, receipt_id').eq('status', 'received').in('receipt_id', ids)
  if (error) return { ok: false, status: 500, error: 'Could not look up invoices.' }
  const links: Record<string, string> = {}
  for (const r of data ?? []) if (r.receipt_id) links[r.receipt_id] = r.id
  return { ok: true, links }
}

// Patch 70: read but not confirmed invoices, for the Scan Invoice nudge.
// Any age (the recent list stops at 20). These are never auto-deleted.
export async function listUnconfirmedInvoices(db: SupabaseClient): Promise<{ ok: true; invoices: { id: string; vendor: string; invoice_number: string | null; created_at: string; created_by: string | null }[] } | Fail> {
  const { data, error } = await db
    .from('invoices')
    .select('id, vendor, invoice_number, created_at, created_by')
    .eq('status', 'read')
    .order('created_at', { ascending: true })
    .limit(50)
  if (error) return { ok: false, status: 500, error: 'Could not load invoices.' }
  return { ok: true, invoices: data ?? [] }
}
