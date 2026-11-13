// Patch 68: invoice_lines -- built from the reader's per-page results in
// invoices.raw_extraction (patch 65), matched to our items
// (src/lib/invoice-matching.ts), then checked off by the crew.
// NO stock and NO saveReceipt here: confirming is src/lib/invoice-confirm-server.ts (patch 69).
//
// Crew entries are never silently lost: rebuilding a page that already
// has crew entries (received qty, checked, a match choice, a skip, or a
// typed case size) needs confirmReplace.
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  autoMatch,
  caseSizeFor,
  reviewCandidates,
  suggestionsFor,
  type CaseSize,
  type MatchItem,
  type MatchMethod,
  type ReviewReason,
  type Suggestion,
} from './invoice-matching'
import { totalsCheck, type ReadPageEntry, type TotalsCheck } from './invoice-read-server'
import type { InvoicePageResult } from './invoice-reader'

export const EDITABLE_STATUSES = ['draft', 'read'] as const

export type InvoiceLineRow = {
  id: string
  invoice_id: string
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
  item_id: string | null
  match_method: MatchMethod
  review_reason: ReviewReason | null
  ai_note: string | null
  ai_unsure: boolean
  checked: boolean
  updated_by: string | null
  updated_at: string | null
  // Patch 69: filled when the delivery is confirmed.
  stock_qty_added: number | null
  code_learned: boolean
  confirmed_by: string | null
}

export const LINE_COLS =
  'id, invoice_id, page, line_no, vendor_code, printed_item_number, description, invoice_unit, qty_ordered, qty_shipped, qty_received, units_per_invoice_unit, item_id, match_method, review_reason, ai_note, ai_unsure, checked, updated_by, updated_at, stock_qty_added, code_learned, confirmed_by'

const ITEM_COLS = 'id, name, distributor, item_number, vendor_item_code, distributor_item_name, unit, invoice_units_per_case, is_off, category'

type Fail = { ok: false; status: number; error: string; code?: string; pages?: number[] }

// items is a small, bounded catalog table (~200 rows), well under
// PostgREST's 1000-row cap -- same reasoning as GET /api/items.
export async function loadMatchItems(db: SupabaseClient): Promise<MatchItem[] | null> {
  const { data, error } = await db.from('items').select(ITEM_COLS)
  if (error) return null
  return (data ?? []) as MatchItem[]
}

// A line "has crew entries" if anyone has touched it.
function hasCrewEntry(l: Pick<InvoiceLineRow, 'qty_received' | 'checked' | 'match_method' | 'units_per_invoice_unit'>): boolean {
  return l.qty_received != null || l.checked || l.match_method === 'manual' || l.match_method === 'skipped' || l.units_per_invoice_unit != null
}

export async function pagesWithCrewEntries(db: SupabaseClient, invoiceId: string, pages?: number[]): Promise<number[] | null> {
  let q = db.from('invoice_lines').select('page, qty_received, checked, match_method, units_per_invoice_unit').eq('invoice_id', invoiceId)
  if (pages && pages.length) q = q.in('page', pages)
  const { data, error } = await q
  if (error) return null
  const out = new Set<number>()
  for (const l of data ?? []) if (hasCrewEntry(l as InvoiceLineRow)) out.add(l.page as number)
  return [...out].sort((a, b) => a - b)
}

