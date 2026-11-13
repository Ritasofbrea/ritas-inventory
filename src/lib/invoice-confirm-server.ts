// Patch 69: confirm an invoice delivery. This is the first step that ADDS
// STOCK from a scanned invoice.
//
//   buildConfirmPlan   what a confirm WOULD do: what blocks it, the stock
//                      each item gets (in OUR stock units), shorts/overs,
//                      codes and case sizes that would be remembered. The
//                      confirm dialog shows exactly this; nothing is written.
//   confirmInvoice     does it: claims the invoice ('read' -> 'received',
//                      one atomic UPDATE, so only one request can win),
//                      saves the receipt through the shared saveReceipt
//                      (patch 64, the same function Receive Order uses),
//                      records shorts the way Receive Order does, links the
//                      receipt, stamps the lines, then learns codes / sizes.
//                      If anything fails after the claim, every stock change
//                      is reversed and the invoice goes back to 'read'.
//   fileRecordOnly     marks the invoice received with NO stock and NO
//                      history rows (already received another way).
//   setInvoiceNumber   lets the crew type the number the reader missed.
//
// Receive Order converts boxes/cases to stock units in the browser; an
// invoice has no browser step, so the conversion happens here:
//   stock units = received (invoice units) x case size (caseSizeFor).
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SessionPayload } from './session-token'
import { caseSizeFor, cleanCode, type MatchItem } from './invoice-matching'
import { LINE_COLS, type InvoiceLineRow } from './invoice-lines-server'
import { saveReceipt, undoReceipt, type AppliedStock } from './receipt-server'
import { getPendingOrders } from './order-status'
import { normalizeVendorCode } from './vendor-code'
import { vendorKeyForItem } from './vendor-schedule'
import { TASK_TZ } from './tasks'

type Fail = { ok: false; status: number; error: string; code?: string; blockers?: Blocker[]; existing_id?: string }

type ConfirmItem = MatchItem & { has_storage: boolean | null }
const ITEM_COLS = 'id, name, distributor, item_number, vendor_item_code, unit, invoice_units_per_case, has_storage'

type InvoiceRow = {
  id: string
  vendor: string
  status: string
  invoice_number: string | null
  record_only: boolean
  receipt_id: string | null
}
const INVOICE_COLS = 'id, vendor, status, invoice_number, record_only, receipt_id'

export type Blocker = {
  kind: 'invoice_number' | 'duplicate' | 'no_lines' | 'unmatched' | 'unchecked' | 'case_size' | 'nothing_to_add'
  message: string
  line_id?: string
  page?: number
  line_no?: number
  existing_id?: string
}

export type PlanItem = {
  item_id: string
  item_name: string
  unit: string
  quantity: number // stock units that will be added
  invoice_qty: number // received, in invoice units, summed over this item's lines
  invoice_unit: string
  has_storage: boolean
}
export type PlanShort = { item_id: string; item_name: string; unit: string; quantity: number }
export type PlanCode = { line_id: string; item_id: string; item_name: string; code: string; vendor_mismatch: boolean }
export type PlanCodeLeftAlone = { line_id: string; item_name: string; code: string; reason: string }
export type PlanSize = { line_id: string; item_id: string; item_name: string; size: number; unit: string; invoice_unit: string }
export type PlanOrder = { id: string; created_at: string; vendor: string | null; item_count: number }

export type ConfirmPlan = {
  invoice: { id: string; vendor: string; status: string; invoice_number: string | null }
  blockers: Blocker[]
  items: PlanItem[]
  shorts: PlanShort[]
  short_lines: number
  over_lines: number
  skipped_lines: number
  learn_codes: PlanCode[]
  codes_left_alone: PlanCodeLeftAlone[]
  remember_sizes: PlanSize[] // offered to OWNERS only (empty for shift leads)
  pending_orders: PlanOrder[]
  default_order_id: string | null
  note: string
  fingerprint: string
}

// What confirm needs per line that the dialog doesn't show.
type LineWrite = { id: string; qty_received: number | null; size: number | null; stock: number; orig_size: number | null }

type Built = { plan: ConfirmPlan; invoice: InvoiceRow; lineWrites: LineWrite[]; pendingIds: Set<string> }

const lineLabel = (l: Pick<InvoiceLineRow, 'page' | 'line_no' | 'description' | 'vendor_code'>) =>
  `Page ${l.page}, line ${l.line_no}: ${l.description || l.vendor_code || 'no description'}`

