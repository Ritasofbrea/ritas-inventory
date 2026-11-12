// Patch 65: one invoice page read, end to end, for POST /api/invoices/read.
// The route only does auth + body parsing and calls runInvoicePageRead.
// Tests call runInvoicePageRead directly with a fake reader so the normal
// suite never calls the real Anthropic API.
//
// invoices.raw_extraction shape (JSONB, no schema change needed):
//   {
//     model: string | null,            // model of the latest successful read
//     rev: number,                     // bumped on every write (compare-and-swap)
//     last_attempt_at: string | null,  // ISO, lets the cost caps find recent reads fast
//     pages: { "1": PageEntry, ... },  // latest successful result per page
//     attempts: Attempt[]              // every read attempt (the cost ledger)
//   }
// No invoice_lines rows are written here -- that's patch 66.
import type { SupabaseClient } from '@supabase/supabase-js'
import { INVOICE_PHOTO_BUCKET, MAX_INVOICE_PAGES, invoicePagePath } from './invoice-constants'
import {
  INVOICE_DAILY_READ_CAP,
  isInvoiceDailyReadCapReached,
  isInvoiceReadRateLimited,
} from './rate-limit'
import {
  invoiceReadModel,
  readInvoicePage,
  type InvoicePageResult,
  type ReadPageErr,
  type ReadPageInput,
  type ReadPageOk,
} from './invoice-reader'

// Each page can be read at most twice (one read + one retry). Busy
// (overloaded, not billed) attempts don't use up a read.
export const MAX_READS_PER_PAGE = 2

export type ReadAttempt = {
  page: number
  at: string
  model: string
  outcome: 'pending' | 'ok' | 'busy' | 'failed'
}

export type ReadPageEntry = {
  model: string
  read_at: string
  ms: number
  usage: { input_tokens: number; output_tokens: number }
  result: InvoicePageResult
}

export type RawExtraction = {
  model: string | null
  rev: number
  last_attempt_at: string | null
  pages: Record<string, ReadPageEntry>
  attempts: ReadAttempt[]
}

export type TotalsCheck = {
  // match: lines add up to the printed total. mismatch: they don't (warning only).
  // incomplete: a line on a page read so far has a blank quantity, so the sum can't be trusted.
  // no_printed_total: no page read so far prints a usable total.
  status: 'match' | 'mismatch' | 'incomplete' | 'no_printed_total'
  pages_read: number
  pages_total: number
  compared: 'shipped' | 'ordered' | null
  printed_total: number | null
  lines_total: number | null
  warning: string | null
}

export type InvoiceReader = (input: ReadPageInput) => Promise<ReadPageOk | ReadPageErr>

export type RunReadDeps = {
  reader?: InvoiceReader
  model?: string
  dailyCap?: number
  now?: () => number
}

export type RunReadResult =
  | {
      ok: true
      invoice_id: string
      page: number
      status: string
      result: InvoicePageResult
      model: string
      reads_used: number
      reads_left: number
      totals_check: TotalsCheck
    }
  | { ok: false; status: number; error: string }

// The route's maxDuration is 60s (Vercel Hobby without Fluid compute caps
// functions at 60s; with Fluid compute it's 300s, so 60 fits either way).
// The reader must finish by this point, leaving time to save.
export const READ_DEADLINE_MS = 50_000

function normalizeRaw(raw: unknown): RawExtraction {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<RawExtraction>
  return {
    model: typeof r.model === 'string' ? r.model : null,
    rev: typeof r.rev === 'number' ? r.rev : 0,
    last_attempt_at: typeof r.last_attempt_at === 'string' ? r.last_attempt_at : null,
    pages: r.pages && typeof r.pages === 'object' ? r.pages : {},
    attempts: Array.isArray(r.attempts) ? r.attempts : [],
  }
}

export function readsUsedForPage(raw: RawExtraction, page: number): number {
  return raw.attempts.filter((a) => a.page === page && a.outcome !== 'busy').length
}

type InvoiceRow = { id: string; vendor: string; status: string; photo_paths: string[] | null; raw_extraction: unknown }

// Compare-and-swap write: only lands if nobody else wrote raw_extraction
// since we read it (rev unchanged) and the invoice is still draft/read.
async function casWrite(
  db: SupabaseClient,
  id: string,
  prevRaw: unknown,
  prevRev: number,
  next: RawExtraction,
  extra: Record<string, unknown> = {}
): Promise<boolean> {
  let q = db.from('invoices').update({ raw_extraction: next, ...extra }).eq('id', id).in('status', ['draft', 'read'])
  q = prevRaw === null || prevRaw === undefined ? q.is('raw_extraction', null) : q.eq('raw_extraction->>rev', String(prevRev))
  const { data, error } = await q.select('id')
  if (error) return false
  return (data?.length ?? 0) === 1
}

