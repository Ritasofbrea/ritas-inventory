'use client'

// Patch 70: read-only invoice detail (/history/invoice?id=<invoice id>).
// Received invoices only. Owners and shift leads (the API enforces it too).
//   - header: vendor, number, invoice date, who confirmed and when, record
//     only, the receipt and the short it made
//   - every line: the vendor's description and code, our matched item,
//     ordered / shipped / received, stock added, short / over badges;
//     skipped lines are listed separately
//   - each page's photo full screen through signed links (10 minutes; the
//     bucket is private, never a public URL). Links are fetched again when
//     they are older than about 8 minutes.
// Nothing on this screen can change anything.

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { unitLabel } from '@/lib/units'
import { INVOICE_BADGE, fmtInvoiceDate, fmtWhen } from '@/components/InvoiceHistoryList'

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
  stock_qty_added: number | null
  match_method: string
  code_learned: boolean
  confirmed_by: string | null
  item: { id: string; name: string; unit: string | null } | null
  diff: 'short' | 'over' | null
}
type Detail = {
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
  lines: Line[]
  pages: { page: number; url: string | null }[]
  expires_in: number
}

const VENDOR_LABELS: Record<string, string> = { bunzl: 'Bunzl', balford: 'Balford', other: 'Other' }
const HOW: Record<string, string> = { vendor_code: 'by vendor code', item_number: 'by item number', manual: 'picked by hand', description_confirmed: 'picked by hand' }
const fmt = (n: number | null) => (n == null ? '—' : Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100))
const LINK_REFRESH_MS = 8 * 60 * 1000
const linksAreOld = (loadedAt: number) => Date.now() - loadedAt > LINK_REFRESH_MS

