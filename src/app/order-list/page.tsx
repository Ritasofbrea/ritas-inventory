'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { Item, getStockStatus, CATEGORIES } from '@/lib/types'

export default function OrderListPage() {
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    if (role !== 'owner') { router.replace('/count'); return }
    fetchItems()
  }, [router])

  const fetchItems = async () => {
    try {
      const res = await fetch('/api/items')
      const data = await res.json()
      setItems(data)
      setLastUpdated(new Date())
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400 text-lg">Loading…</p>
      </div>
    )
  }

  const needsOrder = items.filter((i) => getStockStatus(i) !== 'ok')
  const outItems = needsOrder.filter((i) => getStockStatus(i) === 'out')
  const lowItems = needsOrder.filter((i) => getStockStatus(i) === 'low')

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Order List</h1>
            {lastUpdated && (
              <p className="text-gray-400 text-sm mt-0.5">
                Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <button
            onClick={fetchItems}
            className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-3 py-1.5 rounded-lg"
          >
            Refresh
          </button>
        </div>

        {needsOrder.length === 0 ? (
          <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-8 text-center">
            <p className="text-4xl mb-3">✅</p>
            <p className="text-green-800 font-bold text-xl">Everything is stocked!</p>
            <p className="text-green-600 text-sm mt-1">Nothing needs to be ordered right now.</p>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4 mb-6">
              <p className="text-red-800 font-bold text-lg">
                {needsOrder.length} item{needsOrder.length !== 1 ? 's' : ''} to order
              </p>
              <p className="text-red-600 text-sm mt-0.5">
                {outItems.length} out of stock · {lowItems.length} running low
              </p>
            </div>

            {/* Grouped by category */}
            {CATEGORIES.map((cat) => {
              const catItems = needsOrder.filter((i) => i.category === cat)
              if (catItems.length === 0) return null
              return (
                <section key={cat} className="mb-5">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
                    {cat}
                  </h2>
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    {catItems.map((item, idx) => {
                      const status = getStockStatus(item)
                      return (
                        <div
                          key={item.id}
                          className={`flex items-center gap-4 px-5 py-4 ${
                            idx < catItems.length - 1 ? 'border-b border-gray-100' : ''
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900">{item.name}</p>
                            <p className="text-sm text-gray-400">
                              {item.current_count} / {item.par_level} {item.unit}
                            </p>
                          </div>
                          <span
                            className={`flex-shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg ${
                              status === 'out'
                                ? 'bg-red-100 text-red-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {status === 'out' ? 'OUT' : 'LOW'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </>
        )}
      </main>
    </div>
  )
}