async function findReceivedDuplicate(db: SupabaseClient, invoice: Pick<InvoiceRow, 'id' | 'vendor' | 'invoice_number'>): Promise<string | null> {
  if (!invoice.invoice_number) return null
  const { data } = await db
    .from('invoices')
    .select('id')
    .eq('vendor', invoice.vendor)
    .eq('invoice_number', invoice.invoice_number)
    .eq('status', 'received')
    .neq('id', invoice.id)
    .limit(1)
  return data && data.length > 0 ? (data[0].id as string) : null
}

const DUPLICATE_MESSAGE = (n: string | null) => `Invoice ${n ?? ''} from this vendor was already received. Nothing was added.`

async function build(db: SupabaseClient, session: SessionPayload, invoiceId: string): Promise<{ ok: true; built: Built } | Fail> {
  const { data: inv, error: invError } = await db.from('invoices').select(INVOICE_COLS).eq('id', invoiceId).maybeSingle()
  if (invError) return { ok: false, status: 500, error: 'Could not load the invoice.' }
  if (!inv) return { ok: false, status: 404, error: 'Invoice not found' }
  const invoice = inv as InvoiceRow

  const { data: lineData, error: lineError } = await db.from('invoice_lines').select(LINE_COLS).eq('invoice_id', invoiceId).order('page').order('line_no')
  if (lineError) return { ok: false, status: 500, error: 'Could not load the lines.' }
  const lines = (lineData ?? []) as InvoiceLineRow[]

  // items is a small, bounded catalog table, well under the 1000-row cap.
  const { data: itemData, error: itemError } = await db.from('items').select(ITEM_COLS)
  if (itemError) return { ok: false, status: 500, error: 'Could not load items.' }
  const items = (itemData ?? []) as ConfirmItem[]
  const byId = new Map(items.map((i) => [i.id, i]))

  const blockers: Blocker[] = []
  if (!invoice.invoice_number || !invoice.invoice_number.trim())
    blockers.push({ kind: 'invoice_number', message: 'This invoice has no invoice number. Type it in at the top before confirming.' })
  else {
    const dup = await findReceivedDuplicate(db, invoice)
    if (dup) blockers.push({ kind: 'duplicate', message: DUPLICATE_MESSAGE(invoice.invoice_number), existing_id: dup })
  }
  if (lines.length === 0) blockers.push({ kind: 'no_lines', message: 'No item lines were read on this invoice.' })

  const planItems = new Map<string, PlanItem>()
  const shorts = new Map<string, PlanShort>()
  const lineWrites: LineWrite[] = []
  const learn: PlanCode[] = []
  const leftAlone: PlanCodeLeftAlone[] = []
  const sizes: PlanSize[] = []
  let shortLines = 0, overLines = 0, skippedLines = 0

  for (const l of lines) {
    const where = { line_id: l.id, page: l.page, line_no: l.line_no }
    const origSize = l.units_per_invoice_unit == null ? null : Number(l.units_per_invoice_unit)
    if (l.match_method === 'skipped') {
      skippedLines++
      lineWrites.push({ id: l.id, qty_received: null, size: null, stock: 0, orig_size: origSize })
      continue
    }
    const item = l.item_id ? byId.get(l.item_id) ?? null : null
    if (!item) {
      blockers.push({ kind: 'unmatched', ...where, message: `${lineLabel(l)} is not matched to one of our items. Pick the item, or mark it "Not one of our items (skip)".` })
      continue
    }
    const received = l.qty_received == null ? null : Number(l.qty_received)
    if (!l.checked || received == null) {
      blockers.push({ kind: 'unchecked', ...where, message: `${lineLabel(l)} is not checked off yet. Enter what was received.` })
      continue
    }
    const cs = caseSizeFor(origSize, item)
    if (cs.size == null) {
      blockers.push({ kind: 'case_size', ...where, message: `${lineLabel(l)} needs a case size (how many ${item.unit ?? 'units'} are in 1 ${l.invoice_unit || 'unit'}).` })
      continue
    }

    // Same math Receive Order does in the browser: typed boxes x pack size.
    const stock = received * cs.size
    lineWrites.push({ id: l.id, qty_received: received, size: cs.size, stock, orig_size: origSize })
    const unit = item.unit ?? ''
    if (stock > 0) {
      const p = planItems.get(item.id)
      if (p) { p.quantity += stock; p.invoice_qty += received }
      else planItems.set(item.id, { item_id: item.id, item_name: item.name, unit, quantity: stock, invoice_qty: received, invoice_unit: l.invoice_unit || 'unit', has_storage: !!item.has_storage })
    }

    const shipped = l.qty_shipped == null ? null : Number(l.qty_shipped)
    if (shipped != null && received < shipped) {
      shortLines++
      const q = (shipped - received) * cs.size
      const s = shorts.get(item.id)
      if (s) s.quantity += q
      else shorts.set(item.id, { item_id: item.id, item_name: item.name, unit, quantity: q })
    } else if (shipped != null && received > shipped) overLines++

    // Learn-once: the printed code of a line a PERSON matched.
    if (l.match_method === 'manual' && cleanCode(l.vendor_code)) {
      const norm = normalizeVendorCode(l.vendor_code)
      const printed = cleanCode(l.vendor_code)
      const own = cleanCode(item.vendor_item_code)
      if (!norm.ok || !norm.code) {
        leftAlone.push({ line_id: l.id, item_name: item.name, code: printed, reason: 'the printed code has characters a vendor code can’t hold' })
      } else if (own === norm.code) {
        // already this item's code: nothing to do, nothing to say
      } else if (own) {
        leftAlone.push({ line_id: l.id, item_name: item.name, code: norm.code, reason: `${item.name} already has code ${item.vendor_item_code}, left alone` })
      } else {
        const other = items.find((i) => i.id !== item.id && cleanCode(i.vendor_item_code) === norm.code)
        const pendingSameItem = learn.find((x) => x.item_id === item.id)
        const pendingSameCode = learn.find((x) => x.code === norm.code && x.item_id !== item.id)
        if (other) leftAlone.push({ line_id: l.id, item_name: item.name, code: norm.code, reason: `that code is already on ${other.name}, left alone` })
        else if (pendingSameItem && pendingSameItem.code !== norm.code) leftAlone.push({ line_id: l.id, item_name: item.name, code: norm.code, reason: `another line on this invoice already gives ${item.name} the code ${pendingSameItem.code}` })
        else if (pendingSameCode) leftAlone.push({ line_id: l.id, item_name: item.name, code: norm.code, reason: `another line on this invoice already gives that code to ${pendingSameCode.item_name}` })
        else learn.push({ line_id: l.id, item_id: item.id, item_name: item.name, code: norm.code, vendor_mismatch: vendorKeyForItem(item.distributor) !== invoice.vendor })
      }
    }

    // A size typed on the line that the item doesn't have yet: owners may
    // choose to remember it on the item.
    if (session.role === 'owner' && cs.source === 'line' && item.invoice_units_per_case == null && !sizes.some((s) => s.item_id === item.id))
      sizes.push({ line_id: l.id, item_id: item.id, item_name: item.name, size: cs.size, unit, invoice_unit: l.invoice_unit || 'unit' })
  }

  const blockingLines = blockers.some((b) => b.kind === 'unmatched' || b.kind === 'unchecked' || b.kind === 'case_size')
  if (lines.length > 0 && !blockingLines && planItems.size === 0)
    blockers.push({ kind: 'nothing_to_add', message: 'Nothing on this invoice would add stock (every line is 0 or skipped). Use "File as record only" instead.' })

  // "Still on order", the one shared definition (order-status.ts), over the
  // same 50 most recent rows Receive Order looks at.
  const { data: orderData } = await db
    .from('order_history')
    .select('id, type, created_at, related_order_id, vendor, canceled_at, order_history_items(item_id)')
    .order('created_at', { ascending: false })
    .limit(50)
  type OrderRow = { id: string; type: string; created_at: string; related_order_id: string | null; vendor: string | null; canceled_at: string | null; order_history_items: { item_id: string }[] }
  const pending = getPendingOrders((orderData ?? []) as OrderRow[])
  const offered = pending.filter((o) => !o.vendor || o.vendor === invoice.vendor).slice(0, 6)
  const sameVendor = offered.filter((o) => o.vendor === invoice.vendor)

  const parts = [shortLines ? `${shortLines} short` : '', overLines ? `${overLines} over` : ''].filter(Boolean)
  const note = `Invoice ${invoice.invoice_number ?? ''}${parts.length ? `: ${parts.join(', ')}` : ''}`.trim()

  const fingerprint = createHash('sha256')
    .update(JSON.stringify({
      n: invoice.invoice_number,
      lines: lines.map((l) => [l.id, l.item_id, l.match_method, l.qty_received == null ? null : Number(l.qty_received), l.checked, l.qty_shipped == null ? null : Number(l.qty_shipped)]),
      add: [...planItems.values()].map((p) => [p.item_id, p.quantity]),
      learn: learn.map((c) => [c.item_id, c.code]),
      left: leftAlone.map((c) => [c.line_id, c.code]),
    }))
    .digest('hex')
    .slice(0, 24)

  return {
    ok: true,
    built: {
      invoice,
      lineWrites,
      pendingIds: new Set(pending.map((o) => o.id)),
      plan: {
        invoice: { id: invoice.id, vendor: invoice.vendor, status: invoice.status, invoice_number: invoice.invoice_number },
        blockers,
        items: [...planItems.values()],
        shorts: [...shorts.values()],
        short_lines: shortLines,
        over_lines: overLines,
        skipped_lines: skippedLines,
        learn_codes: learn,
        codes_left_alone: leftAlone,
        remember_sizes: sizes,
        pending_orders: offered.map((o) => ({ id: o.id, created_at: o.created_at, vendor: o.vendor, item_count: o.order_history_items?.length ?? 0 })),
        default_order_id: sameVendor.length === 1 ? sameVendor[0].id : null,
        note,
        fingerprint,
      },
    },
  }
}