// "11/07/26" or "11/07/2026" -> "2026-11-07"; anything else -> null.
export function parseInvoiceDate(s: string | null | undefined): string | null {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\s*$/.exec(s ?? '')
  if (!m) return null
  const mm = Number(m[1]), dd = Number(m[2])
  const yyyy = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null
  const d = new Date(Date.UTC(yyyy, mm - 1, dd))
  if (d.getUTCMonth() !== mm - 1) return null
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

type InvoiceForLines = {
  id: string; vendor: string; status: string; raw_extraction: unknown; photo_paths: string[] | null; invoice_number: string | null; invoice_date: string | null
  record_only: boolean; receipt_id: string | null; received_by: string | null; received_at: string | null
}

async function loadInvoice(db: SupabaseClient, id: string): Promise<InvoiceForLines | null> {
  const { data } = await db
    .from('invoices')
    .select('id, vendor, status, raw_extraction, photo_paths, invoice_number, invoice_date, record_only, receipt_id, received_by, received_at')
    .eq('id', id)
    .maybeSingle()
  return (data as InvoiceForLines | null) ?? null
}

function pageResults(raw: unknown): Record<string, ReadPageEntry> {
  const pages = (raw as { pages?: Record<string, ReadPageEntry> } | null)?.pages
  return pages && typeof pages === 'object' ? pages : {}
}

// (Re)builds lines for the given pages (default: every page that has a
// reader result). Refuses with 409 code 'crew_entries' if any of those
// pages already has crew entries and confirmReplace isn't set.
export async function buildInvoiceLines(
  db: SupabaseClient,
  invoiceId: string,
  opts: { pages?: number[]; confirmReplace?: boolean } = {}
): Promise<{ ok: true; built: number; pages: number[] } | Fail> {
  const invoice = await loadInvoice(db, invoiceId)
  if (!invoice) return { ok: false, status: 404, error: 'Invoice not found' }
  if (!(EDITABLE_STATUSES as readonly string[]).includes(invoice.status))
    return { ok: false, status: 409, error: 'This invoice is finished and can no longer be changed.' }

  const results = pageResults(invoice.raw_extraction)
  const readPages = Object.keys(results).map(Number).filter((n) => Number.isInteger(n)).sort((a, b) => a - b)
  const pages = (opts.pages ?? readPages).filter((p) => results[String(p)])
  if (pages.length === 0) return { ok: false, status: 400, error: 'No pages have been read yet.' }

  if (!opts.confirmReplace) {
    const touched = await pagesWithCrewEntries(db, invoiceId, pages)
    if (touched === null) return { ok: false, status: 500, error: 'Could not check for saved progress.' }
    if (touched.length > 0)
      return {
        ok: false,
        status: 409,
        code: 'crew_entries',
        pages: touched,
        error: `Page ${touched.join(', ')} already has checked-off lines. Rebuilding will clear what was entered on ${touched.length === 1 ? 'that page' : 'those pages'}.`,
      }
  }

  const items = await loadMatchItems(db)
  if (!items) return { ok: false, status: 500, error: 'Could not load items.' }

  const rows = pages.flatMap((p) => {
    const result = results[String(p)].result as InvoicePageResult
    return (result.lines ?? []).map((l, i) => {
      const m = autoMatch({ vendor_code: l.vendor_code, printed_item_number: l.item_number }, invoice.vendor, items)
      return {
        invoice_id: invoiceId,
        page: p,
        line_no: i + 1,
        vendor_code: l.vendor_code,
        printed_item_number: l.item_number,
        description: l.description,
        invoice_unit: l.invoice_unit,
        qty_ordered: l.qty_ordered,
        qty_shipped: l.qty_shipped,
        ai_note: l.note,
        ai_unsure: !!l.unsure,
        item_id: m.item_id,
        match_method: m.match_method,
        review_reason: m.review_reason,
      }
    })
  })

  const { error: delError } = await db.from('invoice_lines').delete().eq('invoice_id', invoiceId).in('page', pages)
  if (delError) return { ok: false, status: 500, error: 'Could not clear the old lines.' }
  if (rows.length > 0) {
    const { error: insError } = await db.from('invoice_lines').insert(rows)
    if (insError) return { ok: false, status: 500, error: 'Could not save the lines.' }
  }

  // Header fields from what the reader saw (first page that printed them).
  const header: Record<string, string> = {}
  const ordered = readPages.map((p) => results[String(p)].result as InvoicePageResult)
  const num = ordered.find((r) => r.invoice_number)?.invoice_number
  const date = parseInvoiceDate(ordered.find((r) => r.invoice_date)?.invoice_date)
  if (num && num !== invoice.invoice_number) header.invoice_number = num
  if (date && date !== invoice.invoice_date) header.invoice_date = date
  if (Object.keys(header).length) await db.from('invoices').update(header).eq('id', invoiceId).in('status', [...EDITABLE_STATUSES])

  return { ok: true, built: rows.length, pages }
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------
export type ItemSummary = { id: string; name: string; unit: string | null; item_number: string | null; vendor_item_code: string | null; distributor: string | null }

export type EnrichedLine = InvoiceLineRow & {
  item: ItemSummary | null
  case_size: CaseSize
  candidates: ItemSummary[]
  suggestions: { item: ItemSummary; why: Suggestion['why'] }[]
  needs_pick: boolean // unmatched or forced pick, and not skipped
}

export type LinesView = {
  invoice: {
    id: string
    vendor: string
    status: string
    invoice_number: string | null
    invoice_date: string | null
    printed_date: string | null
    page_count: number
    pages_read: number[]
    no_item_pages: number[]
    // Patch 69: how it was finished (status 'received').
    record_only: boolean
    receipt_id: string | null
    received_by: string | null
    received_at: string | null
  }
  totals_check: TotalsCheck
  lines: EnrichedLine[]
  checked_count: number
}

const summary = (i: MatchItem): ItemSummary => ({
  id: i.id, name: i.name, unit: i.unit ?? null, item_number: i.item_number, vendor_item_code: i.vendor_item_code, distributor: i.distributor,
})

export async function listInvoiceLines(db: SupabaseClient, invoiceId: string): Promise<{ ok: true; view: LinesView } | Fail> {
  const invoice = await loadInvoice(db, invoiceId)
  if (!invoice) return { ok: false, status: 404, error: 'Invoice not found' }
  const { data, error } = await db.from('invoice_lines').select(LINE_COLS).eq('invoice_id', invoiceId).order('page').order('line_no')
  if (error) return { ok: false, status: 500, error: 'Could not load the lines.' }
  const items = await loadMatchItems(db)
  if (!items) return { ok: false, status: 500, error: 'Could not load items.' }
  const byId = new Map(items.map((i) => [i.id, i]))

  const lines: EnrichedLine[] = ((data ?? []) as InvoiceLineRow[]).map((l) => {
    const item = l.item_id ? byId.get(l.item_id) ?? null : null
    const unmatched = !item && l.match_method !== 'skipped'
    return {
      ...l,
      qty_ordered: l.qty_ordered == null ? null : Number(l.qty_ordered),
      qty_shipped: l.qty_shipped == null ? null : Number(l.qty_shipped),
      qty_received: l.qty_received == null ? null : Number(l.qty_received),
      units_per_invoice_unit: l.units_per_invoice_unit == null ? null : Number(l.units_per_invoice_unit),
      stock_qty_added: l.stock_qty_added == null ? null : Number(l.stock_qty_added),
      item: item ? summary(item) : null,
      case_size: caseSizeFor(l.units_per_invoice_unit == null ? null : Number(l.units_per_invoice_unit), item),
      candidates: unmatched ? reviewCandidates(l, invoice.vendor, items).map(summary) : [],
      suggestions: unmatched && !l.review_reason ? suggestionsFor(l, invoice.vendor, items).map((s) => ({ item: summary(s.item), why: s.why })) : [],
      needs_pick: unmatched,
    }
  })

  const results = pageResults(invoice.raw_extraction)
  const pagesRead = Object.keys(results).map(Number).sort((a, b) => a - b)
  const first = pagesRead.map((p) => results[String(p)].result as InvoicePageResult).find((r) => r.invoice_date)
  return {
    ok: true,
    view: {
      invoice: {
        id: invoice.id,
        vendor: invoice.vendor,
        status: invoice.status,
        invoice_number: invoice.invoice_number,
        invoice_date: invoice.invoice_date,
        printed_date: first?.invoice_date ?? null,
        page_count: (invoice.photo_paths ?? []).length,
        pages_read: pagesRead,
        no_item_pages: pagesRead.filter((p) => (results[String(p)].result as InvoicePageResult).has_no_items),
        record_only: !!invoice.record_only,
        receipt_id: invoice.receipt_id,
        received_by: invoice.received_by,
        received_at: invoice.received_at,
      },
      totals_check: totalsCheck(results, (invoice.photo_paths ?? []).length),
      lines,
      checked_count: lines.filter((l) => l.checked).length,
    },
  }
}

// ---------------------------------------------------------------------------
// Crew edits
// ---------------------------------------------------------------------------
export type LineUpdate = {
  id: string
  item_id?: string // pick an item (accept a suggestion, choose a candidate, or any item) -> 'manual'
  skip?: boolean // "Not one of our items" -> 'skipped'
  reset_match?: boolean // undo a pick/skip: run the automatic matching again
  qty_received?: number | null
  checked?: boolean
  units_per_invoice_unit?: number | null // case size for THIS line only
}

const MAX_QTY = 100000

function validQty(v: unknown, allowZero: boolean): v is number {
  return typeof v === 'number' && Number.isFinite(v) && (allowZero ? v >= 0 : v > 0) && v <= MAX_QTY
}

export async function updateInvoiceLines(
  db: SupabaseClient,
  invoiceId: string,
  updates: LineUpdate[],
  by: string | null
): Promise<{ ok: true; updated: number } | Fail> {
  if (!Array.isArray(updates) || updates.length === 0) return { ok: false, status: 400, error: 'Nothing to save.' }
  if (updates.length > 500) return { ok: false, status: 400, error: 'Too many lines at once.' }

  const invoice = await loadInvoice(db, invoiceId)
  if (!invoice) return { ok: false, status: 404, error: 'Invoice not found' }
  if (!(EDITABLE_STATUSES as readonly string[]).includes(invoice.status))
    return { ok: false, status: 409, error: 'This invoice is finished and can no longer be changed.' }

  const ids = updates.map((u) => u.id)
  if (ids.some((id) => typeof id !== 'string')) return { ok: false, status: 400, error: 'Bad line id' }
  const { data: existing, error } = await db.from('invoice_lines').select(LINE_COLS).eq('invoice_id', invoiceId).in('id', ids)
  if (error) return { ok: false, status: 500, error: 'Could not load the lines.' }
  const lines = new Map(((existing ?? []) as InvoiceLineRow[]).map((l) => [l.id, l]))
  if (lines.size !== new Set(ids).size) return { ok: false, status: 400, error: 'A line does not belong to this invoice.' }

  let items: MatchItem[] | null = null
  const needItems = updates.some((u) => u.item_id !== undefined || u.reset_match)
  if (needItems) {
    items = await loadMatchItems(db)
    if (!items) return { ok: false, status: 500, error: 'Could not load items.' }
  }

  const now = new Date().toISOString()
  const patches: { id: string; patch: Record<string, unknown> }[] = []
  for (const u of updates) {
    const line = lines.get(u.id)!
    const patch: Record<string, unknown> = {}
    const picks = [u.item_id !== undefined, !!u.skip, !!u.reset_match].filter(Boolean).length
    if (picks > 1) return { ok: false, status: 400, error: 'Choose one: an item, skip, or reset.' }
    if (u.item_id !== undefined) {
      if (typeof u.item_id !== 'string' || !items!.some((i) => i.id === u.item_id)) return { ok: false, status: 400, error: 'That item no longer exists.' }
      Object.assign(patch, { item_id: u.item_id, match_method: 'manual', review_reason: null })
    } else if (u.skip) {
      Object.assign(patch, { item_id: null, match_method: 'skipped', review_reason: null })
    } else if (u.reset_match) {
      Object.assign(patch, autoMatch(line, invoice.vendor, items!))
    }
    if (u.qty_received !== undefined) {
      if (u.qty_received !== null && !validQty(u.qty_received, true)) return { ok: false, status: 400, error: 'Received must be a number, 0 or more.' }
      patch.qty_received = u.qty_received
    }
    if (u.checked !== undefined) {
      if (typeof u.checked !== 'boolean') return { ok: false, status: 400, error: 'Bad checked value' }
      patch.checked = u.checked
    }
    if (u.units_per_invoice_unit !== undefined) {
      if (u.units_per_invoice_unit !== null && !validQty(u.units_per_invoice_unit, false)) return { ok: false, status: 400, error: 'Case size must be a number above 0.' }
      patch.units_per_invoice_unit = u.units_per_invoice_unit
    }
    if (Object.keys(patch).length === 0) continue
    patch.updated_by = by
    patch.updated_at = now
    patches.push({ id: u.id, patch })
  }

  for (const { id, patch } of patches) {
    const { error: upErr } = await db.from('invoice_lines').update(patch).eq('id', id).eq('invoice_id', invoiceId)
    if (upErr) return { ok: false, status: 500, error: 'Could not save. Try again.' }
  }
  return { ok: true, updated: patches.length }
}
