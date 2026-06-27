'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { Item, getStockStatus } from '@/lib/types'

type LastCount = { item_id: string; created_at: string; entered_by: string }

function daysSince(iso: string) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
}

interface ShortRecord {
  id: string
  created_at: string
  notes: string
  resolved: boolean
  related_order_id: string | null
  order_history_items: { item_name: string; quantity: number; unit: string }[]
}

interface SummaryData {
  lastCount: { created_at: string; entered_by: string } | null
  lastReceived: { created_at: string; received_by: string | null; type: string } | null
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    time: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }
}

export default function DashboardPage() {
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [lastCounts, setLastCounts] = useState<Record<string, LastCount>>({})
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [shorts, setShorts] = useState<ShortRecord[]>([])
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [pendingResolveId, setPendingResolveId] = useState<string | null>(null)
  const [resolveByName, setResolveByName] = useState('')
  const [summary, setSummary] = useState<SummaryData>({ lastCount: null, lastReceived: null })
  const [onOrderCount, setOnOrderCount] = useState(0)
  const [receiptReceivedBy, setReceiptReceivedBy] = useState<Record<string, string | null>>({})

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    if (role !== 'owner') { router.replace('/count'); return }
    Promise.all([fetchItems(), fetchOrderHistory(), fetchSummary(), fetchLastCounts()])
  }, [router])

  const fetchItems = async () => {
    try {
      const res = await fetch('/api/items')
      setItems(await res.json())
      setLastUpdated(new Date())
    } finally {
      setLoading(false)
    }
  }

  const fetchOrderHistory = async () => {
    const res = await fetch('/api/order-history')
    if (!res.ok) return
    type HistoryRecord = { id: string; type: string; resolved: boolean; related_order_id: string | null; received_by?: string | null; notes: string; created_at: string; order_history_items: { item_id?: string; item_name: string; quantity: number; unit: string }[] }
    const all = (await res.json()) as HistoryRecord[]

    // Unresolved shorts
    setShorts(all.filter((r) => r.type === 'short' && r.resolved === false) as ShortRecord[])

    // Receipt lookup for received_by
    const byId: Record<string, string | null> = {}
    all.filter((r) => r.type === 'received' || r.type === 'will_call').forEach((r) => { byId[r.id] = r.received_by ?? null })
    setReceiptReceivedBy(byId)

    // On-order count
    const fulfilledIds = new Set(all.filter((r) => r.type === 'received' || r.type === 'will_call').map((r) => r.related_order_id).filter(Boolean) as string[])
    const pending = all.filter((r) => r.type === 'ordered' && !fulfilledIds.has(r.id))
    const itemIds = new Set(pending.flatMap((o) => o.order_history_items.map((i) => i.item_id).filter(Boolean)))
    setOnOrderCount(itemIds.size)
  }

  const fetchSummary = async () => {
    const res = await fetch('/api/dashboard-summary')
    if (res.ok) setSummary(await res.json())
  }

  const fetchLastCounts = async () => {
    const res = await fetch('/api/counts/last-per-item')
    if (!res.ok) return
    const counts: LastCount[] = await res.json()
    const map: Record<string, LastCount> = {}
    for (const c of counts) map[c.item_id] = c
    setLastCounts(map)
  }

  const resolveShort = async (id: string, name: string) => {
    setResolvingId(id)
    setPendingResolveId(null)
    setResolveByName('')
    await fetch('/api/order-history', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, resolved: true, resolved_by: name.trim() || null }) })
    setShorts((prev) => prev.filter((s) => s.id !== id))
    setResolvingId(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400 text-lg">Loading…</p>
      </div>
    )
  }

  const outItems = items.filter((i) => getStockStatus(i) === 'out')
  const lowItems = items.filter((i) => getStockStatus(i) === 'low')
  const needsAttention = outItems.length + lowItems.length

  const staleItems = items.filter((i) => {
    const lc = lastCounts[i.id]
    return !lc || daysSince(lc.created_at) > 7
  })

  const countFmt = summary.lastCount ? formatDateTime(summary.lastCount.created_at) : null
  const recvFmt = summary.lastReceived ? formatDateTime(summary.lastReceived.created_at) : null

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        {/* Header */}
        <div className="mb-5 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <button
            onClick={() => { fetchItems(); fetchOrderHistory(); fetchSummary(); fetchLastCounts() }}
            className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-3 py-1.5 rounded-lg"
          >
            Refresh
          </button>
        </div>

        {/* Activity summary cards */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-4">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Last Count</p>
            {countFmt ? (
              <>
                <p className="text-sm font-bold text-gray-900">{countFmt.date}</p>
                <p className="text-sm text-gray-500">{countFmt.time}</p>
                {summary.lastCount?.entered_by && (
                  <p className="text-xs text-[#1a7a3c] font-semibold mt-1 truncate">{summary.lastCount.entered_by}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-400">No counts yet</p>
            )}
          </div>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-4 py-4">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Last Received</p>
            {recvFmt ? (
              <>
                <p className="text-sm font-bold text-gray-900">{recvFmt.date}</p>
                <p className="text-sm text-gray-500">{recvFmt.time}</p>
                {summary.lastReceived?.received_by ? (
                  <p className="text-xs text-[#1a7a3c] font-semibold mt-1 truncate">{summary.lastReceived.received_by}</p>
                ) : (
                  <p className="text-xs text-gray-300 mt-1">{summary.lastReceived?.type === 'will_call' ? 'Will Call' : 'Delivery'}</p>
                )}
              </>
            ) : (
              <p className="text-sm text-gray-400">No deliveries yet</p>
            )}
          </div>
        </div>

        {/* On order indicator */}
        {onOrderCount > 0 && (
          <div className="mb-5 bg-blue-50 border border-blue-200 rounded-2xl px-5 py-3 flex items-center justify-between">
            <div>
              <p className="text-blue-800 font-bold">{onOrderCount} item{onOrderCount !== 1 ? 's' : ''} on order</p>
              <p className="text-blue-600 text-sm">Delivery pending</p>
            </div>
            <button onClick={() => router.push('/order-list')} className="text-sm text-blue-600 font-semibold border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-100">
              View →
            </button>
          </div>
        )}

        {/* Short shipment alerts */}
        {shorts.length > 0 && (
          <div className="mb-5 flex flex-col gap-3">
            {shorts.map((short) => (
              <div key={short.id} className="bg-red-600 text-white rounded-2xl px-5 py-4 shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-lg">⚠️ Short Shipment</p>
                    <p className="text-red-100 text-sm mt-0.5">{new Date(short.created_at).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}</p>
                    <ul className="mt-2 space-y-1">
                      {short.order_history_items.map((item, i) => (
                        <li key={i} className="text-sm font-semibold">
                          {item.item_name} — <span className="font-bold">{item.quantity} {item.unit} outstanding</span>
                        </li>
                      ))}
                    </ul>
                    {short.related_order_id && receiptReceivedBy[short.related_order_id] && (
                      <p className="text-red-200 text-xs mt-1">Received by {receiptReceivedBy[short.related_order_id]}</p>
                    )}
                    {short.notes && <p className="text-red-200 text-xs mt-2 italic">{short.notes}</p>}
                  </div>
                  {pendingResolveId !== short.id && (
                    <button
                      onClick={() => { setPendingResolveId(short.id); setResolveByName('') }}
                      disabled={resolvingId === short.id}
                      className="flex-shrink-0 bg-white text-red-700 hover:bg-red-50 font-bold text-sm px-4 py-2 rounded-xl transition-colors disabled:opacity-60"
                    >
                      {resolvingId === short.id ? '…' : 'Resolved ✓'}
                    </button>
                  )}
                </div>
                {pendingResolveId === short.id && (
                  <div className="mt-3 pt-3 border-t border-red-500">
                    <p className="text-red-100 text-xs mb-2">Who resolved this? (optional)</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={resolveByName}
                        onChange={(e) => setResolveByName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') resolveShort(short.id, resolveByName) }}
                        placeholder="Your name"
                        className="flex-1 rounded-xl px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none"
                        autoFocus
                      />
                      <button
                        onClick={() => resolveShort(short.id, resolveByName)}
                        className="bg-white text-red-700 hover:bg-red-50 font-bold text-sm px-4 py-2 rounded-xl"
                      >
                        Confirm
                      </button>
                      <button
                        onClick={() => setPendingResolveId(null)}
                        className="text-red-200 hover:text-white text-sm px-2"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Stock status */}
        {needsAttention === 0 ? (
          <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-4 flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <p className="text-green-800 font-semibold text-lg">Everything is stocked!</p>
          </div>
        ) : (
          <>
            <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-3 mb-4">
              <p className="text-red-800 font-bold">
                {needsAttention} item{needsAttention !== 1 ? 's' : ''} need{needsAttention === 1 ? 's' : ''} ordering
              </p>
              <p className="text-red-600 text-sm">{outItems.length} out · {lowItems.length} low</p>
            </div>

            {outItems.length > 0 && (
              <section className="mb-4">
                <p className="text-xs font-bold uppercase tracking-widest text-red-500 mb-2">Out of Stock</p>
                <div className="flex flex-wrap gap-2">
                  {outItems.map((item) => (
                    <StockPill key={item.id} item={item} variant="out" />
                  ))}
                </div>
              </section>
            )}

            {lowItems.length > 0 && (
              <section className="mb-4">
                <p className="text-xs font-bold uppercase tracking-widest text-amber-500 mb-2">Running Low</p>
                <div className="flex flex-wrap gap-2">
                  {lowItems.map((item) => (
                    <StockPill key={item.id} item={item} variant="low" />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* Stale items */}
        {staleItems.length > 0 && (
          <section className="mt-5">
            <div className="bg-orange-50 border border-orange-200 rounded-2xl px-5 py-3 mb-3">
              <p className="text-orange-800 font-bold">
                {staleItems.length} item{staleItems.length !== 1 ? 's' : ''} not counted in 7+ days
              </p>
              <p className="text-orange-600 text-sm">Stock data may be outdated</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {staleItems.map((item) => {
                const lc = lastCounts[item.id]
                const label = lc ? `${daysSince(lc.created_at)}d ago` : 'never'
                return (
                  <span key={item.id} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold bg-orange-100 text-orange-800 border border-orange-200">
                    {item.name}
                    <span className="text-xs font-normal text-orange-500">{label}</span>
                  </span>
                )
              })}
            </div>
          </section>
        )}

        {lastUpdated && (
          <p className="text-center text-gray-400 text-xs mt-6">
            Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
      </main>
    </div>
  )
}

function StockPill({ item, variant }: { item: Item; variant: 'out' | 'low' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${
        variant === 'out'
          ? 'bg-red-100 text-red-800 border border-red-200'
          : 'bg-amber-100 text-amber-800 border border-amber-200'
      }`}
    >
      {item.name}
      <span className={`text-xs font-normal ${variant === 'out' ? 'text-red-500' : 'text-amber-600'}`}>
        {variant === 'out' ? '0' : item.current_count}/{item.par_level}
      </span>
    </span>
  )
}
