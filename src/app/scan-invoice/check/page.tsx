'use client'

// Patch 68: invoice check-off screen (/scan-invoice/check?id=<invoice id>).
// Owners and shift leads (every API call enforces this too).
//   - header: vendor, invoice number, date, and the soft totals check
//   - lines that need a person (unmatched / "needs a look") first, each with
//     a "Which item is this?" picker
//   - one card per line: description, our matched item and how, ordered /
//     shipped, case size, the reader's unsure note, page + full-screen photo
//   - Received starts blank: +/- buttons, type a number, or "Matches invoice"
//   - sticky bar: "X of Y lines checked" + Save Progress + Confirm Delivery
//   - Discard Invoice (with a confirmation)
// Patch 69: Confirm Delivery ADDS STOCK (server: /api/invoices/confirm).
//   - blocked until every line is checked or skipped and there is an invoice
//     number; the blocking lines are listed by name
//   - a summary dialog first (stock per item in our units, short / over /
//     skipped, codes that will be remembered), built by the server
//   - "File as record only": marks it received, adds no stock
//   - once received the screen is a read-only summary; photos still open

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { unitLabel } from '@/lib/units'
import { useBlockReload } from '@/lib/reload-guard'

type ItemSummary = { id: string; name: string; unit: string | null; item_number: string | null; vendor_item_code: string | null; distributor: string | null }
type CaseSize = { size: number | null; source: 'line' | 'item' | 'box_counted' | 'unknown' }
type Line = {
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
  item_id: string | null
  match_method: 'vendor_code' | 'item_number' | 'manual' | 'skipped' | 'none' | 'description_confirmed'
  review_reason: 'shared_code' | 'code_number_conflict' | null
  ai_note: string | null
  ai_unsure: boolean
  checked: boolean
  stock_qty_added: number | null
  code_learned: boolean
  confirmed_by: string | null
  item: ItemSummary | null
  case_size: CaseSize
  candidates: ItemSummary[]
  suggestions: { item: ItemSummary; why: 'balford_part' | 'description' }[]
  needs_pick: boolean
}
type TotalsCheck = {
  status: 'match' | 'mismatch' | 'incomplete' | 'no_printed_total'
  pages_read: number
  pages_total: number
  compared: 'shipped' | 'ordered' | null
  printed_total: number | null
  lines_total: number | null
  warning: string | null
}
type View = {
  invoice: { id: string; vendor: string; status: string; invoice_number: string | null; invoice_date: string | null; printed_date: string | null; page_count: number; pages_read: number[]; no_item_pages: number[]; record_only: boolean; receipt_id: string | null; received_by: string | null; received_at: string | null }
  totals_check: TotalsCheck
  lines: Line[]
  checked_count: number
}
// Patch 69: the server's confirm plan (GET /api/invoices/confirm).
type Blocker = { kind: string; message: string; line_id?: string; existing_id?: string }
type PlanCode = { line_id: string; item_id: string; item_name: string; code: string; vendor_mismatch: boolean }
type PlanCodeLeft = { line_id: string; item_name: string; code: string; reason: string }
type PlanSize = { line_id: string; item_id: string; item_name: string; size: number; unit: string; invoice_unit: string }
type Plan = {
  invoice: { id: string; vendor: string; status: string; invoice_number: string | null }
  blockers: Blocker[]
  items: { item_id: string; item_name: string; unit: string; quantity: number; invoice_qty: number; invoice_unit: string; has_storage: boolean }[]
  shorts: { item_id: string; item_name: string; unit: string; quantity: number }[]
  short_lines: number
  over_lines: number
  skipped_lines: number
  learn_codes: PlanCode[]
  codes_left_alone: PlanCodeLeft[]
  remember_sizes: PlanSize[]
  pending_orders: { id: string; created_at: string; vendor: string | null; item_count: number }[]
  default_order_id: string | null
  note: string
  fingerprint: string
}
type ConfirmDone = { codes_learned: PlanCode[]; codes_left_alone: PlanCodeLeft[]; sizes_saved: PlanSize[]; shorts: Plan['shorts'] }
type Edit = { qty_received?: number | null; checked?: boolean; units_per_invoice_unit?: number | null }
type AnyItem = { id: string; name: string; distributor: string | null; item_number: string | null; unit: string | null; category: string }

const VENDOR_LABELS: Record<string, string> = { bunzl: 'Bunzl', balford: 'Balford', other: 'Other' }
const HOW: Record<string, string> = { vendor_code: 'by vendor code', item_number: 'by item number', manual: 'picked by hand', description_confirmed: 'picked by hand' }
const BADGE = 'inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border border-gray-400 text-gray-700 bg-white'

const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

const fmt = (n: number | null) => (n == null ? '—' : Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100))

function parseQty(s: string): number | null | 'bad' {
  const t = s.trim()
  if (t === '') return null
  if (!/^\d*\.?\d*$/.test(t)) return 'bad'
  const n = Number(t)
  return Number.isFinite(n) ? n : 'bad'
}

