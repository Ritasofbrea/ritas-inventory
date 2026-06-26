'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { Item, getStockStatus, CATEGORIES } from '@/lib/types'

export default function DashboardPage() {
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

  const outItems = items.filter((i) => getStockStatus(i) === 'out')
  const lowItems = items.filter((i) => getStockStatus(i) === 'low')
  const okItems = items.filter((i) => getStockStatus(i) === 'ok')

  const needsAttention = outItems.length + lowItems.length

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Order Dashboard</h1>
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

        {/* Summary banner */}
        {needsAttention === 0 ? (
          <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-4 mb-6 flex items-center gap-3">
            <span className="text-2xl">✅</span>
            <p className="text-green-800 font-semibold text-lg">Everything is stocked!</p>
          </div>
        ) : (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4 mb-6">
            <p className="text-red-800 font-bold text-lg">
              {needsAttention} item{needsAttention !== 1 ? 's' : ''} need{needsAttention === 1 ? 's' : ''} ordering
            </p>
            <p className="text-red-600 text-sm mt-0.5">
              {outItems.length} out of stock · {lowItems.length} running low
            </p>
          </div>
        )}

        {/* OUT items */}
        {outItems.length > 0 && (
          <section className="mb-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-red-500 mb-3">
              Out of Stock – Order Now
            </h2>
            <div className="bg-white rounded-2xl shadow-sm border border-red-100 overflow-hidden">
              {outItems.map((item, idx) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  isLast={idx === outItems.length - 1}
                  badge="OUT"
                  badgeColor="bg-red-100 text-red-700"
                />
              ))}
            </div>
          </section>
        )}

        {/* LOW items */}
        {lowItems.length > 0 && (
          <section className="mb-6">
            <h2 className="text-xs font-bold uppercase tracking-widest text-amber-500 mb-3">
              Running Low – Order Soon
            </h2>
            <div className="bg-white rounded-2xl shadow-sm border border-amber-100 overflow-hidden">
              {lowItems.map((item, idx) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  isLast={idx === lowItems.length - 1}
                  badge="LOW"
                  badgeColor="bg-amber-100 text-amber-700"
                />
              ))}
            </div>
          </section>
        )}

        {/* OK items – collapsed summary */}
        {okItems.length > 0 && (
          <details className="mb-6">
            <summary className="cursor-pointer text-xs font-bold uppercase tracking-widest text-gray-400 mb-3 list-none flex items-center gap-2">
              <span>▶ Well Stocked ({okItems.length} items)</span>
            </summary>
            <div className="mt-3 bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
              {CATEGORIES.map((cat) => {
                const catItems = okItems.filter((i) => i.category === cat)
                if (catItems.length === 0) return null
                return catItems.map((item, idx) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    isLast={idx === catItems.length - 1 && okItems[okItems.length - 1].id === item.id}
                    badge="OK"
                    badgeColor="bg-green-100 text-green-700"
                  />
                ))
              })}
            </div>
          </details>
        )}
      </main>
    </div>
  )
}

function ItemRow({
  item,
  isLast,
  badge,
  badgeColor,
}: {
  item: Item
  isLast: boolean
  badge: string
  badgeColor: string
}) {
  return (
    <div
      className={`flex items-center gap-4 px-5 py-4 ${
        !isLast ? 'border-b border-gray-100' : ''
      }`}
    >
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-900">{item.name}</p>
        <p className="text-sm text-gray-400">{item.category}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm text-gray-500">
          <span className="font-bold text-gray-900 text-lg">{item.current_count}</span>
          {' / '}
          <span className="text-gray-400">{item.par_level} {item.unit}</span>
        </p>
      </div>
      <span
        className={`flex-shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg ${badgeColor}`}
      >
        {badge}
      </span>
    </div>
  )
}
