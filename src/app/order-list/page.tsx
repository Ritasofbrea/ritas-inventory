'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { Item, getStockStatus } from '@/lib/types'

type DistributorItem = Item & { distributor?: string; item_number?: string; distributor_item_name?: string }

interface OrderRecord {
  id: string
  type: 'ordered' | 'received' | 'will_call'
  notes: string
  created_at: string
  order_history_items: { item_name: string; quantity: number; unit: string }[]
}

const DISTRIBUTOR_ORDER = ['bunzl', 'balford', 'other', 'seasonal', 'discontinued']
const DISTRIBUTOR_LABELS: Record<string, string> = { bunzl: 'Bunzl', balford: 'Balford', other: 'Other', seasonal: 'Seasonal', discontinued: 'Discontinued' }
const DISTRIBUTOR_COLORS: Record<string, string> = { bunzl: 'text-blue-600', balford: 'text-purple-600', other: 'text-gray-500', seasonal: 'text-green-600', discontinued: 'text-gray-400' }

const TYPE_LABELS: Record<string, string> = { ordered: 'Order Placed', received: 'Delivery Received', will_call: 'Will Call Received' }
const TYPE_COLORS: Record<string, string> = { ordered: 'bg-blue-100 text-blue-700', received: 'bg-green-100 text-green-700', will_call: 'bg-purple-100 text-purple-700' }