async function loadInvoice(db: SupabaseClient, id: string): Promise<InvoiceRow | null> {
  const { data } = await db
    .from('invoices')
    .select('id, vendor, status, photo_paths, raw_extraction')
    .eq('id', id)
    .maybeSingle()
  return (data as InvoiceRow | null) ?? null
}

export async function runInvoicePageRead(
  db: SupabaseClient,
  input: { invoiceId: string; page: number },
  deps: RunReadDeps = {}
): Promise<RunReadResult> {
  const now = deps.now ?? Date.now
  const startedAt = now()
  const model = deps.model ?? invoiceReadModel()
  const reader: InvoiceReader = deps.reader ?? ((i) => readInvoicePage(i, { model }))
  const { invoiceId, page } = input

  if (!Number.isInteger(page) || page < 1 || page > MAX_INVOICE_PAGES)
    return { ok: false, status: 400, error: `Page must be 1 to ${MAX_INVOICE_PAGES}` }

  const invoice = await loadInvoice(db, invoiceId)
  if (!invoice) return { ok: false, status: 404, error: 'Invoice not found' }
  if (invoice.status !== 'draft' && invoice.status !== 'read')
    return { ok: false, status: 409, error: 'This invoice is finished and can no longer be read.' }
  const photoPaths = invoice.photo_paths ?? []
  const path = invoicePagePath(invoiceId, page)
  if (!photoPaths.includes(path)) return { ok: false, status: 400, error: `This invoice has no page ${page}.` }

  let raw = normalizeRaw(invoice.raw_extraction)
  if (readsUsedForPage(raw, page) >= MAX_READS_PER_PAGE)
    return { ok: false, status: 429, error: `Page ${page} has already been read ${MAX_READS_PER_PAGE} times. Retake the photo as a new scan if it still reads wrong.` }

  // App-wide cost caps (fail closed if they can't be checked).
  if (await isInvoiceReadRateLimited(db))
    return { ok: false, status: 429, error: 'Too many invoice reads in a short time. Try again in a few minutes.' }
  if (await isInvoiceDailyReadCapReached(db, deps.dailyCap ?? INVOICE_DAILY_READ_CAP))
    return { ok: false, status: 429, error: 'The daily limit for reading invoices has been reached. Try again tomorrow.' }

  // Reserve the attempt BEFORE calling the API, so two taps at once can't
  // both get past the per-page cap and the attempt counts toward the caps
  // even if this request dies mid-call.
  const attemptAt = new Date(now()).toISOString()
  const attempt: ReadAttempt = { page, at: attemptAt, model, outcome: 'pending' }
  const reserved: RawExtraction = {
    ...raw,
    rev: raw.rev + 1,
    last_attempt_at: attemptAt,
    attempts: [...raw.attempts, attempt],
  }
  if (!(await casWrite(db, invoiceId, invoice.raw_extraction, raw.rev, reserved)))
    return { ok: false, status: 409, error: 'This invoice is being read on another device. Wait a moment and try again.' }
  raw = reserved

  // Photo stays on the server: downloaded here, sent to the API, never returned.
  const { data: blob, error: dlError } = await db.storage.from(INVOICE_PHOTO_BUCKET).download(path)
  let outcome: Awaited<ReturnType<InvoiceReader>>
  if (dlError || !blob) {
    outcome = { ok: false, kind: 'failed', error: "Couldn't load this page's photo. Try again.", api_calls: 0 }
  } else {
    const imageJpeg = Buffer.from(await blob.arrayBuffer())
    outcome = await reader({ imageJpeg, vendorHint: invoice.vendor, deadlineMs: startedAt + READ_DEADLINE_MS })
  }

  // Save: settle the attempt, store the page result, flip to 'read' when
  // every page has one. Retries a few times if another page's read lands
  // at the same moment (each retry re-reads the row and re-applies).
  for (let tryNo = 0; tryNo < 4; tryNo++) {
    const fresh = tryNo === 0 ? null : await loadInvoice(db, invoiceId)
    if (tryNo > 0 && !fresh) return { ok: false, status: 404, error: 'Invoice not found' }
    const baseRow = fresh ?? { ...invoice, raw_extraction: raw }
    const base = normalizeRaw(baseRow.raw_extraction)
    const attempts = base.attempts.map((a) =>
      a.page === page && a.at === attemptAt && a.outcome === 'pending'
        ? { ...a, model: outcome.ok ? outcome.model : a.model, outcome: outcome.ok ? ('ok' as const) : outcome.kind === 'busy' ? ('busy' as const) : ('failed' as const) }
        : a
    )
    const pages = { ...base.pages }
    if (outcome.ok) {
      pages[String(page)] = {
        model: outcome.model,
        read_at: new Date(now()).toISOString(),
        ms: outcome.ms,
        usage: outcome.usage,
        result: outcome.result,
      }
    }
    const next: RawExtraction = {
      ...base,
      rev: base.rev + 1,
      model: outcome.ok ? outcome.model : base.model,
      pages,
      attempts,
    }
    const allRead = photoPaths.every((_, i) => pages[String(i + 1)])
    const extra: Record<string, unknown> = {}
    if (outcome.ok) extra.read_model = outcome.model
    if (allRead) extra.status = 'read'
    if (await casWrite(db, invoiceId, baseRow.raw_extraction, base.rev, next, extra)) {
      if (!outcome.ok) {
        const status = outcome.kind === 'busy' ? 503 : outcome.kind === 'not_configured' ? 500 : 502
        return { ok: false, status, error: outcome.error }
      }
      const used = readsUsedForPage(next, page)
      return {
        ok: true,
        invoice_id: invoiceId,
        page,
        status: allRead ? 'read' : baseRow.status,
        result: outcome.result,
        model: outcome.model,
        reads_used: used,
        reads_left: Math.max(0, MAX_READS_PER_PAGE - used),
        totals_check: totalsCheck(pages, photoPaths.length),
      }
    }
    // Lost the race (or the invoice moved past draft/read). Re-check status.
    const check = await loadInvoice(db, invoiceId)
    if (!check) return { ok: false, status: 404, error: 'Invoice not found' }
    if (check.status !== 'draft' && check.status !== 'read')
      return { ok: false, status: 409, error: 'This invoice was finished while the page was being read.' }
  }
  return { ok: false, status: 409, error: "The page was read but couldn't be saved. Try again." }
}

