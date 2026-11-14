'use client'

// Patch 63: Scan Invoice. Crew picks the vendor, takes or picks one photo
// per invoice page, and saves them as a DRAFT invoice in the private
// invoice-photos bucket.
// Patch 68: after saving, the draft opens with a "Read Invoice" button that
// reads the pages one at a time through POST /api/invoices/read (about 15s
// each), with a Retry for just the page that failed. Once every page is
// read it goes to the check-off screen (/scan-invoice/check). Recent
// invoices open the right place: a draft opens here (to read it), a read
// invoice opens the check-off screen. No stock moves until patch 69.
// Owners and shift leads only (the API enforces this too).

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { uploadInvoicePage } from '@/lib/photo'
import { INVOICE_VENDORS, InvoiceVendor, MAX_INVOICE_PAGES } from '@/lib/invoice-constants'

interface PickedPage {
  key: string
  file: File
  previewUrl: string
}

interface InvoiceSummary {
  id: string
  vendor: string
  status: string
  invoice_number: string | null
  invoice_date: string | null
  photo_paths: string[]
  created_by: string | null
  created_at: string
}

interface InvoiceDetail extends InvoiceSummary {
  pages: { page: number; url: string | null }[]
  pages_read: number[]
  reads_used: Record<string, number>
  expires_in: number
}

const MAX_READS_PER_PAGE = 2

// Patch 70: read but not confirmed (any age; the recent list stops at 20).
interface UnconfirmedInvoice {
  id: string
  vendor: string
  invoice_number: string | null
  created_at: string
  created_by: string | null
}

const VENDOR_LABELS: Record<InvoiceVendor, string> = { bunzl: 'Bunzl', balford: 'Balford', other: 'Other' }