export default function OrderListPage() {
  const router = useRouter()
  const [items, setItems] = useState<DistributorItem[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'today' | 'history'>('today')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Mark as ordered
  const [marking, setMarking] = useState(false)
  const [marked, setMarked] = useState(false)

  // Order history
  const [orderHistory, setOrderHistory] = useState<OrderRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set())

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    if (role !== 'owner') { router.replace('/count'); return }
    fetchItems()
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

  const fetchHistory = async () => {
    if (orderHistory.length > 0) return
    setHistoryLoading(true)
    try {
      const res = await fetch('/api/order-history')
      setOrderHistory(await res.json())
    } finally {
      setHistoryLoading(false)
    }
  }

  const handleViewChange = (v: 'today' | 'history') => {
    setView(v)
    if (v === 'history') fetchHistory()
  }

  const handleMarkOrdered = async () => {
    setMarking(true)
    try {
      const orderItems = needsOrder.map((item) => ({
        item_id: item.id,
        item_name: item.name,
        quantity: Math.max(0, item.par_level - item.current_count),
        unit: item.unit,
      }))
      await fetch('/api/order-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'ordered', items: orderItems }),
      })
      setMarked(true)
      setOrderHistory([]) // reset so history reloads fresh
      setTimeout(() => setMarked(false), 3000)
    } finally {
      setMarking(false)
    }
  }

  const toggleOrder = (id: string) => {
    setExpandedOrders((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-400 text-lg">Loading…</p></div>
  }

  const needsOrder = items.filter((i) => getStockStatus(i) !== 'ok')
  const outItems = needsOrder.filter((i) => getStockStatus(i) === 'out')
  const lowItems = needsOrder.filter((i) => getStockStatus(i) === 'low')

  const sorted = [...needsOrder].sort((a, b) => {
    if (a.supplier_order == null && b.supplier_order == null) return 0
    if (a.supplier_order == null) return 1
    if (b.supplier_order == null) return -1
    return a.supplier_order - b.supplier_order
  })

  const byDistributor = DISTRIBUTOR_ORDER.reduce<Record<string, DistributorItem[]>>((acc, d) => {
    acc[d] = sorted.filter((i) => (i.distributor ?? 'other') === d)
    return acc
  }, {})

  const unmapped = sorted.filter((i) => !i.distributor)

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Order List</h1>
            {lastUpdated && (
              <p className="text-gray-400 text-sm mt-0.5">
                Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={fetchItems} className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-3 py-1.5 rounded-lg">
              Refresh
            </button>
            <button
              onClick={() => router.push('/receive-order')}
              className="text-sm bg-[#1a7a3c] hover:bg-[#155f2f] text-white font-semibold px-3 py-1.5 rounded-lg"
            >
              + Receive Order
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
          <button
            onClick={() => handleViewChange('today')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${view === 'today' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
          >
            Today&apos;s Order
          </button>
          <button
            onClick={() => handleViewChange('history')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${view === 'history' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
          >
            Order History
          </button>
        </div>

        {view === 'today' ? (
          <>
            {needsOrder.length === 0 ? (
              <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-8 text-center">
                <p className="text-4xl mb-3">✅</p>
                <p className="text-green-800 font-bold text-xl">Everything is stocked!</p>
                <p className="text-green-600 text-sm mt-1">Nothing needs to be ordered right now.</p>
              </div>
            ) : (
              <>
                <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4 mb-6 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-red-800 font-bold text-lg">{needsOrder.length} item{needsOrder.length !== 1 ? 's' : ''} to order</p>
                    <p className="text-red-600 text-sm mt-0.5">{outItems.length} out of stock · {lowItems.length} running low</p>
                  </div>
                  <button
                    onClick={handleMarkOrdered}
                    disabled={marking || marked}
                    className={`flex-shrink-0 font-semibold px-4 py-2.5 rounded-xl text-sm transition-colors ${
                      marked ? 'bg-green-500 text-white' : marking ? 'bg-gray-200 text-gray-400' : 'bg-[#1a7a3c] hover:bg-[#155f2f] text-white'
                    }`}
                  >
                    {marked ? '✓ Order Saved' : marking ? 'Saving…' : 'Mark as Ordered'}
                  </button>
                </div>

                {DISTRIBUTOR_ORDER.map((dist) => {
                  const distItems = byDistributor[dist]
                  if (!distItems || distItems.length === 0) return null
                  return (
                    <section key={dist} className="mb-6">
                      <h2 className={`text-xs font-bold uppercase tracking-widest mb-2 ${DISTRIBUTOR_COLORS[dist]}`}>{DISTRIBUTOR_LABELS[dist]}</h2>
                      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                        {distItems.map((item, idx) => {
                          const status = getStockStatus(item)
                          return (
                            <div key={item.id} className={`flex items-center gap-3 px-5 py-4 ${idx < distItems.length - 1 ? 'border-b border-gray-100' : ''}`}>
                              <div className="flex-1 min-w-0">
                                <p className="font-semibold text-gray-900">{item.name}</p>
                                <p className="text-sm text-gray-400">
                                  {item.item_number && <span className="font-mono text-gray-500 mr-2">#{item.item_number}</span>}
                                  {item.distributor_item_name ?? item.category}
                                </p>
                              </div>
                              <div className="text-right flex-shrink-0 mr-2">
                                <p className="text-sm text-gray-500">
                                  <span className="font-bold text-gray-900">{item.current_count}</span>
                                  {' / '}
                                  <span className="text-gray-400">{item.par_level} {item.unit}</span>
                                </p>
                              </div>
                              <span className={`flex-shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg ${status === 'out' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                                {status === 'out' ? 'OUT' : 'LOW'}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    </section>
                  )
                })}

                {unmapped.length > 0 && (
                  <section className="mb-6">
                    <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Other</h2>
                    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                      {unmapped.map((item, idx) => {
                        const status = getStockStatus(item)
                        return (
                          <div key={item.id} className={`flex items-center gap-3 px-5 py-4 ${idx < unmapped.length - 1 ? 'border-b border-gray-100' : ''}`}>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-gray-900">{item.name}</p>
                              <p className="text-sm text-gray-400">{item.category}</p>
                            </div>
                            <span className={`flex-shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg ${status === 'out' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                              {status === 'out' ? 'OUT' : 'LOW'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                )}
              </>
            )}
          </>
        ) : (
          <>
            {historyLoading ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
                <p className="text-gray-400">Loading history…</p>
              </div>
            ) : orderHistory.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
                <p className="text-gray-400 text-lg">No order history yet.</p>
                <p className="text-gray-400 text-sm mt-1">Use "Mark as Ordered" or "Receive Order" to start tracking.</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                {orderHistory.map((order, idx) => {
                  const isExpanded = expandedOrders.has(order.id)
                  return (
                    <div key={order.id} className={idx < orderHistory.length - 1 ? 'border-b border-gray-100' : ''}>
                      <button
                        onClick={() => toggleOrder(order.id)}
                        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className={`flex-shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg ${TYPE_COLORS[order.type]}`}>
                            {TYPE_LABELS[order.type]}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-900">{formatDate(order.created_at)}</p>
                            <p className="text-xs text-gray-400">{order.order_history_items.length} items</p>
                          </div>
                        </div>
                        <svg className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {isExpanded && (
                        <div className="border-t border-gray-100">
                          {order.order_history_items.map((item, i) => (
                            <div key={i} className={`flex items-center justify-between px-5 py-3 bg-gray-50 ${i < order.order_history_items.length - 1 ? 'border-b border-gray-100' : ''}`}>
                              <p className="text-sm font-medium text-gray-900">{item.item_name}</p>
                              <p className="text-sm font-bold text-gray-700">{item.quantity} <span className="font-normal text-gray-400">{item.unit}</span></p>
                            </div>
                          ))}
                          {order.notes && (
                            <div className="px-5 py-3 bg-yellow-50 border-t border-gray-100">
                              <p className="text-xs text-gray-500 italic">{order.notes}</p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