function InvoiceDetailView() {
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const [allowed, setAllowed] = useState(false)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loadedAt, setLoadedAt] = useState(0)
  const [error, setError] = useState('')
  const [photo, setPhoto] = useState<{ page: number; url: string | null | '' } | null>(null)

  const load = useCallback(async (): Promise<Detail | null> => {
    const res = await fetch(`/api/invoices/history?id=${encodeURIComponent(id)}`)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(res.status === 404 ? 'This invoice was not found, or it has not been received yet.' : body.error || 'Could not load the invoice.')
      return null
    }
    setDetail(body)
    setLoadedAt(Date.now())
    return body as Detail
  }, [id])

  useEffect(() => {
    const r = getRole()
    if (!r) { router.replace('/login'); return }
    if (r !== 'owner' && r !== 'shift_lead') { router.replace('/login'); return }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: resolve role once on mount, this app's standard page-load pattern
    setAllowed(true)
    load()
  }, [router, load])

  // Signed links last 10 minutes; reload them first if they're getting old.
  const openPhoto = async (page: number) => {
    let d = detail
    if (!d || linksAreOld(loadedAt)) {
      setPhoto({ page, url: null })
      d = await load()
    }
    const url = d?.pages.find((p) => p.page === page)?.url ?? ''
    setPhoto({ page, url })
  }

  if (!allowed) return null

  const inv = detail?.invoice
  const active = detail ? detail.lines.filter((l) => l.match_method !== 'skipped') : []
  const skipped = detail ? detail.lines.filter((l) => l.match_method === 'skipped') : []
  const shortCount = active.filter((l) => l.diff === 'short').length
  const overCount = active.filter((l) => l.diff === 'over').length

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        <Link href="/history?tab=invoices" className="inline-flex items-center min-h-[44px] text-sm text-gray-600 font-medium mb-1">← Invoices</Link>

        {error && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-10 text-center" role="alert" data-testid="detail-error">
            <p className="text-gray-600">{error}</p>
          </div>
        )}
        {!error && !detail && <p className="text-gray-400 text-center mt-10">Loading…</p>}

        {inv && detail && (
          <>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mb-4" data-testid="invoice-header">
              <h1 className="text-xl font-bold text-gray-900 break-words">
                {VENDOR_LABELS[inv.vendor] ?? inv.vendor} invoice <span className="font-mono">#{inv.invoice_number ?? '—'}</span>
              </h1>
              <p className="text-sm text-gray-600 mt-1">Invoice date {fmtInvoiceDate(inv.invoice_date)}</p>
              <p className="text-sm text-gray-600 mt-0.5" data-testid="confirmed-line">
                {inv.record_only ? 'Filed as record only' : 'Delivery confirmed'}
                {inv.received_by ? ` by ${inv.received_by}` : ''}
                {inv.received_at ? ` · ${fmtWhen(inv.received_at)}` : ''}
              </p>
              <p className="text-xs text-gray-400 mt-0.5">Scanned{inv.created_by ? ` by ${inv.created_by}` : ''} · {fmtWhen(inv.created_at)}</p>
              <div className="flex gap-1.5 flex-wrap mt-2">
                {inv.record_only && <span className={INVOICE_BADGE} data-testid="badge-record-only">Record only</span>}
                {shortCount > 0 && <span className={INVOICE_BADGE}>▼ {shortCount} short</span>}
                {overCount > 0 && <span className={INVOICE_BADGE}>▲ {overCount} over</span>}
                {skipped.length > 0 && <span className={INVOICE_BADGE}>{skipped.length} skipped</span>}
              </div>
              {inv.record_only ? (
                <p className="text-sm text-gray-700 mt-3">No stock was added from this invoice. The photos and the check-off are kept as proof.</p>
              ) : !inv.receipt_id ? (
                <p className="text-sm font-semibold text-gray-900 mt-3">⚠ This confirm did not finish cleanly. Tell an owner before trusting these numbers.</p>
              ) : null}
              {detail.short && (
                <p className="text-sm text-gray-700 mt-2" data-testid="short-status">
                  Short shipment {detail.short.resolved ? 'was resolved' : 'is still open on the Dashboard'}.
                </p>
              )}
              {detail.pages.length > 0 && (
                <div className="flex gap-2 flex-wrap mt-3">
                  {detail.pages.map((p) => (
                    <button
                      key={p.page}
                      onClick={() => openPhoto(p.page)}
                      className="min-h-[48px] px-4 text-sm font-semibold text-gray-700 border border-gray-300 rounded-xl"
                      data-testid="view-page"
                    >
                      View page {p.page}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">
              {active.length} line{active.length === 1 ? '' : 's'}
            </h2>
            <div className="flex flex-col gap-3">
              {active.map((l) => {
                const d = l.qty_received != null && l.qty_shipped != null ? l.qty_received - l.qty_shipped : null
                const unit = l.invoice_unit || ''
                return (
                  <div key={l.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4" data-testid="detail-line">
                    <p className="font-semibold text-gray-900 break-words">{l.description || '(no description read)'}</p>
                    <p className="text-xs text-gray-500 mt-0.5 font-mono break-all">
                      {l.vendor_code ?? 'no code read'}{l.printed_item_number ? ` · #${l.printed_item_number}` : ''} · page {l.page}
                    </p>
                    {l.item ? (
                      <p className="text-sm text-gray-700 mt-2">
                        → <span className="font-semibold" data-testid="line-item">{l.item.name}</span>{' '}
                        <span className="text-gray-400">({HOW[l.match_method] ?? 'matched'}{l.code_learned ? ', code remembered' : ''})</span>
                      </p>
                    ) : (
                      <p className="text-sm text-gray-500 mt-2">No item matched</p>
                    )}
                    <div className="grid grid-cols-3 gap-2 mt-3 text-center" data-testid="line-qty">
                      <div className="bg-gray-50 rounded-xl py-2">
                        <p className="text-[11px] text-gray-500">Ordered</p>
                        <p className="font-bold text-gray-900">{fmt(l.qty_ordered)} <span className="text-xs font-normal text-gray-500">{unit}</span></p>
                      </div>
                      <div className="bg-gray-50 rounded-xl py-2">
                        <p className="text-[11px] text-gray-500">Shipped</p>
                        <p className="font-bold text-gray-900">{fmt(l.qty_shipped)} <span className="text-xs font-normal text-gray-500">{unit}</span></p>
                      </div>
                      <div className="bg-gray-50 rounded-xl py-2">
                        <p className="text-[11px] text-gray-500">Received</p>
                        <p className="font-bold text-gray-900">{fmt(l.qty_received)} <span className="text-xs font-normal text-gray-500">{unit}</span></p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-2 text-sm text-gray-700">
                      {d != null && d < 0 && <span className={INVOICE_BADGE} data-testid="badge-short">▼ Short {fmt(-d)}</span>}
                      {d != null && d > 0 && <span className={INVOICE_BADGE} data-testid="badge-over">▲ Over {fmt(d)}</span>}
                      {inv.record_only ? (
                        <span className="text-gray-500">No stock added (record only)</span>
                      ) : l.stock_qty_added != null ? (
                        <span data-testid="stock-added">
                          Added {fmt(l.stock_qty_added)} {unitLabel(l.item?.unit ?? '', l.stock_qty_added)}
                          {l.units_per_invoice_unit != null && unit ? <span className="text-gray-400"> (1 {unit} = {fmt(l.units_per_invoice_unit)})</span> : null}
                        </span>
                      ) : (
                        <span className="text-gray-500">No stock added</span>
                      )}
                    </div>
                  </div>
                )
              })}
              {active.length === 0 && (
                <p className="text-sm text-gray-500 bg-white rounded-2xl border border-gray-100 px-4 py-3">No item lines on this invoice.</p>
              )}
            </div>

            {skipped.length > 0 && (
              <>
                <h2 className="text-xs font-bold uppercase tracking-widest text-gray-500 mt-6 mb-2">Skipped (not our items)</h2>
                <div className="bg-white/70 rounded-2xl border border-gray-200 overflow-hidden">
                  {skipped.map((l) => (
                    <div key={l.id} className="px-4 py-3 border-b border-gray-100 last:border-0" data-testid="skipped-line">
                      <p className="text-sm text-gray-600 break-words">{l.description || l.vendor_code || 'Line'}</p>
                      <p className="text-xs text-gray-400 font-mono break-all">
                        {l.vendor_code ?? 'no code'} · shipped {fmt(l.qty_shipped)} {l.invoice_unit ?? ''} · page {l.page}
                      </p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </main>

      {photo && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col" role="dialog" aria-label={`Page ${photo.page}`} data-testid="photo-viewer">
          <div className="flex items-center justify-between px-4 py-3 text-white" style={{ paddingTop: 'calc(0.75rem + env(safe-area-inset-top))' }}>
            <span className="font-semibold">Page {photo.page}</span>
            <button onClick={() => setPhoto(null)} className="min-h-[48px] px-5 rounded-xl bg-white/20 font-semibold">Close</button>
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
    </div>
  )
}

export default function InvoiceDetailPage() {
  return (
    <Suspense fallback={null}>
      <InvoiceDetailView />
    </Suspense>
  )
}