// Soft check: do the lines on the pages read so far add up to a printed
// total? Never blocks anything; a mismatch only adds a warning.
export function totalsCheck(pages: Record<string, ReadPageEntry>, pagesTotal: number): TotalsCheck {
  const entries = Object.values(pages)
  const lines = entries.flatMap((e) => e.result.lines)
  let printedShipped: number | null = null
  let printedOrdered: number | null = null
  for (const e of entries) {
    const t = e.result.printed_totals
    if (t.total_shipped != null) printedShipped = t.total_shipped
    else if (t.total_units != null) printedShipped = printedShipped ?? t.total_units
    if (t.total_ordered != null) printedOrdered = t.total_ordered
  }
  const base = { pages_read: entries.length, pages_total: pagesTotal }
  const compared: 'shipped' | 'ordered' | null = printedShipped != null ? 'shipped' : printedOrdered != null ? 'ordered' : null
  if (!compared)
    return { ...base, status: 'no_printed_total', compared: null, printed_total: null, lines_total: null, warning: null }
  const printed = compared === 'shipped' ? printedShipped! : printedOrdered!
  const qtys = lines.map((l) => (compared === 'shipped' ? l.qty_shipped : l.qty_ordered))
  if (qtys.some((q) => q == null))
    return {
      ...base,
      status: 'incomplete',
      compared,
      printed_total: printed,
      lines_total: null,
      warning: `Some ${compared} quantities couldn't be read, so the lines can't be checked against the printed total of ${printed}.`,
    }
  const sum = qtys.reduce<number>((s, q) => s + (q as number), 0)
  if (Math.abs(sum - printed) < 1e-9)
    return { ...base, status: 'match', compared, printed_total: printed, lines_total: sum, warning: null }
  const missingPages = entries.length < pagesTotal ? ` Only ${entries.length} of ${pagesTotal} pages have been read so far.` : ''
  return {
    ...base,
    status: 'mismatch',
    compared,
    printed_total: printed,
    lines_total: sum,
    warning: `The ${compared} quantities on the lines add up to ${sum}, but the invoice prints a total of ${printed}.${missingPages} Check the lines before receiving.`,
  }
}
