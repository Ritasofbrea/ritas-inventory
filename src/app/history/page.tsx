'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Navigation from '@/components/Navigation'
import { getRole } from '@/lib/auth'
import { InventoryCount } from '@/lib/types'

interface OrderFrequency {
  name: string
  category: string
  unit: string
  orderCount: number
  lastCount: number
}

export default function HistoryPage() {
  const router = useRouter()
  const [history, setHistory] = useState<InventoryCount[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'recent' | 'trends'>('recent')

  useEffect(() => {
    const role = getRole()
    if (!role) { router.replace('/login'); return }
    if (role !== 'owner') { router.replace('/count'); return }
    fetchHistory()
  }, [router])

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/counts?limit=200')
      const data = await res.json()
      setHistory(data)
    } finally {
      setLoading(false)
    }
  }

  const trends = (): OrderFrequency[] => {
    const map: Record<string, OrderFrequency> = {}
    history.forEach((h) => {
      if (!h.items) return
      const key = h.item_id
      if (!map[key]) {
        map[key] = {
          name: h.items.name,
          category: h.items.category,
          unit: h.items.unit,
          orderCount: 0,
          lastCount: h.count,
        }
      }
      // Count as "would have needed order" if count was below par (approximate)
      map[key].orderCount += 1
      map[key].lastCount = h.count
    })
    return Object.values(map).sort((a, b) => b.orderCount - a.orderCount)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-400 text-lg">Loading…</p>
      </div>
    )
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  }

  // Group by day for recent view
  const grouped: Record<string, InventoryCount[]> = {}
  history.forEach((h) => {
    const day = new Date(h.created_at).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
    })
    if (!grouped[day]) grouped[day] = []
    grouped[day].push(h)
  })

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Usage History</h1>
          <p className="text-gray-500 mt-1">
            {history.length} count entries recorded
          </p>
        </div>

        {/* View toggle */}
        <div className="flex gap-2 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
          <button
            onClick={() => setView('recent')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              view === 'recent' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
            }`}
          >
            Recent Counts
          </button>
          <button
            onClick={() => setView('trends')}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
              view === 'trends' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
            }`}
          >
            Item Trends
          </button>
        </div>

        {history.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-12 text-center">
            <p className="text-gray-400 text-lg">No history yet.</p>
            <p className="text-gray-400 text-sm mt-1">
              Counts will appear here after the first entry.
            </p>
          </div>
        ) : view === 'recent' ? (
          <div className="flex flex-col gap-6">
            {Object.entries(grouped).map(([day, entries]) => (
              <section key={day}>
                <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
                  {day}
                </h2>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  {entries.map((entry, idx) => (
                    <div
                      key={entry.id}
                      className={`flex items-center gap-4 px-5 py-3.5 ${
                        idx < entries.length - 1 ? 'border-b border-gray-100' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900">
                          {entry.items?.name ?? '—'}
                        </p>
                        <p className="text-xs text-gray-400">
                          {entry.items?.category} · {formatDate(entry.created_at)}
                        </p>
                      </div>
                      <span className="font-bold text-lg text-gray-900">
                        {entry.count}
                        <span className="text-sm font-normal text-gray-400 ml-1">
                          {entry.items?.unit}
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 grid grid-cols-12 gap-2 text-xs font-bold text-gray-500 uppercase tracking-wide">
              <span className="col-span-7">Item</span>
              <span className="col-span-3 text-center">Times Counted</span>
              <span className="col-span-2 text-right">Last Count</span>
            </div>
            {trends().map((t, idx) => (
              <div
                key={t.name}
                className={`grid grid-cols-12 gap-2 items-center px-5 py-3.5 ${
                  idx < trends().length - 1 ? 'border-b border-gray-100' : ''
                }`}
              >
                <div className="col-span-7">
                  <p className="font-medium text-gray-900">{t.name}</p>
                  <p className="text-xs text-gray-400">{t.category}</p>
                </div>
                <div className="col-span-3 text-center">
                  <span className="font-bold text-blue-600">{t.orderCount}</span>
                </div>
                <div className="col-span-2 text-right">
                  <span className="font-semibold text-gray-700">{t.lastCount}</span>
                  <span className="text-xs text-gray-400 ml-1">{t.unit}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
