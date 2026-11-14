'use client'

// Patch 70: the Invoices tab on History. Received invoices only (confirmed
// deliveries and ones filed as record only), newest confirm first, 20 at a
// time with "Show more". Search by invoice number, filter by vendor. Tapping
// one opens the read-only detail (/history/invoice?id=). The API enforces
// owners + shift leads.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

type Row = {
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

const VENDOR_LABELS: Record<string, string> = { bunzl: 'Bunzl', balford: 'Balford', other: 'Other' }
export const INVOICE_BADGE = 'inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full border border-gray-400 text-gray-700 bg-white whitespace-nowrap'

export const fmtInvoiceDate = (d: string | null) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'no date'
export const fmtWhen = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

export default function InvoiceHistoryList() {
  const [rows, setRows] = useState<Row[]>([])
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [vendor, setVendor] = useState('')
  // Each request gets a number; an older answer arriving late is ignored.
  const reqId = useRef(0)

  const load = useCallback(async (q: string, v: string, p: number) => {
    const mine = ++reqId.current
    if (p === 0) setLoading(true)
    else setLoadingMore(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(p) })
      if (q.trim()) params.set('q', q.trim())
      if (v) params.set('vendor', v)
      const res = await fetch(`/api/invoices/history?${params}`)
      const body = await res.json().catch(() => ({}))
      if (mine !== reqId.current) return
      if (!res.ok) {
        setError(body.error || 'Could not load invoices.')
        return
      }
      setRows((prev) => (p === 0 ? body.invoices : [...prev, ...body.invoices]))
      setPage(p)
      setHasMore(!!body.has_more)
    } catch {
      if (mine === reqId.current) setError('Could not reach the server.')
    } finally {
      if (mine === reqId.current) {
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [])

  // Search waits until typing pauses for a moment (a "debounce": one request
  // after the last keystroke, not one per letter).
  useEffect(() => {
    const t = setTimeout(() => load(search, vendor, 0), search ? 350 : 0)
    return () => clearTimeout(t)
  }, [search, vendor, load])

  return (
    <div data-testid="invoice-history">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4 flex flex-col gap-3">
        <input
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          className="w-full min-h-[48px] border border-gray-200 rounded-xl px-4 text-base text-gray-900 focus:outline-none focus:border-blue-400 bg-white"
          placeholder="Search invoice number…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="invoice-search"
        />
        <div className="flex gap-2 flex-wrap" role="group" aria-label="Vendor">
          {[['', 'All vendors'], ['bunzl', 'Bunzl'], ['balford', 'Balford'], ['other', 'Other']].map(([key, label]) => (
            <button
              key={key || 'all'}
              onClick={() => setVendor(key)}
              aria-pressed={vendor === key}
              className={`min-h-[48px] px-4 rounded-xl font-semibold text-sm transition-colors ${vendor === key ? 'bg-[#1a7a3c] text-white' : 'bg-gray-100 text-gray-600'}`}
              data-testid={`vendor-${key || 'all'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-[#c8102e] font-medium mb-3" role="alert">{error}</p>}

      {loading ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
          <p className="text-gray-400">Loading invoices…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center" data-testid="invoice-empty">
          <p className="text-gray-400">{search.trim() || vendor ? 'No received invoices match.' : 'No received invoices yet.'}</p>
          <p className="text-gray-400 text-sm mt-1">Invoices show here once a delivery is confirmed or filed as record only.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/history/invoice?id=${encodeURIComponent(r.id)}`}
              className="block px-5 py-4 border-b border-gray-100 last:border-0 hover:bg-gray-50"
              data-testid="invoice-row"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 break-words">
                    {VENDOR_LABELS[r.vendor] ?? r.vendor} <span className="font-mono">#{r.invoice_number ?? '—'}</span>
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Invoice date {fmtInvoiceDate(r.invoice_date)} · {r.line_count} line{r.line_count === 1 ? '' : 's'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {r.record_only ? 'Filed' : 'Confirmed'}{r.received_by ? ` by ${r.received_by}` : ''}{r.received_at ? ` · ${fmtWhen(r.received_at)}` : ''}
                  </p>
                </div>
                <span className="text-sm text-gray-400 flex-shrink-0 mt-0.5">View →</span>
              </div>
              {(r.record_only || r.short_count > 0 || r.over_count > 0) && (
                <div className="flex gap-1.5 flex-wrap mt-2">
                  {r.record_only && <span className={INVOICE_BADGE} data-testid="badge-record-only">Record only</span>}
                  {r.short_count > 0 && <span className={INVOICE_BADGE} data-testid="badge-short">▼ {r.short_count} short</span>}
                  {r.over_count > 0 && <span className={INVOICE_BADGE} data-testid="badge-over">▲ {r.over_count} over</span>}
                </div>
              )}
            </Link>
          ))}
        </div>
      )}

      {!loading && hasMore && (
        <button
          onClick={() => load(search, vendor, page + 1)}
          disabled={loadingMore}
          className="w-full min-h-[52px] mt-3 bg-white border border-gray-200 rounded-2xl text-sm font-semibold text-gray-700 disabled:opacity-50"
          data-testid="invoice-more"
        >
          {loadingMore ? 'Loading…' : 'Show more'}
        </button>
      )}
    </div>
  )
}
