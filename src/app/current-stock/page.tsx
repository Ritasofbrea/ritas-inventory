'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { Item, CATEGORIES, getStockStatus } from '@/lib/types'

const STATUS_ORDER = { out: 0, low: 1, ok: 2 }

type LastCount = { item_id: string; created_at: string; entered_by: string }

function formatCountDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function CurrentStockPage() {
  const router = useRouter()
  const [items, setItems] = useState<Item[]>([])
  const [lastCounts, setLastCounts] = useState<Record<string, LastCount>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'out' | 'low' | 'ok'>('all')
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    if (role !== 'owner') { router.replace('/count'); return }
    fetchData()
  }, [router])

  const fetchData = async () => {
    const [itemsRes, countsRes] = await Promise.all([
      fetch('/api/items'),
      fetch('/api/counts/last-per-item'),
    ])
    setItems(await itemsRes.json())
    const counts: LastCount[] = await countsRes.json()
    const map: Record<string, LastCount> = {}
    for (const c of counts) map[c.item_id] = c
    setLastCounts(map)
    setLastUpdated(new Date())
    setLoading(false)
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-400 text-lg">Loading…</p></div>
  }

  const searchTerm = search.trim().toLowerCase()

  const visible = items.filter((i) => {
    if (searchTerm && !i.name.toLowerCase().includes(searchTerm)) return false
    if (filter !== 'all' && getStockStatus(i) !== filter) return false
    return true
  })

  const outCount = items.filter((i) => getStockStatus(i) === 'out').length
  const lowCount = items.filter((i) => getStockStatus(i) === 'low').length
  const okCount = items.filter((i) => getStockStatus(i) === 'ok').length

  const byCategory = CATEGORIES.reduce<Record<string, Item[]>>((acc, cat) => {
    const catItems = visible
      .filter((i) => i.category === cat)
      .sort((a, b) => STATUS_ORDER[getStockStatus(a)] - STATUS_ORDER[getStockStatus(b)])
    if (catItems.length) acc[cat] = catItems
    return acc
  }, {})

  return (
    <div className="min-h-screen flex flex-col bg-[#d4edda]">
      <Navigation />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Current Stock</h1>
            {lastUpdated && (
              <p className="text-gray-400 text-sm mt-0.5">
                Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>
          <button
            onClick={fetchData}
            className="text-sm text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-400 px-3 py-1.5 rounded-lg"
          >
            Refresh
          </button>
        </div>

        {/* Summary pills */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {(['all', 'out', 'low', 'ok'] as const).map((f) => {
            const label = f === 'all' ? `All (${items.length})` : f === 'out' ? `Out (${outCount})` : f === 'low' ? `Low (${lowCount})` : `OK (${okCount})`
            const activeClass = f === 'out' ? 'bg-red-600 text-white border-red-600'
              : f === 'low' ? 'bg-amber-500 text-white border-amber-500'
              : f === 'ok' ? 'bg-green-600 text-white border-green-600'
              : 'bg-gray-800 text-white border-gray-800'
            const inactiveClass = f === 'out' ? 'bg-red-50 text-red-700 border-red-200'
              : f === 'low' ? 'bg-amber-50 text-amber-700 border-amber-200'
              : f === 'ok' ? 'bg-green-50 text-green-700 border-green-200'
              : 'bg-white text-gray-600 border-gray-200'
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${filter === f ? activeClass : inactiveClass}`}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-gray-900 focus:outline-none focus:border-blue-400 bg-white text-sm"
          />
        </div>

        {Object.keys(byCategory).length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
            <p className="text-gray-400">{searchTerm ? `No items match "${search}"` : 'No items in this category.'}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {CATEGORIES.filter((c) => byCategory[c]).map((category) => (
              <section key={category}>
                <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">{category}</h2>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  {byCategory[category].map((item, idx, arr) => {
                    const status = getStockStatus(item)
                    return (
                      <div
                        key={item.id}
                        className={`flex items-center gap-4 px-5 py-3.5 ${idx < arr.length - 1 ? 'border-b border-gray-100' : ''}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 text-sm">{item.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            par {item.par_level} {item.unit}
                            {item.secondary_unit ? ` · ${item.secondary_count} ${item.secondary_unit}` : ''}
                            {lastCounts[item.id]
                              ? ` · counted ${formatCountDate(lastCounts[item.id].created_at)}`
                              : ' · never counted'}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className={`text-base font-bold ${status === 'out' ? 'text-red-600' : status === 'low' ? 'text-amber-600' : 'text-gray-900'}`}>
                            {item.current_count}
                            <span className="text-xs font-normal text-gray-400 ml-1">{item.unit}</span>
                          </p>
                        </div>
                        <span className={`flex-shrink-0 text-xs font-bold px-2.5 py-1 rounded-lg w-10 text-center ${
                          status === 'out' ? 'bg-red-100 text-red-700'
                          : status === 'low' ? 'bg-amber-100 text-amber-700'
                          : 'bg-green-100 text-green-700'
                        }`}>
                          {status === 'out' ? 'OUT' : status === 'low' ? 'LOW' : 'OK'}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