export async function buildConfirmPlan(db: SupabaseClient, session: SessionPayload, invoiceId: string): Promise<{ ok: true; plan: ConfirmPlan } | Fail> {
  const out = await build(db, session, invoiceId)
  return out.ok ? { ok: true, plan: out.built.plan } : out
}

const ALREADY = 'This delivery was already confirmed (maybe on another device). Nothing was added again.'

function notReadFail(invoice: InvoiceRow): Fail | null {
  if (invoice.status === 'received') return { ok: false, status: 409, code: 'already_received', error: ALREADY }
  if (invoice.status !== 'read') return { ok: false, status: 409, code: 'not_read', error: 'Only an invoice that has been read and checked off can be confirmed.' }
  return null
}

// The ONE step that decides who confirms: an UPDATE that only matches while
// the row is still 'read'. Postgres lets exactly one request change the row;
// every other request gets no row back and adds nothing. The unique index
// (one received invoice per vendor + number) is checked by the same UPDATE,
// so a duplicate is refused here, before any stock moves.
async function claim(db: SupabaseClient, invoice: InvoiceRow, by: string | null, recordOnly: boolean): Promise<{ ok: true } | Fail> {
  const { data, error } = await db
    .from('invoices')
    .update({ status: 'received', received_by: by, received_at: new Date().toISOString(), record_only: recordOnly })
    .eq('id', invoice.id)
    .eq('status', 'read')
    .select('id')
  if (error) {
    if (error.code === '23505') {
      const dup = await findReceivedDuplicate(db, invoice)
      return { ok: false, status: 409, code: 'duplicate', error: DUPLICATE_MESSAGE(invoice.invoice_number), existing_id: dup ?? undefined }
    }
    return { ok: false, status: 500, error: 'Could not confirm. Nothing was added. Try again.' }
  }
  if (!data || data.length === 0) return { ok: false, status: 409, code: 'already_received', error: ALREADY }
  return { ok: true }
}

