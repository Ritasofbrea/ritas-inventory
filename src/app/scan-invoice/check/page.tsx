'use client'

// Patch 68: invoice check-off screen (/scan-invoice/check?id=<invoice id>).
// Owners and shift leads (every API call enforces this too).
//   - header: vendor, invoice number, date, and the soft totals check
//   - lines that need a person (unmatched / "needs a look") first, each with
//     a "Which item is this?" picker
//   - one card per line: description, our matched item and how, ordered /
//     shipped, case size, the reader's unsure note, page + full-screen photo
//   - Received starts blank: +/- buttons, type a number, or "Matches invoice"
//   - sticky bar: "X of Y lines checked" + Save Progress
//   - Discard Invoice (with a confirmation)
// NO stock moves here and there is no Confirm button: that's patch 69.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { unitLabel } from '@/lib/units'

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
  invoice: { id: string; vendor: string; status: string; invoice_number: string | null; invoice_date: string | null; printed_date: string | null; page_count: number; pages_read: number[]; no_item_pages: number[] }
  totals_check: TotalsCheck
  lines: Line[]
  checked_count: number
}
type Edit = { qty_received?: number | null; checked?: boolean; units_per_invoice_unit?: number | null }
type AnyItem = { id: string; name: string; distributor: string | null; item_number: string | null; unit: string | null; category: string }

const VENDOR_LABELS: Record<string, string> = { bunzl: 'Bunzl', balford: 'Balford', other: 'Other' }
const HOW: Record<string, string> = { vendor_code: 'by vendor code', item_number: 'by item number', manual: 'picked by hand', description_confirmed: 'picked by hand' }
const BADGE = 'inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border border-gray-400 text-gray-700 bg-white'

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

  const dirty = Object.keys(edits).length > 0

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

  const saveProgress = async () => {
    if (!dirty || saving) return
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.')
    } finally {
      setSaving(false)
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

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 pt-6 pb-36">
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
          {needPick.length > 0 && (
            <p className="text-sm font-semibold text-gray-900 mt-2">{needPick.length} line{needPick.length === 1 ? '' : 's'} need{needPick.length === 1 ? 's' : ''} you to pick the item (at the top).</p>
          )}
        </div>

        {error && <p className="text-sm text-[#c8102e] font-medium mb-3" role="alert">{error}</p>}
        {message && <p className="text-sm text-[#1a7a3c] font-semibold mb-3">{message}</p>}
        {!editable && <p className="text-sm text-gray-600 mb-3">This invoice is {inv.status} and can&apos;t be changed.</p>}

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
              <div key={l.id} className={`bg-white rounded-2xl shadow-sm p-4 ${l.needs_pick ? 'border-2 border-gray-500' : 'border border-gray-100'}`} data-testid="line-card">
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

        {editable && (
          <button onClick={() => setDiscardOpen(true)} className="mt-8 w-full min-h-[48px] text-[#c8102e] font-semibold border border-red-200 rounded-xl bg-white">
            Discard Invoice
          </button>
        )}
      </main>

      {/* Sticky bottom bar */}
      <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 z-30" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }} data-testid="checkoff-bar">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <p className="flex-1 text-sm font-semibold text-gray-800">{checkedCount} of {countable.length} lines checked{dirty ? ' · unsaved' : ''}</p>
          <button
            onClick={saveProgress}
            disabled={!dirty || saving || !editable}
            className="min-h-[52px] px-5 bg-[#1a7a3c] hover:bg-[#155f2f] text-white font-bold rounded-xl disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save Progress'}
          </button>
        </div>
      </div>

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