function vendorLabel(v: string): string {
  return (VENDOR_LABELS as Record<string, string>)[v] ?? v
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function ScanInvoicePage() {
  const router = useRouter()
  const [allowed, setAllowed] = useState(false)
  const [vendor, setVendor] = useState<InvoiceVendor | null>(null)
  const [pages, setPages] = useState<PickedPage[]>([])
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [savedMessage, setSavedMessage] = useState('')
  const [recent, setRecent] = useState<InvoiceSummary[]>([])
  const [recentLoading, setRecentLoading] = useState(true)
  const [unconfirmed, setUnconfirmed] = useState<UnconfirmedInvoice[]>([])
  const [viewing, setViewing] = useState<InvoiceDetail | null>(null)
  const [viewLoadingId, setViewLoadingId] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [readProgress, setReadProgress] = useState('')
  const [readError, setReadError] = useState<{ page: number; message: string; canRetry: boolean } | null>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)
  const pagesRef = useRef<PickedPage[]>([])

  const loadRecent = async () => {
    setRecentLoading(true)
    try {
      const res = await fetch('/api/invoices')
      if (res.ok) setRecent(await res.json())
    } finally {
      setRecentLoading(false)
    }
    // Patch 70: the "read but not confirmed" nudge. Best-effort: if it
    // fails the screen just shows no nudge.
    try {
      const res = await fetch('/api/invoices/history?unconfirmed=1')
      if (res.ok) setUnconfirmed(((await res.json()).invoices ?? []) as UnconfirmedInvoice[])
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    const r = getRole()
    if (!r) { router.replace('/login'); return }
    if (r !== 'owner' && r !== 'shift_lead') { router.replace('/login'); return }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: resolve role once on mount, this app's standard page-load pattern
    setAllowed(true)
    loadRecent()
  }, [router])

  // Free preview object URLs when the page goes away.
  useEffect(() => {
    pagesRef.current = pages
  }, [pages])
  useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), [])

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return
    setError('')
    setSavedMessage('')
    const room = Math.max(0, MAX_INVOICE_PAGES - pages.length)
    if (list.length > room) setError(`An invoice can have up to ${MAX_INVOICE_PAGES} pages.`)
    const incoming = Array.from(list)
      .filter((f) => f.type.startsWith('image/') || f.type === '')
      .slice(0, room)
      .map((file) => ({ key: `${Date.now()}-${Math.random()}`, file, previewUrl: URL.createObjectURL(file) }))
    setPages((prev) => [...prev, ...incoming])
  }

  const removePage = (key: string) => {
    setPages((prev) => {
      const gone = prev.find((p) => p.key === key)
      if (gone) URL.revokeObjectURL(gone.previewUrl)
      return prev.filter((p) => p.key !== key)
    })
  }

  const save = async () => {
    if (!vendor || pages.length === 0 || saving) return
    setSaving(true)
    setError('')
    setSavedMessage('')
    let invoiceId: string | null = null
    try {
      setProgress('Starting…')
      const createRes = await fetch('/api/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vendor }),
      })
      const created = await createRes.json().catch(() => ({}))
      if (!createRes.ok) throw new Error(created.error || 'Could not start the invoice')
      invoiceId = created.id as string

      for (let i = 0; i < pages.length; i++) {
        setProgress(`Uploading page ${i + 1} of ${pages.length}…`)
        await uploadInvoicePage(invoiceId, i + 1, pages[i].file)
      }

      setProgress('Saving…')
      const finishRes = await fetch('/api/invoices', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: invoiceId }),
      })
      const finished = await finishRes.json().catch(() => ({}))
      if (!finishRes.ok) throw new Error(finished.error || 'Could not save the invoice')

      pages.forEach((p) => URL.revokeObjectURL(p.previewUrl))
      setPages([])
      setSavedMessage(`Saved ${vendorLabel(vendor)} invoice draft (${finished.photo_paths.length} page${finished.photo_paths.length === 1 ? '' : 's'}).`)
      setVendor(null)
      loadRecent()
      openInvoice(invoiceId) // straight to the draft, where Read Invoice is
    } catch (e) {
      // Don't leave a half-saved draft behind: remove it and its photos.
      if (invoiceId) {
        await fetch('/api/invoices', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: invoiceId }),
        }).catch(() => {})
      }
      setError(e instanceof Error ? e.message : 'Could not save. Try again.')
    } finally {
      setSaving(false)
      setProgress('')
    }
  }

  const openInvoice = async (id: string) => {
    setViewLoadingId(id)
    setError('')
    setReadError(null)
    try {
      const res = await fetch(`/api/invoices?id=${encodeURIComponent(id)}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Could not open that invoice')
      setViewing(body as InvoiceDetail)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that invoice')
    } finally {
      setViewLoadingId(null)
    }
  }

  // A read invoice goes to the check-off screen, and a received one to the
  // same screen's read-only summary (patch 69); anything else opens here.
  const openRecent = (inv: InvoiceSummary) => {
    if (inv.status === 'read' || inv.status === 'received') router.push(`/scan-invoice/check?id=${encodeURIComponent(inv.id)}`)
    else openInvoice(inv.id)
  }

  // Patch 68: read every page that hasn't been read yet, one at a time.
  // Stops at the first page that fails and offers a Retry for that page.
  const readInvoice = async (inv: InvoiceDetail) => {
    if (reading) return
    setReading(true)
    setReadError(null)
    const total = inv.photo_paths.length
    const done = new Set(inv.pages_read)
    const used = { ...inv.reads_used }
    try {
      for (let page = 1; page <= total; page++) {
        if (done.has(page)) continue
        setReadProgress(`Reading page ${page} of ${total}, about 15 seconds each…`)
        let res: Response
        let body: { error?: string } = {}
        try {
          res = await fetch('/api/invoices/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoice_id: inv.id, page }),
          })
          body = await res.json().catch(() => ({}))
        } catch {
          setReadError({ page, message: `Couldn't reach the server while reading page ${page}. Check the connection and try again.`, canRetry: true })
          return
        }
        if (!res.ok) {
          // A failed attempt may still have used up one of the page's reads.
          const fresh = await fetch(`/api/invoices?id=${encodeURIComponent(inv.id)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
          if (fresh) setViewing(fresh as InvoiceDetail)
          const usedNow = fresh ? (fresh.reads_used?.[String(page)] ?? 0) : (used[String(page)] ?? 0)
          setReadError({
            page,
            message: body.error || `Couldn't read page ${page}. Try again.`,
            canRetry: usedNow < MAX_READS_PER_PAGE,
          })
          return
        }
        done.add(page)
        used[String(page)] = (used[String(page)] ?? 0) + 1
        setViewing((v) => (v && v.id === inv.id ? { ...v, pages_read: [...done].sort((a, b) => a - b), reads_used: { ...used } } : v))
      }
      setReadProgress('All pages read. Opening the check-off screen…')
      router.push(`/scan-invoice/check?id=${encodeURIComponent(inv.id)}`)
    } finally {
      setReading(false)
    }
  }

  if (!allowed) return null

  // Viewing one saved draft's pages (signed links, short-lived).
  if (viewing) {
    return (
      <div className="min-h-screen flex flex-col bg-[#d4edda]">
        <Navigation />
        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
          <button onClick={() => { if (!reading) { setViewing(null); loadRecent() } }} disabled={reading} className="text-sm text-gray-500 hover:text-gray-700 mb-2 flex items-center gap-1 disabled:opacity-40">← Back</button>
          <h1 className="text-2xl font-bold text-gray-900">{vendorLabel(viewing.vendor)} invoice</h1>
          <p className="text-gray-500 mt-1 text-sm">
            {viewing.status === 'draft' ? 'Draft' : viewing.status === 'read' ? 'Read' : viewing.status} · {formatWhen(viewing.created_at)}{viewing.created_by ? ` · ${viewing.created_by}` : ''}
          </p>

          {viewing.status === 'draft' && viewing.photo_paths.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 mt-4" data-testid="read-panel">
              <p className="font-semibold text-gray-900">Read this invoice</p>
              <p className="text-sm text-gray-500 mt-1">Pages are read one at a time, about 15 seconds each. Stay on this screen until it finishes.</p>
              <div className="flex flex-wrap gap-2 mt-3">
                {viewing.photo_paths.map((_, i) => {
                  const page = i + 1
                  const isRead = viewing.pages_read.includes(page)
                  return (
                    <span key={page} className="text-xs font-semibold px-2.5 py-1 rounded-full border border-gray-300 text-gray-600">
                      Page {page}: {isRead ? '✓ read' : 'not read'}
                    </span>
                  )
                })}
              </div>
              {readError && (
                <div className="mt-3 border border-gray-300 rounded-xl p-3 bg-gray-50" role="alert">
                  <p className="text-sm text-gray-800">{readError.message}</p>
                  {readError.canRetry ? (
                    <button
                      onClick={() => readInvoice(viewing)}
                      disabled={reading}
                      className="mt-2 min-h-[48px] w-full bg-gray-700 hover:bg-gray-800 text-white font-semibold rounded-xl disabled:opacity-50"
                    >
                      Retry page {readError.page}
                    </button>
                  ) : (
                    <p className="text-xs text-gray-500 mt-1">Page {readError.page} can&apos;t be read again. Start a new scan with a clearer photo of that page.</p>
                  )}
                </div>
              )}
              {!readError && (
                <button
                  onClick={() => readInvoice(viewing)}
                  disabled={reading}
                  className="mt-3 min-h-[56px] w-full bg-[#c8102e] hover:bg-[#a50d26] text-white font-bold rounded-2xl text-lg disabled:opacity-70"
                >
                  {reading ? readProgress || 'Reading…' : viewing.pages_read.length > 0 ? 'Continue Reading' : 'Read Invoice'}
                </button>
              )}
            </div>
          )}
          {viewing.status === 'read' && (
            <button
              onClick={() => router.push(`/scan-invoice/check?id=${encodeURIComponent(viewing.id)}`)}
              className="mt-4 min-h-[56px] w-full bg-[#1a7a3c] hover:bg-[#155f2f] text-white font-bold rounded-2xl text-lg"
            >
              Go to Check-Off
            </button>
          )}
          <p className="text-xs text-gray-400 mt-4 mb-4">These photo links stop working after {Math.round(viewing.expires_in / 60)} minutes. Open the draft again to see them.</p>
          <div className="space-y-4">
            {viewing.pages.map((p) => (
              <div key={p.page} className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <p className="px-4 py-2 text-sm font-semibold text-gray-700 border-b border-gray-100">Page {p.page}</p>
                {p.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.url} alt={`Invoice page ${p.page}`} className="w-full h-auto block" />
                ) : (
                  <p className="px-4 py-6 text-sm text-gray-400">This page could not be loaded.</p>
                )}
              </div>
            ))}
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
        <div className="mb-5">
          <button onClick={() => router.back()} className="text-sm text-gray-500 hover:text-gray-700 mb-2 flex items-center gap-1">← Back</button>
          <h1 className="text-2xl font-bold text-gray-900">Scan Invoice</h1>
          <p className="text-gray-500 mt-1">Take one photo per invoice page and save it as a draft.</p>
        </div>

        {/* Patch 70: nobody forgets an invoice that was read but never
            confirmed (these are never auto-deleted: they hold the check-off).
            Neutral gray outline, a new meaning, so no existing color. */}
        {unconfirmed.length > 0 && (
          <div className="bg-white border-2 border-gray-700 rounded-2xl p-4 mb-5" role="status" data-testid="unconfirmed-nudge">
            <p className="font-bold text-gray-900">
              {unconfirmed.length} invoice{unconfirmed.length === 1 ? '' : 's'} read but not confirmed
            </p>
            <div className="flex flex-col gap-2 mt-3">
              {unconfirmed.slice(0, 5).map((u) => (
                <button
                  key={u.id}
                  onClick={() => router.push(`/scan-invoice/check?id=${encodeURIComponent(u.id)}`)}
                  className="w-full min-h-[52px] px-4 flex items-center justify-between gap-3 border border-gray-300 rounded-xl text-left"
                  data-testid="unconfirmed-open"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-gray-900 truncate">
                      {vendorLabel(u.vendor)}{u.invoice_number ? ` #${u.invoice_number}` : ''}
                    </span>
                    <span className="block text-xs text-gray-500">
                      Scanned {formatWhen(u.created_at)}{u.created_by ? ` · ${u.created_by}` : ''}
                    </span>
                  </span>
                  <span className="text-sm font-semibold text-gray-700 flex-shrink-0">Open →</span>
                </button>
              ))}
              {unconfirmed.length > 5 && <p className="text-xs text-gray-500">and {unconfirmed.length - 5} more in Recent invoices below.</p>}
            </div>
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded-2xl px-4 py-3 mb-5 text-sm">
          Save the photos, then tap Read Invoice to check off what arrived. Confirming the delivery adds the stock. Filing as record only does not.
        </div>

        {/* Vendor */}
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Vendor</h2>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 mb-5 grid grid-cols-3 gap-2">
          {INVOICE_VENDORS.map((v) => (
            <button
              key={v}
              onClick={() => setVendor(v)}
              disabled={saving}
              className={`py-4 rounded-xl font-semibold text-base transition-colors ${vendor === v ? 'bg-[#1a7a3c] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            >
              {VENDOR_LABELS[v]}
            </button>
          ))}
        </div>

        {/* Pages */}
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Pages</h2>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 mb-5">
          <div className="grid grid-cols-2 gap-2 mb-3">
            <button
              onClick={() => cameraRef.current?.click()}
              disabled={saving || pages.length >= MAX_INVOICE_PAGES}
              className="py-4 rounded-xl font-semibold text-base bg-[#1a7a3c] hover:bg-[#155f2f] text-white disabled:opacity-50"
            >
              📷 Take Photo
            </button>
            <button
              onClick={() => libraryRef.current?.click()}
              disabled={saving || pages.length >= MAX_INVOICE_PAGES}
              className="py-4 rounded-xl font-semibold text-base bg-gray-100 hover:bg-gray-200 text-gray-700 disabled:opacity-50"
            >
              Choose Photos
            </button>
          </div>
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
          />
          <input
            ref={libraryRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => { addFiles(e.target.files); e.target.value = '' }}
          />

          {pages.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No pages yet. Page 1 first, then page 2.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {pages.map((p, i) => (
                <div key={p.key} className="relative rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.previewUrl} alt={`Page ${i + 1}`} className="w-full h-40 object-cover block" />
                  <span className="absolute top-2 left-2 bg-black/70 text-white text-xs font-bold px-2 py-1 rounded-lg">Page {i + 1}</span>
                  <button
                    onClick={() => removePage(p.key)}
                    disabled={saving}
                    aria-label={`Remove page ${i + 1}`}
                    className="absolute top-1 right-1 w-10 h-10 rounded-full bg-white/90 text-gray-700 text-lg font-bold shadow disabled:opacity-50"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-[#c8102e] font-medium mb-3">{error}</p>}
        {savedMessage && <p className="text-sm text-[#1a7a3c] font-semibold mb-3">{savedMessage}</p>}

        <button
          onClick={save}
          disabled={!vendor || pages.length === 0 || saving}
          className="w-full bg-[#c8102e] hover:bg-[#a50d26] text-white font-bold py-4 rounded-2xl text-lg disabled:opacity-40 mb-2"
        >
          {saving ? progress || 'Saving…' : `Save Draft${pages.length ? ` (${pages.length} page${pages.length === 1 ? '' : 's'})` : ''}`}
        </button>
        {!vendor && pages.length > 0 && <p className="text-xs text-gray-500 text-center mb-2">Pick a vendor first.</p>}

        {/* Recent drafts */}
        <div className="flex items-center justify-between mt-6 mb-3">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400">Recent invoices</h2>
          <Link href="/history?tab=invoices" className="min-h-[44px] inline-flex items-center text-sm font-semibold text-gray-700" data-testid="invoice-history-link">
            Invoice history →
          </Link>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {recentLoading ? (
            <p className="px-5 py-4 text-sm text-gray-400">Loading…</p>
          ) : recent.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-400">No invoices scanned yet.</p>
          ) : (
            recent.map((inv) => (
              <button
                key={inv.id}
                onClick={() => openRecent(inv)}
                disabled={viewLoadingId !== null}
                className="w-full flex items-center justify-between px-5 py-4 border-b border-gray-100 last:border-0 text-left hover:bg-gray-50"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">
                    {vendorLabel(inv.vendor)}{inv.invoice_number ? ` #${inv.invoice_number}` : ''}
                    <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full border border-gray-300 text-gray-500 uppercase tracking-wide align-middle">{inv.status}</span>
                  </p>
                  <p className="text-xs text-gray-400">
                    {formatWhen(inv.created_at)} · {inv.photo_paths.length} page{inv.photo_paths.length === 1 ? '' : 's'}
                    {inv.created_by ? ` · ${inv.created_by}` : ''}
                  </p>
                </div>
                <span className="text-sm text-gray-400 flex-shrink-0">{viewLoadingId === inv.id ? 'Opening…' : inv.status === 'read' ? 'Check off →' : inv.status === 'received' ? 'Summary →' : 'Open →'}</span>
              </button>
            ))
          )}
        </div>
      </main>
    </div>
  )
}
