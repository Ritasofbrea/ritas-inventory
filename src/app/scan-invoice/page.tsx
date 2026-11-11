'use client'

// Patch 63: Scan Invoice -- storage only. Crew picks the vendor, takes or
// picks one photo per invoice page, and saves them as a DRAFT invoice in
// the private invoice-photos bucket. Nothing is read and no stock moves;
// reading the invoice and checking off lines come in later patches.
// Owners and shift leads only (the API enforces this too).

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
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
  photo_paths: string[]
  created_by: string | null
  created_at: string
}

interface InvoiceDetail extends InvoiceSummary {
  pages: { page: number; url: string | null }[]
  expires_in: number
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
  const [viewing, setViewing] = useState<InvoiceDetail | null>(null)
  const [viewLoadingId, setViewLoadingId] = useState<string | null>(null)
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

  if (!allowed) return null

  // Viewing one saved draft's pages (signed links, short-lived).
  if (viewing) {
    return (
      <div className="min-h-screen flex flex-col bg-[#d4edda]">
        <Navigation />
        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">
          <button onClick={() => setViewing(null)} className="text-sm text-gray-500 hover:text-gray-700 mb-2 flex items-center gap-1">← Back</button>
          <h1 className="text-2xl font-bold text-gray-900">{vendorLabel(viewing.vendor)} invoice</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Draft · {formatWhen(viewing.created_at)}{viewing.created_by ? ` · ${viewing.created_by}` : ''}
          </p>
          <p className="text-xs text-gray-400 mt-1 mb-4">These photo links stop working after {Math.round(viewing.expires_in / 60)} minutes. Open the draft again to see them.</p>
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

        <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded-2xl px-4 py-3 mb-5 text-sm">
          This only saves the photos. Reading the invoice and checking off what arrived comes in a later step. No stock is changed here.
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
        <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mt-6 mb-3">Recent invoices</h2>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          {recentLoading ? (
            <p className="px-5 py-4 text-sm text-gray-400">Loading…</p>
          ) : recent.length === 0 ? (
            <p className="px-5 py-4 text-sm text-gray-400">No invoices scanned yet.</p>
          ) : (
            recent.map((inv) => (
              <button
                key={inv.id}
                onClick={() => openInvoice(inv.id)}
                disabled={viewLoadingId !== null}
                className="w-full flex items-center justify-between px-5 py-4 border-b border-gray-100 last:border-0 text-left hover:bg-gray-50"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">
                    {vendorLabel(inv.vendor)}
                    <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full border border-gray-300 text-gray-500 uppercase tracking-wide align-middle">{inv.status}</span>
                  </p>
                  <p className="text-xs text-gray-400">
                    {formatWhen(inv.created_at)} · {inv.photo_paths.length} page{inv.photo_paths.length === 1 ? '' : 's'}
                    {inv.created_by ? ` · ${inv.created_by}` : ''}
                  </p>
                </div>
                <span className="text-sm text-gray-400 flex-shrink-0">{viewLoadingId === inv.id ? 'Opening…' : 'View →'}</span>
              </button>
            ))
          )}
        </div>
      </main>
    </div>
  )
}