async function unclaim(db: SupabaseClient, invoiceId: string): Promise<void> {
  await db
    .from('invoices')
    .update({ status: 'read', received_by: null, received_at: null, record_only: false, receipt_id: null })
    .eq('id', invoiceId)
    .eq('status', 'received')
}

export type ConfirmOptions = {
  fingerprint?: string | null // from the plan the person looked at
  related_order_id?: string | null // which on-order order this delivery fulfils
  destinations?: Record<string, string> // item_id -> 'storage' (owners, has_storage items only; saveReceipt re-checks)
  remember_sizes?: string[] // line ids whose typed case size an OWNER wants saved on the item
}

export type ConfirmResult =
  | {
      ok: true
      receipt_id: string
      short_id: string | null
      note: string
      items: PlanItem[]
      shorts: PlanShort[]
      codes_learned: PlanCode[]
      codes_left_alone: PlanCodeLeftAlone[]
      sizes_saved: PlanSize[]
    }
  | Fail

export async function confirmInvoice(db: SupabaseClient, session: SessionPayload, invoiceId: string, opts: ConfirmOptions = {}): Promise<ConfirmResult> {
  const out = await build(db, session, invoiceId)
  if (!out.ok) return out
  const { plan, invoice, lineWrites, pendingIds } = out.built

  const notRead = notReadFail(invoice)
  if (notRead) return notRead
  if (plan.blockers.length > 0) {
    const dup = plan.blockers.find((b) => b.kind === 'duplicate')
    if (dup) return { ok: false, status: 409, code: 'duplicate', error: dup.message, existing_id: dup.existing_id, blockers: plan.blockers }
    return { ok: false, status: 400, code: 'blocked', error: 'This invoice is not ready to confirm.', blockers: plan.blockers }
  }
  if (opts.fingerprint && opts.fingerprint !== plan.fingerprint)
    return { ok: false, status: 409, code: 'changed', error: 'This invoice changed since you opened the summary (maybe on another device). Look it over again.' }
  const relatedOrderId = opts.related_order_id || null
  if (relatedOrderId && !pendingIds.has(relatedOrderId))
    return { ok: false, status: 409, code: 'order_gone', error: 'That order is no longer on order. Pick again.' }

  const by = session.name ?? null
  const claimed = await claim(db, invoice, by, false)
  if (!claimed.ok) return claimed

  // From here on, anything that fails runs these in reverse, so a failed
  // confirm leaves stock, history and the invoice exactly as they were.
  const undo: (() => Promise<unknown>)[] = [() => unclaim(db, invoiceId)]
  const fail = async (status: number, error: string): Promise<Fail> => {
    for (const u of undo.reverse()) await u().catch(() => {})
    return { ok: false, status, code: 'failed', error }
  }
  const RETRY = 'Nothing was added and the invoice is unchanged. Please try again.'

  try {
    const destinations = opts.destinations ?? {}
    const receipt = await saveReceipt(db, session, {
      type: 'received',
      notes: plan.note,
      items: plan.items.map((p) => ({
        item_id: p.item_id,
        item_name: p.item_name,
        quantity: p.quantity,
        unit: p.unit,
        destination: destinations[p.item_id] === 'storage' ? 'storage' : 'store',
      })),
      related_order_id: relatedOrderId,
      resolved: true,
      // Receive Order: owners save no name, shift leads save theirs.
      received_by: session.role === 'owner' ? null : by,
    })
    if (!receipt.ok) return await fail(receipt.status, `Could not add the stock (${receipt.error}) ${RETRY}`)
    const receiptId = receipt.order.id as string
    const applied: AppliedStock[] = receipt.applied
    undo.push(() => undoReceipt(db, receiptId, applied))

    // Shorts, recorded the way Receive Order records them: a second row of
    // type 'short', linked to the receipt, unresolved (the Dashboard alert).
    let shortId: string | null = null
    if (plan.shorts.length > 0) {
      const day = new Date().toLocaleDateString('en-US', { timeZone: TASK_TZ })
      const short = await saveReceipt(db, session, {
        type: 'short',
        notes: `Short shipment from delivery on ${day} (invoice ${invoice.invoice_number})`,
        items: plan.shorts.map((s) => ({ item_id: s.item_id, item_name: s.item_name, quantity: s.quantity, unit: s.unit })),
        related_order_id: receiptId,
        resolved: false,
      })
      if (!short.ok) return await fail(500, `Could not record the short items. ${RETRY}`)
      shortId = short.order.id as string
      const sid = shortId
      undo.push(() => undoReceipt(db, sid, []))
    }

    const { data: linked, error: linkError } = await db
      .from('invoices')
      .update({ receipt_id: receiptId, related_order_id: relatedOrderId })
      .eq('id', invoiceId)
      .eq('status', 'received')
      .select('id')
    if (linkError || !linked || linked.length === 0) return await fail(500, `Could not link the receipt to the invoice. ${RETRY}`)

    // Per line: what was received, the conversion used, what went into
    // stock, and who confirmed.
    undo.push(async () => {
      for (const w of lineWrites)
        await db.from('invoice_lines').update({ stock_qty_added: null, confirmed_by: null, units_per_invoice_unit: w.orig_size }).eq('id', w.id).eq('invoice_id', invoiceId)
    })
    const results = await Promise.all(
      lineWrites.map((w) =>
        db
          .from('invoice_lines')
          .update({ qty_received: w.qty_received, units_per_invoice_unit: w.size ?? w.orig_size, stock_qty_added: w.stock, confirmed_by: by })
          .eq('id', w.id)
          .eq('invoice_id', invoiceId)
      )
    )
    if (results.some((r) => r.error)) return await fail(500, `Could not save the confirmed lines. ${RETRY}`)

    // The delivery is confirmed. Learning is extra: a failure here never
    // undoes the delivery, the code or size is simply reported as not saved.
    const codesLearned: PlanCode[] = []
    const codesLeft: PlanCodeLeftAlone[] = [...plan.codes_left_alone]
    for (const c of plan.learn_codes) {
      const { data: clash } = await db.from('items').select('id, name').eq('vendor_item_code', c.code).neq('id', c.item_id).limit(1)
      if (clash && clash.length > 0) {
        codesLeft.push({ line_id: c.line_id, item_name: c.item_name, code: c.code, reason: `that code is already on ${clash[0].name}, left alone` })
        continue
      }
      // Only lands if the item STILL has no code (never overwrites).
      const { data: saved, error } = await db.from('items').update({ vendor_item_code: c.code }).eq('id', c.item_id).is('vendor_item_code', null).select('id')
      if (error || !saved || saved.length === 0) {
        codesLeft.push({ line_id: c.line_id, item_name: c.item_name, code: c.code, reason: `${c.item_name} got a code in the meantime, left alone` })
        continue
      }
      await db.from('invoice_lines').update({ code_learned: true }).eq('id', c.line_id).eq('invoice_id', invoiceId)
      codesLearned.push(c)
    }

    const sizesSaved: PlanSize[] = []
    if (session.role === 'owner') {
      const wanted = new Set(Array.isArray(opts.remember_sizes) ? opts.remember_sizes : [])
      for (const s of plan.remember_sizes) {
        if (!wanted.has(s.line_id)) continue
        const { data: saved, error } = await db.from('items').update({ invoice_units_per_case: s.size }).eq('id', s.item_id).is('invoice_units_per_case', null).select('id')
        if (!error && saved && saved.length > 0) sizesSaved.push(s)
      }
    }

    return { ok: true, receipt_id: receiptId, short_id: shortId, note: plan.note, items: plan.items, shorts: plan.shorts, codes_learned: codesLearned, codes_left_alone: codesLeft, sizes_saved: sizesSaved }
  } catch {
    return await fail(500, `Something went wrong while confirming. ${RETRY}`)
  }
}