function CheckOff() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const [allowed, setAllowed] = useState(false)
  const [view, setView] = useState<View | null>(null)
  const [loadError, setLoadError] = useState('')
  const [items, setItems] = useState<AnyItem[]>([])
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({}) // raw text in Received boxes
  const [sizeDrafts, setSizeDrafts] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const [pickSearch, setPickSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [picking, setPicking] = useState(false)
  const [photo, setPhoto] = useState<{ page: number; url: string | null } | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set()) // saved+checked lines opened for editing
  // Patch 69
  const [role, setRole] = useState<string | null>(null)
  const [blockers, setBlockers] = useState<Blocker[]>([])
  const [plan, setPlan] = useState<Plan | null>(null) // open = the confirm dialog is showing
  const [preparing, setPreparing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [orderChoice, setOrderChoice] = useState<string | null>(null)
  const [destinations, setDestinations] = useState<Record<string, 'store' | 'storage'>>({})
  const [rememberSizes, setRememberSizes] = useState<Set<string>>(new Set())
  const [recordOpen, setRecordOpen] = useState(false)
  const [numberDraft, setNumberDraft] = useState('')
  const [savingNumber, setSavingNumber] = useState(false)
  const [done, setDone] = useState<ConfirmDone | null>(null)

  const dirty = Object.keys(edits).length > 0
  // No silent auto-reload while a confirm dialog is open or saving.
  useBlockReload(plan !== null || recordOpen || confirming)

  const load = useCallback(async () => {
    setLoadError('')
    const res = await fetch(`/api/invoices/lines?invoice_id=${encodeURIComponent(id)}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { setLoadError(body.error || 'Could not open this invoice.'); return }
    let v = body as View
    // Read before lines existed (or lines missing): build them once.
    if (v.lines.length === 0 && v.invoice.pages_read.length > 0 && v.invoice.status === 'read') {
      const b = await fetch('/api/invoices/lines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice_id: id }) })
      if (b.ok) {
        const again = await fetch(`/api/invoices/lines?invoice_id=${encodeURIComponent(id)}`)
        if (again.ok) v = (await again.json()) as View
      }
    }
    setView(v)
  }, [id])

  useEffect(() => {
    const r = getRole()
    if (!r) { router.replace('/login'); return }
    if (r !== 'owner' && r !== 'shift_lead') { router.replace('/login'); return }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: resolve role once on mount, this app's standard page-load pattern
    setAllowed(true)
    setRole(r)
    load()
    fetch('/api/items').then((res) => (res.ok ? res.json() : [])).then(setItems).catch(() => {})
  }, [router, load])

  // Unsaved work: warn before leaving the page.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const lines = useMemo(() => {
    if (!view) return []
    return view.lines.map((l) => ({ ...l, ...edits[l.id] }))
  }, [view, edits])

  const editable = view?.invoice.status === 'read' || view?.invoice.status === 'draft'
  const countable = lines.filter((l) => l.match_method !== 'skipped')
  const checkedCount = countable.filter((l) => l.checked).length
  const needPick = lines.filter((l) => l.needs_pick)
  const ordered = [
    ...lines.filter((l) => l.needs_pick && l.review_reason),
    ...lines.filter((l) => l.needs_pick && !l.review_reason),
    ...lines.filter((l) => !l.needs_pick && l.match_method !== 'skipped'),
    ...lines.filter((l) => l.match_method === 'skipped'),
  ]

  const setEdit = (lineId: string, e: Edit) => {
    setMessage('')
    setEdits((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...e } }))
  }

  const setReceived = (l: Line, qty: number | null) => {
    setDrafts((d) => ({ ...d, [l.id]: qty == null ? '' : fmt(qty) }))
    setEdit(l.id, { qty_received: qty, checked: qty != null })
  }

  // Returns true when everything typed is saved (or there was nothing to save).
  const saveProgress = async (): Promise<boolean> => {
    if (saving) return false
    if (!dirty) return true
    setSaving(true)
    setError('')
    try {
      const updates = Object.entries(edits).map(([lineId, e]) => ({ id: lineId, ...e }))
      const res = await fetch('/api/invoices/lines', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice_id: id, updates }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not save. Try again.')
      setEdits({})
      await load()
      setMessage('Progress saved. You can leave and come back.')
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.')
      return false
    } finally {
      setSaving(false)
    }
  }

  // ---- Patch 69: confirm ----
  const toTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })

  // Confirm Delivery tap: save what's typed, ask the server what a confirm
  // would do, then either list what blocks it or open the summary dialog.
  const openConfirm = async () => {
    if (preparing || confirming) return
    setPreparing(true)
    setError('')
    setMessage('')
    try {
      if (!(await saveProgress())) return
      const res = await fetch(`/api/invoices/confirm?invoice_id=${encodeURIComponent(id)}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not check this invoice. Try again.')
      const p = body as Plan
      if (p.invoice.status !== 'read') { await load(); return }
      setBlockers(p.blockers)
      if (p.blockers.length > 0) { setPlan(null); toTop(); return }
      setOrderChoice(p.default_order_id)
      setDestinations({})
      setRememberSizes(new Set())
      setPlan(p)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check this invoice. Try again.')
      toTop()
    } finally {
      setPreparing(false)
    }
  }

  // Shared by "Yes, add stock" and "Yes, file it". The button is disabled
  // while this runs; the server also guarantees stock is added only once.
  const sendConfirm = async (payload: Record<string, unknown>, recordOnly: boolean) => {
    if (confirming) return
    setConfirming(true)
    setError('')
    setMessage('') // "Progress saved" must not sit above the confirmed summary
    try {
      const res = await fetch('/api/invoices/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice_id: id, ...payload }) })
      const body = await res.json().catch(() => ({}))
      setPlan(null)
      setRecordOpen(false)
      if (!res.ok) {
        if (Array.isArray(body.blockers) && body.blockers.length > 0) setBlockers(body.blockers)
        else if (body.code === 'duplicate') setBlockers([{ kind: 'duplicate', message: body.error, existing_id: body.existing_id }])
        else setError(body.error || 'Could not confirm. Nothing was added. Try again.')
        await load()
        toTop()
        return
      }
      setBlockers([])
      setEdits({})
      if (!recordOnly) {
        setDone(body as ConfirmDone)
        // Same owner push Receive Order sends after a receipt.
        const shortCount = (body.shorts ?? []).length
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        fetch('/api/send-push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(shortCount > 0
            ? { title: 'Short Shipment', body: `${shortCount} item${shortCount !== 1 ? 's' : ''} not received — check the dashboard` }
            : { title: 'Order Received', body: `An order was marked received at ${time}` }),
        }).catch(() => {})
      }
      await load()
      toTop()
    } catch {
      setPlan(null)
      setRecordOpen(false)
      setError('Could not reach the server. Check this invoice again before retrying: open it from Scan Invoice to see whether it was confirmed.')
      await load().catch(() => {})
      toTop()
    } finally {
      setConfirming(false)
    }
  }

  const confirmDelivery = () => {
    if (!plan) return
    sendConfirm({ mode: 'confirm', fingerprint: plan.fingerprint, related_order_id: orderChoice, destinations, remember_sizes: [...rememberSizes] }, false)
  }

  const openRecordOnly = async () => {
    setError('')
    setMessage('')
    if (!(await saveProgress())) return
    setRecordOpen(true)
  }

  const saveNumber = async () => {
    if (savingNumber || !numberDraft.trim()) return
    setSavingNumber(true)
    setError('')
    try {
      const res = await fetch('/api/invoices/confirm', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice_id: id, invoice_number: numberDraft }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not save the invoice number.')
      setNumberDraft('')
      setBlockers((b) => b.filter((x) => x.kind !== 'invoice_number'))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the invoice number.')
    } finally {
      setSavingNumber(false)
    }
  }

  // Picks and skips save right away (they change what the line is).
  const pick = async (lineId: string, update: { item_id?: string; skip?: boolean; reset_match?: boolean }) => {
    setPicking(true)
    setError('')
    try {
      const res = await fetch('/api/invoices/lines', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ invoice_id: id, updates: [{ id: lineId, ...update }] }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not save that choice.')
      await load() // refresh first, so the picker never closes onto stale lines
      setPickerFor(null)
      setPickSearch('')
      setShowAll(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that choice.')
    } finally {
      setPicking(false)
    }
  }

  const openPhoto = async (page: number) => {
    setPhoto({ page, url: null })
    const res = await fetch(`/api/invoices?id=${encodeURIComponent(id)}`)
    const body = await res.json().catch(() => ({}))
    const url = res.ok ? (body.pages as { page: number; url: string | null }[]).find((p) => p.page === page)?.url ?? null : null
    setPhoto({ page, url: url ?? '' })
  }

  const discard = async () => {
    setDiscarding(true)
    setError('')
    try {
      const res = await fetch('/api/invoices', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not discard.')
      setEdits({})
      router.replace('/scan-invoice')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not discard.')
      setDiscardOpen(false)
    } finally {
      setDiscarding(false)
    }
  }

  const goBack = () => {
    if (dirty && !window.confirm('You have unsaved changes. Leave without saving?')) return
    router.push('/scan-invoice')
  }

  if (!allowed) return null

  if (loadError || !view) {
    return (
      <div className="min-h-screen flex flex-col bg-[#d4edda]">
        <Navigation />
        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
          <button onClick={() => router.push('/scan-invoice')} className="text-sm text-gray-500 mb-2">← Scan Invoice</button>
          <p className="text-gray-600">{loadError || 'Loading…'}</p>
        </main>
      </div>
    )
  }

  const inv = view.invoice
  const t = view.totals_check
  const pickerLine = pickerFor ? lines.find((l) => l.id === pickerFor) ?? null : null
  const received = inv.status === 'received'
  // What each item got, from the confirmed lines (read-only summary).
  const added = new Map<string, { name: string; unit: string; qty: number }>()
  for (const l of view.lines) {
    if (!l.item || !l.stock_qty_added) continue
    const a = added.get(l.item.id)
    if (a) a.qty += l.stock_qty_added
    else added.set(l.item.id, { name: l.item.name, unit: l.item.unit ?? '', qty: l.stock_qty_added })
  }
  const blockedLineIds = new Set(blockers.map((b) => b.line_id).filter(Boolean))

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />
      <main className={`flex-1 max-w-2xl mx-auto w-full px-4 pt-6 ${editable ? 'pb-44' : 'pb-10'}`}>
        <button onClick={goBack} className="text-sm text-gray-500 hover:text-gray-700 mb-2 flex items-center gap-1">← Scan Invoice</button>

        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4" data-testid="checkoff-header">
          <h1 className="text-xl font-bold text-gray-900">
            {VENDOR_LABELS[inv.vendor] ?? inv.vendor} invoice{inv.invoice_number ? ` #${inv.invoice_number}` : ''}
          </h1>
          <p className="text-sm text-gray-500">
            {inv.printed_date ? `Dated ${inv.printed_date}` : 'No date read'} · {inv.page_count} page{inv.page_count === 1 ? '' : 's'}
            {!editable && ` · ${inv.status}`}
          </p>
          <p className="text-sm mt-2 text-gray-800" data-testid="totals-line">
            {t.status === 'match' && <>✓ Lines add up to {fmt(t.lines_total)} of {fmt(t.printed_total)} {t.compared} units</>}
            {t.status === 'mismatch' && <>⚠ {t.warning}</>}
            {t.status === 'incomplete' && <>⚠ {t.warning}</>}
            {t.status === 'no_printed_total' && <span className="text-gray-500">No printed total on these pages to check against.</span>}
          </p>
          {inv.no_item_pages.length > 0 && (
            <p className="text-xs text-gray-500 mt-1">Page {inv.no_item_pages.join(', ')} had no items (totals or fine print only). That&apos;s normal.</p>
          )}
          {editable && !inv.invoice_number && (
            <div className="mt-3 border border-gray-400 rounded-xl p-3" data-testid="number-entry">
              <p className="text-sm font-semibold text-gray-900">The invoice number couldn&apos;t be read. Type it from the paper.</p>
              <p className="text-xs text-gray-500">It is needed so the same invoice can&apos;t be received twice.</p>
              <div className="flex gap-2 mt-2">
                <input
                  type="text"
                  aria-label="Invoice number"
                  value={numberDraft}
                  onChange={(e) => setNumberDraft(e.target.value)}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  className="flex-1 min-w-0 min-h-[48px] border border-gray-300 rounded-xl px-3 text-base text-gray-900"
                  placeholder="Invoice number"
                />
                <button onClick={saveNumber} disabled={savingNumber || !numberDraft.trim()} className="min-h-[48px] px-4 bg-gray-800 text-white font-semibold rounded-xl disabled:opacity-40 flex-shrink-0">
                  {savingNumber ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          )}
          {editable && needPick.length > 0 && (
            <p className="text-sm font-semibold text-gray-900 mt-2">{needPick.length} line{needPick.length === 1 ? '' : 's'} need{needPick.length === 1 ? 's' : ''} you to pick the item (at the top).</p>
          )}
        </div>

        {error && <p className="text-sm text-[#c8102e] font-medium mb-3" role="alert">{error}</p>}
        {message && <p className="text-sm text-[#1a7a3c] font-semibold mb-3">{message}</p>}
        {!editable && !received && <p className="text-sm text-gray-600 mb-3">This invoice is {inv.status} and can&apos;t be changed.</p>}

        {/* Patch 69: what is stopping a confirm, line by line */}
        {editable && blockers.length > 0 && (
          <div className="bg-white border-2 border-gray-700 rounded-2xl p-4 mb-4" role="alert" data-testid="blockers">
            <p className="font-bold text-gray-900">Can&apos;t confirm yet. {blockers.length} thing{blockers.length === 1 ? '' : 's'} to fix:</p>
            <ul className="mt-2 flex flex-col gap-2">
              {blockers.map((b, i) => (
                <li key={i} className="text-sm text-gray-800">
                  • {b.message}
                  {b.kind === 'duplicate' && b.existing_id && (
                    <>
                      {' '}
                      <a href={`/scan-invoice/check?id=${encodeURIComponent(b.existing_id)}`} className="underline font-semibold text-gray-900">Open the one already received</a>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Patch 69: read-only summary once the invoice is received */}
        {received && (
          <div className="bg-white rounded-2xl shadow-sm border-2 border-gray-700 p-4 mb-4" data-testid="confirmed-summary">
            {inv.record_only ? (
              <>
                <p className="font-bold text-gray-900">Filed as record only{inv.received_by ? ` by ${inv.received_by}` : ''}{inv.received_at ? ` · ${fmtWhen(inv.received_at)}` : ''}</p>
                <p className="text-sm text-gray-700 mt-1">No stock was added from this invoice. The photos and the check-off are kept as proof.</p>
              </>
            ) : (
              <>
                <p className="font-bold text-gray-900">Delivery confirmed{inv.received_by ? ` by ${inv.received_by}` : ''}{inv.received_at ? ` · ${fmtWhen(inv.received_at)}` : ''}</p>
                {!inv.receipt_id && (
                  <p className="text-sm font-semibold text-gray-900 mt-1">⚠ This confirm did not finish cleanly. Tell an owner before trusting these numbers.</p>
                )}
                {added.size > 0 && (
                  <>
                    <p className="text-sm font-semibold text-gray-800 mt-2">Added to stock:</p>
                    <ul className="mt-1 text-sm text-gray-800">
                      {[...added.values()].map((a) => (
                        <li key={a.name}>• {a.name}: +{fmt(a.qty)} {unitLabel(a.unit, a.qty)}</li>
                      ))}
                    </ul>
                  </>
                )}
                {done && done.shorts.length > 0 && (
                  <p className="text-sm text-gray-800 mt-2">{done.shorts.length} item{done.shorts.length === 1 ? '' : 's'} came up short. It shows on the Dashboard until an owner resolves it.</p>
                )}
                {done && done.codes_learned.map((c) => (
                  <p key={c.line_id} className="text-sm text-gray-800 mt-1">Remembered code {c.code} for {c.item_name}.</p>
                ))}
                {done && done.codes_left_alone.map((c) => (
                  <p key={c.line_id} className="text-sm text-gray-800 mt-1">Code {c.code} was not saved: {c.reason}.</p>
                ))}
                {done && done.sizes_saved.map((z) => (
                  <p key={z.line_id} className="text-sm text-gray-800 mt-1">Remembered 1 {z.invoice_unit} = {fmt(z.size)} {unitLabel(z.unit, z.size)} for {z.item_name}.</p>
                ))}
              </>
            )}
            <p className="text-xs text-gray-500 mt-2">This invoice can&apos;t be edited anymore. To fix a count, use the normal stock tools.</p>
            <div className="flex gap-2 flex-wrap mt-3">
              {Array.from({ length: inv.page_count }, (_, i) => i + 1).map((p) => (
                <button key={p} onClick={() => openPhoto(p)} className="min-h-[44px] px-3 text-sm font-semibold text-gray-700 border border-gray-300 rounded-xl">View page {p}</button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {ordered.map((l) => {
            const skipped = l.match_method === 'skipped'
            const diff = l.qty_received != null && l.qty_shipped != null ? l.qty_received - l.qty_shipped : null
            const unit = l.invoice_unit || 'unit'
            const draft = drafts[l.id] ?? (l.qty_received == null ? '' : fmt(l.qty_received))
            // A line already checked AND saved folds into one row so finished
            // work gets out of the way on long invoices; Edit opens it again.
            const saved = view.lines.find((x) => x.id === l.id)
            if (!skipped && saved?.checked && !edits[l.id] && !l.needs_pick && !expanded.has(l.id)) {
              return (
                <div key={l.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 flex items-center justify-between gap-3" data-testid="line-card">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 break-words">✓ {l.description || l.vendor_code || 'Line'}</p>
                    <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                      <span>{l.item?.name ?? ''}</span>
                      <span data-testid="compact-received">· Received {fmt(l.qty_received)} {l.invoice_unit ?? ''}</span>
                      {diff != null && diff < 0 && <span className={BADGE} data-testid="badge-short">▼ Short {fmt(-diff)}</span>}
                      {diff != null && diff > 0 && <span className={BADGE} data-testid="badge-over">▲ Over {fmt(diff)}</span>}
                      {l.stock_qty_added != null && l.stock_qty_added > 0 && <span data-testid="compact-added">· Added {fmt(l.stock_qty_added)} {unitLabel(l.item?.unit ?? '', l.stock_qty_added)}</span>}
                      {l.code_learned && <span>· code remembered</span>}
                    </p>
                  </div>
                  {editable && (
                    <button onClick={() => setExpanded((e) => new Set(e).add(l.id))} className="min-h-[44px] px-3 text-sm font-semibold text-gray-600 border border-gray-300 rounded-xl flex-shrink-0">Edit</button>
                  )}
                </div>
              )
            }
            if (skipped) {
              return (
                <div key={l.id} className="bg-white/70 rounded-2xl border border-gray-200 px-4 py-3 flex items-center justify-between gap-3" data-testid="line-card">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-500 line-through break-words">{l.description || l.vendor_code || 'Line'}</p>
                    <p className="text-xs text-gray-400">Not one of our items · page {l.page}</p>
                  </div>
                  {editable && (
                    <button onClick={() => pick(l.id, { reset_match: true })} disabled={picking} className="min-h-[44px] px-3 text-sm font-semibold text-gray-600 border border-gray-300 rounded-xl flex-shrink-0">Undo</button>
                  )}
                </div>
              )
            }
            return (
              <div key={l.id} className={`bg-white rounded-2xl shadow-sm p-4 ${l.needs_pick || blockedLineIds.has(l.id) ? 'border-2 border-gray-500' : 'border border-gray-100'}`} data-testid="line-card">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-gray-900 break-words min-w-0">{l.description || '(no description read)'}</p>
                  {l.checked && <span className={BADGE}>✓ Checked</span>}
                </div>
                <p className="text-xs text-gray-500 mt-0.5 font-mono break-all">
                  {l.vendor_code ?? 'no code read'}{l.printed_item_number ? ` · #${l.printed_item_number}` : ''}
                </p>

                {/* What it matched */}
                {l.item ? (
                  <p className="text-sm text-gray-700 mt-2">→ <span className="font-semibold">{l.item.name}</span> <span className="text-gray-400">({HOW[l.match_method] ?? 'matched'})</span></p>
                ) : (
                  <div className="mt-2">
                    <p className="text-sm font-semibold text-gray-900">
                      {l.review_reason === 'code_number_conflict' && '⚠ Needs a look: the code and the item number point to different items.'}
                      {l.review_reason === 'shared_code' && '⚠ Needs a look: this code is on more than one item.'}
                      {!l.review_reason && 'Not matched to one of our items.'}
                    </p>
                    {editable && (
                      <button
                        onClick={() => { setPickerFor(l.id); setPickSearch(''); setShowAll(false) }}
                        className="mt-2 min-h-[48px] w-full bg-gray-800 hover:bg-gray-900 text-white font-semibold rounded-xl"
                      >
                        Which item is this?
                      </button>
                    )}
                  </div>
                )}
                {l.item && editable && (
                  <button onClick={() => { setPickerFor(l.id); setPickSearch(''); setShowAll(false) }} className="text-xs text-gray-500 underline mt-1">Change item</button>
                )}

                {/* Numbers */}
                <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                  <div className="bg-gray-50 rounded-xl px-3 py-2"><span className="text-gray-500">Ordered</span> <span className="font-semibold text-gray-900">{fmt(l.qty_ordered)} {l.invoice_unit ?? ''}</span></div>
                  <div className="bg-gray-50 rounded-xl px-3 py-2"><span className="text-gray-500">Shipped</span> <span className="font-semibold text-gray-900">{fmt(l.qty_shipped)} {l.invoice_unit ?? ''}</span></div>
                </div>

                {/* Case size */}
                {l.item && (
                  l.case_size.size != null ? (
                    <p className="text-xs text-gray-500 mt-2">1 {unit} = {fmt(l.case_size.size)} {unitLabel(l.item.unit ?? '', l.case_size.size)}{l.case_size.source === 'line' ? ' (typed for this invoice)' : ''}</p>
                  ) : (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="text-xs text-gray-700">Case size unknown: 1 {unit} =</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label="Case size for this line"
                        value={sizeDrafts[l.id] ?? ''}
                        disabled={!editable}
                        onChange={(e) => {
                          const v = e.target.value
                          if (!/^\d*\.?\d*$/.test(v)) return
                          setSizeDrafts((d) => ({ ...d, [l.id]: v }))
                          const n = v.trim() === '' ? null : Number(v)
                          setEdit(l.id, { units_per_invoice_unit: n && n > 0 ? n : null })
                        }}
                        className="w-20 min-h-[44px] border border-gray-300 rounded-xl px-3 text-base text-gray-900"
                        placeholder="?"
                      />
                      <span className="text-xs text-gray-700">{unitLabel(l.item.unit ?? '', 2)}</span>
                    </div>
                  )
                )}

                {(l.ai_unsure || l.ai_note) && (
                  <p className="text-xs text-gray-700 mt-2 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1">⚠ Hard to read{l.ai_note ? `: ${l.ai_note}` : ''}</p>
                )}

                {/* Received */}
                <div className="mt-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-gray-800">Received</span>
                    {diff != null && diff < 0 && <span className={BADGE} data-testid="badge-short">▼ Short {fmt(-diff)}</span>}
                    {diff != null && diff > 0 && <span className={BADGE} data-testid="badge-over">▲ Over {fmt(diff)}</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      aria-label="One less"
                      disabled={!editable}
                      onClick={() => setReceived(l, Math.max(0, (l.qty_received ?? 0) - 1))}
                      className="w-14 h-14 rounded-xl bg-gray-100 text-2xl font-bold text-gray-700 active:bg-gray-200 flex-shrink-0 disabled:opacity-40"
                    >−</button>
                    <input
                      type="text"
                      inputMode="decimal"
                      aria-label="Received"
                      value={draft}
                      disabled={!editable}
                      placeholder="—"
                      onChange={(e) => {
                        const v = e.target.value
                        const q = parseQty(v)
                        if (q === 'bad') return
                        setDrafts((d) => ({ ...d, [l.id]: v }))
                        setEdit(l.id, { qty_received: q, checked: q != null })
                      }}
                      className="flex-1 min-w-0 h-14 text-center text-xl font-bold border border-gray-300 rounded-xl text-gray-900"
                    />
                    <button
                      aria-label="One more"
                      disabled={!editable}
                      onClick={() => setReceived(l, (l.qty_received ?? 0) + 1)}
                      className="w-14 h-14 rounded-xl bg-gray-100 text-2xl font-bold text-gray-700 active:bg-gray-200 flex-shrink-0 disabled:opacity-40"
                    >+</button>
                  </div>
                  <button
                    onClick={() => setReceived(l, l.qty_shipped)}
                    disabled={!editable || l.qty_shipped == null}
                    className="mt-2 min-h-[48px] w-full border-2 border-[#1a7a3c] text-[#1a7a3c] font-semibold rounded-xl disabled:opacity-40"
                  >
                    {l.qty_shipped == null ? 'Shipped amount not readable' : `Matches invoice (${fmt(l.qty_shipped)})`}
                  </button>
                </div>

                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
                  <span className="text-xs text-gray-400">Page {l.page}, line {l.line_no}</span>
                  <button onClick={() => openPhoto(l.page)} className="min-h-[44px] px-3 text-sm font-semibold text-gray-700 border border-gray-300 rounded-xl">View page {l.page}</button>
                </div>
              </div>
            )
          })}
          {lines.length === 0 && <p className="text-sm text-gray-600">No item lines were read on this invoice.</p>}
        </div>

        {inv.status === 'read' && (
          <button onClick={openRecordOnly} disabled={saving || confirming} className="mt-8 w-full min-h-[48px] px-3 py-2 text-gray-800 font-semibold border border-gray-400 rounded-xl bg-white disabled:opacity-40" data-testid="record-only-button">
            File as record only
            <span className="block text-xs font-normal text-gray-500">Already received another way. Adds no stock.</span>
          </button>
        )}
        {editable && (
          <button onClick={() => setDiscardOpen(true)} className="mt-3 w-full min-h-[48px] text-[#c8102e] font-semibold border border-red-200 rounded-xl bg-white">
            Discard Invoice
          </button>
        )}
      </main>

      {/* Sticky bottom bar */}
      {editable && (
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 z-30" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} data-testid="checkoff-bar">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <p className="text-sm font-semibold text-gray-800 mb-2">{checkedCount} of {countable.length} lines checked{dirty ? ' · unsaved' : ''}</p>
          <div className="flex gap-2">
            <button
              onClick={saveProgress}
              disabled={!dirty || saving || !editable}
              className="flex-1 min-h-[52px] px-3 bg-[#1a7a3c] hover:bg-[#155f2f] text-white font-bold rounded-xl disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save Progress'}
            </button>
            {inv.status === 'read' && (
              <button
                onClick={openConfirm}
                disabled={preparing || confirming || saving}
                className="flex-1 min-h-[52px] px-3 bg-gray-900 hover:bg-black text-white font-bold rounded-xl disabled:opacity-40"
                data-testid="confirm-button"
              >
                {preparing ? 'Checking…' : 'Confirm Delivery'}
              </button>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Patch 69: confirm summary. Everything shown comes from the server's plan. */}
      {plan && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col" role="alertdialog" aria-label="Confirm delivery" data-testid="confirm-dialog">
          <div className="px-4 pt-4 pb-3 border-b border-gray-200">
            <p className="text-lg font-bold text-gray-900">Confirm delivery?</p>
            <p className="text-sm text-gray-600">{VENDOR_LABELS[plan.invoice.vendor] ?? plan.invoice.vendor} invoice #{plan.invoice.invoice_number}</p>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <div className="border-2 border-gray-700 rounded-xl p-3 text-sm text-gray-900" data-testid="confirm-warning">
              <p className="font-bold">This adds stock to {plan.items.length} item{plan.items.length === 1 ? '' : 's'}.</p>
              <p className="mt-1">There is no undo button yet. To fix a mistake afterward, use the normal stock tools (Correct Count).</p>
            </div>

            <p className="text-sm text-gray-800 mt-3" data-testid="confirm-counts">
              {plan.short_lines} short · {plan.over_lines} over · {plan.skipped_lines} skipped
            </p>

            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mt-4 mb-1">Stock to add</p>
            <div className="border border-gray-200 rounded-xl overflow-hidden">
              {plan.items.map((p) => (
                <div key={p.item_id} className="px-3 py-2 border-b border-gray-100 last:border-0" data-testid="confirm-item">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold text-gray-900 min-w-0 break-words">{p.item_name}</span>
                    <span className="font-bold text-gray-900 flex-shrink-0">+{fmt(p.quantity)} {unitLabel(p.unit, p.quantity)}</span>
                  </div>
                  <p className="text-xs text-gray-500">from {fmt(p.invoice_qty)} {p.invoice_unit} received</p>
                  {role === 'owner' && p.has_storage && (
                    <div className="flex gap-1.5 mt-1.5">
                      {(['store', 'storage'] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setDestinations((prev) => ({ ...prev, [p.item_id]: d }))}
                          className={`min-h-[44px] px-3 rounded-lg text-xs font-semibold border ${(destinations[p.item_id] || 'store') === d ? 'bg-teal-600 text-white border-teal-600' : 'bg-white text-teal-700 border-teal-200'}`}
                        >
                          {d === 'store' ? 'Store' : 'Storage'}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {plan.shorts.length > 0 && (
              <>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mt-4 mb-1">Short (stays on the Dashboard until resolved)</p>
                <ul className="text-sm text-gray-800">
                  {plan.shorts.map((s) => (
                    <li key={s.item_id}>• {s.item_name}: {fmt(s.quantity)} {unitLabel(s.unit, s.quantity)} short</li>
                  ))}
                </ul>
              </>
            )}

            {(plan.learn_codes.length > 0 || plan.codes_left_alone.length > 0) && (
              <>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mt-4 mb-1">Vendor codes</p>
                <ul className="text-sm text-gray-800 flex flex-col gap-1" data-testid="confirm-codes">
                  {plan.learn_codes.map((c) => (
                    <li key={c.line_id}>
                      • Will remember <span className="font-mono font-semibold">{c.code}</span> for <span className="font-semibold">{c.item_name}</span>
                      {c.vendor_mismatch && <span className="block text-xs text-gray-500 ml-3">{c.item_name} is not set up as a {VENDOR_LABELS[plan.invoice.vendor] ?? plan.invoice.vendor} item, so it will still need a hand pick next time until an owner changes its vendor.</span>}
                    </li>
                  ))}
                  {plan.codes_left_alone.map((c) => (
                    <li key={c.line_id}>• Will NOT remember <span className="font-mono font-semibold">{c.code}</span> for {c.item_name}: {c.reason}.</li>
                  ))}
                </ul>
                <p className="text-xs text-gray-500 mt-1">If a pick is wrong, go back and change it. Owners can fix a code later in Manage Items.</p>
              </>
            )}

            {plan.remember_sizes.length > 0 && (
              <>
                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mt-4 mb-1">Case sizes</p>
                {plan.remember_sizes.map((z) => (
                  <label key={z.line_id} className="flex items-center gap-3 min-h-[48px] text-sm text-gray-800">
                    <input
                      type="checkbox"
                      className="w-5 h-5 flex-shrink-0"
                      checked={rememberSizes.has(z.line_id)}
                      onChange={(e) => setRememberSizes((prev) => { const n = new Set(prev); if (e.target.checked) n.add(z.line_id); else n.delete(z.line_id); return n })}
                    />
                    <span>Remember 1 {z.invoice_unit} = {fmt(z.size)} {unitLabel(z.unit, z.size)} for {z.item_name}</span>
                  </label>
                ))}
              </>
            )}

            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mt-4 mb-1">Receiving against which order?</p>
            <div className="border border-gray-200 rounded-xl overflow-hidden" data-testid="confirm-orders">
              <label className="flex items-center gap-3 px-3 min-h-[48px] border-b border-gray-100 text-sm text-gray-900">
                <input type="radio" name="confirm-order" className="w-5 h-5" checked={orderChoice === null} onChange={() => setOrderChoice(null)} />
                No specific order
              </label>
              {plan.pending_orders.map((o) => (
                <label key={o.id} className="flex items-center gap-3 px-3 min-h-[48px] border-b border-gray-100 last:border-0 text-sm text-gray-900">
                  <input type="radio" name="confirm-order" className="w-5 h-5" checked={orderChoice === o.id} onChange={() => setOrderChoice(o.id)} />
                  <span>{o.vendor ? VENDOR_LABELS[o.vendor] ?? o.vendor : 'Unknown vendor'} · {fmtWhen(o.created_at)} · {o.item_count} item{o.item_count === 1 ? '' : 's'}</span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">The order you pick stops showing as on order.</p>
          </div>
          <div className="p-4 border-t border-gray-200 flex gap-2" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
            <button onClick={() => setPlan(null)} disabled={confirming} className="flex-1 min-h-[52px] bg-gray-100 text-gray-700 font-semibold rounded-xl disabled:opacity-50">Go back</button>
            <button onClick={confirmDelivery} disabled={confirming} className="flex-1 min-h-[52px] bg-gray-900 text-white font-bold rounded-xl disabled:opacity-50" data-testid="confirm-yes">
              {confirming ? 'Adding stock…' : 'Yes, add stock'}
            </button>
          </div>
        </div>
      )}

      {/* Patch 69: record only */}
      {recordOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" role="alertdialog" aria-label="File as record only?" data-testid="record-dialog">
          <div className="bg-white rounded-2xl p-5 w-full max-w-md">
            <p className="text-lg font-bold text-gray-900">File as record only?</p>
            <p className="text-sm text-gray-600 mt-2">
              Use this only when this delivery was already received another way (for example with Receive Order). The invoice is marked received and <span className="font-semibold text-gray-900">no stock is added</span>. The photos and the check-off are kept as proof. This can&apos;t be undone.
            </p>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setRecordOpen(false)} disabled={confirming} className="flex-1 min-h-[52px] bg-gray-100 text-gray-700 font-semibold rounded-xl disabled:opacity-50">Go back</button>
              <button onClick={() => sendConfirm({ mode: 'record_only' }, true)} disabled={confirming} className="flex-1 min-h-[52px] bg-gray-900 text-white font-bold rounded-xl disabled:opacity-50" data-testid="record-yes">
                {confirming ? 'Filing…' : 'Yes, file it'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* "Which item is this?" picker */}
      {pickerLine && (() => {
        const q = pickSearch.trim().toLowerCase()
        const match = (i: AnyItem) => !q || i.name.toLowerCase().includes(q) || (i.item_number ?? '').includes(q)
        const vendorItems = items.filter((i) => (i.distributor || 'other') === inv.vendor && match(i)).sort((a, b) => a.name.localeCompare(b.name))
        const otherItems = items.filter((i) => (i.distributor || 'other') !== inv.vendor && match(i)).sort((a, b) => a.name.localeCompare(b.name))
        const guesses = [
          ...pickerLine.candidates.map((c) => ({ item: c, label: pickerLine.review_reason === 'code_number_conflict' ? 'code or item number' : 'same code' })),
          ...pickerLine.suggestions.map((s) => ({ item: s.item, label: s.why === 'balford_part' ? 'part number' : 'similar name' })),
        ]
        const Row = ({ item, note }: { item: { id: string; name: string; item_number: string | null }; note?: string }) => (
          <button
            onClick={() => pick(pickerLine.id, { item_id: item.id })}
            disabled={picking}
            className="w-full text-left min-h-[56px] px-4 py-3 border-b border-gray-100 active:bg-gray-50 disabled:opacity-50"
          >
            <span className="font-semibold text-gray-900">{item.name}</span>
            <span className="block text-xs text-gray-500">{item.item_number ? `#${item.item_number}` : 'no item #'}{note ? ` · ${note}` : ''}</span>
          </button>
        )
        return (
          <div className="fixed inset-0 z-50 bg-white flex flex-col" role="dialog" aria-label="Which item is this?" data-testid="picker">
            <div className="px-4 pt-4 pb-3 border-b border-gray-200">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-lg font-bold text-gray-900">Which item is this?</p>
                  <p className="text-sm text-gray-600 break-words">{pickerLine.description}</p>
                  <p className="text-xs text-gray-400 font-mono break-all">{pickerLine.vendor_code ?? 'no code'}{pickerLine.printed_item_number ? ` · #${pickerLine.printed_item_number}` : ''}</p>
                </div>
                <button onClick={() => setPickerFor(null)} className="min-h-[44px] min-w-[44px] text-2xl text-gray-500" aria-label="Close">×</button>
              </div>
              <input
                type="search"
                value={pickSearch}
                onChange={(e) => setPickSearch(e.target.value)}
                placeholder="Search our items…"
                className="mt-3 w-full min-h-[48px] border border-gray-300 rounded-xl px-3 text-base"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {guesses.length > 0 && !q && (
                <>
                  <p className="px-4 pt-3 pb-1 text-xs font-bold uppercase tracking-widest text-gray-400">Best guesses</p>
                  {guesses.map((g) => <Row key={`g-${g.item.id}`} item={g.item} note={g.label} />)}
                </>
              )}
              <p className="px-4 pt-3 pb-1 text-xs font-bold uppercase tracking-widest text-gray-400">{VENDOR_LABELS[inv.vendor] ?? inv.vendor} items</p>
              {vendorItems.map((i) => <Row key={i.id} item={i} />)}
              {vendorItems.length === 0 && <p className="px-4 py-3 text-sm text-gray-400">No matches.</p>}
              {showAll ? (
                <>
                  <p className="px-4 pt-3 pb-1 text-xs font-bold uppercase tracking-widest text-gray-400">All other items</p>
                  {otherItems.map((i) => <Row key={i.id} item={i} note={i.distributor ?? 'no distributor'} />)}
                </>
              ) : (
                <button onClick={() => setShowAll(true)} className="w-full min-h-[52px] text-sm font-semibold text-gray-700 border-y border-gray-100">Show all items</button>
              )}
            </div>
            <div className="p-4 border-t border-gray-200" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
              <button onClick={() => pick(pickerLine.id, { skip: true })} disabled={picking} className="w-full min-h-[52px] border border-gray-400 text-gray-800 font-semibold rounded-xl">
                Not one of our items (skip)
              </button>
            </div>
          </div>
        )
      })()}

      {/* Full-screen page photo */}
      {photo && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col" role="dialog" aria-label={`Page ${photo.page}`} data-testid="photo-viewer">
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <span className="font-semibold">Page {photo.page}</span>
            <button onClick={() => setPhoto(null)} className="min-h-[44px] px-4 rounded-xl bg-white/20 font-semibold">Close</button>
          </div>
          <div className="flex-1 overflow-auto">
            {photo.url === null ? (
              <p className="text-white/70 text-center mt-10">Loading…</p>
            ) : photo.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo.url} alt={`Invoice page ${photo.page}`} className="w-full h-auto block" />
            ) : (
              <p className="text-white/70 text-center mt-10">This page&apos;s photo couldn&apos;t be loaded.</p>
            )}
          </div>
        </div>
      )}

      {/* Discard confirmation */}
      {discardOpen && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-4" role="dialog" aria-label="Discard this invoice?">
          <div className="bg-white rounded-2xl p-5 w-full max-w-md">
            <p className="text-lg font-bold text-gray-900">Discard this invoice?</p>
            <p className="text-sm text-gray-600 mt-2">The photos and the checked-off lines will be deleted. Nothing was added to stock. This can&apos;t be undone.</p>
            <div className="flex gap-2 mt-4">
              <button onClick={discard} disabled={discarding} className="flex-1 min-h-[52px] bg-[#c8102e] text-white font-bold rounded-xl disabled:opacity-50">
                {discarding ? 'Discarding…' : 'Yes, discard'}
              </button>
              <button onClick={() => setDiscardOpen(false)} disabled={discarding} className="flex-1 min-h-[52px] bg-gray-100 text-gray-700 font-semibold rounded-xl">
                Keep it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function CheckOffPage() {
  return (
    <Suspense fallback={null}>
      <CheckOff />
    </Suspense>
  )
}