// "File as record only": received another way already. Marks the invoice
// received (so the duplicate guard protects its number) and keeps the
// photos and the check-off as proof. NO stock, NO order_history rows, NO
// changes to the lines or to any item.
export async function fileRecordOnly(db: SupabaseClient, session: SessionPayload, invoiceId: string): Promise<{ ok: true } | Fail> {
  const { data: inv, error } = await db.from('invoices').select(INVOICE_COLS).eq('id', invoiceId).maybeSingle()
  if (error) return { ok: false, status: 500, error: 'Could not load the invoice.' }
  if (!inv) return { ok: false, status: 404, error: 'Invoice not found' }
  const invoice = inv as InvoiceRow
  const notRead = notReadFail(invoice)
  if (notRead) return notRead
  if (!invoice.invoice_number || !invoice.invoice_number.trim())
    return { ok: false, status: 400, code: 'blocked', error: 'This invoice has no invoice number. Type it in at the top first.', blockers: [{ kind: 'invoice_number', message: 'This invoice has no invoice number. Type it in at the top first.' }] }
  const dup = await findReceivedDuplicate(db, invoice)
  if (dup) return { ok: false, status: 409, code: 'duplicate', error: DUPLICATE_MESSAGE(invoice.invoice_number), existing_id: dup }
  return claim(db, invoice, session.name ?? null, true)
}

export const INVOICE_NUMBER_MAX = 40

// The reader couldn't get the invoice number (or got it wrong): the crew
// types it. Only while the invoice is still 'read'.
export async function setInvoiceNumber(db: SupabaseClient, invoiceId: string, raw: unknown): Promise<{ ok: true; invoice_number: string } | Fail> {
  if (typeof raw !== 'string') return { ok: false, status: 400, error: 'Type the invoice number.' }
  const number = raw.replace(/\s+/g, '').toUpperCase()
  if (!number) return { ok: false, status: 400, error: 'Type the invoice number.' }
  if (!/^[A-Z0-9-]+$/.test(number)) return { ok: false, status: 400, error: 'Use only letters, numbers and hyphens.' }
  if (number.length > INVOICE_NUMBER_MAX) return { ok: false, status: 400, error: `An invoice number can be at most ${INVOICE_NUMBER_MAX} characters.` }
  const { data, error } = await db.from('invoices').update({ invoice_number: number }).eq('id', invoiceId).eq('status', 'read').select('id')
  if (error) return { ok: false, status: 500, error: 'Could not save the invoice number.' }
  if (!data || data.length === 0) return { ok: false, status: 409, error: 'This invoice can no longer be changed.' }
  return { ok: true, invoice_number: number }
}
